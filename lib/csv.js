"use strict";

// Lecture / écriture CSV tolérante (exports Excel français : « ; », BOM, guillemets, CRLF).

function parseCsv(text) {
  const source = String(text || "").replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const counts = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;
  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char] += 1;
  }
  const separator = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ";";

  const rows = [];
  let row = [];
  let field = "";
  inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') inQuotes = false;
      else field += char;
    } else if (char === '"') inQuotes = true;
    else if (char === separator) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { separator, rows: rows.filter((cells) => cells.some((cell) => cell.trim() !== "")) };
}

const normalizeHeader = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function toCsv(rows, separator = ";") {
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[";\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return "﻿" + rows.map((cells) => cells.map(escape).join(separator)).join("\r\n") + "\r\n";
}

// Nombre au format français (« 1 234,50 », « 45 % », « 28 € »).
function parseFrenchNumber(value) {
  const text = String(value ?? "").replace(/[\s  €%]/g, "").replace(",", ".");
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

module.exports = { parseCsv, toCsv, normalizeHeader, parseFrenchNumber };
