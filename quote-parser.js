(function initNovaQuoteParser(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NovaQuoteParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createNovaQuoteParser() {
  const DISCOUNT_PATTERN = /\b(remise|rabais|ristourne|escompte|geste commercial|avoir)\b/i;
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
    return DISCOUNT_PATTERN.test(normalizeForQuoteMatch(text));
  }

  function isNonBillableLine(text) {
    return NON_BILLABLE_PATTERN.test(normalizeForQuoteMatch(text));
  }

  function parseAmountToken(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const negative = /^[\s(]*[−–-]/.test(raw) || /[−–-][\s)]*$/.test(raw) || /^\s*\(.+\)\s*$/.test(raw);
    const normalized = raw
      .replace(/[()−–-]/g, "")
      .replace(/[\s\u00a0]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
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

  return {
    applyDiscountSign,
    extractLastAmount,
    isDiscountLine,
    isNonBillableLine,
    parseAmountToken,
  };
});
