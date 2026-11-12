"use strict";

// Sous-traitants et grilles de prix (module 2). Une grille = un ST + une période + des prix par ouvrage.
// Cycle : brouillon → envoyée (PDF à signer) → signée (non modifiable) ; à la date de fin → expirée.
// Un changement de prix = une nouvelle version ; la version signée la plus récente remplace les autres.

const { httpError } = require("./security");
const permissions = require("./permissions");

const REQUIRED_DOCUMENTS = ["decennale", "kbis", "urssaf"];
const DOCUMENT_LABELS = { decennale: "Attestation décennale", kbis: "Extrait Kbis", urssaf: "Attestation de vigilance URSSAF", rc_pro: "Attestation RC pro", autre: "Autre document" };
// Durée de validité par défaut quand la date n'est pas indiquée sur le document.
const DEFAULT_VALIDITY_MONTHS = { urssaf: 6, kbis: 3 };

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const isoDate = (value) => (value ? String(value).slice(0, 10) : null);
const todayIso = () => new Date().toISOString().slice(0, 10);

function addMonths(iso, months) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}
function daysBetween(fromIso, toIso) {
  return Math.round((new Date(`${toIso}T12:00:00Z`) - new Date(`${fromIso}T12:00:00Z`)) / 86400000);
}

function documentsStatus(documents, today = todayIso()) {
  const latest = {};
  for (const doc of documents) {
    if (!latest[doc.kind] || String(doc.expiresOn || "") > String(latest[doc.kind].expiresOn || "")) latest[doc.kind] = doc;
  }
  const issues = [];
  for (const kind of REQUIRED_DOCUMENTS) {
    const doc = latest[kind];
    if (!doc) issues.push({ kind, level: "missing", message: `${DOCUMENT_LABELS[kind]} manquante` });
    else if (doc.expiresOn && doc.expiresOn < today) issues.push({ kind, level: "expired", message: `${DOCUMENT_LABELS[kind]} expirée le ${doc.expiresOn}` });
    else if (doc.expiresOn && daysBetween(today, doc.expiresOn) <= 30) issues.push({ kind, level: "expiring", message: `${DOCUMENT_LABELS[kind]} expire le ${doc.expiresOn}` });
  }
  const blocking = issues.filter((issue) => issue.level !== "expiring");
  return { ok: blocking.length === 0, blocked: blocking.length > 0, issues, latest };
}

function gridStatus(grid, today = todayIso()) {
  if (grid.status === "signed" && grid.endsOn < today) return "expired";
  if (grid.status === "signed" && grid.startsOn > today) return "upcoming";
  return grid.status;
}

const STATUS_LABELS = { draft: "Brouillon", sent: "Envoyée", signed: "Signée", replaced: "Remplacée", expired: "Expirée", upcoming: "Signée (à venir)" };

const stOut = (row) => ({
  id: row.id,
  legacyId: row.legacy_id,
  name: row.name,
  siret: row.siret,
  address: row.address,
  lots: row.lots || [],
  contactName: row.contact_name,
  phone: row.phone,
  email: row.email,
  notes: row.notes,
  active: row.active,
});
const docOut = (row) => ({ id: row.id, kind: row.kind, kindLabel: DOCUMENT_LABELS[row.kind], label: row.label, url: row.file_key ? `/uploads/${row.file_key}` : null, expiresOn: isoDate(row.expires_on), uploadedAt: row.uploaded_at });
const gridOut = (row, today) => {
  const grid = {
    id: row.id,
    subcontractorId: row.subcontractor_id,
    subcontractorName: row.st_name,
    version: row.version,
    startsOn: isoDate(row.starts_on),
    endsOn: isoDate(row.ends_on),
    status: row.status,
    sentAt: row.sent_at,
    signedAt: row.signed_at,
    signedUrl: row.signed_file_key ? `/uploads/${row.signed_file_key}` : null,
    notes: row.notes,
    linesCount: row.lines_count ?? undefined,
  };
  grid.displayStatus = gridStatus(grid, today);
  grid.statusLabel = STATUS_LABELS[grid.displayStatus];
  return grid;
};

