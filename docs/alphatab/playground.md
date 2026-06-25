# AlphaTab — Playground (guide de référence)

> Repo : [`CoderLine/alphaTabWebsite`](https://github.com/CoderLine/alphaTabWebsite/tree/develop/src/components/AlphaTabPlayground)
> URL : https://alphatab.net/docs/playground/
> Le playground est la démo officielle exhaustive de toutes les capacités d'AlphaTab.

---

## Structure des fichiers

```
src/components/AlphaTabPlayground/
├── index.tsx                  ← composant racine, initialisation AlphaTab
├── helpers.ts                 ← types partagés (HTMLMediaElementLike, MediaType, undo)
├── player-controls-group.tsx  ← barre de contrôle player (play/pause, temps, ouverture fichier)
├── playground-settings.tsx    ← panneau latéral Settings (tous les settings exposés)
├── track-selector.tsx         ← panneau latéral Tracks (liste des pistes)
├── track-item.tsx             ← une piste + ses staves (mute, solo, volume, transpose, notation)
├── media-sync-editor.tsx      ← éditeur de sync points (bottom panel)
├── sync-point-info.ts         ← logique métier des sync points (calcul, déplacement, export)
├── sync-point-marker-panel.tsx← rendu canvas des marqueurs de sync
├── waveform-canvas.tsx        ← rendu canvas de la forme d'onde audio
├── youtube-player.tsx         ← wrapper YouTube IFrame API
└── styles.module.scss
```

---

## `index.tsx` — Composant racine

**Ce qu'il fait :**
- Initialise `AlphaTabApi` avec `playerMode: EnabledSynthesizer` par défaut
- Charge le fichier `files/canon-full.gp`, pistes `[0, 1]`
- Détecte au `scoreLoaded` si le fichier a un backing track (`score.backingTrack?.rawAudioFile`) et bascule automatiquement en mode `Audio`
- Gère les trois panneaux : `SidePanel.Settings`, `SidePanel.TrackSelector`, `BottomPanel.MediaSyncEditor`
- Gère le drag & drop de fichier
- Câble le `YouTubePlayer` à AlphaTab via `IExternalMediaSynthOutput`

**Pattern de détection backing track :**
```js
api.scoreLoaded.on(score => {
    if (score.backingTrack?.rawAudioFile) {
        setMediaType({ type: MediaType.Audio, audioFile: score.backingTrack.rawAudioFile });
    } else {
        setMediaType({ type: MediaType.Synth });
    }
});
```

**Câblage YouTube → AlphaTab (mode ExternalMedia) :**
```js
// L'événement timeupdate du YouTubePlayer pousse la position vers AlphaTab
const onTimeUpdate = () => {
    if (api.actualPlayerMode === alphaTab.PlayerMode.EnabledExternalMedia) {
        (api.player.output as alphaTab.synth.IExternalMediaSynthOutput)
            .updatePosition(newPlayer.currentTime * 1000);
    }
};
// Les events play/pause du media → api.play() / api.pause()
newPlayer.addEventListener('play', () => api.play());
newPlayer.addEventListener('pause', () => api.pause());
```

---

## `helpers.ts` — Types partagés

### `MediaType` (enum)

```typescript
enum MediaType {
    Synth = 0,   // synthétiseur MIDI interne
    Audio = 1,   // fichier audio local (backing track ou fichier importé)
    YouTube = 2  // vidéo YouTube
}

interface MediaTypeState {
    type: MediaType;
    audioFile?: Uint8Array;          // présent si type === Audio
    youtubeUrl?: string;             // présent si type === YouTube
    youtubeVideoDuration?: number;   // en ms, une fois la vidéo chargée
}
```

### `HTMLMediaElementLike` (interface)

Interface unificatrice permettant de traiter `<audio>`, `<video>` et le `YouTubePlayer` de façon identique :

```typescript
interface HTMLMediaElementLike {
    currentTime: number;
    volume: number;
    playbackRate: number;
    readonly duration: number;
    addEventListener(eventType: HTMLMediaElementLikeEvents, handler): void;
    removeEventListener(eventType: HTMLMediaElementLikeEvents, handler): void;
    play(): void;
    pause(): void;
}
// events: 'timeupdate' | 'durationchange' | 'seeked' | 'play' | 'pause' | 'ended' | 'volumechange' | 'ratechange' | 'loadedmetadata'
```

### `useSyncPointInfoUndo`

Hook React implémentant un undo/redo sur l'état `SyncPointInfo` (pile undo + pile redo, `storeUndo`, `undo`, `redo`, `canUndo`, `canRedo`, `resetUndo`).

### Utilitaires de conversion position ↔ pixels

```js
timePositionToX(pixelPerMilliseconds, timeMs, zoom, leftPadding) // → px
xToTimePosition(pixelPerMilliseconds, px, zoom, leftPadding)     // → ms
// Constante globale : pixelPerMilliseconds = 100/1000 (100px/s)
```

---

## `player-controls-group.tsx` — Barre de contrôle

**Ce qu'il fait :**
- Bouton **Open File** → `openInputFile(api)` (dialog fichier)
- Bouton **Play/Pause** → `api.playPause()`
- Progress bar du SoundFont (`soundFontLoad` event)
- Titre + artiste du score
- Affichage `currentTime / endTime` formaté MM:SS (mis à jour via `playerPositionChanged`, throttle à la seconde)
- Boutons toggle : **Media Sync** (bottom panel), **Tracks** (side panel), **Settings** (side panel)

**Pattern throttle position :**
```js
api.playerPositionChanged.on(e => {
    const previousSeconds = (currentTime / 1000) | 0;
    const newSeconds = (e.currentTime / 1000) | 0;
    if (e.endTime === endTime && previousSeconds === newSeconds) return; // skip
    setEndTime(e.endTime);
    setCurrentTime(e.currentTime);
});
```

---

## `playground-settings.tsx` — Panneau Settings

Panneau latéral avec tous les settings AlphaTab modifiables en live. Organisé en groupes :

### Groupes exposés

| Groupe | Settings clés |
|--------|--------------|
| **Display ▸ General** | `core.engine` (SVG/HTML5), `display.scale` (0.25–2), `display.stretchForce`, `display.layoutMode`, `display.barsPerRow`, `display.startBar`, `display.barCount`, `display.justifyLastSystem`, `display.systemsLayoutMode` |
| **Display ▸ Colors** | `display.resources.staffLineColor`, `barSeparatorColor`, `barNumberColor`, `mainGlyphColor`, `secondaryGlyphColor`, `scoreInfoColor` |
| **Display ▸ Fonts** | Toutes les polices : title, subtitle, words, effects, tablature, graceFont, barNumber, markers, etc. |
| **Display ▸ Paddings** | `display.padding[0/1]`, tous les paddings système/staff |
| **Notation** | `notation.fingeringMode`, `notation.rhythmMode` (TabRhythmMode), `notation.rhythmHeight`, grace notes, bend arrows, slur height |
| **Player** | `masterVolume`, `metronomeVolume`, `countInVolume`, `playbackSpeed`, `isLooping`, `player.playerMode`, curseurs, interaction, scroll, vibrato (6 params), slides (3 params), `player.playTripletFeel` |
| **Stylesheet** | `score.stylesheet.hideDynamics`, `bracketExtendMode`, `useSystemSignSeparator`, `globalDisplayTuning`, `globalDisplayChordDiagramsOnTop`, track name policies et orientations |

**Pattern de mise à jour live :**
```js
// Settings display → api.updateSettings() + api.render()
// Settings player sans re-rendu → api.updateSettings() seulement
// Settings MIDI (vibrato, slides) → api.loadMidiForScore() (régénère le MIDI)
```

---

## `track-selector.tsx` — Panneau Tracks

Liste toutes les pistes du score. Chaque piste est un `TrackItem`.

**Sélection / désélection :**
```js
// Sélectionner une piste
newTracks = [...api.tracks, track].sort((a, b) => a.index - b.index);
api.renderTracks(newTracks);

// Désélectionner (garde au moins 1 piste)
newTracks = api.tracks.filter(t => t !== track);
if (newTracks.length === 0) return;
api.renderTracks(newTracks);
```

---

## `track-item.tsx` — Une piste

### Contrôles par piste

| Contrôle | API AlphaTab |
|----------|-------------|
| **Mute** | `api.changeTrackMute([track], bool)` + `track.playbackInfo.isMute = bool` |
| **Solo** | `api.changeTrackSolo([track], bool)` + `track.playbackInfo.isSolo = bool` |
| **Volume** | `api.changeTrackVolume([track], newVol / track.playbackInfo.volume)` (ratio) |
| **Transpose Full** | `settings.notation.transpositionPitches[trackIndex] = semitones` → `api.updateSettings()` + `api.render()` |
| **Transpose Audio** | `api.changeTrackTranspositionPitch([track], semitones)` (audio seulement, pas la notation) |

### `StaffItem` — Portées d'une piste

Chaque piste a un ou plusieurs `Staff`. Pour chaque staff, 4 boutons toggle :

| Bouton | Propriété | Note |
|--------|-----------|------|
| 𝅘𝅥 | `staff.showStandardNotation` | Désactivé si `staff.isPercussion` |
| 5⤴ | `staff.showTablature` | Désactivé si `staff.isPercussion` |
| 𝄍 | `staff.showSlash` | Slash notation |
| &#818;2&#818; | `staff.showNumbered` | Chiffres |

**Après modification :** `api.render()` (pas `updateSettings()`).

---

## `media-sync-editor.tsx` — Éditeur de synchronisation

C'est le composant le plus riche du playground. Il permet d'aligner manuellement un audio/vidéo externe avec la partition.

### Modes de source audio

| Mode | Ce qui se passe |
|------|----------------|
| **Synth** | `buildSyncPointInfoFromSynth(api)` — calcule les temps depuis les tempos MIDI |
| **Audio** | Dialog pour charger un fichier local → `score.backingTrack = new BackingTrack(); score.backingTrack.rawAudioFile = uint8Array` → `buildSyncPointInfoFromAudio(api)` qui décode via `AudioContext.decodeAudioData` et extrait les `Float32Array` gauche/droite |
| **YouTube** | URL YouTube → `buildSyncPointInfoFromYoutube(api, youtubePlayer)` |

**Chargement d'un fichier audio externe (sans backing track dans le .gp) :**
```js
// Le playground crée manuellement un BackingTrack sur le score
score.backingTrack = new alphaTab.model.BackingTrack();
score.backingTrack.rawAudioFile = new Uint8Array(arrayBuffer);
```

### Application des sync points

```js
// Appliquer les sync points au score (déclenche la synchronisation player)
api.score.applyFlatSyncPoints(flatSyncPoints); // FlatSyncPoint[]
api.updateSyncPoints();                         // met à jour le player
// Conserver la position curseur :
const tick = api.tickPosition;
api.score.applyFlatSyncPoints(...);
api.updateSyncPoints();
api.tickPosition = tick;
```

### Structure `FlatSyncPoint`

```typescript
interface FlatSyncPoint {
    barIndex: number;       // index de la mesure (0-based)
    barOccurence: number;   // 0 = première occurrence (reprise = 1, 2…)
    barPosition: number;    // position dans la mesure (0.0 = début, 0.5 = milieu)
    millisecondOffset: number; // temps absolu en ms dans l'audio
}
```

### Boutons du toolbar

| Bouton | Action |
|--------|--------|
| **Synth / Audio / YouTube** | Changement de source |
| **Auto Sync** | `autoSync(state, api)` — aligne automatiquement en détectant le début/fin de l'audio |
| **Reset** | `resetSyncPoints(api, state)` — supprime les sync points personnalisés |
| **Undo / Redo** | `useSyncPointInfoUndo` hook |
| **Generate Code** | Exporte les sync points en TypeScript / C# / Kotlin / AlphaTex |
| **Zoom** | Zoom sur la timeline (facteur appliqué à `pixelPerMilliseconds`) |

### Scroll automatique de la timeline

```js
// Scrolle la timeline pour garder le curseur de lecture visible
const xPos = timePositionToX(pixelPerMilliseconds, playbackTime, zoom, leftPadding);
if (xPos < scrollOffset + threshold || xPos - scrollOffset > canvasWidth - threshold) {
    syncArea.scrollTo({ left: xPos - canvasWidth / 2, behavior: 'smooth' });
}
```

---

## `sync-point-info.ts` — Logique des sync points

### Types

```typescript
type SyncPointMarker = {
    uniqueId: string;
    syncTime: number;        // temps dans l'audio externe (ms) — ce qu'on modifie
    synthTime: number;       // temps MIDI calculé (ms)
    synthBpm: number;        // BPM MIDI à ce point
    synthTick: number;       // tick MIDI absolu
    masterBarIndex: number;
    masterBarStart/End: number;
    occurence: number;       // pour les reprises
    syncBpm?: number;        // BPM ajusté (undefined = marqueur non actif)
    markerType: SyncPointMarkerType; // StartMarker | EndMarker | MasterBar | Intermediate
};

type SyncPointInfo = {
    endTick: number;
    endTime: number;          // durée totale de l'audio en ms
    sampleRate: number;
    leftSamples: Float32Array; // canal gauche (vide si Synth/YouTube)
    rightSamples: Float32Array;
    syncPointMarkers: SyncPointMarker[];
};
```

### Fonctions clés

| Fonction | Rôle |
|----------|------|
| `buildSyncPointInfoFromSynth(api)` | Construit l'info depuis les tempos MIDI (pas d'audio) |
| `buildSyncPointInfoFromAudio(api)` | Décode le `rawAudioFile` via Web Audio API, extrait les samples |
| `buildSyncPointInfoFromYoutube(api, player)` | Utilise la durée de la vidéo YouTube |
| `autoSync(state, api)` | Auto-aligne en détectant le début/fin audio (seuil 200ms silence, 1s non-silencieux) |
| `applySyncPoints(api, info)` | Convertit en `FlatSyncPoint[]` et applique via `api.score.applyFlatSyncPoints` + `api.updateSyncPoints()` |
| `moveMarker(state, marker, newTimeMs)` | Déplace un marqueur et recalcule tous les BPM adjacents |
| `toggleMarker(state, marker)` | Active/désactive un marqueur (ajoute/supprime `syncBpm`) |
| `syncPointsToTypeScriptCode(info, indent)` | Exporte en code TS |
| `syncPointsToAlphaTex(info)` | Exporte en `\sync barIndex occurrence millisecondOffset [position]` |

