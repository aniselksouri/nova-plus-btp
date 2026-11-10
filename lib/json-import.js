"use strict";

// Reprise des données Nova+ actuelles (data/state.json) dans PostgreSQL.
// - Le fichier source n'est jamais modifié ni supprimé.
// - L'import ne s'exécute que si la base ne contient encore aucune donnée.
// - Après écriture, les données sont relues et comparées (empreinte SHA-256 du JSON canonique) :
//   au moindre écart, la transaction est annulée.

const fs = require("fs");
const { canonicalHash, sha256, httpError } = require("./security");
const { summarize } = require("./state-store");
const { collectUploadReferences, countEmbeddedFiles } = require("./files");

function analyzeStateFile(stateFile) {
  if (!fs.existsSync(stateFile)) return { exists: false, stateFile };
  const raw = fs.readFileSync(stateFile);
  let data;
  try {
    data = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw httpError(422, `state.json illisible : ${error.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw httpError(422, "state.json ne contient pas un objet Nova+.");
  if (raw.toString("utf8").includes("\\u0000")) throw httpError(422, "state.json contient un caractère nul non supporté par PostgreSQL.");
  return {
    exists: true,
    stateFile,
    bytes: raw.length,
    fileSha256: sha256(raw),
    contentHash: canonicalHash(data),
    summary: summarize(data),
    uploadLinks: collectUploadReferences(data).length,
    embeddedFiles: countEmbeddedFiles(data),
    data,
  };
}

async function importStateFile(db, { stateFile, fileStore, auth, apply = false, user = null }) {
  const analysis = analyzeStateFile(stateFile);
  const { data, ...report } = analysis;
  if (!analysis.exists) return { ...report, status: "absent" };

  const [existing] = await db.query("SELECT version FROM app_state WHERE id = 1");
  if (existing) return { ...report, status: "deja_importe", currentVersion: existing.version };
  if (!apply) return { ...report, status: "simulation" };

  const payload = JSON.stringify(data);
  await db.tx(async (tx) => {
    await tx.query("INSERT INTO app_state (id, version, data, updated_by) VALUES (1, 1, $1::jsonb, $2)", [payload, user?.id || null]);
    await tx.query(
      `INSERT INTO app_state_history (version, data, projects_count, size_bytes, source, saved_by) VALUES (1, $1::jsonb, $2, $3, 'json_import', $4)`,
      [payload, analysis.summary.projects, Buffer.byteLength(payload), user?.id || null],
    );
    const [readBack] = await tx.query("SELECT data FROM app_state WHERE id = 1");
    const readHash = canonicalHash(readBack.data);
    if (readHash !== analysis.contentHash) {
      throw httpError(500, "Vérification échouée : les données relues diffèrent de state.json. Import annulé, rien n'a été écrit.");
    }
    await tx.query(
      `INSERT INTO meta (key, value) VALUES ('json_import', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ at: new Date().toISOString(), stateFile, fileSha256: analysis.fileSha256, contentHash: analysis.contentHash, summary: analysis.summary })],
    );
    await auth.audit({ user, action: "state.json_import", entity: "app_state", entityId: "1", details: { fileSha256: analysis.fileSha256, ...analysis.summary } }, tx);
  });

  const inventoried = fileStore ? await fileStore.inventoryDisk({ source: "json_import" }) : 0;
  return { ...report, status: "importe", verified: true, inventoriedFiles: inventoried };
}

module.exports = { analyzeStateFile, importStateFile };