function createSubcontractors(db, { auth, fileStore, stateStore }) {
  // Reprend une seule fois chaque sous-traitant saisi dans l'application chantiers (jamais modifiée).
  async function syncLegacy() {
    if (!stateStore) return 0;
    const { data } = await stateStore.get();
    const legacy = Array.isArray(data?.subcontractors) ? data.subcontractors : [];
    let created = 0;
    for (const st of legacy) {
      if (!st?.id || !text(st.companyName)) continue;
      const rows = await db.query(
        `INSERT INTO subcontractors (legacy_id, name, lots) VALUES ($1, $2, $3) ON CONFLICT (legacy_id) DO NOTHING RETURNING id`,
        [String(st.id), text(st.companyName, 120), st.trade ? [text(st.trade, 60)] : []],
      );
      created += rows.length;
    }
    return created;
  }

  async function documentsFor(ids) {
    if (!ids.length) return new Map();
    const rows = await db.query("SELECT * FROM subcontractor_documents WHERE subcontractor_id = ANY($1::uuid[]) ORDER BY expires_on DESC NULLS LAST", [ids]);
    const map = new Map(ids.map((id) => [id, []]));
    rows.forEach((row) => map.get(row.subcontractor_id).push(docOut(row)));
    return map;
  }

  async function list({ includeInactive = false } = {}) {
    await syncLegacy();
    const rows = await db.query(`SELECT * FROM subcontractors ${includeInactive ? "" : "WHERE active"} ORDER BY name`);
    const docs = await documentsFor(rows.map((row) => row.id));
    const grids = await db.query(
      `SELECT g.*, (SELECT count(*)::int FROM price_grid_lines l WHERE l.grid_id = g.id) AS lines_count FROM price_grids g ORDER BY g.version DESC`,
    );
    const today = todayIso();
    return rows.map((row) => {
      const st = stOut(row);
      st.documents = docs.get(row.id);
      st.compliance = documentsStatus(st.documents, today);
      const own = grids.filter((grid) => grid.subcontractor_id === row.id).map((grid) => gridOut(grid, today));
      st.activeGrid = own.find((grid) => grid.displayStatus === "signed") || null;
      st.gridsCount = own.length;
      return st;
    });
  }

  async function get(id) {
    const [row] = await db.query("SELECT * FROM subcontractors WHERE id = $1", [id]);
    if (!row) throw httpError(404, "Sous-traitant introuvable.");
    const st = stOut(row);
    st.documents = (await documentsFor([id])).get(id);
    st.compliance = documentsStatus(st.documents);
    st.grids = await listGrids({ subcontractorId: id });
    return st;
  }

  async function save(input, { user, ip }) {
    permissions.require(user, "st.write");
    const name = text(input.name, 120);
    if (!name) throw httpError(400, "Raison sociale obligatoire.");
    const siret = text(input.siret, 20).replace(/\s/g, "");
    if (siret && !/^\d{14}$/.test(siret)) throw httpError(400, "Le SIRET contient 14 chiffres.");
    const email = text(input.email, 160);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Adresse e-mail invalide.");
    const lots = (Array.isArray(input.lots) ? input.lots : String(input.lots || "").split(/[,;]/)).map((lot) => text(lot, 60)).filter(Boolean).slice(0, 30);
    const values = [name, siret, text(input.address, 300), lots, text(input.contactName, 120), text(input.phone, 30), email, text(input.notes, 2000), input.active !== false];
    const [row] = input.id
      ? await db.query(
          `UPDATE subcontractors SET name = $1, siret = $2, address = $3, lots = $4, contact_name = $5, phone = $6, email = $7, notes = $8, active = $9, updated_at = now() WHERE id = $10 RETURNING *`,
          [...values, input.id],
        )
      : await db.query(
          `INSERT INTO subcontractors (name, siret, address, lots, contact_name, phone, email, notes, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          values,
        );
    if (!row) throw httpError(404, "Sous-traitant introuvable.");
    await auth.audit({ user, action: input.id ? "st.update" : "st.create", entity: "subcontractor", entityId: row.id, details: { name }, ip });
    return get(row.id);
  }

  async function addDocument(subcontractorId, input, { user, ip }) {
    permissions.require(user, "st.write");
    await get(subcontractorId);
    const kind = DOCUMENT_LABELS[input.kind] ? input.kind : null;
    if (!kind) throw httpError(400, "Type de document inconnu.");
    let expiresOn = isoDate(input.expiresOn);
    if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw httpError(400, "Date d'expiration invalide.");
    if (!expiresOn && DEFAULT_VALIDITY_MONTHS[kind]) expiresOn = addMonths(todayIso(), DEFAULT_VALIDITY_MONTHS[kind]);
    if (!expiresOn && kind !== "autre") throw httpError(400, "Indiquez la date de fin de validité du document.");
    let fileKey = null;
    if (input.file?.dataUrl) {
      const stored = await fileStore.store({ name: input.file.name || `${kind}.pdf`, type: input.file.type, dataUrl: input.file.dataUrl }, { user, ip });
      fileKey = stored.url.split("/").pop();
    }
    const [row] = await db.query(
      `INSERT INTO subcontractor_documents (subcontractor_id, kind, label, file_key, expires_on, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [subcontractorId, kind, text(input.label, 120) || DOCUMENT_LABELS[kind], fileKey, expiresOn, user?.id || null],
    );
    await auth.audit({ user, action: "st.document_add", entity: "subcontractor", entityId: subcontractorId, details: { kind, expiresOn }, ip });
    return docOut(row);
  }

  async function removeDocument(documentId, { user, ip }) {
    permissions.require(user, "st.write");
    const [row] = await db.query("DELETE FROM subcontractor_documents WHERE id = $1 RETURNING subcontractor_id, kind", [documentId]);
    if (!row) throw httpError(404, "Document introuvable.");
    await auth.audit({ user, action: "st.document_remove", entity: "subcontractor", entityId: row.subcontractor_id, details: { kind: row.kind }, ip });
    return { ok: true };
  }

  // ---------- Grilles ----------

  async function listGrids({ subcontractorId = null } = {}) {
    const rows = await db.query(
      `SELECT g.*, s.name AS st_name, (SELECT count(*)::int FROM price_grid_lines l WHERE l.grid_id = g.id) AS lines_count
       FROM price_grids g JOIN subcontractors s ON s.id = g.subcontractor_id
       ${subcontractorId ? "WHERE g.subcontractor_id = $1" : ""} ORDER BY s.name, g.version DESC`,
      subcontractorId ? [subcontractorId] : [],
    );
    const today = todayIso();
    return rows.map((row) => gridOut(row, today));
  }

  async function getGrid(id) {
    const [row] = await db.query(`SELECT g.*, s.name AS st_name FROM price_grids g JOIN subcontractors s ON s.id = g.subcontractor_id WHERE g.id = $1`, [id]);
    if (!row) throw httpError(404, "Grille introuvable.");
    const grid = gridOut(row, todayIso());
    const lines = await db.query(
      `SELECT gl.*, i.code, i.label, i.unit, i.description, l.name AS lot_name, l.position AS lot_position
       FROM price_grid_lines gl JOIN library_items i ON i.id = gl.item_id JOIN library_lots l ON l.id = i.lot_id
       WHERE gl.grid_id = $1 ORDER BY l.position, l.name, i.code`,
      [id],
    );
    grid.lines = lines.map((line) => ({ itemId: line.item_id, code: line.code, label: line.label, description: line.description, unit: line.unit, lotName: line.lot_name, laborPrice: line.labor_price, supplyIncluded: line.supply_included, supplyPrice: line.supply_price }));
    grid.events = await db.query("SELECT event, recipient, method, at, details FROM signature_events WHERE document_type = 'grid' AND document_id = $1 ORDER BY at", [id]);
    return grid;
  }

  function cleanLines(lines) {
    if (!Array.isArray(lines)) throw httpError(400, "Lignes de grille manquantes.");
    const seen = new Set();
    return lines.map((line, index) => {
      if (!line.itemId) throw httpError(400, `Ligne ${index + 1} : ouvrage manquant.`);
      if (seen.has(line.itemId)) throw httpError(400, `Ligne ${index + 1} : ouvrage présent deux fois.`);
      seen.add(line.itemId);
      const laborPrice = Number(String(line.laborPrice ?? "").replace(",", "."));
      if (!Number.isFinite(laborPrice) || laborPrice < 0) throw httpError(400, `Ligne ${index + 1} : prix main-d'œuvre invalide.`);
      const supplyRaw = line.supplyPrice === "" || line.supplyPrice === null || line.supplyPrice === undefined ? null : Number(String(line.supplyPrice).replace(",", "."));
      if (supplyRaw !== null && (!Number.isFinite(supplyRaw) || supplyRaw < 0)) throw httpError(400, `Ligne ${index + 1} : prix fourniture invalide.`);
      return { itemId: line.itemId, laborPrice: Math.round(laborPrice * 100) / 100, supplyIncluded: line.supplyIncluded === true, supplyPrice: supplyRaw === null ? null : Math.round(supplyRaw * 100) / 100 };
    });
  }

  function cleanPeriod(input) {
    const startsOn = isoDate(input.startsOn);
    const endsOn = isoDate(input.endsOn);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn || "") || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn || "")) throw httpError(400, "Indiquez la période de la grille (début et fin).");
    if (endsOn < startsOn) throw httpError(400, "La fin de la période précède son début.");
    return { startsOn, endsOn };
  }

  async function writeLines(tx, gridId, lines) {
    await tx.query("DELETE FROM price_grid_lines WHERE grid_id = $1", [gridId]);
    for (const line of lines) {
      await tx.query("INSERT INTO price_grid_lines (grid_id, item_id, labor_price, supply_included, supply_price) VALUES ($1, $2, $3, $4, $5)", [gridId, line.itemId, line.laborPrice, line.supplyIncluded, line.supplyPrice]);
    }
  }

  async function createGrid(input, { user, ip }) {
    permissions.require(user, "st.write");
    await get(input.subcontractorId);
    const { startsOn, endsOn } = cleanPeriod(input);
    const lines = cleanLines(input.lines || []);
    const id = await db.tx(async (tx) => {
      const [{ next }] = await tx.query("SELECT COALESCE(max(version), 0) + 1 AS next FROM price_grids WHERE subcontractor_id = $1", [input.subcontractorId]);
      const [row] = await tx.query(
        `INSERT INTO price_grids (subcontractor_id, version, starts_on, ends_on, notes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [input.subcontractorId, next, startsOn, endsOn, text(input.notes, 2000), user?.id || null],
      );
      await writeLines(tx, row.id, lines);
      return row.id;
    });
    await auth.audit({ user, action: "grid.create", entity: "price_grid", entityId: id, details: { subcontractorId: input.subcontractorId, lines: lines.length }, ip });
    return getGrid(id);
  }

  async function updateGrid(id, input, { user, ip }) {
    permissions.require(user, "st.write");
    const grid = await getGrid(id);
    if (!["draft", "sent"].includes(grid.status)) throw httpError(409, "Grille signée : non modifiable. Créez une nouvelle version pour changer un prix.");
    const { startsOn, endsOn } = cleanPeriod({ startsOn: input.startsOn ?? grid.startsOn, endsOn: input.endsOn ?? grid.endsOn });
    const lines = input.lines ? cleanLines(input.lines) : null;
    await db.tx(async (tx) => {
      // Une grille envoyée puis modifiée redevient un brouillon : le PDF envoyé n'est plus à jour.
      await tx.query("UPDATE price_grids SET starts_on = $2, ends_on = $3, notes = $4, status = 'draft', updated_at = now() WHERE id = $1", [id, startsOn, endsOn, text(input.notes ?? grid.notes, 2000)]);
      if (lines) await writeLines(tx, id, lines);
    });
    await auth.audit({ user, action: "grid.update", entity: "price_grid", entityId: id, details: { lines: lines?.length }, ip });
    return getGrid(id);
  }

  async function markSent(id, { user, ip, recipient, documentHash }) {
    permissions.require(user, "st.write");
    const grid = await getGrid(id);
    if (!["draft", "sent"].includes(grid.status)) throw httpError(409, "Grille déjà signée.");
    if (!grid.lines.length) throw httpError(400, "La grille ne contient aucun ouvrage.");
    await db.query("UPDATE price_grids SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = $1", [id]);
    await db.query("INSERT INTO signature_events (document_type, document_id, event, recipient, method, document_sha256, user_id, ip) VALUES ('grid', $1, 'sent', $2, 'pdf', $3, $4, $5)", [id, recipient || null, documentHash || null, user?.id || null, ip]);
    await auth.audit({ user, action: "grid.sent", entity: "price_grid", entityId: id, ip });
    return getGrid(id);
  }

  async function uploadSigned(id, file, { user, ip }) {
    permissions.require(user, "st.write");
    const grid = await getGrid(id);
    if (grid.status === "signed" || grid.status === "replaced") throw httpError(409, "Cette grille est déjà signée.");
    if (!grid.lines.length) throw httpError(400, "La grille ne contient aucun ouvrage.");
    if (!file?.dataUrl) throw httpError(400, "Joignez le PDF signé par le sous-traitant.");
    const stored = await fileStore.store({ name: file.name || `grille-signee-v${grid.version}.pdf`, type: file.type, dataUrl: file.dataUrl }, { user, ip });
    const key = stored.url.split("/").pop();
    await db.tx(async (tx) => {
      await tx.query("UPDATE price_grids SET status = 'signed', signed_at = now(), signed_file_key = $2, updated_at = now() WHERE id = $1", [id, key]);
      // Les versions signées antérieures dont la période chevauche celle-ci sont remplacées.
      await tx.query(
        `UPDATE price_grids SET status = 'replaced', updated_at = now()
         WHERE subcontractor_id = $1 AND id <> $2 AND status = 'signed' AND version < $3 AND starts_on <= $5 AND ends_on >= $4`,
        [grid.subcontractorId, id, grid.version, grid.startsOn, grid.endsOn],
      );
      await tx.query("INSERT INTO signature_events (document_type, document_id, event, method, document_sha256, user_id, ip) VALUES ('grid', $1, 'signed', 'upload', $2, $3, $4)", [id, stored.sha256 || null, user?.id || null, ip]);
    });
    await auth.audit({ user, action: "grid.signed", entity: "price_grid", entityId: id, details: { version: grid.version }, ip });
    return getGrid(id);
  }

  async function newVersion(id, { user, ip }) {
    const grid = await getGrid(id);
    const startsOn = todayIso() > grid.startsOn ? todayIso() : grid.startsOn;
    return createGrid({ subcontractorId: grid.subcontractorId, startsOn, endsOn: grid.endsOn < startsOn ? addMonths(startsOn, 12) : grid.endsOn, notes: grid.notes, lines: grid.lines }, { user, ip });
  }

  // Prix ST validés pour des ouvrages à une date : grille signée en cours, sinon dernière grille signée expirée.
  async function priceLookup(subcontractorId, itemIds, date = todayIso()) {
    if (!subcontractorId || !itemIds.length) return new Map();
    const rows = await db.query(
      `SELECT gl.item_id, gl.labor_price, gl.supply_included, gl.supply_price, g.id AS grid_id, g.version, g.starts_on, g.ends_on
       FROM price_grid_lines gl JOIN price_grids g ON g.id = gl.grid_id
       WHERE g.subcontractor_id = $1 AND g.status = 'signed' AND gl.item_id = ANY($2::uuid[]) AND g.starts_on <= $3
       ORDER BY (g.ends_on >= $3) DESC, g.version DESC`,
      [subcontractorId, itemIds, date],
    );
    const map = new Map();
    for (const row of rows) {
      if (map.has(row.item_id)) continue;
      map.set(row.item_id, { gridId: row.grid_id, version: row.version, laborPrice: row.labor_price, supplyIncluded: row.supply_included, supplyPrice: row.supply_price, endsOn: isoDate(row.ends_on), expired: isoDate(row.ends_on) < date });
    }
    return map;
  }

  // Vue comparative : pour un ouvrage, les prix de tous les ST côte à côte.
  async function compare(itemId) {
    const today = todayIso();
    const rows = await db.query(
      `SELECT s.id AS st_id, s.name, g.id AS grid_id, g.version, g.status, g.starts_on, g.ends_on, gl.labor_price, gl.supply_included, gl.supply_price
       FROM price_grid_lines gl JOIN price_grids g ON g.id = gl.grid_id JOIN subcontractors s ON s.id = g.subcontractor_id
       WHERE gl.item_id = $1 AND s.active AND g.status IN ('draft', 'sent', 'signed')
       ORDER BY s.name, g.version DESC`,
      [itemId],
    );
    const bySt = new Map();
    for (const row of rows) {
      const grid = { status: row.status, startsOn: isoDate(row.starts_on), endsOn: isoDate(row.ends_on) };
      const status = gridStatus(grid, today);
      const entry = bySt.get(row.st_id) || { subcontractorId: row.st_id, name: row.name, signed: null, pending: null };
      const price = { gridId: row.grid_id, version: row.version, status, statusLabel: STATUS_LABELS[status], laborPrice: row.labor_price, supplyIncluded: row.supply_included, supplyPrice: row.supply_price, endsOn: grid.endsOn };
      if (row.status === "signed" && !entry.signed && status !== "upcoming") entry.signed = price;
      if (row.status !== "signed" && !entry.pending) entry.pending = price;
      bySt.set(row.st_id, entry);
    }
    const list = [...bySt.values()];
    const valid = list.filter((entry) => entry.signed && entry.signed.status === "signed").map((entry) => entry.signed.laborPrice);
    const best = valid.length ? Math.min(...valid) : null;
    list.forEach((entry) => (entry.best = best !== null && entry.signed?.status === "signed" && entry.signed.laborPrice === best));
    return list.sort((a, b) => (a.signed?.laborPrice ?? Infinity) - (b.signed?.laborPrice ?? Infinity));
  }

  async function compliance(subcontractorId) {
    const docs = (await documentsFor([subcontractorId])).get(subcontractorId) || [];
    return documentsStatus(docs);
  }

  return { list, get, save, addDocument, removeDocument, listGrids, getGrid, createGrid, updateGrid, markSent, uploadSigned, newVersion, priceLookup, compare, compliance, syncLegacy };
}

module.exports = { createSubcontractors, documentsStatus, gridStatus, REQUIRED_DOCUMENTS, DOCUMENT_LABELS, STATUS_LABELS };
