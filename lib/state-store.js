"use strict";

// Données de l'application actuelle (chantiers...) dans PostgreSQL, avec :
// - un numéro de version : un poste qui n'a pas la dernière version ne peut plus écraser les autres ;
// - un historique : chaque enregistrement est conservé et peut être restauré par l'administrateur ;
// - un garde-fou contre les suppressions massives ;
// - les enregistrements refusés sont conservés, jamais jetés.

const { httpError, canonicalHash } = require("./security");

const MAX_PROJECTS_REMOVED_PER_SAVE = 1;

function projectIds(data) {
  return Array.isArray(data?.projects) ? data.projects.map((project) => String(project?.id ?? "")) : [];
}

function summarize(data) {
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  return {
    projects: projects.length,
    activeProjects: projects.filter((project) => !project?.archived).length,
    documents: projects.reduce((sum, project) => sum + (Array.isArray(project?.documents) ? project.documents.length : 0), 0),
    subcontractors: Array.isArray(data?.subcontractors) ? data.subcontractors.length : 0,
    suppliers: Array.isArray(data?.suppliers) ? data.suppliers.length : 0,
    library: Array.isArray(data?.library) ? data.library.length : 0,
  };
}

function createStateStore(db, { auth }) {
  async function get() {
    const [row] = await db.query("SELECT version, data, updated_at FROM app_state WHERE id = 1");
    if (!row) return { version: 0, data: {}, updatedAt: null };
    return { version: row.version, data: row.data, updatedAt: row.updated_at };
  }

  async function save({ data, baseVersion, user, ip, allowMassDelete = false, source = "save" }) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw httpError(400, "Données invalides.");
    if (!Number.isInteger(baseVersion) || baseVersion < 0) {
      throw httpError(428, "Version des données manquante : rechargez Nova+.", { code: "version_required" });
    }
    const payload = JSON.stringify(data);

    const outcome = await db.tx(async (tx) => {
      const [current] = await tx.query("SELECT version, data FROM app_state WHERE id = 1 FOR UPDATE");
      const currentVersion = current ? current.version : 0;

      if (baseVersion !== currentVersion) {
        await reject(tx, { reason: "conflict", baseVersion, currentVersion, payload, user });
        return { rejected: "conflict", currentVersion };
      }

      if (current) {
        const before = projectIds(current.data);
        const after = new Set(projectIds(data));
        const removed = before.filter((id) => !after.has(id));
        if (removed.length > MAX_PROJECTS_REMOVED_PER_SAVE && !(allowMassDelete && user?.role === "admin")) {
          await reject(tx, { reason: "mass_delete", baseVersion, currentVersion, payload, user });
          return { rejected: "mass_delete", currentVersion, removed: removed.length };
        }
      }

      const version = currentVersion + 1;
      if (current) {
        await tx.query("UPDATE app_state SET version = $1, data = $2::jsonb, updated_at = now(), updated_by = $3 WHERE id = 1", [
          version,
          payload,
          user?.id || null,
        ]);
      } else {
        await tx.query("INSERT INTO app_state (id, version, data, updated_by) VALUES (1, $1, $2::jsonb, $3)", [version, payload, user?.id || null]);
      }
      const summary = summarize(data);
      await tx.query(
        `INSERT INTO app_state_history (version, data, projects_count, size_bytes, source, saved_by)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6)`,
        [version, payload, summary.projects, Buffer.byteLength(payload), source, user?.id || null],
      );

      const beforeIds = new Set(current ? projectIds(current.data) : []);
      const afterIds = projectIds(data);
      const added = afterIds.filter((id) => !beforeIds.has(id));
      const removed = [...beforeIds].filter((id) => !afterIds.includes(id));
      if (added.length || removed.length || source !== "save") {
        await auth.audit({ user, action: source === "save" ? "state.projects_changed" : `state.${source}`, entity: "app_state", entityId: String(version), details: { added, removed, ...summary }, ip }, tx);
      }
      return { version, savedAt: new Date().toISOString() };
    });

    if (outcome.rejected === "conflict") {
      await auth.audit({ user, action: "state.conflict", details: { baseVersion, currentVersion: outcome.currentVersion }, ip });
      throw httpError(409, "Ces données ont été modifiées depuis un autre poste. Rechargez Nova+ pour récupérer la dernière version.", {
        code: "conflict",
        currentVersion: outcome.currentVersion,
      });
    }
    if (outcome.rejected === "mass_delete") {
      await auth.audit({ user, action: "state.mass_delete_blocked", details: { removed: outcome.removed }, ip });
      throw httpError(409, `Enregistrement bloqué : ${outcome.removed} chantiers auraient été supprimés d'un coup. Rien n'a été effacé. Archivez les chantiers un par un ou contactez l'administrateur.`, {
        code: "mass_delete",
        currentVersion: outcome.currentVersion,
      });
    }
    return outcome;
  }

  async function reject(tx, { reason, baseVersion, currentVersion, payload, user }) {
    await tx.query(
      `INSERT INTO state_rejections (reason, base_version, current_version, data, user_id) VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [reason, baseVersion, currentVersion, payload, user?.id || null],
    );
  }

  async function history({ limit = 100 } = {}) {
    return db.query(
      `SELECT h.id, h.version, h.projects_count, h.size_bytes, h.source, h.saved_at, u.display_name AS saved_by
       FROM app_state_history h LEFT JOIN users u ON u.id = h.saved_by
       ORDER BY h.id DESC LIMIT $1`,
      [Math.min(Math.max(Number(limit) || 100, 1), 500)],
    );
  }

  async function restoreFromHistory(historyId, { user, ip }) {
    const [entry] = await db.query("SELECT version, data FROM app_state_history WHERE id = $1", [historyId]);
    if (!entry) throw httpError(404, "Version introuvable.");
    const current = await get();
    const result = await save({ data: entry.data, baseVersion: current.version, user, ip, allowMassDelete: true, source: "restore_version" });
    await auth.audit({ user, action: "state.restored", details: { fromVersion: entry.version, newVersion: result.version }, ip });
    return result;
  }

  // Conserve tout sur 48 h (au plus 300 versions), puis une version par jour pendant 90 jours.
  async function pruneHistory() {
    await db.query(`DELETE FROM app_state_history WHERE saved_at < now() - interval '90 days'`);
    await db.query(
      `DELETE FROM app_state_history
       WHERE saved_at < now() - interval '48 hours'
         AND id NOT IN (SELECT max(id) FROM app_state_history GROUP BY date_trunc('day', saved_at))`,
    );
    await db.query(
      `DELETE FROM app_state_history
       WHERE id NOT IN (SELECT id FROM app_state_history ORDER BY id DESC LIMIT 300)
         AND id NOT IN (SELECT max(id) FROM app_state_history GROUP BY date_trunc('day', saved_at))`,
    );
    await db.query(`DELETE FROM state_rejections WHERE rejected_at < now() - interval '90 days'`);
  }

  async function fingerprint() {
    const current = await get();
    return { version: current.version, hash: canonicalHash(current.data), summary: summarize(current.data) };
  }

  return { get, save, history, restoreFromHistory, pruneHistory, fingerprint };
}

module.exports = { createStateStore, summarize, MAX_PROJECTS_REMOVED_PER_SAVE };
