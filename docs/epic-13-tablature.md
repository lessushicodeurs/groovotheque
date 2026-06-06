# Epic 13 — Tablature synchronisée (AlphaTab)

## Objectif

Afficher une tablature Guitar Pro synchronisée avec la lecture audio WaveSurfer, dans un drawer redimensionnable ancré en bas du player. La tablature défile en temps réel avec le son, y compris quand le tempo est modifié via SoundTouch.

## Dépendances

- Epic 03 complet (player multipiste WaveSurfer)
- Epic 05 complet (time stretching SoundTouch)

## Contexte technique

### Bibliothèque

[AlphaTab](https://alphatab.net) — rendu de tablatures Guitar Pro dans le browser. Supporte les formats `.gp`, `.gpx`, `.gp8`. Utilisé en mode **display-only** : son moteur audio interne est désactivé, WaveSurfer reste maître de la lecture.

### Formats supportés

Détection automatique par extension dans le dossier groove : `.gp`, `.gpx`, `.gp8`.  
Un seul fichier GP par groove, éventuellement multipiste (plusieurs instruments).

### Synchronisation

AlphaTab expose une API `timePosition` (en ms) pour positionner le curseur sans jouer l'audio. WaveSurfer alimente cette valeur à chaque frame via `requestAnimationFrame` :

```js
// Pseudo-code de synchronisation
function syncAlphaTab() {
  const rawTime = wavesurfer.getCurrentTime() * 1000; // ms
  const tempoFactor = currentTempoRatio; // ex: 0.8 pour 80%
  alphaTabApi.timePosition = rawTime / tempoFactor;
  requestAnimationFrame(syncAlphaTab);
}
```

Le fichier GP8 peut embarquer des points "Synchro to Audio" (ancrages beat → timestamp audio). Ces métadonnées permettent à AlphaTab de calculer précisément le mapping BPM ↔ temps réel même si le tempo de l'enregistrement dévie du BPM théorique.

### Boucles

Deux systèmes coexistent selon l'état du drawer :

| État drawer       | Système de boucle actif         |
|-------------------|---------------------------------|
| Fermé / réduit    | Régions WaveSurfer (existantes) |
| Ouvert (strip/étendu) | Boucles AlphaTab par mesure |

Les boucles AlphaTab sont attachées aux barres de mesure — plus précises musicalement.

### Chargement

AlphaTab (~2 MB JS) est chargé **lazily** uniquement si un fichier GP est détecté dans le groove courant. Non chargé sur mobile.

---

## Stories

### 13.1 — Détection côté serveur

- Le endpoint `/api/grooves` (ou la route player) scanne le dossier groove à la recherche de fichiers `.gp`, `.gpx`, `.gp8`
- Si trouvé, expose le chemin du fichier dans la réponse JSON : `{ "tabFile": "groove.gp8" }`
- Si absent : champ omis ou `null`

### 13.2 — Drawer redimensionnable

Structure HTML/CSS d'un drawer ancré en bas de `player.html` :

- **Handle** de redimensionnement (drag vertical)
- Trois états gérés par CSS + JS :
  - `collapsed` : seul le handle est visible (hauteur minimale ~12px)
  - `strip` : une ligne de tablature visible (~120px)
  - `expanded` : drawer remonte jusqu'à la barre de transport, waveforms masquées
- La barre de transport reste toujours visible (positionnée au-dessus du drawer ou intégrée dans son bandeau haut)
- Transition CSS fluide sur le redimensionnement

Comportement au chargement :
- Pas de fichier GP → drawer absent du DOM
- Fichier GP détecté → drawer monté en état `strip` automatiquement, AlphaTab initialisé

### 13.3 — Intégration AlphaTab

- Chargement dynamique d'AlphaTab via CDN ESM uniquement si `tabFile` présent et viewport desktop
- Initialisation dans le conteneur drawer avec options :
  ```js
  {
    player: { enablePlayer: false }, // audio interne désactivé
    display: { layoutMode: AlphaTab.LayoutMode.Page }
  }
  ```
- Chargement du fichier GP via `api.load(url)`
- En mode `strip` : layoutMode `HorizontalLine` (une ligne continue défilante)
- En mode `expanded` : layoutMode `Page` (multilignes, avec au moins une ligne d'avance visible)

### 13.4 — Sélection des pistes GP

AlphaTab affiche par défaut toutes les pistes du fichier GP. L'utilisateur peut filtrer via l'UI native d'AlphaTab (liste de pistes avec checkboxes) intégrée dans le header du drawer.

- Sélection indépendante des contrôles mute/solo WaveSurfer
- Le mute WaveSurfer reste manuel, non automatisé par la sélection de piste

### 13.5 — Synchronisation temps réel

- Boucle `requestAnimationFrame` démarrée quand le drawer est ouvert (état strip ou expanded)
- Boucle suspendue quand drawer `collapsed` (performance)
- Application du facteur tempo SoundTouch dans le calcul de `timePosition`
- Seek WaveSurfer → repositionnement immédiat du curseur AlphaTab

### 13.6 — Boucles par mesure (mode tab actif)

Quand le drawer est en état `strip` ou `expanded` :
- Les régions WaveSurfer sont désactivées
- L'utilisateur définit une boucle en sélectionnant des mesures dans AlphaTab
- AlphaTab retourne les timestamps de début/fin → WaveSurfer reçoit une instruction de loop sur cet intervalle
- Bouton "Effacer la boucle" dans le bandeau transport

### 13.7 — Desktop only

- Détection mobile : `window.matchMedia('(max-width: 768px)')` ou équivalent breakpoint existant
- Sur mobile : aucun markup drawer, AlphaTab non chargé, aucun appel API `tabFile`

---

## Guidelines de création des fichiers GP (pour le contenu)

Pour une synchronisation précise :

1. **Format** : exporter en GP8 depuis Guitar Pro
2. **Audio embarqué** : importer la référence audio (mixdown mono ou stéréo) dans le projet Guitar Pro via "Audio Track"
3. **Points de sync** : placer des points "Synchro to Audio" (`Track > Synchro to Audio`) au moins sur la mesure 1 et sur les transitions importantes (changement de section, variation de tempo)
4. **BPM** : renseigner le BPM exact de l'enregistrement (si au clic) ou utiliser les sync points pour les enregistrements sans clic

---

## Critères d'acceptance

- Si pas de fichier GP dans le groove : aucun élément UI lié à la tablature n'apparaît
- Si fichier GP présent : drawer s'ouvre automatiquement en mode strip au chargement du player (desktop)
- Le curseur AlphaTab suit la lecture WaveSurfer sans décalage perceptible
- Le curseur AlphaTab reste synchronisé quand le tempo SoundTouch est modifié
- Le drawer est redimensionnable par drag vertical entre collapsed, strip et expanded
- En mode expanded, la barre de transport reste accessible
- Les boucles AlphaTab (par mesure) commandent la boucle WaveSurfer quand le drawer est ouvert
- Sur mobile : aucune trace de l'interface tablature, AlphaTab non chargé
