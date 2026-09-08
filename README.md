# Nova+ MVP BTP

Nova+ est une application de pilotage chantier BTP : marge, coûts réels, facturation, suivi commande, fournisseurs, sous-traitants, documents chantier et rappels.

## Lancer la version exploitable locale

Cette version sauvegarde les données dans `data/state.json` et les documents dans `data/uploads`.

```bash
npm start
```

Ou directement :

```bash
node server.js
```

Puis ouvrir :

```text
http://localhost:4173
```

Important : l'ouverture directe de `index.html` fonctionne encore pour une démo, mais elle reste limitée au stockage navigateur. Pour tester la sauvegarde réelle et les documents lourds, utiliser `npm start`.

### Comptes clients

Depuis la page de connexion, un nouveau client peut sélectionner **Créer mon compte**, renseigner son entreprise, choisir son identifiant et son mot de passe, puis accéder immédiatement à son espace isolé.

Le lien de connexion stable est `/connexion`. Sur l’installation historique protégée par `NOVA_AUTH_PASSWORD`, le compte propriétaire utilise l’identifiant `nova` et son ancien mot de passe : Nova+ rattache automatiquement les données existantes au compte administrateur. Cette reprise d’identifiant est unique et se désactive après sa première utilisation.

Lors de la migration d’une installation existante, Nova+ conserve les fichiers historiques à leur emplacement, crée une sauvegarde supplémentaire dans `data/backups/pre-accounts-v1`, puis copie les données vers le premier compte administrateur. Aucune donnée historique n’est déplacée ou supprimée.

Créer le premier compte administrateur :

```bash
npm run user:add -- mon-identifiant "mot-de-passe-solide" "Nom de l'entreprise"
```

Créer ensuite un compte distinct par client avec la même commande. Le premier compte créé reçoit le rôle `admin`, les suivants le rôle `client`. Chaque compte dispose de ses propres chantiers et documents. Les mots de passe sont hachés avec scrypt et ne sont jamais enregistrés en clair.

L’administrateur peut aussi tout gérer directement dans Nova+ : **Réglages marge → Comptes clients Nova+**. Cet espace permet de créer un accès, désactiver ou réactiver un client et définir un nouveau mot de passe. Les comptes clients ne voient pas cette section.

Lister les comptes :

```bash
npm run user:list
```

Sur un hébergement neuf, le premier compte peut aussi être créé automatiquement avec `NOVA_ADMIN_ID`, `NOVA_ADMIN_PASSWORD` et `NOVA_ADMIN_NAME`. `NOVA_AUTH_PASSWORD` reste accepté pour migrer un ancien déploiement.

## Déployer sur Railway, recommandé

Voir [RAILWAY.md](./RAILWAY.md).

Variables Railway :

```text
DATA_DIR=/data
NOVA_ADMIN_ID=admin
NOVA_ADMIN_PASSWORD=mot-de-passe-solide
NOVA_ADMIN_NAME=Mon entreprise
NOVA_SESSION_SECRET=une-cle-secrete-aleatoire-tres-longue
NODE_ENV=production
```

Ajouter un volume Railway monté sur :

```text
/data
```

Important : sans volume, les documents et la sauvegarde peuvent être perdus au redéploiement.

## Déployer sur Render

Voir aussi [DEPLOIEMENT.md](./DEPLOIEMENT.md).

1. Créer un repo GitHub avec ce dossier.
2. Sur Render, créer un nouveau `Blueprint`.
3. Sélectionner le repo.
4. Render lira `render.yaml`.
5. Définir `NOVA_ADMIN_ID`, `NOVA_ADMIN_PASSWORD`, `NOVA_ADMIN_NAME` et `NOVA_SESSION_SECRET`.
6. Déployer.

Le disque persistant Render est monté dans `/var/data`. Les données seront conservées dans :

```text
/var/data/nova/state.json
/var/data/nova/uploads
```

## Déployer avec Docker

```bash
docker build -t nova-plus-btp .
docker run -p 4173:4173 \
  -e NOVA_ADMIN_ID=admin \
  -e NOVA_ADMIN_PASSWORD=mot-de-passe-solide \
  -e NOVA_SESSION_SECRET=une-cle-secrete-aleatoire-tres-longue \
  -v nova-plus-data:/data \
  nova-plus-btp
```

Puis ouvrir :

```text
http://localhost:4173
```

## Nom de domaine

Pour une livraison client, utiliser un domaine ou sous-domaine :

```text
app.nomduclient.fr
```

Il faudra pointer le DNS vers l'hébergement choisi, puis activer HTTPS côté hébergeur.

## Tester en mode fichier

Ouvrir `index.html` dans un navigateur.

## Fonctionnalités incluses

- Dashboard marge, coût prévu, coût réel et statut rentable/limite/danger.
- Saisie dynamique du coût réel par lot avec sauvegarde locale.
- Navigation entre Tableau de bord, Chantiers, Devis PDF, Facturation, Bibliothèque lots et Réglages.
- Création de chantier.
- Édition de la fiche chantier active.
- Import PDF texte réel avec écran de validation.
- Contrôle total détecté / total importé / écart.
- Correction manuelle du lot avant validation.
- Détail des lignes de devis derrière chaque lot.
- Réaffectation d'une ligne de devis depuis le détail d'un lot.
- Suppression de lot.
- Ajout de lot avec vente HT, matériaux et main-d'oeuvre.
- Ajout et validation d'échéances de facturation.
- Alertes de facturation selon la date réelle.
- Bibliothèque de lots et mots-clés de classement.
- Recherche globale.
- Export CSV du bilan chantier.

## À brancher pour passer à grande échelle

- Base de données PostgreSQL.
- Réinitialisation de mot de passe par e-mail et double authentification.
- Stockage objet type S3 ou Supabase Storage.
- Extraction PDF réelle avec OCR pour les devis scannés.
- Classification IA des lignes de devis par lot.
- Gestion d'équipes et droits fins par profil au sein d'une même entreprise.
