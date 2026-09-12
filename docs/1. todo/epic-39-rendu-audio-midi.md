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
| Pistes partageant un canal MIDI | AlphaTab retraduit `trackVolume` en canaux : deux pistes sur le même canal s'écrasent, la dernière gagne. Le cas est la règle et non l'exception — **toutes les percussions d'un `.gp` sont sur le canal 10**, que General MIDI réserve à la batterie et que `Score.finish()` leur impose. Sur « Just the two of us » (Drums, Congas, Tambourin, Agogo), Drums / Congas / Tambourin sortaient à pic 0,000000 et « Agogo » contenait les quatre pistes mélangées. Correctif : avant l'export, les pistes qui partagent le canal de la piste visée sont déplacées sur des canaux libres. Elles sont à volume nul, le timbre qu'elles y prennent n'a aucun effet ; la piste visée garde son canal, le 10 portant le kit de batterie du soundfont. Pas de dégradation de la promesse : les pistes restent rendues et mixables séparément |
| Métronome | `metronomeVolume: 0` — le métronome reste une piste audio du groove quand il existe |
| Déclenchement | Automatique à l'ouverture du groove, en tâche de fond et piste par piste. Le player reste utilisable pendant ce temps et les pistes apparaissent au fur et à mesure. Un bouton de repli, par ligne et global, ne sert qu'à relancer un rendu qui a échoué |
| Persistance | Fichiers écrits à plat dans le dossier du groove, sous `midi-<nom de piste>.flac`. L'utilisateur les a chez lui, comme toute autre piste. Le préfixe `midi-` est le seul marqueur : il dit au player qu'un rendu existe déjà, et il est retiré du nom affiché. Seule l'empreinte du `.gp` reste en cache |
| Format de stockage | FLAC via `encodeFlac()` de l'epic 38 — sans perte, et le soundfont produit déjà un son fragile qu'un second encodage destructif dégraderait |
| Invalidation | Empreinte du `.gp` (nom + taille + mtime) **et du soundfont retenu** (nom + taille), conservée dans `cache/<groove-path>/midi/fingerprint.json` avec la liste des fichiers produits ; un `.gp` modifié périme les rendus, qui sont effacés du dossier du groove et refaits à l'ouverture suivante. Seuls les fichiers que le player a écrits sont effaçables : un `midi-*.flac` déposé à la main reste une piste audio ordinaire |
| Statut des pistes une fois rendues | Pistes WaveSurfer ordinaires : le code de mix, de boucle et d'export de l'epic 38 les traite sans branche spécifique |
| Tempo | Les pistes rendues suivent l'étirement WaveSurfer comme les autres pistes audio. Pas de re-rendu au changement de tempo |
| Soundfont | Paramétrable dans `config.json` (clé `soundFont`), une seule valeur pour le rendu hors-ligne **et** la lecture directe du synthétiseur. Défaut `MuseScore_General.sf3` (MIT, 38 Mo) ; le fichier vit dans `soundfonts/`, ignoré par git, récupéré par `scripts/fetch-soundfont.sh`. Absent, repli sur le `sonivox.sf2` livré avec AlphaTab : un clone frais est fonctionnel sans étape manuelle. Valeurs et compromis documentés dans le README |
| Changement de soundfont | Le soundfont entre dans l'empreinte : en changer périme les `midi-*.flac`, qui sont effacés et refaits à l'ouverture suivante. Un seul soundfont à la fois — AlphaTab sait les empiler, mais la clé de config est unique |
| Samples stéréo du soundfont | AlphaTab n'ouvre que les samples mono et écarte les samples stéréo **en gardant les régions qui les référencent** : ces régions lisent hors d'un tableau vide et produisent des `NaN`. `NaN × 0 = NaN`, donc une seule piste fautive — même à volume nul — détruit le rendu de toutes les autres, et la voix ne s'éteint jamais. Correctif : `scripts/fetch-soundfont.sh` repasse le soundfont en mono à l'installation (`scripts/sf-mono.js` réécrit `sfSampleType` dans le chunk `shdr`, 2 octets par sample, aucune donnée audio touchée). Pas de changement de banque : sonivox est immunisé mais nettement plus pauvre, et le problème ne venait pas du choix de la banque |
| Empreinte du soundfont | Nom + taille ne suffisent pas : la conversion mono ne change pas la taille du fichier. L'empreinte retient **nom + taille + nombre de samples stéréo**, que le serveur compte une fois et garde en cache |
| Version du moteur de rendu | `MIDI_RENDER_VERSION` (dans `server.js`) entre dans l'empreinte. À incrémenter dès qu'un changement modifie le son produit à `.gp` et soundfont identiques — le niveau de sortie, par exemple. Version 2 : conversion mono + `masterVolume` à 0,5. Version 3 : isolation par canal MIDI (percussions et métronome) |
| Niveau de sortie | `masterVolume: 0.5` et non 1,0 : à plein volume le synthétiseur écrête (piste Drums de *Babooshka* à +2,1 dBFS, rabotée par l'encodage 16 bits). À 0,5 le pire cas tombe à −3,9 dBFS et le volume de piste du player rattrape la différence |
| Fuite du métronome | Réglée par le même mécanisme. `AlphaSynthAudioExporter` initialise son canal de métronome sur l'indice 16, puis `setup()` relit le volume voulu par `channelGetMixVolume(16)` : sur un score où ce canal appartient à une vraie piste, l'isoler y posait 1,0 et rallumait le clic malgré `metronomeVolume: 0` (constaté sur « Piano RH » de *Babooshka* — un clic sur chaque temps). L'exporteur reste inatteignable (worker, interface réduite à `initialize` / `render` / `destroy`), mais rien n'oblige la piste à rester sur ce canal : elle en est écartée le temps de l'export, banque et programme étant réémis par canal. Mesuré sur « Piano RH » : pic de −20,4 à −33,2 dBFS, 522 attaques ramenées à 236, les neuf autres pistes inchangées |
| Transposition | Hors périmètre — invaliderait le rendu, à traiter plus tard si le besoin apparaît |
| Distinction visuelle | Une piste MIDI se reconnaît à l'œil : toute sa ligne est teintée de la couleur que l'epic 35 attribue à la piste, avec un liseré de la même couleur à gauche. Assez discret pour ne pas gêner la lecture de la forme d'onde. La teinte vaut avant et après le rendu, et la couleur d'une piste ne change pas d'une session à l'autre |
| Mode tab-only | Rendu aussi. Les pistes MIDI d'un groove sans aucun fichier audio sont rendues et sauvegardées comme les autres. AlphaTab ne sachant pas changer de `PlayerMode` après coup, la piste rendue n'est **pas** promue à chaud : le synthétiseur continue de jouer et de porter curseur et transport, puis, une fois les rendus écrits, le player se recharge — à l'arrêt de la lecture, jamais en plein morceau. Le groove rouvre alors en mode mixte ordinaire, pistes WaveSurfer comprises, sans aucune horloge ni branche nouvelle |

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
- En tab-only le rendu part aussi tout seul, mais la piste n'est pas promue à chaud : la ligne
  affiche « Rendu enregistré ✓ » et le player se recharge une fois la série finie, à l'arrêt
  de la lecture. Le groove revient alors en mode mixte, où tout est le chemin déjà éprouvé.
  Si l'écriture du fichier échoue, rien n'est promu ni rechargé : la ligne garde son bouton de repli

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

- [ ] Les pistes MIDI se rendent d'elles-mêmes à l'ouverture, sans clic, en mode mixte comme en tab-only
- [ ] En tab-only, curseur de tablature et transport restent pilotés par le synthétiseur pendant le rendu, et le player se recharge ensuite en mode mixte : curseur et transport corrects, aucune piste en double
- [ ] Pendant le rendu le player reste utilisable : la lecture démarre et avance, et les pistes apparaissent une à une
- [ ] Le rendu d'une piste produit une piste audio avec forme d'onde, insérée à la place de l'aire vide
- [ ] Une piste rendue est audible, et son mute / solo / volume agit sur le son
- [ ] Une piste rendue soloée coupe les pistes audio, et réciproquement
- [ ] Sur un `.gp` porteur de points de synchro, la piste rendue reste calée sur les pistes audio d'un bout à l'autre du morceau
- [ ] Le rendu est écrit dans le dossier du groove sous `midi-<nom de piste>.flac` ; seule l'empreinte du `.gp` reste en cache
- [ ] Une piste MIDI rendue n'apparaît qu'une seule fois dans le player, sous son nom de piste sans le préfixe `midi-`
- [ ] À la seconde ouverture du groove, les pistes rendues se chargent sans nouvelle synthèse
- [ ] Modifier le `.gp` périme les rendus : ils sont effacés du dossier et refaits à l'ouverture suivante
- [ ] Changer `soundFont` dans `config.json` périme les rendus de la même façon, et le nouveau rendu s'entend
- [ ] Le soundfont configuré sert au rendu comme à la lecture directe ; absent, le serveur retombe sur `sonivox.sf2` sans rien casser
- [ ] Une piste MIDI se distingue à l'œil d'une piste audio, avant comme après son rendu
- [ ] Une piste rendue est incluse dans l'export de mix et dans le zip de téléchargement, une seule fois
- [ ] Les réglages de volume et de pan d'une piste rendue sont sauvegardés et rechargés comme ceux de toute autre piste
- [ ] Un `.gp` sans point de synchro affiche un marqueur d'avertissement sur ses lignes, sans bloquer le rendu
- [ ] Un chemin de groove contenant `..`, ou un nom de fichier hors convention `midi-*.flac`, est rejeté par `POST /api/midi-render/*`
