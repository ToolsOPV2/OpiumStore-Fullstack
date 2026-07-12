# Déploiement gratuit — OpiumStore Hub

Architecture :

- `frontend/` : site statique hébergé gratuitement sur Render. Il ne se met pas en veille.
- `worker/` : API Cloudflare Worker + base D1 pour Discord, les points, les cooldowns et les stocks FIFO.
- Les lignes de stock sont chiffrées en AES-GCM avant leur écriture dans D1.

## 1. Créer l’application Discord

1. Ouvre le Discord Developer Portal et crée une application.
2. Dans **OAuth2**, ajoute cette Redirect URL :

   `https://NOM-DU-WORKER.TON-SOUS-DOMAINE.workers.dev/auth/discord/callback`

3. Copie le **Client ID** et le **Client Secret**.
4. Active uniquement le scope `identify` : aucun bot n’est nécessaire.
5. Récupère ton propre Discord User ID avec le mode développeur Discord. Il servira pour `ADMIN_DISCORD_IDS`.

## 2. Déployer l’API Cloudflare et D1

Dans le dossier `worker` :

```bash
npm install
npx wrangler login
npx wrangler d1 create opiumstore-db
```

Copie le `database_id` retourné dans `worker/wrangler.toml`.

Modifie aussi dans `wrangler.toml` :

- `FRONTEND_ORIGIN` avec l’URL finale Render ;
- `DISCORD_REDIRECT_URI` avec l’URL du Worker ;
- `ADMIN_DISCORD_IDS` avec ton Discord ID. Plusieurs admins : `ID1,ID2`.

Crée une clé de chiffrement de 32 octets :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Ajoute les secrets :

```bash
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put ENCRYPTION_KEY
```

Initialise la base puis déploie :

```bash
npm run db:remote
npm run deploy
```

## 3. Configurer le frontend

Dans `frontend/config.js`, remplace :

```js
API_BASE: "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
```

par l’URL réelle du Worker.

## 4. Mettre le site sur Render

1. Envoie tout le projet sur un dépôt GitHub.
2. Sur Render : **New > Static Site**.
3. Sélectionne le dépôt.
4. Root Directory : `frontend`
5. Build Command : vide
6. Publish Directory : `.`
7. Déploie.

Après le premier déploiement, recopie l’URL exacte `https://...onrender.com` dans `FRONTEND_ORIGIN` du fichier `wrangler.toml`, puis relance :

```bash
npm run deploy
```

## 5. Fonctionnement FIFO

- L’admin colle les lignes dans l’ordre, une par ligne.
- La base leur attribue des identifiants croissants.
- Une génération ou un achat supprime atomiquement la plus ancienne ligne disponible.
- La ligne 1 va donc au premier utilisateur, la ligne 2 au suivant, etc.
- Les lignes livrées restent dans le Wallet du compte Discord.

## Sécurité importante

Utilise uniquement des codes, licences, coupons ou contenus numériques que tu as le droit de distribuer. Ne place jamais le Client Secret Discord ou la clé de chiffrement dans le dossier `frontend`.
