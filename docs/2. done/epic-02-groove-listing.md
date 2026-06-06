# Epic 02 — Listing des titres

## Objectif
Scanner le dossier `grooves/`, exposer les données via API REST et afficher le listing avec tooltip markdown.

## Stories

### 2.1 — API GET /api/grooves
- Scan de `./grooves/` avec `fs.readdir`
- Pour chaque sous-dossier :
  - Nom du titre (dossier → remplacer `-` et `_` par espaces, capitaliser)
  - Slug (nom du dossier, tel quel)
  - Présence d'un fichier `.md` (boolean + chemin)
- Réponse JSON triée alphabétiquement par nom

### 2.2 — API GET /api/grooves/:name
- Lecture du dossier `grooves/:name/`
- Liste des fichiers audio (`.mp3`, `.wav`, `.flac`)
- Tri : préfixe numérique si présent, alphabétique sinon
- Pour chaque piste :
  - `index` (position)
  - `filename` (nom brut)
  - `displayName` (nom nettoyé : sans préfixe numérique, sans extension)
  - `url` : `/audio/:name/:filename`
- Contenu du `.md` lu et retourné brut (sera rendu côté client)

### 2.3 — Endpoint audio stream
- Route `GET /audio/:groove/:file`
- Validation du chemin (pas de path traversal : vérifier que le fichier résolu est bien dans `./grooves/`)
- Support des range requests (HTTP 206) via `express.static` ou pipe manuel
- Headers `Content-Type` corrects selon l'extension

### 2.4 — Page d'accueil HTML
- `public/index.html` : layout de base dark
- Liste des titres chargée via `fetch('/api/grooves')`
- Chaque titre : card ou ligne avec nom
- Au survol : tooltip avec markdown rendu (`marked.parse()`)
- Clic → navigation vers `player.html?groove=slug` (ou ouverture modale)

### 2.5 — Rendu markdown dans le tooltip
- `marked` chargé via CDN (ESM)
- Tooltip positionné intelligemment (ne pas sortir du viewport)
- Fermeture au mouseout
- Style : fond dark semi-transparent, texte clair, max-width 400px

## Critères d'acceptance
- `/api/grooves` retourne la liste correcte des dossiers
- `/api/grooves/sample-title` retourne les pistes triées avec les bons displayNames
- `/audio/sample-title/01-basse.wav` streame correctement (vérifiable dans `<audio>` natif)
- Le listing s'affiche dans le browser
- Le tooltip apparaît au survol et affiche le markdown rendu
