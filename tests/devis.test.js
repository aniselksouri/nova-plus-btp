"use strict";

// Parcours V1 complet : bibliothèque → grille ST signée → dossier → devis → hors grille →
// envoi → signature (rétractation) → bon de commande → chantier → avenant → PV de réception.

const test = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, loggedInClient } = require("./helpers");
const { withdrawalEnd } = require("../lib/quotes");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FAKE_PDF = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n% grille signée\n").toString("base64")}`;
const CSV = [
  "Code;Lot;Libellé;Description;Unité;Coût ST;Fournisseur;Prix public;Prix pro;Marge prestation;Marge fourniture;TVA",
  'CAR-01;Carrelage;Pose carrelage sol 60x60;"Collé, joints compris";m2;28;Fournisseur X;30;22;45;;10',
  "PLB-01;Plomberie;Remplacement WC suspendu;Bâti-support compris;u;180;Négoce Y;420;300;45;28;10",
  "PEI-01;Peinture;Peinture murs 2 couches;;m²;9,5;;;;;;20",
].join("\r\n");

const legacyState = {
  activeProjectId: "p-hsm",
  settings: { targetMargin: 28 },
  projects: [{ id: "p-hsm", name: "M. et Mme LARGE", client: "LARGE", lots: [{ id: "l1", name: "Carrelage", sale: 2831.85, labor: 980, material: 770 }], invoices: [], documents: [] }],
  subcontractors: [{ id: "sub-1", companyName: "MAJID BTP", trade: "Électricité" }],
  suppliers: [],
};

async function setup(t) {
  const server = await startTestServer({ stateJson: legacyState, env: { NOVA_COMPANY_NAME: "Rénovation Test" } });
  t.after(() => server.close());
  const admin = await loggedInClient(server, { email: "admin@test.fr" });
  return { server, admin: admin.client };
}

const ok = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
};

async function buildLibraryAndGrid(admin) {
  const preview = ok(await admin.post("/api/library/import", { csv: CSV }));
  assert.equal(preview.report.applied, false, "simulation d'abord");
  assert.equal(preview.report.created, 3);
  assert.deepEqual(preview.report.lotsCreated, ["Carrelage", "Plomberie", "Peinture"]);
  ok(await admin.post("/api/library/import", { csv: CSV, apply: true }));
  const { items } = ok(await admin.get("/api/library/items"));
  const byCode = Object.fromEntries(items.map((item) => [item.code, item]));
  assert.equal(byCode["CAR-01"].unit, "m²");
  assert.equal(byCode["PEI-01"].laborCost, 9.5);

  const { subcontractor: st } = ok(await admin.post("/api/st", { name: "Carrelages du Nord", siret: "12345678900012", lots: "Carrelage, Faïence", email: "st@nord.fr" }));
  for (const kind of ["decennale", "kbis", "urssaf"]) ok(await admin.post(`/api/st/${st.id}/documents`, { kind, expiresOn: "2099-12-31" }));
  const today = new Date().toISOString().slice(0, 10);
  const { grid } = ok(await admin.post("/api/grids", { subcontractorId: st.id, startsOn: today, endsOn: "2099-12-31", lines: [{ itemId: byCode["CAR-01"].id, laborPrice: 28 }, { itemId: byCode["PLB-01"].id, laborPrice: "180,00" }] }));
  assert.equal(grid.status, "draft");
  const pdf = await admin.get(`/api/grids/${grid.id}/pdf`);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.data, /^%PDF/);
  assert.equal(ok(await admin.post(`/api/grids/${grid.id}/send`)).grid.status, "sent");
  const signed = ok(await admin.post(`/api/grids/${grid.id}/signed`, { file: { name: "grille.pdf", type: "application/pdf", dataUrl: FAKE_PDF } })).grid;
  assert.equal(signed.status, "signed");
  assert.equal((await admin.put(`/api/grids/${grid.id}`, { lines: [] })).status, 409, "grille signée non modifiable");
  return { byCode, st, grid: signed };
}

test("rétractation : 14 jours, prolongés au lundi si le délai finit un week-end", () => {
  assert.equal(withdrawalEnd("2026-11-02"), "2026-11-16"); // lundi → lundi
  assert.equal(withdrawalEnd("2026-11-07"), "2026-11-23"); // samedi + 14 = samedi → lundi
});

