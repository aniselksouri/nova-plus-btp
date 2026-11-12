"use strict";

// Sauvegardes logiques de la base Nova+ (indépendantes du moteur PostgreSQL utilisé) :
// - un fichier .json.gz par sauvegarde, avec l'inventaire des pièces jointes ;
// - sauvegarde automatique quotidienne, 30 conservées ;
// - test de restauration : la sauvegarde est rejouée dans un schéma temporaire, comparée,
//   puis la transaction est annulée (aucune trace laissée dans la base de production).

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { canonicalHash, httpError } = require("./security");
const { SCHEMA_VERSION, applySchemaInTransaction } = require("./migrations");

// Ordre d'insertion compatible avec les clés étrangères.
const TABLES = [
  "meta", "users", "company_settings", "app_state", "files", "audit_log",
  "sequences", "library_lots", "library_items", "subcontractors", "subcontractor_documents",
  "price_grids", "price_grid_lines", "dossiers", "quotes", "quote_lines", "purchase_orders",
  "signature_events", "receptions",
  "crm_settings", "leads", "lead_events", "lead_tasks", "fixed_costs", "sales_objectives", "bonus_tiers",
];
const SEQUENCES = { audit_log: "id", signature_events: "id", lead_events: "id" };
const AUTO_KEEP = 30;
const MANUAL_KEEP = 20;
const NAME_PATTERN = /^nova-(auto|manuel|avant-restauration)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(-[a-z0-9]{6})?\.json\.gz$/;

