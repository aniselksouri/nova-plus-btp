"use strict";

// Profil de l'entreprise qui utilise Nova+ : identité, mentions légales BTP et réglages par défaut.
// Nova+ est commercialisé à plusieurs entreprises du BTP : rien de propre à un client n'est écrit dans le code.

const { httpError } = require("./security");

const DEFAULT_COMPANY = Object.freeze({
  name: "",
  legalForm: "",
  siret: "",
  vatNumber: "",
  address: { line: "", postalCode: "", city: "" },
  phone: "",
  email: "",
  website: "",
  logoKey: null,
  // Assurance décennale : obligatoire sur les devis et factures des travaux de construction.
  insurance: { insurer: "", policyNumber: "", coverage: "" },
  rge: { certified: false, number: "", body: "", validUntil: "" },
  billing: {
    // Échéancier le plus courant dans le BTP ; modifiable par entreprise puis par devis.
    invoiceSchedule: [
      { label: "Acompte", percent: 30 },
      { label: "Situation 1", percent: 30 },
      { label: "Situation 2", percent: 30 },
      { label: "Solde réception", percent: 10 },
    ],
    vatRates: [20, 10, 5.5],
    defaultVatRate: 20,
    paymentTermsDays: 30,
  },
  // Taux de marge sur le prix de vente (cahier des charges : 45 % prestation, 25 à 30 % fourniture).
  margins: { labor: 45, supply: 25, minimumNet: 15 },
  // Textes des documents : modèles proposés, à faire valider par le conseil juridique de l'entreprise.
  documents: {
    quoteTerms: "",
    reducedVatMention:
      "TVA à taux réduit : le client certifie, en signant ce devis, que les travaux portent sur un local à usage d'habitation achevé depuis plus de deux ans et qu'ils ne concourent pas à la production d'un immeuble neuf (articles 278-0 bis A et 279-0 bis du CGI). En cas d'inexactitude, le client est solidairement tenu au paiement du complément de TVA.",
    gridTerms:
      "Les prix ci-dessus sont fermes et non révisables pendant toute la période indiquée. Aucune facturation supérieure à ces prix ne sera acceptée sans avenant écrit signé par les deux parties. Factures établies hors taxes, en autoliquidation de la TVA (article 283-2 nonies du CGI). Aucune retenue de garantie n'est pratiquée.",
    orderTerms:
      "Le sous-traitant exécute les ouvrages ci-dessus aux prix fermes de sa grille signée. Factures établies hors taxes avec la mention « Autoliquidation » (article 283-2 nonies du CGI) : la TVA est déclarée par l'entreprise principale. Aucune retenue de garantie n'est pratiquée. Tout travail supplémentaire exige un bon de commande ou un avenant écrit.",
  },
});

const text = (value, max = 160) => String(value ?? "").trim().slice(0, max);

function number(value, { min, max, label }) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw httpError(400, `${label} : valeur entre ${min} et ${max} attendue.`);
  return Math.round(parsed * 100) / 100;
}