**Génération via AlphaTab :**
```js
// Le playground utilise cette API interne d'AlphaTab pour générer les sync points initiaux
alphaTab.midi.MidiFileGenerator.generateSyncPoints(api.score, createNewSyncPoints)
```

---

## `waveform-canvas.tsx` — Forme d'onde

Rendu Canvas custom (pas WaveSurfer) des samples audio.

**Ce qu'il dessine :**
1. Axes (lignes horizontales)
2. Échantillons audio (`leftSamples` + `rightSamples` en Float32Array) — agrège les samples par pixel
3. Axe temporel (secondes, sous-graduations 100ms)

**Paramètres clés :**
```typescript
props: {
    sampleRate: number;        // Hz (ex: 44100)
    leftSamples: Float32Array; // canal gauche
    rightSamples: Float32Array;
    endTime: number;           // durée totale en ms
    pixelPerMilliseconds: number; // = 100/1000
    zoom: number;              // facteur de zoom
    scrollOffset: number;      // px scrollés
    width, height: number;
}
```

**Performance :** calcule l'amplitude max une seule fois (effet), redessine sur changement de props JSON.

---

## `sync-point-marker-panel.tsx` — Marqueurs de sync

Couche SVG/DOM superposée au `WaveformCanvas`. Chaque marqueur est un `<div>` positionné en `left: Xpx`.

