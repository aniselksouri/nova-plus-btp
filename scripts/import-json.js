"use strict";

// Reprise de data/state.json dans PostgreSQL.
//   npm run import:json              → simulation : compte et vérifie sans rien écrire
//   npm run import:json -- --apply   → import réel, vérifié par relecture
// Le serveur fait la même chose automatiquement au premier démarrage si la base est vide.

const path = require("path");
const { run } = require("./cli-context");
const { importStateFile } = require("../lib/json-import");

run(async ({ db, auth, fileStore, stateFile }, args) => {
  const source = args.file ? path.resolve(args.file) : stateFile;
  const report = await importStateFile(db, { stateFile: source, fileStore, auth, apply: args.apply === true });
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "simulation") console.log("\nSimulation uniquement. Relancez avec --apply pour importer.");
});
