# Déploiement Nova+

## Option recommandée : Render

Render est adapté ici parce que Nova+ utilise :

- un serveur Node ;
- un fichier de sauvegarde `state.json` ;
- un stockage fichiers `uploads` ;
- un disque persistant.

## Étapes

1. Créer un dépôt GitHub avec le contenu du dossier `btp-rentabilite-prototype`.
2. Aller sur Render.
3. Créer un nouveau `Blueprint`.
4. Sélectionner le dépôt GitHub.
5. Render détecte `render.yaml`.
6. Renseigner la variable secrète :

```text
NOVA_AUTH_PASSWORD=un-mot-de-passe-solide
```

7. Lancer le déploiement.

Render fournira une URL du type :

```text
https://nova-plus-btp.onrender.com
```

## Nom de domaine

Une fois l'URL Render créée :

1. Acheter ou utiliser un domaine existant.
2. Créer un sous-domaine, par exemple :

```text
app.client-btp.fr
```

3. Dans Render, ajouter ce custom domain.
4. Chez le registrar, créer le DNS demandé par Render.
5. Attendre la validation HTTPS.

## Variables importantes

```text
PORT=4173
DATA_DIR=/var/data/nova
NOVA_AUTH_PASSWORD=mot-de-passe
```

Sur Render, `PORT` est géré automatiquement. Ne pas le définir sauf besoin particulier.

## Données sauvegardées

En production Render :

```text
/var/data/nova/state.json
/var/data/nova/uploads
```

Ces données sont sur le disque persistant configuré dans `render.yaml`.

## Limite de cette V1 exploitable

Cette version est exploitable pour un client unique ou une petite équipe avec mot de passe partagé.

Pour une vraie version SaaS multi-clients, il faudra ensuite :

- comptes utilisateurs ;
- base PostgreSQL ;
- stockage objet S3/Supabase ;
- droits par entreprise ;
- sauvegardes automatisées ;
- logs et monitoring.