test("parcours complet : devis signé sur place → bon de commande ST → chantier créé sans toucher l'existant", async (t) => {
  const { server, admin } = await setup(t);
  const { byCode, st } = await buildLibraryAndGrid(admin);

  // Le sous-traitant de l'application chantiers est repris dans le module ST.
  const { subcontractors } = ok(await admin.get("/api/st"));
  assert.ok(subcontractors.some((s) => s.name === "MAJID BTP" && s.legacyId === "sub-1"));
  assert.equal(subcontractors.find((s) => s.name === "MAJID BTP").compliance.blocked, true, "documents manquants signalés");

  const commercial = await loggedInClient(server, { email: "karim@test.fr", role: "commercial", name: "Karim" });
  await server.app.db.query("UPDATE users SET commission_rate = 5 WHERE email = 'karim@test.fr'");

  const { dossier } = ok(await admin.post("/api/dossiers", { clientName: "M. et Mme DURAND", siteAddress: "3 rue des Lilas, 59000 Lille", offPremises: true, commercialId: commercial.user.id }));
  const { quote } = ok(await admin.post(`/api/dossiers/${dossier.id}/quotes`, { title: "Rénovation salle de bain" }));
  assert.match(quote.number, /^\d{4}-001$/);
  assert.equal(quote.commissionRate, 5);
  assert.deepEqual(quote.schedule.map((s) => s.percent), [30, 30, 30, 10]);

  let q = ok(await admin.post(`/api/quotes/${quote.id}/lines-from-library`, { itemIds: [byCode["CAR-01"].id], subcontractorId: st.id })).quote;
  const line = { ...q.lines[0], quantity: 35 };
  q = ok(await admin.put(`/api/quotes/${quote.id}`, { lines: [line] })).quote;
  // Exemple du cahier des charges : 35 m² à 28 €/m² ST, 45 % de marge, fourniture 22 € pro / 30 € public.
  assert.equal(q.computed.sale, 2831.85);
  assert.equal(q.computed.cost, 1750);
  assert.equal(q.computed.margin, 1081.85);
  assert.equal(q.computed.marginRate, 38.2);
  assert.equal(q.computed.commission, 141.59);
  assert.deepEqual(q.computed.vatLines, [{ rate: 10, base: 2831.85, vat: 283.19 }]);
  assert.equal(q.computed.blocking.length, 0);

  // Prix hors grille : badge, écart, motif obligatoire.
  q = ok(await admin.put(`/api/quotes/${quote.id}`, { lines: [{ ...q.lines[0], laborCostSource: "manual", laborCost: 30 }] })).quote;
  assert.equal(q.computed.exceptions[0].diff, 2);
  assert.equal(q.computed.exceptions[0].diffRate, 7.14);
  assert.ok(q.computed.blocking.some((a) => a.code === "reason_missing"));
  q = ok(await admin.put(`/api/quotes/${quote.id}`, { lines: [{ ...q.lines[0], exceptionReason: "Accès difficile, 3e étage sans ascenseur" }] })).quote;
  assert.equal(q.computed.blocking.length, 0);

  // Droits : le commercial voit son dossier et sa commission ; le secrétariat ne voit ni coûts ni commission.
  const mine = ok(await commercial.client.get(`/api/quotes/${quote.id}`)).quote;
  assert.equal(mine.computed.commission, 147.96); // 5 % de 2 959,25 € (coût ST 30 € à 45 % de marge)
  const other = await loggedInClient(server, { email: "sophie@test.fr", role: "commercial", name: "Sophie" });
  assert.equal((await other.client.get(`/api/quotes/${quote.id}`)).status, 404);
  assert.equal(ok(await other.client.get("/api/dossiers")).dossiers.length, 0);
  const secretary = await loggedInClient(server, { email: "sec@test.fr", role: "secretariat", name: "Nadia" });
  const seen = ok(await secretary.client.get(`/api/quotes/${quote.id}`)).quote;
  assert.equal(seen.computed.cost, undefined);
  assert.equal(seen.lines[0].laborCost, undefined);
  assert.equal(seen.commissionRate, null);
  assert.equal((await secretary.client.put(`/api/quotes/${quote.id}`, { title: "x" })).status, 403);

  // PDF client et envoi.
  const pdf = await admin.get(`/api/quotes/${quote.id}/pdf`);
  assert.match(pdf.data, /^%PDF/);
  q = ok(await admin.post(`/api/quotes/${quote.id}/send`)).quote;
  assert.equal(q.status, "sent");
  assert.equal((await admin.put(`/api/quotes/${quote.id}`, { title: "modif" })).status, 409, "devis envoyé : nouvelle version obligatoire");

  // Signature sur place.
  assert.equal((await admin.post(`/api/quotes/${quote.id}/sign`, { signatureImage: PNG, signerName: "Paul Durand" })).status, 400, "« Bon pour accord » obligatoire");
  const signed = ok(await admin.post(`/api/quotes/${quote.id}/sign`, { signatureImage: PNG, signerName: "Paul Durand", accepted: true }));
  assert.equal(signed.quote.status, "signed");
  assert.match(signed.quote.signedUrl, /^\/uploads\/.+-signe\.pdf$/);
  assert.ok(signed.quote.withdrawalUntil, "rétractation calculée");
  assert.equal(signed.orders.length, 1);
  assert.equal(signed.orders[0].status, "ready");
  assert.equal(signed.orders[0].total, 1050, "BC au coût ST figé (35 × 30 €), sans prix de vente");
  assert.equal(signed.chantier.created, true);
  assert.equal((await admin.put(`/api/quotes/${quote.id}`, { title: "x" })).status, 409, "devis signé figé");
  const orderPdf = await admin.get(`/api/orders/${signed.orders[0].id}/pdf`);
  assert.match(orderPdf.data, /^%PDF/);

  // Chantier créé dans l'application de suivi, l'existant intact.
  const state = ok(await admin.get("/api/state"));
  assert.equal(state.projects.length, 2);
  assert.deepEqual(state.projects[0], legacyState.projects[0], "chantier HSM existant inchangé");
  const project = state.projects[1];
  assert.equal(project.name, "M. et Mme DURAND");
  assert.equal(project.lots[0].sale, 2959.25);
  assert.equal(project.lots[0].labor, 1050);
  assert.equal(project.lots[0].laborType, "subcontractor");
  assert.ok(project.startDate > signed.quote.withdrawalUntil, "démarrage après la rétractation");
  const signedDay = new Date(signed.quote.signedAt).toISOString().slice(0, 10);
  assert.ok(project.invoices[0].date >= new Date(new Date(`${signedDay}T12:00:00Z`).getTime() + 8 * 86400000).toISOString().slice(0, 10), "aucun paiement avant J+8");
  assert.equal(state.subcontractors.length, 2, "ST du devis ajouté à la liste du suivi");

  // Coûts figés : un nouveau prix de grille ne modifie pas le devis signé.
  const { grids } = ok(await admin.get(`/api/grids?st=${st.id}`));
  const v2 = ok(await admin.post(`/api/grids/${grids[0].id}/new-version`)).grid;
  ok(await admin.put(`/api/grids/${v2.id}`, { lines: v2.lines.map((l) => ({ ...l, laborPrice: l.code === "CAR-01" ? 40 : l.laborPrice })) }));
  ok(await admin.post(`/api/grids/${v2.id}/signed`, { file: { name: "v2.pdf", type: "application/pdf", dataUrl: FAKE_PDF } }));
  assert.equal(ok(await admin.get(`/api/quotes/${quote.id}`)).quote.computed.sale, signed.quote.computed.sale);
  assert.equal(signed.quote.computed.sale, 2959.25);

  // Avenant : moins-value et travaux supplémentaires, payés à part.
  const amendment = ok(await admin.post(`/api/quotes/${quote.id}/amendment`, { title: "TS peinture" })).quote;
  assert.equal(amendment.amendmentNo, 1);
  assert.equal(amendment.number, quote.number);
  let a = ok(await admin.post(`/api/quotes/${amendment.id}/lines-from-library`, { itemIds: [byCode["PLB-01"].id], subcontractorId: st.id })).quote;
  a = ok(await admin.put(`/api/quotes/${amendment.id}`, { lines: [{ ...a.lines[0], quantity: -1 }] })).quote;
  assert.ok(a.computed.sale < 0, "moins-value");
  assert.equal(a.lines[0].gridLaborCost, 180, "prix ST de la grille v2 en vigueur");
  ok(await admin.post(`/api/quotes/${amendment.id}/sign`, { signatureImage: PNG, accepted: true }));
  const dossierAfter = ok(await admin.get(`/api/dossiers/${dossier.id}`)).dossier;
  assert.equal(dossierAfter.recap.amendments, 1);
  assert.equal(dossierAfter.recap.signedSale, Math.round((2959.25 + a.computed.sale) * 100) / 100);
  assert.ok(dossierAfter.recap.schedule.some((step) => step.label.includes("avenant 1")));
  const after = ok(await admin.get("/api/state"));
  assert.equal(after.projects.length, 2, "l'avenant complète le même chantier");
  assert.ok(after.projects[1].lots.some((lot) => lot.name.startsWith("Avenant 1 · ")));

  // PV de réception : déclenche le solde.
  const { reception } = ok(await admin.post(`/api/dossiers/${dossier.id}/receptions`, { receivedOn: "2027-02-15", reserves: [{ label: "Joint silicone douche à reprendre", lot: "Carrelage" }] }));
  const pv = ok(await admin.post(`/api/receptions/${reception.id}/sign`, { signatureImage: PNG, signerName: "Paul Durand" })).reception;
  assert.equal(pv.status, "signed");
  const final = ok(await admin.get("/api/state")).projects[1];
  assert.equal(final.invoices.at(-1).date, "2027-02-15");
  assert.match(final.invoices.at(-1).action, /PV de réception signé avec 1 réserve/);

  // Rapport des exceptions du mois.
  const report = ok(await admin.get("/api/reports/exceptions")).report;
  const costException = report.items.find((item) => item.reason.startsWith("Accès difficile"));
  assert.ok(costException);
  assert.equal(costException.kind, "cost");
  assert.equal(costException.kindLabel, "Coût ST hors grille");
  assert.notEqual(costException.label, costException.kindLabel, "la colonne Ligne affiche l'ouvrage, pas le type d'écart");
  assert.equal((await commercial.client.get("/api/reports/exceptions")).status, 403);

  // Sauvegarde : les nouvelles tables sont incluses et le test de restauration réussit.
  const backup = await server.app.backups.create({ kind: "manuel" });
  const restoreTest = await server.app.backups.restoreTest(backup.name);
  assert.equal(restoreTest.tables.quotes.restored, 2);
  assert.equal(restoreTest.ok, true, JSON.stringify(restoreTest));
  assert.equal(restoreTest.tables.quote_lines.ok, true);

  const audit = (await server.app.db.query("SELECT action FROM audit_log")).map((r) => r.action);
  for (const action of ["library.import", "grid.signed", "quote.signed", "orders.created", "chantier.created_from_quote", "chantier.amendment_added", "reception.signed"]) assert.ok(audit.includes(action), action);
});

