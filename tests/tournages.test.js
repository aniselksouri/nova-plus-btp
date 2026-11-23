"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer } = require("./helpers");
const { planNovaSync, deepMerge } = require("../lib/tournages");

const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const projects = [
  { id: "chantier-1", name: "SDB Dupont", client: "Famille Dupont", address: "14 rue Nationale, Lille", startDate: day(-10), endDate: day(20), status: "Devis importé", archived: false, lots: [{ amount: 4200 }] },
  { id: "chantier-2", name: "Cuisine Martin", client: "M. Martin", address: "", startDate: day(5), endDate: day(30), status: "Devis", archived: false },
  { id: "chantier-3", name: "Façade", client: "Mme Roussel", address: "", startDate: day(-90), endDate: day(-40), status: "Devis importé", archived: false },
  { id: "chantier-4", name: "Extension", client: "Mme Benali", address: "8 rue du Moulin", startDate: day(3), endDate: day(40), status: "Devis importé", archived: false },
  { id: "chantier-5", name: "Toiture", client: "M. Petit", address: "", startDate: day(-5), endDate: day(10), status: "Devis importé", archived: true },
];
const KEY = "cle-tournages";
const api = (server, path, init = {}) =>
  fetch(server.base + path, { ...init, headers: { "Content-Type": "application/json", "X-Tournages-Key": KEY, ...(init.headers || {}) } });

