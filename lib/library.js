"use strict";

// Bibliothèque d'ouvrages (module 1) : lots et ouvrages, chacun séparant la prestation
// (main-d'œuvre, coût ST de référence) et la fourniture (fournisseur, prix public, prix pro).

const { httpError } = require("./security");
const { parseCsv, toCsv, normalizeHeader, parseFrenchNumber } = require("./csv");
const permissions = require("./permissions");

const UNIT_ALIASES = { m2: "m²", "m²": "m²", m3: "m³", "m³": "m³", ml: "ml", u: "u", unite: "u", forfait: "forfait", forf: "forfait", ff: "forfait", ens: "ens.", "ens.": "ens.", h: "h", heure: "h", j: "jour", jour: "jour", kg: "kg", t: "t", l: "l" };

function normalizeUnit(value) {
  const key = normalizeHeader(value).replace(/ /g, "") || "u";
  return UNIT_ALIASES[key] || UNIT_ALIASES[String(value || "").trim().toLowerCase()] || String(value || "u").trim().slice(0, 12);
}

const text = (value, max = 300) => String(value ?? "").trim().slice(0, max);

function money(value, label, { allowNull = true } = {}) {
  if (value === null || value === undefined || value === "") {
    if (allowNull) return null;
    throw httpError(400, `${label} : montant obligatoire.`);
  }
  const parsed = typeof value === "number" ? value : parseFrenchNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000_000) throw httpError(400, `${label} : montant invalide.`);
  return Math.round(parsed * 100) / 100;
}

function rate(value, label, max = 95) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : parseFrenchNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) throw httpError(400, `${label} : taux entre 0 et ${max} % attendu.`);
  return Math.round(parsed * 100) / 100;
}

function slugCode(name) {
  return (
    String(name || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "LOT"
  );
}

const lotOut = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  position: row.position,
  laborMargin: row.labor_margin,
  supplyMargin: row.supply_margin,
  archived: row.archived,
  itemsCount: row.items_count ?? undefined,
});

const itemOut = (row) => ({
  id: row.id,
  code: row.code,
  lotId: row.lot_id,
  lotName: row.lot_name,
  lotCode: row.lot_code,
  label: row.label,
  description: row.description,
  unit: row.unit,
  laborCost: row.labor_cost,
  laborMargin: row.labor_margin,
  supplier: row.supplier,
  supplierRef: row.supplier_ref,
  supplyPublicPrice: row.supply_public_price,
  supplyProPrice: row.supply_pro_price,
  supplyMargin: row.supply_margin,
  vatRate: row.vat_rate,
  archived: row.archived,
  updatedAt: row.updated_at,
});

const ITEM_SELECT = `SELECT i.*, l.name AS lot_name, l.code AS lot_code, l.position AS lot_position
  FROM library_items i JOIN library_lots l ON l.id = i.lot_id`;

// En-têtes acceptés pour l'import CSV (fichier Excel de la bibliothèque exporté en CSV).
const COLUMNS = {
  code: ["code", "code ouvrage", "ref ouvrage", "code article"],
  lotCode: ["code lot"],
  lot: ["lot", "nom du lot", "lot nom", "corps d etat"],
  label: ["libelle", "designation", "ouvrage", "intitule", "libelle ouvrage"],
  description: ["description", "description technique", "detail", "descriptif"],
  unit: ["unite", "u", "unit"],
  laborCost: ["cout st", "cout mo", "prix st", "cout prestation", "cout main d oeuvre", "mo st", "prix mo", "prestation cout st"],
  supplier: ["fournisseur"],
  supplierRef: ["reference", "ref fournisseur", "reference fournisseur", "ref"],
  supplyPublicPrice: ["prix public", "fourniture prix public", "pu public", "prix public fourniture"],
  supplyProPrice: ["prix pro", "prix pro remise", "cout fourniture", "fourniture prix pro", "prix pro fourniture"],
  laborMargin: ["marge prestation", "marge mo", "marge main d oeuvre", "taux marge prestation"],
  supplyMargin: ["marge fourniture", "taux marge fourniture"],
  vatRate: ["tva", "taux tva", "taux de tva"],
};

