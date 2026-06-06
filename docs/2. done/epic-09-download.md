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
- Ajouter un bouton/lien icône téléchargement dans la sidebar de chaque piste, à droite du nom
- Implémenté avec `<a href="{track.url}" download="{track.filename}">` — aucun nouvel endpoint
- Style cohérent avec les boutons M/S existants (icône `↓` ou SVG download)
- L'attribut `download` force le téléchargement du fichier avec son nom original

### 9.2 — Endpoint de génération de zip

Nouvel endpoint dans `server.js` :
```
GET /api/grooves/:name/download
```
- Ajouter la dépendance `archiver` (`npm install archiver`)
- Lire tous les fichiers audio + `.md` du dossier groove
- Créer une archive zip avec `archiver` et la streamer directement dans la réponse
- Headers : `Content-Type: application/zip`, `Content-Disposition: attachment; filename="{slug}.zip"`
- Réutiliser `resolveGrooveDir()` pour la sécurité (path traversal)
- L'authentification Basic Auth existante couvre cet endpoint automatiquement

### 9.3 — Bouton "Tout télécharger" dans l'en-tête

Dans `player.html` et `player.js` :
- Ajouter un bouton "Télécharger tout" dans le `<header class="player-header">`, à côté du `<h1 id="groove-title">`
- Au clic : désactiver le bouton, changer son texte en "Préparation…"
- Déclencher le téléchargement via `<a>` créé dynamiquement pointant sur `/api/grooves/{slug}/download`
- Re-activer le bouton après déclenchement (l'événement `click` sur le lien suffit — pas besoin d'attendre la fin du stream)

## Notes d'implémentation

- `archiver` supporte le streaming natif (`archive.pipe(res)`), pas besoin de buffer intermédiaire — important pour les gros grooves.
- La génération du zip est bloquante pour la requête : si le groove est très lourd, envisager un timeout Express adapté.
- `Content-Length` ne peut pas être connu à l'avance avec le streaming — le client verra un téléchargement sans taille estimée, comportement standard.

## Critères d'acceptance

- Cliquer sur le bouton de téléchargement d'une piste déclenche le téléchargement du fichier avec son nom original
- Cliquer sur "Télécharger tout" télécharge un zip nommé `{slug}.zip` contenant toutes les pistes audio et le markdown
- Le bouton "Télécharger tout" est désactivé et affiche "Préparation…" pendant l'attente
- Le zip est valide et s'ouvre correctement
- La route `/api/grooves/:name/download` est protégée par Basic Auth (comportement hérité)
- Aucun path traversal possible (validation via `resolveGrooveDir`)
