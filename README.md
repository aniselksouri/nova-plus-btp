# Nova+ BTP

Logiciel de pilotage de chantier pour les entreprises du BTP (premier client en production : Habitat Sur Mesure). Il couvre la marge, les coûts réels, la facturation, le suivi des commandes, les fournisseurs, les sous-traitants et les documents de chantier.

**Socle 2.0** (branche `feature/socle-v2`) : base PostgreSQL, comptes individuels avec rôles, double authentification, données versionnées, historique, sauvegardes avec test de restauration, et journal des actions sensibles. Il prépare les modules de Nova+ 2.0 (devis, bibliothèque d'ouvrages, grilles ST, CRM, paiements).

## Lancer en local

```bash
npm ci
cp .env.example .env   # puis adapter les valeurs
set -a; source .env; set +a
npm start
```

Puis ouvrir http://localhost:4173.

- Sans `DATABASE_URL`, Nova+ utilise **PGlite**, un vrai PostgreSQL embarqué stocké dans `DATA_DIR/pglite`. Il n'y a rien à installer. La production utilise le PostgreSQL de Railway, avec le même SQL.
- Si `DATA_DIR/state.json` existe et que la base est vide, il est importé automatiquement au démarrage, puis vérifié par relecture. Le fichier n'est jamais modifié.
- Le premier administrateur est créé à partir de `NOVA_ADMIN_EMAIL` et `NOVA_ADMIN_PASSWORD`. Il doit activer la 2FA et changer son mot de passe à la première connexion.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm start` | Démarre le serveur |
| `npm test` | Lance tous les tests (calculs métier et socle) |
| `npm run check` | Vérifie la syntaxe de tous les fichiers servis |
| `npm run user -- create --email … --name "…" --role commercial` | Crée un compte et affiche son mot de passe temporaire |
| `npm run user -- reset-password\|reset-2fa\|unlock --email …` | Dépannage d'un compte |
| `npm run user -- list` | Liste les comptes |
| `npm run import:json` | Simule l'import de `state.json` ; ajouter `-- --apply` pour l'exécuter |
| `npm run backup` / `npm run backup -- list` | Crée ou liste les sauvegardes |
| `npm run backup -- test [nom]` | Teste une restauration sans rien modifier |
| `npm run backup -- restore <nom> --confirm` | Restauration réelle, précédée d'une sauvegarde de sécurité |
| `npm run export:json` | Exporte les données au format `state.json` (retour arrière) |

Avec PGlite, les commandes s'exécutent serveur arrêté, car la base n'accepte qu'un processus à la fois. Avec PostgreSQL, elles fonctionnent pendant que le serveur tourne.

## Rôles

| Rôle | 2FA | Pour qui | Accès actuel |
| --- | --- | --- | --- |
| Administrateur | Obligatoire | Dirigeant | Tout, y compris Entreprise, Équipe, Sécurité des données et Journal |
| Direction commerciale | — | Responsable commercial | Application chantiers |
| Commercial | — | Prospects, visites, devis | Application chantiers |
| Chargé de projet | — | Conducteur de travaux : chantiers, planning, ST, commandes | Application chantiers |
| Secrétariat | Obligatoire | Administratif, relances, documents | Application chantiers |
| Comptabilité | Obligatoire | Factures, paiements, exports | Application chantiers |

Les rôles sont définis dans `lib/auth.js` (source unique, l'interface les lit depuis le serveur).

## Profil entreprise

Nova+ est vendu à plusieurs entreprises du BTP : aucun nom, logo ni mention propre à un client n'est écrit dans le code. Chaque entreprise renseigne dans **Administration › Entreprise** :

- identité : raison sociale, forme juridique, SIRET, TVA intracommunautaire, adresse, contact, logo (affiché sur la page de connexion) ;
- mentions BTP : assurance décennale (assureur, n° de contrat, couverture géographique), qualification RGE (numéro, organisme, validité) ;
- réglages par défaut, modifiables : échéancier de facturation (30 / 30 / 30 / 10 proposé, total contrôlé à 100 %), taux de TVA (20 / 10 / 5,5 %) et taux par défaut, délai de paiement, marges cibles main-d'œuvre / fourniture / nette minimum.

Tant que les mentions obligatoires manquent, l'onglet et la page Sécurité des données le signalent. `NOVA_COMPANY_NAME` pré-remplit la raison sociale au premier démarrage. L'échéancier du profil s'applique aux nouveaux chantiers et au bouton « Échéancier … » d'un chantier ; les chantiers existants ne sont jamais modifiés.

Les textes imprimés (conditions du devis, mention TVA réduite, conditions des grilles ST et des bons de commande) se règlent dans la carte **Textes des documents** ; les modèles fournis restent à faire valider par le conseil juridique de chaque entreprise.

## Devis et marges (V1 du cahier des charges)

Écran `/devis.html`, accessible depuis le menu « Devis et marges » de l'application chantiers.

| Module | Ce qui est en place |
| --- | --- |
| Bibliothèque | Lots (marges par lot), ouvrages (code, unité, coût ST de référence, fournitures pro / public, TVA), import CSV d'Excel avec simulation avant import, export, comparatif des prix ST par ouvrage |
| Sous-traitants | Fiche, documents obligatoires (décennale, Kbis 3 mois, URSSAF 6 mois) avec alerte d'expiration ; les ST de l'application chantiers sont repris sans être modifiés |
| Grilles de prix | Brouillon → envoyée (PDF à signer) → signée (non modifiable), période de validité, nouvelle version pour tout changement de prix |
| Devis | Dossier client, devis par lots, coût ST repris de la grille signée, marges prestation / fourniture, TVA par ligne, totaux et marges brute / nette en direct, versions, avenants (moins-values possibles) |
| Contrôles | Ligne sans prix ST signé : signature bloquée (forçage administrateur tracé) ; écart à la grille : motif obligatoire ; marge nette sous le minimum ; ST aux documents expirés ; rapport mensuel des exceptions |
| Signature | Sur place (signature dessinée, « bon pour accord », empreinte SHA-256, IP, navigateur) ou dépôt du devis signé ; contrat hors établissement : rétractation 14 jours, formulaire joint, démarrage et premier paiement encadrés |
| Après signature | Devis figé, bons de commande par ST au coût figé (sans le prix client, bloqués si un document manque), chantier créé ou complété dans le suivi avec lots, échéancier et devis signé |
| Réception | PV signé sur place avec réserves ; il rend le solde exigible dans le suivi du chantier |

Formules (taux de marge sur le prix de vente) : vente prestation = coût ST ÷ (1 − marge) ; vente fourniture = prix public, ou coût pro ÷ (1 − marge) ; marge nette = marge brute − commission. Le même fichier `lib/pricing.js` calcule l'écran et les PDF.

Droits : `lib/permissions.js`. Un commercial ne voit que ses dossiers et sa commission ; le secrétariat et la comptabilité voient les montants client sans les coûts ST ni les marges ; seul l'administrateur règle les marges de la bibliothèque et peut forcer une signature.

Pas encore branché : envoi par e-mail et signature électronique avancée (prestataire type Yousign, compte et clé nécessaires), jours fériés dans le calcul de la rétractation. V3 (paiements, achats, export comptable) reste à construire.

## Commercial : leads, objectifs, commissions (V2 du cahier des charges)

Mêmes écrans que les devis (`/devis.html`), onglets Leads, Tableau de bord, Commissions, Objectifs et réglages ; menu « Commercial » de l'application chantiers.

| Module | Ce qui est en place |
| --- | --- |
| Entrée des leads | Meta Lead Ads (webhook signé, lecture du lead dans l'API Graph), Google Ads (webhook à clé), formulaire WordPress (Contact Form 7, WPForms, Elementor…), saisie rapide d'un appel en 3 champs. Source, campagne, annonce et UTM conservés ; un même lead n'est jamais importé deux fois ; même téléphone ou e-mail sur 180 jours : doublon signalé et rendu au même commercial |
| Pipeline | Nouveau → Contacté → Visite planifiée → Devis envoyé → Négociation → Signé / Perdu (motif obligatoire), glisser-déposer ou boutons d'étape dans la fiche |
| Attribution | Tour de rôle (liste réglable) ou manuelle ; réattribution par la direction ou le secrétariat |
| Relances | Une tâche automatique par étape, échue après le délai réglé (1 à 90 jours) ; rappels manuels ; filtre « À relancer » |
| Historique | Appels, visites, e-mails, notes, changements d'étape, devis liés ; le dossier client se crée depuis le lead ; devis envoyé → « Devis envoyé », devis initial signé → « Signé » |
| Tableau de bord | Jauge personnelle et d'équipe du mois, jauge annuelle, point mort atteint, classement, badges, fil des bonnes nouvelles, félicitations à chaque signature et objectif atteint ; par commercial : leads reçus, conversion, CA signé, panier moyen ; par source et campagne : leads, signatures, CA, coût par lead et par signature (administrateur) |
| Point mort | Frais fixes mensuels par catégorie ; point mort = frais fixes ÷ marge nette moyenne après commission des devis signés sur 6 mois (marge nette minimum de la fiche entreprise tant qu'aucun devis n'est signé) ; objectif d'équipe = point mort + bénéfice visé, réparti entre commerciaux (ou saisi) ; objectifs mensuels et annuels |
| Primes et commissions | Paliers de primes mensuels ou annuels ; commission calculée par devis signé, répartie selon l'échéancier client |

Confidentialité : un commercial voit ses leads, ses devis (coûts compris), sa commission et le classement (CA signé, sans commission) ; la direction commerciale voit le pipeline et les chiffres de l'équipe, mais seulement sa propre commission ; le détail des frais fixes, le point mort en euros, le bénéfice et les commissions de chacun sont réservés à l'administrateur.

Pas encore branché : CA encaissé et versement des commissions au rythme des paiements (iPaidThat, V3), notifications e-mail ou push des relances.

## Protection des données

- **Versions** : chaque poste envoie la version qu'il a chargée. Si quelqu'un a enregistré entre-temps, l'envoi est refusé au lieu d'écraser son travail. L'envoi refusé est conservé en base.
- **Suppression massive** : un enregistrement qui ferait disparaître plus d'un chantier d'un coup est refusé.
- **Historique** : toutes les versions des dernières 48 h, puis une par jour pendant 90 jours, restaurables depuis l'administration.
- **Sauvegardes** : une sauvegarde automatique par jour, 30 conservées. Le test de restauration rejoue une sauvegarde dans un schéma temporaire puis annule tout.
- **Pièces jointes** : l'écriture est forcée sur disque et chaque fichier est recensé en base avec son empreinte SHA-256. Une vérification d'intégrité est disponible.
- **Stockage persistant** : sur Railway, si le dossier de données n'est pas dans un volume persistant, ou si le volume monté n'est pas le bon, `/api/health` répond 503 et le déploiement est refusé.

## Déploiement

Voir [RAILWAY.md](./RAILWAY.md) : variables, procédure de mise en production, contrôles et retour arrière.

## Structure

```text
server.js            démarrage HTTP
lib/app.js           routes, sessions, droits, fichiers servis (liste fermée)
lib/db.js            PostgreSQL (pg) ou PGlite
lib/migrations.js    schéma versionné
lib/auth.js          comptes, connexion, 2FA, verrouillage, journal
lib/state-store.js   données versionnées, historique, garde-fous
lib/files.js         pièces jointes
lib/backup.js        sauvegardes, test de restauration
lib/json-import.js   reprise de state.json
lib/storage-guard.js contrôle du volume persistant
lib/pricing.js       calcul des devis (partagé serveur / navigateur)
lib/permissions.js   droits par rôle des modules devis
lib/library.js       bibliothèque d'ouvrages, import / export CSV
lib/subcontractors.js sous-traitants, documents, grilles de prix
lib/quotes.js        dossiers, devis, avenants, signature, bons de commande, réception
lib/pdf.js           PDF devis, grille, bon de commande, PV (pdfkit)
lib/api-devis.js     routes des modules devis
lib/leads-intake.js  lecture des formulaires Meta, Google Ads, WordPress
lib/crm.js           leads, pipeline, attribution, relances, historique
lib/goals.js         point mort, objectifs, classement, paliers, commissions
lib/api-crm.js       routes du module commercial et webhooks d'entrée des leads
crm.*                écrans Leads, Tableau de bord, Commissions, Objectifs
devis.*              écran Devis et marges
login.*  admin.*  session.js   interface de connexion et d'administration
app.js  index.html  styles.css  application chantiers (inchangée hors enregistrement)
```
