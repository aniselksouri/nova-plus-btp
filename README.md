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

### Protection par mot de passe

En production, définir obligatoirement :

```bash
NOVA_AUTH_PASSWORD=mot-de-passe-solide
```

Le navigateur affichera une demande d'identification. Le nom utilisateur peut être n'importe quoi, seul le mot de passe est vérifié.

## Déployer sur Railway, recommandé

Voir [RAILWAY.md](./RAILWAY.md).

Variables Railway :

```text
DATA_DIR=/data
NOVA_AUTH_PASSWORD=mot-de-passe-solide
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
5. Définir la variable secrète `NOVA_AUTH_PASSWORD`.
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
  -e NOVA_AUTH_PASSWORD=mot-de-passe-solide \
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

## À brancher pour une vraie version SaaS multi-clients

- Base de données PostgreSQL.
- Authentification utilisateurs complète.
- Stockage objet type S3 ou Supabase Storage.
- Extraction PDF réelle avec OCR pour les devis scannés.
- Classification IA des lignes de devis par lot.
- Multi-utilisateurs et droits par profil.
