"use strict";

// Calcul de rentabilité des devis (cahier des charges, module 3). Fichier partagé :
// chargé par le serveur (require) et par le navigateur (/pricing.js → window.NovaPricing),
// pour que l'écran et le PDF affichent exactement les mêmes montants.
//
//   Vente prestation = Coût ST ÷ (1 − taux de marge)
//   Vente fourniture = Prix public, ou Coût pro ÷ (1 − taux de marge)
//   Marge brute      = Vente HT − Coût ST − Coût fourniture pro
//   Marge nette      = Marge brute − Commission commercial
//
// Le taux de marge se calcule sur le prix de vente (45 % = 45 € gardés sur 100 € HT).

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NovaPricing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const num = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const MODES = ["both", "labor", "supply"];
  const ST_SCOPES = ["none", "labor", "supply", "both"];

  // Prix de vente unitaire à partir d'un coût et d'un taux de marge sur le prix de vente.
  function saleFromMargin(cost, marginRate) {
    const rate = num(marginRate) ?? 0;
    if (rate >= 100) return null;
    return round2((num(cost) ?? 0) / (1 - rate / 100));
  }

  function includesLabor(line) {
    return (line.mode || "both") !== "supply";
  }
  function includesSupply(line) {
    return (line.mode || "both") !== "labor";
  }

  function computeLine(line) {
    const quantity = num(line.quantity) ?? 0;
    const withLabor = includesLabor(line);
    const withSupply = includesSupply(line);

    const laborCost = num(line.laborCost) ?? 0;
    const laborComputed = saleFromMargin(laborCost, line.laborMargin) ?? 0;
    const laborOverride = num(line.laborPriceOverride);
    const laborUnit = withLabor ? (laborOverride ?? laborComputed) : 0;

    const supplyCost = num(line.supplyProCost) ?? 0;
    const publicPrice = num(line.supplyPublicPrice);
    const usePublic = line.supplyPricing === "public" || (line.supplyPricing !== "margin" && publicPrice !== null && publicPrice > 0);
    const supplyComputed = usePublic ? (publicPrice ?? 0) : (saleFromMargin(supplyCost, line.supplyMargin) ?? 0);
    const supplyOverride = num(line.supplyPriceOverride);
    const supplyUnit = withSupply ? (supplyOverride ?? supplyComputed) : 0;

    const laborSale = round2(laborUnit * quantity);
    const supplySale = round2(supplyUnit * quantity);
    const laborCostTotal = withLabor ? round2(laborCost * quantity) : 0;
    const supplyCostTotal = withSupply ? round2(supplyCost * quantity) : 0;
    const sale = round2(laborSale + supplySale);
    const cost = round2(laborCostTotal + supplyCostTotal);
    const margin = round2(sale - cost);
    const vatRate = num(line.vatRate) ?? 20;
    const vat = round2((sale * vatRate) / 100);

    // Exceptions « hors grille » : coût ST différent de la grille signée, ou prix de vente forcé.
    const exceptions = [];
    const gridCost = num(line.gridLaborCost);
    if (withLabor && gridCost !== null && round2(laborCost) !== round2(gridCost)) {
      exceptions.push(exception("cost", "Coût ST hors grille", gridCost, laborCost, quantity));
    }
    if (withLabor && laborOverride !== null && round2(laborOverride) !== laborComputed) {
      exceptions.push(exception("labor_price", "Prix de vente prestation modifié", laborComputed, laborOverride, quantity));
    }
    if (withSupply && supplyOverride !== null && round2(supplyOverride) !== supplyComputed) {
      exceptions.push(exception("supply_price", "Prix de vente fourniture modifié", supplyComputed, supplyOverride, quantity));
    }

    return {
      quantity,
      laborUnit,
      supplyUnit,
      unitPrice: round2(laborUnit + supplyUnit),
      laborSale,
      supplySale,
      laborCost: laborCostTotal,
      supplyCost: supplyCostTotal,
      sale,
      cost,
      margin,
      marginRate: sale ? round2((margin / sale) * 100) : 0,
      laborMarginRate: laborSale ? round2(((laborSale - laborCostTotal) / laborSale) * 100) : 0,
      supplyMarginRate: supplySale ? round2(((supplySale - supplyCostTotal) / supplySale) * 100) : 0,
      vatRate,
      vat,
      exceptions,
    };
  }

  function exception(kind, label, reference, actual, quantity) {
    const diff = round2(actual - reference);
    return { kind, label, reference: round2(reference), actual: round2(actual), diff, diffTotal: round2(diff * Math.abs(quantity)), diffRate: reference ? round2((diff / reference) * 100) : null };
  }

  // Totaux d'un devis : par lot, par taux de TVA, commission, marges brute et nette, alertes.
  function computeQuote(quote, options = {}) {
    const lines = Array.isArray(quote.lines) ? quote.lines : [];
    const today = options.today || new Date().toISOString().slice(0, 10);
    const minimumNet = num(options.minimumNetMargin);
    const computed = lines.map((line) => ({ line, result: computeLine(line) }));

    const lots = new Map();
    const vatByRate = new Map();
    let sale = 0;
    let cost = 0;
    let laborSale = 0;
    let supplySale = 0;
    let laborCost = 0;
    let supplyCost = 0;
    for (const { line, result } of computed) {
      const lotName = String(line.lotName || "Divers");
      const lot = lots.get(lotName) || { name: lotName, sale: 0, cost: 0, margin: 0, lines: 0 };
      lot.sale = round2(lot.sale + result.sale);
      lot.cost = round2(lot.cost + result.cost);
      lot.margin = round2(lot.sale - lot.cost);
      lot.lines += 1;
      lots.set(lotName, lot);
      const vat = vatByRate.get(result.vatRate) || { rate: result.vatRate, base: 0, vat: 0 };
      vat.base = round2(vat.base + result.sale);
      vatByRate.set(result.vatRate, vat);
      sale += result.sale;
      cost += result.cost;
      laborSale += result.laborSale;
      supplySale += result.supplySale;
      laborCost += result.laborCost;
      supplyCost += result.supplyCost;
    }
    // TVA calculée par taux sur la base cumulée (arrondi unique par taux, comme sur la facture).
    const vatLines = [...vatByRate.values()].sort((a, b) => b.rate - a.rate).map((entry) => ({ ...entry, vat: round2((entry.base * entry.rate) / 100) }));
    sale = round2(sale);
    cost = round2(cost);
    const vat = round2(vatLines.reduce((sum, entry) => sum + entry.vat, 0));
    const margin = round2(sale - cost);
    const commissionRate = num(quote.commissionRate) ?? 0;
    const commission = round2((Math.max(sale, 0) * commissionRate) / 100);
    const net = round2(margin - commission);
    const lotList = [...lots.values()].map((lot) => ({ ...lot, marginRate: lot.sale ? round2((lot.margin / lot.sale) * 100) : 0 }));

    const alerts = [];
    computed.forEach(({ line, result }, index) => {
      const label = line.label || `Ligne ${index + 1}`;
      // Main-d'œuvre interne (stScope « none ») : pas de grille ST attendue.
      if (includesLabor(line) && line.stScope !== "none" && num(line.gridLaborCost) === null && !line.forced) {
        alerts.push({ level: "blocking", code: "no_st_price", lineIndex: index, message: `« ${label} » : aucun prix ST validé (grille signée).` });
      }
      if (line.gridEndsOn && line.gridEndsOn < today && !options.frozen) {
        alerts.push({ level: "warning", code: "grid_expired", lineIndex: index, message: `« ${label} » : la grille du sous-traitant a expiré le ${line.gridEndsOn}.` });
      }
      if (result.exceptions.length && !String(line.exceptionReason || "").trim()) {
        alerts.push({ level: "blocking", code: "reason_missing", lineIndex: index, message: `« ${label} » : prix hors grille, motif à indiquer.` });
      }
      if (line.subcontractorBlocked) {
        alerts.push({ level: "warning", code: "st_documents", lineIndex: index, message: `« ${label} » : un document obligatoire du sous-traitant est expiré (bon de commande bloqué).` });
      }
    });
    const netRate = sale > 0 ? round2((net / sale) * 100) : 0;
    if (minimumNet !== null && sale > 0 && netRate < minimumNet) {
      alerts.push({ level: "warning", code: "net_margin", message: `Marge nette après commission ${String(netRate).replace(".", ",")} % : sous le minimum de ${String(minimumNet).replace(".", ",")} %.` });
    }

    return {
      lines: computed.map(({ result }) => result),
      lots: lotList,
      vatLines,
      sale,
      vat,
      total: round2(sale + vat),
      cost,
      laborSale: round2(laborSale),
      supplySale: round2(supplySale),
      laborCost: round2(laborCost),
      supplyCost: round2(supplyCost),
      margin,
      marginRate: sale ? round2((margin / sale) * 100) : 0,
      commissionRate,
      commission,
      net,
      netRate,
      alerts,
      blocking: alerts.filter((alert) => alert.level === "blocking"),
      exceptions: computed.flatMap(({ line, result }, index) => result.exceptions.map((item) => ({ ...item, lineIndex: index, label: line.label, reason: line.exceptionReason || "" }))),
    };
  }

  // Applique un taux de marge à un ensemble de lignes (ligne, lot ou devis entier).
  function applyMargin(lines, { labor, supply }) {
    return lines.map((line) => ({
      ...line,
      ...(labor !== undefined && labor !== null && labor !== "" ? { laborMargin: num(labor), laborPriceOverride: null } : {}),
      ...(supply !== undefined && supply !== null && supply !== "" ? { supplyMargin: num(supply), supplyPricing: "margin", supplyPriceOverride: null } : {}),
    }));
  }

  // Répartit un montant selon un échéancier ; le dernier pas absorbe l'arrondi.
  function splitSchedule(amount, schedule) {
    let remaining = round2(amount);
    return schedule.map((step, index) => {
      const value = index === schedule.length - 1 ? remaining : round2((amount * Number(step.percent)) / 100);
      remaining = round2(remaining - value);
      return { label: step.label, percent: Number(step.percent), amount: value };
    });
  }

  return { round2, num, MODES, ST_SCOPES, saleFromMargin, computeLine, computeQuote, applyMargin, splitSchedule, includesLabor, includesSupply };
});
