# Epic 39 — Rendu audio des pistes MIDI

## Objectif

En mode mixte (fichier Guitar Pro + fichiers audio), AlphaTab tourne en `PlayerMode.EnabledExternalMedia` et ne synthétise rien : les pistes MIDI sont visibles dans le player mais muettes, et leurs réglages mute/solo/volume sont désactivés (décision actée en epic 35). Or AlphaTab sait rendre le MIDI hors-ligne **déjà aligné sur les points de synchro du fichier** (`AudioExportOptions.useSyncPoints`), donc sans dérive par rapport à l'enregistrement. Cette epic transforme chaque piste MIDI en piste audio ordinaire du player : forme d'onde, mute/solo/volume, boucle, export dans le mix — sans aucun cas particulier en aval.

## Dépendances

- Epic 35 complet (pistes AlphaTab dans le player)
- Epic 38 complet (export du mix — ses encodeurs FLAC/MP3 sont réutilisés)

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Moteur de rendu | `api.exportAudio(options)` d'AlphaTab 1.6+, qui « works with any PlayerMode active » — utilisable tel quel en média externe, sans seconde instance ni changement de mode |
| Alignement temporel | `useSyncPoints: true` (défaut) — AlphaTab étire lui-même le rendu sur les points de synchro du `.gp`, les mêmes qui pilotent déjà le curseur. Pas de time-stretch maison |
| Granularité | Une piste audio rendue **par piste MIDI**, pas un mixdown unique — c'est tout l'intérêt : les pistes restent mixables séparément |
| Isolation d'une piste | Une passe de rendu par piste, via `AudioExportOptions.trackVolume` : la piste ciblée à 1.0, toutes les autres à 0.0 |
| Métronome | `metronomeVolume: 0` — le métronome reste une piste audio du groove quand il existe |
| Déclenchement | Automatique à l'ouverture du groove, en tâche de fond et piste par piste. Le player reste utilisable pendant ce temps et les pistes apparaissent au fur et à mesure. Un bouton de repli, par ligne et global, ne sert qu'à relancer un rendu qui a échoué |
| Persistance | Fichiers écrits à plat dans le dossier du groove, sous `midi-<nom de piste>.flac`. L'utilisateur les a chez lui, comme toute autre piste. Le préfixe `midi-` est le seul marqueur : il dit au player qu'un rendu existe déjà, et il est retiré du nom affiché. Seule l'empreinte du `.gp` reste en cache |
| Format de stockage | FLAC via `encodeFlac()` de l'epic 38 — sans perte, et le soundfont produit déjà un son fragile qu'un second encodage destructif dégraderait |
| Invalidation | Empreinte du `.gp` (nom + taille + mtime), conservée dans `cache/<groove-path>/midi/fingerprint.json` avec la liste des fichiers produits ; un `.gp` modifié périme les rendus, qui sont effacés du dossier du groove et refaits à l'ouverture suivante. Seuls les fichiers que le player a écrits sont effaçables : un `midi-*.flac` déposé à la main reste une piste audio ordinaire |
| Statut des pistes une fois rendues | Pistes WaveSurfer ordinaires : le code de mix, de boucle et d'export de l'epic 38 les traite sans branche spécifique |
| Tempo | Les pistes rendues suivent l'étirement WaveSurfer comme les autres pistes audio. Pas de re-rendu au changement de tempo |
| Transposition / changement de soundfont | Hors périmètre — invaliderait le rendu, à traiter plus tard si le besoin apparaît |
| Mode tab-only | Inchangé : le synthétiseur joue en direct (`EnabledSynthesizer`), aucun rendu n'est proposé |

---

## Stories

### 39.1 — Rendu d'une piste MIDI en AudioBuffer

Encapsuler `api.exportAudio()` dans une fonction qui rend **une** piste du score et renvoie un `AudioBuffer`.

- `AudioExportOptions` : `sampleRate: 44100`, `useSyncPoints: true`, `metronomeVolume: 0`, `masterVolume: 1.0`
- `trackVolume` : `Map` avec la piste ciblée à 1.0 et toutes les autres à 0.0
- Boucle sur `exporter.render(ms)` jusqu'à ce qu'un chunk `undefined` signale la fin ; concaténer les `samples` (`Float32Array`, stéréo entrelacé)
- Appeler `exporter.destroy()` dans un `finally` — l'exporter tient un synthétiseur
- Utiliser `chunk.currentTime / chunk.endTime` pour alimenter une progression

### 39.2 — Rendu automatique à l'ouverture

Le rendu ne se demande pas : il se fait. À l'ouverture d'un groove en mode mixte, les
pistes MIDI qui n'ont pas encore de rendu dans le dossier sont rendues sans aucun clic.

- Le rendu part en tâche de fond, **séquentiellement** — une passe de synthèse monopolise
  déjà un worker AlphaTab et un worker FLAC, les lancer en parallèle ne ferait que ramer
- Le player reste utilisable pendant ce temps : affichage immédiat, transport non verrouillé,
  lecture possible
- Les pistes rendues apparaissent **au fur et à mesure**, chacune remplaçant son aire vide
  dès que son rendu est prêt. Une piste promue pendant la lecture est calée sur la position
  courante du transport et démarre en même temps que les autres
- Pendant le rendu d'une piste : progression visible sur la ligne concernée
- Les rendus déjà présents dans le dossier sont adoptés tels quels ; seules les pistes
  manquantes sont synthétisées
