"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const security = require("../lib/security");
const { checkPersistentLocation, checkVolumeIdentity, MARKER } = require("../lib/storage-guard");
const { startTestServer, loggedInClient } = require("./helpers");

const sampleState = () => ({
  activeProjectId: "p1",
  settings: { targetMargin: 28, vat: 20 },
  projects: [
    { id: "p1", name: "M. et Mme LARGE", archived: false, lots: [{ name: "Carrelage", sale: 2831.85, labor: 980, material: 770 }], documents: [{ name: "facture.pdf", url: "/uploads/1700000000000-11111111-2222-3333-4444-555555555555-facture.pdf" }] },
    { id: "p2", name: "COQUART", archived: false, lots: [], documents: [] },
    { id: "p3", name: "BOUY", archived: true, lots: [], documents: [] },
  ],
  library: [{ lot: "Plomberie", keywords: ["PER"] }],
  subcontractors: [{ id: "st1", name: "MAJID BTP" }],
  suppliers: [],
});

// ---------- Sécurité ----------

test("TOTP conforme au vecteur RFC 6238 et refus de la réutilisation d'un code", () => {
  const secret = security.base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(security.totpAt(secret, 1, 8), "94287082");
  const now = 1_700_000_000_000;
  const code = security.totpAt(secret, security.currentStep(now));
  const step = security.verifyTotp(secret, code, { now });
  assert.equal(step, security.currentStep(now));
  assert.equal(security.verifyTotp(secret, code, { now, lastStep: step }), null);
  assert.equal(security.verifyTotp(secret, "000000", { now }), null);
});

test("mots de passe hachés (scrypt), secrets 2FA chiffrés", async () => {
  const hash = await security.hashPassword("Une-Phrase-Longue-2026");
  assert.match(hash, /^scrypt\$/);
  assert.equal(await security.verifyPassword("Une-Phrase-Longue-2026", hash), true);
  assert.equal(await security.verifyPassword("mauvais", hash), false);
  assert.throws(() => security.validatePassword("court"), /au moins 12/);
  const box = security.createSecretBox("cle");
  const sealed = box.seal("JBSWY3DPEHPK3PXP");
  assert.match(sealed, /^v1:/);
  assert.equal(box.open(sealed), "JBSWY3DPEHPK3PXP");
  assert.throws(() => security.createSecretBox("autre").open(sealed));
});

// ---------- Accès ----------

test("sans session : redirection vers la connexion, aucune donnée ni code serveur exposé", async (t) => {
  const server = await startTestServer({ stateJson: sampleState() });
  t.after(() => server.close());
  const client = server.client();
  const home = await client.get("/");
  assert.equal(home.status, 302);
  assert.equal(home.headers.get("location"), "/login.html");
  assert.equal((await client.get("/api/state")).status, 401);
  assert.equal((await client.get("/login.html")).status, 200);
  for (const url of ["/server.js", "/package.json", "/data/state.json", "/lib/auth.js", "/.git/config", "/node_modules/pg/package.json"]) {
    assert.notEqual((await client.get(url)).status, 200, url);
  }
  const { client: admin } = await loggedInClient(server);
  for (const url of ["/server.js", "/package.json", "/data/state.json", "/lib/auth.js", "/state.json"]) {
    assert.equal((await admin.get(url)).status, 404, url);
  }
  assert.equal((await admin.get("/")).status, 200);
  assert.equal((await admin.get("/app.js")).status, 200);
});

