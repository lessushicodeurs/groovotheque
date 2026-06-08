# Epic 07 — Responsive & UX mobile

## Objectif
Rendre l'intégralité de l'interface utilisable sur mobile et tablette, avec une attention particulière au player en répétition.

## Dépendances
- Epics 02, 03, 04 complets

## Breakpoints

| Nom | Largeur | Usage cible |
|---|---|---|
| Mobile | < 768px | Téléphone en répétition |
| Tablette | 768px – 1023px | iPad posé sur un ampli |
| Desktop | ≥ 1024px | Laptop en studio |

## Stories

### 7.1 — Listing responsive
- Mobile : liste verticale pleine largeur, cards avec nom en grand (touch-friendly, min 48px de hauteur)
- Tooltip hover → tap sur mobile (premier tap = affiche tooltip, deuxième tap = ouvre player)
- Tablette : grille 2 colonnes

### 7.2 — Player layout responsive

**Desktop** : layout horizontal
```
[sidebar: nom + contrôles] [waveform pleine largeur]
[transport bar en bas]
```
> La minimap a été décommissionnée (feature peu utile en pratique).

**Tablette** :
```
[sidebar réduite: mute + nom court] [waveform]
[transport bar]
```

**Mobile** :
```
[nom de la piste + mute]
[waveform scrollable]
(répété pour chaque piste, scroll vertical)
[transport bar sticky en bas]
```

### 7.3 — Transport bar responsive
- Desktop : tous les contrôles sur une ligne
- Mobile : deux lignes
  - Ligne 1 : Play/Pause/Stop + position/durée
  - Ligne 2 : Loop IN/OUT + bouton loop
- Slider tempo : pleine largeur sur mobile, presets en scroll horizontal

### 7.4 — Touch interactions
- Wavesurfer régions : touch drag pour créer la région (test sur iOS Safari + Chrome Android)
- Boutons : taille minimale 44×44px
- Sliders : track suffisamment large (≥ 8px) pour être manipulable au doigt
- Pas de hover-only interactions sur mobile

### 7.5 — Performance mobile
- Limiter la résolution des waveforms sur mobile (moins de barres = moins de calcul)
- `pixelRatio` réduit sur petits écrans si nécessaire
- Pas d'animations coûteuses (pas de box-shadow animé, etc.)

## Critères d'acceptance
- Sur Chrome Android (Galaxy S21) : listing lisible, tap ouvre le player, play/pause fonctionne
- Sur Safari iOS (iPhone 12) : idem + vérification de l'AudioContext (doit être démarré sur interaction utilisateur)
- Sur iPad : layout tablette actif, waveforms confortables
- Pas de scroll horizontal inattendu sur mobile
- Transport bar toujours accessible sans scroll
