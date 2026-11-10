"use strict";

// Dossiers clients, devis, versions et avenants (modules 1, 3 et 4 du cahier des charges).
// Tout est rangé par dossier client ; un devis signé est figé (coûts, marges, commission),
// crée ses bons de commande ST et alimente le chantier dans l'application de suivi.

const crypto = require("crypto");
const { httpError } = require("./security");
const permissions = require("./permissions");
const pricing = require("./pricing");

const STATUS_LABELS = { draft: "Brouillon", sent: "Envoyé", signed: "Signé", refused: "Refusé", superseded: "Remplacé" };
const AMENDMENT_SCHEDULE = [
  { label: "Signature de l'avenant", percent: 50 },
  { label: "Fin des travaux", percent: 50 },
];

const text = (value, max = 300) => String(value ?? "").trim().slice(0, max);
const isoDate = (value) => (value ? String(value).slice(0, 10) : null);
const todayIso = () => new Date().toISOString().slice(0, 10);
const nullableNumber = (value, label, { min = -1e9, max = 1e9 } = {}) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw httpError(400, `${label} : valeur invalide.`);
  return parsed;
};

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Délai de rétractation de 14 jours (contrat hors établissement) ; prolongé au lundi s'il finit un week-end.
function withdrawalEnd(signedIso) {
  let end = addDays(signedIso, 14);
  const day = new Date(`${end}T12:00:00Z`).getUTCDay();
  if (day === 6) end = addDays(end, 2);
  if (day === 0) end = addDays(end, 1);
  return end;
}

const lineOut = (row) => ({
  id: row.id,
  position: row.position,
  itemId: row.item_id,
  code: row.code,
  lotName: row.lot_name,
  label: row.label,
  description: row.description,
  unit: row.unit,
  quantity: Number(row.quantity),
  mode: row.mode,
  subcontractorId: row.subcontractor_id,
  subcontractorName: row.st_name || null,
  stScope: row.st_scope,
  gridId: row.grid_id,
  gridLaborCost: row.grid_labor_cost,
  gridEndsOn: isoDate(row.grid_ends_on),
  laborCost: row.labor_cost,
  laborCostSource: row.labor_cost_source,
  laborMargin: row.labor_margin,
  laborPriceOverride: row.labor_price_override,
  supplyProCost: row.supply_pro_cost,
  supplyPublicPrice: row.supply_public_price,
  supplyPricing: row.supply_pricing,
  supplyMargin: row.supply_margin,
  supplyPriceOverride: row.supply_price_override,
  supplier: row.supplier,
  vatRate: row.vat_rate,
  exceptionReason: row.exception_reason,
  forced: row.forced,
});