test("administrateur : 2FA obligatoire puis changement du mot de passe temporaire", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const temporary = security.generateTemporaryPassword();
  await server.app.auth.createUser({ email: "otar@hsm.test", displayName: "Otar", role: "admin", password: temporary });
  const client = server.client();

  const login = await client.post("/api/auth/login", { email: "OTAR@hsm.test ", password: temporary });
  assert.equal(login.status, 200);
  assert.equal(login.data.next, "enroll");
  assert.match(login.data.enrollment.otpauthUrl, /^otpauth:\/\/totp\/Nova%2B/);
  assert.equal((await client.get("/api/state")).status, 401, "pas d'accès avant la 2FA");
  assert.equal((await client.post("/api/auth/password", { currentPassword: temporary, newPassword: "Nouveau-Mot-De-Passe-1" })).status, 401);

  assert.equal((await client.post("/api/auth/2fa", { code: "123456" })).status, 401);
  const code = security.totpAt(login.data.enrollment.secret, security.currentStep());
  const verified = await client.post("/api/auth/2fa", { code });
  assert.equal(verified.data.next, "change_password");
  assert.equal((await client.get("/api/state")).status, 401, "pas d'accès avant le changement de mot de passe");

  assert.equal((await client.post("/api/auth/password", { currentPassword: temporary, newPassword: "court" })).status, 400);
  assert.equal((await client.post("/api/auth/password", { currentPassword: temporary, newPassword: "Nouveau-Mot-De-Passe-1" })).status, 200);
  assert.equal((await client.get("/api/state")).status, 200);

  const [row] = await server.app.db.query("SELECT totp_enabled, totp_secret FROM users WHERE email = 'otar@hsm.test'");
  assert.equal(row.totp_enabled, true);
  assert.match(row.totp_secret, /^v1:/, "secret 2FA chiffré en base");

  // Connexion suivante : le code 2FA est demandé, et le même code ne peut pas resservir.
  const second = server.client();
  const again = await second.post("/api/auth/login", { email: "otar@hsm.test", password: "Nouveau-Mot-De-Passe-1" });
  assert.equal(again.data.next, "totp");
  assert.equal((await second.post("/api/auth/2fa", { code })).status, 401);
});

test("commercial : pas de 2FA imposée, administration interdite", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { client } = await loggedInClient(server, { email: "commercial@hsm.test", role: "commercial", name: "Karim" });
  assert.equal((await client.get("/api/state")).status, 200);
  assert.equal((await client.get("/api/admin/users")).status, 403);
  assert.equal((await client.get("/api/admin/backups")).status, 403);
  const me = await client.get("/api/auth/me");
  assert.equal(me.data.user.role, "commercial");
  assert.equal(me.data.user.mfaRequired, false);
});

test("verrouillage après 5 mots de passe faux, journalisé", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const password = "Bon-Mot-De-Passe-2026";
  await server.app.auth.createUser({ email: "secretariat@hsm.test", displayName: "Sonia", role: "commercial", password });
  const client = server.client();
  for (let i = 0; i < 5; i += 1) assert.equal((await client.post("/api/auth/login", { email: "secretariat@hsm.test", password: "faux-faux-faux" })).status, 401);
  assert.equal((await client.post("/api/auth/login", { email: "secretariat@hsm.test", password })).status, 423);
  const actions = (await server.app.db.query("SELECT action FROM audit_log ORDER BY id")).map((r) => r.action);
  assert.ok(actions.includes("auth.lockout"));
  assert.ok(actions.includes("auth.login.blocked"));
  assert.equal((await client.post("/api/auth/login", { email: "inconnu@hsm.test", password })).status, 401);
});

test("requête d'une autre origine refusée", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { client } = await loggedInClient(server);
  const response = await client.put("/api/state", {}, { headers: { Origin: "https://site-malveillant.example", "X-Nova-State-Version": "0" } });
  assert.equal(response.status, 403);
});

// ---------- Données versionnées ----------

