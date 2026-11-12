"use strict";

// Objectifs, point mort, classement et commissions (module 5).
// Point mort = frais fixes du mois ÷ marge nette moyenne (après commission) des devis signés sur 6 mois.
// Objectif d'équipe = point mort + bénéfice visé ; l'administrateur le répartit entre les commerciaux.
// Le détail des frais fixes, le point mort en euros et le bénéfice restent réservés à l'administrateur.

const { httpError } = require("./security");
const permissions = require("./permissions");
const { SELLER_ROLES } = require("./crm");

const COST_CATEGORIES = {
  rent: "Loyer et locaux",
  salaries: "Salaires et charges",
  vehicles: "Véhicules et carburant",
  insurance: "Assurances",
  software: "Logiciels et abonnements",
  accounting: "Comptable, banque, juridique",
  ads_meta: "Publicité Meta (Facebook / Instagram)",
  ads_google: "Publicité Google Ads",
  marketing: "Autre marketing",
  other: "Autres frais",
};
const AD_CATEGORIES = { meta: "ads_meta", google: "ads_google" };

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;

// Décalage horaire de Paris à un instant donné (heure d'été comprise), en millisecondes.
function parisOffset(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(ms / 1000) * 1000;
}
function parisMidnight(y, m, d = 1) {
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - parisOffset(guess - parisOffset(guess)));
}
function parisMonth(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}`;
}
function periodBounds(period) {
  if (MONTH_RE.test(period)) {
    const [y, m] = period.split("-").map(Number);
    return { start: parisMidnight(y, m), end: m === 12 ? parisMidnight(y + 1, 1) : parisMidnight(y, m + 1), kind: "month" };
  }
  if (YEAR_RE.test(period)) {
    const y = Number(period);
    return { start: parisMidnight(y, 1), end: parisMidnight(y + 1, 1), kind: "year" };
  }
  throw httpError(400, "Période invalide (AAAA-MM ou AAAA).");
}

function createGoals(db, { auth, company, now = () => new Date() }) {
  const isAdmin = (user) => permissions.can(user, "goals.manage");

  async function goalSettings() {
    const [row] = await db.query("SELECT value FROM crm_settings WHERE key = 'goals'");
    return { profitTarget: 0, ...(row?.value || {}) };
  }

  // ---------- Frais fixes (administrateur) ----------

  async function listFixedCosts(user) {
    permissions.require(user, "goals.manage");
    const rows = await db.query("SELECT * FROM fixed_costs ORDER BY active DESC, category, label");
    return rows.map((row) => ({ id: row.id, category: row.category, categoryLabel: COST_CATEGORIES[row.category] || row.category, label: row.label, monthlyAmount: Number(row.monthly_amount), active: row.active, notes: row.notes }));
  }

  async function saveFixedCost(input, { user, ip }) {
    permissions.require(user, "goals.manage");
    const category = COST_CATEGORIES[input.category] ? input.category : "other";
    const label = text(input.label, 120) || COST_CATEGORIES[category];
    const amount = Number(String(input.monthlyAmount ?? "").replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) throw httpError(400, "Montant mensuel invalide.");
    const values = [category, label, round2(amount), input.active !== false, text(input.notes, 500)];
    let row;
    if (input.id) {
      [row] = await db.query("UPDATE fixed_costs SET category = $1, label = $2, monthly_amount = $3, active = $4, notes = $5, updated_at = now() WHERE id = $6 RETURNING *", [...values, input.id]);
      if (!row) throw httpError(404, "Frais introuvable.");
    } else {
      [row] = await db.query("INSERT INTO fixed_costs (category, label, monthly_amount, active, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *", values);
    }
    await auth.audit({ user, action: input.id ? "goals.fixed_cost_update" : "goals.fixed_cost_create", entity: "fixed_cost", entityId: row.id, details: { category, label }, ip });
    return listFixedCosts(user);
  }

  async function removeFixedCost(id, { user, ip }) {
    permissions.require(user, "goals.manage");
    const [row] = await db.query("DELETE FROM fixed_costs WHERE id = $1 RETURNING label, monthly_amount", [id]);
    if (!row) throw httpError(404, "Frais introuvable.");
    await auth.audit({ user, action: "goals.fixed_cost_delete", entity: "fixed_cost", entityId: id, details: { label: row.label, amount: Number(row.monthly_amount) }, ip });
    return listFixedCosts(user);
  }

  async function saveProfitTarget({ profitTarget }, { user, ip }) {
    permissions.require(user, "goals.manage");
    const amount = Number(String(profitTarget ?? "").replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) throw httpError(400, "Bénéfice visé invalide.");
    const next = { ...(await goalSettings()), profitTarget: round2(amount) };
    await db.query("INSERT INTO crm_settings (key, value) VALUES ('goals', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify(next)]);
    await auth.audit({ user, action: "goals.profit_target", entity: "crm_settings", entityId: "goals", details: { profitTarget: next.profitTarget }, ip });
    return next;
  }

  // ---------- Point mort ----------

  async function breakeven() {
    const fixed = await db.query("SELECT category, monthly_amount FROM fixed_costs WHERE active");
    const fixedTotal = round2(fixed.reduce((sum, row) => sum + Number(row.monthly_amount), 0));
    const since = new Date(now().getTime());
    since.setMonth(since.getMonth() - 6);
    const signed = await db.query("SELECT totals FROM quotes WHERE status = 'signed' AND signed_at >= $1", [since.toISOString()]);
    const sale = signed.reduce((sum, row) => sum + Number(row.totals?.sale || 0), 0);
    const net = signed.reduce((sum, row) => sum + Number(row.totals?.net || 0), 0);
    let rate = sale > 0 ? (net / sale) * 100 : null;
    let estimated = false;
    if (rate === null) {
      const profile = await company.get();
      rate = Number(profile.margins?.minimumNet || 0);
      estimated = true;
    }
    const amount = rate > 0 ? round2(fixedTotal / (rate / 100)) : null;
    const settings = await goalSettings();
    return {
      fixedTotal,
      netRate: round2(rate),
      estimated, // aucun devis signé sur 6 mois : marge nette minimum de la fiche entreprise
      quotesCount: signed.length,
      amount, // CA HT signé minimum du mois
      profitTarget: Number(settings.profitTarget || 0),
      teamObjective: amount === null ? null : round2(amount + Number(settings.profitTarget || 0)),
      adSpend: Object.fromEntries(Object.entries(AD_CATEGORIES).map(([source, category]) => [source, round2(fixed.filter((row) => row.category === category).reduce((sum, row) => sum + Number(row.monthly_amount), 0))])),
    };
  }

  // ---------- Objectifs ----------

  async function sellers() {
    return db.query("SELECT id, display_name, role, active FROM users WHERE active AND role = ANY($1::text[]) ORDER BY display_name", [SELLER_ROLES]);
  }

  async function objectivesFor(period) {
    const rows = await db.query("SELECT user_id, amount FROM sales_objectives WHERE period = $1", [period]);
    const map = new Map(rows.map((row) => [row.user_id || "team", Number(row.amount)]));
    return map;
  }

  async function teamObjective(period, be = null) {
    const map = await objectivesFor(period);
    if (map.has("team")) return { amount: map.get("team"), computed: false };
    be = be || (await breakeven());
    if (be.teamObjective === null) return { amount: null, computed: true };
    return { amount: MONTH_RE.test(period) ? be.teamObjective : round2(be.teamObjective * 12), computed: true };
  }

  async function listObjectives(user, { period }) {
    permissions.require(user, "goals.manage");
    periodBounds(period);
    const be = await breakeven();
    const map = await objectivesFor(period);
    const team = await teamObjective(period, be);
    const people = await sellers();
    const assigned = round2(people.reduce((sum, p) => sum + (map.get(p.id) || 0), 0));
    return {
      period,
      team: { ...team, override: map.has("team") ? map.get("team") : null, suggested: MONTH_RE.test(period) ? be.teamObjective : be.teamObjective === null ? null : round2(be.teamObjective * 12) },
      assigned,
      remaining: team.amount === null ? null : round2(team.amount - assigned),
      sellers: people.map((p) => ({ id: p.id, displayName: p.display_name, role: p.role, amount: map.has(p.id) ? map.get(p.id) : null })),
    };
  }

  async function setObjectives({ period, team, sellers: list = [] }, { user, ip }) {
    permissions.require(user, "goals.manage");
    periodBounds(period);
    const amountOf = (value) => {
      if (value === null || value === undefined || value === "") return null;
      const amount = Number(String(value).replace(",", "."));
      if (!Number.isFinite(amount) || amount < 0) throw httpError(400, "Montant d'objectif invalide.");
      return round2(amount);
    };
    const upsert = async (userId, amount) => {
      if (amount === null) {
        await db.query("DELETE FROM sales_objectives WHERE period = $1 AND user_id IS NOT DISTINCT FROM $2", [period, userId]);
        return;
      }
      const [existing] = await db.query("SELECT id FROM sales_objectives WHERE period = $1 AND user_id IS NOT DISTINCT FROM $2", [period, userId]);
      if (existing) await db.query("UPDATE sales_objectives SET amount = $2, updated_at = now() WHERE id = $1", [existing.id, amount]);
      else await db.query("INSERT INTO sales_objectives (user_id, period, amount) VALUES ($1, $2, $3)", [userId, period, amount]);
    };
    if (team !== undefined) await upsert(null, amountOf(team));
    const valid = new Set((await sellers()).map((p) => p.id));
    for (const entry of list) {
      if (!valid.has(entry.id)) throw httpError(400, "Commercial inconnu ou inactif.");
      await upsert(entry.id, amountOf(entry.amount));
    }
    await auth.audit({ user, action: "goals.objectives", entity: "sales_objectives", entityId: period, details: { team: team ?? undefined, sellers: list.length }, ip });
    return listObjectives(user, { period });
  }

  // Répartition à parts égales de l'objectif d'équipe entre les commerciaux actifs.
  async function splitEqually({ period, ids = null }, { user, ip }) {
    permissions.require(user, "goals.manage");
    const team = await teamObjective(period);
    if (team.amount === null) throw httpError(400, "Renseignez d'abord les frais fixes ou un objectif d'équipe.");
    let people = (await sellers()).map((p) => p.id);
    if (Array.isArray(ids) && ids.length) people = people.filter((id) => ids.includes(id));
    if (!people.length) throw httpError(400, "Aucun commercial actif.");
    const share = Math.floor((team.amount / people.length) * 100) / 100;
    const last = round2(team.amount - share * (people.length - 1));
    return setObjectives({ period, sellers: people.map((id, index) => ({ id, amount: index === people.length - 1 ? last : share })) }, { user, ip });
  }

  // ---------- Paliers de primes ----------

  async function listTiers({ includeInactive = false } = {}) {
    const rows = await db.query(`SELECT * FROM bonus_tiers ${includeInactive ? "" : "WHERE active"} ORDER BY period_kind, threshold, position`);
    return rows.map((row) => ({ id: row.id, label: row.label, periodKind: row.period_kind, threshold: Number(row.threshold), reward: row.reward, active: row.active }));
  }

  async function saveTier(input, { user, ip }) {
    permissions.require(user, "goals.manage");
    const label = text(input.label, 80);
    if (!label) throw httpError(400, "Nom du palier obligatoire.");
    const threshold = Number(String(input.threshold ?? "").replace(",", "."));
    if (!Number.isFinite(threshold) || threshold <= 0) throw httpError(400, "Seuil du palier invalide.");
    const values = [label, input.periodKind === "year" ? "year" : "month", round2(threshold), text(input.reward, 200), input.active !== false];
    let row;
    if (input.id) {
      [row] = await db.query("UPDATE bonus_tiers SET label = $1, period_kind = $2, threshold = $3, reward = $4, active = $5 WHERE id = $6 RETURNING *", [...values, input.id]);
      if (!row) throw httpError(404, "Palier introuvable.");
    } else [row] = await db.query("INSERT INTO bonus_tiers (label, period_kind, threshold, reward, active) VALUES ($1, $2, $3, $4, $5) RETURNING *", values);
    await auth.audit({ user, action: "goals.tier", entity: "bonus_tier", entityId: row.id, details: { label, threshold: values[2] }, ip });
    return listTiers({ includeInactive: true });
  }

  async function removeTier(id, { user, ip }) {
    permissions.require(user, "goals.manage");
    const [row] = await db.query("DELETE FROM bonus_tiers WHERE id = $1 RETURNING label", [id]);
    if (!row) throw httpError(404, "Palier introuvable.");
    await auth.audit({ user, action: "goals.tier_delete", entity: "bonus_tier", entityId: id, details: { label: row.label }, ip });
    return listTiers({ includeInactive: true });
  }

  // ---------- Chiffres signés ----------

  async function signedBetween(start, end) {
    return db.query(
      `SELECT q.id, q.commercial_id, q.amendment_no, q.totals, q.signed_at, q.commission_rate, u.display_name
       FROM quotes q LEFT JOIN users u ON u.id = q.commercial_id
       WHERE q.status = 'signed' AND q.signed_at >= $1 AND q.signed_at < $2 ORDER BY q.signed_at`,
      [start.toISOString(), end.toISOString()],
    );
  }

  function bySeller(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = row.commercial_id || "none";
      const entry = map.get(key) || { id: row.commercial_id, name: row.display_name || "Sans commercial", sale: 0, signatures: 0, mainSignatures: 0, firstAt: row.signed_at };
      entry.sale += Number(row.totals?.sale || 0);
      entry.signatures += 1;
      if (!row.amendment_no) entry.mainSignatures += 1;
      map.set(key, entry);
    }
    for (const entry of map.values()) {
      entry.sale = round2(entry.sale);
      entry.basket = entry.mainSignatures ? round2(entry.sale / entry.mainSignatures) : entry.signatures ? round2(entry.sale / entry.signatures) : 0;
    }
    return map;
  }

  // ---------- Tableau de bord commercial ----------

  async function dashboard(user, { period } = {}) {
    permissions.require(user, "goals.view");
    period = period && MONTH_RE.test(period) ? period : parisMonth(now());
    const { start, end } = periodBounds(period);
    const year = period.slice(0, 4);
    const yearBounds = periodBounds(year);
    const admin = isAdmin(user);
    const team = permissions.can(user, "crm.team_stats");

    const be = await breakeven();
    const objectives = await objectivesFor(period);
    const yearObjectives = await objectivesFor(year);
    const teamGoal = await teamObjective(period, be);
    const teamYearGoal = await teamObjective(year, be);
    const monthRows = await signedBetween(start, end);
    const yearRows = await signedBetween(yearBounds.start, yearBounds.end);
    const sellersMap = bySeller(monthRows);
    const yearMap = bySeller(yearRows);
    const teamSigned = round2(monthRows.reduce((sum, row) => sum + Number(row.totals?.sale || 0), 0));
    const teamYearSigned = round2(yearRows.reduce((sum, row) => sum + Number(row.totals?.sale || 0), 0));
    const teamNet = round2(monthRows.reduce((sum, row) => sum + Number(row.totals?.net || 0), 0));
    const breakevenReached = be.amount !== null && be.fixedTotal > 0 && teamSigned >= be.amount;
    const tiers = await listTiers();

    // Classement de l'équipe : CA HT signé du mois, avec badges.
    const people = await sellers();
    const ids = new Set(people.map((p) => p.id));
    for (const entry of sellersMap.values()) if (entry.id && !ids.has(entry.id)) people.push({ id: entry.id, display_name: entry.name, role: "autre" });
    const bestBasket = Math.max(0, ...[...sellersMap.values()].filter((e) => e.id).map((e) => e.basket));
    const ranking = people
      .map((p) => {
        const stats = sellersMap.get(p.id) || { sale: 0, signatures: 0, basket: 0 };
        const objective = objectives.get(p.id) ?? null;
        const progress = objective ? round2((stats.sale / objective) * 100) : null;
        const badges = [];
        if (stats.signatures > 0) badges.push({ key: "first", label: "Première signature du mois" });
        if (objective && stats.sale >= objective) badges.push({ key: "objective", label: "Objectif atteint" });
        const reached = tiers.filter((tier) => tier.periodKind === "month" && stats.sale >= tier.threshold);
        if (reached.length) badges.push({ key: "tier", label: `Palier ${reached[reached.length - 1].label}` });
        const yearSale = yearMap.get(p.id)?.sale || 0;
        const yearTier = tiers.filter((tier) => tier.periodKind === "year" && yearSale >= tier.threshold).pop();
        if (yearTier) badges.push({ key: "tier_year", label: `Palier annuel ${yearTier.label}` });
        if (bestBasket > 0 && stats.basket === bestBasket) badges.push({ key: "basket", label: "Meilleur panier" });
        return { id: p.id, displayName: p.display_name, sale: stats.sale, signatures: stats.signatures, basket: stats.basket, objective, progress, badges, me: p.id === user.id };
      })
      .sort((a, b) => b.sale - a.sale || a.displayName.localeCompare(b.displayName, "fr"))
      .map((row, index) => ({ ...row, rank: index + 1 }));

    // Fil des félicitations : sans nom de client ni montant de commission.
    const celebrations = [];
    for (const row of [...monthRows].reverse().slice(0, 12)) {
      celebrations.push({ kind: "signature", at: row.signed_at, text: `${row.display_name || "L'équipe"} a signé ${row.amendment_no ? "un avenant" : "un devis"} de ${Number(row.totals?.sale || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })} HT`, me: row.commercial_id === user.id });
    }
    for (const person of ranking) if (person.badges.some((b) => b.key === "objective")) celebrations.unshift({ kind: "objective", text: `${person.displayName} a atteint son objectif du mois`, me: person.me });
    if (breakevenReached) celebrations.unshift({ kind: "breakeven", text: "Point mort atteint ce mois-ci : chaque signature dégage maintenant du bénéfice." });

    const mine = ranking.find((row) => row.id === user.id) || null;
    const myYear = yearMap.get(user.id)?.sale || 0;
    const nextTier = tiers.find((tier) => tier.periodKind === "month" && (mine?.sale || 0) < tier.threshold) || null;
    const out = {
      period,
      year,
      me: mine ? { ...mine, yearSale: round2(myYear), yearObjective: yearObjectives.get(user.id) ?? null, nextTier } : null,
      team: {
        signed: teamSigned,
        objective: teamGoal.amount,
        progress: teamGoal.amount ? round2((teamSigned / teamGoal.amount) * 100) : null,
        yearSigned: teamYearSigned,
        yearObjective: teamYearGoal.amount,
        yearProgress: teamYearGoal.amount ? round2((teamYearSigned / teamYearGoal.amount) * 100) : null,
        breakevenReached,
        breakevenConfigured: be.fixedTotal > 0,
        collected: null, // CA encaissé : avec iPaidThat (V3)
      },
      ranking,
      celebrations: celebrations.slice(0, 12),
      tiers,
    };
    if (admin) {
      out.breakeven = { ...be, marker: be.amount !== null && teamGoal.amount ? Math.min(100, round2((be.amount / teamGoal.amount) * 100)) : null, profitBeyond: breakevenReached && teamSigned > 0 ? round2(teamNet - be.fixedTotal) : null, monthNet: teamNet };
    }
    if (team) out.teamStats = await sellerStats({ start, end });
    else out.myStats = (await sellerStats({ start, end, only: user.id }))[0] || null;
    return out;
  }

  // Leads reçus, conversion, CA signé et panier moyen par commercial.
  async function sellerStats({ start, end, only = null }) {
    const leads = await db.query(
      `SELECT commercial_id, count(*)::int AS received, count(*) FILTER (WHERE stage = 'won')::int AS won, count(*) FILTER (WHERE stage = 'lost')::int AS lost
       FROM leads WHERE received_at >= $1 AND received_at < $2 AND NOT is_test ${only ? "AND commercial_id = $3" : ""} GROUP BY commercial_id`,
      only ? [start.toISOString(), end.toISOString(), only] : [start.toISOString(), end.toISOString()],
    );
    const signed = bySeller(await signedBetween(start, end));
    const people = only ? (await db.query("SELECT id, display_name FROM users WHERE id = $1", [only])) : await sellers();
    const leadMap = new Map(leads.map((row) => [row.commercial_id || "none", row]));
    const rows = people.map((p) => {
      const l = leadMap.get(p.id) || { received: 0, won: 0, lost: 0 };
      const s = signed.get(p.id) || { sale: 0, signatures: 0, basket: 0 };
      return { id: p.id, displayName: p.display_name, leadsReceived: l.received, leadsWon: l.won, leadsLost: l.lost, conversion: l.received ? round2((l.won / l.received) * 100) : null, sale: s.sale, signatures: s.signatures, basket: s.basket };
    });
    if (!only && leadMap.has("none")) {
      const l = leadMap.get("none");
      rows.push({ id: null, displayName: "Non attribués", leadsReceived: l.received, leadsWon: l.won, leadsLost: l.lost, conversion: l.received ? round2((l.won / l.received) * 100) : null, sale: signed.get("none")?.sale || 0, signatures: signed.get("none")?.signatures || 0, basket: signed.get("none")?.basket || 0 });
    }
    return rows;
  }

  // Quelle publicité ramène des chantiers signés : leads, signatures et CA par source et campagne.
  async function sourceStats(user, { period } = {}) {
    permissions.require(user, "crm.team_stats");
    period = period && (MONTH_RE.test(period) || YEAR_RE.test(period)) ? period : parisMonth(now());
    const { start, end, kind } = periodBounds(period);
    const rows = await db.query(
      `SELECT l.source, COALESCE(l.campaign, '') AS campaign, count(*)::int AS leads,
         count(*) FILTER (WHERE l.stage = 'won')::int AS won,
         COALESCE(sum((SELECT sum((q.totals->>'sale')::numeric) FROM quotes q WHERE q.dossier_id = l.dossier_id AND q.status = 'signed')), 0) AS sale
       FROM leads l WHERE l.received_at >= $1 AND l.received_at < $2 AND NOT l.is_test AND l.duplicate_of IS NULL
       GROUP BY l.source, COALESCE(l.campaign, '') ORDER BY l.source, leads DESC`,
      [start.toISOString(), end.toISOString()],
    );
    const { SOURCES } = require("./crm");
    const be = isAdmin(user) ? await breakeven() : null;
    const months = kind === "year" ? 12 : 1;
    const sources = {};
    for (const row of rows) {
      const entry = (sources[row.source] ||= { source: row.source, label: SOURCES[row.source] || row.source, leads: 0, won: 0, sale: 0, campaigns: [] });
      entry.leads += row.leads;
      entry.won += row.won;
      entry.sale = round2(entry.sale + Number(row.sale));
      entry.campaigns.push({ campaign: row.campaign || "Sans campagne", leads: row.leads, won: row.won, sale: round2(Number(row.sale)), conversion: row.leads ? round2((row.won / row.leads) * 100) : null });
    }
    return {
      period,
      sources: Object.values(sources).map((entry) => {
        const spend = be && be.adSpend[entry.source] !== undefined ? round2(be.adSpend[entry.source] * months) : null;
        return { ...entry, conversion: entry.leads ? round2((entry.won / entry.leads) * 100) : null, spend, costPerLead: spend && entry.leads ? round2(spend / entry.leads) : null, costPerWin: spend && entry.won ? round2(spend / entry.won) : null };
      }),
    };
  }

  // ---------- Commissions ----------
  // Chaque commercial ne voit que la sienne ; l'administrateur voit celles de tous.

  async function commissions(user, { year } = {}) {
    if (!permissions.can(user, "commissions.all") && !permissions.can(user, "goals.view")) throw httpError(403, "Action non autorisée pour votre rôle.");
    year = YEAR_RE.test(String(year || "")) ? String(year) : parisMonth(now()).slice(0, 4);
    const { start, end } = periodBounds(year);
    const all = permissions.can(user, "commissions.all");
    const rows = await db.query(
      `SELECT q.id, q.number, q.amendment_no, q.version, q.totals, q.schedule, q.signed_at, q.commission_rate, q.commercial_id, u.display_name, d.client_name, d.id AS dossier_id
       FROM quotes q JOIN dossiers d ON d.id = q.dossier_id LEFT JOIN users u ON u.id = q.commercial_id
       WHERE q.status = 'signed' AND q.signed_at >= $1 AND q.signed_at < $2 ${all ? "" : "AND q.commercial_id = $3"}
       ORDER BY q.signed_at DESC`,
      all ? [start.toISOString(), end.toISOString()] : [start.toISOString(), end.toISOString(), user.id],
    );
    const items = rows.map((row) => {
      const sale = Number(row.totals?.sale || 0);
      const rate = Number(row.commission_rate ?? row.totals?.commissionRate ?? 0);
      const amount = round2(row.totals?.commission ?? (sale * rate) / 100);
      return {
        quoteId: row.id,
        dossierId: row.dossier_id,
        number: row.amendment_no ? `Avenant ${row.amendment_no} · ${row.number}` : row.number,
        version: row.version,
        clientName: row.client_name,
        commercialId: row.commercial_id,
        commercialName: row.display_name || "Sans commercial",
        signedAt: row.signed_at,
        month: parisMonth(new Date(row.signed_at)),
        sale: round2(sale),
        rate,
        amount,
        // Versement au rythme des encaissements client (suivi des paiements : iPaidThat, V3).
        schedule: (Array.isArray(row.schedule) ? row.schedule : []).map((step) => ({ label: step.label, percent: Number(step.percent), amount: round2((amount * Number(step.percent || 0)) / 100) })),
      };
    });
    const total = round2(items.reduce((sum, item) => sum + item.amount, 0));
    const byMonth = {};
    for (const item of items) byMonth[item.month] = round2((byMonth[item.month] || 0) + item.amount);
    const out = { year, all, total, sale: round2(items.reduce((sum, item) => sum + item.sale, 0)), byMonth, items, paid: null };
    if (all) {
      const per = {};
      for (const item of items) {
        const key = item.commercialId || "none";
        per[key] ||= { id: item.commercialId, displayName: item.commercialName, sale: 0, amount: 0, count: 0 };
        per[key].sale = round2(per[key].sale + item.sale);
        per[key].amount = round2(per[key].amount + item.amount);
        per[key].count += 1;
      }
      out.bySeller = Object.values(per).sort((a, b) => b.amount - a.amount);
    }
    return out;
  }

  return { COST_CATEGORIES, breakeven, listFixedCosts, saveFixedCost, removeFixedCost, goalSettings, saveProfitTarget, listObjectives, setObjectives, splitEqually, listTiers, saveTier, removeTier, dashboard, sourceStats, commissions, periodBounds, parisMonth };
}

module.exports = { createGoals, COST_CATEGORIES, periodBounds, parisMonth };
