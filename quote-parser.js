(function initNovaQuoteParser(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NovaQuoteParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createNovaQuoteParser() {
  const DISCOUNT_PATTERN = /\b(remise|rabais|ristourne|escompte|geste commercial|avoir|moins[ -]value)\b/i;
  const NON_BILLABLE_PATTERN = /\b(coordonn(?:e|é)es?(?:\s+du)?\s+(?:chantier|client)|adresse(?:\s+du|\s+de la|\s+des)?\s+(?:chantier|travaux|client)|code\s+postal|t(?:e|é)l(?:e|é)phone|portable|courriel|e-?mail|contact\s+client|ma(?:i|î)tre\s+d['’]?ouvrage|lieu(?:\s+du)?\s+chantier)\b/i;
  const DECIMAL_AMOUNT_PATTERN = /(?:^|\s)(\(?\s*[−–-]?\s*(?:\d{1,3}(?:[ .\u00a0]\d{3})+|\d+)[,.]\d{2}\s*\)?\s*[−–-]?)\s*(?:€|eur|ht|ttc)?(?=\s|$)/gi;
  const CURRENCY_AMOUNT_PATTERN = /(?:^|\s)(\(?\s*[−–-]?\s*(?:\d{1,3}(?:[ .\u00a0]\d{3})+|\d+)\s*\)?\s*[−–-]?)\s*(?:€|eur|ht|ttc)(?=\s|$)/gi;

  function normalizeForQuoteMatch(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isDiscountLine(text) {
    const normalized = normalizeForQuoteMatch(text);
    if (/remise\s+(?:en\s+(?:etat|service|eau|route|peinture|conformite)|a\s+niveau)/.test(normalized)) return false;
    return DISCOUNT_PATTERN.test(normalized);
  }

  function isNonBillableLine(text) {
    return NON_BILLABLE_PATTERN.test(normalizeForQuoteMatch(text));
  }

  function parseAmountToken(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const negative = /^[\s(]*[−–-]/.test(raw) || /[−–-][\s)]*$/.test(raw) || /^\s*\(.+\)\s*$/.test(raw);
    let normalized = raw.replace(/[()−–-]/g, "").replace(/[\s\u00a0\u202f]/g, "");
    if (normalized.includes(",")) normalized = normalized.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) normalized = normalized.replace(/\./g, "");
    const number = Number(normalized);
    if (!Number.isFinite(number)) return null;
    return negative ? -Math.abs(number) : number;
  }

  function applyDiscountSign(text, amount) {
    if (!Number.isFinite(amount)) return null;
    return isDiscountLine(text) ? -Math.abs(amount) : amount;
  }

  function extractLastAmount(text) {
    const source = String(text || "");
    const matches = [];
    for (const pattern of [DECIMAL_AMOUNT_PATTERN, CURRENCY_AMOUNT_PATTERN]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const value = parseAmountToken(match[1]);
        if (Number.isFinite(value)) matches.push({ index: match.index, value });
      }
    }
    if (!matches.length) return null;
    matches.sort((a, b) => a.index - b.index);
    return applyDiscountSign(source, matches[matches.length - 1].value);
  }


  function detectQuoteTotal(rows) {
    let gross = null;
    let net = null;
    for (const row of rows) {
      const text = normalizeForQuoteMatch(row.text);
      const match = text.match(/(?:^|\s)((?:total\s+(?:(?:general|net)\s+)?|net\s+(?:a payer\s+)?|montant\s+total\s+)h\.?\s*t\.?)\s*:?\s*(.*)/);
      if (!match) continue;
      const amount = extractLastAmount(match[2]);
      if (!Number.isFinite(amount)) continue;
      if (/net/.test(match[1])) net = amount;
      else gross = amount;
    }
    return net ?? gross;
  }

  // Keep each physical detail row. Identical services may legitimately occur twice.
  // Section totals are never substituted for incomplete detail extraction.
  function extractQuoteRows(rows, classify = () => "À classer") {
    const result = [];
    let section = "";
    let amountColumn = null;
    let currentPage = null;
    let inSummary = false;
    const codes = rows.map((row) => String(row.text || "").match(/^(\d+(?:\.\d+)*)\s+/)?.[1]).filter(Boolean);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const text = String(row.text || "").replace(/\s+/g, " ").trim();
      const normalized = normalizeForQuoteMatch(text);
      if (row.page !== currentPage) { amountColumn = null; currentPage = row.page; }
      const header = (row.parts || []).find((part) => /^(?:montant|total)(?:\s+h\.?t\.?)?$/.test(normalizeForQuoteMatch(part.text)));
      if (header && /designation|description|libelle|quantite|qte|prix/.test(normalized)) {
        amountColumn = header.x;
        continue;
      }
      if (!text || isNonBillableLine(text)) continue;
      if (/(?:^|\s)(?:total\s+(?:net\s+)?(?:h\.?\s*t\.?|t\.?\s*t\.?\s*c\.?)|net\s+(?:a payer\s+)?h\.?t\.?)\s*:?\s*[−–-]?\s*\d/.test(normalized) || /^conditions\s+generales/.test(normalized)) inSummary = true;
      if (inSummary && !isDiscountLine(text)) continue;
      if (/\b(?:dont\s+main\s+d['’]oeuvre|indemnite|penalite|capital\s+(?:social\s+)?de|dimensions?|localisation)\b/.test(normalized)) continue;
      if (/^\d+(?:[.,]\d+)?\s*%/.test(normalized)) continue;
      // A numbered parent with child rows is a group header, even if it carries a subtotal.
      const numbered = text.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
      if (numbered && codes.some((code) => code.startsWith(numbered[1] + "."))) {
        section = numbered[2].replace(/\s+[−–-]?\s*(?:\d{1,3}(?:[ .]\d{3})+|\d+)[,.]\d{2}\s*$/, "").trim();
        continue;
      }
      if (/^(?:sous[- ]?total|total\b|net\s+a\s+payer|tva\b|acompte\b|solde\b|reste\s+a\s+payer|report\b|a\s+reporter|dont\b)/.test(normalized)) continue;
      if (/\b(?:iban|bic|siret|siren|intracommunautaire|conditions generales|signature|validite|telephone|courriel)\b/.test(normalized)) continue;
      if (/^(?:devis\b|page\b|date\b|client\b|reference\s+client|designation\b)/.test(normalized)) continue;
      let amount = null;
      let label = text;
      // Common quote: number, description, quantity, unit, unit price, total, optional VAT.
      const detailText = text.replace(/^(\d+(?:\.\d+)*)\s+(?=(?:[−–-]?\d+(?:[,.]\d+)?\s+(?:m2|m²|m3|m³|u|ens|h)\s)|(?:(?:m2|m²|m3|m³|u|ens|h)\s+\d))/i, "$1 Description à compléter ");
      const detail = detailText.match(/^(?:(\d+(?:\.\d+)*[.)]?)\s+)?(.+?)\s+([−–-]?\d+(?:[,.]\d+)?)\s+(ens|u|un|unite|étage|etage|m2|m²|m3|m³|ml|m|forfait|forf|fft|h|kg|jour|offert)\s+([−–-]?\s*(?:\d{1,3}(?:[ .]\d{3})+|\d+)[,.]\d{2})\s+([−–-]?\s*(?:\d{1,3}(?:[ .]\d{3})+|\d+)[,.]\d{2})(?:\s+\d+(?:[,.]\d+)?\s*%?)?$/i)
        || detailText.match(/^(?:(\d+(?:\.\d+)*[.)]?)\s+)?(.+?)\s+(ens|u|un|unite|étage|etage|m2|m²|m3|m³|ml|m|forfait|forf|fft|h|kg|jour|offert)\s+([−–-]?\d+(?:[,.]\d+)?)\s+([−–-]?\s*(?:\d{1,3}(?:[ .]\d{3})+|\d+)[,.]\d{2})\s+([−–-]?\s*(?:\d{1,3}(?:[ .]\d{3})+|\d+)[,.]\d{2})(?:\s+\d+(?:[,.]\d+)?\s*%?)?$/i);
      if (detail) {
        amount = applyDiscountSign(text, parseAmountToken(detail[6]));
        label = [detail[1], detail[2]].filter(Boolean).join(" - ");
      } else if (amountColumn !== null && row.parts?.length) {
        const cells = row.parts.filter((part) => part.x >= amountColumn - 18 && part.x < amountColumn + 80);
        amount = extractLastAmount(cells.map((part) => part.text).join(" "));
        if (amount !== null) {
          amount = applyDiscountSign(text, amount);
          label = row.parts.filter((part) => part.x < amountColumn - 18).map((part) => part.text).join(" ");
        }
      }
      if (amount === null) {
        // A trailing percentage is tax/discount metadata, never a money amount.
        const withoutPercent = text.replace(/\s+\d+(?:[,.]\d+)?\s*%\s*$/, "");
        const endsWithMoney = /(?:\d[,.]\d{2}\s*\)?[−–-]?\s*(?:€|eur|ht|ttc)?|\d\s*(?:€|eur|ht|ttc))\s*$/i.test(withoutPercent);
        amount = endsWithMoney ? extractLastAmount(withoutPercent) : null;
        if (amount !== null) label = withoutPercent.replace(/\s+[−–-]?\s*(?:\d{1,3}(?:[ .]\d{3})+|\d+)[,.]\d{2}(?:\s*(?:€|EUR|HT|TTC))?\s*$/i, "");
      }
      if (amount === null) {
        const heading = text.match(/^\d{1,2}[.)]?\s+([A-Za-zÀ-ÿ].{2,85})$/);
        if (heading && !/\d/.test(heading[1])) section = heading[1].trim();
        continue;
      }
      if (!/[A-Za-zÀ-ÿ]{3}/.test(label)) continue;
      if (!detail && !numbered && !isDiscountLine(text) && (/[+=]/.test(label) || /^(?:prix|base de prix|localisation|dimensions?)\b/i.test(label))) continue;
      const adjustment = isDiscountLine(text);
      const lot = adjustment ? (/moins[ -]value/i.test(normalized) ? "Moins-value" : "Remise commerciale") : section || classify(label);
      result.push({ label, lot, amount, page: row.page, raw: text, sourceRow: index,
        section, code: detail?.[1] || "", level: "detail", confidence: /Description à compléter/.test(label) ? 20 : detail ? 92 : 58 });
    }
    return result;
  }

  return {
    detectQuoteTotal,
    extractQuoteRows,
    applyDiscountSign,
    extractLastAmount,
    isDiscountLine,
    isNonBillableLine,
    parseAmountToken,
  };
});
