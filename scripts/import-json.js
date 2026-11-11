"use strict";

// Reprise de data/state.json dans PostgreSQL.
//   npm run import:json                          → simulation : compte et vérifie sans rien écrire
//   npm run import:json -- --apply               → import réel, vérifié par relecture
//   npm run import:json -- --resync              → après un retour arrière : compare state.json à la base
//   npm run import:json -- --resync --apply      → enregistre state.json comme nouvelle version (l'ancienne
//                                                  reste dans l'historique, restaurable)
// Le serveur fait l'import initial automatiquement au premier démarrage si la base est vide.

const path = require("path");
const { run } = require("./cli-context");
const { importStateFile, resyncStateFile } = require("../lib/json-import");

run(async ({ db, auth, fileStore, stateStore, stateFile }, args) => {
  const source = args.file ? path.resolve(args.file) : stateFile;
  const apply = args.apply === true;
  const report = args.resync
    ? await resyncStateFile(db, { stateFile: source, stateStore, fileStore, apply })
    : await importStateFile(db, { stateFile: source, fileStore, auth, apply });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "simulation") console.log("\nSimulation uniquement. Relancez avec --apply pour écrire.");
  if (report.status === "refuse") process.exitCode = 1;
});
