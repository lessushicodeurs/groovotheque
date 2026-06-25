# AlphaTab — Support des backing tracks audio

> Sources : code source GitHub (`CoderLine/alphaTab` + `CoderLine/alphaTabWebsite`), docs officielles, playground.
> Versions ciblées : AlphaTab v1.6+ / `@coderline/alphatab`.

---

## 1. Modèle de données — où est stocké l'audio ?

### Propriété centrale

```typescript
// packages/alphatab/src/model/BackingTrack.ts
class BackingTrack {
  public rawAudioFile: Uint8Array | undefined;
  // @json_ignore — non sérialisé, peuplé uniquement par le parser
}

// packages/alphatab/src/model/Score.ts
class Score {
  public backingTrack: BackingTrack | undefined;
}
```

Accès depuis JavaScript :

```js
const uint8 = api.score.backingTrack?.rawAudioFile; // Uint8Array | undefined
```

### Comment ce champ est peuplé

`Gp7To8Importer` lit l'archive ZIP du fichier `.gp`, construit un `entryLookup` de toutes les entrées, puis passe ce lookup au `GpifParser` via le callback `loadAsset` :

```ts
// Gp7To8Importer.ts
gpifParser.loadAsset = (fileName) => {
    if (entryLookup.has(fileName)) {
        return entryLookup.get(fileName)!.data;
    }
    return undefined;
};
```

Le parser lit dans le XML GPIF le nœud `<BackingTrack>` (avec `<AssetId>`) puis le nœud `<Assets>` qui contient le chemin du fichier audio dans l'archive :

```xml
<!-- dans score.gpif — structure GP8 uniquement -->
<BackingTrack>
  <Enabled>true</Enabled>
  <Source>Local</Source>
  <AssetId>asset-uuid</AssetId>
  <FramePadding>0</FramePadding>
</BackingTrack>
<Assets>
  <Asset id="asset-uuid">
    <EmbeddedFilePath>audio/backing.ogg</EmbeddedFilePath>
  </Asset>
</Assets>
```

**Filtre critique :** seuls les `source === 'Local'` sont traités — les liens YouTube/distants sont ignorés silencieusement :

```ts
// GpifParser.ts (lignes 393-398)
// remote / youtube links seem to come in future releases according to the gpif tags.
if (enabled && source === 'Local') {
    this.score.backingTrack = backingTrack;
    this._backingTrackAssetId = assetId;
}
```

> **Sources :** [`BackingTrack.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/model/BackingTrack.ts) · [`GpifParser.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/importer/GpifParser.ts) · [`Gp7To8Importer.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/importer/Gp7To8Importer.ts)

---

## 2. Accès aux bytes bruts — vers WaveSurfer ou Web Audio API

Le `rawAudioFile` est un `Uint8Array` brut, directement utilisable. En interne AlphaTab fait :

```ts
// AudioElementBackingTrackSynthOutput.ts
const blob = new Blob([backingTrack.rawAudioFile! as Uint8Array<ArrayBuffer>]);
this.audioElement.src = URL.createObjectURL(blob);
```

Conversions pour un moteur externe :

```js
const uint8 = api.score.backingTrack?.rawAudioFile;

// → WaveSurfer v7+ via loadBlob
if (uint8) {
  const blob = new Blob([uint8], { type: 'audio/ogg' }); // adapter le MIME
  wavesurfer.loadBlob(blob);
}

// → Web Audio API
if (uint8) {
  const audioBuffer = await new AudioContext().decodeAudioData(uint8.buffer);
}

// → URL blob (pour <audio src=...> ou WaveSurfer.load(url))
if (uint8) {
  const url = URL.createObjectURL(new Blob([uint8]));
  // NB: révoquer avec URL.revokeObjectURL(url) quand plus nécessaire
}
```

**Détection au chargement du score (pattern playground) :**

```js
api.scoreLoaded.on(score => {
    if (score.backingTrack?.rawAudioFile) {
        // fichier GP8 avec backing track embarqué
        const uint8 = score.backingTrack.rawAudioFile;
        wavesurfer.loadBlob(new Blob([uint8]));
    } else {
        // pas de backing track → utiliser le synthétiseur MIDI
    }
});
```

> **Source :** [`AlphaTabPlayground/index.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/index.tsx)

---

## 3. API de playback — `IExternalMediaHandler` et `IExternalMediaSynthOutput`

### Interface `IExternalMediaHandler`

