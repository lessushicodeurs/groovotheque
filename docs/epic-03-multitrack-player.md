# Epic 03 — Player multipiste

## Objectif
Implémenter le player wavesurfer.js multipiste avec tous les plugins, les contrôles par piste et le thème dark.

## Dépendances
- Epic 02 complet (API grooves + stream audio)

## Stories

### 3.1 — Setup wavesurfer.js Multitrack
- `player.html` (ou modale dans `index.html`)
- Chargement wavesurfer.js v7 via CDN (ESM)
- Plugin Multitrack : un WaveSurfer par piste, AudioContext partagé
- Chaque piste charge son URL `/audio/:groove/:file`
- Couleurs par piste : palette de 8 couleurs saturées sur fond dark

### 3.2 — Plugin Timeline
- Affichage de la règle temporelle au-dessus des waveforms
- Timecode en mm:ss

### 3.3 — Plugin Minimap
- Vue d'ensemble condensée en bas du player
- Même couleur que la piste principale

### 3.4 — Plugin Hover
- Curseur vertical suivant la souris avec timecode au survol
- Appliqué à chaque piste

### 3.5 — Contrôles par piste
Chaque piste dispose d'une sidebar gauche avec :
- Nom de la piste (`displayName`)
- Bouton **Mute** (toggle, état visuel distinct)
- Bouton **Solo** (mute toutes les autres pistes)
- Slider **Volume** (0 → 100%, défaut 100%)
- Indicateur de couleur de la piste

### 3.6 — Responsive layout
- Desktop (≥1024px) : sidebar piste + waveform côte à côte
- Tablette (768-1023px) : sidebar réduite (icônes + nom court)
- Mobile (<768px) : sidebar minimaliste (mute + nom), waveform pleine largeur, scroll vertical entre pistes

## Critères d'acceptance
- Toutes les pistes se chargent et s'affichent avec leur waveform
- La couleur de chaque piste est unique et cohérente (sidebar + waveform)
- Mute / Solo fonctionnent correctement
- Le volume slider affecte la piste en temps réel
- L'affichage est utilisable sur mobile (Samsung Galaxy S, iPhone 12)