test("données : version obligatoire, conflit entre deux postes refusé et conservé", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { client } = await loggedInClient(server);
  const first = await client.get("/api/state");
  assert.equal(first.headers.get("x-nova-state-version"), "0");

  assert.equal((await client.put("/api/state", sampleState())).status, 428);
  const saved = await client.put("/api/state", sampleState(), { headers: { "X-Nova-State-Version": "0" } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.version, 1);

  // Un second poste resté sur la version 0 tente d'écraser : refusé.
  const stale = { ...sampleState(), projects: [{ id: "p9", name: "Écrasement" }] };
  const conflict = await client.put("/api/state", stale, { headers: { "X-Nova-State-Version": "0" } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, "conflict");
  assert.equal(conflict.data.currentVersion, 1);
  const [kept] = await server.app.db.query("SELECT reason, data FROM state_rejections");
  assert.equal(kept.reason, "conflict");
  assert.equal(kept.data.projects[0].name, "Écrasement", "l'envoi refusé est conservé, pas jeté");

  const current = await client.get("/api/state");
  assert.equal(current.data.projects.length, 3);
  assert.equal(current.headers.get("x-nova-state-version"), "1");
});

test("suppression massive de chantiers bloquée, suppression unitaire autorisée, restauration d'une version", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { client } = await loggedInClient(server);
  await client.put("/api/state", sampleState(), { headers: { "X-Nova-State-Version": "0" } });

  const wiped = await client.put("/api/state", { ...sampleState(), projects: [] }, { headers: { "X-Nova-State-Version": "1" } });
  assert.equal(wiped.status, 409);
  assert.equal(wiped.data.code, "mass_delete");

  const oneRemoved = sampleState();
  oneRemoved.projects = oneRemoved.projects.filter((p) => p.id !== "p3");
  const ok = await client.put("/api/state", oneRemoved, { headers: { "X-Nova-State-Version": "1" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.version, 2);

  const history = await client.get("/api/admin/state/history");
  assert.deepEqual(history.data.versions.map((v) => v.version), [2, 1]);
  const v1 = history.data.versions.find((v) => v.version === 1);
  const restored = await client.post(`/api/admin/state/history/${v1.id}/restore`, {});
  assert.equal(restored.status, 200);
  const current = await client.get("/api/state");
  assert.equal(current.data.projects.length, 3);
  assert.equal(current.headers.get("x-nova-state-version"), "3");
});

// ---------- Reprise de state.json ----------

test("reprise de state.json : données identiques, fichier source intact, pièces jointes recensées", async (t) => {
  const state = sampleState();
  const raw = JSON.stringify(state, null, 2);
  const server = await startTestServer({
    stateJson: raw,
    uploads: { "1700000000000-11111111-2222-3333-4444-555555555555-facture.pdf": "%PDF-1.4 test" },
  });
  t.after(() => server.close());
  assert.equal(server.app.health.import.status, "importe");
  assert.equal(server.app.health.import.verified, true);
  assert.equal(server.app.health.import.summary.projects, 3);

  const stored = await server.app.stateStore.get();
  assert.equal(stored.version, 1);
  assert.equal(security.canonicalHash(stored.data), security.canonicalHash(state));
  assert.equal(fs.readFileSync(path.join(server.dataDir, "state.json"), "utf8"), raw, "state.json n'est jamais modifié");

  const [{ n }] = await server.app.db.query("SELECT count(*)::int AS n FROM files");
  assert.equal(n, 1);
  const { client } = await loggedInClient(server);
  const report = await client.get("/api/admin/files/check");
  assert.equal(report.data.ok, true);
  assert.equal(report.data.referencedInData, 1);
});

// ---------- Pièces jointes ----------

test("pièces jointes : écriture vérifiée, accès protégé, types dangereux refusés, absence détectée", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { client } = await loggedInClient(server);
  const content = Buffer.from("%PDF-1.4 devis MEHANNA");
  const uploaded = await client.post("/api/files", { name: "Devis MEHANNA.pdf", type: "application/pdf", dataUrl: `data:application/pdf;base64,${content.toString("base64")}` });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.data.sha256, crypto.createHash("sha256").update(content).digest("hex"));
  assert.match(uploaded.data.url, /^\/uploads\/\d+-[0-9a-f-]{36}-Devis-MEHANNA\.pdf$/);

  const download = await client.get(uploaded.data.url);
  assert.equal(download.status, 200);
  assert.equal(download.data, content.toString());
  assert.equal((await server.client().get(uploaded.data.url)).status, 302, "non connecté : pas d'accès au document");

  const html = await client.post("/api/files", { name: "piege.html", dataUrl: `data:text/html;base64,${Buffer.from("<script>").toString("base64")}` });
  assert.equal(html.status, 415);

  fs.rmSync(path.join(server.app.uploadDir, uploaded.data.url.split("/").pop()));
  const report = await client.get("/api/admin/files/check");
  assert.equal(report.data.ok, false);
  assert.equal(report.data.missing.length, 1);
});

// ---------- Stockage persistant ----------

