# AlphaTab — Vue d'ensemble technique

> Basé sur la lecture directe du code source `CoderLine/alphaTab` (branche `develop`) et `CoderLine/alphaTabWebsite`.
> Version ciblée : `@coderline/alphatab` v1.6+.

---

## 1. Architecture générale

AlphaTab est composé de trois couches indépendantes :

```
┌─────────────────────────────────────────────────────────┐
│  AlphaTabApi  (façade publique)                         │
├──────────────────┬──────────────────┬───────────────────┤
│  Importer        │  Renderer        │  Player           │
│  (lecture        │  (rendu SVG/     │  (alphaSynth,     │
│  fichiers)       │  Canvas)         │  backing track,   │
│                  │                  │  external media)  │
├──────────────────┴──────────────────┴───────────────────┤
│  Modèle de données (Score / Track / Bar / Beat / Note)  │
└─────────────────────────────────────────────────────────┘
```

**AlphaTabApiBase** (`src/AlphaTabApiBase.ts`) est la classe centrale. La sous-classe JavaScript `AlphaTabApi` (`src/platform/javascript/AlphaTabApi.ts`) ajoute la couche DOM et les Web Workers.

Le rendu et l'audio tournent dans des **Web Workers** séparés pour ne pas bloquer le thread principal :
- **Render Worker** — génère le SVG/Canvas hors du thread principal
- **Audio Worklet** — synthèse MIDI en temps réel via `AudioWorkletProcessor`

---

## 2. Initialisation

```js
// Minimal
const api = new alphaTab.AlphaTabApi('#canvas', {
    core: { file: 'song.gp' }
});

// Avec player
const api = new alphaTab.AlphaTabApi('#canvas', {
    core: {
        file: 'song.gp',
        engine: 'svg',          // 'svg' (défaut web) ou 'html5' (canvas)
        tracks: [0, 1],         // pistes à afficher (défaut : toutes)
        fontDirectory: '/font/' // chemin vers les fonts Bravura/SMuFL
    },
    player: {
        playerMode: alphaTab.PlayerMode.EnabledAutomatic,
        soundFont: '/soundfont/sonivox.sf2',
        scrollElement: document.querySelector('.viewport'),
    }
});
```

**Chargement après coup :**

```js
api.load('autre-fichier.gp');                  // depuis URL ou ArrayBuffer
api.load(arrayBuffer);                          // ArrayBuffer
api.tex('\\title "Test"\n.');                   // depuis AlphaTex
api.renderScore(score, [0]);                    // depuis un Score déjà parsé
```

---

## 3. Formats de fichiers supportés

| Importer | Format | Extension | Notes |
|----------|--------|-----------|-------|
| `Gp7To8Importer` | Guitar Pro 7 & 8 | `.gp` | ZIP + GPIF XML ; backing track uniquement GP8 |
| `GpxImporter` | Guitar Pro 6 | `.gpx` | ZIP propriétaire ; 99 % des features |
| `Gp3To5Importer` | Guitar Pro 3/4/5 | `.gp3` `.gp4` `.gp5` | Format binaire legacy |
| `AlphaTexImporter` | AlphaTex | `.tex` | Format texte maison d'AlphaTab |
| `MusicXmlImporter` | MusicXML | `.xml` `.musicxml` | Standard ouvert |
| `CapellaImporter` | Capella | `.capx` | Éditeur de partition allemand |

**Détection automatique :** `ScoreLoader` essaie les importers dans l'ordre jusqu'à ce qu'un succeed.

---

## 4. Modèle de données

Hiérarchie complète :

```
Score
├── title, artist, album, subTitle, tempo…
├── backingTrack: BackingTrack | undefined   ← GP8 seulement
├── masterBars: MasterBar[]                  ← structure temporelle globale
│   ├── timeSignatureNumerator/Denominator
│   ├── keySignature
│   ├── tempoAutomations: Automation[]
│   └── syncPoints (pour backing track)
└── tracks: Track[]
    ├── name, shortName, color
    ├── playbackInfo: PlaybackInformation     ← volume, pan, programme MIDI
    ├── isPercussion: boolean
    └── staves: Staff[]
        └── bars: Bar[]                      ← une Bar par MasterBar
            └── voices: Voice[]              ← polyphonie (voix 1, 2…)
                └── beats: Beat[]
                    ├── duration, isEmpty
                    ├── notes: Note[]
                    │   ├── fret, string, value (MIDI)
                    │   ├── bendPoints, vibrato, hammer-on…
                    │   └── isGhost, isTie, accentuationType…
                    ├── effects (whammy, fade, slap…)
                    └── graceNotes
```

**Accès rapide depuis l'API :**

