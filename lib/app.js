"use strict";

const fs = require("fs");
const path = require("path");
const { createDb } = require("./db");
const { migrate } = require("./migrations");
const { createAuth } = require("./auth");
const { createStateStore } = require("./state-store");
const { createFileStore, INLINE_EXTENSIONS, guessMime } = require("./files");
const { createBackupService } = require("./backup");
const { importStateFile } = require("./json-import");
const { checkPersistentLocation, checkVolumeIdentity } = require("./storage-guard");
const { createCompanyStore, missingFields } = require("./company");
const { createSecretBox, httpError, generateTemporaryPassword, sha256 } = require("./security");
const { createDevisApi } = require("./api-devis");
const { createCrmApi } = require("./api-crm");

const ROOT = path.resolve(__dirname, "..");
const SESSION_COOKIE = "nova_sid";

// Seuls ces fichiers sont servis : jamais le code serveur, les données, node_modules ou .git.
const PUBLIC_FILES = new Set(["/login.html", "/login.css", "/login.js", "/favicon.ico"]);
const APP_FILES = new Set([
  "/index.html",
  "/app.js",
  "/quote-parser.js",
  "/styles.css",
  "/session.js",
  "/admin.html",
  "/admin.css",
  "/admin.js",
  "/guide-utilisation.html",
  "/guide-utilisation-nova-plus.pdf",
  "/devis.html",
  "/devis.css",
  "/devis.js",
  "/devis-quote.js",
  "/devis-catalog.js",
  "/crm.js",
  "/crm.css",
]);
// Fichiers partagés serveur / navigateur, servis depuis lib/.
const SHARED_FILES = { "/pricing.js": "/lib/pricing.js" };

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

