"use strict";

// Empêche la répétition de l'incident du 30/09/2026 : des pièces jointes écrites sur le disque
// temporaire du serveur, effacé au déploiement suivant.
//
// 1. Sur Railway, le dossier de données doit se trouver dans le volume persistant monté.
// 2. Un fichier témoin relie le dossier de données à la base : si la base connaît des fichiers
//    mais que le témoin est absent ou différent, le mauvais disque est monté. Nova+ se signale
//    alors en échec de santé ; Railway garde l'ancienne version en ligne.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MARKER = ".nova-volume";

function checkPersistentLocation({ dataDir, env = process.env }) {
  const onRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID);
  if (!onRailway) return { ok: true, reason: "hors Railway" };
  if (env.NOVA_ALLOW_EPHEMERAL_STORAGE === "1") return { ok: true, reason: "stockage temporaire autorisé explicitement", warning: true };
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH;
  if (!mount) {
    return { ok: false, reason: "Aucun volume Railway n'est monté sur ce service : les pièces jointes seraient effacées au prochain déploiement." };
  }
  const resolvedMount = path.resolve(mount);
  const resolvedData = path.resolve(dataDir);
  if (resolvedData !== resolvedMount && !resolvedData.startsWith(resolvedMount + path.sep)) {
    return { ok: false, reason: `DATA_DIR (${resolvedData}) n'est pas dans le volume persistant (${resolvedMount}).` };
  }
  return { ok: true, reason: `volume persistant ${resolvedMount}` };
}

async function checkVolumeIdentity(db, { dataDir }) {
  const markerPath = path.join(dataDir, MARKER);
  const [row] = await db.query("SELECT value FROM meta WHERE key = 'volume_id'");
  const [{ n: knownFiles }] = await db.query("SELECT count(*)::int AS n FROM files");
  const onDisk = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8").trim() : null;

  if (!row) {
    const id = onDisk || crypto.randomUUID();
    if (!onDisk) fs.writeFileSync(markerPath, `${id}\n`, { mode: 0o640 });
    await db.query(
      "INSERT INTO meta (key, value) VALUES ('volume_id', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [JSON.stringify(id)],
    );
    return { ok: true, volumeId: id, reason: "volume enregistré" };
  }

  const expected = row.value;
  if (onDisk === expected) return { ok: true, volumeId: expected, reason: "volume reconnu" };
  if (!onDisk && knownFiles === 0) {
    fs.writeFileSync(markerPath, `${expected}\n`, { mode: 0o640 });
    return { ok: true, volumeId: expected, reason: "volume initialisé (aucun fichier connu)" };
  }
  return {
    ok: false,
    volumeId: expected,
    found: onDisk,
    reason: onDisk
      ? "Le dossier de données monté n'est pas celui attendu par la base : mauvais volume."
      : `Le dossier de données est vide alors que la base référence ${knownFiles} pièce(s) jointe(s) : volume absent ou remplacé.`,
  };
}

module.exports = { checkPersistentLocation, checkVolumeIdentity, MARKER };
