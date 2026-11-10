"use strict";

// Exporte les données actuelles de PostgreSQL au format state.json de l'ancienne version.
// Sert au plan de retour arrière : si l'on doit redéployer l'ancienne version, on lui redonne
// les données saisies depuis la migration.
//   npm run export:json                          → écrit data/state.export-<date>.json
//   npm run export:json -- --file /data/state.json --overwrite   → remplace state.json (copie de l'ancien gardée)

const fs = require("fs");
const path = require("path");
const { run } = require("./cli-context");
const { canonicalHash } = require("../lib/security");

run(async ({ stateStore, dataDir }, args) => {
  const current = await stateStore.get();
  if (!current.version) throw new Error("La base ne contient encore aucune donnée.");
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  const target = path.resolve(args.file || path.join(dataDir, `state.export-${stamp}.json`));
  if (fs.existsSync(target)) {
    if (args.overwrite !== true) throw new Error(`${target} existe déjà : ajoutez --overwrite (une copie de l'ancien fichier sera gardée).`);
    const keep = `${target}.avant-export-${stamp}`;
    fs.copyFileSync(target, keep);
    console.log(`Ancien fichier conservé : ${keep}`);
  }
  const temporary = `${target}.part`;
  fs.writeFileSync(temporary, JSON.stringify(current.data, null, 2), { mode: 0o600 });
  const check = canonicalHash(JSON.parse(fs.readFileSync(temporary, "utf8")));
  if (check !== canonicalHash(current.data)) throw new Error("Vérification de l'export échouée.");
  fs.renameSync(temporary, target);
  console.log(`Version ${current.version} exportée et vérifiée : ${target}`);
});
