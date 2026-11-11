# Nova+ sur Railway : mise en production du socle 2.0

Ce document remplace l'ancienne procédure (mot de passe commun `NOVA_AUTH_PASSWORD`, données dans `state.json`).

## Ce qui change

| Avant | Socle 2.0 |
| --- | --- |
| Un mot de passe partagé par toute l'équipe | Un compte par personne, avec un rôle (administrateur, direction commerciale, commercial, chargé de projet, secrétariat, comptabilité) |
| Aucune double authentification | 2FA obligatoire pour l'administrateur et le secrétariat |
| `state.json` réécrit en entier à chaque modification ; deux postes pouvaient s'écraser | PostgreSQL, données versionnées : un poste en retard est bloqué au lieu d'écraser |
| Aucun historique | Chaque enregistrement est conservé 48 h, puis une version par jour pendant 90 jours, restaurable |
| Aucune sauvegarde applicative | Sauvegarde quotidienne automatique (30 conservées), test de restauration, téléchargement |
| Pièces jointes perdues si le volume n'était pas monté (30/09/2026) | Démarrage en échec si le stockage n'est pas persistant ; le déploiement est refusé et l'ancienne version reste en ligne |
| Aucune traçabilité | Journal des connexions, comptes, conflits, restaurations et sauvegardes |
| Devis seulement importés en PDF | Module Devis et marges : bibliothèque, grilles ST signées, devis, signature, bons de commande, PV ; il ajoute des chantiers sans modifier les existants |

## Variables d'environnement du service Nova+

