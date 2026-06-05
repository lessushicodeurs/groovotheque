# Epic 04 — Transport et contrôles de lecture

## Objectif
Implémenter la barre de transport globale : play/pause/stop, position, durée, et loop region.

## Dépendances
- Epic 03 complet (player multipiste)

## Stories

### 4.1 — Barre de transport globale
Barre fixe en bas de l'écran (ou en haut du player) avec :
- Bouton **Play / Pause** (toggle)
- Bouton **Stop** (retour à 0 + pause)
- Affichage **position courante** en `mm:ss.ms`
- Affichage **durée totale** (durée de la piste la plus longue)
- Barre de progression cliquable (seek)

### 4.2 — Synchronisation des pistes
- La lecture est pilotée par le Multitrack plugin (une seule source de temps)
- Toutes les pistes démarrent et s'arrêtent simultanément
- La position est synchronisée sur tous les WaveSurfer

### 4.3 — Régions de loop (plugin Regions)
- Activation du plugin Regions sur chaque WaveSurfer
- Création de région par cliquer-glisser sur n'importe quelle waveform
- Une seule région active à la fois (la création d'une nouvelle efface la précédente)
- La région est visuellement identique sur toutes les pistes (synchronisée)
- Couleur : blanc à 20% d'opacité

### 4.4 — Contrôles IN / OUT
- Affichage des valeurs IN et OUT de la région active (format `mm:ss.ss`)
- Champs éditables : modifier la valeur → met à jour la région
- Bouton **Loop ON/OFF** : active/désactive la boucle sur la région
- Quand loop actif : la lecture reboucle entre IN et OUT

### 4.5 — Keyboard shortcuts
- `Space` : Play / Pause
- `Escape` : Stop
- `L` : Toggle loop
- `←` / `→` : -1s / +1s (nudge position)

## Critères d'acceptance
- Play/Pause/Stop fonctionnent et sont synchronisés sur toutes les pistes
- La position s'affiche en temps réel et est cliquable pour seeker
- On peut créer une région par drag, les valeurs IN/OUT s'affichent
- La boucle reboucle précisément entre IN et OUT
- Les raccourcis clavier fonctionnent