test("Railway sans volume persistant : démarrage signalé en échec (santé 503)", async (t) => {
  assert.equal(checkPersistentLocation({ dataDir: "/data", env: {} }).ok, true);
  assert.equal(checkPersistentLocation({ dataDir: "/data", env: { RAILWAY_ENVIRONMENT: "production" } }).ok, false);
  assert.equal(checkPersistentLocation({ dataDir: "/var/data/nova", env: { RAILWAY_ENVIRONMENT: "production", RAILWAY_VOLUME_MOUNT_PATH: "/data" } }).ok, false);
  assert.equal(checkPersistentLocation({ dataDir: "/data", env: { RAILWAY_ENVIRONMENT: "production", RAILWAY_VOLUME_MOUNT_PATH: "/data" } }).ok, true);

  const server = await startTestServer({ env: { RAILWAY_ENVIRONMENT: "production" }, stateJson: sampleState() });
  t.after(() => server.close());
  const health = await server.client().get("/api/health");
  assert.equal(health.status, 503);
  assert.equal(server.app.health.import, null, "aucun import tant que le stockage n'est pas sûr");
});

test("volume remplacé : la base connaît des fichiers absents du disque → échec détecté", async (t) => {
  const server = await startTestServer({ uploads: { "1700000000000-11111111-2222-3333-4444-555555555555-a.pdf": "x" }, stateJson: sampleState() });
  t.after(() => server.close());
  assert.equal((await checkVolumeIdentity(server.app.db, { dataDir: server.dataDir })).ok, true);
  fs.rmSync(path.join(server.dataDir, MARKER));
  const result = await checkVolumeIdentity(server.app.db, { dataDir: server.dataDir });
  assert.equal(result.ok, false);
  assert.match(result.reason, /volume absent ou remplacé/);
});

// ---------- Sauvegardes ----------

test("sauvegarde puis test de restauration : identique, sans aucune trace dans la base", async (t) => {
  const server = await startTestServer({
    stateJson: sampleState(),
    uploads: { "1700000000000-11111111-2222-3333-4444-555555555555-facture.pdf": "%PDF" },
  });
  t.after(() => server.close());
  const { client } = await loggedInClient(server);
  const created = await client.post("/api/admin/backups", {});
  assert.equal(created.status, 201);
  assert.equal(created.data.counts.app_state, 1);
  assert.equal(created.data.missingUploads, 0);

  const tested = await client.post(`/api/admin/backups/${created.data.name}/restore-test`, {});
  assert.equal(tested.status, 200);
  assert.equal(tested.data.ok, true, JSON.stringify(tested.data));
  assert.equal(tested.data.state.hashMatch, true);
  assert.equal(tested.data.tables.users.restored, 1);

  const schemas = await server.app.db.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'restore_test_%'");
  assert.equal(schemas.length, 0, "le schéma temporaire est annulé");

  const download = await client.get(`/api/admin/backups/${created.data.name}`);
  assert.equal(download.status, 200);
  assert.equal((await client.get("/api/admin/backups/..%2Fstate.json")).status, 400);

  // Une pièce jointe disparue est signalée par le test de restauration.
  fs.rmSync(path.join(server.app.uploadDir, "1700000000000-11111111-2222-3333-4444-555555555555-facture.pdf"));
  const degraded = await server.app.backups.restoreTest(created.data.name);
  assert.equal(degraded.ok, false);
  assert.equal(degraded.uploads.missing.length, 1);
});

test("restauration réelle : retour exact à la sauvegarde, sauvegarde de sécurité créée avant", async (t) => {
  const server = await startTestServer({ stateJson: sampleState() });
  t.after(() => server.close());
  const { client } = await loggedInClient(server);
  const backup = await server.app.backups.create({ kind: "manuel" });
  const changed = { ...sampleState(), projects: [...sampleState().projects, { id: "p4", name: "Nouveau" }] };
  assert.equal((await client.put("/api/state", changed, { headers: { "X-Nova-State-Version": "1" } })).status, 200);

  const result = await server.app.backups.restore(backup.name);
  assert.match(result.safetyBackup, /^nova-avant-restauration-/);
  const restored = await server.app.stateStore.get();
  assert.equal(restored.data.projects.length, 3);
  assert.equal(restored.version, 3, "nouvelle version, supérieure à toutes les précédentes");
  assert.equal(result.version, 3);
  const history = await server.app.stateStore.history();
  assert.deepEqual(history.map((h) => h.version), [3, 2, 1], "l'historique est conservé");
  assert.equal(security.canonicalHash(restored.data), security.canonicalHash(sampleState()));
  assert.equal((await client.get("/api/state")).status, 401, "sessions fermées après restauration");
});
