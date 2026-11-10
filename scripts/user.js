"use strict";

// Gestion des comptes en ligne de commande (secours si l'interface d'administration est inaccessible).
//   npm run user -- create --email a@b.fr --name "Otar K." --role admin
//   npm run user -- reset-password --email a@b.fr
//   npm run user -- reset-2fa --email a@b.fr
//   npm run user -- unlock --email a@b.fr
//   npm run user -- list

const { run } = require("./cli-context");
const { generateTemporaryPassword } = require("../lib/security");

run(async ({ auth, db }, args) => {
  const command = args._[0];
  const actor = null;
  if (command === "list") {
    const rows = await db.query("SELECT email, display_name, role, active, totp_enabled, last_login_at FROM users ORDER BY role, email");
    console.table(rows);
    return;
  }
  if (!args.email) throw new Error("--email obligatoire.");
  if (command === "create") {
    const password = generateTemporaryPassword();
    const row = await auth.createUser({ email: args.email, displayName: args.name || args.email, role: args.role || "commercial", password }, actor);
    console.log(`Compte créé : ${row.email} (${row.role})`);
    console.log(`Mot de passe temporaire : ${password}`);
    console.log("À transmettre par un canal sûr ; il devra être changé à la première connexion.");
    return;
  }
  const user = await auth.findByEmail(String(args.email).trim().toLowerCase());
  if (!user) throw new Error("Compte introuvable.");
  if (command === "reset-password") {
    console.log(`Nouveau mot de passe temporaire : ${await auth.resetPassword(user.id, actor)}`);
  } else if (command === "reset-2fa") {
    await auth.resetMfa(user.id, actor);
    console.log("Double authentification réinitialisée : elle sera reconfigurée à la prochaine connexion.");
  } else if (command === "unlock") {
    await auth.unlock(user.id, actor);
    console.log("Compte déverrouillé.");
  } else {
    throw new Error("Commande inconnue : create, reset-password, reset-2fa, unlock, list.");
  }
});
