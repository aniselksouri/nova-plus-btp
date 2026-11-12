"use strict";

// Documents PDF : devis / avenant (vue client, sans coût, ST ni marge), grille de prix ST,
// bon de commande ST, PV de réception, formulaire de rétractation.

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const pricing = require("./pricing");

const INK = "#14171f";
const MUTED = "#5d6472";
const LINE = "#d9dde5";
const ACCENT = "#3e36b0";
const SOFT = "#f3f4f8";
const PAGE = { size: "A4", margins: { top: 48, bottom: 56, left: 44, right: 44 } };

// Polices standard PDF (WinAnsi) : on remplace les caractères qu'elles ne savent pas afficher.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ''\"\"•–—˜™š›œžŸ‘’“”");
function clean(value) {
  return String(value ?? "")
    .replace(/[   ]/g, " ")
    .replace(/[‐‑‒]/g, "-")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/²/g, "²")
    .split("")
    .map((char) => (char.charCodeAt(0) < 256 || WIN_ANSI_EXTRA.has(char) ? char : "?"))
    .join("");
}

const moneyFormat = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const money = (value) => clean(moneyFormat.format(Number(value || 0)));
const qty = (value) => clean(numberFormat.format(Number(value || 0)));
const pct = (value) => `${String(Number(value || 0)).replace(".", ",")} %`;
function frDate(value) {
  if (!value) return "";
  const iso = typeof value === "string" ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function frDateTime(value) {
  const date = new Date(value);
  return clean(date.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "medium" }));
}

