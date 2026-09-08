# Déploiement Railway, Nova+

## Résultat attendu

Une URL publique Railway du type :

```text
https://nova-plus-btp-production.up.railway.app
```

avec :

- app Node.js ;
- sauvegarde persistante ;
- documents persistants ;
- identifiant et mot de passe du premier compte ;
- secret de signature des sessions ;
- HTTPS automatique.

## Étapes rapides

1. Créer un compte Railway.
2. Créer un projet depuis GitHub.
3. Sélectionner le repo Nova+.
4. Railway détecte `railway.json` et `nixpacks.toml`.
5. Ajouter un volume au service.
6. Monter le volume sur :

```text
/data
```

7. Ajouter les variables :

```text
DATA_DIR=/data
NOVA_ADMIN_ID=nova
NOVA_ADMIN_PASSWORD=mot-de-passe-solide
NOVA_ADMIN_NAME=Mon entreprise
NOVA_SESSION_SECRET=une-cle-secrete-aleatoire-tres-longue
NODE_ENV=production
```

Ne pas définir `PORT`, Railway le fournit automatiquement.

8. Déployer.

## Vérification après déploiement

Tester :

```text
https://URL-RAILWAY/api/health
```

La page doit répondre :

```json
{ "ok": true }
```

Puis ouvrir l'URL principale. Nova+ affichera son écran de connexion.

- Identifiant : valeur de `NOVA_ADMIN_ID`
- Mot de passe : valeur de `NOVA_ADMIN_PASSWORD`

## Nom de domaine

Dans Railway :

1. Ouvrir le service.
2. Aller dans `Settings`.
3. Ajouter un `Custom Domain`, exemple :

```text
app.nomclient.fr
```

4. Copier le CNAME donné par Railway.
5. Chez Hostinger/OVH, créer ce CNAME.
6. Attendre l'activation HTTPS.

## Point important

Sans volume monté sur `/data`, les données peuvent être perdues à chaque redéploiement.

Le volume est obligatoire pour une version exploitable.
