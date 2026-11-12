"use strict";

// Routes HTTP du module 5 : CRM leads, pipeline, objectifs, point mort, commissions,
// et webhooks publics d'entrée des leads (Meta Lead Ads, Google Ads, site WordPress).

const { httpError } = require("./security");
const permissions = require("./permissions");
const { createCrm, STAGES, SOURCES } = require("./crm");
const { createGoals } = require("./goals");
const intake = require("./leads-intake");

function createCrmApi({ db, auth, company, quotes, readJsonBody, sendJson, env = process.env, now, fetchImpl, logger = console }) {
  const crm = createCrm(db, { auth, quotes, now: now || undefined });
  const goals = createGoals(db, { auth, company, now: now || undefined });

  const UUID = "([0-9a-f-]{36})";
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, regex: new RegExp(`^${pattern.replace(/:id/g, UUID)}$`), handler });
  const body = (request, limit = 256 * 1024) => readJsonBody(request, limit);
  const q = (url, key) => url.searchParams.get(key) || "";

  // ---------- Contexte ----------
  route("GET", "/api/crm/context", async ({ user }) => {
    if (!permissions.can(user, "crm.read_all") && !permissions.can(user, "crm.read_own") && !permissions.can(user, "goals.view")) throw httpError(403, "Action non autorisée pour votre rôle.");
    const settings = await crm.settings();
    const users = await db.query("SELECT id, display_name, role FROM users WHERE active AND role = ANY($1::text[]) ORDER BY display_name", [["commercial", "direction_commerciale", "admin"]]);
    return {
      stages: STAGES,
      sources: SOURCES,
      settings: { lostReasons: settings.lostReasons, stageDays: settings.stageDays, ...(permissions.can(user, "crm.settings") ? { assignment: settings.assignment, rotation: settings.rotation } : {}) },
      sellers: users.map((u) => ({ id: u.id, displayName: u.display_name, role: u.role })),
      costCategories: permissions.can(user, "goals.manage") ? goals.COST_CATEGORIES : undefined,
      period: goals.parisMonth(new Date()),
    };
  });

  // ---------- Leads ----------
  route("GET", "/api/leads", async ({ user, url }) => ({ leads: await crm.list(user, { q: q(url, "q"), stage: q(url, "stage"), commercialId: q(url, "commercial"), source: q(url, "source") }) }));
  route("POST", "/api/leads", async ({ user, ip, request }) => ({ lead: await crm.create(await body(request), { user, ip }) }));
  route("GET", "/api/leads/:id", async ({ user, params }) => ({ lead: await crm.get(params[0], user) }));
  route("PUT", "/api/leads/:id", async ({ user, ip, request, params }) => ({ lead: await crm.update(params[0], await body(request), { user, ip }) }));
  route("POST", "/api/leads/:id/stage", async ({ user, ip, request, params }) => ({ lead: await crm.move(params[0], await body(request), { user, ip }) }));
  route("POST", "/api/leads/:id/assign", async ({ user, ip, request, params }) => ({ lead: await crm.assign(params[0], await body(request), { user, ip }) }));
  route("POST", "/api/leads/:id/events", async ({ user, ip, request, params }) => ({ lead: await crm.addActivity(params[0], await body(request), { user, ip }) }));
  route("POST", "/api/leads/:id/tasks", async ({ user, ip, request, params }) => ({ lead: await crm.addTask(params[0], await body(request), { user, ip }) }));
  route("POST", "/api/leads/:id/dossier", async ({ user, ip, params }) => ({ lead: await crm.createDossier(params[0], { user, ip }) }));
  route("POST", "/api/lead-tasks/:id", async ({ user, ip, request, params }) => ({ lead: await crm.completeTask(params[0], await body(request), { user, ip }) }));
  route("GET", "/api/crm/reminders", async ({ user }) => ({ leads: await crm.reminders(user) }));
  route("PUT", "/api/crm/settings", async ({ user, ip, request }) => ({ settings: await crm.saveSettings(await body(request), { user, ip }) }));

  // ---------- Tableaux de bord ----------
  route("GET", "/api/crm/dashboard", async ({ user, url }) => ({ dashboard: await goals.dashboard(user, { period: q(url, "period") }) }));
  route("GET", "/api/crm/sources", async ({ user, url }) => ({ report: await goals.sourceStats(user, { period: q(url, "period") }) }));
  route("GET", "/api/crm/commissions", async ({ user, url }) => ({ commissions: await goals.commissions(user, { year: q(url, "year") }) }));

  // ---------- Objectifs et point mort (administrateur) ----------
  route("GET", "/api/goals/fixed-costs", async ({ user }) => ({ costs: await goals.listFixedCosts(user), breakeven: await goals.breakeven() }));
  route("POST", "/api/goals/fixed-costs", async ({ user, ip, request }) => ({ costs: await goals.saveFixedCost(await body(request), { user, ip }), breakeven: await goals.breakeven() }));
  route("DELETE", "/api/goals/fixed-costs/:id", async ({ user, ip, params }) => ({ costs: await goals.removeFixedCost(params[0], { user, ip }), breakeven: await goals.breakeven() }));
  route("PUT", "/api/goals/profit-target", async ({ user, ip, request }) => {
    await goals.saveProfitTarget(await body(request), { user, ip });
    return { breakeven: await goals.breakeven() };
  });
  route("GET", "/api/goals/objectives", async ({ user, url }) => ({ objectives: await goals.listObjectives(user, { period: q(url, "period") || goals.parisMonth(new Date()) }) }));
  route("PUT", "/api/goals/objectives", async ({ user, ip, request }) => ({ objectives: await goals.setObjectives(await body(request), { user, ip }) }));
  route("POST", "/api/goals/objectives/split", async ({ user, ip, request }) => ({ objectives: await goals.splitEqually(await body(request), { user, ip }) }));
  route("GET", "/api/goals/tiers", async ({ user }) => {
    permissions.require(user, "goals.view");
    return { tiers: await goals.listTiers({ includeInactive: permissions.can(user, "goals.manage") }) };
  });
  route("POST", "/api/goals/tiers", async ({ user, ip, request }) => ({ tiers: await goals.saveTier(await body(request), { user, ip }) }));
  route("DELETE", "/api/goals/tiers/:id", async ({ user, ip, params }) => ({ tiers: await goals.removeTier(params[0], { user, ip }) }));

  // ---------- Branchements (administrateur) ----------
  route("GET", "/api/crm/integrations", async ({ user, request }) => {
    permissions.require(user, "crm.integrations");
    const host = String(request.headers["x-forwarded-host"] || request.headers.host || "votre-domaine");
    const base = `https://${host}`;
    const last = Object.fromEntries((await db.query("SELECT source, max(received_at) AS at, count(*)::int AS n FROM leads GROUP BY source")).map((row) => [row.source, { at: row.at, count: row.n }]));
    return {
      meta: { configured: Boolean(env.META_APP_SECRET && env.META_VERIFY_TOKEN), canFetch: Boolean(env.META_PAGE_ACCESS_TOKEN), url: `${base}/api/hooks/meta`, version: env.META_GRAPH_VERSION || "v23.0", last: last.meta || null },
      google: { configured: Boolean(env.NOVA_GOOGLE_LEADS_KEY), url: `${base}/api/hooks/google`, last: last.google || null },
      website: { configured: Boolean(env.NOVA_WEBSITE_LEADS_KEY), url: `${base}/api/hooks/website`, last: last.website || null },
    };
  });

  // ---------- Webhooks publics (sans session, protégés par signature ou clé) ----------
  const hookLimiter = createLimiter(240, 60 * 1000);

  function readRaw(request, limit = 512 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(httpError(413, "Envoi trop volumineux."));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => resolve(Buffer.concat(chunks)));
      request.on("error", reject);
    });
  }

  async function metaHook({ request, response, method, url }) {
    if (method === "GET") {
      const challenge = intake.metaChallenge(url.searchParams, env.META_VERIFY_TOKEN);
      if (challenge === null) throw httpError(403, "Vérification refusée.");
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(String(challenge));
    }
    if (!env.META_APP_SECRET) throw httpError(503, "Branchement Meta non configuré.");
    const raw = await readRaw(request);
    if (!intake.metaSignatureValid(raw, request.headers["x-hub-signature-256"], env.META_APP_SECRET)) throw httpError(401, "Signature invalide.");
    const notifications = intake.metaNotifications(intake.parseFormBody(raw, "application/json"));
    let created = 0;
    for (const notification of notifications) {
      let data = null;
      if (env.META_PAGE_ACCESS_TOKEN) {
        try {
          data = await intake.fetchMetaLead(notification.leadgenId, { token: env.META_PAGE_ACCESS_TOKEN, version: env.META_GRAPH_VERSION || "v23.0", fetchImpl: fetchImpl || globalThis.fetch });
        } catch (error) {
          logger.error(`[leads] lecture du lead Meta ${notification.leadgenId} impossible : ${error.message}`);
        }
      }
      const result = await crm.receive(intake.metaLeadInput(notification, data));
      if (result.created) created += 1;
    }
    return sendJson(response, { ok: true, received: notifications.length, created });
  }

  async function googleHook({ request, response }) {
    if (!env.NOVA_GOOGLE_LEADS_KEY) throw httpError(503, "Branchement Google Ads non configuré.");
    const payload = intake.parseFormBody(await readRaw(request), "application/json");
    if (!intake.safeEqual(payload.google_key, env.NOVA_GOOGLE_LEADS_KEY)) throw httpError(401, "Clé invalide.");
    const result = await crm.receive(intake.googleLeadInput(payload));
    return sendJson(response, { ok: true, created: result.created });
  }

  async function websiteHook({ request, response, url }) {
    if (!env.NOVA_WEBSITE_LEADS_KEY) throw httpError(503, "Formulaire du site non configuré.");
    const payload = intake.parseFormBody(await readRaw(request), request.headers["content-type"]);
    const key = request.headers["x-nova-key"] || url.searchParams.get("key") || payload.nova_key || payload.key;
    if (!intake.safeEqual(key, env.NOVA_WEBSITE_LEADS_KEY)) throw httpError(401, "Clé invalide.");
    if (payload.website || payload._honeypot) return sendJson(response, { ok: true }); // champ piège rempli par un robot
    const result = await crm.receive(intake.websiteLeadInput(payload));
    return sendJson(response, { ok: true, created: result.created });
  }

  // Appelé avant toute vérification de session : true si la requête a été traitée.
  async function handlePublic(context) {
    const { pathname, method, ip } = context;
    if (!pathname.startsWith("/api/hooks/")) return false;
    const handler = { "/api/hooks/meta": metaHook, "/api/hooks/google": googleHook, "/api/hooks/website": websiteHook }[pathname];
    if (!handler || (method !== "POST" && !(method === "GET" && pathname === "/api/hooks/meta"))) throw httpError(404, "Introuvable.");
    if (!hookLimiter.allow(ip || "?")) throw httpError(429, "Trop de requêtes.");
    hookLimiter.hit(ip || "?");
    await handler(context);
    return true;
  }

  async function handle(context) {
    const { pathname, method } = context;
    for (const entry of routes) {
      if (entry.method !== method) continue;
      const match = pathname.match(entry.regex);
      if (!match) continue;
      const result = await entry.handler({ ...context, params: match.slice(1) });
      if (result !== undefined && !context.response.headersSent) sendJson(context.response, result);
      return true;
    }
    return false;
  }

  return { handle, handlePublic, crm, goals };
}

function createLimiter(max, windowMs) {
  const hits = new Map();
  return {
    allow(key) {
      const entry = hits.get(key);
      return !entry || entry.until < Date.now() || entry.count < max;
    },
    hit(key) {
      const entry = hits.get(key);
      if (!entry || entry.until < Date.now()) hits.set(key, { count: 1, until: Date.now() + windowMs });
      else entry.count += 1;
      if (hits.size > 5000) hits.clear();
    },
  };
}

module.exports = { createCrmApi };