function createBackupService(db, { backupDir, uploadDir, auth, stateStore }) {
  fs.mkdirSync(backupDir, { recursive: true });

  async function create({ kind = "manuel", user = null, ip = null } = {}) {
    const tables = {};
    for (const table of TABLES) {
      tables[table] = await db.query(`SELECT * FROM ${table} ORDER BY 1`);
    }
    const uploads = tables.files.map((row) => {
      const filePath = path.join(uploadDir, row.storage_key);
      const exists = fs.existsSync(filePath);
      return { key: row.storage_key, size: Number(row.size_bytes), sha256: row.sha256, presentAtBackup: exists && fs.statSync(filePath).size === Number(row.size_bytes) };
    });
    const state = tables.app_state[0];
    const backup = {
      format: "nova-backup",
      formatVersion: 1,
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      kind,
      counts: Object.fromEntries(TABLES.map((table) => [table, tables[table].length])),
      checksums: { state: state ? canonicalHash(state.data) : null, stateVersion: state ? state.version : 0 },
      uploads,
      tables,
    };
    const stamp = backup.createdAt.replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
    const name = `nova-${kind}-${stamp}-${crypto.randomBytes(3).toString("hex")}.json.gz`;
    const finalPath = path.join(backupDir, name);
    const temporaryPath = `${finalPath}.part`;
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(backup)), { level: 9 });
    const handle = fs.openSync(temporaryPath, "w", 0o600);
    try {
      fs.writeSync(handle, compressed);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporaryPath, finalPath);
    await auth.audit({ user, action: "backup.create", entity: "backup", entityId: name, details: { kind, bytes: compressed.length, counts: backup.counts }, ip });
    await prune();
    return { name, bytes: compressed.length, createdAt: backup.createdAt, counts: backup.counts, missingUploads: uploads.filter((u) => !u.presentAtBackup).length };
  }

  function list() {
    return fs
      .readdirSync(backupDir)
      .filter((name) => NAME_PATTERN.test(name))
      .map((name) => {
        const stat = fs.statSync(path.join(backupDir, name));
        return { name, kind: name.split("-")[1], bytes: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  function resolveName(name) {
    if (!NAME_PATTERN.test(String(name || ""))) throw httpError(400, "Nom de sauvegarde invalide.");
    const filePath = path.join(backupDir, name);
    if (!fs.existsSync(filePath)) throw httpError(404, "Sauvegarde introuvable.");
    return filePath;
  }

  function read(nameOrPath) {
    const filePath = nameOrPath.includes(path.sep) ? nameOrPath : resolveName(nameOrPath);
    const backup = JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString("utf8"));
    if (backup.format !== "nova-backup") throw httpError(422, "Ce fichier n'est pas une sauvegarde Nova+.");
    return backup;
  }

  async function prune() {
    const all = list();
    const remove = [
      ...all.filter((b) => b.kind === "auto").slice(AUTO_KEEP),
      ...all.filter((b) => b.kind === "manuel").slice(MANUAL_KEEP),
      ...all.filter((b) => b.kind === "avant").slice(MANUAL_KEEP),
    ];
    for (const backup of remove) fs.rmSync(path.join(backupDir, backup.name), { force: true });
  }

  // Rejoue la sauvegarde dans un schéma temporaire puis annule tout.
  async function restoreTest(nameOrPath, { user = null, ip = null } = {}) {
    const backup = read(nameOrPath);
    const schema = `restore_test_${crypto.randomBytes(4).toString("hex")}`;
    const ROLLBACK = Symbol("rollback");
    let report;
    try {
      await db.tx(async (tx) => {
        await tx.exec(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}, pg_catalog;`);
        await applySchemaInTransaction(tx);
        await loadTables(tx, backup);
        report = await compare(tx, backup);
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
    const uploads = backup.uploads.map((u) => {
      const filePath = path.join(uploadDir, u.key);
      return { ...u, presentNow: fs.existsSync(filePath) && fs.statSync(filePath).size === u.size };
    });
    report.uploads = {
      total: uploads.length,
      present: uploads.filter((u) => u.presentNow).length,
      missing: uploads.filter((u) => !u.presentNow).map((u) => u.key),
    };
    report.ok = report.ok && report.uploads.missing.length === 0;
    report.backup = path.basename(nameOrPath);
    report.testedAt = new Date().toISOString();
    await db.query(
      `INSERT INTO meta (key, value) VALUES ('last_restore_test', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ backup: report.backup, ok: report.ok, testedAt: report.testedAt })],
    );
    await auth.audit({ user, action: "backup.restore_test", entity: "backup", entityId: report.backup, details: { ok: report.ok }, ip });
    return report;
  }

  // Restauration réelle (ligne de commande uniquement) : une sauvegarde « avant-restauration » est créée d'abord.
  async function restore(nameOrPath, { user = null } = {}) {
    const backup = read(nameOrPath);
    const safety = await create({ kind: "avant-restauration", user });
    let restoredVersion = 0;
    await db.tx(async (tx) => {
      // L'historique des versions et les envois refusés sont conservés : ils ne font pas partie des sauvegardes.
      const [{ top }] = await tx.query(
        "SELECT GREATEST(COALESCE((SELECT max(version) FROM app_state_history), 0), COALESCE((SELECT version FROM app_state WHERE id = 1), 0)) AS top",
      );
      // Ordre inverse des clés étrangères.
      await tx.exec(["sessions", ...[...TABLES].reverse()].map((table) => `DELETE FROM ${table};`).join(" "));
      await loadTables(tx, backup);
      const report = await compare(tx, backup);
      if (!report.ok) throw httpError(500, "Restauration incohérente : annulée, la base est inchangée.");
      const state = backup.tables.app_state[0];
      if (state) {
        // Nouveau numéro de version : tout poste resté ouvert sur une version antérieure devra recharger.
        restoredVersion = Number(top) + 1;
        await tx.query("UPDATE app_state SET version = $1, updated_at = now() WHERE id = 1", [restoredVersion]);
        await tx.query(
          `INSERT INTO app_state_history (version, data, projects_count, size_bytes, source) VALUES ($1, $2::jsonb, $3, $4, 'restore_backup')`,
          [restoredVersion, JSON.stringify(state.data), Array.isArray(state.data?.projects) ? state.data.projects.length : 0, Buffer.byteLength(JSON.stringify(state.data))],
        );
      }
    });
    await auth.audit({ user, action: "backup.restore", entity: "backup", entityId: path.basename(nameOrPath), details: { safetyBackup: safety.name } });
    return { restored: path.basename(nameOrPath), safetyBackup: safety.name, version: restoredVersion };
  }

  async function latestAuto() {
    return list().find((b) => b.kind === "auto") || null;
  }

  // Vérifie toutes les heures ; crée la sauvegarde du jour si la dernière a plus de 23 h.
  function schedule({ intervalMs = 3600 * 1000, firstDelayMs = 2 * 60 * 1000, logger = console } = {}) {
    const run = async () => {
      try {
        const last = await latestAuto();
        if (!last || Date.now() - new Date(last.createdAt).getTime() > 23 * 3600 * 1000) {
          const created = await create({ kind: "auto" });
          logger.log(`[sauvegarde] ${created.name} (${Math.round(created.bytes / 1024)} Ko)`);
        }
        if (stateStore) await stateStore.pruneHistory();
      } catch (error) {
        logger.error("[sauvegarde] échec :", error);
      }
    };
    const first = setTimeout(run, firstDelayMs);
    const timer = setInterval(run, intervalMs);
    first.unref();
    timer.unref();
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }

  return { create, list, read, resolveName, restoreTest, restore, schedule, latestAuto };
}

async function loadTables(tx, backup) {
  for (const table of TABLES) {
    const rows = backup.tables[table] || [];
    if (!rows.length) continue;
    const columns = await tx.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = current_schema() ORDER BY ordinal_position`,
      [table],
    );
    const known = new Map(columns.map((c) => [c.column_name, c.data_type]));
    for (const row of rows) {
      const keys = Object.keys(row).filter((key) => known.has(key));
      const placeholders = keys.map((key, index) => (known.get(key) === "jsonb" ? `$${index + 1}::jsonb` : `$${index + 1}`));
      const values = keys.map((key) => (known.get(key) === "jsonb" ? JSON.stringify(row[key]) : row[key]));
      await tx.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders.join(", ")})`, values);
    }
  }
  for (const [table, column] of Object.entries(SEQUENCES)) {
    await tx.query(`SELECT setval(pg_get_serial_sequence($1, $2), GREATEST((SELECT COALESCE(max(${column}), 0) FROM ${table}), 1))`, [table, column]);
  }
}

async function compare(tx, backup) {
  const tables = {};
  let ok = true;
  for (const table of TABLES) {
    const [{ n }] = await tx.query(`SELECT count(*)::int AS n FROM ${table}`);
    const expected = backup.counts[table] ?? (backup.tables[table] || []).length;
    tables[table] = { expected, restored: n, ok: n === expected };
    if (n !== expected) ok = false;
  }
  const [state] = await tx.query("SELECT version, data FROM app_state WHERE id = 1");
  const stateHash = state ? canonicalHash(state.data) : null;
  const stateMatch = stateHash === backup.checksums.state;
  if (!stateMatch) ok = false;
  return { ok, tables, state: { version: state?.version || 0, hashMatch: stateMatch } };
}

module.exports = { createBackupService, TABLES };
