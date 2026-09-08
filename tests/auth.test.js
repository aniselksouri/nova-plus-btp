const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-auth-test-"));
process.env.DATA_DIR = testDataDir;
process.env.NOVA_SESSION_SECRET = "test-secret-long-enough-for-signed-sessions";
process.env.NODE_ENV = "test";
const legacyProjects = Array.from({ length: 12 }, (_, index) => ({ id: `legacy-${index + 1}` }));
fs.mkdirSync(path.join(testDataDir, "uploads"), { recursive: true });
fs.writeFileSync(path.join(testDataDir, "state.json"), JSON.stringify({ projects: legacyProjects }));
fs.writeFileSync(path.join(testDataDir, "uploads", "ancien-document.pdf"), "document-test");

const { createUser } = require("../auth");
const { server } = require("../server");
const usersFile = path.join(testDataDir, "users.json");

test.before(async () => {
  createUser(usersFile, { identifier: "client-alpha", password: "MotDePasseAlpha!", displayName: "Entreprise Alpha", role: "admin" });
  createUser(usersFile, { identifier: "client-beta", password: "MotDePasseBeta!", displayName: "Entreprise Beta" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function baseUrl() { return `http://127.0.0.1:${server.address().port}`; }

async function login(identifier, password) {
  const response = await fetch(`${baseUrl()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  return { response, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("refuse un accès sans session et un mauvais mot de passe", async () => {
  const protectedResponse = await fetch(`${baseUrl()}/api/state`);
  assert.equal(protectedResponse.status, 401);
  const { response } = await login("client-alpha", "mauvais-mot-de-passe");
  assert.equal(response.status, 401);
});

test("connecte un compte et expose seulement son profil public", async () => {
  const { response, cookie } = await login("CLIENT-ALPHA", "MotDePasseAlpha!");
  assert.equal(response.status, 200);
  assert.match(cookie, /^nova_session=/);
  const session = await fetch(`${baseUrl()}/api/auth/session`, { headers: { Cookie: cookie } });
  const payload = await session.json();
  assert.deepEqual(payload.user, { id: payload.user.id, identifier: "client-alpha", displayName: "Entreprise Alpha", role: "admin" });
  assert.equal("passwordHash" in payload.user, false);
  const migratedState = JSON.parse(fs.readFileSync(path.join(testDataDir, "accounts", payload.user.id, "state.json"), "utf8"));
  assert.equal(migratedState.projects.length, 12);
  assert.equal(fs.existsSync(path.join(testDataDir, "accounts", payload.user.id, "uploads", "ancien-document.pdf")), true);
  assert.equal(fs.existsSync(path.join(testDataDir, "backups", "pre-accounts-v1", "state.json")), true);
  assert.equal(fs.existsSync(path.join(testDataDir, "backups", "pre-accounts-v1", "uploads", "ancien-document.pdf")), true);
  assert.equal(fs.existsSync(path.join(testDataDir, "state.json")), true);
});

test("permet de créer son compte depuis la page de connexion", async () => {
  const response = await fetch(`${baseUrl()}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "nouveau-client", password: "NouveauClient2026!", displayName: "Nouveau Client BTP" }),
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.user.role, "client");
  assert.match(response.headers.get("set-cookie"), /^nova_session=/);
  const duplicate = await fetch(`${baseUrl()}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "nouveau-client", password: "NouveauClient2026!", displayName: "Doublon" }),
  });
  assert.equal(duplicate.status, 400);
});

test("isole les données de deux comptes", async () => {
  const alpha = await login("client-alpha", "MotDePasseAlpha!");
  const beta = await login("client-beta", "MotDePasseBeta!");
  await fetch(`${baseUrl()}/api/state`, {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: alpha.cookie }, body: JSON.stringify({ projects: [{ id: "alpha-only" }] }),
  });
  await fetch(`${baseUrl()}/api/state`, {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: beta.cookie }, body: JSON.stringify({ projects: [{ id: "beta-only" }] }),
  });
  const alphaState = await (await fetch(`${baseUrl()}/api/state`, { headers: { Cookie: alpha.cookie } })).json();
  const betaState = await (await fetch(`${baseUrl()}/api/state`, { headers: { Cookie: beta.cookie } })).json();
  assert.equal(alphaState.projects[0].id, "alpha-only");
  assert.equal(betaState.projects[0].id, "beta-only");
});

test("réserve la gestion des comptes à l’administrateur", async () => {
  const alpha = await login("client-alpha", "MotDePasseAlpha!");
  const beta = await login("client-beta", "MotDePasseBeta!");
  const forbidden = await fetch(`${baseUrl()}/api/admin/accounts`, { headers: { Cookie: beta.cookie } });
  assert.equal(forbidden.status, 403);

  const created = await fetch(`${baseUrl()}/api/admin/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ identifier: "client-gamma", password: "MotDePasseGamma!", displayName: "Entreprise Gamma" }),
  });
  assert.equal(created.status, 201);
  const payload = await created.json();
  assert.equal(payload.account.identifier, "client-gamma");
  assert.equal((await login("client-gamma", "MotDePasseGamma!")).response.status, 200);
});

test("réinitialise le mot de passe et invalide les anciennes sessions", async () => {
  const alpha = await login("client-alpha", "MotDePasseAlpha!");
  const beta = await login("client-beta", "MotDePasseBeta!");
  const accounts = await (await fetch(`${baseUrl()}/api/admin/accounts`, { headers: { Cookie: alpha.cookie } })).json();
  const betaAccount = accounts.accounts.find((account) => account.identifier === "client-beta");
  const updated = await fetch(`${baseUrl()}/api/admin/accounts/${betaAccount.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ password: "NouveauMotBeta!" }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await fetch(`${baseUrl()}/api/auth/session`, { headers: { Cookie: beta.cookie } })).status, 401);
  assert.equal((await login("client-beta", "NouveauMotBeta!")).response.status, 200);
});