```js
api.score          // Score | null
api.tracks         // Track[] (pistes actuellement affichées)
api.tickPosition   // position courante en ticks MIDI
api.timePosition   // position courante en ms
api.endTick        // durée totale en ticks
api.endTime        // durée totale en ms
```

---

## 5. Settings

`Settings` est le conteneur racine avec six sous-objets :

### `core` (CoreSettings)

| Propriété | Défaut | Rôle |
|-----------|--------|------|
| `file` | `null` | URL du fichier à charger au démarrage |
| `tracks` | `null` | Pistes à afficher (`number`, `number[]`, `'all'`) |
| `engine` | `'default'` | Moteur de rendu : `'svg'` ou `'html5'` (canvas) |
| `fontDirectory` | auto | Chemin vers les fichiers Bravura/SMuFL |
| `scriptFile` | auto | URL du JS AlphaTab (pour les Workers) |
| `enableLazyLoading` | `true` | Rendu partiel progressif |
| `logLevel` | `Info` | Niveau de log |

### `display` (DisplaySettings)

| Propriété | Défaut | Rôle |
|-----------|--------|------|
| `layoutMode` | `Page` | `Page`, `Horizontal`, `Parchment` |
| `staveProfile` | `Default` | Quelles portées afficher (voir §6) |
| `scale` | `1.0` | Zoom global |
| `stretchForce` | `1.0` | Étirement horizontal des notes |
| `barsPerRow` | `-1` | Nombre de mesures par ligne (-1 = auto) |
| `startBar` | `1` | Première mesure à afficher |
| `barCount` | `-1` | Nombre de mesures à afficher |
| `padding` | `[35, 35]` | Marges |
| `resources` | — | Polices, couleurs (voir `RenderingResources`) |

### `notation` (NotationSettings)

| Propriété | Défaut | Rôle |
|-----------|--------|------|
| `notationMode` | `GuitarPro` | `GuitarPro` ou `SongBook` |
| `fingeringMode` | `ScoreDefault` | Affichage des doigtés |
| `elements` | — | `Map<NotationElement, boolean>` — activer/désactiver chaque élément |

**Mode SongBook :** désactive les petites grace notes en tab, change le mode de doigté, simplifie l'affichage.

### `player` (PlayerSettings)

| Propriété | Défaut | Rôle |
|-----------|--------|------|
| `playerMode` | `Disabled` | Voir §7 |
| `soundFont` | `null` | URL du SoundFont SF2 (requis pour le synthétiseur) |
| `scrollElement` | `'html,body'` | Conteneur de scroll automatique |
| `enableCursor` | `true` | Afficher le curseur de lecture |
| `enableAnimatedBeatCursor` | `true` | Animation fluide du curseur |
| `enableElementHighlighting` | `true` | Surligner les notes courantes |
| `enableUserInteraction` | `true` | Clic pour repositionner, sélection |
| `outputMode` | `WebAudioAudioWorklets` | Moteur audio |
| `bufferTimeInMilliseconds` | — | Buffer audio |

### `importer` (ImporterSettings)

Contrôle l'encodage des fichiers texte et la taille max de décodage.

---

## 6. Modes de layout

```typescript
enum LayoutMode {
    Page = 0,       // colonnes verticales (défaut)
    Horizontal = 1, // une seule ligne horizontale infinie
    Parchment = 2,  // respecte le systemsLayout du fichier GP
}
```

**Parchment** lit `score.systemsLayout` (tableau du nombre de mesures par ligne) et `score.defaultSystemsLayout`. Ces valeurs sont embarquées dans les fichiers Guitar Pro et reproduisent fidèlement la mise en page originale.

---

## 7. Profils de portée (StaveProfile)

```typescript
enum StaveProfile {
    Default = 0,    // notation + tab (défaut)
    ScoreTab = 1,   // notation + tab
    Score = 2,      // notation seulement
    Tab = 3,        // tab seulement
    TabMixed = 4,   // tab sans silences ni chiffrage
}
```

---

## 8. Modes de lecture (PlayerMode)

```typescript
enum PlayerMode {
    Disabled = 0,           // pas de player
    EnabledAutomatic = 1,   // auto : BackingTrack si dispo, sinon Synthesizer
    EnabledSynthesizer = 2, // force le synthétiseur MIDI + SoundFont
    EnabledBackingTrack = 3,// lit l'audio embarqué dans le .gp (GP8)
    EnabledExternalMedia = 4// délègue à IExternalMediaHandler (WaveSurfer, YouTube…)
}
```

`EnabledAutomatic` est le mode recommandé pour un comportement générique : AlphaTab utilise automatiquement le backing track si `score.backingTrack?.rawAudioFile` existe, sinon le synthétiseur.

**Mode effectif vs mode demandé :**

