# Epic 38 — Téléchargement du mix

## Objectif

Permettre de télécharger un fichier audio unique (stéréo) correspondant au mix tel que
l'utilisateur l'entend : volumes, pans, mute et solo courants appliqués. Aujourd'hui on ne
peut télécharger que les pistes brutes (epic 09), ce qui oblige à refaire le mix dans un
logiciel externe pour l'écouter en voiture ou l'envoyer à quelqu'un.

## Dépendances

- Epic 09 complet (boutons de téléchargement, endpoint zip)
- Epic 11 / 30 complets (`mix.json` — volumes + pans)
- Epic 15 complet (contrôle de pan, `StereoPannerNode`)

## Contexte

Le player construit déjà le graphe Web Audio complet (`player.js`) :

```
MediaElementSource → GainNode (volume, mute/solo) → StereoPannerNode (pan) → destination
```

Le rendu du mix consiste donc à rejouer ce même graphe hors-ligne, avec des
`AudioBufferSourceNode` à la place des `<audio>`, dans un `OfflineAudioContext`.

## Décisions de conception

| Sujet | Décision |
|---|---|
| Lieu du rendu | Côté client, `OfflineAudioContext` — le serveur n'a pas ffmpeg installé (uniquement les scripts d'import l'utilisent) |
| Source des réglages | L'état **courant en mémoire** (`trackStates`, `panNodes`), pas `mix.json` — on exporte ce qu'on entend, y compris les réglages non sauvegardés |
| Mute / solo | Pris en compte : une piste mutée (ou non-solo quand un solo est actif) est à zéro, donc absente du mix |
| Tempo | Ignoré — le rendu se fait toujours à 100 % (le `playbackRate` est une aide de travail, pas un choix artistique) |
| Étendue | Le groove entier, toujours — la boucle IN/OUT n'est pas prise en compte |
| Format | Trois sorties : WAV 44,1 kHz / 16 bits (natif, aucune dépendance), FLAC (même contenu, ~45 % plus léger, story 38.5), MP3 192 kbps (partage par messagerie, story 38.6) — le WAV ne coûte rien à garder |
| Nom du fichier | `{slug}-mix.{ext}` (ex : `afro-beat-mix.flac`) |
| Normalisation | Aucune, mais protection anti-écrêtage : si le pic dépasse 0 dBFS, tout le buffer est atténué et l'atténuation appliquée est indiquée à l'utilisateur |
| Droits | Aucun — accessible à tous les utilisateurs authentifiés (contrairement à la sauvegarde du mix, réservée à l'admin) |

## Stories

### 38.1 — Menu de téléchargement dans l'en-tête

Le bouton « ↓ Tout télécharger » (epic 09) devient un menu à quatre entrées :

- « Pistes séparées (zip) » — comportement actuel, inchangé
- « Mix stéréo (MP3) » — nouvelle entrée, la plus légère, placée en premier des trois
- « Mix stéréo (FLAC) » — nouvelle entrée
- « Mix stéréo (WAV) » — nouvelle entrée

Même famille visuelle que les autres menus du player ; fermeture au clic extérieur et à `Échap`.

### 38.2 — Rendu hors-ligne du mix

Nouveau module `public/js/mix-export.js`, fonction `renderMix()` :

1. Récupérer l'URL de chaque piste **non silencieuse** (voir règle mute/solo ci-dessus).
2. `fetch` + `decodeAudioData` sur chaque piste — les fichiers sont déjà en cache navigateur
   après la lecture, l'appel est donc généralement instantané.
3. Créer un `OfflineAudioContext(2, durée × 44100, 44100)`, la durée étant celle de la piste
   la plus longue.
4. Pour chaque piste : `AudioBufferSourceNode → GainNode(volume) → StereoPannerNode(pan) → destination`,
   avec exactement les valeurs lues dans `trackStates[i]` et `panNodes[i].pan.value`.
5. `startRendering()` → `AudioBuffer` stéréo.
6. Chercher le pic absolu ; s'il dépasse 1.0, multiplier l'ensemble par `1 / pic`.

Les pistes plus courtes que le mix se terminent simplement plus tôt (pas de padding explicite,
l'`OfflineAudioContext` produit du silence).

### 38.3 — Encodage WAV et déclenchement du téléchargement

Toujours dans `mix-export.js` :

- `encodeWav(audioBuffer)` — en-tête RIFF/WAVE 44 octets + PCM 16 bits entrelacé, écrit dans un
  `ArrayBuffer` via `DataView`. Aucune bibliothèque.
- Créer un `Blob` (`audio/wav`), un object URL, un `<a download>` synthétique, `.click()`, puis
  `URL.revokeObjectURL()`.

### 38.4 — Retour visuel pendant le rendu

Le rendu d'un groove de 5 minutes prend quelques secondes et bloque partiellement l'interface :

- L'entrée de menu est désactivée et affiche « Rendu… » pendant l'opération.
- À la fin : retour au libellé initial. Si une atténuation anti-écrêtage a été appliquée,
  afficher un message discret (« Mix atténué de −2,4 dB pour éviter la saturation »).
- En cas d'erreur (décodage, mémoire) : message d'erreur explicite, aucun fichier téléchargé.

### 38.5 — Encodage FLAC

Le WAV est déjà sans perte, mais lourd (~50 Mo pour 5 minutes). Le FLAC transporte exactement
le même signal pour environ 45 % de moins, et c'est déjà le format de la moitié des pistes
sources du dépôt — donc un export FLAC ne dégrade rien par rapport à la source.

Aucun navigateur ne sait encoder le FLAC nativement (`MediaRecorder` ne le propose pas de
manière fiable) : il faut une bibliothèque WebAssembly, `libflacjs` (portage Emscripten de
libFLAC, licence BSD).

- Installer `libflacjs` dans `package.json` et l'exposer par une route Express vers
  `node_modules/`, exactement comme WaveSurfer et AlphaTab (epic 34) — pas de dossier
  `vendor/` en dur, pas de CDN.
- Encoder depuis l'`AudioBuffer` rendu en story 38.2 : conversion en entiers 16 bits
  entrelacés, puis `FLAC__stream_encoder_process_interleaved` par blocs.
- Niveau de compression 5 (défaut de `flac`) — bon compromis vitesse / taille.
- Exécuter l'encodage dans un `Worker` : plusieurs secondes de calcul, l'interface ne doit
  pas se figer.

Autres formats sans perte écartés : ALAC (pas de bibliothèque navigateur maintenue),
WavPack et TAK (support quasi inexistant côté lecteurs). Le FLAC est le seul lossless
compressé lisible partout.

### 38.6 — Encodage MP3

Un fichier sans perte ne descend pas sous ~28 Mo pour 5 minutes, trop lourd pour un envoi par
messagerie. Un MP3 192 kbps stéréo fait ~7 Mo et couvre l'usage « écouter en voiture, envoyer
à quelqu'un ».

- Installer `lamejs` (portage JavaScript de LAME) dans `package.json` et l'exposer par une
  route Express vers `node_modules/`, comme `libflacjs` (story 38.5) et WaveSurfer (epic 34).
- Encoder depuis l'`AudioBuffer` rendu en story 38.2 : deux canaux en entiers 16 bits,
  `encodeBuffer(left, right)` par blocs de 1152 échantillons, puis `flush()`.
- Débit 192 kbps constant, 44,1 kHz — pas de réglage exposé à l'utilisateur.
- Encodage dans un `Worker`, comme le FLAC.

Note : la moitié des pistes sources sont déjà en MP3. Le mix exporté est donc, pour ces
grooves, un ré-encodage d'un signal déjà compressé avec perte. C'est assumé — 192 kbps sur des
sources d'origine du même ordre reste transparent à l'écoute pour l'usage visé, et c'est
précisément pour cela que le FLAC et le WAV restent proposés.

## Notes d'implémentation

- `decodeAudioData` décode en mémoire non compressée : 6 pistes × 5 min ≈ 320 Mo de RAM
  pendant le rendu. Acceptable sur ordinateur, à surveiller sur mobile — libérer les buffers
  sources dès `startRendering()` terminé.
- `OfflineAudioContext` impose une fréquence d'échantillonnage unique. Les pistes d'un groove
  proviennent du même export, donc partagent la même fréquence ; `decodeAudioData` rééchantillonne
  de toute façon vers celle du contexte.
- Le rendu ne passe pas par WaveSurfer : aucun risque d'interférence avec la lecture en cours,
  mais les deux peuvent tourner en même temps et se disputer le CPU. Mettre la lecture en pause
  avant de lancer le rendu.

## Critères d'acceptance

- Le bouton de téléchargement de l'en-tête ouvre un menu ; « Pistes séparées (zip) » se comporte
  exactement comme avant.
- « Mix stéréo (WAV) » télécharge un fichier `{slug}-mix.wav` lisible dans un lecteur audio standard.
- « Mix stéréo (FLAC) » télécharge un fichier `{slug}-mix.flac` lisible dans VLC, foobar2000 et
  l'Explorateur/Finder, d'un contenu strictement identique au WAV (comparaison bit à bit après
  décodage) et sensiblement plus petit.
- L'encodage FLAC ne fige pas l'interface (exécution dans un Worker).
- « Mix stéréo (MP3) » télécharge un fichier `{slug}-mix.mp3` de ~7 Mo pour 5 minutes, lisible
  partout, au même contenu musical que le FLAC.
- Les volumes et pans entendus dans le player sont reproduits à l'identique dans le fichier.
- Une piste mutée est absente du mix ; quand un solo est actif, seules les pistes en solo sont présentes.
- Un réglage modifié mais non sauvegardé est bien pris en compte dans l'export.
- Le tempo réglé à 80 % ou 120 % n'a aucun effet sur le fichier exporté.
- Une boucle IN/OUT définie et active n'a aucun effet : le fichier couvre toujours le groove entier.
- Pendant le rendu, l'entrée de menu est désactivée et indique la progression.
- Un mix qui sature est atténué et l'utilisateur en est informé.
- Aucun appel réseau supplémentaire au serveur en dehors du téléchargement des pistes.