```typescript
// packages/alphatab/src/synth/ExternalMediaPlayer.ts
interface IExternalMediaHandler {
    readonly backingTrackDuration: number; // durée totale en ms
    playbackRate: number;                  // getter/setter
    masterVolume: number;                  // getter/setter, 0–1
    seekTo(time: number): void;            // time en ms absolu
    play(): void;
    pause(): void;
}
```

### Interface `IExternalMediaSynthOutput`

C'est l'objet `api.player.output` casté au bon type, qui expose deux méthodes supplémentaires :

```typescript
interface IExternalMediaSynthOutput extends IBackingTrackSynthOutput {
    handler: IExternalMediaHandler | undefined; // injecter votre handler ici
    updatePosition(currentTime: number): void;  // appeler en boucle avec le temps courant en ms
}
```

### Enum `PlayerMode`

```typescript
// packages/alphatab/src/PlayerSettings.ts
export enum PlayerMode {
    Disabled = 0,
    EnabledAutomatic = 1,      // auto-détecte : BackingTrack si dispo, sinon Synthesizer
    EnabledSynthesizer = 2,    // force le synthétiseur MIDI
    EnabledBackingTrack = 3,   // force le backing track interne (HTMLAudioElement)
    EnabledExternalMedia = 4,  // délègue à IExternalMediaHandler
}
```

---

## 4. Câblage complet — intégration WaveSurfer

Code complet extrait et adapté du playground officiel (`YoutubeSyncApp.ts` + guide `audio-video-sync`) :

```js
// ── 1. Configurer le mode AVANT de créer l'API ──────────────────────────────
const settings = new alphaTab.Settings();
settings.fillFromJson({
    core: { file: 'mon-fichier.gp' },
    player: {
        playerMode: alphaTab.PlayerMode.EnabledExternalMedia,
        soundFont: '/soundfont/sonivox.sf2', // requis même en mode externe
    }
});
const api = new alphaTab.AlphaTabApi(canvasElement, settings);

// ── 2. Implémenter IExternalMediaHandler pour WaveSurfer ────────────────────
const handler = {
    get backingTrackDuration() {
        return (wavesurfer.getDuration() || 0) * 1000;
    },
    get playbackRate() { return wavesurfer.getPlaybackRate(); },
    set playbackRate(v) { wavesurfer.setPlaybackRate(v); },
    get masterVolume() { return wavesurfer.getVolume(); },
    set masterVolume(v) { wavesurfer.setVolume(v); },
    seekTo(timeMs) {
        const duration = wavesurfer.getDuration();
        if (duration) wavesurfer.seekTo(timeMs / 1000 / duration);
    },
    play() { wavesurfer.play(); },
    pause() { wavesurfer.pause(); },
};

// ── 3. Injecter le handler dans la sortie ───────────────────────────────────
(api.player.output).handler = handler;
// en TypeScript : (api.player.output as alphaTab.synth.IExternalMediaSynthOutput).handler = handler;

// ── 4. Piloter le curseur AlphaTab depuis WaveSurfer (50ms) ─────────────────
let cursorTimer = 0;
wavesurfer.on('play', () => {
    api.play(); // met AlphaTab en état "playing" pour le curseur
    cursorTimer = setInterval(() => {
        (api.player.output).updatePosition(wavesurfer.getCurrentTime() * 1000);
    }, 50);
});
wavesurfer.on('pause', () => {
    api.pause();
    clearInterval(cursorTimer);
});
wavesurfer.on('seek', () => {
    (api.player.output).updatePosition(wavesurfer.getCurrentTime() * 1000);
});
wavesurfer.on('finish', () => {
    api.stop();
    clearInterval(cursorTimer);
});

// ── 5. Charger l'audio du backing track (si embarqué dans le .gp) ───────────
api.scoreLoaded.on(score => {
    if (score.backingTrack?.rawAudioFile) {
        wavesurfer.loadBlob(new Blob([score.backingTrack.rawAudioFile]));
    }
});
```

### Contrainte architecturale

> *« alphaTab cannot mix the synthesized audio and a backing track together, therefore only either audio will be heard. »*

Audio MIDI synthétisé et backing track sont **mutuellement exclusifs**.

### `api.actualPlayerMode` vs `settings.player.playerMode`

Quand `playerMode = EnabledAutomatic`, AlphaTab résout automatiquement le mode réel. Pour connaître le mode effectif en cours :

```js
api.actualPlayerMode // => PlayerMode.EnabledBackingTrack ou EnabledSynthesizer, etc.
```

### Accès direct au `HTMLAudioElement` interne (mode `EnabledBackingTrack`)

Quand AlphaTab gère lui-même le backing track (`EnabledBackingTrack`), il expose l'élément audio :