```js
api.settings.player.playerMode  // ce que vous avez demandé
api.actualPlayerMode             // ce qui tourne réellement (utile avec EnabledAutomatic)
```

Pour l'intégration avec un moteur audio externe (WaveSurfer, YouTube, `<audio>`) — voir [backing-track.md](./backing-track.md).

---

## 9. API publique

### Chargement et rendu

```js
api.load(data, trackIndexes?)        // URL, ArrayBuffer, Uint8Array, base64
api.tex(alphaTex, tracks?)           // charger depuis AlphaTex
api.renderScore(score, trackIndexes?)// charger depuis un Score déjà parsé
api.renderTracks(tracks[])           // afficher une sélection de pistes
api.render()                         // forcer un re-rendu
api.triggerResize()                  // recalculer la largeur
api.updateSettings()                 // appliquer les settings modifiés en runtime
api.destroy()                        // nettoyer tous les ressources
```

### Playback

```js
api.play()                           // → false si pas prêt
api.pause()
api.playPause()
api.stop()
api.playBeat(beat)                   // jouer un Beat spécifique
api.playNote(note)                   // jouer une Note spécifique

api.masterVolume                     // 0–1 (getter/setter)
api.metronomeVolume                  // 0–1
api.countInVolume                    // 0–1 (compte avant démarrage)
api.playbackSpeed                    // getter/setter (tempo relatif)
api.isLooping                        // getter/setter
api.tickPosition                     // getter/setter (seek en ticks)
api.timePosition                     // getter/setter (seek en ms)
api.playbackRange                    // PlaybackRange | null (A-B repeat)
```

### Pistes

```js
api.changeTrackVolume(tracks[], vol) // vol 0–16 (valeurs Guitar Pro)
api.changeTrackSolo(tracks[], bool)
api.changeTrackMute(tracks[], bool)
api.changeTrackTranspositionPitch(tracks[], semitones)
```

### SoundFont

```js
api.loadSoundFont(data, append?)     // URL, ArrayBuffer, Uint8Array
api.resetSoundFonts()
```

### Lookup

```js
api.boundsLookup      // BoundsLookup : position visuelle de chaque Beat/Bar
api.tickCache         // MidiTickLookup : Beat ↔ tick MIDI
```

### Sélection / plage de lecture

```js
api.highlightPlaybackRange(startBeat, endBeat)
api.applyPlaybackRangeFromHighlight()
api.clearPlaybackRangeHighlight()
```

---

## 10. Événements

Tous les événements suivent le pattern `api.nomEvenement.on(handler)` / `.off(handler)`.

### Cycle de vie

| Événement | Payload | Déclenchement |
|-----------|---------|---------------|
| `scoreLoaded` | `Score` | Après parsing du fichier |
| `renderStarted` | `boolean` | Début du rendu (bool = resize) |
| `renderFinished` | `RenderFinishedEventArgs` | Fin d'un rendu partiel |
| `postRenderFinished` | — | Tous les rendus partiels terminés |
| `resize` | `ResizeEventArgs` | Redimensionnement du conteneur |
| `settingsUpdated` | — | Après `updateSettings()` |
| `error` | `Error` | Erreur quelconque |

### Player

| Événement | Payload | Déclenchement |
|-----------|---------|---------------|
| `playerStateChanged` | `PlayerStateChangedEventArgs` | Play / Pause / Stop |
| `playerPositionChanged` | `PositionChangedEventArgs` | Tick courant (périodique) |
| `playedBeatChanged` | `Beat` | Changement de beat joué |
| `activeBeatsChanged` | `ActiveBeatsChangedEventArgs` | Notes en cours (toutes pistes) |
| `midiLoad` | `MidiFile` | MIDI généré depuis le score |
| `midiLoaded` | `PositionChangedEventArgs` | Player prêt à lire |
| `midiEventsPlayed` | `MidiEventsPlayedEventArgs` | Events MIDI joués (filtrable) |
| `soundFontLoad` | `ProgressEventArgs` | Progression du chargement SF2 |
| `soundFontLoaded` | — | SoundFont prêt |

### Interaction souris

| Événement | Payload |
|-----------|---------|
| `beatMouseDown` | `Beat` |
| `beatMouseMove` | `Beat` |
| `beatMouseUp` | `Beat | null` |
| `noteMouseDown` | `Note` |
| `noteMouseMove` | `Note` |
| `noteMouseUp` | `Note | null` |
| `playbackRangeHighlightChanged` | `PlaybackHighlightChangeEventArgs` |

---

## 11. Export audio (synthétiseur MIDI)

`api.exportAudio()` retourne un **exporter** permettant d'extraire l'audio MIDI synthétisé en `Float32Array` :

