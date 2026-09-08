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