test("ligne sans prix ST validé : signature bloquée, forçage réservé à l'administrateur et journalisé", async (t) => {
  const { server, admin } = await setup(t);
  const { byCode } = await buildLibraryAndGrid(admin);
  const commercial = await loggedInClient(server, { email: "karim@test.fr", role: "commercial", name: "Karim" });
  const { dossier } = ok(await commercial.client.post("/api/dossiers", { clientName: "SCI Les Tilleuls" }));
  assert.equal(dossier.commercialId, commercial.user.id, "dossier rattaché au commercial");
  const { quote } = ok(await commercial.client.post(`/api/dossiers/${dossier.id}/quotes`, {}));
  const q = ok(await commercial.client.post(`/api/quotes/${quote.id}/lines-from-library`, { itemIds: [byCode["PEI-01"].id] })).quote;
  assert.equal(q.computed.blocking[0].code, "no_st_price");
  assert.equal(q.lines[0].laborCost, 9.5, "coût de référence de la bibliothèque en attendant la grille");
  const refused = await commercial.client.post(`/api/quotes/${quote.id}/sign`, { signatureImage: PNG, accepted: true, force: true });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, "quote_blocked");
  const forced = ok(await admin.post(`/api/quotes/${quote.id}/sign`, { signatureImage: PNG, accepted: true, force: true }));
  assert.equal(forced.quote.forced, true);
  assert.equal(forced.orders.length, 0, "aucun ST : pas de bon de commande");
  const [entry] = await server.app.db.query("SELECT details FROM audit_log WHERE action = 'quote.forced'");
  assert.match(entry.details.alerts[0], /aucun prix ST validé/);
});

