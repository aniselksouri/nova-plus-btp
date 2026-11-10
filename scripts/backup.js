"use strict";

// Sauvegardes en ligne de commande.
//   npm run backup                              → crée une sauvegarde
//   npm run backup -- list
//   npm run backup -- test [nom]                → test de restauration (aucune modification)
//   npm run backup -- restore <nom> --confirm   → restauration réelle (sauvegarde de sécurité créée avant)

const { run } = require("./cli-context");

run(async ({ backups }, args) => {
  const command = args._[0] || "create";
  if (command === "create") {
    console.log(await backups.create({ kind: "manuel" }));
  } else if (command === "list") {
    console.table(backups.list());
  } else if (command === "test") {
    const name = args._[1] || backups.list()[0]?.name;
    if (!name) throw new Error("Aucune sauvegarde disponible.");
    const report = await backups.restoreTest(name);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 2;
  } else if (command === "restore") {
    const name = args._[1];
    if (!name) throw new Error("Précisez le nom de la sauvegarde à restaurer.");
    if (args.confirm !== true) throw new Error("Restauration réelle : ajoutez --confirm. Tous les comptes seront déconnectés.");
    console.log(await backups.restore(name));
  } else {
    throw new Error("Commande inconnue : create, list, test, restore.");
  }
});
