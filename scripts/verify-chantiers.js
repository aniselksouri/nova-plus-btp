"use strict";

// Contrôle que les chantiers existants n'ont pas bougé : compare les chantiers de la base
// à un state.json de référence (par défaut DATA_DIR/state.json, le fichier d'avant la migration,
// conservé intact sur le volume). Lecture seule : ne modifie rien.
//   npm run verify:chantiers                         → compare à DATA_DIR/state.json
//   npm run verify:chantiers -- --reference fichier.json
// Code de sortie 1 si un chantier de référence manque ou a changé sans être relié à un devis signé.

const fs = require("fs");
const path = require("path");
const { run } = require("./cli-context");
const { canonicalHash } = require("../lib/security");

const sum = (list, key) => Math.round((list || []).reduce((total, item) => total + Number(item?.[key] || 0), 0) * 100) / 100;
const money = (value) => `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function summary(project) {
  return {
    lots: (project.lots || []).length,
    vente: sum(project.lots, "sale"),
    factures: (project.invoices || []).length,
    documents: (project.documents || []).length,
  };
}

run(async ({ stateStore, db, dataDir }, args) => {
  const referencePath = path.resolve(args.reference || path.join(dataDir, "state.json"));
  if (!fs.existsSync(referencePath)) throw new Error(`Fichier de référence introuvable : ${referencePath}`);
  const reference = JSON.parse(fs.readFileSync(referencePath, "utf8"));
  const current = await stateStore.get();
  if (!current.version) throw new Error("La base ne contient encore aucune donnée.");

  const before = new Map((reference.projects || []).map((project) => [project.id, project]));
  const after = new Map((current.data.projects || []).map((project) => [project.id, project]));
  const linked = new Set((await db.query("SELECT project_id FROM dossiers WHERE project_id IS NOT NULL")).map((row) => row.project_id));

  const missing = [];
  const changed = [];
  const changedLinked = [];
  let identical = 0;
  for (const [id, project] of before) {
    const now = after.get(id);
    if (!now) {
      missing.push(project);
      continue;
    }
    if (canonicalHash(project) === canonicalHash(now)) {
      identical += 1;
      continue;
    }
    const fields = [...new Set([...Object.keys(project), ...Object.keys(now)])].filter((key) => canonicalHash(project[key] ?? null) !== canonicalHash(now[key] ?? null));
    (linked.has(id) ? changedLinked : changed).push({ project, now, fields });
  }
  const added = [...after.values()].filter((project) => !before.has(project.id));

  console.log(`Référence : ${referencePath}`);
  console.log(`Base : version ${current.version}\n`);
  console.log(`Chantiers de référence : ${before.size}`);
  console.log(`  identiques             : ${identical}`);
  console.log(`  modifiés (devis signé) : ${changedLinked.length}`);
  console.log(`  modifiés (autre)       : ${changed.length}`);
  console.log(`  manquants              : ${missing.length}`);
  console.log(`Nouveaux chantiers       : ${added.length}\n`);

  const line = (label, project, now) => {
    const a = summary(project);
    const b = now ? summary(now) : null;
    console.log(`  ${label} ${project.name || project.id}`);
    console.log(`      avant : ${a.lots} lots, ${money(a.vente)}, ${a.factures} échéances, ${a.documents} documents`);
    if (b) console.log(`      après : ${b.lots} lots, ${money(b.vente)}, ${b.factures} échéances, ${b.documents} documents`);
  };
  for (const item of missing) line("MANQUANT", item);
  for (const item of changed) {
    line("MODIFIÉ ", item.project, item.now);
    console.log(`      champs : ${item.fields.join(", ")}`);
  }
  for (const item of changedLinked) {
    line("DEVIS   ", item.project, item.now);
    console.log(`      champs : ${item.fields.join(", ")} (relié à un dossier de devis : avenant ou solde attendus)`);
  }
  for (const project of added) console.log(`  NOUVEAU  ${project.name || project.id}`);

  const ok = missing.length === 0 && changed.length === 0;
  console.log(`\n${ok ? "OK : aucun chantier existant perdu ni modifié hors devis." : "ÉCART : vérifier les chantiers ci-dessus avant d'aller plus loin."}`);
  if (!ok) process.exitCode = 1;
});
