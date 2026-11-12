"use strict";

// Module 5 : entrée des leads (Meta, Google Ads, site), pipeline, relances, lien devis,
// objectifs, point mort, classement et confidentialité des commissions.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { startTestServer, loggedInClient } = require("./helpers");
const intake = require("../lib/leads-intake");

const FAKE_PDF = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n% devis signé\n").toString("base64")}`;
const ENV = { META_APP_SECRET: "secret-meta", META_VERIFY_TOKEN: "jeton-verif", META_PAGE_ACCESS_TOKEN: "jeton-page", NOVA_GOOGLE_LEADS_KEY: "cle-google", NOVA_WEBSITE_LEADS_KEY: "cle-site" };

const ok = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.data));
  return response.data;
};

function fakeMetaFetch(calls) {
  return async (url) => {
    calls.push(url);
    const id = new URL(url).pathname.split("/").pop();
    if (id === "lead-ko") return { ok: false, status: 400, json: async () => ({ error: { message: "jeton expiré" } }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id,
        created_time: "2026-11-03T09:15:00+0000",
        campaign_id: "120200",
        campaign_name: "SDB Lille novembre",
        ad_name: "Vidéo avant/après",
        adset_name: "Lille 30 km",
        form_id: "777",
        platform: "ig",
        field_data: [
          { name: "full_name", values: ["Julie Martin"] },
          { name: "phone_number", values: ["+33612345678"] },
          { name: "email", values: ["Julie.Martin@exemple.fr"] },
          { name: "code_postal", values: ["59000"] },
          { name: "quel_est_votre_projet_?", values: ["Salle de bain complète"] },
        ],
      }),
    };
  };
}

async function setup(t, options = {}) {
  const calls = [];
  const server = await startTestServer({ env: { ...ENV, ...(options.env || {}) }, fetch: fakeMetaFetch(calls) });
  t.after(() => server.close());
  const admin = await loggedInClient(server, { email: "admin@test.fr" });
  return { server, admin: admin.client, adminUser: admin.user, calls };
}

async function signedQuote(admin, { dossierId, laborCost = 600, margin = 40, commercialId }) {
  const { quote } = ok(await admin.post(`/api/dossiers/${dossierId}/quotes`, {}));
  const line = { label: "Travaux", lotName: "Divers", quantity: 1, unit: "u", mode: "both", stScope: "none", laborCostSource: "manual", laborCost, laborMargin: margin, vatRate: 10, exceptionReason: "Forfait", forced: true };
  ok(await admin.put(`/api/quotes/${quote.id}`, { lines: [line], ...(commercialId ? { commercialId } : {}) }));
  return ok(await admin.post(`/api/quotes/${quote.id}/sign`, { method: "upload", force: true, file: { name: "devis-signe.pdf", type: "application/pdf", dataUrl: FAKE_PDF } })).quote;
}

test("normalisation : téléphone FR, e-mail, champs de formulaires WordPress", () => {
  assert.equal(intake.normalizePhone("+33 6 12 34 56 78"), "06 12 34 56 78");
  assert.equal(intake.normalizePhone("0033612345678"), "06 12 34 56 78");
  assert.equal(intake.phoneKey("06 12 34 56 78"), intake.phoneKey("+33612345678"));
  assert.equal(intake.normalizeEmail("pas un mail"), null);
  const lead = intake.websiteLeadInput({ "your-name": "Paul", "your-email": "paul@ex.fr", "your-phone": "0611223344", "your-message": "Refaire la toiture", utm_campaign: "toiture-hiver", _wpcf7: "12" });
  assert.equal(lead.name, "Paul");
  assert.equal(lead.email, "paul@ex.fr");
  assert.equal(lead.need, "Refaire la toiture");
  assert.equal(lead.campaign, "toiture-hiver");
  assert.equal(lead.details._wpcf7, undefined);
});