test("tournages : lien secret obligatoire pour la page, l'API et les photos", async (t) => {
  const server = await startTestServer({ env: { NOVA_TOURNAGES_KEY: KEY }, stateJson: { projects } });
  t.after(() => server.close());

  const bad = await fetch(`${server.base}/tournages?k=faux`);
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /Lien incomplet/);
  const page = await fetch(`${server.base}/tournages?k=${KEY}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /apple-touch-icon/);
  assert.ok(html.includes(`/tournages/manifest.webmanifest?k=${KEY}`), "manifeste lié avec la clé, pour l'écran d'accueil");
  assert.ok(!html.includes("__LOGO__"));

  const manifest = await (await fetch(`${server.base}/tournages/manifest.webmanifest?k=${KEY}`)).json();
  assert.equal(manifest.start_url, `/tournages?k=${KEY}`);
  assert.equal((await fetch(`${server.base}/tournages/icon-180.png`)).status, 200);

  assert.equal((await fetch(`${server.base}/api/tournages`)).status, 401);
  assert.equal((await api(server, "/api/tournages", { headers: { "X-Tournages-Key": "faux" } })).status, 401);
  assert.equal((await fetch(`${server.base}/tournages/photo/x.jpg?k=faux`)).status, 401);
});

test("tournages : chantiers Nova+ importés, modifications fusionnées, suppression définitive pour le suivi", async (t) => {
  const server = await startTestServer({ env: { NOVA_TOURNAGES_KEY: KEY }, stateJson: { projects } });
  t.after(() => server.close());

  const first = await (await api(server, "/api/tournages")).json();
  const ids = first.docs.map((d) => d.id).sort();
  assert.deepEqual(ids, ["nova-chantier-1", "nova-chantier-4"], "ni devis non signé, ni chantier fini depuis longtemps, ni archivé");
  const dupont = first.docs.find((d) => d.id === "nova-chantier-1").data;
  assert.equal(dupont.avant.statut, "non_requis", "déjà commencé : pas de tournage avant en retard");
  assert.equal(first.docs.find((d) => d.id === "nova-chantier-4").data.avant.statut, "a_faire");
  assert.ok(!JSON.stringify(first).includes("4200"), "aucun montant Nova+");

  const same = await (await api(server, `/api/tournages?rev=${encodeURIComponent(first.rev)}`)).json();
  assert.equal(same.same, true, "rien de neuf : réponse légère");

  const patched = await api(server, "/api/tournages/nova-chantier-4", { method: "PATCH", body: JSON.stringify({ patch: { avant: { statut: "tourne", par: "Anis" }, notes: "Digicode 1234" } }) });
  assert.equal(patched.status, 200);
  const created = await api(server, "/api/tournages/c123", { method: "PUT", body: JSON.stringify({ data: { client: "Nouveau", debut: day(2) } }) });
  assert.equal(created.status, 200);
  const after = await (await api(server, "/api/tournages")).json();
  const benali = after.docs.find((d) => d.id === "nova-chantier-4").data;
  assert.equal(benali.avant.statut, "tourne");
  assert.deepEqual(benali.avant.formats, { photo: true, video: true }, "fusion profonde : les formats restent");
  assert.equal(benali.notes, "Digicode 1234");
  assert.ok(after.docs.some((d) => d.id === "c123"));

  assert.equal((await api(server, "/api/tournages/nova-chantier-4", { method: "DELETE" })).status, 200);
  const gone = await (await api(server, "/api/tournages")).json();
  assert.ok(!gone.docs.some((d) => d.id === "nova-chantier-4"));
  assert.equal((await api(server, "/api/tournages/nova-chantier-4", { method: "PATCH", body: JSON.stringify({ patch: { notes: "x" } }) })).status, 404);

});

test("tournages : photos enregistrées comme fichiers Nova+ et servies seulement avec la clé", async (t) => {
  const server = await startTestServer({ env: { NOVA_TOURNAGES_KEY: KEY }, stateJson: { projects } });
  t.after(() => server.close());
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const refused = await api(server, "/api/tournages/photos", { method: "POST", body: JSON.stringify({ type: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERi0=" }) });
  assert.equal(refused.status, 415);
  const upload = await api(server, "/api/tournages/photos", { method: "POST", body: JSON.stringify({ type: "image/png", dataUrl: png }) });
  assert.equal(upload.status, 200);
  const { id, url } = await upload.json();
  assert.match(id, /tournage-photo\.png$/);
  const photo = await fetch(`${server.base}${url}?k=${KEY}`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/png");
  assert.equal((await fetch(`${server.base}${url}`)).status, 401);
  assert.equal((await fetch(`${server.base}/tournages/photo/devis.pdf?k=${KEY}`)).status, 404, "seules les photos de tournage sont servies");
});

test("tournages : Nova+ ne remplace une valeur que quand Nova+ la change", () => {
  const now = new Date();
  const first = planNovaSync(projects, [], { now });
  const doc = { id: "nova-chantier-1", data: first.creates.find((c) => c.id === "nova-chantier-1").data };

  // Correction faite dans le suivi, Nova+ inchangé : on la garde.
  doc.data = deepMerge(doc.data, { fin: day(25), finConfirmee: true });
  assert.equal(planNovaSync(projects, [doc], { now }).updates.length, 0);

  // Nova+ décale la fin : elle remplace, et repasse à confirmer.
  const moved = projects.map((p) => (p.id === "chantier-1" ? { ...p, endDate: day(35) } : p));
  const { updates } = planNovaSync(moved, [doc], { now });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].patch.fin, day(35));
  assert.equal(updates[0].patch.finConfirmee, false);
  assert.match(updates[0].patch.log.at(-1).m, /^Nova\+ : fin au /);

  // Chantier saisi à la main avec le nom Nova+ : relié, pas dupliqué.
  const manual = { id: "c9", data: { client: "Benali", ref: "Extension", debut: day(3) } };
  const linked = planNovaSync(projects, [manual], { now });
  assert.ok(!linked.creates.some((c) => c.id === "nova-chantier-4"));
  assert.equal(linked.updates.find((u) => u.id === "c9").patch.nova.id, "chantier-4");

  // Supprimé du suivi : ne revient pas.
  assert.equal(planNovaSync(projects, [{ ...doc, deleted: true }], { now }).creates.some((c) => c.id === "nova-chantier-1"), false);
});