async function createApp(config = {}) {
  const env = config.env || process.env;
  const dataDir = path.resolve(config.dataDir || env.DATA_DIR || path.join(ROOT, "data"));
  const uploadDir = path.join(dataDir, "uploads");
  const backupDir = path.resolve(config.backupDir || env.BACKUP_DIR || path.join(dataDir, "backups"));
  const stateFile = path.join(dataDir, "state.json");
  const production = (config.production ?? env.NODE_ENV === "production") === true;
  const logger = config.logger || console;
  fs.mkdirSync(uploadDir, { recursive: true });

  const health = { storage: null, volume: null, database: null, import: null, warnings: [] };

  health.storage = checkPersistentLocation({ dataDir, env });
  if (!health.storage.ok) logger.error(`[stockage] ${health.storage.reason}`);

  const db = config.db || (await createDb({ databaseUrl: env.DATABASE_URL, dataDir, memory: config.memoryDb === true }));
  const applied = await migrate(db);
  health.database = { ok: true, kind: db.kind, migrations: applied };
  if (production && !env.DATABASE_URL) health.warnings.push("DATABASE_URL absente : base PGlite locale utilisée en production.");

  const secretBox = createSecretBox(env.NOVA_SECRET_KEY);
  if (!secretBox.enabled) health.warnings.push("NOVA_SECRET_KEY absente : les secrets 2FA ne sont pas chiffrés en base.");

  const auth = createAuth(db, { secretBox, now: config.now });
  const stateStore = createStateStore(db, { auth });
  const fileStore = createFileStore(db, { uploadDir, auth });
  const backups = createBackupService(db, { backupDir, uploadDir, auth, stateStore });
  const company = createCompanyStore(db, { auth });
  await company.bootstrapName(env.NOVA_COMPANY_NAME);
  const devisHooks = {};
  const devis = createDevisApi({ db, auth, company, stateStore, fileStore, readJsonBody, sendJson, now: config.nowDate, hooks: devisHooks });
  const crmApi = createCrmApi({ db, auth, company, quotes: devis.quotes, readJsonBody, sendJson, env, now: config.nowDate, fetchImpl: config.fetch, logger });
  devisHooks.quoteEvent = crmApi.crm.onQuoteEvent;

  health.volume = await checkVolumeIdentity(db, { dataDir });
  if (!health.volume.ok) logger.error(`[stockage] ${health.volume.reason}`);

  if (health.storage.ok && health.volume.ok && config.skipImport !== true) {
    try {
      health.import = await importStateFile(db, { stateFile, fileStore, auth, apply: true });
      if (health.import.status === "importe") {
        logger.log(`[import] state.json repris dans PostgreSQL : ${health.import.summary.projects} chantiers, empreinte vérifiée.`);
      }
      if (health.import.status !== "absent") await fileStore.inventoryDisk({ source: "inventory" });
    } catch (error) {
      health.import = { status: "erreur", error: error.message };
      logger.error("[import] échec, state.json conservé intact :", error);
    }
  }

  const bootstrapped = await auth.bootstrapAdmin({
    email: env.NOVA_ADMIN_EMAIL,
    password: env.NOVA_ADMIN_PASSWORD,
    displayName: env.NOVA_ADMIN_NAME || "Administrateur",
  });
  if (bootstrapped) logger.log(`[comptes] administrateur initial créé : ${bootstrapped.email} (changement de mot de passe exigé à la 1re connexion).`);
  if ((await auth.countUsers()) === 0) {
    health.warnings.push("Aucun compte : définissez NOVA_ADMIN_EMAIL et NOVA_ADMIN_PASSWORD, ou lancez npm run user:create.");
  }

  const loginLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60 * 1000 });
  const trustProxy = env.NOVA_TRUST_PROXY ? env.NOVA_TRUST_PROXY === "1" : production;

  function clientIp(request) {
    if (trustProxy) {
      const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
      if (forwarded) return forwarded;
    }
    return request.socket.remoteAddress || null;
  }

  function isHttps(request) {
    return production || String(request.headers["x-forwarded-proto"] || "").includes("https");
  }

  function setSessionCookie(request, response, token) {
    const parts = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${7 * 24 * 3600}`];
    if (isHttps(request)) parts.push("Secure");
    response.setHeader("Set-Cookie", parts.join("; "));
  }

  function clearSessionCookie(request, response) {
    const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
    if (isHttps(request)) parts.push("Secure");
    response.setHeader("Set-Cookie", parts.join("; "));
  }

  function healthStatus() {
    const ok = health.storage.ok && health.volume.ok && health.database.ok;
    return { ok, name: "Nova+", checkedAt: new Date().toISOString(), storage: health.storage.ok ? "ok" : health.storage.reason, volume: health.volume.ok ? "ok" : health.volume.reason };
  }

  async function handle(request, response) {
    setSecurityHeaders(response);
    const url = new URL(request.url, "http://nova.local");
    const pathname = url.pathname;
    const method = request.method || "GET";
    const ip = clientIp(request);

    if (pathname === "/api/health") {
      const status = healthStatus();
      return sendJson(response, status, status.ok ? 200 : 503);
    }

    // ---------- Webhooks d'entrée des leads (serveur à serveur, signés ou à clé) ----------
    if (pathname.startsWith("/api/hooks/") && (await crmApi.handlePublic({ request, response, pathname, method, url, ip }))) return;

    if (method !== "GET" && method !== "HEAD" && !sameOrigin(request)) {
      throw httpError(403, "Requête refusée (origine différente).");
    }

    const session = await auth.resolveSession(readCookie(request, SESSION_COOKIE));
    const fullSession = session && session.mfa_verified && !session.user.must_change_password ? session : null;

    // ---------- Authentification ----------
    if (pathname === "/api/auth/login" && method === "POST") {
      if (!loginLimiter.allow(ip)) throw httpError(429, "Trop de tentatives depuis ce poste. Patientez 15 minutes.");
      const body = await readJsonBody(request, 16 * 1024);
      if (session) await auth.logout(session, ip);
      try {
        const result = await auth.login({ email: body.email, password: body.password, ip, userAgent: request.headers["user-agent"] });
        loginLimiter.reset(ip);
        setSessionCookie(request, response, result.token);
        return sendJson(response, { next: result.next, enrollment: result.enrollment, user: { displayName: result.user.displayName, email: result.user.email } });
      } catch (error) {
        loginLimiter.hit(ip);
        throw error;
      }
    }

    if (pathname === "/api/auth/2fa" && method === "POST") {
      if (!session) throw httpError(401, "Session expirée. Reconnectez-vous.", { code: "session_closed" });
      const body = await readJsonBody(request, 4 * 1024);
      try {
        return sendJson(response, await auth.verifyMfa(session, body.code, ip));
      } catch (error) {
        if (error.code === "session_closed") clearSessionCookie(request, response);
        throw error;
      }
    }

    if (pathname === "/api/auth/password" && method === "POST") {
      if (!session || !session.mfa_verified) throw httpError(401, "Session expirée. Reconnectez-vous.");
      const body = await readJsonBody(request, 4 * 1024);
      await auth.changePassword(session, { currentPassword: body.currentPassword, newPassword: body.newPassword }, ip);
      return sendJson(response, { ok: true, next: "done" });
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      await auth.logout(session, ip);
      clearSessionCookie(request, response);
      return sendJson(response, { ok: true });
    }

    if (pathname === "/api/auth/me" && method === "GET") {
      // 200 même sans session : la page de connexion vérifie l'état sans erreur dans la console.
      if (!session) return sendJson(response, { user: null });
      return sendJson(response, {
        user: auth.publicUser(session.user),
        mfaPending: !session.mfa_verified,
        mustChangePassword: session.user.must_change_password,
      });
    }

    // ---------- Identité de l'entreprise (page de connexion, sans session) ----------
    if (pathname === "/api/public/branding" && method === "GET") {
      const profile = await company.get();
      return sendJson(response, { name: profile.name, hasLogo: Boolean(profile.logoKey), logoVersion: profile.logoKey ? sha256(profile.logoKey).slice(0, 12) : null });
    }
    if (pathname === "/api/public/logo" && method === "GET") {
      const profile = await company.get();
      const filePath = profile.logoKey ? fileStore.resolve(profile.logoKey) : null;
      if (!filePath) return sendText(response, "Aucun logo", 404);
      response.writeHead(200, { "Content-Type": guessMime(filePath), "Cache-Control": "public, max-age=300", "Content-Security-Policy": "default-src 'none'; sandbox" });
      return fs.createReadStream(filePath).pipe(response);
    }

    // ---------- Pages publiques ----------
    if (PUBLIC_FILES.has(pathname) && method === "GET") {
      if (pathname === "/login.html" && fullSession) return redirect(response, "/");
      return serveStatic(pathname, response);
    }

    // ---------- Tout le reste exige une session complète ----------
    if (!fullSession) {
      if (pathname.startsWith("/api/")) {
        throw httpError(401, session ? "Finalisez votre connexion." : "Session expirée. Reconnectez-vous.", { code: "auth_required" });
      }
      return redirect(response, "/login.html");
    }
    const user = fullSession.user;

    if (pathname === "/api/state" && method === "GET") {
      const current = await stateStore.get();
      response.setHeader("X-Nova-State-Version", String(current.version));
      response.setHeader("Cache-Control", "no-store");
      return sendJson(response, current.data);
    }

    if (pathname === "/api/state" && method === "PUT") {
      const data = await readJsonBody(request, 40 * 1024 * 1024);
      const header = request.headers["x-nova-state-version"];
      const baseVersion = header === undefined ? NaN : Number(header);
      const result = await stateStore.save({ data, baseVersion, user, ip, allowMassDelete: request.headers["x-nova-allow-mass-delete"] === "1" });
      response.setHeader("X-Nova-State-Version", String(result.version));
      return sendJson(response, { ok: true, ...result });
    }

    if (pathname === "/api/files" && method === "POST") {
      const payload = await readJsonBody(request, 80 * 1024 * 1024);
      return sendJson(response, await fileStore.store(payload, { user, ip }));
    }

    if (pathname.startsWith("/uploads/") && method === "GET") {
      const filePath = fileStore.resolve(pathname.slice("/uploads/".length));
      if (!filePath) return sendText(response, "Document introuvable", 404);
      const extension = path.extname(filePath).toLowerCase();
      const headers = {
        "Content-Type": guessMime(filePath),
        "Content-Disposition": `${INLINE_EXTENSIONS.has(extension) ? "inline" : "attachment"}; filename="${path.basename(filePath).replace(/^\d+-[0-9a-f-]{36}-/, "").replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      };
      // Le lecteur PDF intégré de Chrome ne fonctionne pas sous « sandbox » : la règle stricte vaut pour les autres fichiers.
      if (extension !== ".pdf") headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
      response.writeHead(200, headers);
      return fs.createReadStream(filePath).pipe(response);
    }

    if (pathname === "/api/company" && method === "GET") {
      const profile = await company.get();
      return sendJson(response, { company: profile, missing: missingFields(profile) });
    }

    // ---------- Modules devis (bibliothèque, ST, dossiers, devis) ----------
    if (pathname.startsWith("/api/") && (await devis.handle({ request, response, pathname, method, url, user, ip }))) return;
    // ---------- CRM, objectifs, commissions ----------
    if (pathname.startsWith("/api/") && (await crmApi.handle({ request, response, pathname, method, url, user, ip }))) return;

    // ---------- Administration ----------
    if (pathname.startsWith("/api/admin/")) {
      if (user.role !== "admin") throw httpError(403, "Réservé à l'administrateur.");
      return handleAdmin({ request, response, pathname, method, url, user, ip });
    }

    if (SHARED_FILES[pathname] && method === "GET") return serveStatic(SHARED_FILES[pathname], response);
    if (pathname === "/" || APP_FILES.has(pathname)) {
      // admin.html sert aussi de page « Mon compte » pour tous les rôles ; les API admin restent réservées.
      return serveStatic(pathname === "/" ? "/index.html" : pathname, response);
    }

    return sendText(response, "Introuvable", 404);
  }

  async function handleAdmin({ request, response, pathname, method, url, user, ip }) {
    if (pathname === "/api/admin/users" && method === "GET") {
      const rows = await db.query("SELECT * FROM users ORDER BY active DESC, role, display_name");
      return sendJson(response, { users: rows.map(auth.publicUser), roles: auth.ROLES });
    }
    if (pathname === "/api/admin/users" && method === "POST") {
      const body = await readJsonBody(request, 8 * 1024);
      const temporaryPassword = generateTemporaryPassword();
      const row = await auth.createUser({ ...body, password: temporaryPassword, mustChangePassword: true }, user, ip);
      return sendJson(response, { user: auth.publicUser(row), temporaryPassword }, 201);
    }
    const userMatch = pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})(?:\/(reset-password|reset-2fa|unlock))?$/);
    if (userMatch) {
      const [, id, action] = userMatch;
      if (!action && method === "PATCH") {
        const body = await readJsonBody(request, 8 * 1024);
        if (id === user.id && ((body.role !== undefined && body.role !== "admin") || body.active === false)) {
          throw httpError(409, "Vous ne pouvez pas retirer vos propres droits d'administrateur ni désactiver votre compte.");
        }
        return sendJson(response, { user: auth.publicUser(await auth.updateUser(id, body, user, ip)) });
      }
      if (action === "reset-password" && method === "POST") return sendJson(response, { temporaryPassword: await auth.resetPassword(id, user, ip) });
      if (action === "reset-2fa" && method === "POST") {
        await auth.resetMfa(id, user, ip);
        return sendJson(response, { ok: true });
      }
      if (action === "unlock" && method === "POST") {
        await auth.unlock(id, user, ip);
        return sendJson(response, { ok: true });
      }
    }
    if (pathname === "/api/admin/company" && method === "PUT") {
      const body = await readJsonBody(request, 64 * 1024);
      delete body.logoKey; // le logo passe par sa route dédiée
      const saved = await company.save(body, { user, ip });
      return sendJson(response, { company: saved, missing: missingFields(saved) });
    }
    if (pathname === "/api/admin/company/logo" && method === "POST") {
      const body = await readJsonBody(request, 4 * 1024 * 1024);
      if (body.remove === true) {
        const saved = await company.save({ logoKey: null }, { user, ip, action: "company.logo_removed" });
        return sendJson(response, { company: saved, missing: missingFields(saved) });
      }
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(String(body.dataUrl || ""))) {
        throw httpError(415, "Logo au format PNG, JPG ou WebP (2 Mo maximum).");
      }
      const base64 = String(body.dataUrl).split(",")[1] || "";
      if (Math.floor((base64.length * 3) / 4) > 2 * 1024 * 1024) throw httpError(413, "Logo trop lourd (2 Mo maximum).");
      const mime = String(body.dataUrl).slice(5).split(";")[0];
      const extension = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" }[mime];
      const head = Buffer.from(base64.slice(0, 24), "base64");
      const signatureOk = {
        ".png": head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
        ".jpg": head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
        ".webp": head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP",
      }[extension];
      if (!signatureOk) throw httpError(415, "Ce fichier n'est pas une image valide.");
      const stored = await fileStore.store({ name: `logo-entreprise${extension}`, type: mime, dataUrl: body.dataUrl }, { user, ip });
      const saved = await company.save({ logoKey: stored.url.split("/").pop() }, { user, ip, action: "company.logo_updated" });
      return sendJson(response, { company: saved, missing: missingFields(saved) });
    }
    if (pathname === "/api/admin/audit" && method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 1000);
      const action = url.searchParams.get("action");
      const rows = action
        ? await db.query("SELECT * FROM audit_log WHERE action LIKE $1 ORDER BY id DESC LIMIT $2", [`${action}%`, limit])
        : await db.query("SELECT * FROM audit_log ORDER BY id DESC LIMIT $1", [limit]);
      return sendJson(response, { entries: rows });
    }
    if (pathname === "/api/admin/backups" && method === "GET") {
      const [lastTest] = await db.query("SELECT value FROM meta WHERE key = 'last_restore_test'");
      return sendJson(response, { backups: backups.list(), lastRestoreTest: lastTest?.value || null, backupDir });
    }
    if (pathname === "/api/admin/backups" && method === "POST") {
      return sendJson(response, await backups.create({ kind: "manuel", user, ip }), 201);
    }
    const backupMatch = pathname.match(/^\/api\/admin\/backups\/([^/]+?)(\/restore-test)?$/);
    if (backupMatch) {
      const name = decodeURIComponent(backupMatch[1]);
      if (backupMatch[2] && method === "POST") return sendJson(response, await backups.restoreTest(name, { user, ip }));
      if (!backupMatch[2] && method === "GET") {
        const filePath = backups.resolveName(name);
        await auth.audit({ user, action: "backup.download", entity: "backup", entityId: name, ip });
        response.writeHead(200, { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" });
        return fs.createReadStream(filePath).pipe(response);
      }
    }
    if (pathname === "/api/admin/files/check" && method === "GET") {
      const current = await stateStore.get();
      const report = await fileStore.check(current.data);
      await auth.audit({ user, action: "files.check", details: { ok: report.ok, missing: report.missing.length, brokenLinks: report.brokenLinks.length }, ip });
      return sendJson(response, report);
    }
    if (pathname === "/api/admin/state/history" && method === "GET") {
      return sendJson(response, { versions: await stateStore.history({ limit: url.searchParams.get("limit") }) });
    }
    const restoreMatch = pathname.match(/^\/api\/admin\/state\/history\/(\d+)\/restore$/);
    if (restoreMatch && method === "POST") {
      return sendJson(response, await stateStore.restoreFromHistory(Number(restoreMatch[1]), { user, ip }));
    }
    if (pathname === "/api/admin/status" && method === "GET") {
      const fingerprint = await stateStore.fingerprint();
      const [{ n: files }] = await db.query("SELECT count(*)::int AS n FROM files");
      const [importMeta] = await db.query("SELECT value FROM meta WHERE key = 'json_import'");
      const profile = await company.get();
      return sendJson(response, {
        health: healthStatus(),
        database: db.kind,
        warnings: health.warnings,
        state: { version: fingerprint.version, ...fingerprint.summary },
        files,
        jsonImport: importMeta?.value || null,
        lastBackup: backups.list()[0] || null,
        companyMissing: missingFields(profile),
      });
    }
    throw httpError(404, "Action d'administration inconnue.");
  }

  async function handler(request, response) {
    try {
      await handle(request, response);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) logger.error(error);
      if (response.headersSent) return response.end();
      const payload = { error: status >= 500 && !error.status ? "Erreur serveur. Vos données n'ont pas été modifiées." : error.message };
      if (error.code) payload.code = error.code;
      if (error.currentVersion !== undefined) payload.currentVersion = error.currentVersion;
      sendJson(response, payload, status);
    }
  }

  let stopSchedule = null;
  return {
    handler,
    db,
    auth,
    stateStore,
    fileStore,
    backups,
    company,
    devis,
    health,
    dataDir,
    uploadDir,
    backupDir,
    startBackgroundJobs() {
      stopSchedule = backups.schedule({ logger });
      const purge = setInterval(() => auth.purgeExpiredSessions().catch(() => {}), 3600 * 1000);
      purge.unref();
    },
    async close() {
      if (stopSchedule) stopSchedule();
      await db.close();
    },
  };
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true; // Requêtes sans navigateur (scripts, tests) : protégées par le cookie SameSite.
  try {
    const host = String(request.headers["x-forwarded-host"] || request.headers.host || "");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function readCookie(request, name) {
  const header = String(request.headers.cookie || "");
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    allow(key) {
      const entry = hits.get(key);
      if (!entry || entry.until < Date.now()) return true;
      return entry.count < max;
    },
    hit(key) {
      const entry = hits.get(key);
      if (!entry || entry.until < Date.now()) hits.set(key, { count: 1, until: Date.now() + windowMs });
      else entry.count += 1;
      if (hits.size > 5000) hits.clear();
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

function serveStatic(pathname, response) {
  const filePath = path.join(ROOT, pathname);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return sendText(response, "Introuvable", 404);
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Cache-Control": extension === ".html" ? "no-store" : "no-cache",
  });
  fs.createReadStream(filePath).pipe(response);
}

function redirect(response, location) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

function readJsonBody(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, "Envoi trop volumineux."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        resolve(value);
      } catch {
        reject(httpError(400, "Données JSON invalides."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function sendText(response, text, status = 200) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

module.exports = { createApp, SESSION_COOKIE, PUBLIC_FILES, APP_FILES };
