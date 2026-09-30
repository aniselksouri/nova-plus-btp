const test = require("node:test");
const assert = require("node:assert/strict");
const parser = require("../quote-parser.js");

test("ignore les coordonnées et adresses de chantier", () => {
  assert.equal(parser.isNonBillableLine("Coordonnées du chantier 12 rue Nationale 59000 Lille"), true);
  assert.equal(parser.isNonBillableLine("Code postal : 59110"), true);
  assert.equal(parser.isNonBillableLine("Installation de chantier 1 250,00 €"), false);
});

test("ne transforme pas les codes postaux ou téléphones en prix", () => {
  assert.equal(parser.extractLastAmount("Chantier COQUART 59000 Lille"), null);
  assert.equal(parser.extractLastAmount("Téléphone 06 12 34 56 78"), null);
  assert.equal(parser.extractLastAmount("Adresse 22 rue de Paris 75000"), null);
});

test("accepte uniquement un montant décimal ou explicitement monétaire", () => {
  assert.equal(parser.extractLastAmount("Pose carrelage 1 245,50"), 1245.5);
  assert.equal(parser.extractLastAmount("Avenant menuiserie 850 €"), 850);
  assert.equal(parser.extractLastAmount("Référence client 20260903"), null);
});

test("conserve les remises sous forme de ventes négatives", () => {
  assert.equal(parser.extractLastAmount("Remise commerciale 500,00 €"), -500);
  assert.equal(parser.extractLastAmount("Remise exceptionnelle - 1 250,50 €"), -1250.5);
  assert.equal(parser.extractLastAmount("Rabais (300,00)"), -300);
  assert.equal(parser.applyDiscountSign("Ristourne client", 275), -275);
});

test("préserve le signe des montants négatifs hors remise", () => {
  assert.equal(parser.parseAmountToken("- 420,00"), -420);
  assert.equal(parser.parseAmountToken("(125,75)"), -125.75);
  assert.equal(parser.parseAmountToken("90,00-"), -90);
});

const rows = (texts) => texts.map((text, index) => ({ text, page: 1, y: 800 - index * 20 }));
test("lit les décimales à point et virgule sans multiplier par cent", () => {
  assert.equal(parser.parseAmountToken("1250.50"), 1250.5);
  assert.equal(parser.parseAmountToken("1.250,50"), 1250.5);
  assert.equal(parser.extractLastAmount("Pose 100.50 EUR"), 100.5);
});
test("importe toutes les lignes d'un devis mixte et exclut les sous-totaux", () => {
  const lines = parser.extractQuoteRows(rows([
    "1 Plomberie", "1.1 Pose de lavabo 2 u 100,00 200,00 20,00",
    "Raccordement supplémentaire 50,00", "Sous-total Plomberie 250,00",
    "Remise commerciale 10% 25,00", "Total HT 225,00", "TVA 45,00", "Total TTC 270,00",
  ]));
  assert.deepEqual(lines.map((line) => line.amount), [200, 50, -25]);
  assert.equal(lines[0].lot, "Plomberie");
  assert.equal(parser.detectQuoteTotal(rows(["Total HT 225,00", "Total TTC 270,00"])), 225);
});
test("ne confond pas une remise isolée avec la totalité du devis", () => {
  const lines = parser.extractQuoteRows(rows(["Pose du parquet 1200,00", "Remise 100,00"]));
  assert.equal(lines.length, 2);
  assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), 1100);
});
test("conserve les lignes identiques légitimes et plus de 180 lignes", () => {
  const lines = parser.extractQuoteRows(rows(Array(210).fill("Pose de prise 20,00")));
  assert.equal(lines.length, 210);
  assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), 4200);
});
test("reconnaît les moins-values et ne fabrique pas un total PDF", () => {
  const lines = parser.extractQuoteRows(rows(["Moins-value porte 300,00", "Remise 5,00%"]));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, -300);
  assert.equal(lines[0].lot, "Moins-value");
  assert.equal(parser.detectQuoteTotal(rows(["Pose de porte 1200,00"])), null);
});
test('une remise en état est une prestation positive, pas une remise commerciale', () => {
  assert.equal(parser.extractQuoteRows(rows(['Remise en état des murs 500,00']))[0].amount,500);
});
test('ignore les en-têtes de colonnes, totaux de sections, dimensions et conditions de paiement', () => {
  const input=rows(['N° Désignation U Qté PUHT Total H.T TVA',
    '1 ELECTRICITE 200,00', '1.1 Pose de prises U 2 100,00 200,00 10,00',
    'Dimensions : longueur 1,20 m', 'verni, larg. 18.00 cm',
    '2 MENUISERIE 300,00', '2.1 Pose porte U 1 300,00 300,00',
    'Texte légal Total H.T 500,00', 'Remise 50,00', 'Texte légal Total Net H.T 450,00',
    'Texte légal Dont main d’oeuvre 200,00', 'Texte légal Total T.T.C 495,00',
    '30.00% au milieu du chantier, soit 148.50 EUR TTC',
    'entraînera une indemnité forfaitaire de 40 €']);
  assert.deepEqual(parser.extractQuoteRows(input).map(l=>l.amount),[200,300,-50]);
  assert.equal(parser.detectQuoteTotal(input),450);
});
test('préserve les montants des lignes sans libellé et des prestations offertes', () => {
  const lines=parser.extractQuoteRows(rows(['1 Menuiserie','1.1 U 2 150,00 300,00 10,00',
    '1.2 Pose meuble OFFERT 0 100,00 0,00 10,00','1.3 5,0 m2 20,00 100,00']));
  assert.deepEqual(lines.map(l=>l.amount),[300,0,100]);
  assert.match(lines[0].label,/Description à compléter/);
});