function render(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...PAGE, bufferPages: true, info: { Producer: "Nova+", Creator: "Nova+" } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      build(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const left = (doc) => doc.page.margins.left;
const bottomLimit = (doc) => doc.page.height - doc.page.margins.bottom;

function ensureSpace(doc, height) {
  if (doc.y + height > bottomLimit(doc)) doc.addPage();
}

function usableLogo(logoPath) {
  if (!logoPath || !fs.existsSync(logoPath)) return null;
  return [".png", ".jpg", ".jpeg"].includes(path.extname(logoPath).toLowerCase()) ? logoPath : null; // pdfkit ne lit pas le WebP
}

function companyLines(company) {
  const address = [company.address?.line, [company.address?.postalCode, company.address?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [
    [company.name, company.legalForm].filter(Boolean).join(" · "),
    address,
    [company.phone, company.email].filter(Boolean).join(" · "),
    [company.siret && `SIRET ${company.siret}`, company.vatNumber && `TVA ${company.vatNumber}`].filter(Boolean).join(" · "),
  ].filter(Boolean);
}

// En-tête commun : logo + identité à gauche, titre du document à droite.
function header(doc, { company, logoPath, title, subtitle, meta = [] }) {
  const top = doc.page.margins.top;
  const x = left(doc);
  const width = contentWidth(doc);
  let y = top;
  const logo = usableLogo(logoPath);
  if (logo) {
    try {
      doc.image(logo, x, y, { fit: [150, 52] });
      y += 60;
    } catch {
      /* logo illisible : ignoré */
    }
  }
  doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(clean(company.name || "Entreprise"), x, y, { width: width * 0.5 });
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  companyLines(company).slice(1).forEach((line) => doc.text(clean(line), { width: width * 0.5 }));
  const leftBottom = doc.y;

  doc.font("Helvetica-Bold").fontSize(18).fillColor(ACCENT).text(clean(title), x + width * 0.5, top, { width: width * 0.5, align: "right" });
  if (subtitle) doc.font("Helvetica").fontSize(10).fillColor(INK).text(clean(subtitle), { width: width * 0.5, align: "right" });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  meta.filter(Boolean).forEach((line) => doc.text(clean(line), x + width * 0.5, doc.y, { width: width * 0.5, align: "right" }));
  doc.y = Math.max(leftBottom, doc.y) + 16;
  doc.moveTo(x, doc.y).lineTo(x + width, doc.y).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.y += 14;
}

function partyBoxes(doc, boxes) {
  const x = left(doc);
  const gap = 14;
  const width = (contentWidth(doc) - gap * (boxes.length - 1)) / boxes.length;
  const top = doc.y;
  let maxBottom = top;
  boxes.forEach((box, index) => {
    const bx = x + index * (width + gap);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(ACCENT).text(clean(box.title.toUpperCase()), bx + 10, top + 9, { width: width - 20, characterSpacing: 0.6 });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(clean(box.name || ""), bx + 10, doc.y + 3, { width: width - 20 });
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    (box.lines || []).filter(Boolean).forEach((line) => doc.text(clean(line), bx + 10, doc.y + 1, { width: width - 20 }));
    maxBottom = Math.max(maxBottom, doc.y + 10);
  });
  boxes.forEach((_, index) => doc.roundedRect(x + index * (width + gap), top, width, maxBottom - top, 6).lineWidth(0.8).strokeColor(LINE).stroke());
  doc.y = maxBottom + 16;
}

// Tableau simple : colonnes { label, width (fraction), align }, lignes = tableaux de cellules
// (chaîne, ou { text, sub, bold }), lignes de groupe { group: "Lot" } et de sous-total { subtotal: [...] }.
function table(doc, columns, rows) {
  const x = left(doc);
  const width = contentWidth(doc);
  const widths = columns.map((column) => column.width * width);
  const drawHead = () => {
    const y = doc.y;
    doc.rect(x, y, width, 20).fill(SOFT);
    let cx = x;
    columns.forEach((column, index) => {
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED).text(clean(column.label.toUpperCase()), cx + 6, y + 6.5, { width: widths[index] - 12, align: column.align || "left", characterSpacing: 0.4 });
      cx += widths[index];
    });
    doc.y = y + 24;
  };
  drawHead();
  for (const row of rows) {
    if (row.group) {
      ensureSpace(doc, 40);
      if (doc.y < doc.page.margins.top + 4) drawHead();
      doc.font("Helvetica-Bold").fontSize(9).fillColor(ACCENT).text(clean(row.group), x + 6, doc.y + 4, { width: width - 12 });
      doc.y += 4;
      continue;
    }
    const cells = row.subtotal || row;
    const heights = cells.map((cell, index) => {
      const value = typeof cell === "object" && cell !== null ? cell : { text: cell };
      doc.font(value.bold || row.subtotal ? "Helvetica-Bold" : "Helvetica").fontSize(8.8);
      let h = doc.heightOfString(clean(value.text ?? ""), { width: widths[index] - 12 });
      if (value.sub) h += doc.font("Helvetica").fontSize(7.6).heightOfString(clean(value.sub), { width: widths[index] - 12 }) + 2;
      return h;
    });
    const height = Math.max(...heights) + 10;
    if (doc.y + height > bottomLimit(doc)) {
      doc.addPage();
      drawHead();
    }
    const y = doc.y;
    if (row.subtotal) doc.rect(x, y, width, height).fill("#fafafc");
    let cx = x;
    cells.forEach((cell, index) => {
      const value = typeof cell === "object" && cell !== null ? cell : { text: cell };
      doc.font(value.bold || row.subtotal ? "Helvetica-Bold" : "Helvetica").fontSize(8.8).fillColor(INK).text(clean(value.text ?? ""), cx + 6, y + 5, { width: widths[index] - 12, align: columns[index].align || "left" });
      if (value.sub) doc.font("Helvetica").fontSize(7.6).fillColor(MUTED).text(clean(value.sub), cx + 6, doc.y + 2, { width: widths[index] - 12, align: columns[index].align || "left" });
      cx += widths[index];
    });
    doc.y = y + height;
    doc.moveTo(x, doc.y).lineTo(x + width, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
  }
  doc.y += 10;
}

// Bloc de totaux aligné à droite.
function totalsBlock(doc, entries) {
  const width = 230;
  const x = left(doc) + contentWidth(doc) - width;
  ensureSpace(doc, entries.length * 18 + 10);
  entries.forEach((entry) => {
    const y = doc.y;
    if (entry.strong) doc.rect(x, y - 3, width, 22).fill(ACCENT);
    doc.font(entry.strong ? "Helvetica-Bold" : "Helvetica").fontSize(entry.strong ? 10.5 : 9).fillColor(entry.strong ? "#ffffff" : INK);
    doc.text(clean(entry.label), x + 8, y + (entry.strong ? 2 : 0), { width: width * 0.58 - 8, lineBreak: false, ellipsis: true });
    doc.text(clean(entry.value), x + width * 0.58, y + (entry.strong ? 2 : 0), { width: width * 0.42 - 8, align: "right", lineBreak: false });
    doc.y = y + (entry.strong ? 24 : 16);
  });
  doc.y += 8;
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 50);
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(clean(title), left(doc), doc.y, { width: contentWidth(doc) });
  doc.y += 4;
}

function paragraph(doc, value, { size = 8.2, color = MUTED } = {}) {
  if (!value) return;
  ensureSpace(doc, 30);
  doc.font("Helvetica").fontSize(size).fillColor(color).text(clean(value), left(doc), doc.y, { width: contentWidth(doc), lineGap: 1.2 });
  doc.y += 6;
}

function signatureBoxes(doc, boxes) {
  const height = 112;
  ensureSpace(doc, height + 20);
  const x = left(doc);
  const gap = 14;
  const width = (contentWidth(doc) - gap * (boxes.length - 1)) / boxes.length;
  const top = doc.y;
  boxes.forEach((box, index) => {
    const bx = x + index * (width + gap);
    doc.roundedRect(bx, top, width, height, 6).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK).text(clean(box.title), bx + 10, top + 9, { width: width - 20 });
    doc.font("Helvetica").fontSize(7.6).fillColor(MUTED).text(clean(box.hint || ""), bx + 10, doc.y + 2, { width: width - 20 });
    if (box.imagePath && fs.existsSync(box.imagePath)) {
      try {
        doc.image(box.imagePath, bx + 10, top + 38, { fit: [width - 20, 52] });
      } catch {
        /* image illisible */
      }
    }
    if (box.footer) doc.font("Helvetica").fontSize(7.6).fillColor(INK).text(clean(box.footer), bx + 10, top + height - 18, { width: width - 20 });
  });
  doc.y = top + height + 14;
}

function footers(doc, label) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = doc.page.height - doc.page.margins.bottom + 22;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // écrire dans la marge sans créer de page
    doc.font("Helvetica").fontSize(7).fillColor(MUTED);
    doc.text(clean(label), left(doc), y, { width: contentWidth(doc) * 0.75, lineBreak: false });
    doc.text(`Page ${index + 1} / ${range.count}`, left(doc) + contentWidth(doc) * 0.75, y, { width: contentWidth(doc) * 0.25, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

function legalFooter(company) {
  return [company.name, company.legalForm, company.siret && `SIRET ${company.siret}`, company.vatNumber && `TVA ${company.vatNumber}`].filter(Boolean).join(" · ");
}

function insuranceText(company) {
  const parts = [];
  if (company.insurance?.insurer || company.insurance?.policyNumber) {
    parts.push(`Assurance responsabilité civile décennale : ${[company.insurance.insurer, company.insurance.policyNumber && `contrat n° ${company.insurance.policyNumber}`].filter(Boolean).join(", ")}${company.insurance.coverage ? `. Couverture géographique : ${company.insurance.coverage}` : ""}.`);
  }
  if (company.rge?.certified && company.rge?.number) {
    parts.push(`Entreprise qualifiée RGE n° ${company.rge.number}${company.rge.body ? ` (${company.rge.body})` : ""}${company.rge.validUntil ? `, valable jusqu'au ${frDate(company.rge.validUntil)}` : ""}.`);
  }
  return parts.join(" ");
}

const MODE_SUFFIX = { labor: " (main-d'œuvre seule)", supply: " (fourniture seule)" };

// ---------- Devis / avenant (vue client) ----------

function quote({ quote: q, lines, computed, company, logoPath, dossier, signature = null }) {
  return render((doc) => {
    const title = q.amendmentNo ? `Avenant n° ${q.amendmentNo}` : "Devis";
    const created = q.sentAt || q.createdAt || new Date();
    const validUntil = new Date(new Date(created).getTime() + (q.validDays || 30) * 86400000);
    header(doc, {
      company,
      logoPath,
      title,
      subtitle: q.amendmentNo ? `au devis n° ${q.number} · ${q.versionLabel}` : `N° ${q.number} · ${q.versionLabel}`,
      meta: [`Date : ${frDate(created)}`, `Valable jusqu'au ${frDate(validUntil)}`, q.workStartOn && `Début des travaux prévu : ${frDate(q.workStartOn)}`],
    });
    partyBoxes(doc, [
      { title: "Client", name: dossier.clientName, lines: [dossier.clientAddress, [dossier.clientPhone, dossier.clientEmail].filter(Boolean).join(" · ")] },
      { title: "Adresse du chantier", name: dossier.siteAddress || dossier.clientAddress || "Identique à l'adresse du client", lines: [q.title] },
    ]);

    const rows = [];
    const byLot = new Map();
    lines.forEach((line, index) => byLot.set(line.lotName, [...(byLot.get(line.lotName) || []), { line, result: computed.lines[index] }]));
    for (const [lotName, entries] of byLot) {
      rows.push({ group: lotName });
      entries.forEach(({ line, result }) => {
        rows.push([{ text: `${line.label}${MODE_SUFFIX[line.mode] || ""}`, sub: line.description }, qty(line.quantity), line.unit, money(result.unitPrice), pct(result.vatRate), money(result.sale)]);
      });
      const lotSale = pricing.round2(entries.reduce((sum, entry) => sum + entry.result.sale, 0));
      if (byLot.size > 1) rows.push({ subtotal: [`Sous-total ${lotName}`, "", "", "", "", money(lotSale)] });
    }
    table(doc, [
      { label: "Désignation", width: 0.46 },
      { label: "Qté", width: 0.07, align: "right" },
      { label: "Unité", width: 0.09 },
      { label: "PU HT", width: 0.13, align: "right" },
      { label: "TVA", width: 0.09, align: "right" },
      { label: "Total HT", width: 0.16, align: "right" },
    ], rows);

    totalsBlock(doc, [
      { label: "Total HT", value: money(computed.sale) },
      ...computed.vatLines.map((entry) => ({ label: `TVA ${pct(entry.rate)} sur ${money(entry.base)}`, value: money(entry.vat) })),
      { label: "Total TTC", value: money(computed.total), strong: true },
    ]);

    sectionTitle(doc, "Échéancier de paiement");
    table(doc, [
      { label: "Échéance", width: 0.6 },
      { label: "Part", width: 0.16, align: "right" },
      { label: "Montant TTC", width: 0.24, align: "right" },
    ], pricing.splitSchedule(computed.total, q.schedule).map((step) => [step.label, pct(step.percent), money(step.amount)]));
    if (q.amendmentNo && q.scheduleMode === "merge") paragraph(doc, "Le montant de cet avenant s'ajoute aux échéances restantes du devis initial.");

    const reduced = computed.vatLines.some((entry) => entry.rate < 20 && entry.base !== 0);
    sectionTitle(doc, "Mentions");
    paragraph(doc, insuranceText(company));
    if (reduced) paragraph(doc, company.documents?.reducedVatMention);
    if (dossier.offPremises) {
      paragraph(doc, "Contrat conclu hors établissement : vous disposez d'un délai de 14 jours à compter de la signature pour vous rétracter, sans avoir à motiver votre décision, au moyen du formulaire joint ou de toute autre déclaration dénuée d'ambiguïté (articles L221-18 et suivants du Code de la consommation). Aucun paiement ne peut être exigé avant l'expiration d'un délai de 7 jours à compter de la conclusion du contrat. Les travaux ne commencent pas avant la fin du délai de rétractation, sauf demande expresse de votre part.");
    }
    paragraph(doc, `Délai de paiement : ${company.billing?.paymentTermsDays ?? 30} jours à réception de facture. Prix en euros.`);
    if (company.documents?.quoteTerms) {
      sectionTitle(doc, "Conditions générales");
      paragraph(doc, company.documents.quoteTerms);
    }

    sectionTitle(doc, "Bon pour accord");
    if (dossier.offPremises && signature?.earlyStart) {
      paragraph(doc, "Le client demande expressément que les travaux commencent avant la fin du délai de rétractation. En cas de rétractation, il devra le montant correspondant aux travaux réalisés jusqu'à la communication de sa décision (article L221-25 du Code de la consommation).", { color: INK });
    }
    signatureBoxes(doc, [
      { title: "Le client", hint: "Date, signature précédée de la mention « Bon pour accord »", imagePath: signature?.imagePath, footer: signature ? `Bon pour accord · ${signature.signerName} · ${frDateTime(signature.signedAt)}` : "" },
      { title: `Pour ${company.name || "l'entreprise"}`, hint: "Signature et cachet" },
    ]);

    if (signature) {
      sectionTitle(doc, "Certificat de signature électronique");
      paragraph(doc, [
        `Signé par ${signature.signerName} le ${frDateTime(signature.signedAt)} (heure de Paris), sur place, par signature manuscrite sur écran, après acceptation de la mention « Bon pour accord ».`,
        `Empreinte SHA-256 du devis présenté : ${signature.documentSha256}.`,
        `Adresse IP : ${signature.ip || "non disponible"} · Appareil : ${signature.userAgent || "non disponible"}.`,
        signature.withdrawalUntil ? `Fin du délai de rétractation : ${frDate(signature.withdrawalUntil)}.` : "",
      ].filter(Boolean).join(" "), { size: 7.6 });
    }

    if (dossier.offPremises) withdrawalForm(doc, company);
    footers(doc, `${legalFooter(company)} · ${title} ${q.number}`);
  });
}

// Formulaire type de rétractation (annexe à l'article R221-1 du Code de la consommation).
function withdrawalForm(doc, company) {
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(14).fillColor(ACCENT).text("Formulaire de rétractation", left(doc), doc.page.margins.top, { width: contentWidth(doc) });
  doc.y += 10;
  const address = [company.address?.line, [company.address?.postalCode, company.address?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const body = [
    "Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat.",
    `À l'attention de ${company.name || "[nom de l'entreprise]"}, ${address || "[adresse]"}${company.email ? `, ${company.email}` : ""} :`,
    "Je/Nous (*) vous notifie/notifions (*) par la présente ma/notre (*) rétractation du contrat portant sur la prestation de services ci-dessous :",
    "Commandé le (*) : ............................................................",
    "Nom du (des) consommateur(s) : ............................................................",
    "Adresse du (des) consommateur(s) : ............................................................",
    "Signature du (des) consommateur(s) (uniquement en cas de notification du présent formulaire sur papier) :",
    "\n\n",
    "Date : ............................................................",
    "(*) Rayez la mention inutile.",
  ];
  body.forEach((line) => {
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(clean(line), left(doc), doc.y, { width: contentWidth(doc), lineGap: 2 });
    doc.y += 10;
  });
}

// ---------- Grille de prix sous-traitant ----------

function grid({ grid: g, subcontractor, company, logoPath }) {
  return render((doc) => {
    header(doc, { company, logoPath, title: "Grille de prix", subtitle: `Sous-traitant · version ${g.version}`, meta: [`Période : du ${frDate(g.startsOn)} au ${frDate(g.endsOn)}`, `Éditée le ${frDate(new Date())}`] });
    partyBoxes(doc, [
      { title: "Entreprise principale", name: company.name, lines: companyLines(company).slice(1) },
      { title: "Sous-traitant", name: subcontractor.name, lines: [subcontractor.address, subcontractor.siret && `SIRET ${subcontractor.siret}`, [subcontractor.contactName, subcontractor.phone, subcontractor.email].filter(Boolean).join(" · ")] },
    ]);
    const rows = [];
    const byLot = new Map();
    g.lines.forEach((line) => byLot.set(line.lotName, [...(byLot.get(line.lotName) || []), line]));
    for (const [lotName, lots] of byLot) {
      rows.push({ group: lotName });
      lots.forEach((line) => rows.push([line.code, { text: line.label, sub: line.description }, line.unit, money(line.laborPrice), line.supplyIncluded ? "Oui" : "Non", line.supplyPrice === null ? "-" : money(line.supplyPrice)]));
    }
    table(doc, [
      { label: "Code", width: 0.11 },
      { label: "Ouvrage", width: 0.41 },
      { label: "Unité", width: 0.09 },
      { label: "Prix MO HT", width: 0.13, align: "right" },
      { label: "Fourn. incluse", width: 0.12, align: "right" },
      { label: "Prix fourn. HT", width: 0.14, align: "right" },
    ], rows);
    sectionTitle(doc, "Conditions");
    paragraph(doc, `Prix fermes du ${frDate(g.startsOn)} au ${frDate(g.endsOn)}.`, { color: INK });
    paragraph(doc, company.documents?.gridTerms);
    signatureBoxes(doc, [
      { title: "Le sous-traitant", hint: "Date, cachet et signature précédés de « Lu et approuvé »" },
      { title: `Pour ${company.name || "l'entreprise principale"}`, hint: "Date et signature" },
    ]);
    footers(doc, `${legalFooter(company)} · Grille ${subcontractor.name} v${g.version}`);
  });
}

// ---------- Bon de commande sous-traitant (sans prix de vente client) ----------

const SCOPE_LABEL = { labor: "Main-d'œuvre", supply: "Fourniture", both: "MO + fourniture" };

function purchaseOrder({ order, quote: q, dossier, subcontractor, company, logoPath }) {
  return render((doc) => {
    header(doc, { company, logoPath, title: "Bon de commande", subtitle: `N° ${order.number}`, meta: [`Date : ${frDate(order.createdAt)}`, `${q.amendmentNo ? `Avenant ${q.amendmentNo} au devis` : "Devis client"} ${q.number}`] });
    partyBoxes(doc, [
      { title: "Sous-traitant", name: subcontractor.name, lines: [subcontractor.address, subcontractor.siret && `SIRET ${subcontractor.siret}`, [subcontractor.contact_name, subcontractor.phone, subcontractor.email].filter(Boolean).join(" · ")] },
      { title: "Chantier", name: dossier.clientName, lines: [dossier.siteAddress || dossier.clientAddress, q.workStartOn && `Début prévu : ${frDate(q.workStartOn)}`] },
    ]);
    table(doc, [
      { label: "Code", width: 0.1 },
      { label: "Ouvrage", width: 0.34 },
      { label: "Nature", width: 0.14 },
      { label: "Qté", width: 0.07, align: "right" },
      { label: "Unité", width: 0.1 },
      { label: "PU HT", width: 0.11, align: "right" },
      { label: "Total HT", width: 0.14, align: "right" },
    ], order.lines.map((line) => [line.code, { text: line.label, sub: line.lotName }, SCOPE_LABEL[line.scope], qty(line.quantity), line.unit, money(line.laborUnit + line.supplyUnit), money(line.total)]));
    totalsBlock(doc, [{ label: "Total HT", value: money(order.total), strong: true }]);
    paragraph(doc, "TVA autoliquidée : facture à établir hors taxes.", { color: INK });
    sectionTitle(doc, "Échéancier de règlement");
    table(doc, [
      { label: "Échéance", width: 0.6 },
      { label: "Part", width: 0.16, align: "right" },
      { label: "Montant HT", width: 0.24, align: "right" },
    ], order.schedule.map((step) => [`${step.label} (au paiement correspondant du client)`, pct(step.percent), money(step.amount)]));
    sectionTitle(doc, "Conditions");
    paragraph(doc, company.documents?.orderTerms);
    signatureBoxes(doc, [
      { title: "Le sous-traitant", hint: "Bon pour accord, date et signature" },
      { title: `Pour ${company.name || "l'entreprise principale"}`, hint: "Date et signature" },
    ]);
    footers(doc, `${legalFooter(company)} · ${order.number}`);
  });
}

// ---------- PV de réception ----------

function reception({ reception: r, dossier, company, logoPath, signature }) {
  return render((doc) => {
    header(doc, { company, logoPath, title: "Procès-verbal", subtitle: "de réception des travaux", meta: [`Réception du ${frDate(r.receivedOn)}`] });
    partyBoxes(doc, [
      { title: "Maître d'ouvrage", name: dossier.clientName, lines: [dossier.clientAddress] },
      { title: "Entreprise", name: company.name, lines: companyLines(company).slice(1, 3) },
    ]);
    paragraph(doc, `Chantier : ${dossier.siteAddress || dossier.clientAddress || ""}`, { color: INK, size: 9 });
    paragraph(doc, r.reserves.length ? `Le maître d'ouvrage déclare accepter les travaux avec les ${r.reserves.length} réserve(s) ci-dessous, que l'entreprise s'engage à lever dans les délais indiqués.` : "Le maître d'ouvrage déclare accepter les travaux sans réserve.", { color: INK, size: 9.5 });
    if (r.reserves.length) {
      table(doc, [
        { label: "N°", width: 0.07 },
        { label: "Lot", width: 0.2 },
        { label: "Réserve", width: 0.55 },
        { label: "Levée avant le", width: 0.18 },
      ], r.reserves.map((reserve, index) => [String(index + 1), reserve.lot || "", reserve.label, reserve.deadline ? frDate(reserve.deadline) : ""]));
    }
    paragraph(doc, "La réception est l'acte par lequel le maître d'ouvrage accepte l'ouvrage (article 1792-6 du Code civil). Elle fait courir la garantie de parfait achèvement (1 an), la garantie biennale de bon fonctionnement (2 ans) et la garantie décennale (10 ans).");
    paragraph(doc, insuranceText(company));
    signatureBoxes(doc, [
      { title: "Le maître d'ouvrage", hint: "Signature", imagePath: signature?.imagePath, footer: signature ? `${signature.signerName} · ${frDateTime(signature.signedAt)}` : "" },
      { title: `Pour ${company.name || "l'entreprise"}`, hint: "Signature" },
    ]);
    if (signature) paragraph(doc, `Signé sur place sur écran par ${signature.signerName} le ${frDateTime(signature.signedAt)} (heure de Paris) · IP ${signature.ip || "non disponible"}.`, { size: 7.4 });
    footers(doc, `${legalFooter(company)} · PV de réception ${frDate(r.receivedOn)}`);
  });
}

module.exports = { quote, grid, purchaseOrder, reception, clean, money };