- Les contrôles mute/solo/volume restent désactivés tant que la piste n'est pas rendue, avec l'infobulle actuelle
- Repli en cas d'échec seulement : la ligne ratée retrouve un bouton « Réessayer le rendu en
  audio », et un bouton global relance les pistes restantes. Rien n'apparaît en marche nominale
- En tab-only, aucun rendu et aucun bouton

### 39.3 — Le rendu est un fichier du groove

Le rendu appartient à l'utilisateur : il vit dans son dossier, à côté de ses pistes, et se
comporte comme n'importe laquelle d'entre elles.

- `POST /api/midi-render/<groove-path>/<midi-nom.flac>` écrit le fichier dans le dossier du
  groove. C'est la **seule** route de l'epic : la lecture passe par `/audio/*`, le
  téléchargement par le zip, le mixage par `mix.json` — comme pour toute piste
- Garde de traversée de chemin à deux niveaux : le chemin du groove passe par
  `resolveGrooveDir()` (le résolu doit rester sous `GROOVES_DIR`), et le nom de fichier doit
  porter le préfixe `midi-`, l'extension `.flac`, et ne contenir aucun séparateur
- Le corps doit commencer par la signature `fLaC` : le dossier de l'utilisateur ne reçoit que
  ce que le fichier prétend être
- L'empreinte du `.gp` (nom, taille, mtime) et la liste des fichiers produits vont dans
  `cache/<groove-path>/midi/fingerprint.json` — elle n'intéresse pas l'utilisateur et n'a rien
  à faire chez lui
- La purge des rendus périmés a lieu à la porte d'entrée du player (`GET /api/grooves/*`) et
  avant le zip : le player ne voit jamais un rendu obsolète, et refait ceux qui manquent
- Les peaks suivent la règle commune des pistes audio : `cache/<groove-path>/<fichier>.peaks.json`
- À l'ouverture, le scan du dossier découvre les rendus comme des pistes audio. Le player les
  **rattache** à leur piste MIDI par leur nom de fichier au lieu d'ajouter une seconde ligne :
  une piste MIDI rendue n'apparaît qu'une fois
- Nom affiché : le préfixe `midi-` est retiré, le reste est laissé tel quel (les `_` deviennent
  des espaces comme partout, les `-` sont préservés)

### 39.4 — Les pistes rendues deviennent des pistes audio

Une fois rendue, une piste MIDI cesse d'être un cas particulier.

- Instance WaveSurfer créée via `loadBlob()`, insérée à la place de l'aire vide colorée de l'epic 35
- Mute / solo / volume activés, câblés sur le `GainNode` comme toute piste audio
- La piste entre dans `anySoloActive()` sans l'exception `tabExternal` actuelle
- Le bouton « afficher dans la tablature » reste présent : l'affichage dans la tab et le son sont deux choses distinctes
- La piste est incluse dans l'export de mix de l'epic 38 et dans le zip de téléchargement

### 39.5 — Rendu sans points de synchro

Un `.gp` sans `SyncPoint` reste rendable, mais l'alignement n'est alors plus garanti.

- Sans point de synchro, le rendu sort au tempo écrit de la partition
- Le rendu démarrant tout seul à l'ouverture, l'avertissement ne peut pas être une boîte de
  dialogue bloquante : c'est un marqueur « ⚠ » posé sur la ligne concernée, qui suit la piste
  une fois rendue et explique le risque de dérive en infobulle
- Le rendu se fait quand même : sur un morceau enregistré au clic, le tempo écrit suffit

---

## Critères d'acceptance

- [ ] En mode mixte, les pistes MIDI se rendent d'elles-mêmes à l'ouverture, sans clic ; en tab-only, aucun rendu et aucun bouton
- [ ] Pendant le rendu le player reste utilisable : la lecture démarre et avance, et les pistes apparaissent une à une
- [ ] Le rendu d'une piste produit une piste audio avec forme d'onde, insérée à la place de l'aire vide
- [ ] Une piste rendue est audible, et son mute / solo / volume agit sur le son
- [ ] Une piste rendue soloée coupe les pistes audio, et réciproquement
- [ ] Sur un `.gp` porteur de points de synchro, la piste rendue reste calée sur les pistes audio d'un bout à l'autre du morceau
- [ ] Le rendu est écrit dans le dossier du groove sous `midi-<nom de piste>.flac` ; seule l'empreinte du `.gp` reste en cache
- [ ] Une piste MIDI rendue n'apparaît qu'une seule fois dans le player, sous son nom de piste sans le préfixe `midi-`
- [ ] À la seconde ouverture du groove, les pistes rendues se chargent sans nouvelle synthèse
- [ ] Modifier le `.gp` périme les rendus : ils sont effacés du dossier et refaits à l'ouverture suivante
- [ ] Une piste rendue est incluse dans l'export de mix et dans le zip de téléchargement, une seule fois
- [ ] Les réglages de volume et de pan d'une piste rendue sont sauvegardés et rechargés comme ceux de toute autre piste
- [ ] Un `.gp` sans point de synchro affiche un marqueur d'avertissement sur ses lignes, sans bloquer le rendu
- [ ] Un chemin de groove contenant `..`, ou un nom de fichier hors convention `midi-*.flac`, est rejeté par `POST /api/midi-render/*`
