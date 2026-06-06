# Epic 10 — Loader de chargement audio

## Objectif

Afficher un indicateur de progression clair pendant le chargement des fichiers audio, couvrant les deux phases : fetch API et initialisation WaveSurfer. Empêcher toute interaction prématurée avec l'interface.

## Dépendances

- Epic 03 complet (player multipiste, events WaveSurfer)

## Contexte technique

Actuellement, le message `<p id="player-state">Chargement des pistes…</p>` est supprimé (`stateEl.remove()`) dès que la réponse API revient — soit après quelques dizaines de ms — alors que WaveSurfer n'a pas encore décodé l'audio. L'utilisateur se retrouve face à une interface muette, sans retour de progression, pendant plusieurs secondes.

Le chargement se déroule en deux phases :
1. **Fetch API** — durée inconnue, nombre de pistes non encore connu
2. **WaveSurfer ready** — un event `ready` par piste, chargement parallèle (ordre non garanti)

Les couleurs des pistes sont déjà définies dans `TRACK_COLORS` (`player.js`) et assignées cycliquement par index.

## Comportement attendu

### Phase 1 — Fetch API (durée indéterminée)
- Une barre fine (3px) en haut de page est visible dès l'ouverture
- Elle joue une animation shimmer/pulse sur toute sa largeur (progression indéterminée)
- Le `<main>` est recouvert d'un overlay (blur léger + opacité réduite) avec `pointer-events: none`

### Phase 2 — WaveSurfer (progression réelle)
- Dès que le nombre de pistes est connu (réponse API reçue), la barre passe en mode segmenté
- La barre est divisée en N segments égaux, un par piste
- Chaque segment s'allume à sa position fixe dès que la piste correspondante émet `ready`
- Les segments peuvent s'allumer dans le désordre (trous temporaires = comportement normal)
- La couleur de chaque segment = `TRACK_COLORS[idx % TRACK_COLORS.length]` de la piste correspondante
- La transition entre les couleurs des segments est douce (dégradé CSS, pas de coupure brutale)

### Fin de chargement
- Quand tous les segments sont remplis (toutes les pistes `ready` ou `error`), l'overlay sur `<main>` disparaît en fondu (~300ms)
- La barre de progression disparaît également en fondu

### Erreur de piste
- Si WaveSurfer émet `error` sur une piste, son segment s'affiche en `#c44` (couleur d'erreur du projet)
- Ce segment compte comme "chargé" : la session continue normalement avec les autres pistes

## Stories

### 10.1 — Barre de progression HTML/CSS
- Ajout d'un élément `<div id="load-bar">` dans `player.html`, positionné en haut de page (`position: fixed`, `top: 0`, `left: 0`, hauteur 3px, `z-index` élevé)
- État indéterminé : animation CSS shimmer (dégradé animé sur toute la largeur)
- État segmenté : segments positionnés en `absolute` à l'intérieur de la barre, colorés dynamiquement via JS
- Transitions douces sur les couleurs et la largeur des segments
- `role="progressbar"`, `aria-label="Chargement des pistes"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` mis à jour à chaque `ready`

### 10.2 — Overlay sur `<main>`
- Ajout d'une classe CSS `.loading` sur `<main id="player-main">` pendant le chargement
- `.loading` applique : `filter: blur(Xpx)` + `opacity: 0.4` + `pointer-events: none`
- Valeurs de blur et d'opacité à ajuster visuellement (point de départ : `blur(3px)`, `opacity: 0.4`)
- Retrait de la classe `.loading` déclenche la transition de fondu via CSS (`transition: opacity 300ms, filter 300ms`)

### 10.3 — Logique de progression dans `player.js`
- Suppression de `stateEl.remove()` au profit du nouveau système
- Après la réponse API : passage de la barre en mode segmenté, initialisation des N segments grisés
- Sur chaque `ready` WaveSurfer : allumer le segment `idx` avec `TRACK_COLORS[idx % TRACK_COLORS.length]`, mettre à jour `aria-valuenow`
- Sur chaque `error` WaveSurfer : allumer le segment `idx` en `#c44`
- Quand le compteur de pistes chargées = N : retirer `.loading` sur `<main>`, masquer la barre

### 10.4 — Suppression du texte de chargement
- Retrait du `<p id="player-state">Chargement des pistes…</p>` du HTML
- Adapter les references JS à `stateEl` (garder uniquement le cas d'erreur fatale : groove non spécifié, aucune piste)

## Critères d'acceptance

- Dès l'ouverture de la page, une barre animée est visible et le contenu est flouté/grisé
- La barre segmentée s'affiche dès que le nombre de pistes est connu
- Les segments apparaissent dans le désordre (selon l'ordre de chargement réel)
- Chaque segment a la couleur de sa piste WaveSurfer correspondante
- Une piste en erreur affiche un segment rouge, sans bloquer le reste
- L'overlay disparaît en fondu (~300ms) une fois toutes les pistes chargées
- Le bouton retour "←" reste cliquable pendant tout le chargement
- `role="progressbar"` présent avec `aria-valuenow` mis à jour
