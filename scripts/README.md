# process-rehearsal — pipeline d'import de répétitions

Traite un dossier de répétition Soundcraft UI24R (FLAC multipistes + étiquettes Audacity) et produit des dossiers de grooves prêts à être consommés par la groovothèque.

## Dépendances

| Outil | Rôle |
|-------|------|
| `ffmpeg` + `ffprobe` | Traitement audio |
| `bc` | Calculs flottants en bash |
| `python3` + `pyyaml` | Lecture de la config YAML |
| `aubio-tools` | Détection BPM automatique *(optionnel)* |

Installation rapide (Ubuntu/Debian) :
```bash
sudo ./scripts/setup.sh
```

Ou manuellement :
```bash
sudo apt install ffmpeg bc python3-yaml aubio-tools
```

Si `aubio-tools` est absent, le pipeline se termine normalement — les fiches `.md` ne sont simplement pas générées.

## Usage

```bash
./scripts/process-rehearsal.sh [--keep-work] [--only-track "NOM"] "path/to/dossier"
```

| Option | Description |
|--------|-------------|
| `--keep-work` | Conserve le dossier `_work/` après traitement (utile pour déboguer les FLAC intermédiaires) |
| `--only-track "NOM"` | Retraite uniquement la piste nommée (tous les steps de sa chaîne `effects:`). Si la piste est source d'un mix, retraite aussi toutes les sources de ce mix et reconstruit le mix. Erreur fatale si le nom est inconnu. |

**Exemple :**
```bash
./scripts/process-rehearsal.sh "grooves/2026-06-06 Répétition"
./scripts/process-rehearsal.sh --keep-work "grooves/2026-06-06 Répétition"
./scripts/process-rehearsal.sh --only-track "01 BASS" "grooves/2026-06-06 Répétition"
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
Entrées FLAC  →  Mix stéréo  →  Chaîne effects  →  Découpe  →  MP3
```

1. **Mix stéréo** — fusionne les pistes composites définies dans `tracks.mixes` (ex : KEYS L + KEYS R → KEYS MIX)
2. **Chaîne effects** — exécute dans l'ordre les steps définis dans `effects:` pour la piste (`compress`, `normalize`, `gain`, `pan`). Une piste sans `effects:` passe en silence avec un avertissement.
3. **Découpe** — chaque piste est découpée en segments selon les timecodes du fichier `.txt`
4. **Conversion MP3** — encodage CBR à la bitrate configurée, métadonnées supprimées

---

## Référence de configuration — `process-rehearsal.yaml`

### Section `audio`

```yaml
audio:
  mp3_bitrate: "320k"       # bitrate MP3 CBR (ex: "128k", "192k", "320k")
  normalize_peak_db: -1     # cible de peak par défaut pour toutes les pistes
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

Les sorties de mix peuvent elles aussi recevoir une chaîne `effects:` dans `tracks.per_track` (ex. compression ou gain sur le mix final) — voir la section `per_track` ci-dessous.

### Section `tracks.exclude`

Pistes à ignorer complètement (ni dans les sorties, ni dans les mixes) :

```yaml
tracks:
  exclude:
    - "20 AMBIANCE"
    - "13 CLICK"
```

---

### Section `tracks.per_track` *(chaîne d'effets par piste)*

Définit la chaîne d'effets ordonnée pour chaque piste. La clé `effects:` est une liste de steps exécutés dans l'ordre. Une piste absente de `per_track` (ou sans clé `effects:`) est traitée en passthrough avec un avertissement `[WARN]`.

```yaml
tracks:
  per_track:
    "NOM DE PISTE":
      effects:
        - type: compress
          preset: "Bass Guitar"
        - type: normalize
        - type: gain
          db: -3
```

#### Types de steps

##### `compress`

Active la compression dynamique via Audacity. Un `preset:` nommé est obligatoire ; des paramètres inline peuvent surcharger le preset.

```yaml
- type: compress
  preset: "Bass Guitar"   # preset Audacity (obligatoire)
```

##### `normalize`

Normalise la piste. Cible par défaut : -1 dBFS (peak). Paramètre optionnel :

```yaml
- type: normalize
  target_db: -1           # cible en dBFS (défaut : -1)
```

##### `gain`

Trim en dB appliqué directement. Valeur obligatoire.

```yaml
- type: gain
  db: -3                  # positif = boost, négatif = atténuation
```

##### `pan`

Panoramique de la piste. Valeur obligatoire dans la plage -100..+100.

```yaml
- type: pan
  position: -20           # -100 = full gauche, 0 = centre, +100 = full droite
```

#### Exemple complet et commenté

```yaml
tracks:
  per_track:

    # Basse : compression puis normalisation
    "01 BASS":
      effects:
        - type: compress
          preset: "Bass Guitar"
        - type: normalize
          target_db: -1

    # Batterie : compression puis normalisation légèrement renforcée
    "11 DRUMS MIX":
      effects:
        - type: compress
          preset: "Drums"
        - type: normalize
          target_db: -1
        - type: gain
          db: 2

    # Guitare lead : normalisation seule, légèrement atténuée
    "03 LEAD":
      effects:
        - type: normalize
        - type: gain
          db: -2

    # Claviers : normalisation seule, valeurs par défaut
    "04 KEYS MIX":
      effects:
        - type: normalize
```

#### Guide de tuning rapide

Si après traitement une piste est **trop faible** :
- Ajoute un step `gain` avec une valeur positive (ex. `db: 2`)
- Ajuste la cible `normalize` (ex. `target_db: -2`)

Si une piste est **trop forte** :
- Ajoute un step `gain` avec une valeur négative (ex. `db: -3`)
- Ajuste la cible `normalize` à la hausse (ex. `target_db: -6`)

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
