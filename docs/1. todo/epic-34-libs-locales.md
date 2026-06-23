# Epic 34 — Rapatrier WaveSurfer et AlphaTab en local

## Objectif

WaveSurfer (4 modules) est actuellement chargé depuis `unpkg.com` et AlphaTab depuis `jsdelivr.net`, sans vérification d'intégrité (SRI). Ces dépendances CDN rendent l'app inutilisable hors connexion (usage courant en salle de répétition) et exposent à un risque de supply chain : si le CDN sert une version compromise, le code s'exécute dans la page avec accès complet au DOM et aux requêtes serveur.

La solution retenue est d'ajouter ces libs dans `package.json` et de les exposer via des routes serveur, sans build step — exactement comme `marked` est déjà servi depuis `node_modules/`.

## Dépendances

- *(aucune)*

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Mécanisme de serving | Routes Express vers `node_modules/`, comme `marked` |
| Build step | Aucun — pas de bundler, pas de compilation |
| WaveSurfer | 4 routes : core + plugins timeline, hover, regions |
| AlphaTab | Route statique sur le dossier `dist/` entier (worker + fonts + soundfont) |
| Versions | Pinées à la version exacte actuellement en CDN (`wavesurfer.js@7`, `@coderline/alphatab@1.8.3`) |
| URLs frontend | Inchangées (même chemin, juste servies localement) — pas de modification dans `player.js` sauf le `import` |

---

## Stories

### 34.1 — WaveSurfer via node_modules

Installer `wavesurfer.js` dans `package.json` et exposer les 4 modules via des routes Express.

- `npm install wavesurfer.js@7` (version exacte)
- Ajouter dans `server.js` 4 routes pointant vers les fichiers ESM dans `node_modules/wavesurfer.js/dist/` :
  - `GET /vendor/wavesurfer.esm.js`
  - `GET /vendor/plugins/timeline.esm.js`
  - `GET /vendor/plugins/hover.esm.js`
  - `GET /vendor/plugins/regions.esm.js`
- Mettre à jour les 4 `import` dans `player.js` pour pointer vers `/vendor/...` au lieu de `https://unpkg.com/...`

### 34.2 — AlphaTab via node_modules

Installer `@coderline/alphatab` dans `package.json` et exposer son dossier `dist/` entier via une route statique.

- `npm install @coderline/alphatab@1.8.3`
- AlphaTab charge dynamiquement son worker, ses fonts et son soundfont depuis `AT_BASE` — il faut exposer tout le dossier `dist/` :
  - `app.use('/vendor/alphatab', express.static(path.join(__dirname, 'node_modules/@coderline/alphatab/dist')))`
- Mettre à jour `AT_BASE` dans `player.js` pour pointer vers `/vendor/alphatab` au lieu de `https://cdn.jsdelivr.net/...`
- Vérifier que le worker (`alphaTab.worker.mjs`), les fonts et le soundfont (`sonivox.sf2`) se chargent bien depuis le nouveau chemin

### 34.3 — Nettoyage et vérification offline

- Supprimer la constante `AT_BASE` qui incluait l'URL CDN et la remplacer par le chemin local
- Vérifier le fonctionnement sans connexion internet (couper le réseau, recharger l'app)
- S'assurer que WaveSurfer et AlphaTab se chargent et fonctionnent normalement
- Vérifier que `marked` n'est pas cassé au passage

---

## Critères d'acceptance

- [ ] L'app se charge et fonctionne sans connexion internet
- [ ] Les waveforms s'affichent et la lecture audio fonctionne (WaveSurfer)
- [ ] Les plugins timeline, hover et regions fonctionnent
- [ ] La tablature s'affiche sur un groove avec fichier `.gp` (AlphaTab)
- [ ] Le worker AlphaTab, les fonts et le soundfont se chargent sans erreur 404
- [ ] Aucune requête vers `unpkg.com` ou `jsdelivr.net` dans l'onglet Réseau du devtools
- [ ] `marked` continue de fonctionner (rendu markdown dans les commentaires)
