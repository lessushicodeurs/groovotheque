# Epic 05 — Contrôle de tempo (time stretching)

## Objectif
Permettre de modifier le tempo de lecture de 50% à 120% sans changement de pitch, via SoundTouch.js en AudioWorklet.

## Dépendances
- Epic 03 complet (player multipiste + AudioContext partagé)

## Contexte technique

SoundTouch.js doit être inséré comme nœud de traitement audio dans le graphe Web Audio API de chaque piste. L'intégration avec wavesurfer.js Multitrack nécessite :
1. Un AudioContext partagé entre toutes les pistes
2. Un SoundTouchNode (AudioWorklet) par piste, inséré entre la source et la destination
3. Un ratio de tempo global synchronisé sur tous les nœuds

### Graphe audio cible
```
AudioBufferSourceNode → SoundTouchWorkletNode → GainNode → AudioContext.destination
```

## Stories

### 5.1 — Intégration SoundTouch AudioWorklet
- Chargement de `soundtouch-web` via CDN ou ESM
- Enregistrement du worklet : `audioContext.audioWorklet.addModule('soundtouch-worker.js')`
- Création d'un `SoundTouchNode` par piste au chargement
- Insertion dans le graphe audio de chaque WaveSurfer

### 5.2 — Contrôle de tempo UI
Dans la barre de transport :
- Slider horizontal : 50% → 120%, pas de 1%
- Affichage de la valeur courante (`100%`)
- Presets buttons : `50%` `75%` `90%` `100%` `110%` `120%`
- Clic preset → met à jour le slider et applique

### 5.3 — Application globale du tempo
- Modification du slider → appliqué immédiatement à tous les SoundTouchNodes
- La position de lecture reste cohérente après changement de tempo
- Pas d'artefact de glitch au changement (transition douce si possible)

### 5.4 — Indicateur visuel
- Quand tempo ≠ 100% : badge coloré visible (`×0.75` en orange par exemple)
- Double-clic sur le slider ou bouton reset → retour à 100%

## Notes d'implémentation

- SoundTouch.js peut nécessiter que l'audio soit complètement bufferisé avant le time stretching. Vérifier la compatibilité avec le streaming range-request de wavesurfer.
- Alternative si AudioWorklet pose problème sur AlwaysData : `ScriptProcessorNode` (déprécié mais supporté partout) avec fallback gracieux.
- Le time stretching a une latence inherente — prévoir un offset de compensation si la synchro entre pistes se dégrade.

## Critères d'acceptance
- Slider de tempo fonctionne en temps réel pendant la lecture
- Les presets s'appliquent instantanément
- Toutes les pistes restent synchronisées après changement de tempo
- Le pitch ne change pas (validation à l'oreille)
- Le badge visuel indique quand on n'est pas à 100%