function createLibrary(db, { auth }) {
  async function listLots({ includeArchived = false } = {}) {
    const rows = await db.query(
      `SELECT l.*, (SELECT count(*)::int FROM library_items i WHERE i.lot_id = l.id AND NOT i.archived) AS items_count
       FROM library_lots l ${includeArchived ? "" : "WHERE NOT l.archived"} ORDER BY l.position, l.name`,
    );
    return rows.map(lotOut);
  }

  async function saveLot(input, { user, ip }) {
    permissions.require(user, "library.write");
    const name = text(input.name, 80);
    if (!name) throw httpError(400, "Nom du lot obligatoire.");
    const code = text(input.code, 24).toUpperCase() || slugCode(name);
    const canMargins = permissions.can(user, "library.margins");
    const existing = input.id ? (await db.query("SELECT * FROM library_lots WHERE id = $1", [input.id]))[0] : null;
    if (input.id && !existing) throw httpError(404, "Lot introuvable.");
    const laborMargin = canMargins ? rate(input.laborMargin, "Marge prestation du lot") : existing?.labor_margin ?? null;
    const supplyMargin = canMargins ? rate(input.supplyMargin, "Marge fourniture du lot") : existing?.supply_margin ?? null;
    const position = Number.isInteger(Number(input.position)) ? Number(input.position) : existing?.position ?? 0;
    try {
      const [row] = existing
        ? await db.query(
            `UPDATE library_lots SET code = $2, name = $3, position = $4, labor_margin = $5, supply_margin = $6, archived = $7, updated_at = now() WHERE id = $1 RETURNING *`,
            [existing.id, code, name, position, laborMargin, supplyMargin, input.archived === true],
          )
        : await db.query(
            `INSERT INTO library_lots (code, name, position, labor_margin, supply_margin) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [code, name, position, laborMargin, supplyMargin],
          );
      await auth.audit({ user, action: existing ? "library.lot_update" : "library.lot_create", entity: "library_lot", entityId: row.id, details: { code, name, laborMargin, supplyMargin }, ip });
      return lotOut(row);
    } catch (error) {
      if (/unique|duplicate/i.test(error.message)) throw httpError(409, `Le code de lot ${code} existe déjà.`);
      throw error;
    }
  }

  async function listItems({ q = "", lotId = null, includeArchived = false, limit = 500 } = {}) {
    const params = [];
    const where = [];
    if (!includeArchived) where.push("NOT i.archived");
    if (lotId) {
      params.push(lotId);
      where.push(`i.lot_id = $${params.length}`);
    }
    const terms = String(q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const term of terms) {
      params.push(`%${term.replace(/[%_]/g, "")}%`);
      where.push(`(i.code ILIKE $${params.length} OR i.label ILIKE $${params.length} OR i.description ILIKE $${params.length} OR l.name ILIKE $${params.length})`);
    }
    params.push(Math.min(Number(limit) || 500, 2000));
    const rows = await db.query(`${ITEM_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.position, l.name, i.code LIMIT $${params.length}`, params);
    return rows.map(itemOut);
  }

  async function getItem(id) {
    const [row] = await db.query(`${ITEM_SELECT} WHERE i.id = $1`, [id]);
    if (!row) throw httpError(404, "Ouvrage introuvable.");
    return itemOut(row);
  }

  function cleanItem(input, existing, canMargins) {
    const code = text(input.code ?? existing?.code, 40).toUpperCase();
    if (!code) throw httpError(400, "Code de l'ouvrage obligatoire.");
    const label = text(input.label ?? existing?.label, 200);
    if (!label) throw httpError(400, "Libellé de l'ouvrage obligatoire.");
    const pick = (key, column) => (input[key] !== undefined ? input[key] : existing?.[column]);
    const vat = input.vatRate !== undefined ? input.vatRate : existing?.vat_rate;
    const vatRate = vat === null || vat === undefined || vat === "" ? null : rate(vat, "TVA", 30);
    return {
      code,
      lotId: input.lotId ?? existing?.lot_id,
      label,
      description: text(pick("description", "description"), 2000),
      unit: normalizeUnit(pick("unit", "unit")),
      laborCost: money(pick("laborCost", "labor_cost"), "Coût ST de référence"),
      laborMargin: canMargins ? rate(pick("laborMargin", "labor_margin"), "Marge prestation") : existing?.labor_margin ?? null,
      supplier: text(pick("supplier", "supplier"), 120),
      supplierRef: text(pick("supplierRef", "supplier_ref"), 60),
      supplyPublicPrice: money(pick("supplyPublicPrice", "supply_public_price"), "Prix public fourniture"),
      supplyProPrice: money(pick("supplyProPrice", "supply_pro_price"), "Prix pro fourniture"),
      supplyMargin: canMargins ? rate(pick("supplyMargin", "supply_margin"), "Marge fourniture") : existing?.supply_margin ?? null,
      vatRate,
      archived: input.archived !== undefined ? input.archived === true : existing?.archived ?? false,
    };
  }

  async function writeItem(executor, item, existingId) {
    const values = [item.code, item.lotId, item.label, item.description, item.unit, item.laborCost, item.laborMargin, item.supplier, item.supplierRef, item.supplyPublicPrice, item.supplyProPrice, item.supplyMargin, item.vatRate, item.archived];
    if (existingId) {
      const [row] = await executor.query(
        `UPDATE library_items SET code = $1, lot_id = $2, label = $3, description = $4, unit = $5, labor_cost = $6, labor_margin = $7,
           supplier = $8, supplier_ref = $9, supply_public_price = $10, supply_pro_price = $11, supply_margin = $12, vat_rate = $13, archived = $14, updated_at = now()
         WHERE id = $15 RETURNING id`,
        [...values, existingId],
      );
      return row.id;
    }
    const [row] = await executor.query(
      `INSERT INTO library_items (code, lot_id, label, description, unit, labor_cost, labor_margin, supplier, supplier_ref, supply_public_price, supply_pro_price, supply_margin, vat_rate, archived)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      values,
    );
    return row.id;
  }

  async function saveItem(input, { user, ip }) {
    permissions.require(user, "library.write");
    const existing = input.id ? (await db.query("SELECT * FROM library_items WHERE id = $1", [input.id]))[0] : null;
    if (input.id && !existing) throw httpError(404, "Ouvrage introuvable.");
    const item = cleanItem(input, existing, permissions.can(user, "library.margins"));
    if (!item.lotId || !(await db.query("SELECT 1 FROM library_lots WHERE id = $1", [item.lotId])).length) throw httpError(400, "Choisissez le lot de l'ouvrage.");
    try {
      const id = await writeItem(db, item, existing?.id);
      await auth.audit({ user, action: existing ? "library.item_update" : "library.item_create", entity: "library_item", entityId: id, details: { code: item.code }, ip });
      return getItem(id);
    } catch (error) {
      if (/unique|duplicate/i.test(error.message)) throw httpError(409, `Le code ${item.code} existe déjà dans la bibliothèque.`);
      throw error;
    }
  }

  // Import CSV : simulation (apply = false) puis application. Mise à jour par code ouvrage.
  async function importCsv(csvText, { apply = false, user, ip }) {
    permissions.require(user, "library.write");
    const { rows } = parseCsv(csvText);
    if (rows.length < 2) throw httpError(400, "Fichier vide : une ligne d'en-têtes puis une ligne par ouvrage.");
    const headers = rows[0].map(normalizeHeader);
    const mapping = {};
    for (const [field, aliases] of Object.entries(COLUMNS)) {
      const index = headers.findIndex((header) => aliases.includes(header));
      if (index >= 0) mapping[field] = index;
    }
    const missingColumns = ["code", "label"].filter((field) => mapping[field] === undefined);
    if (mapping.lot === undefined && mapping.lotCode === undefined) missingColumns.push("lot");
    if (missingColumns.length) {
      throw httpError(400, `Colonnes introuvables : ${missingColumns.join(", ")}. En-têtes lus : ${rows[0].join(" | ")}`);
    }
    const canMargins = permissions.can(user, "library.margins");
    const lots = new Map((await db.query("SELECT * FROM library_lots")).map((lot) => [lot.code, lot]));
    const existingItems = new Map((await db.query("SELECT * FROM library_items")).map((row) => [row.code, row]));
    const report = { rows: rows.length - 1, created: 0, updated: 0, unchanged: 0, lotsCreated: [], errors: [], ignoredColumns: rows[0].filter((_, index) => !Object.values(mapping).includes(index)) };
    const planned = [];
    const seen = new Set();

    rows.slice(1).forEach((cells, offset) => {
      const lineNumber = offset + 2;
      const get = (field) => (mapping[field] === undefined ? undefined : cells[mapping[field]]);
      try {
        const lotName = text(get("lot"), 80);
        const lotCode = text(get("lotCode"), 24).toUpperCase() || slugCode(lotName);
        if (!lotName && !lots.has(lotCode)) throw new Error("lot manquant");
        const code = text(get("code"), 40).toUpperCase();
        if (seen.has(code)) throw new Error(`code ${code} en double dans le fichier`);
        seen.add(code);
        const existing = existingItems.get(code);
        const input = { code, label: get("label") };
        for (const field of ["description", "unit", "laborCost", "supplier", "supplierRef", "supplyPublicPrice", "supplyProPrice", "laborMargin", "supplyMargin", "vatRate"]) {
          const value = get(field);
          if (value !== undefined) input[field] = value;
        }
        const item = cleanItem(input, existing, canMargins);
        planned.push({ item, lotCode, lotName: lotName || lots.get(lotCode)?.name, existing });
      } catch (error) {
        report.errors.push({ line: lineNumber, message: error.message });
      }
    });

    const newLots = [...new Set(planned.filter((entry) => !lots.has(entry.lotCode)).map((entry) => entry.lotCode))];
    report.lotsCreated = newLots.map((code) => planned.find((entry) => entry.lotCode === code).lotName);
    for (const entry of planned) {
      if (!entry.existing) report.created += 1;
      else if (changed(entry.item, entry.existing, entry.lotCode, lots)) report.updated += 1;
      else report.unchanged += 1;
    }
    if (!apply || report.errors.length) return { ...report, applied: false };

    await db.tx(async (tx) => {
      let position = (await tx.query("SELECT COALESCE(max(position), 0) AS p FROM library_lots"))[0].p;
      for (const code of newLots) {
        position += 1;
        const name = planned.find((entry) => entry.lotCode === code).lotName;
        const [row] = await tx.query("INSERT INTO library_lots (code, name, position) VALUES ($1, $2, $3) RETURNING *", [code, name, position]);
        lots.set(code, row);
      }
      for (const entry of planned) {
        entry.item.lotId = lots.get(entry.lotCode).id;
        await writeItem(tx, entry.item, entry.existing?.id);
      }
    });
    await auth.audit({ user, action: "library.import", entity: "library", details: { created: report.created, updated: report.updated, lots: report.lotsCreated.length }, ip });
    return { ...report, applied: true };
  }

  function changed(item, existing, lotCode, lots) {
    const lot = lots.get(lotCode);
    if (!lot || lot.id !== existing.lot_id) return true;
    const pairs = [
      [item.label, existing.label], [item.description, existing.description], [item.unit, existing.unit], [item.laborCost, existing.labor_cost],
      [item.laborMargin, existing.labor_margin], [item.supplier, existing.supplier], [item.supplierRef, existing.supplier_ref],
      [item.supplyPublicPrice, existing.supply_public_price], [item.supplyProPrice, existing.supply_pro_price], [item.supplyMargin, existing.supply_margin], [item.vatRate, existing.vat_rate],
    ];
    return pairs.some(([a, b]) => (a ?? null) !== (b ?? null));
  }

  async function exportCsv() {
    const items = await listItems({ includeArchived: false, limit: 2000 });
    const header = ["Code", "Code lot", "Lot", "Libellé", "Description", "Unité", "Coût ST", "Fournisseur", "Référence fournisseur", "Prix public", "Prix pro", "Marge prestation", "Marge fourniture", "TVA"];
    const fr = (value) => (value === null || value === undefined ? "" : String(value).replace(".", ","));
    return toCsv([
      header,
      ...items.map((item) => [item.code, item.lotCode, item.lotName, item.label, item.description, item.unit, fr(item.laborCost), item.supplier, item.supplierRef, fr(item.supplyPublicPrice), fr(item.supplyProPrice), fr(item.laborMargin), fr(item.supplyMargin), fr(item.vatRate)]),
    ]);
  }

  return { listLots, saveLot, listItems, getItem, saveItem, importCsv, exportCsv };
}

module.exports = { createLibrary, normalizeUnit, slugCode, COLUMNS };
