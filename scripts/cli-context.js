"use strict";

// Contexte commun aux scripts en ligne de commande : même base et mêmes dossiers que le serveur.

const path = require("path");
const { createDb } = require("../lib/db");
const { migrate } = require("../lib/migrations");
const { createAuth } = require("../lib/auth");
const { createStateStore } = require("../lib/state-store");
const { createFileStore } = require("../lib/files");
const { createBackupService } = require("../lib/backup");
const { createSecretBox } = require("../lib/security");

async function openContext() {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
  const uploadDir = path.join(dataDir, "uploads");
  const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(dataDir, "backups"));
  const db = await createDb({ databaseUrl: process.env.DATABASE_URL, dataDir });
  await migrate(db);
  const auth = createAuth(db, { secretBox: createSecretBox(process.env.NOVA_SECRET_KEY) });
  const stateStore = createStateStore(db, { auth });
  const fileStore = createFileStore(db, { uploadDir, auth });
  const backups = createBackupService(db, { backupDir, uploadDir, auth, stateStore });
  return { db, auth, stateStore, fileStore, backups, dataDir, uploadDir, backupDir, stateFile: path.join(dataDir, "state.json") };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else args[key] = true;
    } else args._.push(value);
  }
  return args;
}

async function run(main) {
  let context;
  try {
    context = await openContext();
    await main(context, parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`Erreur : ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (context) await context.db.close().catch(() => {});
  }
}

module.exports = { run };