test("Meta Lead Ads : vérification, signature, lecture du lead, campagne conservée, pas de doublon", async (t) => {
  const { server, admin, calls } = await setup(t);
  const anon = server.client();

  const challenge = await anon.get("/api/hooks/meta?hub.mode=subscribe&hub.verify_token=jeton-verif&hub.challenge=12345");
  assert.equal(challenge.status, 200);
  assert.equal(challenge.data, "12345");
  assert.equal((await anon.get("/api/hooks/meta?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=1")).status, 403);

  const payload = JSON.stringify({ object: "page", entry: [{ id: "page1", changes: [{ field: "leadgen", value: { leadgen_id: "lead-1", form_id: "777", page_id: "page1", created_time: 1762160100 } }] }] });
  const sign = (raw, secret = "secret-meta") => `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  const post = (raw, signature) => fetch(`${server.base}/api/hooks/meta`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature }, body: raw });

  assert.equal((await post(payload, sign(payload, "autre"))).status, 401, "signature d'une autre application refusée");
  const first = await post(payload, sign(payload));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, received: 1, created: 1 });
  assert.match(calls[0], /graph\.facebook\.com\/v23\.0\/lead-1\?fields=.*campaign_name/);
  const again = await post(payload, sign(payload));
  assert.equal((await again.json()).created, 0, "même lead renvoyé par Meta : ignoré");

  // Lecture impossible : le lead est gardé, marqué incomplet.
  const broken = JSON.stringify({ entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "lead-ko" } }] }] });
  assert.equal((await post(broken, sign(broken))).status, 200);

  const { leads } = ok(await admin.get("/api/leads"));
  assert.equal(leads.length, 2);
  const julie = leads.find((lead) => lead.name === "Julie Martin");
  assert.equal(julie.source, "meta");
  assert.equal(julie.campaign, "SDB Lille novembre");
  assert.equal(julie.adName, "Lille 30 km · Vidéo avant/après");
  assert.equal(julie.phone, "06 12 34 56 78");
  assert.equal(julie.email, "julie.martin@exemple.fr");
  assert.equal(julie.postalCode, "59000");
  assert.equal(julie.stage, "new");
  assert.equal(julie.details.Plateforme, "Instagram");
  assert.equal(leads.find((lead) => lead.incomplete).name, "Contact sans nom");
});

test("Google Ads et site WordPress : clé exigée, formulaire urlencoded, doublon détecté", async (t) => {
  const { server, admin } = await setup(t);
  const anon = server.client();
  const google = { lead_id: "g-1", api_version: "1.0", form_id: 44, campaign_id: 9876, adgroup_id: 55, gcl_id: "abc", is_test: true, user_column_data: [{ column_id: "FULL_NAME", string_value: "Marc Leroy" }, { column_id: "PHONE_NUMBER", string_value: "+33698765432" }, { column_name: "Type de travaux", string_value: "Toiture" }] };
  assert.equal((await anon.post("/api/hooks/google", { ...google, google_key: "faux" })).status, 401);
  assert.equal(ok(await anon.post("/api/hooks/google", { ...google, google_key: "cle-google" })).created, true);
  assert.equal(ok(await anon.post("/api/hooks/google", { ...google, google_key: "cle-google" })).created, false);

  const form = new URLSearchParams({ "your-name": "Marc Leroy", "your-phone": "06 98 76 54 32", "your-message": "Devis toiture", utm_source: "google" });
  const noKey = await fetch(`${server.base}/api/hooks/website`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  assert.equal(noKey.status, 401);
  const withKey = await fetch(`${server.base}/api/hooks/website`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Nova-Key": "cle-site" }, body: form });
  assert.equal(withKey.status, 200);
  // Requête venant d'un autre site avec un en-tête Origin : acceptée (clé), la règle même origine ne s'applique qu'aux sessions.
  const fromBrowser = await fetch(`${server.base}/api/hooks/website?key=cle-site`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.hsm-renovation.fr" }, body: JSON.stringify({ nom: "Nadia", email: "nadia@ex.fr" }) });
  assert.equal(fromBrowser.status, 200);

  const { leads } = ok(await admin.get("/api/leads"));
  const g = leads.find((lead) => lead.source === "google");
  assert.equal(g.isTest, true);
  assert.equal(g.campaign, "Campagne 9876");
  assert.equal(g.utm.gclid, "abc");
  assert.equal(g.need, "Toiture", "« Type de travaux » repris comme besoin");
  const site = leads.find((lead) => lead.source === "website" && lead.name === "Marc Leroy");
  assert.equal(site.duplicateOf, g.id, "même téléphone : doublon signalé");
  assert.equal(site.need, "Devis toiture");

  const unconfigured = await startTestServer({ env: {} });
  t.after(() => unconfigured.close());
  assert.equal((await unconfigured.client().post("/api/hooks/website", { nom: "X" })).status, 503);
});

test("tour de rôle, droits : un commercial ne voit que ses leads, la direction voit l'équipe", async (t) => {
  const { server, admin } = await setup(t);
  const karim = await loggedInClient(server, { email: "karim@test.fr", role: "commercial", name: "Karim" });
  const sarah = await loggedInClient(server, { email: "sarah@test.fr", role: "commercial", name: "Sarah" });
  const direction = await loggedInClient(server, { email: "dir@test.fr", role: "direction_commerciale", name: "Directrice" });
  const compta = await loggedInClient(server, { email: "compta@test.fr", role: "comptabilite", name: "Compta" });

  ok(await admin.put("/api/crm/settings", { assignment: "round_robin", rotation: [karim.user.id, sarah.user.id] }));
  const anon = server.client();
  for (const [i, name] of ["A", "B", "C", "D"].entries()) ok(await anon.post("/api/hooks/website", { key: "cle-site", nom: `Client ${name}`, telephone: `06000000${10 + i}` }));
  const { leads } = ok(await admin.get("/api/leads"));
  const owners = leads.map((lead) => lead.commercialName).sort();
  assert.deepEqual(owners, ["Karim", "Karim", "Sarah", "Sarah"], "répartition équitable");

  const mine = ok(await karim.client.get("/api/leads")).leads;
  assert.equal(mine.length, 2);
  assert.ok(mine.every((lead) => lead.commercialName === "Karim"));
  const other = leads.find((lead) => lead.commercialName === "Sarah");
  assert.equal((await karim.client.get(`/api/leads/${other.id}`)).status, 404);
  assert.equal((await karim.client.post(`/api/leads/${other.id}/assign`, { commercialId: karim.user.id })).status, 403);
  assert.equal(ok(await direction.client.get("/api/leads")).leads.length, 4);
  assert.equal((await compta.client.get("/api/leads")).status, 403);
  assert.equal((await karim.client.put("/api/crm/settings", { assignment: "manual" })).status, 403);

  // Saisie d'un appel par un commercial : le lead lui revient.
  const phone = ok(await karim.client.post("/api/leads", { name: "M. Dupont", phone: "0611223344", need: "Fuite sous évier", source: "phone" })).lead;
  assert.equal(phone.commercialName, "Karim");
  assert.equal(phone.source, "phone");
  assert.equal((await karim.client.post("/api/leads", { name: "Sans contact" })).status, 400);

  // Réattribution par la direction.
  const moved = ok(await direction.client.post(`/api/leads/${other.id}/assign`, { commercialId: karim.user.id })).lead;
  assert.equal(moved.commercialName, "Karim");
  assert.equal(ok(await karim.client.get("/api/leads")).leads.length, 4);
});

test("pipeline : motif de perte obligatoire, relances automatiques, historique, devis envoyé/signé → lead signé", async (t) => {
  let clock = new Date("2026-11-02T09:00:00Z");
  const server = await startTestServer({ env: ENV, nowDate: () => new Date(clock) });
  t.after(() => server.close());
  const admin = (await loggedInClient(server, { email: "admin@test.fr" })).client;
  const karim = await loggedInClient(server, { email: "karim@test.fr", role: "commercial", name: "Karim" });
  ok(await admin.put("/api/crm/settings", { stageDays: { new: 1, contacted: 2 } }));

  let lead = ok(await karim.client.post("/api/leads", { name: "Mme Rose", phone: "0700000001", source: "phone" })).lead;
  assert.equal(lead.tasks.length, 1);
  assert.equal(lead.tasks[0].title, "Premier appel");
  assert.equal(lead.overdue, false);

  clock = new Date("2026-11-03T12:00:00Z"); // plus d'un jour en « Nouveau »
  let reminders = ok(await karim.client.get("/api/crm/reminders")).leads;
  assert.deepEqual(reminders.map((l) => l.id), [lead.id]);
  assert.equal(reminders[0].stale, true);

  lead = ok(await karim.client.post(`/api/leads/${lead.id}/events`, { kind: "call", body: "Appelée, visite mardi" })).lead;
  lead = ok(await karim.client.post(`/api/leads/${lead.id}/stage`, { stage: "contacted" })).lead;
  assert.equal(lead.tasks.filter((task) => !task.doneAt).length, 1, "relance précédente close, nouvelle relance créée");
  assert.equal(lead.tasks.find((task) => !task.doneAt).title, "Planifier la visite");
  assert.equal(ok(await karim.client.get("/api/crm/reminders")).leads.length, 0);
  assert.equal((await karim.client.post(`/api/leads/${lead.id}/stage`, { stage: "lost" })).status, 400, "motif de perte obligatoire");

  const manual = ok(await karim.client.post(`/api/leads/${lead.id}/tasks`, { title: "Rappeler pour les plans", dueAt: "2026-11-04T08:00:00Z" })).lead;
  const task = manual.tasks.find((item) => item.title === "Rappeler pour les plans");
  lead = ok(await karim.client.post(`/api/lead-tasks/${task.id}`, { done: true })).lead;
  assert.ok(lead.tasks.find((item) => item.id === task.id).doneAt);

  // Dossier client depuis le lead, puis devis : envoyé → « Devis envoyé », signé → « Signé ».
  lead = ok(await karim.client.post(`/api/leads/${lead.id}/dossier`)).lead;
  assert.ok(lead.dossierId);
  const dossier = ok(await karim.client.get(`/api/dossiers/${lead.dossierId}`)).dossier;
  assert.equal(dossier.clientName, "Mme Rose");
  assert.equal(dossier.commercialId, karim.user.id);
  const { quote } = ok(await admin.post(`/api/dossiers/${lead.dossierId}/quotes`, {}));
  ok(await admin.put(`/api/quotes/${quote.id}`, { lines: [{ label: "Travaux", quantity: 1, unit: "u", mode: "both", stScope: "none", laborCostSource: "manual", laborCost: 600, laborMargin: 40, vatRate: 10, exceptionReason: "Forfait", forced: true }] }));
  ok(await admin.post(`/api/quotes/${quote.id}/send`));
  lead = ok(await karim.client.get(`/api/leads/${lead.id}`)).lead;
  assert.equal(lead.stage, "quote_sent");
  assert.equal(lead.quotes.length, 1);
  ok(await admin.post(`/api/quotes/${quote.id}/sign`, { method: "upload", force: true, file: { name: "s.pdf", type: "application/pdf", dataUrl: FAKE_PDF } }));
  lead = ok(await karim.client.get(`/api/leads/${lead.id}`)).lead;
  assert.equal(lead.stage, "won");
  assert.ok(lead.wonAt);
  assert.equal(lead.tasks.filter((item) => !item.doneAt).length, 0, "plus de relance une fois signé");
  const kinds = lead.events.map((event) => event.kind);
  for (const kind of ["created", "call", "stage", "task", "quote"]) assert.ok(kinds.includes(kind), kind);
  assert.ok(lead.events.some((event) => /signé/.test(event.body)));
});

test("point mort, objectifs, classement, félicitations et confidentialité des commissions", async (t) => {
  const { server, admin } = await setup(t);
  const karim = await loggedInClient(server, { email: "karim@test.fr", role: "commercial", name: "Karim" });
  const sarah = await loggedInClient(server, { email: "sarah@test.fr", role: "commercial", name: "Sarah" });
  const direction = await loggedInClient(server, { email: "dir@test.fr", role: "direction_commerciale", name: "Directrice" });

  await server.app.db.query("UPDATE users SET commission_rate = 5 WHERE id = ANY($1::uuid[])", [[karim.user.id, sarah.user.id]]);

  // Frais fixes : 3 000 € / mois ; bénéfice visé 2 000 €.
  ok(await admin.post("/api/goals/fixed-costs", { category: "rent", label: "Dépôt", monthlyAmount: "2000" }));
  let { breakeven } = ok(await admin.post("/api/goals/fixed-costs", { category: "ads_meta", label: "Campagnes Meta", monthlyAmount: 1000 }));
  assert.equal(breakeven.fixedTotal, 3000);
  assert.equal(breakeven.estimated, true, "sans devis signé : marge nette minimum de la fiche entreprise");
  assert.equal(breakeven.netRate, 15);
  assert.equal(breakeven.amount, 20000);
  ({ breakeven } = ok(await admin.put("/api/goals/profit-target", { profitTarget: 2000 })));
  assert.equal(breakeven.teamObjective, 22000);
  assert.equal((await karim.client.get("/api/goals/fixed-costs")).status, 403, "détail des frais fixes : administrateur seulement");
  assert.equal((await direction.client.get("/api/goals/fixed-costs")).status, 403);

  // Devis signés : Karim 1 000 € HT (commission 5 %), Sarah 1 000 € HT.
  const d1 = ok(await admin.post("/api/dossiers", { clientName: "Client Karim", commercialId: karim.user.id })).dossier;
  const d2 = ok(await admin.post("/api/dossiers", { clientName: "Client Sarah", commercialId: sarah.user.id })).dossier;
  const q1 = await signedQuote(admin, { dossierId: d1.id });
  await signedQuote(admin, { dossierId: d2.id, laborCost: 1200 });
  assert.equal(q1.totals.sale, 1000);

  ({ breakeven } = ok(await admin.get("/api/goals/fixed-costs")));
  assert.equal(breakeven.estimated, false);
  assert.equal(breakeven.quotesCount, 2);
  // Marge nette réelle : (marge − commission) / CA = (400 + 800 − 150) / 3000 = 35 %.
  assert.equal(breakeven.netRate, 35);
  assert.equal(breakeven.amount, 8571.43);

  // Objectifs individuels : répartition à parts égales entre les 3 vendeurs actifs.
  const period = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
  const split = ok(await admin.post("/api/goals/objectives/split", { period })).objectives;
  assert.equal(split.sellers.length, 3);
  assert.equal(Math.round(split.sellers.reduce((sum, s) => sum + s.amount, 0) * 100) / 100, split.team.amount);
  ok(await admin.put("/api/goals/objectives", { period, sellers: [{ id: karim.user.id, amount: 900 }] }));
  ok(await admin.post("/api/goals/tiers", { label: "Bronze", periodKind: "month", threshold: 1000, reward: "Prime 100 €" }));
  assert.equal((await karim.client.post("/api/goals/tiers", { label: "Moi", threshold: 1 })).status, 403);

  const dash = ok(await karim.client.get(`/api/crm/dashboard?period=${period}`)).dashboard;
  assert.equal(dash.breakeven, undefined, "point mort en euros : administrateur seulement");
  assert.equal(dash.teamStats, undefined);
  assert.equal(dash.me.sale, 1000);
  assert.equal(dash.me.objective, 900);
  assert.ok(dash.me.badges.some((b) => b.key === "objective"));
  assert.ok(dash.me.badges.some((b) => b.label === "Palier Bronze"));
  assert.deepEqual(dash.ranking.map((r) => r.displayName).slice(0, 2), ["Sarah", "Karim"]);
  assert.ok(dash.ranking.every((r) => r.commission === undefined && r.rate === undefined), "aucune commission dans le classement");
  assert.ok(dash.celebrations.some((c) => /Karim a atteint son objectif/.test(c.text)));
  assert.ok(!JSON.stringify(dash.celebrations).includes("Client Sarah"), "pas de nom de client des autres");
  assert.equal(dash.team.signed, 3000);
  assert.equal(dash.team.collected, null, "CA encaissé : iPaidThat (V3)");

  const adminDash = ok(await admin.get(`/api/crm/dashboard?period=${period}`)).dashboard;
  assert.equal(adminDash.breakeven.amount, 8571.43);
  assert.equal(adminDash.team.breakevenReached, false);
  assert.ok(adminDash.teamStats.some((row) => row.displayName === "Karim" && row.sale === 1000));
  assert.ok(ok(await direction.client.get(`/api/crm/dashboard?period=${period}`)).dashboard.teamStats, "la direction voit l'équipe");

  // Commissions : chacun la sienne ; la direction ne voit pas celles des autres ; l'administrateur voit tout.
  const kc = ok(await karim.client.get("/api/crm/commissions")).commissions;
  assert.equal(kc.items.length, 1);
  assert.equal(kc.items[0].amount, 50);
  assert.equal(kc.items[0].rate, 5);
  assert.deepEqual(kc.items[0].schedule.map((s) => s.amount), [15, 15, 15, 5]);
  assert.equal(kc.bySeller, undefined);
  assert.equal(ok(await direction.client.get("/api/crm/commissions")).commissions.items.length, 0);
  const ac = ok(await admin.get("/api/crm/commissions")).commissions;
  assert.equal(ac.items.length, 2);
  assert.equal(ac.total, 150);

  // Sauvegarde : les tables CRM sont restaurées à l'identique.
  ok(await admin.post("/api/leads", { name: "Lead sauvegarde", phone: "0600000099" }));
  const backup = await server.app.backups.create({ kind: "manuel" });
  const restoreTest = await server.app.backups.restoreTest(backup.name);
  assert.equal(restoreTest.ok, true, JSON.stringify(restoreTest));
  for (const table of ["leads", "lead_events", "lead_tasks", "fixed_costs", "sales_objectives", "bonus_tiers", "crm_settings"]) assert.equal(restoreTest.tables[table].ok, true, table);
});

test("sources : leads, signatures et coût par lead de la campagne Meta (administrateur)", async (t) => {
  const { server, admin } = await setup(t);
  const karim = await loggedInClient(server, { email: "karim@test.fr", role: "commercial", name: "Karim" });
  ok(await admin.post("/api/goals/fixed-costs", { category: "ads_meta", label: "Meta", monthlyAmount: 300 }));
  const raw = (id) => JSON.stringify({ entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: id } }] }] });
  for (const id of ["m1", "m2", "m3"]) {
    const body = raw(id);
    await fetch(`${server.base}/api/hooks/meta`, { method: "POST", headers: { "X-Hub-Signature-256": `sha256=${crypto.createHmac("sha256", "secret-meta").update(body).digest("hex")}` }, body });
  }
  const { leads } = ok(await admin.get("/api/leads"));
  assert.equal(leads.length, 3);
  const lead = ok(await admin.post(`/api/leads/${leads[0].id}/dossier`)).lead;
  const signed = await signedQuote(admin, { dossierId: lead.dossierId });
  assert.equal(signed.status, "signed");
  const period = new Date(leads[0].receivedAt).toISOString().slice(0, 7);
  const report = ok(await admin.get(`/api/crm/sources?period=${period}`)).report;
  const meta = report.sources.find((s) => s.source === "meta");
  assert.equal(meta.leads, 1, "même téléphone : les deux autres sont des doublons");
  assert.equal(meta.won, 1);
  assert.equal(meta.sale, 1000);
  assert.equal(meta.costPerLead, 300);
  assert.equal(meta.campaigns[0].campaign, "SDB Lille novembre");
  assert.equal((await karim.client.get("/api/crm/sources")).status, 403);
});