**Interactions :**
- **Double-clic** → `toggleMarker` (active/désactive le marqueur comme point de sync)
- **Drag gauche-droite** → `moveMarker` (déplace le marqueur dans le temps)
- **Clic sur fond** → seek (`props.onSeek(timeMs)`)
- Contrainte : un marqueur ne peut pas dépasser le précédent/suivant marqueur actif (distance min `dragLimit = 10px`)

**Types de marqueurs :**
- `StartMarker` / `EndMarker` — non supprimables, non déplaçables
- `MasterBar` — début de mesure (label = numéro de mesure)
- `Intermediate` — intérieur de mesure (label vide)
- Avec `syncBpm` → couleur active, affiche le BPM
- Sans `syncBpm` → couleur passive, simple repère visuel

---

## `youtube-player.tsx` — YouTube IFrame

Wrapper React autour de l'API YouTube IFrame qui implémente `HTMLMediaElementLike` via `forwardRef`.

**Fonctionnement :**
- Charge l'API `https://www.youtube.com/iframe_api` une seule fois (script tag partagé)
- Crée un `YT.Player` sur l'élément DOM
- Simule les événements `timeupdate` (intervalle 50ms pendant la lecture), `play`, `pause`, `ended`, `seeked`, `durationchange`/`loadedmetadata` (via `VideoCued`)
- Workaround seek YouTube : YouTube relance la lecture lors d'un seek en état non-play → mémorise `initialSeek` et seek après le prochain `play()`

