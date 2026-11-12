"use strict";

// Routes HTTP des modules V1 : bibliothèque, sous-traitants et grilles, dossiers, devis,
// avenants, signatures, bons de commande, PV de réception, rapport des exceptions.

const crypto = require("crypto");
const { httpError } = require("./security");
const permissions = require("./permissions");
const { createLibrary } = require("./library");
const { createSubcontractors } = require("./subcontractors");
const { createQuotes } = require("./quotes");
const pdf = require("./pdf");

function createDevisApi({ db, auth, company, stateStore, fileStore, readJsonBody, sendJson, now, hooks = {} }) {
  const library = createLibrary(db, { auth });
  const subcontractors = createSubcontractors(db, { auth, fileStore, stateStore });
  const quotes = createQuotes(db, { auth, company, subcontractors, stateStore, fileStore, pdf, now });

  function sendPdf(response, buffer, filename) {
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/[^\w.-]+/g, "-")}"`,
      "Cache-Control": "no-store",
    });
    response.end(buffer);
  }

  function sendCsv(response, csv, filename) {
    response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" });
    response.end(csv);
  }

  const UUID = "([0-9a-f-]{36})";
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, regex: new RegExp(`^${pattern.replace(/:id/g, UUID)}$`), handler });
  const body = (request, limit = 2 * 1024 * 1024) => readJsonBody(request, limit);
  // Le CRM suit les devis (envoyé, signé, refusé) ; une erreur du CRM ne bloque jamais le devis.
  async function quoteEvent(quote, kind) {
    if (!hooks.quoteEvent || !quote) return;
    try {
      await hooks.quoteEvent({ quote, kind });
    } catch (error) {
      console.error(`[crm] suivi du devis impossible : ${error.message}`);
    }
  }

  // ---------- Contexte de l'écran Devis ----------
  route("GET", "/api/devis/context", async ({ user }) => {
    const profile = await company.get();
    const users = await db.query("SELECT id, display_name, role, active FROM users WHERE active ORDER BY display_name");
    return {
      user: { id: user.id, role: user.role, displayName: user.display_name },
      grants: permissions.grantsFor(user),
      company: { name: profile.name, margins: profile.margins, billing: profile.billing, hasLogo: Boolean(profile.logoKey) },
      commercials: users.filter((u) => ["commercial", "direction_commerciale", "admin"].includes(u.role)).map((u) => ({ id: u.id, displayName: u.display_name, role: u.role })),
    };
  });

  // ---------- Bibliothèque ----------
  route("GET", "/api/library/lots", async ({ user, url }) => {
    permissions.require(user, "library.read");
    return { lots: await library.listLots({ includeArchived: url.searchParams.get("archived") === "1" }) };
  });
  route("POST", "/api/library/lots", async ({ user, ip, request }) => ({ lot: await library.saveLot(await body(request), { user, ip }) }));
  route("GET", "/api/library/items", async ({ user, url }) => {
    permissions.require(user, "library.read");
    return { items: await library.listItems({ q: url.searchParams.get("q") || "", lotId: url.searchParams.get("lot") || null, includeArchived: url.searchParams.get("archived") === "1" }) };
  });
  route("POST", "/api/library/items", async ({ user, ip, request }) => ({ item: await library.saveItem(await body(request), { user, ip }) }));
  route("GET", "/api/library/items/:id/compare", async ({ user, params }) => {
    permissions.require(user, "st.read");
    return { item: await library.getItem(params[0]), prices: await subcontractors.compare(params[0]) };
  });
  route("POST", "/api/library/import", async ({ user, ip, request }) => {
    const payload = await body(request, 8 * 1024 * 1024);
    return { report: await library.importCsv(payload.csv, { apply: payload.apply === true, user, ip }) };
  });
  route("GET", "/api/library/export.csv", async ({ user, response }) => {
    permissions.require(user, "library.read");
    sendCsv(response, await library.exportCsv(), "bibliotheque-ouvrages.csv");
  });

  // ---------- Sous-traitants ----------
  route("GET", "/api/st", async ({ user, url }) => {
    permissions.require(user, "st.read");
    return { subcontractors: await subcontractors.list({ includeInactive: url.searchParams.get("all") === "1" }) };
  });
  route("POST", "/api/st", async ({ user, ip, request }) => ({ subcontractor: await subcontractors.save(await body(request), { user, ip }) }));
  route("GET", "/api/st/:id", async ({ user, params }) => {
    permissions.require(user, "st.read");
    return { subcontractor: await subcontractors.get(params[0]) };
  });
  route("POST", "/api/st/:id/documents", async ({ user, ip, request, params }) => ({ document: await subcontractors.addDocument(params[0], await body(request, 30 * 1024 * 1024), { user, ip }) }));
  route("DELETE", "/api/st/documents/:id", async ({ user, ip, params }) => subcontractors.removeDocument(params[0], { user, ip }));

  // ---------- Grilles ----------
  route("GET", "/api/grids", async ({ user, url }) => {
    permissions.require(user, "st.read");
    return { grids: await subcontractors.listGrids({ subcontractorId: url.searchParams.get("st") || null }) };
  });
  route("POST", "/api/grids", async ({ user, ip, request }) => ({ grid: await subcontractors.createGrid(await body(request), { user, ip }) }));
  route("GET", "/api/grids/:id", async ({ user, params }) => {
    permissions.require(user, "st.read");
    return { grid: await subcontractors.getGrid(params[0]) };
  });
  route("PUT", "/api/grids/:id", async ({ user, ip, request, params }) => ({ grid: await subcontractors.updateGrid(params[0], await body(request), { user, ip }) }));
  async function gridPdf(id) {
    const grid = await subcontractors.getGrid(id);
    const [st] = await db.query("SELECT * FROM subcontractors WHERE id = $1", [grid.subcontractorId]);
    const profile = await company.get();
    const buffer = await pdf.grid({ grid, subcontractor: { ...st, contactName: st.contact_name }, company: profile, logoPath: profile.logoKey ? fileStore.resolve(profile.logoKey) : null });
    return { buffer, grid, st };
  }
  route("GET", "/api/grids/:id/pdf", async ({ user, params, response }) => {
    permissions.require(user, "st.read");
    const { buffer, grid, st } = await gridPdf(params[0]);
    sendPdf(response, buffer, `grille-${st.name}-v${grid.version}.pdf`);
  });
  route("POST", "/api/grids/:id/send", async ({ user, ip, params }) => {
    const { buffer, st } = await gridPdf(params[0]);
    return { grid: await subcontractors.markSent(params[0], { user, ip, recipient: st.email || null, documentHash: crypto.createHash("sha256").update(buffer).digest("hex") }) };
  });
  route("POST", "/api/grids/:id/signed", async ({ user, ip, request, params }) => ({ grid: await subcontractors.uploadSigned(params[0], (await body(request, 30 * 1024 * 1024)).file, { user, ip }) }));
  route("POST", "/api/grids/:id/new-version", async ({ user, ip, params }) => ({ grid: await subcontractors.newVersion(params[0], { user, ip }) }));

  // ---------- Dossiers et devis ----------
  route("GET", "/api/dossiers", async ({ user, url }) => ({ dossiers: await quotes.listDossiers(user, { q: url.searchParams.get("q") || "", includeArchived: url.searchParams.get("archived") === "1" }) }));
  route("POST", "/api/dossiers", async ({ user, ip, request }) => ({ dossier: await quotes.saveDossier(await body(request), { user, ip }) }));
  route("GET", "/api/dossiers/:id", async ({ user, params }) => ({ dossier: await quotes.getDossier(params[0], user) }));
  route("POST", "/api/dossiers/:id/quotes", async ({ user, ip, request, params }) => ({ quote: await quotes.createQuote(params[0], await body(request), { user, ip }) }));
  route("POST", "/api/dossiers/:id/receptions", async ({ user, ip, request, params }) => ({ reception: await quotes.createReception(params[0], await body(request), { user, ip }) }));
  route("GET", "/api/quotes/:id", async ({ user, params }) => ({ quote: await quotes.getQuote(params[0], user) }));
  route("PUT", "/api/quotes/:id", async ({ user, ip, request, params }) => ({ quote: await quotes.saveQuote(params[0], await body(request), { user, ip }) }));
  route("POST", "/api/quotes/:id/lines-from-library", async ({ user, ip, request, params }) => ({ quote: await quotes.addFromLibrary(params[0], await body(request), { user, ip }) }));
  route("POST", "/api/quotes/:id/new-version", async ({ user, ip, params }) => ({ quote: await quotes.newVersion(params[0], { user, ip }) }));
  route("POST", "/api/quotes/:id/amendment", async ({ user, ip, request, params }) => ({ quote: await quotes.createAmendment(params[0], await body(request), { user, ip }) }));
  route("GET", "/api/quotes/:id/pdf", async ({ user, params, response }) => {
    const { buffer, quote } = await quotes.clientPdf(params[0], user);
    sendPdf(response, buffer, `${quote.amendmentNo ? `avenant-${quote.amendmentNo}-` : "devis-"}${quote.number}-v${quote.version}.pdf`);
  });
  route("POST", "/api/quotes/:id/send", async ({ user, ip, params }) => {
    const quote = await quotes.markSent(params[0], { user, ip });
    await quoteEvent(quote, "sent");
    return { quote };
  });
  route("POST", "/api/quotes/:id/refuse", async ({ user, ip, request, params }) => {
    const quote = await quotes.refuse(params[0], await body(request), { user, ip });
    await quoteEvent(quote, "refused");
    return { quote };
  });
  route("POST", "/api/quotes/:id/sign", async ({ user, ip, request, params }) => {
    const result = await quotes.sign(params[0], await body(request, 30 * 1024 * 1024), { user, ip, userAgent: request.headers["user-agent"] });
    await quoteEvent(result.quote, "signed");
    return result;
  });
  route("GET", "/api/orders/:id/pdf", async ({ user, params, response }) => {
    const order = await quotes.getOrder(params[0], user);
    sendPdf(response, await quotes.orderPdf(params[0], user), `${order.number}.pdf`);
  });
  route("POST", "/api/orders/:id/recheck", async ({ user, ip, params }) => ({ order: await quotes.recheckOrder(params[0], { user, ip }) }));
  route("POST", "/api/receptions/:id/sign", async ({ user, ip, request, params }) => ({ reception: await quotes.signReception(params[0], await body(request), { user, ip, userAgent: request.headers["user-agent"] }) }));
  route("GET", "/api/reports/exceptions", async ({ user, url }) => ({ report: await quotes.exceptionsReport(user, { month: url.searchParams.get("month") }) }));
  route("POST", "/api/devis/numbering", async ({ user, ip, request }) => ({ numbering: await quotes.setNumberStart(await body(request), { user, ip }) }));

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

  return { handle, library, subcontractors, quotes };
}

module.exports = { createDevisApi };
