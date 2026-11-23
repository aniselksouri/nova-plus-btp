"use strict";

// Suivi des tournages Pixtyse × HSM : petite web app à lien secret (sans compte Nova+),
// pour Anis (Pixtyse), Otar et Tommy (HSM), à garder sur l'écran d'accueil du téléphone.
//
// - Page        : GET /tournages?k=CLÉ (la clé est dans le lien, NOVA_TOURNAGES_KEY)
// - Données     : /api/tournages… avec l'en-tête X-Tournages-Key
// - Photos      : stockées comme les autres fichiers Nova+ (table files, sauvegardées), servies
//                 seulement si leur nom est celui d'une photo de tournage.
// - Chantiers   : repris directement de Nova+ (au plus une fois par minute). Nova+ fait foi sur
//                 client, adresse et dates, mais seulement quand Nova+ change : une correction faite
//                 dans le suivi n'est pas écrasée tant que Nova+ ne bouge pas.
// - Suppression : marquée, jamais effacée (un chantier Nova+ supprimé du suivi ne revient pas).

const fs = require("fs");
const path = require("path");
const { httpError } = require("./security");
const { safeEqual } = require("./leads-intake");

const PAGE_FILE = path.join(__dirname, "..", "tournages", "index.html");
const ICONS = { "/tournages/icon-180.png": "icon-180.png", "/tournages/icon-512.png": "icon-512.png" };
const PHOTO_KEY = /^\d+-[0-9a-f-]{36}-tournage-photo\.(jpg|jpeg|png|webp)$/;
const DOC_ID = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const SYNC_EVERY_MS = 60_000;
const DAY = 864e5;

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    const current = base ? base[key] : undefined;
    out[key] =
      value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)
        ? deepMerge(current, value)
        : value;
  }
  return out;
}

const text = (value) => (typeof value === "string" ? value.trim() : "");
const isoDay = (value) => (/^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : "");
const frDay = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
const novaDocId = (id) => `nova-${String(id).replace(/[^A-Za-z0-9_\-.~:@+]/g, "-").slice(0, 190)}`;

// Chantier à suivre : non archivé, devis signé (« Devis » seul = pas encore signé), avec une date de
// début, et pas terminé depuis plus de 14 jours (le tournage après serait déjà raté).
function isWanted(project, today) {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * DAY).toISOString().slice(0, 10);
  const end = isoDay(project.endDate);
  return !project.archived && text(project.status).toLowerCase() !== "devis" && Boolean(isoDay(project.startDate)) && (!end || end >= cutoff);
}

