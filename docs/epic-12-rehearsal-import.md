# Epic 12 — Script d'import de répétitions

## Objectif

Automatiser le pipeline de traitement audio entre les enregistrements bruts de la Soundcraft UI24R et les grooves prêts à être consommés par la groovothèque. Le script prend un dossier de répétition (fichiers FLAC multipistes + fichier d'étiquettes Audacity) et produit autant de dossiers de sortie que de segments, avec les pistes traitées en MP3.

## Dépendances

- `ffmpeg` installé sur la machine
- Aucune dépendance Node.js — script bash autonome, indépendant de l'app

## Contexte technique

### Entrées

Un dossier de répétition contient :
- Des fichiers FLAC nommés selon la convention Soundcraft UI24R (`01 BASS.flac`, `02 GUIT.flac`, `04 KEYS L.flac`, `05 KEYS R.flac`, `11 DR KICK.flac`, `12 DR HH SD.flac`, `20 AMBIANCE.flac`, etc.)
- Un fichier `.txt` (format export Audacity) listant les points de découpe :
  ```
  16.773714	16.773714	
  409.822633	409.822633	NomOptionnel
  ```
  Chaque ligne = un point de début de segment. Les noms de labels sont optionnels.

### Pipeline

```
1. Mix        : KEYS L + KEYS R  →  KEYS MIX.flac  (full length)
                DR KICK + DR HH SD  →  DRUMS MIX.flac  (full length)
2. Compress   : acompressor (transparent) sur chaque piste full length
3. Normalize  : peak -1dBFS sur chaque piste compressée (2 passes ffmpeg)
4. Découpe    : chaque piste normalisée découpée en N segments selon étiquettes
5. Conversion : chaque segment → MP3 320 kbps CBR
6. Nettoyage  : suppression du dossier _work/ (sauf --keep-work)
```

### Sorties

Pour un dossier source `Ma Répétition/` avec N segments :
```
grooves/
  Ma Répétition/                    ← dossier source (intact)
  Ma Répétition - 01/               ← segment 1
    01 BASS.mp3
    02 GUIT.mp3
    04 KEYS.mp3
    11 DRUMS.mp3
    ...
  Ma Répétition - 02 - Titre/       ← segment 2 (si label nommé)
    ...
  Ma Répétition - 03/
    ...
```

Les dossiers de sortie sont des **siblings** du dossier source dans `grooves/`. Les fichiers mixés perdent le suffixe `MIX` en sortie (`04 KEYS MIX` → `04 KEYS.mp3`).

## Stories

### 12.1 — Structure et config globale

- Créer `scripts/process-rehearsal.sh` (exécutable)
- Créer `scripts/rehearsal-config.yaml` — config globale commitée, exemple :

```yaml
audio:
  mp3_bitrate: "320k"
  normalize_peak_db: -1
  compression:
    threshold_db: -20
    ratio: 3
    attack_ms: 20
    release_ms: 200
    knee_db: 6

tracks:
  mixes:
    - output: "04 KEYS MIX"
      sources:
        - file: "04 KEYS L"
          pan: -100        # -100 = full left, +100 = full right, 0 = center
        - file: "05 KEYS R"
          pan: 100
    - output: "11 DRUMS MIX"
      sources:
        - file: "11 DR KICK"
          pan: 20
        - file: "12 DR HH SD"
          pan: -20

  exclude:
    - "20 AMBIANCE"
```

- Ajouter `scripts/rehearsal-config.yaml` au `.gitignore` ou le committer selon les préférences (données non sensibles → committer)

### 12.2 — Interface CLI

Invocation :
```bash
./scripts/process-rehearsal.sh [--keep-work] "path/to/dossier"
```

- Argument positionnel : chemin vers le dossier de répétition (absolu ou relatif)
- `--keep-work` : conserve le dossier `_work/` après traitement (debug)
- Validation à l'entrée :
  - Dossier existe
  - Au moins un `.flac` présent
  - Exactement un `.txt` présent (warning si plusieurs → prend le plus récent)
- Affichage de progression sur stdout avec étapes numérotées

### 12.3 — Parsing des étiquettes

- Lire le fichier `.txt` (encoding UTF-8, séparateur tabulation)
- Extraire les timecodes de la colonne 1 (float, secondes)
- Extraire les noms optionnels de la colonne 3 (peut être vide ou absent)
- Construire la liste des segments : `[{start, end, label}]`
  - `end` du segment N = `start` du segment N+1
  - Dernier segment : `end` = durée totale du fichier (détectée via `ffprobe`)
- Numérotation en base 1, zero-padded sur 2 chiffres minimum (`01`, `02`...)

### 12.4 — Mix stéréo des pistes composites

Pour chaque groupe `mixes` de la config :
- Vérifier que les fichiers sources existent (skip avec warning si absents)
- Calculer les gains L/R à partir de la valeur `pan` (-100..+100) :
  - `gain_L = (100 - pan) / 100`
  - `gain_R = (100 + pan) / 100`
- Fusionner avec le filtre ffmpeg `amix` + `pan` :
  ```bash
  ffmpeg -i source1.flac -i source2.flac \
    -filter_complex "[0:a]pan=stereo|c0=GL0*c0|c1=GR0*c0[a0];
                     [1:a]pan=stereo|c0=GL1*c0|c1=GR1*c0[a1];
                     [a0][a1]amix=inputs=2:normalize=0[out]" \
    -map "[out]" _work/04\ KEYS\ MIX.flac
  ```
- Sortie dans `_work/`

### 12.5 — Compression et normalisation (full length)

Pour chaque piste à traiter (fichiers FLAC source non-exclus + fichiers MIX générés) :

**Passe 1 — Compression**
```bash
ffmpeg -i input.flac \
  -af "acompressor=threshold=-20dB:ratio=3:attack=20:release=200:knee=6dB:makeup=1" \
  _work/compressed/TRACK.flac
```

**Passe 2a — Détection du peak**
```bash
ffmpeg -i _work/compressed/TRACK.flac -af volumedetect -f null /dev/null 2>&1 \
  | grep max_volume
```

**Passe 2b — Application du gain de normalisation**
```bash
gain=$(echo "-1 - $max_vol" | bc -l)
ffmpeg -i _work/compressed/TRACK.flac -af "volume=${gain}dB" \
  _work/normalized/TRACK.flac
```

### 12.6 — Découpe en segments

Pour chaque segment `{start, end, label, n}` et chaque piste normalisée :
```bash
ffmpeg -i _work/normalized/TRACK.flac \
  -ss "$start" -to "$end" \
  -c copy \
  _work/segments/NN/TRACK.flac
```
- `-c copy` évite le réencodage (découpe par keyframe, précision suffisante sur FLAC)

### 12.7 — Conversion MP3 et dossiers de sortie

Pour chaque segment :
- Construire le nom du dossier de sortie :
  - Sans label : `{nom_source} - NN`
  - Avec label : `{nom_source} - NN - {label}`
- Si le dossier existe déjà : afficher `⚠ Écrasement de {dossier}...` et supprimer
- Pour chaque piste du segment :
  - Nommer le fichier de sortie en supprimant le suffixe ` MIX` du nom de piste
  - Convertir en MP3 320 kbps CBR :
    ```bash
    ffmpeg -i segment.flac -b:a 320k -map_metadata -1 output.mp3
    ```

### 12.8 — Nettoyage

- Par défaut : supprimer `_work/` à la fin du traitement
- Avec `--keep-work` : conserver `_work/` pour inspection
- Afficher un résumé en fin de script : nombre de segments produits, dossiers créés, durée totale

## Critères d'acceptance

- `./scripts/process-rehearsal.sh "grooves/Exemple de répétition complète"` produit autant de dossiers siblings que de segments dans le fichier `.txt`
- Chaque dossier de sortie contient un `.mp3` par piste non-exclue
- `04 KEYS MIX` et `11 DRUMS MIX` apparaissent comme `04 KEYS.mp3` et `11 DRUMS.mp3` en sortie
- `20 AMBIANCE` n'apparaît pas en sortie
- Relancer le script sur le même dossier écrase les sorties existantes avec warning
- `--keep-work` conserve les FLAC intermédiaires dans `_work/`
- Les MP3 produits sont audibles et non-dégradés à 50% de tempo dans le player groovothèque

## Notes d'implémentation

- `yq` ou `python3 -c "import yaml"` nécessaire pour parser la config YAML depuis bash. Si absent, envisager un format de config bash-natif (fichier `.env` avec variables) pour éviter une dépendance.
- La précision de découpe ffmpeg avec `-c copy` sur FLAC est au sample près — pas de dérive perceptible.
- Si une piste source est absente (musicien absent ce soir-là), le script skip avec warning et continue — le segment de sortie aura simplement une piste de moins.
- Tester le pipeline d'abord sur un court extrait (ex: 2 premières minutes) avant de lancer sur une répétition complète de plusieurs heures.
