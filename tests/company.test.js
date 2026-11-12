"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDb } = require("../lib/db");
const { MIGRATIONS, migrate } = require("../lib/migrations");
const { DEFAULT_COMPANY, normalizeCompany, missingFields } = require("../lib/company");
const { ROLES } = require("../lib/auth");
const { startTestServer, loggedInClient } = require("./helpers");

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("profil par défaut : générique, échéancier 30/30/30/10, TVA BTP, marges", () => {
  const company = normalizeCompany({});
  assert.equal(company.name, "", "aucun nom de client écrit dans le code");
  assert.deepEqual(company.billing.invoiceSchedule.map((step) => step.percent), [30, 30, 30, 10]);
  assert.deepEqual(company.billing.vatRates, [20, 10, 5.5]);
  assert.equal(company.billing.defaultVatRate, 20);
  assert.deepEqual(company.margins, DEFAULT_COMPANY.margins);
  assert.ok(missingFields(company).includes("SIRET"));
  assert.ok(missingFields(company).some((field) => field.startsWith("Assurance décennale")));
});

test("profil : validations (SIRET, échéancier à 100 %, TVA par défaut, RGE)", () => {
  assert.throws(() => normalizeCompany({ siret: "123" }), /14 chiffres/);
  assert.throws(() => normalizeCompany({ billing: { invoiceSchedule: [{ label: "Acompte", percent: 40 }, { label: "Solde", percent: 50 }] } }), /100 %/);
  assert.throws(() => normalizeCompany({ billing: { vatRates: [20, 10], defaultVatRate: 5.5 } }), /TVA par défaut/);
  const ok = normalizeCompany({
    siret: "123 456 789 00012",
    vatNumber: "fr 12 123456789",
    billing: { invoiceSchedule: [{ label: "Acompte", percent: "40" }, { label: "Solde", percent: "60" }], vatRates: ["5,5", 20, 20], defaultVatRate: "5,5" },
    rge: { certified: true },
  });
  assert.equal(ok.siret, "12345678900012");
  assert.equal(ok.vatNumber, "FR12123456789");
  assert.deepEqual(ok.billing.vatRates, [20, 5.5]);
  assert.equal(ok.billing.defaultVatRate, 5.5);
  assert.ok(missingFields(ok).includes("Numéro RGE"));
});

test("rôles standards BTP, dont chargé de projet et comptabilité", () => {
  assert.deepEqual(Object.keys(ROLES), ["admin", "direction_commerciale", "commercial", "conducteur_travaux", "secretariat", "comptabilite"]);
  assert.equal(ROLES.conducteur_travaux.label, "Chargé de projet");
  assert.equal(ROLES.admin.mfa, true);
  assert.equal(ROLES.comptabilite.mfa, true);
});

test("mise à jour d'une base existante (001) : comptes conservés, nouveaux rôles acceptés", async (t) => {
  const db = await createDb({ memory: true });
  t.after(() => db.close());
  await db.exec("CREATE TABLE schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  await db.exec(MIGRATIONS[0].sql);
  await db.query("INSERT INTO schema_migrations (id) VALUES ('001_socle')");
  await db.query("INSERT INTO users (email, display_name, role, password_hash) VALUES ('sec@test.fr', 'Secrétaire', 'secretariat', 'x')");
  await assert.rejects(db.query("INSERT INTO users (email, display_name, role, password_hash) VALUES ('ct@test.fr', 'CT', 'conducteur_travaux', 'x')"));

  assert.deepEqual((await migrate(db)).slice(0, 1), ["002_produit_btp"]);
  await db.query("INSERT INTO users (email, display_name, role, password_hash) VALUES ('ct@test.fr', 'CT', 'conducteur_travaux', 'x')");
  await assert.rejects(db.query("INSERT INTO users (email, display_name, role, password_hash) VALUES ('x@test.fr', 'X', 'stagiaire', 'x')"));
  const rows = await db.query("SELECT email, role FROM users ORDER BY email");
  assert.deepEqual(rows.map((row) => row.role), ["conducteur_travaux", "secretariat"]);
  assert.deepEqual(await migrate(db), [], "migration idempotente");
});

test("entreprise : nom initial, branding public, modification réservée à l'administrateur, logo vérifié", async (t) => {
  const server = await startTestServer({ env: { NOVA_COMPANY_NAME: "Rénovation Dupont" } });
  t.after(() => server.close());
  const anonymous = server.client();
  const branding = await anonymous.get("/api/public/branding");
  assert.deepEqual(branding.data, { name: "Rénovation Dupont", hasLogo: false, logoVersion: null });
  assert.equal((await anonymous.get("/api/company")).status, 401, "profil complet réservé aux comptes connectés");

  const { client: commercial } = await loggedInClient(server, { email: "co@test.fr", role: "commercial", name: "Karim" });
  assert.equal((await commercial.get("/api/company")).status, 200);
  assert.equal((await commercial.put("/api/admin/company", { name: "Pirate" })).status, 403);

  const { client: admin } = await loggedInClient(server, { email: "admin@test.fr" });
  const saved = await admin.put("/api/admin/company", {
    siret: "12345678900012",
    address: { line: "1 rue des Artisans", postalCode: "59000", city: "Lille" },
    insurance: { insurer: "SMABTP", policyNumber: "D-123", coverage: "France métropolitaine" },
    billing: { invoiceSchedule: [{ label: "Acompte", percent: 40 }, { label: "Solde", percent: 60 }] },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.company.name, "Rénovation Dupont", "les champs absents sont conservés");
  assert.deepEqual(saved.data.missing, []);
  assert.equal((await admin.put("/api/admin/company", { billing: { invoiceSchedule: [{ label: "Acompte", percent: 50 }] } })).status, 400);

  const fake = "data:image/png;base64," + Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
  assert.equal((await admin.post("/api/admin/company/logo", { dataUrl: fake })).status, 415, "contenu non image refusé");
  const logo = await admin.post("/api/admin/company/logo", { dataUrl: PNG_1PX });
  assert.equal(logo.status, 200);
  const publicBranding = await anonymous.get("/api/public/branding");
  assert.equal(publicBranding.data.hasLogo, true);
  const image = await anonymous.get("/api/public/logo");
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");

  const audit = await server.app.db.query("SELECT action FROM audit_log WHERE entity = 'company' ORDER BY id");
  assert.deepEqual(audit.map((row) => row.action), ["company.bootstrap", "company.update", "company.logo_updated"]);
  const users = await admin.get("/api/admin/users");
  assert.equal(users.data.roles.conducteur_travaux.label, "Chargé de projet");
});