function quoteOut(row) {
  const quote = {
    id: row.id,
    dossierId: row.dossier_id,
    number: row.number,
    amendmentNo: row.amendment_no,
    version: row.version,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    title: row.title,
    commercialId: row.commercial_id,
    commercialName: row.commercial_name || null,
    commissionRate: row.commission_rate,
    schedule: row.schedule,
    scheduleMode: row.schedule_mode,
    validDays: row.valid_days,
    workStartOn: isoDate(row.work_start_on),
    notes: row.notes,
    totals: row.totals,
    sentAt: row.sent_at,
    signedAt: row.signed_at,
    refusedAt: row.refused_at,
    refusalReason: row.refusal_reason,
    signature: row.signature,
    signedUrl: row.signed_file_key ? `/uploads/${row.signed_file_key}` : null,
    earlyStartRequested: row.early_start_requested,
    withdrawalUntil: isoDate(row.withdrawal_until),
    forced: Boolean(row.forced_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  quote.displayNumber = quote.amendmentNo ? `Avenant ${quote.amendmentNo} · devis ${quote.number}` : `Devis ${quote.number}`;
  quote.versionLabel = `V${quote.version}`;
  return quote;
}

const dossierOut = (row) => ({
  id: row.id,
  clientName: row.client_name,
  clientEmail: row.client_email,
  clientPhone: row.client_phone,
  clientAddress: row.client_address,
  siteAddress: row.site_address,
  offPremises: row.off_premises,
  commercialId: row.commercial_id,
  commercialName: row.commercial_name || null,
  projectId: row.project_id,
  notes: row.notes,
  archived: row.archived,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function createQuotes(db, { auth, company, subcontractors, stateStore, fileStore, pdf, now }) {
  now = now || (() => new Date());
  // ---------- Accès ----------

  function canSeeDossier(user, dossier) {
    if (permissions.can(user, "quotes.read_all")) return true;
    if (permissions.can(user, "quotes.read_own")) return dossier.commercial_id === user.id || dossier.created_by === user.id;
    return false;
  }

  async function loadDossierRow(id, user) {
    const [row] = await db.query(`SELECT d.*, u.display_name AS commercial_name FROM dossiers d LEFT JOIN users u ON u.id = d.commercial_id WHERE d.id = $1`, [id]);
    if (!row || !canSeeDossier(user, row)) throw httpError(404, "Dossier introuvable.");
    return row;
  }

  async function loadQuoteRow(id, user) {
    const [row] = await db.query(`SELECT q.*, u.display_name AS commercial_name FROM quotes q LEFT JOIN users u ON u.id = q.commercial_id WHERE q.id = $1`, [id]);
    if (!row) throw httpError(404, "Devis introuvable.");
    const dossier = await loadDossierRow(row.dossier_id, user);
    return { row, dossier };
  }

  function seesCommission(user, quote) {
    return permissions.can(user, "commissions.all") || (quote.commercialId && quote.commercialId === user.id);
  }

  // Masque ce que le rôle ne doit pas voir : coûts / ST / marges, commission des autres.
  function redact(quote, user) {
    const costs = permissions.can(user, "quotes.costs");
    const commission = seesCommission(user, quote);
    const out = { ...quote, canSeeCosts: costs, canSeeCommission: commission };
    if (!commission) {
      out.commissionRate = null;
      if (out.computed) out.computed = { ...out.computed, commissionRate: null, commission: null, net: null, netRate: null };
      if (out.totals) out.totals = { ...out.totals, commissionRate: null, commission: null, net: null, netRate: null };
    }
    if (!costs) {
      const hidden = ["gridLaborCost", "gridId", "laborCost", "laborCostSource", "laborMargin", "supplyProCost", "supplyMargin", "subcontractorId", "subcontractorName", "stScope", "exceptionReason", "supplier"];
      out.lines = (out.lines || []).map((line) => Object.fromEntries(Object.entries(line).filter(([key]) => !hidden.includes(key))));
      const strip = (totals) => totals && { sale: totals.sale, vat: totals.vat, total: totals.total, vatLines: totals.vatLines, lots: (totals.lots || []).map((lot) => ({ name: lot.name, sale: lot.sale })), lines: (totals.lines || []).map((line) => ({ unitPrice: line.unitPrice, sale: line.sale, vatRate: line.vatRate, vat: line.vat })) };
      out.computed = strip(out.computed);
      out.totals = strip(out.totals);
      out.purchaseOrders = undefined;
    }
    return out;
  }

  // ---------- Dossiers ----------

  async function listDossiers(user, { q = "", includeArchived = false } = {}) {
    const params = [];
    const where = [];
    if (!includeArchived) where.push("NOT d.archived");
    if (!permissions.can(user, "quotes.read_all")) {
      if (!permissions.can(user, "quotes.read_own")) throw httpError(403, "Action non autorisée pour votre rôle.");
      params.push(user.id);
      where.push(`(d.commercial_id = $${params.length} OR d.created_by = $${params.length})`);
    }
    if (q.trim()) {
      params.push(`%${q.trim().replace(/[%_]/g, "")}%`);
      where.push(`(d.client_name ILIKE $${params.length} OR d.site_address ILIKE $${params.length} OR EXISTS (SELECT 1 FROM quotes x WHERE x.dossier_id = d.id AND x.number ILIKE $${params.length}))`);
    }
    const rows = await db.query(
      `SELECT d.*, u.display_name AS commercial_name,
         (SELECT count(*)::int FROM quotes q WHERE q.dossier_id = d.id) AS quotes_count,
         (SELECT COALESCE(sum((q.totals->>'sale')::numeric), 0) FROM quotes q WHERE q.dossier_id = d.id AND q.status = 'signed') AS signed_sale,
         (SELECT max(q.updated_at) FROM quotes q WHERE q.dossier_id = d.id) AS last_activity,
         (SELECT q.status FROM quotes q WHERE q.dossier_id = d.id AND q.amendment_no = 0 ORDER BY q.version DESC LIMIT 1) AS main_status
       FROM dossiers d LEFT JOIN users u ON u.id = d.commercial_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY COALESCE((SELECT max(q.updated_at) FROM quotes q WHERE q.dossier_id = d.id), d.updated_at) DESC LIMIT 500`,
      params,
    );
    return rows.map((row) => ({ ...dossierOut(row), quotesCount: row.quotes_count, signedSale: Number(row.signed_sale), mainStatus: row.main_status, mainStatusLabel: STATUS_LABELS[row.main_status] || "Sans devis", lastActivity: row.last_activity }));
  }

  async function saveDossier(input, { user, ip }) {
    permissions.require(user, "quotes.write");
    const clientName = text(input.clientName, 160);
    if (!clientName) throw httpError(400, "Nom du client obligatoire (ex. M. et Mme LARGE).");
    const email = text(input.clientEmail, 160);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "E-mail du client invalide.");
    let commercialId = input.commercialId || null;
    if (user.role === "commercial") commercialId = user.id; // un commercial ne crée des dossiers que pour lui
    if (commercialId && !(await db.query("SELECT 1 FROM users WHERE id = $1 AND active", [commercialId])).length) throw httpError(400, "Commercial inconnu.");
    const values = [clientName, email, text(input.clientPhone, 30), text(input.clientAddress, 300), text(input.siteAddress, 300), input.offPremises === true, commercialId, text(input.notes, 4000), input.archived === true];
    let row;
    if (input.id) {
      const existing = await loadDossierRow(input.id, user);
      [row] = await db.query(
        `UPDATE dossiers SET client_name = $1, client_email = $2, client_phone = $3, client_address = $4, site_address = $5, off_premises = $6, commercial_id = $7, notes = $8, archived = $9, updated_at = now() WHERE id = $10 RETURNING *`,
        [...values, existing.id],
      );
    } else {
      [row] = await db.query(
        `INSERT INTO dossiers (client_name, client_email, client_phone, client_address, site_address, off_premises, commercial_id, notes, archived, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [...values, user.id],
      );
    }
    await auth.audit({ user, action: input.id ? "dossier.update" : "dossier.create", entity: "dossier", entityId: row.id, details: { clientName }, ip });
    return getDossier(row.id, user);
  }

  async function getDossier(id, user) {
    const row = await loadDossierRow(id, user);
    const dossier = dossierOut(row);
    const quotes = await db.query(`SELECT q.*, u.display_name AS commercial_name FROM quotes q LEFT JOIN users u ON u.id = q.commercial_id WHERE q.dossier_id = $1 ORDER BY q.amendment_no, q.version`, [id]);
    dossier.quotes = quotes.map((q) => redact(quoteOut(q), user));
    const signed = dossier.quotes.filter((q) => q.status === "signed");
    const sum = (key) => pricing.round2(signed.reduce((total, q) => total + Number(q.totals?.[key] || 0), 0));
    const costs = permissions.can(user, "quotes.costs");
    const commission = signed.every((q) => q.canSeeCommission);
    dossier.recap = {
      signedSale: sum("sale"),
      signedTotal: sum("total"),
      margin: costs ? sum("margin") : null,
      marginRate: costs && sum("sale") ? pricing.round2((sum("margin") / sum("sale")) * 100) : null,
      commission: costs && commission ? sum("commission") : null,
      net: costs && commission ? sum("net") : null,
      amendments: signed.filter((q) => q.amendmentNo > 0).length,
      schedule: await scheduleRecap(dossier, signed),
    };
    dossier.receptions = (await db.query("SELECT * FROM receptions WHERE dossier_id = $1 ORDER BY created_at", [id])).map(receptionOut);
    return dossier;
  }

  // Échéances de tout le dossier : devis initial (+ avenants « ajoutés ») et avenants payés à part.
  async function scheduleRecap(dossier, signed) {
    const main = signed.find((q) => q.amendmentNo === 0);
    if (!main) return [];
    const merged = signed.filter((q) => q.amendmentNo > 0 && q.scheduleMode === "merge");
    const base = pricing.round2(Number(main.totals?.total || 0) + merged.reduce((sum, q) => sum + Number(q.totals?.total || 0), 0));
    let invoicedIds = new Set();
    if (dossier.projectId && stateStore) {
      const { data } = await stateStore.get();
      const project = (data.projects || []).find((p) => p.id === dossier.projectId);
      invoicedIds = new Set((project?.invoices || []).filter((invoice) => invoice.status === "done").map((invoice) => invoice.label));
    }
    const rows = pricing.splitSchedule(base, main.schedule).map((step) => ({ ...step, source: main.displayNumber, amountTtc: step.amount, invoiced: invoicedIds.has(step.label) }));
    for (const amendment of signed.filter((q) => q.amendmentNo > 0 && q.scheduleMode === "separate")) {
      pricing.splitSchedule(Number(amendment.totals?.total || 0), amendment.schedule).forEach((step) => rows.push({ ...step, label: `${step.label} (avenant ${amendment.amendmentNo})`, source: amendment.displayNumber, amountTtc: step.amount, invoiced: false }));
    }
    return rows.map(({ amount, ...rest }) => rest);
  }

  // ---------- Devis ----------

  async function nextNumber(tx, year) {
    const [row] = await tx.query(
      `INSERT INTO sequences (key, value) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1 RETURNING value`,
      [`devis-${year}`],
    );
    return `${year}-${String(row.value).padStart(3, "0")}`;
  }

  async function commissionRateOf(userId) {
    if (!userId) return null;
    const [row] = await db.query("SELECT commission_rate FROM users WHERE id = $1", [userId]);
    return row?.commission_rate ?? null;
  }

  function cleanSchedule(schedule) {
    if (!Array.isArray(schedule) || !schedule.length || schedule.length > 12) throw httpError(400, "L'échéancier contient entre 1 et 12 échéances.");
    const steps = schedule.map((step, index) => ({ label: text(step?.label, 60) || `Échéance ${index + 1}`, percent: nullableNumber(step?.percent, `Échéance ${index + 1}`, { min: 0, max: 100 }) ?? 0 }));
    const total = pricing.round2(steps.reduce((sum, step) => sum + step.percent, 0));
    if (total !== 100) throw httpError(400, `L'échéancier doit totaliser 100 % (actuellement ${String(total).replace(".", ",")} %).`);
    return steps;
  }

  async function createQuote(dossierId, input, { user, ip }) {
    permissions.require(user, "quotes.write");
    const dossier = await loadDossierRow(dossierId, user);
    const profile = await company.get();
    const commercialId = dossier.commercial_id || (user.role === "commercial" ? user.id : null);
    const commissionRate = await commissionRateOf(commercialId); // hors transaction (PGlite : une connexion)
    const id = await db.tx(async (tx) => {
      const number = await nextNumber(tx, now().getFullYear());
      const [row] = await tx.query(
        `INSERT INTO quotes (dossier_id, number, title, commercial_id, commission_rate, schedule, valid_days, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING id`,
        [dossierId, number, text(input.title, 200), commercialId, commissionRate, JSON.stringify(profile.billing.invoiceSchedule), 30, user.id],
      );
      return row.id;
    });
    await auth.audit({ user, action: "quote.create", entity: "quote", entityId: id, details: { dossierId }, ip });
    return getQuote(id, user);
  }

  async function loadLines(quoteId) {
    const rows = await db.query(`SELECT l.*, s.name AS st_name FROM quote_lines l LEFT JOIN subcontractors s ON s.id = l.subcontractor_id WHERE l.quote_id = $1 ORDER BY l.position`, [quoteId]);
    return rows.map(lineOut);
  }

  // Prix ST de la grille signée en vigueur (brouillons uniquement : un devis envoyé ou signé ne bouge plus).
  async function refreshGridPrices(lines, date = todayIso()) {
    const bySt = new Map();
    lines.forEach((line) => {
      if (line.subcontractorId && line.itemId && line.stScope !== "none") bySt.set(line.subcontractorId, [...(bySt.get(line.subcontractorId) || []), line.itemId]);
    });
    const prices = new Map();
    for (const [stId, itemIds] of bySt) prices.set(stId, await subcontractors.priceLookup(stId, [...new Set(itemIds)], date));
    return lines.map((line) => {
      const price = line.subcontractorId && line.itemId && line.stScope !== "none" ? prices.get(line.subcontractorId)?.get(line.itemId) : null;
      const next = { ...line, gridId: price?.gridId || null, gridLaborCost: price ? price.laborPrice : null, gridEndsOn: price?.endsOn || null };
      if (line.stScope === "none") {
        next.laborCostSource = "manual";
      } else if (line.laborCostSource === "grid" && price) {
        next.laborCost = price.laborPrice;
        if ((line.stScope === "supply" || line.stScope === "both") && price.supplyPrice !== null) next.supplyProCost = price.supplyPrice;
      }
      return next;
    });
  }

  async function marginDefaults() {
    const profile = await company.get();
    return { labor: profile.margins.labor, supply: profile.margins.supply, minimumNet: profile.margins.minimumNet, vat: profile.billing.defaultVatRate, vatRates: profile.billing.vatRates };
  }

  async function compute(quote, lines) {
    const defaults = await marginDefaults();
    const subcontractorStatus = new Map();
    for (const stId of new Set(lines.map((line) => line.subcontractorId).filter(Boolean))) subcontractorStatus.set(stId, (await subcontractors.compliance(stId)).blocked);
    const enriched = lines.map((line) => ({ ...line, subcontractorBlocked: line.subcontractorId ? subcontractorStatus.get(line.subcontractorId) : false }));
    return pricing.computeQuote({ lines: enriched, commissionRate: quote.commissionRate }, { minimumNetMargin: defaults.minimumNet, frozen: quote.status === "signed" });
  }

  async function getQuote(id, user) {
    const { row, dossier } = await loadQuoteRow(id, user);
    const quote = quoteOut(row);
    let lines = await loadLines(id);
    if (quote.status === "draft") lines = await refreshGridPrices(lines);
    quote.lines = lines;
    quote.computed = await compute(quote, lines);
    quote.dossier = dossierOut(dossier);
    quote.events = await db.query("SELECT event, recipient, method, at, details, document_sha256 FROM signature_events WHERE document_type = 'quote' AND document_id = $1 ORDER BY at", [id]);
    quote.purchaseOrders = (await db.query(`SELECT p.*, s.name AS st_name FROM purchase_orders p JOIN subcontractors s ON s.id = p.subcontractor_id WHERE p.quote_id = $1 ORDER BY s.name`, [id])).map(orderOut);
    quote.siblings = (await db.query("SELECT id, version, status, amendment_no FROM quotes WHERE number = $1 ORDER BY amendment_no, version", [quote.number])).map((s) => ({ id: s.id, version: s.version, amendmentNo: s.amendment_no, status: s.status, statusLabel: STATUS_LABELS[s.status] }));
    return redact(quote, user);
  }

  function cleanLine(input, index, { amendment, vatRates, user, existing }) {
    const label = text(input.label, 300);
    if (!label) throw httpError(400, `Ligne ${index + 1} : libellé obligatoire.`);
    const quantity = nullableNumber(input.quantity, `Ligne ${index + 1} · quantité`, { min: amendment ? -1e6 : 0, max: 1e6 }) ?? 0;
    const mode = pricing.MODES.includes(input.mode) ? input.mode : "both";
    const stScope = pricing.ST_SCOPES.includes(input.stScope) ? input.stScope : "labor";
    const vatRate = nullableNumber(input.vatRate, `Ligne ${index + 1} · TVA`, { min: 0, max: 30 }) ?? 20;
    if (!vatRates.includes(vatRate)) throw httpError(400, `Ligne ${index + 1} : taux de TVA ${vatRate} % non proposé dans le profil entreprise.`);
    const margin = (value, label) => nullableNumber(value, `Ligne ${index + 1} · ${label}`, { min: 0, max: 95 });
    const money = (value, label) => {
      const parsed = nullableNumber(value, `Ligne ${index + 1} · ${label}`, { min: 0, max: 1e7 });
      return parsed === null ? null : pricing.round2(parsed);
    };
    // Seul l'administrateur peut forcer une ligne sans prix ST validé.
    const forced = permissions.can(user, "quotes.force") ? input.forced === true : existing?.forced === true;
    return {
      // L'identifiant n'est conservé que pour une ligne existante de ce devis.
      id: existing ? existing.id : null,
      itemId: input.itemId || null,
      code: text(input.code, 40),
      lotName: text(input.lotName, 80) || "Divers",
      label,
      description: text(input.description, 4000),
      unit: text(input.unit, 12) || "u",
      quantity,
      mode,
      subcontractorId: input.subcontractorId || null,
      stScope,
      laborCost: money(input.laborCost, "coût main-d'œuvre"),
      laborCostSource: input.laborCostSource === "manual" || stScope === "none" ? "manual" : "grid",
      laborMargin: margin(input.laborMargin, "marge prestation"),
      laborPriceOverride: money(input.laborPriceOverride, "prix prestation"),
      supplyProCost: money(input.supplyProCost, "coût fourniture"),
      supplyPublicPrice: money(input.supplyPublicPrice, "prix public"),
      supplyPricing: ["auto", "public", "margin"].includes(input.supplyPricing) ? input.supplyPricing : "auto",
      supplyMargin: margin(input.supplyMargin, "marge fourniture"),
      supplyPriceOverride: money(input.supplyPriceOverride, "prix fourniture"),
      supplier: text(input.supplier, 120),
      vatRate,
      exceptionReason: text(input.exceptionReason, 200),
      forced,
    };
  }

  async function writeLines(tx, quoteId, lines) {
    await tx.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteId]);
    let position = 0;
    for (const line of lines) {
      position += 1;
      await tx.query(
        `INSERT INTO quote_lines (id, quote_id, position, item_id, code, lot_name, label, description, unit, quantity, mode, subcontractor_id, st_scope, grid_id, grid_labor_cost, grid_ends_on,
           labor_cost, labor_cost_source, labor_margin, labor_price_override, supply_pro_cost, supply_public_price, supply_pricing, supply_margin, supply_price_override, supplier, vat_rate, exception_reason, forced)
         VALUES (COALESCE($29::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)`,
        [quoteId, position, line.itemId, line.code, line.lotName, line.label, line.description, line.unit, line.quantity, line.mode, line.subcontractorId, line.stScope, line.gridId, line.gridLaborCost, line.gridEndsOn,
          line.laborCost, line.laborCostSource, line.laborMargin, line.laborPriceOverride, line.supplyProCost, line.supplyPublicPrice, line.supplyPricing, line.supplyMargin, line.supplyPriceOverride, line.supplier, line.vatRate, line.exceptionReason, line.forced, line.id || null],
      );
    }
  }

  async function persistTotals(executor, quoteId, computed) {
    const { lines, ...totals } = computed;
    await executor.query("UPDATE quotes SET totals = $2::jsonb, updated_at = now() WHERE id = $1", [quoteId, JSON.stringify(totals)]);
  }

  async function saveQuote(id, input, { user, ip }) {
    permissions.require(user, "quotes.write");
    const { row } = await loadQuoteRow(id, user);
    if (row.status !== "draft") throw httpError(409, row.status === "sent" ? "Devis envoyé : créez une nouvelle version pour le modifier." : "Devis figé : il ne peut plus être modifié.");
    const quote = quoteOut(row);
    const defaults = await marginDefaults();
    const existingLines = new Map((await loadLines(id)).map((line) => [line.id, line]));
    let lines = quote.lines;
    if (input.lines !== undefined) {
      if (!Array.isArray(input.lines) || input.lines.length > 500) throw httpError(400, "Lignes du devis invalides.");
      lines = input.lines.map((line, index) => cleanLine(line, index, { amendment: quote.amendmentNo > 0, vatRates: defaults.vatRates, user, existing: existingLines.get(line.id) }));
      lines = await refreshGridPrices(lines);
    } else lines = await refreshGridPrices([...existingLines.values()]);

    let commercialId = input.commercialId !== undefined ? input.commercialId || null : quote.commercialId;
    if (user.role === "commercial") commercialId = user.id;
    let commissionRate = quote.commissionRate;
    if (commercialId !== quote.commercialId || commissionRate === null) commissionRate = await commissionRateOf(commercialId);
    if (input.commissionRate !== undefined && permissions.can(user, "commissions.all")) commissionRate = nullableNumber(input.commissionRate, "Taux de commission", { min: 0, max: 50 });
    const schedule = input.schedule !== undefined ? cleanSchedule(input.schedule) : quote.schedule;
    const scheduleMode = quote.amendmentNo > 0 && input.scheduleMode === "merge" ? "merge" : quote.amendmentNo > 0 ? input.scheduleMode === "separate" ? "separate" : quote.scheduleMode : "separate";
    const validDays = input.validDays !== undefined ? Math.round(nullableNumber(input.validDays, "Validité", { min: 1, max: 365 }) ?? 30) : quote.validDays;
    const workStartOn = input.workStartOn !== undefined ? isoDate(input.workStartOn) : quote.workStartOn;
    if (workStartOn && !/^\d{4}-\d{2}-\d{2}$/.test(workStartOn)) throw httpError(400, "Date de début des travaux invalide.");

    const computed = await compute({ commissionRate, status: "draft" }, lines);
    await db.tx(async (tx) => {
      await tx.query(
        `UPDATE quotes SET title = $2, notes = $3, commercial_id = $4, commission_rate = $5, schedule = $6::jsonb, schedule_mode = $7, valid_days = $8, work_start_on = $9, updated_at = now() WHERE id = $1`,
        [id, input.title !== undefined ? text(input.title, 200) : quote.title, input.notes !== undefined ? text(input.notes, 4000) : quote.notes, commercialId, commissionRate, JSON.stringify(schedule), scheduleMode, validDays, workStartOn],
      );
      await writeLines(tx, id, lines);
      await persistTotals(tx, id, computed);
    });
    const forcedLines = lines.filter((line) => line.forced && !existingLines.get(line.id)?.forced);
    if (forcedLines.length) await auth.audit({ user, action: "quote.line_forced", entity: "quote", entityId: id, details: { lines: forcedLines.map((line) => line.label) }, ip });
    return getQuote(id, user);
  }

  // Lignes construites depuis la bibliothèque : marge de l'ouvrage, sinon du lot, sinon de l'entreprise.
  async function addFromLibrary(id, { itemIds, subcontractorId = null }, { user, ip }) {
    permissions.require(user, "quotes.write");
    if (!Array.isArray(itemIds) || !itemIds.length || itemIds.length > 200) throw httpError(400, "Choisissez au moins un ouvrage.");
    const current = await getQuote(id, user);
    if (current.status !== "draft") throw httpError(409, "Devis figé : créez une nouvelle version.");
    const defaults = await marginDefaults();
    const rows = await db.query(
      `SELECT i.*, l.name AS lot_name, l.labor_margin AS lot_labor_margin, l.supply_margin AS lot_supply_margin FROM library_items i JOIN library_lots l ON l.id = i.lot_id WHERE i.id = ANY($1::uuid[])`,
      [itemIds],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const added = itemIds.map((itemId) => byId.get(itemId)).filter(Boolean).map((item) => ({
      itemId: item.id,
      code: item.code,
      lotName: item.lot_name,
      label: item.label,
      description: item.description,
      unit: item.unit,
      quantity: 1,
      mode: "both",
      subcontractorId,
      stScope: "labor",
      laborCost: item.labor_cost,
      laborCostSource: "grid",
      laborMargin: item.labor_margin ?? item.lot_labor_margin ?? defaults.labor,
      supplyProCost: item.supply_pro_price,
      supplyPublicPrice: item.supply_public_price,
      supplyPricing: "auto",
      supplyMargin: item.supply_margin ?? item.lot_supply_margin ?? defaults.supply,
      supplier: item.supplier,
      vatRate: item.vat_rate ?? defaults.vat,
    }));
    if (!added.length) throw httpError(404, "Ouvrages introuvables.");
    return saveQuote(id, { lines: [...current.lines, ...added] }, { user, ip });
  }

  async function newVersion(id, { user, ip }) {
    permissions.require(user, "quotes.write");
    const { row } = await loadQuoteRow(id, user);
    if (row.status === "signed") throw httpError(409, "Devis signé : ajoutez un avenant.");
    const newId = await db.tx(async (tx) => {
      const [{ next }] = await tx.query("SELECT max(version) + 1 AS next FROM quotes WHERE number = $1 AND amendment_no = $2", [row.number, row.amendment_no]);
      const [created] = await tx.query(
        `INSERT INTO quotes (dossier_id, number, amendment_no, version, title, commercial_id, commission_rate, schedule, schedule_mode, valid_days, work_start_on, notes, totals, created_by)
         SELECT dossier_id, number, amendment_no, $2, title, commercial_id, commission_rate, schedule, schedule_mode, valid_days, work_start_on, notes, totals, $3 FROM quotes WHERE id = $1 RETURNING id`,
        [id, next, user.id],
      );
      await tx.query(
        `INSERT INTO quote_lines (quote_id, position, item_id, code, lot_name, label, description, unit, quantity, mode, subcontractor_id, st_scope, grid_id, grid_labor_cost, grid_ends_on,
           labor_cost, labor_cost_source, labor_margin, labor_price_override, supply_pro_cost, supply_public_price, supply_pricing, supply_margin, supply_price_override, supplier, vat_rate, exception_reason, forced)
         SELECT $2, position, item_id, code, lot_name, label, description, unit, quantity, mode, subcontractor_id, st_scope, grid_id, grid_labor_cost, grid_ends_on,
           labor_cost, labor_cost_source, labor_margin, labor_price_override, supply_pro_cost, supply_public_price, supply_pricing, supply_margin, supply_price_override, supplier, vat_rate, exception_reason, forced
         FROM quote_lines WHERE quote_id = $1`,
        [id, created.id],
      );
      await tx.query("UPDATE quotes SET status = 'superseded', updated_at = now() WHERE number = $1 AND amendment_no = $2 AND id <> $3 AND status IN ('draft', 'sent', 'refused')", [row.number, row.amendment_no, created.id]);
      return created.id;
    });
    await auth.audit({ user, action: "quote.new_version", entity: "quote", entityId: newId, details: { from: id }, ip });
    return getQuote(newId, user);
  }

  async function createAmendment(id, input, { user, ip }) {
    permissions.require(user, "quotes.write");
    const { row } = await loadQuoteRow(id, user);
    if (row.status !== "signed" || row.amendment_no !== 0) throw httpError(409, "Un avenant s'ajoute sur le devis initial signé.");
    const newId = await db.tx(async (tx) => {
      const [{ next }] = await tx.query("SELECT max(amendment_no) + 1 AS next FROM quotes WHERE number = $1", [row.number]);
      const [created] = await tx.query(
        `INSERT INTO quotes (dossier_id, number, amendment_no, version, title, commercial_id, commission_rate, schedule, schedule_mode, valid_days, created_by)
         VALUES ($1, $2, $3, 1, $4, $5, $6, $7::jsonb, $8, 30, $9) RETURNING id`,
        [row.dossier_id, row.number, next, text(input.title, 200) || `Avenant ${next}`, row.commercial_id, row.commission_rate, JSON.stringify(AMENDMENT_SCHEDULE), input.scheduleMode === "merge" ? "merge" : "separate", user.id],
      );
      return created.id;
    });
    await auth.audit({ user, action: "quote.amendment_create", entity: "quote", entityId: newId, details: { quote: row.number }, ip });
    return getQuote(newId, user);
  }

  // ---------- Documents ----------

  async function documentContext(id, user) {
    const quote = await getQuote(id, user);
    const profile = await company.get();
    const logoPath = profile.logoKey ? fileStore.resolve(profile.logoKey) : null;
    const [dossierRow] = await db.query("SELECT * FROM dossiers WHERE id = $1", [quote.dossierId]);
    // Le PDF client est toujours calculé sur la version complète (le rôle ne change pas les montants).
    const full = await compute(quote, await loadLines(id));
    const lines = await loadLines(id);
    return { quote, lines, computed: full, company: profile, logoPath, dossier: dossierOut(dossierRow) };
  }

  async function clientPdf(id, user, { signature = null } = {}) {
    const context = await documentContext(id, user);
    return { buffer: await pdf.quote({ ...context, signature }), quote: context.quote };
  }

  async function markSent(id, { user, ip }) {
    permissions.require(user, "quotes.write");
    const { row } = await loadQuoteRow(id, user);
    if (row.status !== "draft" && row.status !== "sent") throw httpError(409, "Ce devis ne peut plus être envoyé.");
    if (row.status === "draft") await saveQuote(id, {}, { user, ip }); // fige les prix ST du jour
    const lines = await loadLines(id);
    if (!lines.length) throw httpError(400, "Le devis ne contient aucune ligne.");
    const { buffer } = await clientPdf(id, user);
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    await db.query("UPDATE quotes SET status = 'sent', sent_at = COALESCE(sent_at, now()), updated_at = now() WHERE id = $1", [id]);
    const [dossier] = await db.query("SELECT client_email FROM dossiers WHERE id = $1", [row.dossier_id]);
    await db.query("INSERT INTO signature_events (document_type, document_id, event, recipient, method, document_sha256, user_id, ip) VALUES ('quote', $1, 'sent', $2, 'pdf', $3, $4, $5)", [id, dossier?.client_email || null, hash, user.id, ip]);
    await auth.audit({ user, action: "quote.sent", entity: "quote", entityId: id, ip });
    return getQuote(id, user);
  }

  async function refuse(id, { reason }, { user, ip }) {
    permissions.require(user, "quotes.write");
    const { row } = await loadQuoteRow(id, user);
    if (!["draft", "sent"].includes(row.status)) throw httpError(409, "Ce devis ne peut pas être marqué refusé.");
    await db.query("UPDATE quotes SET status = 'refused', refused_at = now(), refusal_reason = $2, updated_at = now() WHERE id = $1", [id, text(reason, 300)]);
    await db.query("INSERT INTO signature_events (document_type, document_id, event, details, user_id, ip) VALUES ('quote', $1, 'refused', $2::jsonb, $3, $4)", [id, JSON.stringify({ reason: text(reason, 300) }), user.id, ip]);
    await auth.audit({ user, action: "quote.refused", entity: "quote", entityId: id, details: { reason: text(reason, 300) }, ip });
    return getQuote(id, user);
  }

  // Signature : sur place (tablette, signature dessinée) ou dépôt du devis signé (papier / prestataire).
  async function sign(id, input, { user, ip, userAgent }) {
    permissions.require(user, "quotes.write");
    const { row } = await loadQuoteRow(id, user);
    if (!["draft", "sent"].includes(row.status)) throw httpError(409, "Ce devis n'est plus signable.");
    if (row.status === "draft") await saveQuote(id, {}, { user, ip });
    const lines = await loadLines(id);
    if (!lines.length) throw httpError(400, "Le devis ne contient aucune ligne.");
    const quote = quoteOut((await db.query("SELECT * FROM quotes WHERE id = $1", [id]))[0]);
    const computed = await compute(quote, lines);
    if (computed.blocking.length) {
      if (!(input.force === true && permissions.can(user, "quotes.force"))) {
        throw httpError(409, `Signature bloquée : ${computed.blocking.map((alert) => alert.message).join(" ")}`, { code: "quote_blocked" });
      }
    }
    if (row.amendment_no > 0) {
      const [main] = await db.query("SELECT 1 FROM quotes WHERE number = $1 AND amendment_no = 0 AND status = 'signed'", [row.number]);
      if (!main) throw httpError(409, "Le devis initial doit être signé avant l'avenant.");
    }
    const signedAt = now();
    const signedIso = signedAt.toISOString().slice(0, 10);
    const [dossierRow] = await db.query("SELECT * FROM dossiers WHERE id = $1", [row.dossier_id]);
    const withdrawalUntil = dossierRow.off_premises ? withdrawalEnd(signedIso) : null;
    const method = input.method === "upload" ? "upload" : "onsite";
    const signerName = text(input.signerName, 120) || dossierRow.client_name;

    // Le document signé : PDF généré avec la signature et sa preuve, ou PDF déposé.
    let fileKey;
    let documentHash;
    let imageKey = null;
    if (method === "upload") {
      if (!input.file?.dataUrl) throw httpError(400, "Joignez le devis signé (PDF ou photo).");
      const stored = await fileStore.store({ name: input.file.name || `devis-${row.number}-signe.pdf`, type: input.file.type, dataUrl: input.file.dataUrl }, { user, ip });
      fileKey = stored.url.split("/").pop();
      documentHash = stored.sha256;
    } else {
      if (!/^data:image\/png;base64,/.test(String(input.signatureImage || ""))) throw httpError(400, "Signature du client manquante.");
      if (input.signatureImage.length > 600 * 1024) throw httpError(413, "Signature trop lourde.");
      if (input.accepted !== true) throw httpError(400, "Le client doit cocher « Bon pour accord ».");
      const unsigned = (await clientPdf(id, user)).buffer;
      const unsignedHash = crypto.createHash("sha256").update(unsigned).digest("hex");
      const image = await fileStore.store({ name: `signature-${row.number}.png`, type: "image/png", dataUrl: input.signatureImage }, { user, ip });
      imageKey = image.url.split("/").pop();
      const signature = { signerName, signedAt: signedAt.toISOString(), ip, userAgent: text(userAgent, 200), documentSha256: unsignedHash, imagePath: fileStore.resolve(imageKey), method, withdrawalUntil, earlyStart: input.earlyStartRequested === true };
      const signedPdf = (await clientPdf(id, user, { signature })).buffer;
      const stored = await fileStore.store({ name: `devis-${row.number}${row.amendment_no ? `-avenant-${row.amendment_no}` : ""}-signe.pdf`, type: "application/pdf", dataUrl: `data:application/pdf;base64,${signedPdf.toString("base64")}` }, { user, ip });
      fileKey = stored.url.split("/").pop();
      documentHash = unsignedHash;
    }
    const signatureRecord = { method, signerName, signedAt: signedAt.toISOString(), ip, userAgent: text(userAgent, 200), documentSha256: documentHash, imageKey, accepted: input.accepted === true || method === "upload" };

    const commissionRate = row.commission_rate ?? (await commissionRateOf(row.commercial_id));
    const frozen = await compute({ ...quote, commissionRate, status: "signed" }, lines);
    await db.tx(async (tx) => {
      await tx.query(
        `UPDATE quotes SET status = 'signed', signed_at = $2, signature = $3::jsonb, signed_file_key = $4, commission_rate = $5, withdrawal_until = $6, early_start_requested = $7, forced_by = $8, updated_at = now() WHERE id = $1`,
        [id, signedAt.toISOString(), JSON.stringify(signatureRecord), fileKey, commissionRate, withdrawalUntil, input.earlyStartRequested === true, computed.blocking.length ? user.id : null],
      );
      await persistTotals(tx, id, frozen);
      await tx.query("UPDATE quotes SET status = 'superseded', updated_at = now() WHERE number = $1 AND amendment_no = $2 AND id <> $3 AND status IN ('draft', 'sent')", [row.number, row.amendment_no, id]);
      await tx.query("INSERT INTO signature_events (document_type, document_id, event, method, recipient, document_sha256, details, user_id, ip) VALUES ('quote', $1, 'signed', $2, $3, $4, $5::jsonb, $6, $7)", [id, method, signerName, documentHash, JSON.stringify({ withdrawalUntil }), user.id, ip]);
    });
    if (computed.blocking.length) await auth.audit({ user, action: "quote.forced", entity: "quote", entityId: id, details: { alerts: computed.blocking.map((alert) => alert.message) }, ip });
    await auth.audit({ user, action: "quote.signed", entity: "quote", entityId: id, details: { number: row.number, amendment: row.amendment_no, sale: frozen.sale, method }, ip });

    const orders = await createPurchaseOrders(id, { user, ip });
    const chantier = await syncChantier(id, { user, ip });
    return { quote: await getQuote(id, user), orders, chantier };
  }

  // ---------- Bons de commande ST ----------

  async function createPurchaseOrders(quoteId, { user, ip }) {
    const [quoteRow] = await db.query("SELECT * FROM quotes WHERE id = $1", [quoteId]);
    const lines = await loadLines(quoteId);
    const groups = new Map();
    for (const line of lines) {
      if (!line.subcontractorId || line.stScope === "none") continue;
      const labor = line.stScope !== "supply" && pricing.includesLabor(line);
      const supply = (line.stScope === "supply" || line.stScope === "both") && pricing.includesSupply(line);
      if (!labor && !supply) continue;
      const laborUnit = labor ? Number(line.laborCost || 0) : 0;
      const supplyUnit = supply ? Number(line.supplyProCost || 0) : 0;
      const entry = { code: line.code, lotName: line.lotName, label: line.label, description: line.description, unit: line.unit, quantity: line.quantity, scope: labor && supply ? "both" : labor ? "labor" : "supply", laborUnit, supplyUnit, total: pricing.round2((laborUnit + supplyUnit) * line.quantity) };
      groups.set(line.subcontractorId, [...(groups.get(line.subcontractorId) || []), entry]);
    }
    const created = [];
    for (const [stId, orderLines] of groups) {
      const total = pricing.round2(orderLines.reduce((sum, line) => sum + line.total, 0));
      const compliance = await subcontractors.compliance(stId);
      const [st] = await db.query("SELECT name FROM subcontractors WHERE id = $1", [stId]);
      const suffix = quoteRow.amendment_no ? `-A${quoteRow.amendment_no}` : "";
      const slug = String(st.name).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "ST";
      const number = `BC-${quoteRow.number}${suffix}-${slug}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const [order] = await db.query(
        `INSERT INTO purchase_orders (quote_id, subcontractor_id, number, lines, schedule, total, status, blocked_reason)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8) ON CONFLICT (quote_id, subcontractor_id) DO NOTHING RETURNING *`,
        [quoteId, stId, number, JSON.stringify(orderLines), JSON.stringify(pricing.splitSchedule(total, quoteRow.schedule)), total, compliance.blocked ? "blocked" : "ready", compliance.blocked ? compliance.issues.filter((issue) => issue.level !== "expiring").map((issue) => issue.message).join(" · ") : null],
      );
      if (order) created.push(orderOut({ ...order, st_name: st.name }));
    }
    if (created.length) await auth.audit({ user, action: "orders.created", entity: "quote", entityId: quoteId, details: { orders: created.map((o) => o.number), blocked: created.filter((o) => o.status === "blocked").length }, ip });
    return created;
  }

  async function getOrder(id, user) {
    permissions.require(user, "quotes.costs");
    const [row] = await db.query(`SELECT p.*, s.name AS st_name FROM purchase_orders p JOIN subcontractors s ON s.id = p.subcontractor_id WHERE p.id = $1`, [id]);
    if (!row) throw httpError(404, "Bon de commande introuvable.");
    await loadQuoteRow(row.quote_id, user); // contrôle d'accès au dossier
    return orderOut(row);
  }

  // Recontrôle des documents du ST : débloque le bon de commande quand tout est à jour.
  async function recheckOrder(id, { user, ip }) {
    const order = await getOrder(id, user);
    if (order.status !== "blocked") return order;
    const compliance = await subcontractors.compliance(order.subcontractorId);
    if (compliance.blocked) throw httpError(409, `Bon de commande toujours bloqué : ${compliance.issues.filter((issue) => issue.level !== "expiring").map((issue) => issue.message).join(" · ")}`);
    await db.query("UPDATE purchase_orders SET status = 'ready', blocked_reason = NULL WHERE id = $1", [id]);
    await auth.audit({ user, action: "orders.unblocked", entity: "purchase_order", entityId: id, ip });
    return getOrder(id, user);
  }

  async function orderPdf(id, user) {
    const order = await getOrder(id, user);
    if (order.status === "blocked") throw httpError(409, `Bon de commande bloqué : ${order.blockedReason}`);
    const [quoteRow] = await db.query("SELECT * FROM quotes WHERE id = $1", [order.quoteId]);
    const [dossierRow] = await db.query("SELECT * FROM dossiers WHERE id = $1", [quoteRow.dossier_id]);
    const [stRow] = await db.query("SELECT * FROM subcontractors WHERE id = $1", [order.subcontractorId]);
    const profile = await company.get();
    return pdf.purchaseOrder({ order, quote: quoteOut(quoteRow), dossier: dossierOut(dossierRow), subcontractor: stRow, company: profile, logoPath: profile.logoKey ? fileStore.resolve(profile.logoKey) : null });
  }

  // ---------- Chantier (application de suivi) ----------

  // Devis initial signé → création du chantier ; avenant signé → ajout de ses lots au même chantier.
  // Écriture versionnée (comme un poste de travail) : aucune donnée existante n'est modifiée ou supprimée.
  async function syncChantier(quoteId, { user, ip }) {
    if (!stateStore) return null;
    const [quoteRow] = await db.query("SELECT * FROM quotes WHERE id = $1", [quoteId]);
    const [dossierRow] = await db.query("SELECT * FROM dossiers WHERE id = $1", [quoteRow.dossier_id]);
    const lines = await loadLines(quoteId);
    const stRows = await db.query("SELECT id, legacy_id, name, lots FROM subcontractors WHERE id = ANY($1::uuid[])", [[...new Set(lines.map((line) => line.subcontractorId).filter(Boolean))]]);
    const stById = new Map(stRows.map((st) => [st.id, st]));
    const rate = Number(quoteRow.commission_rate || 0);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await stateStore.get();
      const data = structuredClone(current.data || {});
      data.projects = Array.isArray(data.projects) ? data.projects : [];
      data.subcontractors = Array.isArray(data.subcontractors) ? data.subcontractors : [];
      const legacyIds = new Map();
      for (const st of stById.values()) {
        let legacyId = st.legacy_id;
        if (!legacyId || !data.subcontractors.some((item) => item.id === legacyId)) {
          legacyId = legacyId || `nova-st-${st.id}`;
          if (!data.subcontractors.some((item) => item.id === legacyId)) {
            data.subcontractors.push({ id: legacyId, companyName: st.name, trade: (st.lots || [])[0] || "", maxProjects: 3, documents: {}, createdAt: new Date().toISOString(), source: "nova-devis" });
          }
        }
        legacyIds.set(st.id, legacyId);
      }

      const prefix = quoteRow.amendment_no ? `Avenant ${quoteRow.amendment_no} · ` : "";
      const lots = new Map();
      for (const line of lines) {
        const result = pricing.computeLine(line);
        const key = `${line.lotName}::${line.subcontractorId || ""}`;
        const lot = lots.get(key) || { id: crypto.randomUUID(), name: `${prefix}${line.lotName}`, source: `${quoteRow.amendment_no ? "Avenant" : "Devis"} ${quoteRow.number} signé`, sale: 0, material: 0, labor: 0, commercial: 0, commercialRate: rate, other: 0, planned: 0, progress: 0, laborType: line.subcontractorId && line.stScope !== "none" ? "subcontractor" : "employee", subcontractorId: line.subcontractorId && line.stScope !== "none" ? legacyIds.get(line.subcontractorId) : "", novaQuoteId: quoteId };
        lot.sale = pricing.round2(lot.sale + result.sale);
        lot.material = pricing.round2(lot.material + result.supplyCost);
        lot.labor = pricing.round2(lot.labor + result.laborCost);
        lot.commercial = pricing.round2((lot.sale * rate) / 100);
        lot.planned = pricing.round2(lot.material + lot.labor);
        lots.set(key, lot);
      }

      let project = dossierRow.project_id ? data.projects.find((p) => p.id === dossierRow.project_id) : null;
      if (project && project.lots?.some((lot) => lot.novaQuoteId === quoteId)) return { projectId: project.id, created: false, alreadySynced: true };
      const signedIso = isoDate(quoteRow.signed_at?.toISOString ? quoteRow.signed_at.toISOString() : quoteRow.signed_at) || todayIso();
      let created = false;
      if (!project) {
        // Démarrage : pas avant la fin de la rétractation, sauf demande expresse du client.
        let start = isoDate(quoteRow.work_start_on) || signedIso;
        const withdrawal = isoDate(quoteRow.withdrawal_until);
        if (withdrawal && !quoteRow.early_start_requested && start <= withdrawal) start = addDays(withdrawal, 1);
        const end = addDays(start, 60);
        // Contrat hors établissement : aucun paiement avant le 8e jour suivant la signature (art. L221-10 C. conso).
        const firstPayment = dossierRow.off_premises ? addDays(signedIso, 8) : start;
        const steps = quoteRow.schedule;
        const spread = Math.max(steps.length - 1, 1);
        project = {
          id: `chantier-${Date.now()}`,
          name: dossierRow.client_name,
          client: dossierRow.client_name,
          address: dossierRow.site_address || dossierRow.client_address || "",
          startDate: start,
          endDate: end,
          status: "Devis signé",
          archived: false,
          archivedAt: "",
          quoteFile: quoteRow.signed_file_key ? `/uploads/${quoteRow.signed_file_key}` : "",
          documents: quoteRow.signed_file_key ? [{ id: crypto.randomUUID(), name: `Devis ${quoteRow.number} signé.pdf`, url: `/uploads/${quoteRow.signed_file_key}`, type: "application/pdf", category: "Devis", addedAt: new Date().toISOString() }] : [],
          lots: [],
          invoices: steps.map((step, index) => {
            const spreadDate = addDays(start, Math.round((60 * index) / spread));
            const date = index === 0 && firstPayment > spreadDate ? firstPayment : spreadDate;
            return { id: crypto.randomUUID(), label: step.label, action: `Facture ${String(step.percent).replace(".", ",")}% à envoyer`, percent: Number(step.percent), date, status: "pending" };
          }),
          novaDossierId: dossierRow.id,
          withdrawalUntil: withdrawal || undefined,
        };
        data.projects.push(project);
        created = true;
      } else if (quoteRow.signed_file_key) {
        project.documents = Array.isArray(project.documents) ? project.documents : [];
        project.documents.push({ id: crypto.randomUUID(), name: `Avenant ${quoteRow.amendment_no} · devis ${quoteRow.number} signé.pdf`, url: `/uploads/${quoteRow.signed_file_key}`, type: "application/pdf", category: "Devis", addedAt: new Date().toISOString() });
      }
      project.lots = [...(project.lots || []), ...lots.values()];
      try {
        const saved = await stateStore.save({ data, baseVersion: current.version, user, ip, source: "quote_signature" });
        if (created) await db.query("UPDATE dossiers SET project_id = $2, updated_at = now() WHERE id = $1", [dossierRow.id, project.id]);
        for (const [stId, legacyId] of legacyIds) await db.query("UPDATE subcontractors SET legacy_id = $2 WHERE id = $1 AND legacy_id IS NULL", [stId, legacyId]);
        await auth.audit({ user, action: created ? "chantier.created_from_quote" : "chantier.amendment_added", entity: "quote", entityId: quoteId, details: { projectId: project.id, lots: lots.size, version: saved.version }, ip });
        return { projectId: project.id, created, version: saved.version };
      } catch (error) {
        if (error.status !== 409 || attempt === 2) throw error;
      }
    }
    return null;
  }

  // ---------- PV de réception ----------

  async function createReception(dossierId, input, { user, ip }) {
    permissions.require(user, "receptions.write");
    const dossier = await loadDossierRow(dossierId, user);
    const [main] = await db.query("SELECT 1 FROM quotes WHERE dossier_id = $1 AND amendment_no = 0 AND status = 'signed'", [dossierId]);
    if (!main) throw httpError(409, "La réception suppose un devis signé.");
    const receivedOn = isoDate(input.receivedOn) || todayIso();
    const reserves = (Array.isArray(input.reserves) ? input.reserves : []).map((reserve) => ({ label: text(reserve.label, 300), lot: text(reserve.lot, 80), deadline: isoDate(reserve.deadline) || null, lifted: false })).filter((reserve) => reserve.label).slice(0, 100);
    const [row] = await db.query("INSERT INTO receptions (dossier_id, received_on, reserves, created_by) VALUES ($1, $2, $3::jsonb, $4) RETURNING *", [dossier.id, receivedOn, JSON.stringify(reserves), user.id]);
    await auth.audit({ user, action: "reception.create", entity: "reception", entityId: row.id, details: { reserves: reserves.length }, ip });
    return receptionOut(row);
  }

  async function signReception(id, input, { user, ip, userAgent }) {
    permissions.require(user, "receptions.write");
    const [row] = await db.query("SELECT * FROM receptions WHERE id = $1", [id]);
    if (!row) throw httpError(404, "PV introuvable.");
    const dossierRow = await loadDossierRow(row.dossier_id, user);
    if (row.status === "signed") throw httpError(409, "PV déjà signé.");
    if (!/^data:image\/png;base64,/.test(String(input.signatureImage || ""))) throw httpError(400, "Signature du client manquante.");
    const profile = await company.get();
    const image = await fileStore.store({ name: "signature-reception.png", type: "image/png", dataUrl: input.signatureImage }, { user, ip });
    const signedAt = now().toISOString();
    const signature = { signerName: text(input.signerName, 120) || dossierRow.client_name, signedAt, ip, userAgent: text(userAgent, 200), imagePath: fileStore.resolve(image.url.split("/").pop()) };
    const buffer = await pdf.reception({ reception: receptionOut(row), dossier: dossierOut(dossierRow), company: profile, logoPath: profile.logoKey ? fileStore.resolve(profile.logoKey) : null, signature });
    const stored = await fileStore.store({ name: `pv-reception-${isoDate(row.received_on)}.pdf`, type: "application/pdf", dataUrl: `data:application/pdf;base64,${buffer.toString("base64")}` }, { user, ip });
    const { imagePath, ...record } = signature;
    await db.query("UPDATE receptions SET status = 'signed', signature = $2::jsonb, signed_file_key = $3, signed_at = $4 WHERE id = $1", [id, JSON.stringify({ ...record, imageKey: image.url.split("/").pop(), documentSha256: stored.sha256 }), stored.url.split("/").pop(), signedAt]);
    await db.query("INSERT INTO signature_events (document_type, document_id, event, method, recipient, document_sha256, user_id, ip) VALUES ('reception', $1, 'signed', 'onsite', $2, $3, $4, $5)", [id, signature.signerName, stored.sha256, user.id, ip]);
    await auth.audit({ user, action: "reception.signed", entity: "reception", entityId: id, details: { reserves: row.reserves.length }, ip });
    await markBalanceDue(dossierRow, row, stored.url, { user, ip });
    return receptionOut((await db.query("SELECT * FROM receptions WHERE id = $1", [id]))[0]);
  }

  // Le PV signé déclenche le solde : la dernière échéance du chantier passe à la date de réception.
  async function markBalanceDue(dossierRow, reception, pvUrl, { user, ip }) {
    if (!stateStore || !dossierRow.project_id) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await stateStore.get();
      const data = structuredClone(current.data);
      const project = (data.projects || []).find((p) => p.id === dossierRow.project_id);
      if (!project) return;
      const last = (project.invoices || []).filter((invoice) => invoice.status !== "done").slice(-1)[0];
      if (last) {
        // Jamais avant la première échéance (qui respecte déjà J+8 hors établissement).
        last.date = [isoDate(reception.received_on), project.invoices[0]?.date].filter(Boolean).sort().pop();
        last.action = `Solde exigible : PV de réception signé${reception.reserves.length ? ` avec ${reception.reserves.length} réserve(s)` : ""}`;
      }
      project.documents = [...(project.documents || []), { id: crypto.randomUUID(), name: `PV de réception ${isoDate(reception.received_on)}.pdf`, url: pvUrl, type: "application/pdf", category: "Réception", addedAt: new Date().toISOString() }];
      try {
        await stateStore.save({ data, baseVersion: current.version, user, ip, source: "reception" });
        return;
      } catch (error) {
        if (error.status !== 409 || attempt === 2) throw error;
      }
    }
  }

  // ---------- Rapport des exceptions (où la marge se perd) ----------

  async function exceptionsReport(user, { month }) {
    permissions.require(user, "quotes.exceptions_report");
    const period = /^\d{4}-\d{2}$/.test(month || "") ? month : todayIso().slice(0, 7);
    const rows = await db.query(
      `SELECT q.id, q.number, q.amendment_no, q.version, q.status, q.signed_at, q.updated_at, d.client_name, u.display_name AS commercial_name
       FROM quotes q JOIN dossiers d ON d.id = q.dossier_id LEFT JOIN users u ON u.id = q.commercial_id
       WHERE q.status IN ('sent', 'signed') AND to_char(COALESCE(q.signed_at, q.sent_at, q.updated_at), 'YYYY-MM') = $1`,
      [period],
    );
    const items = [];
    for (const row of rows) {
      const lines = await loadLines(row.id);
      lines.forEach((line) => {
        pricing.computeLine(line).exceptions.forEach((item) => items.push({ ...item, kindLabel: item.label, quoteId: row.id, number: row.number, amendmentNo: row.amendment_no, version: row.version, status: row.status, clientName: row.client_name, commercialName: row.commercial_name, label: line.label, lotName: line.lotName, subcontractorName: line.subcontractorName, reason: line.exceptionReason }));
      });
    }
    const lostMargin = pricing.round2(items.filter((item) => item.kind === "cost").reduce((sum, item) => sum + Math.max(item.diffTotal, 0), 0) + items.filter((item) => item.kind !== "cost").reduce((sum, item) => sum + Math.max(-item.diffTotal, 0), 0));
    return { month: period, count: items.length, lostMargin, items };
  }

  async function setNumberStart({ year, next }, { user, ip }) {
    permissions.require(user, "commissions.all", "Réservé à l'administrateur.");
    const y = Number(year);
    const n = Number(next);
    if (!Number.isInteger(y) || y < 2020 || y > 2100 || !Number.isInteger(n) || n < 1 || n > 99999) throw httpError(400, "Année ou numéro invalide.");
    const [{ used }] = await db.query("SELECT count(*)::int AS used FROM quotes WHERE number >= $1 AND number LIKE $2", [`${y}-${String(n).padStart(3, "0")}`, `${y}-%`]);
    if (used) throw httpError(409, "Ce numéro est déjà utilisé : choisissez un numéro supérieur au dernier devis.");
    await db.query("INSERT INTO sequences (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`devis-${y}`, n - 1]);
    await auth.audit({ user, action: "quote.numbering", entity: "sequence", entityId: `devis-${y}`, details: { next: n }, ip });
    return { year: y, next: `${y}-${String(n).padStart(3, "0")}` };
  }

  return {
    listDossiers, saveDossier, getDossier,
    createQuote, getQuote, saveQuote, addFromLibrary, newVersion, createAmendment,
    clientPdf, markSent, refuse, sign,
    getOrder, recheckOrder, orderPdf,
    createReception, signReception,
    exceptionsReport, setNumberStart, syncChantier,
  };
}

const orderOut = (row) => ({
  id: row.id,
  quoteId: row.quote_id,
  subcontractorId: row.subcontractor_id,
  subcontractorName: row.st_name,
  number: row.number,
  lines: row.lines,
  schedule: row.schedule,
  total: row.total,
  status: row.status,
  statusLabel: { ready: "Prêt", blocked: "Bloqué", sent: "Envoyé", signed: "Signé", cancelled: "Annulé" }[row.status],
  blockedReason: row.blocked_reason,
  createdAt: row.created_at,
});

const receptionOut = (row) => ({
  id: row.id,
  dossierId: row.dossier_id,
  receivedOn: isoDate(row.received_on),
  reserves: row.reserves,
  status: row.status,
  signedAt: row.signed_at,
  signedUrl: row.signed_file_key ? `/uploads/${row.signed_file_key}` : null,
  signerName: row.signature?.signerName || null,
});

module.exports = { createQuotes, withdrawalEnd, STATUS_LABELS };
