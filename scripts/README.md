# process-rehearsal — pipeline d'import de répétitions

Traite un dossier de répétition Soundcraft UI24R (FLAC multipistes + étiquettes Audacity) et produit des dossiers de grooves prêts à être consommés par la groovothèque.

## Dépendances

| Outil | Rôle |
|-------|------|
| `ffmpeg` + `ffprobe` | Traitement audio |
| `bc` | Calculs flottants en bash |
| `python3` + `pyyaml` | Lecture de la config YAML |

Installation rapide (Ubuntu/Debian) :
```bash
sudo apt install ffmpeg bc python3-yaml
```

## Usage

```bash
./scripts/process-rehearsal.sh [--keep-work] "path/to/dossier"
```

| Option | Description |
|--------|-------------|
| `--keep-work` | Conserve le dossier `_work/` après traitement (utile pour déboguer les FLAC intermédiaires) |

**Exemple :**
```bash
./scripts/process-rehearsal.sh "grooves/2026-06-06 Répétition"
./scripts/process-rehearsal.sh --keep-work "grooves/2026-06-06 Répétition"
```

Le dossier source doit contenir :
- Des fichiers `.flac` nommés selon la convention Soundcraft UI24R
- Un fichier `.txt` exporté depuis Audacity (points d'étiquettes, encodage UTF-8)

---

## Structure des sorties

Pour un dossier source `Ma Répétition/` avec 3 segments :

```
grooves/
  Ma Répétition/              ← dossier source (intact)
  Ma Répétition - 01/         ← segment 1
    01 BASS.mp3
    02 GUIT.mp3
    04 KEYS.mp3               ← nom sans suffixe MIX
    11 DRUMS.mp3
  Ma Répétition - 02 - Break/ ← segment 2 (label nommé dans Audacity)
    ...
  Ma Répétition - 03/
    ...
```

Les dossiers de sortie sont des **siblings** du dossier source. Relancer le script sur le même dossier **écrase** les sorties existantes avec un avertissement.

---

## Pipeline de traitement

```
Entrées FLAC  →  Mix stéréo  →  Compression  →  Normalisation  →  Découpe  →  MP3
```

1. **Mix stéréo** — fusionne les pistes composites définies dans `tracks.mixes` (ex : KEYS L + KEYS R → KEYS MIX)
2. **Compression** — `acompressor` ffmpeg, paramètres dans `audio.compression`
3. **Normalisation** — par peak ou par RMS selon les réglages par piste, avec limiteur safety à -1 dBFS
4. **Découpe** — chaque piste est découpée en segments selon les timecodes du fichier `.txt`
5. **Conversion MP3** — encodage CBR à la bitrate configurée, métadonnées supprimées

---

## Référence de configuration — `rehearsal-config.yaml`

### Section `audio`

```yaml
audio:
  mp3_bitrate: "320k"       # bitrate MP3 CBR (ex: "128k", "192k", "320k")
  normalize_peak_db: -1     # cible de peak par défaut pour toutes les pistes
  compression:
    threshold_db: -20       # seuil en dBFS au-dessus duquel le compresseur s'active
    ratio: 3                # ratio de compression (1 = aucune, 10 = forte)
    attack_ms: 20           # temps d'attaque en millisecondes
    release_ms: 200         # temps de relâchement en millisecondes
    knee_db: 6              # douceur de la transition (knee) en dB
```

### Section `tracks.mixes`

Définit les pistes composites à construire par mixage stéréo avant traitement.

```yaml
tracks:
  mixes:
    - output: "04 KEYS MIX"     # nom du fichier FLAC produit (sans extension)
      sources:
        - file: "04 KEYS L"     # nom du fichier source (sans .flac)
          pan: -100             # panoramique : -100 = full gauche, +100 = full droite, 0 = centre
        - file: "05 KEYS R"
          pan: 100
    - output: "11 DRUMS MIX"
      sources:
        - file: "11 DR KICK"
          pan: 20
        - file: "12 DR HH SD"
          pan: -20
```

**Règle de panoramique :** `pan` est une valeur entière de -100 à +100.

| `pan` | Position |
|-------|----------|
| `-100` | Extrême gauche (source uniquement dans le canal L) |
| `0` | Centre (source à égalité dans L et R) |
| `+100` | Extrême droite (source uniquement dans le canal R) |

Si un fichier source est absent, le mix entier est ignoré avec un avertissement (la session continuera sans cette piste mixée).

Le suffixe ` MIX` est automatiquement retiré du nom de fichier en sortie : `04 KEYS MIX` → `04 KEYS.mp3`.

### Section `tracks.exclude`

Pistes à ignorer complètement (ni dans les sorties, ni dans les mixes) :

```yaml
tracks:
  exclude:
    - "20 AMBIANCE"
    - "13 CLICK"
```

---

### Section `tracks.per_track` *(réglages par piste)*

Permet d'ajuster la normalisation et le niveau de chaque piste indépendamment. Toutes les clés sont **optionnelles** — les pistes non listées utilisent les valeurs globales de `audio`.

```yaml
tracks:
  per_track:
    "NOM DE PISTE":
      normalize_mode: peak    # ou rms — voir détails ci-dessous
      normalize_db: -1        # cible en dBFS (peak ou RMS selon le mode)
      gain_db: 0              # trim additionnel en dB après normalisation
```

#### `normalize_mode`

| Valeur | Comportement | Idéal pour |
|--------|-------------|------------|
| `peak` *(défaut)* | Amène le **pic maximum** à `normalize_db` | Instruments soutenus (guitare, claviers) |
| `rms` | Amène le **niveau moyen** à `normalize_db` | Instruments transitoires (basse, batterie) |

**Pourquoi distinguer peak et RMS ?**

La normalisation par peak garantit que chaque piste a le même niveau de crête. C'est correct pour les instruments avec une dynamique régulière. En revanche, la basse et la batterie ont des transitoires très élevées mais un niveau moyen bien plus bas : après normalisation par peak, ils sonnent plus doucement que les instruments soutenus à l'écoute.

La normalisation par RMS équilibre les niveaux selon l'énergie *perçue*, ce qui donne un résultat plus cohérent pour ces instruments.

#### `normalize_db`

Cible en dBFS. Son interprétation dépend du mode :

| Mode | Interprétation | Valeur typique |
|------|---------------|----------------|
| `peak` | Pic maximum après normalisation | `-1` (légèrement sous 0) |
| `rms` | Niveau moyen (mean) après normalisation | `-18` à `-12` |

#### `gain_db`

Trim additionnel appliqué **après** la normalisation. Permet d'ajuster finement le niveau d'une piste dans le mix final.

- Valeur positive → booste la piste
- Valeur négative → atténue la piste
- Un **limiteur safety automatique** à -1 dBFS est appliqué : si `gain_db` pousserait le pic au-delà de -1 dBFS, le gain est réduit en conséquence (avec un avertissement dans la console)

#### `compression` *(bloc optionnel)*

Surcharge les paramètres de compression globaux (`audio.compression`) pour cette piste uniquement. Toutes les clés sont optionnelles : seules les valeurs présentes remplacent le global.

```yaml
tracks:
  per_track:
    "01 BASS":
      compression:
        threshold_db: -30   # seuil en dBFS
        ratio: 5            # ratio de compression
        attack_ms: 30       # temps d'attaque en ms
        release_ms: 150     # temps de relâchement en ms
        knee_db: 4          # douceur de la transition
```

**Effets pratiques selon les paramètres :**

| Paramètre | Diminuer | Augmenter |
|-----------|---------|----------|
| `threshold_db` | Compresse plus tôt (plus de signal affecté) | Compresse seulement les pics |
| `ratio` | Compression plus douce | Compression plus agressive / effet limiteur |
| `attack_ms` | Attrape les transitoires dès le début | Laisse passer l'attaque avant de comprimer (son plus naturel) |
| `release_ms` | Son plus "pompant", réaction rapide | Compression plus lisse, moins audible |
| `knee_db` | Transition abrupte au seuil | Transition progressive (son plus naturel) |

**Recettes par type d'instrument :**

*Basse (DI ou micro ampli)* — apporter de la tenue et réduire les variations de jeu :
```yaml
compression:
  threshold_db: -30   # seuil bas : toute la dynamique est contrôlée
  ratio: 5
  attack_ms: 30       # laisse l'attaque de plectre passer
  release_ms: 150
  knee_db: 4
```

*Batterie (mix kick + caisse)* — punch et nivellement des coups :
```yaml
compression:
  threshold_db: -24
  ratio: 6
  attack_ms: 8        # attaque rapide pour attraper le transitoire
  release_ms: 80      # relâchement court = son plus percutant
  knee_db: 3
```

#### Exemple complet et commenté

```yaml
tracks:
  per_track:

    # Basse : normalisation RMS pour compenser les transitoires de plectre
    # -18 dBFS RMS ≈ niveau perçu équilibré avec une guitare normalisée par peak à -1 dBFS
    "01 BASS":
      normalize_mode: rms
      normalize_db: -18

    # Batterie : RMS car les coups de caisse claire/kick ont des pics très élevés
    # mais une énergie moyenne faible. On booste légèrement avec gain_db.
    "11 DRUMS MIX":
      normalize_mode: rms
      normalize_db: -12
      gain_db: 2

    # Guitare lead : mode peak standard, légèrement atténuée pour laisser de la place
    "03 LEAD":
      gain_db: -2

    # Claviers : peak standard, aucun réglage nécessaire (valeurs globales utilisées)
    # "04 KEYS MIX": absente → utilise audio.normalize_peak_db = -1

    # Guitare lead : compression globale, juste un trim pour équilibrer
    "03 LEAD":
      gain_db: -2
```

#### Guide de tuning rapide

Si après traitement une piste est **trop faible** :
- Passe en mode `rms` si elle est transitoire (basse, batterie)
- Augmente `normalize_db` (ex. `-18` → `-15`)
- Ajoute ou augmente `gain_db`

Si une piste est **trop forte** :
- Diminue `normalize_db` (ex. `-12` → `-15`)
- Réduit `gain_db` ou passe en négatif

Le limiteur safety garantit qu'aucun réglage ne peut écrêter au-delà de -1 dBFS.

---

## Format du fichier d'étiquettes Audacity

Le script attend le format d'export d'étiquettes d'Audacity (File → Export → Export Labels) :

```
16.773714	16.773714	
409.822633	409.822633	NomDuSegment
698.602519	698.602519	
```

- **Colonne 1** : timecode de début (secondes, virgule décimale)
- **Colonne 2** : timecode de fin (identique pour des labels ponctuels — ignoré)
- **Colonne 3** : nom du segment (optionnel) — apparaît dans le nom du dossier de sortie
- Séparateur : tabulation
- Encodage : UTF-8

Chaque ligne correspond au **début d'un segment**. Le segment se termine au début du suivant, ou à la fin de l'enregistrement pour le dernier.

Si le fichier contient des labels dont le timecode **dépasse la durée de l'enregistrement**, le script ignore ces segments avec un avertissement (pas de crash).