// Calcule les écritures à faire pour refléter Nova+ dans le suivi. Pur : testable sans base.
function planNovaSync(projects, docs, { now = new Date() } = {}) {
  const stamp = now.toISOString();
  const today = stamp.slice(0, 10);
  const byNova = new Map();
  const byRef = new Map();
  for (const doc of docs) {
    if (doc.data?.nova?.id) byNova.set(String(doc.data.nova.id), doc);
    else if (!doc.deleted && doc.data?.ref) byRef.set(text(doc.data.ref).toLowerCase(), doc);
  }
  const creates = [];
  const updates = [];

  for (const raw of projects) {
    const project = {
      id: String(raw?.id ?? ""),
      name: text(raw?.name),
      client: text(raw?.client) || text(raw?.name),
      address: text(raw?.address),
      startDate: isoDay(raw?.startDate),
      endDate: isoDay(raw?.endDate),
      status: text(raw?.status),
      archived: raw?.archived === true,
    };
    if (!project.id) continue;
    const seen = { client: project.client, adresse: project.address, debut: project.startDate, fin: project.endDate };
    const linked = byNova.get(project.id) || byRef.get(project.id.toLowerCase()) || (project.name && byRef.get(project.name.toLowerCase()));

    if (!linked) {
      if (!isWanted(project, today)) continue;
      const started = project.startDate < today;
      const shoot = (statut) => ({ statut, formats: { photo: true, video: true } });
      creates.push({
        id: novaDocId(project.id),
        data: {
          client: project.client, type: "", debut: project.startDate, fin: project.endDate, finConfirmee: false,
          adresse: project.address, accord: "a_demander", ref: project.name || project.id, tel: "", notes: "",
          // Déjà commencé : le tournage avant n'est plus faisable, inutile de l'afficher en retard.
          avant: shoot(started ? "non_requis" : "a_faire"), apres: shoot("a_faire"), contenu: { statut: "a_monter" },
          nova: { id: project.id, statut: project.status, sync: stamp, seen },
          creeLe: stamp, creePar: "nova", maj: stamp,
          log: [{ t: stamp, par: "nova", m: `Chantier importé depuis Nova+${started ? " (déjà commencé : tournage avant non prévu)" : ""}` }],
        },
      });
      continue;
    }
    if (linked.deleted) continue;

    const data = linked.data || {};
    const before = data.nova?.seen || {};
    const patch = {};
    const changes = [];
    // Nova+ ne remplace une valeur que si Nova+ l'a changée depuis la dernière fois (ou au premier lien).
    const novaChanged = (field) => seen[field] && seen[field] !== before[field] && seen[field] !== data[field];
    if (novaChanged("client")) { patch.client = seen.client; changes.push("client mis à jour"); }
    if (novaChanged("adresse")) { patch.adresse = seen.adresse; changes.push("adresse mise à jour"); }
    if (novaChanged("debut")) { patch.debut = seen.debut; changes.push(`début au ${frDay(seen.debut)}`); }
    if (novaChanged("fin")) { patch.fin = seen.fin; patch.finConfirmee = false; changes.push(`fin au ${frDay(seen.fin)}`); }
    const novaInfo = { id: project.id, statut: project.status, seen, ...(project.archived ? { archive: true } : {}) };
    const sameInfo = JSON.stringify({ ...data.nova, sync: undefined }) === JSON.stringify({ ...novaInfo, sync: undefined });
    if (!changes.length && sameInfo) continue;
    patch.nova = { ...novaInfo, sync: stamp };
    if (changes.length) {
      patch.maj = stamp;
      patch.log = [...(Array.isArray(data.log) ? data.log : []), { t: stamp, par: "nova", m: `Nova+ : ${changes.join(", ")}` }].slice(-40);
    }
    updates.push({ id: linked.id, patch });
  }
  return { creates, updates };
}