```ts
// Utile pour y attacher WaveSurfer en mode MediaElement
const audioEl = (api.player.output as alphaTab.synth.IAudioElementBackingTrackSynthOutput)?.audioElement;
if (audioEl) {
    const ws = WaveSurfer.create({ media: audioEl, ... });
}
```

> **Sources :** [`ExternalMediaPlayer.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/synth/ExternalMediaPlayer.ts) · [`AlphaTabApiBase.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/AlphaTabApiBase.ts) · [`YoutubeSyncApp.ts`](https://github.com/CoderLine/alphaTab/blob/develop/packages/playground/src/apps/YoutubeSyncApp.ts) · [guide audio-video-sync](https://alphatab.net/docs/guides/audio-video-sync) · [`AlphaTabPlayground/index.tsx`](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/index.tsx)

---

## 5. Limitations — réponses définitives

### Compatibilité des formats de fichiers

| Format | Backing track ? | Raison |
|--------|----------------|--------|
| `.gp` (Guitar Pro **8**) | **Oui** depuis v1.6 | Seul format avec `<BackingTrack>` dans le GPIF XML |
| `.gp` (Guitar Pro **7**) | **Non** | Le nœud `<BackingTrack>` n'existe pas dans le GPIF GP7 — `score.backingTrack` sera toujours `undefined` |
| `.gpx` (Guitar Pro 6) | **Non** | Format ZIP différent, pas de backing track |
| `.gp5` et antérieurs | **Non** | Format binaire legacy |

**Preuve définitive sur GP7 :** `Gp7To8Importer` gère les deux formats (`name = 'Guitar Pro 7-8'`) et passe tous les fichiers de l'archive en tant qu'assets potentiels. Mais les fichiers GP7 ne contiennent tout simplement pas le nœud `<BackingTrack>` dans leur `score.gpif` — cette structure XML a été introduite par Guitar Pro 8. Le fichier de test du playground officiel est explicitement `guitarpro8/canon-audio-track.gp`.

### Sources de backing tracks

| Type de source | Supporté ? |
|----------------|------------|
| Fichier embarqué dans l'archive ZIP (`Source: Local`) | **Oui** |
| Lien YouTube (`Source: YouTube`) | **Non** — ignoré silencieusement (code source commenté : *"remote / youtube links seem to come in future releases"*) |
| URL distante | **Non** — même raison |

### Autres limitations

- **`rawAudioFile` est `@json_ignore`** : non sérialisé en JSON, uniquement peuplé par le parser lors de la lecture du fichier.
- **AlphaTab v1.6 minimum** requis (la feature n'existait pas avant).
- **`api.exportAudio()` / `exporter.render()`** : retourne l'audio **MIDI synthétisé** en `Float32Array`, PAS le backing track embarqué — deux API distinctes.
- **Pas de mixing** : synthétiseur MIDI et backing track ne peuvent pas jouer simultanément.

---

## Sources

| Source | Type |
|--------|------|
| [ExternalMediaPlayer.ts](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/synth/ExternalMediaPlayer.ts) | Code source |
| [BackingTrackPlayer.ts](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/synth/BackingTrackPlayer.ts) | Code source |
| [AlphaTabApiBase.ts](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/AlphaTabApiBase.ts) | Code source |
| [PlayerSettings.ts](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/PlayerSettings.ts) | Code source |
| [GpifParser.ts](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/importer/GpifParser.ts) | Code source |
| [Gp7To8Importer.ts](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/importer/Gp7To8Importer.ts) | Code source |
| [BackingTrack.ts](https://github.com/CoderLine/alphaTab/blob/develop/packages/alphatab/src/model/BackingTrack.ts) | Code source |
| [YoutubeSyncApp.ts (playground)](https://github.com/CoderLine/alphaTab/blob/develop/packages/playground/src/apps/YoutubeSyncApp.ts) | Demo officielle |
| [AlphaTabPlayground/index.tsx (website)](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/index.tsx) | Demo officielle |
| [media-sync-editor.tsx (website)](https://github.com/CoderLine/alphaTabWebsite/blob/develop/src/components/AlphaTabPlayground/media-sync-editor.tsx) | Demo officielle |
| [Guide Audio & Video Sync](https://alphatab.net/docs/guides/audio-video-sync) | Docs officielles |
| [IExternalMediaHandler — référence](https://alphatab.net/docs/reference/types/synth/iexternalmediahandler/) | Docs officielles |
| [Release notes v1.6](https://alphatab.net/docs/releases/release1_6) | Docs officielles |
