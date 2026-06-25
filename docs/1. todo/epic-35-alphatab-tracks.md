# Epic 35 — Pistes AlphaTab dans le player

## Objectif

Faire des fichiers Guitar Pro des citoyens de première classe dans Groovotheque : un dossier contenant uniquement un `.gp` doit s'ouvrir comme un groove à part entière, avec ses pistes MIDI jouables, une timeline en mesures (BBT), et la prise en charge du backing track embarqué comme piste WaveSurfer ordinaire. En mode mixte (GP + fichiers audio), pistes MIDI et audio cohabitent dans le même player, toutes synchronisées.

## Dépendances

- Epic 13 complet (tablature AlphaTab de base)
- Epic 34 complet (libs AlphaTab et WaveSurfer servies localement)

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Master clock | AlphaTab master clock quand un GP est présent (tab-only ET mixte) — WaveSurfer devient follower |
| Mode tab-only | Transport fonctionnel en MIDI pur ; pas de WaveSurfer instances |
| Ordre des pistes | Pistes MIDI → Backing track → Pistes audio |
| Sidebar pistes MIDI | Identique aux pistes audio (nom, mute/solo/volume) + bouton « afficher dans la tab » |
| Signe distinctif | Le bouton « afficher dans la tab » est l'indicateur visuel qu'une piste est MIDI (absent sur l'audio) |
| Zone waveform des pistes MIDI | Aire vide colorée (v1) — piano-roll reporté à une epic suivante |
| Backing track | Chargé comme instance WaveSurfer via `loadBlob(rawAudioFile)` ; pas de bouton « afficher dans la tab » |
| Backing track + pistes MIDI | Jouent simultanément (AlphaTab `EnabledSynthesizer` + WaveSurfer pour l'audio) |
| Coexistence backing + fichiers audio | Tout joue ensemble — pas de logique spéciale, l'utilisateur mute selon ses besoins |
| Timecode | Switchable BBT (mesure:temps) ↔ mm:ss via bouton bascule |
| BBT = « bars, beats, ticks » | Terme utilisé dans le code et la doc pour désigner le temps musical |
| Timeline | Reconstruite en mode BBT avec graduations sur les barres de mesure (`score.masterBars`) |
| Persistance des boucles | BBT natif (`{ bar, beat }`) quand GP présent ; secondes sinon — compatible avec l'existant |
| Drawer AlphaTab | Comportement inchangé (collapsed par défaut) |
| Mobile | Restriction inchangée (AlphaTab non chargé sur mobile) |
| Format backing track | GP8 uniquement (`.gp` Guitar Pro 8) — GP7, GPX, GP5 n'embarquent pas de backing track |

---

## Stories

### 35.1 — AlphaTab comme master clock

Inverser l'architecture de synchronisation : quand un fichier GP est présent, AlphaTab pilote le transport et les instances WaveSurfer deviennent des followers.

- `api.play()` / `api.pause()` / `api.stop()` remplacent les appels WaveSurfer pour Play/Pause/Stop
- Seek bar et clic sur waveform → `api.timePosition = ms`
- Tempo slider → `api.settings.player.playbackSpeed = ratio`
- `playerPositionChanged` event → calculer `synthTimeToAudioTime(positionMs)` (inverse de l'actuel `audioTimeToSynthTime`) et `seek()` toutes les instances WaveSurfer
- Durée totale : `api.score.duration` (en ms)
- Supprimer le RAF loop qui pousse le temps WaveSurfer vers `api.timePosition`
- En l'absence de GP, le comportement WaveSurfer-master reste inchangé

### 35.2 — Groove tab-only

Un dossier contenant uniquement un fichier GP (sans fichiers audio) doit s'ouvrir et être jouable.

- Le serveur classe déjà ces dossiers comme grooves (`classifyDir` inclut `GP_EXTENSIONS`) — aucun changement backend
- Le player démarre avec 0 instance WaveSurfer et sans timeline-row WaveSurfer
- Les pistes tab s'affichent après `scoreLoaded` (dépend de 35.3)
- La seek bar, le timecode et la durée sont alimentés par AlphaTab
- Sur mobile : message « ouvrez sur desktop pour voir la tablature » (comportement inchangé)

### 35.3 — Pistes MIDI dans l'UI

Après chargement du score, créer une ligne de piste pour chaque entrée de `score.tracks`.

- Lignes insérées en haut du `#tracks-container`, avant les pistes audio
- Chaque ligne : sidebar complète (nom depuis `track.name`, mute/solo/volume) + bouton « afficher dans la tab » + aire vide colorée
- Bouton mute/solo/volume → `api.changeTrackMute(...)` / `api.changeTrackSolo(...)` / `api.changeTrackVolume(...)`
- Bouton « afficher dans la tab » → ajoute/retire la piste de la sélection `renderTracks` ; état visuel actif/inactif
- Couleur de la zone vide : palette existante `TRACK_COLORS`, indices après les pistes audio
- Aucune instance WaveSurfer pour ces lignes

### 35.4 — Backing track comme piste WaveSurfer

Quand `score.backingTrack?.rawAudioFile` est présent (fichiers GP8 uniquement), créer une piste audio à partir des bytes embarqués.

- `scoreLoaded` : détecter `rawAudioFile` (Uint8Array)
- Créer une instance WaveSurfer via `loadBlob(new Blob([rawAudioFile]))`
- Insérer la ligne entre les pistes MIDI et les pistes audio
- Sidebar : identique aux pistes audio — **sans** bouton « afficher dans la tab »
- Nom : libellé issu des métadonnées du fichier GP ou « Backing Track » par défaut
- Synchronisation : même logique follower que les autres WaveSurfer (dépend de 35.1)
- Peaks : mis en cache avec une clé dérivée du groove + nom fixe `_backing.peaks.json`

### 35.5 — Timecode BBT et timeline en mesures

Permettre d'afficher et de naviguer le temps en mesures/temps (BBT) plutôt qu'en mm:ss.

- Bouton bascule BBT ↔ mm:ss sur le display du timecode (toggle persisté en localStorage)
- Format BBT : `M:B` (mesure 1-indexée : temps 1-indexé), ex. `5:3`
- Source : `playerPositionChanged` fournit `currentBeat` → `voice.bar.index` + `beat.index`
- Timeline row : reconstruire les graduations depuis `score.masterBars` en mode BBT (position de chaque mesure convertie en px via la durée totale)
- En mode mm:ss, timeline identique à l'actuel (inchangée)
- La seek bar reste toujours en secondes en interne — le BBT est un affichage uniquement

### 35.6 — Boucles en BBT

Stocker et afficher les boucles en coordonnées musicales quand un GP est présent.

- `loop.json` enrichi : `{ "bar": N, "beat": B }` pour in et out quand la boucle est définie en mode BBT
- Rétrocompatibilité : si `loop.json` contient des secondes (format actuel, champ `"in"` numérique), les utiliser tels quels
- Conversion BBT → secondes à la lecture via `score.masterBars`
- Affichage IN/OUT dans les champs du transport en BBT quand le mode BBT est actif
- Snap au temps (beat) lors d'un drag sur la timeline en mode BBT

---

## Critères d'acceptance

- [ ] Un dossier contenant uniquement un `.gp` s'ouvre dans le player sans erreur
- [ ] En mode tab-only, le bouton Play lance la lecture MIDI AlphaTab
- [ ] En mode tab-only, les pistes du fichier GP apparaissent comme des lignes dans le player avec aire vide
- [ ] Le bouton mute/solo/volume d'une piste MIDI affecte la lecture MIDI (AlphaTab `changeTrackMute/Solo/Volume`)
- [ ] Le bouton « afficher dans la tab » masque / affiche la portée de la piste dans le drawer AlphaTab
- [ ] En mode mixte, les pistes MIDI sont affichées au-dessus des pistes audio
- [ ] Sur un fichier GP8 avec backing track, une piste WaveSurfer s'affiche entre les pistes MIDI et les pistes audio, avec forme d'onde
- [ ] Le backing track joue synchronisé avec le MIDI synth et les pistes audio
- [ ] Le timecode affiche un bouton bascule BBT ↔ mm:ss ; les deux modes sont fonctionnels
- [ ] En mode BBT, la timeline affiche des marqueurs de mesures alignés sur les barres de `score.masterBars`
- [ ] Une boucle définie en mode BBT est stockée dans `loop.json` avec les champs `bar`/`beat` et rechargée correctement au prochain ouverture
- [ ] En mode mixte avec AlphaTab master, la seek bar, le tempo et les contrôles de transport fonctionnent de manière identique à l'actuel
- [ ] Sur mobile, le comportement est inchangé (message desktop-only, pas de tab chargée)
