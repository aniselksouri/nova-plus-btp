"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers");

const projects = [
  { id: "chantier-1", name: "SDB Dupont", client: "Famille Dupont", address: "14 rue Nationale, Lille", startDate: "2026-11-10", endDate: "2026-11-28", status: "Devis signé", archived: false, lots: [{ name: "Plomberie", amount: 4200 }], invoices: [{ amount: 1000 }], documents: [{ name: "devis.pdf" }] },
  { id: "chantier-2", name: "Cuisine Martin", client: "M. Martin", address: "", startDate: "2026-12-01", endDate: "", status: "Devis", archived: true },
];

test("export du suivi : clé obligatoire, lecture seule, champs strictement limités", async (t) => {
  const server = await startTestServer({ env: { NOVA_SUIVI_KEY: "cle-suivi" }, stateJson: { projects } });
  t.after(() => server.close());
  const url = `${server.base}/api/hooks/chantiers`;

  assert.equal((await fetch(url)).status, 401, "sans clé");
  assert.equal((await fetch(url, { headers: { "X-Nova-Key": "mauvaise" } })).status, 401, "mauvaise clé");
  assert.equal((await fetch(url, { method: "POST", headers: { "X-Nova-Key": "cle-suivi" } })).status, 405, "écriture refusée");

  const response = await fetch(url, { headers: { "X-Nova-Key": "cle-suivi" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.projects.length, 2);
  assert.deepEqual(body.projects[0], { id: "chantier-1", name: "SDB Dupont", client: "Famille Dupont", address: "14 rue Nationale, Lille", startDate: "2026-11-10", endDate: "2026-11-28", status: "Devis signé", archived: false });
  assert.equal(body.projects[1].archived, true);
  assert.ok(!JSON.stringify(body).includes("4200"), "aucun montant exposé");
});

test("export du suivi : 503 tant que la clé n'est pas configurée", async (t) => {
  const server = await startTestServer({ stateJson: { projects } });
  t.after(() => server.close());
  assert.equal((await fetch(`${server.base}/api/hooks/chantiers`, { headers: { "X-Nova-Key": "x" } })).status, 503);
});
