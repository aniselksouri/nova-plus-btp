#!/usr/bin/env node
const path = require("path");
const { createUser, readUsers } = require("../auth");

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "..", "data");
const usersFile = path.join(dataDir, "users.json");
const [command, identifier, password, ...nameParts] = process.argv.slice(2);

if (command === "list") {
  const users = readUsers(usersFile);
  if (!users.length) console.log("Aucun compte Nova+.");
  users.forEach((user) => console.log(`${user.identifier}\t${user.role}\t${user.displayName}`));
  process.exit(0);
}
if (command !== "add" || !identifier || !password) {
  console.error('Usage : npm run user:add -- identifiant "mot-de-passe" "Nom affiché"');
  console.error("        npm run user:list");
  process.exit(1);
}
try {
  const firstAccount = readUsers(usersFile).length === 0;
  const user = createUser(usersFile, { identifier, password, displayName: nameParts.join(" ") || identifier, role: firstAccount ? "admin" : "client" });
  console.log(`Compte ${user.identifier} créé (${user.role}).`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