function createTournages({ db, stateStore, fileStore, readJsonBody, sendJson, env, logger = console, now = () => new Date() }) {
  const failures = new Map();
  let lastSync = 0;
  let syncing = null;

  function keyOk(candidate) {
    return Boolean(env.NOVA_TOURNAGES_KEY) && safeEqual(candidate, env.NOVA_TOURNAGES_KEY);
  }

  function guard(request, ip, candidate) {
    if (!env.NOVA_TOURNAGES_KEY) throw httpError(503, "Suivi des tournages non configuré.");
    const id = ip || "?";
    const recent = (failures.get(id) || []).filter((time) => Date.now() - time < 15 * 60_000);
    if (recent.length >= 20) throw httpError(429, "Trop d'essais. Réessayez plus tard.");
    if (!keyOk(candidate)) {
      failures.set(id, [...recent, Date.now()]);
      throw httpError(401, "Lien invalide.");
    }
  }

  async function readDocs(client = db) {
    const rows = await client.query("SELECT id, data, version, deleted, updated_at FROM tournages ORDER BY id");
    return rows.map((row) => ({ id: row.id, data: row.data, version: row.version, deleted: row.deleted, updatedAt: row.updated_at }));
  }

  async function syncFromNova({ force = false } = {}) {
    if (!force && Date.now() - lastSync < SYNC_EVERY_MS) return;
    if (syncing) return syncing;
    syncing = (async () => {
      try {
        const { data } = await stateStore.get();
        const projects = Array.isArray(data?.projects) ? data.projects : [];
        await db.tx(async (tx) => {
          await tx.query("LOCK TABLE tournages IN SHARE ROW EXCLUSIVE MODE");
          const { creates, updates } = planNovaSync(projects, await readDocs(tx), { now: now() });
          for (const doc of creates) {
            await tx.query("INSERT INTO tournages (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING", [doc.id, JSON.stringify(doc.data)]);
          }
          for (const { id, patch } of updates) {
            const [row] = await tx.query("SELECT data FROM tournages WHERE id = $1", [id]);
            if (!row) continue;
            await tx.query("UPDATE tournages SET data = $2::jsonb, version = version + 1, updated_at = now() WHERE id = $1", [id, JSON.stringify(deepMerge(row.data, patch))]);
          }
        });
      } catch (error) {
        logger.error?.("Synchro Nova+ → tournages impossible :", error.message);
      } finally {
        lastSync = Date.now(); // même en cas d'échec : pas de nouvel essai avant une minute
        syncing = null;
      }
    })();
    return syncing;
  }

  function revision(docs) {
    let top = "";
    for (const doc of docs) {
      const stamp = new Date(doc.updatedAt).toISOString();
      if (stamp > top) top = stamp;
    }
    return `${docs.length}:${top}`;
  }

  async function body(request, limit) {
    return readJsonBody(request, limit);
  }

  function sendPage(response, key) {
    if (!fs.existsSync(PAGE_FILE)) return sendJson(response, { error: "Page absente." }, 500);
    const html = fs
      .readFileSync(PAGE_FILE, "utf8")
      .replace("__MANIFEST__", `/tournages/manifest.webmanifest?k=${encodeURIComponent(key)}`);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    response.end(html);
  }

  function sendLinkError(response, status) {
    response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tournages</title>` +
        `<body style="font:16px -apple-system,system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f;display:grid;place-items:center;min-height:90vh;margin:0;padding:24px;text-align:center">` +
        `<div><h1 style="font-size:24px;letter-spacing:-.03em;margin:0 0 8px">Lien incomplet</h1><p style="color:#6e6e73;margin:0">Redemande le lien du suivi des tournages à Anis (Pixtyse).</p></div>`,
    );
  }

  async function handle({ request, response, pathname, method, url, ip }) {
    if (pathname !== "/tournages" && !pathname.startsWith("/tournages/") && !pathname.startsWith("/api/tournages")) return false;

    // ---------- Page, manifeste, icônes ----------
    if (ICONS[pathname] && method === "GET") {
      const file = path.join(path.dirname(PAGE_FILE), ICONS[pathname]);
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      fs.createReadStream(file).pipe(response);
      return true;
    }
    if ((pathname === "/tournages" || pathname === "/tournages/") && method === "GET") {
      const key = url.searchParams.get("k") || "";
      if (!env.NOVA_TOURNAGES_KEY) return sendLinkError(response, 503), true;
      try {
        guard(request, ip, key);
      } catch (error) {
        if (error.status === 429) throw error;
        return sendLinkError(response, 401), true;
      }
      sendPage(response, key);
      return true;
    }
    if (pathname === "/tournages/manifest.webmanifest" && method === "GET") {
      const key = url.searchParams.get("k") || "";
      guard(request, ip, key);
      response.writeHead(200, { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(
        JSON.stringify({
          name: "Tournages HSM × Pixtyse",
          short_name: "Tournages",
          start_url: `/tournages?k=${encodeURIComponent(key)}`,
          scope: "/tournages",
          display: "standalone",
          background_color: "#f5f5f7",
          theme_color: "#000000",
          icons: [
            { src: "/tournages/icon-180.png", sizes: "180x180", type: "image/png" },
            { src: "/tournages/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          ],
        }),
      );
      return true;
    }
    if (pathname.startsWith("/tournages/photo/") && method === "GET") {
      guard(request, ip, url.searchParams.get("k") || "");
      const key = decodeURIComponent(pathname.slice("/tournages/photo/".length));
      const filePath = PHOTO_KEY.test(key) ? fileStore.resolve(key) : null;
      if (!filePath) throw httpError(404, "Photo introuvable.");
      const extension = path.extname(filePath).toLowerCase();
      const type = { ".png": "image/png", ".webp": "image/webp" }[extension] || "image/jpeg";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" });
      fs.createReadStream(filePath).pipe(response);
      return true;
    }
    if (!pathname.startsWith("/api/tournages")) throw httpError(404, "Introuvable.");

    // ---------- API (clé dans l'en-tête) ----------
    guard(request, ip, request.headers["x-tournages-key"]);
    const origin = request.headers.origin;
    if (method !== "GET" && origin) {
      const host = String(request.headers["x-forwarded-host"] || request.headers.host || "");
      let sameHost = false;
      try { sameHost = new URL(origin).host === host; } catch { sameHost = false; }
      if (!sameHost) throw httpError(403, "Requête refusée (origine différente).");
    }

    if (pathname === "/api/tournages" && method === "GET") {
      await syncFromNova();
      const docs = (await readDocs()).filter((doc) => !doc.deleted);
      const rev = revision(docs);
      if (url.searchParams.get("rev") === rev) return sendJson(response, { rev, same: true }), true;
      sendJson(response, { rev, docs: docs.map((doc) => ({ id: doc.id, data: doc.data })) });
      return true;
    }

    if (pathname === "/api/tournages/photos" && method === "POST") {
      const payload = await body(request, 12 * 1024 * 1024);
      const type = String(payload.type || "image/jpeg");
      const extension = { "image/png": ".png", "image/webp": ".webp" }[type] || ".jpg";
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(payload.dataUrl || ""))) throw httpError(415, "Seules les photos sont acceptées.");
      const stored = await fileStore.store({ name: `tournage-photo${extension}`, type, dataUrl: payload.dataUrl }, { user: null, ip });
      const key = String(stored.url || "").replace(/^\/uploads\//, "");
      if (!key || !PHOTO_KEY.test(key)) throw httpError(500, "Photo mal enregistrée.");
      sendJson(response, { id: key, url: `/tournages/photo/${encodeURIComponent(key)}` });
      return true;
    }

    const match = pathname.match(/^\/api\/tournages\/([^/]+)$/);
    if (!match) throw httpError(404, "Introuvable.");
    const id = decodeURIComponent(match[1]);
    if (!DOC_ID.test(id)) throw httpError(400, "Identifiant invalide.");

    if (method === "PUT") {
      const { data } = await body(request, 512 * 1024);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw httpError(400, "Données invalides.");
      await db.query(
        `INSERT INTO tournages (id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, deleted = false, version = tournages.version + 1, updated_at = now()`,
        [id, JSON.stringify(data)],
      );
      sendJson(response, { ok: true });
      return true;
    }
    if (method === "PATCH") {
      const { patch } = await body(request, 512 * 1024);
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw httpError(400, "Données invalides.");
      const done = await db.tx(async (tx) => {
        const [row] = await tx.query("SELECT data FROM tournages WHERE id = $1 AND NOT deleted FOR UPDATE", [id]);
        if (!row) return false;
        await tx.query("UPDATE tournages SET data = $2::jsonb, version = version + 1, updated_at = now() WHERE id = $1", [id, JSON.stringify(deepMerge(row.data, patch))]);
        return true;
      });
      if (!done) throw httpError(404, "Chantier introuvable.");
      sendJson(response, { ok: true });
      return true;
    }
    if (method === "DELETE") {
      await db.query("UPDATE tournages SET deleted = true, version = version + 1, updated_at = now() WHERE id = $1", [id]);
      sendJson(response, { ok: true });
      return true;
    }
    throw httpError(405, "Méthode non autorisée.");
  }

  return { handle, syncFromNova, planNovaSync };
}

module.exports = { createTournages, planNovaSync, deepMerge, isWanted };
