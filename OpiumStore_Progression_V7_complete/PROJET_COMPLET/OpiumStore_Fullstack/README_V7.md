# OpiumStore Progression V7

Cette version ajoute le système complet de progression : XP, niveaux, séries quotidiennes, missions, inventaire, coffres, tickets de roue, boosts XP, classements, événements communautaires et codes promos.

## Projet existant

Depuis le dossier `worker` :

```powershell
npx wrangler d1 execute opium-store-db --remote --file=.\migration_v7.sql
npm install
npm run deploy
```

Déploie ensuite le dossier `frontend` sur Cloudflare Pages ou pousse-le sur le dépôt Git relié à Pages.

## Nouvelle base D1

Applique `worker/schema_v7_full.sql` sur une base vide, puis configure les variables et secrets indiqués dans `DEPLOIEMENT.md`.

## Code promo initial

`OPIUM2026` donne 250 points, 150 XP et un coffre commun, avec une limite initiale de 500 utilisations.