**Extraction d'un ID YouTube depuis une URL :**
```js
extractYouTubeVideoId(url) // gère youtube.com?v=, youtu.be/, youtube-nocookie.com/embed/
```

---

## Patterns récurrents à retenir

### Modifier un setting + re-render
```js
api.settings.display.scale = 1.5;
api.updateSettings(); // propage
api.render();         // re-render (dans le playground : les deux ensemble)
```

### Modifier un setting qui nécessite un re-MIDI (vibrato, slides, triplet feel)
```js
api.settings.player.vibrato.noteWideLength = 300;
api.loadMidiForScore(); // pas updateSettings()/render(), mais regenere le MIDI
```

### Modifier une propriété de staff directement
```js
staff.showTablature = false;
api.render(); // pas updateSettings(), juste render()
```

### Ajouter un backing track manuellement (sans fichier GP8)
```js
api.score.backingTrack = new alphaTab.model.BackingTrack();
api.score.backingTrack.rawAudioFile = uint8Array;
api.score.applyFlatSyncPoints(syncPoints); // optionnel
api.updateSettings();   // démarre le bon player (BackingTrack)
api.updateSyncPoints(); // met à jour les sync points dans le player
```

### Récupérer le HTMLAudioElement interne (mode BackingTrack)
```js
const audioEl = (api.player.output as alphaTab.synth.IAudioElementBackingTrackSynthOutput)?.audioElement;
```

### Exporter les sync points en AlphaTex
```
\sync barIndex occurence millisecondOffset [barPosition]
```
Exemple : `\sync 0 0 1250` = début de la mesure 1 à t=1250ms.

---

## Sources

| Fichier | Repo |
|---------|------|
| [`index.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/index.tsx) | alphaTabWebsite |
| [`helpers.ts`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/helpers.ts) | alphaTabWebsite |
| [`player-controls-group.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/player-controls-group.tsx) | alphaTabWebsite |
| [`playground-settings.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/playground-settings.tsx) | alphaTabWebsite |
| [`track-selector.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/track-selector.tsx) | alphaTabWebsite |
| [`track-item.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/track-item.tsx) | alphaTabWebsite |
| [`media-sync-editor.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/media-sync-editor.tsx) | alphaTabWebsite |
| [`sync-point-info.ts`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/sync-point-info.ts) | alphaTabWebsite |
| [`waveform-canvas.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/waveform-canvas.tsx) | alphaTabWebsite |
| [`sync-point-marker-panel.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/sync-point-marker-panel.tsx) | alphaTabWebsite |
| [`youtube-player.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/youtube-player.tsx) | alphaTabWebsite |