```js
const exporter = await api.exportAudio({
    // options : pistes à inclure, format…
});

const chunks = [];
let chunk;
while ((chunk = await exporter.render(5000 /* ms */)) !== null) {
    chunks.push(chunk); // Float32Array
}
// Convertir en WAV, envoyer à Web Audio, etc.
```

> Distinct du backing track : ceci est l'audio **synthétisé** par alphaSynth depuis les notes, pas l'audio embarqué dans le fichier.

---

## 12. AlphaTex — format texte

AlphaTex est le format texte natif d'AlphaTab pour décrire des partitions. Utile pour les snippets, la génération programmatique ou les tests :

```
\title "Ma chanson"
\artist "Moi"
\tempo 120
.
\ts 4 4
5.1.4 4.2.4 3.3.4 5.1.4 |
```

Syntaxe : `fret.corde.durée`. Chargement via `api.tex('...')` ou `settings.core.tex = true` + `settings.core.file = 'contenu'`.

---

## 13. Architecture Web — Workers et Worklets

```
Thread principal
├── AlphaTabApi (DOM, événements)
│   ├── → postMessage → RenderWorker (rendu SVG hors-thread)
│   └── → postMessage → AlphaSynthWorker
│                           └── AudioWorkletNode
│                               └── AudioWorkletProcessor (synthèse PCM)
```

- **RenderWorker** : évite de bloquer l'UI pendant le calcul de layout complexe.
- **AlphaSynthWorker + AudioWorklet** : pipeline audio entièrement hors du thread principal pour éviter les glitches.
- `core.scriptFile` doit pointer vers le JS AlphaTab pour que les Workers puissent s'initialiser (auto-détecté dans la plupart des cas).

---

## 14. Patterns courants

### Détecter si un fichier a un backing track

```js
api.scoreLoaded.on(score => {
    if (score.backingTrack?.rawAudioFile) {
        console.log('Backing track disponible, taille :', score.backingTrack.rawAudioFile.length);
    }
});
```

### Changer de piste sans recharger le fichier

```js
api.renderTracks([api.score.tracks[2], api.score.tracks[3]]);
```

### Seek via clic utilisateur

```js
api.beatMouseDown.on(beat => {
    api.tickPosition = beat.absoluteDisplayStart;
});
```

### Synchroniser un élément externe avec la lecture

```js
api.playerPositionChanged.on(args => {
    progressBar.style.width = `${(args.currentTime / args.endTime) * 100}%`;
    timeLabel.textContent = `${(args.currentTime / 1000).toFixed(1)}s`;
});
```

### Modifier les settings en runtime

```js
api.settings.display.staveProfile = alphaTab.StaveProfile.Tab;
api.settings.display.scale = 1.5;
api.updateSettings(); // déclenche le re-rendu
```

### Accès au modèle pour modifier le layout

```js
api.scoreLoaded.on(score => {
    // Forcer 4 mesures par ligne en mode Parchment
    score.defaultSystemsLayout = 4;
    api.renderScore(score, [0]);
});
```

---

## 15. Limitations à connaître

- **Pas de mixing** : synthétiseur MIDI et backing track ne peuvent pas jouer ensemble.
- **Backing track uniquement GP8** : les fichiers GP7 et antérieurs ne contiennent pas le nœud `<BackingTrack>` dans leur GPIF.
- **Backing track local uniquement** : les liens YouTube embarqués dans le GPIF sont ignorés (feature future).
- **Environnement navigateur requis** : `AlphaTabApi` lève une erreur dans Node.js (il détecte le contexte et refuse de démarrer — il utilise Web Audio, DOM, Workers).
- **SoundFont requis pour le synthétiseur** : sans SF2 chargé, `PlayerMode.EnabledSynthesizer` ne produit pas de son.
- **`rawAudioFile` non sérialisé** : annoté `@json_ignore`, il faut re-parser le fichier pour le récupérer.

---

## Références

| Source | Type |
|--------|------|
| [`AlphaTabApiBase.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/AlphaTabApiBase.ts) | Façade API complète |
| [`Settings.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/Settings.ts) | Racine des settings |
| [`PlayerSettings.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/PlayerSettings.ts) | PlayerMode + settings player |
| [`DisplaySettings.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/DisplaySettings.ts) | Layout, zoom, profils |
| [`LayoutMode.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/LayoutMode.ts) | Page / Horizontal / Parchment |
| [`model/Score.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/model/Score.ts) | Racine du modèle de données |
| [`AlphaTabPlayground/index.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/index.tsx) | Implémentation de référence |
| [backing-track.md](./backing-track.md) | Backing track et media externe (détaillé) |
| [Docs officielles](https://alphatab.net/docs/introduction) | Documentation complète |
