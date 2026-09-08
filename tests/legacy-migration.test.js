const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const migrationDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-legacy-migration-"));
const legacyProjects = Array.from({ length: 37 }, (_, index) => ({ id: `chantier-historique-${index + 1}` }));
fs.mkdirSync(path.join(migrationDataDir, "uploads"), { recursive: true });
fs.writeFileSync(path.join(migrationDataDir, "state.json"), JSON.stringify({ projects: legacyProjects }));
fs.writeFileSync(path.join(migrationDataDir, "uploads", "devis-historique.pdf"), "contenu-historique");

process.env.DATA_DIR = migrationDataDir;
process.env.NOVA_AUTH_PASSWORD = "AncienMotDePasse2026!";
process.env.NOVA_SESSION_SECRET = "legacy-migration-test-secret-long-enough";
process.env.NODE_ENV = "test";

const { readUsers } = require("../auth");
const { server } = require("../server");

test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(migrationDataDir, { recursive: true, force: true });
});

function baseUrl() { return `http://127.0.0.1:${server.address().port}`; }

test("préserve et rattache intégralement une installation historique", async () => {
  const [admin] = readUsers(path.join(migrationDataDir, "users.json"));
  assert.equal(admin.role, "admin");
  assert.equal(JSON.parse(fs.readFileSync(path.join(migrationDataDir, "state.json"), "utf8")).projects.length, 37);
  assert.equal(JSON.parse(fs.readFileSync(path.join(migrationDataDir, "backups", "pre-accounts-v1", "state.json"), "utf8")).projects.length, 37);
  assert.equal(JSON.parse(fs.readFileSync(path.join(migrationDataDir, "accounts", admin.id, "state.json"), "utf8")).projects.length, 37);
  assert.equal(fs.existsSync(path.join(migrationDataDir, "uploads", "devis-historique.pdf")), true);
  assert.equal(fs.existsSync(path.join(migrationDataDir, "backups", "pre-accounts-v1", "uploads", "devis-historique.pdf")), true);
  assert.equal(fs.existsSync(path.join(migrationDataDir, "accounts", admin.id, "uploads", "devis-historique.pdf")), true);
});

test("reprend une seule fois l’identifiant de l’ancienne session", async () => {
  const response = await fetch(`${baseUrl()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "direction-travaux", password: "AncienMotDePasse2026!" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.identifier, "direction-travaux");
  assert.equal(fs.existsSync(path.join(migrationDataDir, ".legacy-login-claimed")), true);

  const secondClaim = await fetch(`${baseUrl()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "autre-identifiant", password: "AncienMotDePasse2026!" }),
  });
  assert.equal(secondClaim.status, 401);
});
