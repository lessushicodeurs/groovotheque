# Epic 09 — Téléchargement des pistes

## Objectif
Permettre le téléchargement des fichiers audio d'un groove : piste par piste ou toutes les pistes en une archive zip.

## Dépendances
- Epic 03 complet (player multipiste, `buildTrackRow`, API grooves)

## Décisions de conception

| Sujet | Décision |
|---|---|
| Téléchargement d'une piste | Balise `<a download>` sur l'URL audio existante (same-origin) |
| Téléchargement du zip | Nouvel endpoint serveur — génération côté serveur avec `archiver` |
| Noms de fichiers dans le zip | Noms originaux (ex: `01_kick.wav`) — préserve le tri et les extensions |
| Nom du fichier zip | `{slug}.zip` (ex: `afro-beat.zip`) |
| Contenu du zip | Pistes audio + fichier markdown si présent |
| Indicateur de chargement | Bouton zip désactivé + texte "Préparation…" pendant la génération |

## Stories

### 9.1 — Bouton de téléchargement par piste

Dans `buildTrackRow()` (`player.js`) :
- Ajouter un `<a href="{track.url}" download="{track.filename}">` dans `sidebarTop`, après le nom — aucun nouvel endpoint
- Classe `.btn-track-download` (icône `↓`) — voir story 9.4 pour le style
- L'attribut `download` force le téléchargement avec le nom de fichier original

### 9.2 — Endpoint de génération de zip

Nouvel endpoint dans `server.js` :
```
GET /api/grooves/:name/download
```
- Ajouter la dépendance `archiver` v8 (`npm install archiver`)
- Utiliser la classe `ZipArchive` exportée par le module : `const { ZipArchive } = require('archiver')`
- Lire tous les fichiers audio + `.md` du dossier groove, les ajouter à l'archive via `archive.file()`
- Streamer la réponse : `archive.pipe(res)` puis `archive.finalize()`
- Headers : `Content-Type: application/zip`, `Content-Disposition: attachment; filename="{slug}.zip"`
- Réutiliser `resolveGrooveDir()` pour la sécurité (path traversal)
- L'authentification Basic Auth existante couvre cet endpoint automatiquement

### 9.3 — Bouton "Tout télécharger" dans l'en-tête

Dans `player.html` et `player.js` :
- Ajouter `<button id="btn-download-all" class="btn-download-all" hidden>↓ Tout télécharger</button>` dans `<header class="player-header">`, après le `<h1>`
- Le bouton démarre `hidden` ; il est révélé dans `init()` après le chargement réussi des pistes
- Au clic : désactiver le bouton, changer son texte en "Préparation…"
- Déclencher le téléchargement via un `<a>` créé dynamiquement, href = `/api/grooves/${encodeURIComponent(slug)}/download`, ajouté au DOM, `.click()`, puis retiré
- Re-activer le bouton via `setTimeout(..., 2000)` — délai arbitraire pour laisser le navigateur initier le téléchargement avant de rendre le bouton disponible

### 9.4 — Style des boutons de téléchargement

Dans `style.css` :
- `.btn-download-all` : bouton discret dans le header (fond `#1c1c1c`, bordure `#2a2a2a`, texte `#666`) — s'éclaircit au hover, grisé à l'état `:disabled`
- `.btn-track-download` : lien-bouton carré `1.5rem` sans fond, même famille visuelle que les boutons M/S de la sidebar — s'éclaircit au hover

## Notes d'implémentation

- `archiver` v8 est un module ESM pur (`"type": "module"`). L'import via `require()` fonctionne sous Node.js ≥ 22.12 (require() de modules ESM stable depuis cette version) ; vérifier la compatibilité de l'environnement cible.
- `archiver` supporte le streaming natif (`archive.pipe(res)`), pas besoin de buffer intermédiaire — important pour les gros grooves.
- `Content-Length` ne peut pas être connu à l'avance avec le streaming — le client verra un téléchargement sans taille estimée, comportement standard.
- En cas d'erreur pendant la génération du zip (après envoi des headers), le client reçoit un zip corrompu sans message d'erreur — limitation inhérente au streaming HTTP.

## Critères d'acceptance

- Cliquer sur le bouton de téléchargement d'une piste déclenche le téléchargement du fichier avec son nom original
- Cliquer sur "Télécharger tout" télécharge un zip nommé `{slug}.zip` contenant toutes les pistes audio et le markdown
- Le bouton "Télécharger tout" est absent jusqu'au chargement des pistes, puis reste désactivé pendant la préparation
- Le zip est valide et s'ouvre correctement
- La route `/api/grooves/:name/download` est protégée par Basic Auth (comportement hérité)
- Aucun path traversal possible (validation via `resolveGrooveDir`)