| Variable | Valeur | Obligatoire |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (référence au service PostgreSQL, réseau privé) | Oui |
| `DATA_DIR` | **Ne pas changer la valeur existante** : le dossier du volume qui contient déjà `state.json` et `uploads/` (par exemple `/data/nova`). Une autre valeur ferait démarrer Nova+ sur un dossier vide. | Oui |
| `NOVA_SECRET_KEY` | Chaîne aléatoire d'au moins 32 caractères, à conserver dans un gestionnaire de mots de passe | Oui |
| `NODE_ENV` | `production` | Oui |
| `NOVA_ADMIN_EMAIL` | E-mail du premier administrateur | Au premier démarrage seulement |
| `NOVA_ADMIN_PASSWORD` | Mot de passe provisoire (12 caractères minimum), à changer à la première connexion | Au premier démarrage seulement |
| `NOVA_ADMIN_NAME` | Nom affiché du premier administrateur | Non |
| `NOVA_COMPANY_NAME` | Raison sociale pré-remplie au premier démarrage (ensuite : Administration › Entreprise) | Non |
| `NOVA_AUTH_PASSWORD` | N'est plus utilisée par le socle 2.0. **La garder tant qu'un retour arrière reste possible** (l'ancienne version en a besoin), puis la supprimer | — |
| `META_APP_SECRET` | Clé secrète de l'application Meta (vérifie la signature des webhooks) | Pour les leads Meta |
| `META_VERIFY_TOKEN` | Chaîne aléatoire choisie, recopiée dans Meta à l'abonnement du webhook | Pour les leads Meta |
| `META_PAGE_ACCESS_TOKEN` | Jeton d'accès de page longue durée (droit `leads_retrieval`) ; sans lui les leads arrivent incomplets | Pour les leads Meta |
| `META_GRAPH_VERSION` | Version de l'API Graph, `v23.0` par défaut | Non |
| `NOVA_GOOGLE_LEADS_KEY` | Clé aléatoire, recopiée dans le webhook du formulaire Google Ads | Pour les leads Google |
| `NOVA_WEBSITE_LEADS_KEY` | Clé aléatoire, envoyée par le site WordPress dans l'en-tête `X-Nova-Key` | Pour le formulaire du site |

`NOVA_SECRET_KEY` chiffre les secrets de double authentification. Si elle est perdue, chaque utilisateur devra reconfigurer sa 2FA (`npm run user -- reset-2fa --email …`), sans perte de données.

Railway fournit `PORT` et `RAILWAY_VOLUME_MOUNT_PATH` automatiquement : ne pas les définir.

## Procédure de mise en production

Rien n'est supprimé au cours de la migration : `state.json` et `uploads/` restent sur le volume.

### 1. Sauvegarder avant tout

1. Railway › service Nova+ › onglet **Backups** du volume › **Create backup**.
2. Noter l'heure et le commit actuellement déployé (onglet Deployments).

### 2. Répétition sur un environnement de test

1. Railway › **New environment** › `staging`, dupliqué depuis `production`.
2. Y copier un `state.json` et le dossier `uploads/` de production (Railway › volume › fichiers, ou `railway ssh`).
3. Ajouter un service **PostgreSQL** dans `staging`, puis les variables ci-dessus.
4. Déployer la branche `feature/socle-v2` sur `staging`.
5. Contrôler les points de l'étape 4. Le passage en production n'a lieu que si tout est vert.
   Les webhooks de leads se testent sur `staging` avec ses propres clés (outil de test des leads Meta, bouton « Envoyer des données test » de Google Ads), jamais avec les clés de production.
6. Module Devis (migration `003_devis_v1`, dépendance `pdfkit`) : sur `staging`, importer la bibliothèque, créer une grille signée, faire un devis, le signer sur une tablette, puis vérifier dans le suivi que le nouveau chantier apparaît et que **les chantiers existants sont inchangés** (nombre, montants, échéanciers).

7. Module commercial (migration `004_crm_v2`, aucune donnée existante modifiée) : créer un lead au téléphone, le passer d'étape, créer son dossier et son devis, vérifier qu'à la signature le lead passe en « Signé » ; saisir des frais fixes et contrôler la jauge avec un compte commercial (il ne doit voir ni les frais fixes ni les commissions des autres).

### 3. Production

1. Ajouter un service **PostgreSQL** au projet. Railway › Postgres › **Backups** : activer les sauvegardes planifiées quotidiennes.
2. Activer aussi les sauvegardes planifiées du volume Nova+.
3. Service Nova+ : ajouter `DATABASE_URL`, `NOVA_SECRET_KEY`, `NOVA_ADMIN_EMAIL`, `NOVA_ADMIN_PASSWORD` sans redéployer (`railway variables … --skip-deploys`). Garder `DATA_DIR` et `NOVA_AUTH_PASSWORD` tels quels.
4. Fusionner `feature/socle-v2` dans `main` (ou déployer la branche).
5. Au premier démarrage, Nova+ :
   - crée les tables ;
   - vérifie que `/data` est bien dans le volume persistant ;
   - importe `state.json` dans PostgreSQL, relit les données et compare leur empreinte (annulation au moindre écart) ;
   - recense les pièces jointes de `uploads/` ;
   - crée le premier administrateur.

   Les journaux affichent : `[import] state.json repris dans PostgreSQL : N chantiers, empreinte vérifiée.`

### 4. Contrôles après déploiement

1. `https://URL/api/health` répond `"ok": true`. Une réponse 503 signale un problème de stockage : lire le message, rien n'a été importé.
2. Se connecter avec `NOVA_ADMIN_EMAIL`, activer la 2FA et choisir un vrai mot de passe.
3. **Supprimer `NOVA_ADMIN_PASSWORD` des variables Railway.**
4. Compte › **Sécurité des données** :
   - le nombre de chantiers est le même qu'avant ; contrôle détaillé dans le terminal du service : `npm run verify:chantiers` ;
   - **Vérifier les pièces jointes** : aucun fichier manquant, en dehors des 32 fichiers déjà perdus le 30/09 tant que la cliente ne les a pas renvoyés ;
   - **Sauvegarder maintenant**, puis **Tester la restauration** : le test doit réussir.
5. Compte › **Entreprise** : compléter SIRET, adresse, assurance décennale, RGE le cas échéant, logo ; vérifier l'échéancier et la TVA par défaut.
6. Compte › **Équipe** : créer un compte par personne et transmettre chaque mot de passe temporaire de vive voix ou par SMS.
7. Ouvrir 2 ou 3 chantiers et contrôler montants, lots, échéanciers et documents.

### Retour arrière

Procédure répétée sur `staging` le 11/11/2026 (nouvelle version → ancienne → nouvelle) : aucune saisie ni pièce jointe perdue.

Si un problème bloquant apparaît après la mise en production :

1. Ouvrir un terminal sur le service (`railway ssh`), puis exporter les données saisies depuis la migration vers `state.json` du dossier de données (une copie de l'ancien fichier est conservée à côté) :
   ```bash
   npm run export:json -- --file "$DATA_DIR/state.json" --overwrite
   ```
2. Redéployer l'ancien déploiement dans Railway › Deployments › **Redeploy**. Il relit `state.json` et `uploads/` : les chantiers, devis signés et pièces jointes ajoutés entre-temps y sont.
3. `NOVA_AUTH_PASSWORD` doit encore être présent (voir les variables).

Les modules Devis et commercial (devis, leads, objectifs) n'existent pas dans l'ancienne version : leurs données restent dans PostgreSQL, intactes, et réapparaissent à la bascule suivante.

### Nouvelle bascule après un retour arrière

L'import initial ne se rejoue pas : la base connaît déjà les données. Ce qui a été saisi dans l'ancienne version se reprend ainsi, après le redéploiement de la nouvelle version :

```bash
npm run import:json -- --resync            # simulation : chantiers ajoutés, modifiés, supprimés
npm run import:json -- --resync --apply    # enregistre state.json comme nouvelle version
npm run verify:chantiers
```

La version précédente reste dans l'historique (Compte › Sécurité des données › Historique). Une reprise qui supprimerait plus d'un chantier est refusée. Les pièces jointes déposées dans l'ancienne version sont recensées automatiquement au démarrage.

### Modifications restées dans un navigateur

L'ancienne version gardait une copie des données dans chaque navigateur. Au premier chargement de la nouvelle version, si cette copie diffère des données du serveur (un envoi qui avait échoué), elle est mise de côté dans le navigateur sous la clé `nova-plus-copie-navigateur-avant-migration`. Elle n'est jamais renvoyée automatiquement : la récupérer depuis les outils de développement du navigateur si un utilisateur signale une saisie manquante.

## Leads : brancher Meta, Google Ads et le site

L'écran Objectifs et réglages › **Branchements des formulaires** (administrateur) donne les adresses exactes et l'état de chaque branchement. Les clés ne sont jamais saisies dans l'application : uniquement dans les variables Railway.

### Meta Lead Ads (Facebook / Instagram)

1. developers.facebook.com › l'application de l'entreprise › **Webhooks** › objet **Page** › champ `leadgen`.
2. URL de rappel : `https://URL/api/hooks/meta` ; jeton de vérification : la valeur de `META_VERIFY_TOKEN`.
3. Abonner la page Facebook à l'application, puis générer un jeton de page longue durée avec le droit `leads_retrieval` → `META_PAGE_ACCESS_TOKEN`. Clé secrète de l'application → `META_APP_SECRET`.
4. Tester avec l'outil de test des leads de Meta : le lead apparaît dans « Nouveau » avec la campagne et l'annonce.

### Google Ads (formulaires de lead)

1. Google Ads › Composant formulaire de lead › **Intégration du webhook**.
2. URL : `https://URL/api/hooks/google` ; clé : la valeur de `NOVA_GOOGLE_LEADS_KEY`.
3. « Envoyer des données test » : le lead arrive marqué « Lead de test » (exclu des statistiques).

### Site WordPress

Le formulaire est transmis par le serveur WordPress, jamais par le navigateur du visiteur (la clé resterait visible). Exemple pour Contact Form 7, à placer dans le `functions.php` du thème enfant ou un petit plugin :

```php
add_action('wpcf7_before_send_mail', function ($form) {
  $submission = WPCF7_Submission::get_instance();
  if (!$submission) return;
  $data = $submission->get_posted_data();
  $data['form_name'] = $form->title();
  $data['page_url'] = $submission->get_meta('url');
  wp_remote_post('https://URL/api/hooks/website', [
    'headers' => ['Content-Type' => 'application/json', 'X-Nova-Key' => 'VALEUR_DE_NOVA_WEBSITE_LEADS_KEY'],
    'body' => wp_json_encode($data),
    'timeout' => 8,
  ]);
});
```

Les noms de champs courants sont reconnus (`your-name`, `nom`, `telephone`, `your-email`, `code_postal`, `ville`, `message`, `utm_campaign`…) ; les autres sont gardés dans la fiche du lead. Pour WPForms ou Elementor, envoyer le même corps depuis leur crochet d'envoi (`wpforms_process_complete`, `elementor_pro/forms/new_record`), ou utiliser leur module webhook en ajoutant l'en-tête `X-Nova-Key`.

## Exploitation courante

| Besoin | Où |
| --- | --- |
| Ajouter un collaborateur, changer un rôle, désactiver un départ | Compte › Équipe |
| Téléphone perdu (2FA) | Compte › Équipe › Réinitialiser la 2FA |
| Compte verrouillé après 5 essais | Se débloque seul après 15 min, ou Compte › Équipe › Déverrouiller |
| Revenir à l'état d'hier après une erreur de saisie | Compte › Sécurité des données › Historique › Restaurer |
| Copie de sauvegarde hors serveur | Compte › Sécurité des données › Télécharger, une fois par semaine au minimum |
| Plus aucun administrateur ne peut se connecter | Terminal du service (`railway ssh`) : `npm run user -- reset-password --email …` |

## Accès au compte Railway

Ne pas partager les identifiants du compte Railway. Pour qu'un associé intervienne, l'inviter comme membre du projet (Railway › Project Settings › Members) : chacun garde son propre accès, révocable, et les actions restent traçables.

Les fichiers de sauvegarde contiennent les comptes (mots de passe hachés, secrets 2FA chiffrés) : les stocker comme des documents confidentiels.
