"use strict";

// Droits par rôle (cahier des charges, « Droits d'accès »). Source unique côté serveur ;
// l'interface reçoit la liste des droits de l'utilisateur pour masquer ce qu'il ne peut pas faire.

const { httpError } = require("./security");

const ALL = ["admin", "direction_commerciale", "commercial", "conducteur_travaux", "secretariat", "comptabilite"];

const RULES = {
  // Bibliothèque d'ouvrages
  "library.read": ALL,
  "library.write": ["admin", "direction_commerciale", "conducteur_travaux"],
  "library.margins": ["admin"], // taux de marge par défaut, par lot et par ouvrage
  // Sous-traitants et grilles
  "st.read": ALL,
  "st.write": ["admin", "conducteur_travaux", "secretariat"],
  // Dossiers et devis ; un commercial ne voit que ses dossiers (filtre appliqué dans lib/quotes.js)
  "quotes.read_all": ["admin", "direction_commerciale", "conducteur_travaux", "secretariat", "comptabilite"],
  "quotes.read_own": ["commercial"],
  "quotes.write": ["admin", "direction_commerciale", "commercial", "conducteur_travaux"],
  "quotes.force": ["admin"], // signer malgré une ligne sans prix ST validé
  "quotes.costs": ["admin", "direction_commerciale", "commercial", "conducteur_travaux"], // coûts, ST et marges
  "quotes.exceptions_report": ["admin", "direction_commerciale"],
  "commissions.all": ["admin"], // taux et commissions de chacun ; les autres ne voient que les leurs
  "receptions.write": ["admin", "conducteur_travaux", "secretariat"],
  "orders.read": ["admin", "conducteur_travaux", "secretariat", "comptabilite"],
  // CRM (module 5) ; un commercial ne voit que ses leads (filtre appliqué dans lib/crm.js)
  "crm.read_all": ["admin", "direction_commerciale", "secretariat"],
  "crm.read_own": ["commercial"],
  "crm.write": ["admin", "direction_commerciale", "commercial", "secretariat"],
  "crm.assign": ["admin", "direction_commerciale", "secretariat"],
  "crm.settings": ["admin", "direction_commerciale"], // tour de rôle, délais de relance, motifs de perte
  "crm.team_stats": ["admin", "direction_commerciale"], // tableau par commercial et par source
  "crm.integrations": ["admin"], // branchements Meta, Google Ads, site
  "goals.view": ["admin", "direction_commerciale", "commercial"], // objectif, jauge, classement
  "goals.manage": ["admin"], // frais fixes, point mort, bénéfice visé, objectifs, paliers
};

function can(user, action) {
  return Boolean(user && RULES[action]?.includes(user.role));
}

function require_(user, action, message = "Action non autorisée pour votre rôle.") {
  if (!can(user, action)) throw httpError(403, message);
}

function grantsFor(user) {
  return Object.keys(RULES).filter((action) => can(user, action));
}

module.exports = { RULES, can, require: require_, grantsFor };