function normalizeCompany(input = {}, current = DEFAULT_COMPANY) {
  const base = merge(DEFAULT_COMPANY, current);
  const next = merge(base, input);

  const siret = text(next.siret, 20).replace(/\s/g, "");
  if (siret && !/^\d{14}$/.test(siret)) throw httpError(400, "Le SIRET contient 14 chiffres.");
  const email = text(next.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Adresse e-mail de l'entreprise invalide.");
  const validUntil = text(next.rge?.validUntil, 10);
  if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) throw httpError(400, "Date de validité RGE invalide.");

  const schedule = Array.isArray(next.billing?.invoiceSchedule) ? next.billing.invoiceSchedule : base.billing.invoiceSchedule;
  if (!schedule.length || schedule.length > 12) throw httpError(400, "L'échéancier contient entre 1 et 12 échéances.");
  const invoiceSchedule = schedule.map((step, index) => ({
    label: text(step?.label, 60) || `Échéance ${index + 1}`,
    percent: number(step?.percent, { min: 0, max: 100, label: `Échéance ${index + 1}` }),
  }));
  const total = Math.round(invoiceSchedule.reduce((sum, step) => sum + step.percent, 0) * 100) / 100;
  if (total !== 100) throw httpError(400, `L'échéancier doit totaliser 100 % (actuellement ${String(total).replace(".", ",")} %).`);

  const rates = (Array.isArray(next.billing?.vatRates) ? next.billing.vatRates : base.billing.vatRates).map((rate) => number(rate, { min: 0, max: 30, label: "Taux de TVA" }));
  const vatRates = [...new Set(rates)].sort((a, b) => b - a);
  if (!vatRates.length) throw httpError(400, "Indiquez au moins un taux de TVA.");
  const defaultVatRate = number(next.billing?.defaultVatRate, { min: 0, max: 30, label: "TVA par défaut" });
  if (!vatRates.includes(defaultVatRate)) throw httpError(400, "La TVA par défaut doit faire partie des taux proposés.");

  return {
    name: text(next.name, 120),
    legalForm: text(next.legalForm, 40),
    siret,
    vatNumber: text(next.vatNumber, 20).replace(/\s/g, "").toUpperCase(),
    address: { line: text(next.address?.line, 200), postalCode: text(next.address?.postalCode, 10), city: text(next.address?.city, 80) },
    phone: text(next.phone, 30),
    email,
    website: text(next.website, 160),
    logoKey: next.logoKey ? text(next.logoKey, 200) : null,
    insurance: { insurer: text(next.insurance?.insurer, 120), policyNumber: text(next.insurance?.policyNumber, 60), coverage: text(next.insurance?.coverage, 300) },
    rge: {
      certified: Boolean(next.rge?.certified),
      number: text(next.rge?.number, 60),
      body: text(next.rge?.body, 80),
      validUntil,
    },
    billing: {
      invoiceSchedule,
      vatRates,
      defaultVatRate,
      paymentTermsDays: Math.round(number(next.billing?.paymentTermsDays, { min: 0, max: 120, label: "Délai de paiement" })),
    },
    margins: {
      labor: number(next.margins?.labor, { min: 0, max: 95, label: "Marge main-d'œuvre" }),
      supply: number(next.margins?.supply, { min: 0, max: 95, label: "Marge fourniture" }),
      minimumNet: number(next.margins?.minimumNet, { min: 0, max: 95, label: "Marge nette minimum" }),
    },
    documents: {
      quoteTerms: text(next.documents?.quoteTerms, 6000),
      reducedVatMention: text(next.documents?.reducedVatMention, 2000),
      gridTerms: text(next.documents?.gridTerms, 4000),
      orderTerms: text(next.documents?.orderTerms, 4000),
    },
  };
}

// Ce qui manque pour éditer des devis et factures conformes.
function missingFields(company) {
  const missing = [];
  if (!company.name) missing.push("Raison sociale");
  if (!company.siret) missing.push("SIRET");
  if (!company.address.line || !company.address.postalCode || !company.address.city) missing.push("Adresse");
  if (!company.insurance.insurer || !company.insurance.policyNumber) missing.push("Assurance décennale (assureur et n° de contrat)");
  if (!company.insurance.coverage) missing.push("Couverture géographique de la décennale");
  if (company.rge.certified && !company.rge.number) missing.push("Numéro RGE");
  return missing;
}

function merge(base, patch) {
  if (Array.isArray(patch)) return patch;
  if (!patch || typeof patch !== "object") return patch === undefined ? base : patch;
  const out = Array.isArray(base) ? [] : { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) ? merge(base?.[key], value) : value;
  }
  return out;
}

function createCompanyStore(db, { auth }) {
  async function get() {
    const [row] = await db.query("SELECT data FROM company_settings WHERE id = 1");
    return normalizeCompany(row?.data || {}, DEFAULT_COMPANY);
  }

  async function save(input, { user, ip, action = "company.update" } = {}) {
    const current = await get();
    const next = normalizeCompany(input, current);
    await db.query(
      `INSERT INTO company_settings (id, data, updated_by) VALUES (1, $1::jsonb, $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(next), user?.id || null],
    );
    const changed = Object.keys(next).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]));
    await auth.audit({ user, action, entity: "company", entityId: "1", details: { changed }, ip });
    return next;
  }

  async function bootstrapName(name) {
    if (!name) return;
    const [row] = await db.query("SELECT 1 FROM company_settings WHERE id = 1");
    if (!row) await save({ name }, { action: "company.bootstrap" });
  }

  return { get, save, bootstrapName };
}

module.exports = { DEFAULT_COMPANY, normalizeCompany, missingFields, createCompanyStore };