test("document ST expiré : bon de commande bloqué, débloqué après mise à jour", async (t) => {
  const { admin } = await setup(t);
  const { byCode, st } = await buildLibraryAndGrid(admin);
  ok(await admin.post(`/api/st/${st.id}/documents`, { kind: "urssaf", expiresOn: "2020-01-01" }));
  // L'attestation encore valable est retirée : seule reste celle expirée en 2020.
  const valid = ok(await admin.get(`/api/st/${st.id}`)).subcontractor.documents.find((d) => d.kind === "urssaf" && d.expiresOn === "2099-12-31");
  ok(await admin.del(`/api/st/documents/${valid.id}`));
  const compliance = ok(await admin.get(`/api/st/${st.id}`)).subcontractor.compliance;
  assert.equal(compliance.blocked, true);

  const { dossier } = ok(await admin.post("/api/dossiers", { clientName: "Mme Martin" }));
  const { quote } = ok(await admin.post(`/api/dossiers/${dossier.id}/quotes`, {}));
  ok(await admin.post(`/api/quotes/${quote.id}/lines-from-library`, { itemIds: [byCode["CAR-01"].id], subcontractorId: st.id }));
  const signed = ok(await admin.post(`/api/quotes/${quote.id}/sign`, { method: "upload", file: { name: "devis-signe.pdf", type: "application/pdf", dataUrl: FAKE_PDF } }));
  assert.equal(signed.orders[0].status, "blocked");
  assert.match(signed.orders[0].blockedReason, /URSSAF expirée/);
  assert.equal((await admin.get(`/api/orders/${signed.orders[0].id}/pdf`)).status, 409);
  assert.equal((await admin.post(`/api/orders/${signed.orders[0].id}/recheck`)).status, 409);
  ok(await admin.post(`/api/st/${st.id}/documents`, { kind: "urssaf" })); // validité par défaut : 6 mois
  assert.equal(ok(await admin.post(`/api/orders/${signed.orders[0].id}/recheck`)).order.status, "ready");
});
