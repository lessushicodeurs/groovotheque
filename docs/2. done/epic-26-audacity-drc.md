# Epic 26 — Traitement des pistes via Audacity DRC (remplacement ffmpeg)

## Objectif

Le script `process-rehearsal.sh` utilise ffmpeg pour la compression et la normalisation de chaque piste audio. Des jours de travail n'ont pas permis de répliquer avec ffmpeg le résultat obtenu en 3 clics dans Audacity (Compressor → Normalize → Save). La cause racine est documentée dans `docs/audacity-presets/compressor.md` : le DRC d'Audacity possède `lookaheadMs` et `makeupGainDb` qui n'ont pas d'équivalent dans `acompressor` de ffmpeg. Cette epic remplace la chaîne ffmpeg compress/normalize par des appels au VRAI DRC d'Audacity 3.7.7 via mod-script-pipe.

## Dépendances

- Epic 12 complet (rehearsal-import — pipeline process-rehearsal.sh)
- *(aucune)* autre dépendance

---

## Décisions de conception

| Sujet                      | Décision                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Mécanisme d'appel Audacity | mod-script-pipe (IPC via pipes nommés — seul mécanisme appelant le VRAI DRC natif)         |
| CLI-Anything Audacity      | Écarté — réimplémentation Python basique sans lookahead, pas le vrai DRC                   |
| Outil Audacity             | Flatpak 3.7.7 (`flatpak run org.audacityteam.Audacity`)                                    |
| Démarrage Audacity         | Auto-start si pipe absent, réutilisation si déjà ouvert (cas normal : étiquettes en cours) |
| dynaudnorm                 | Supprimé — workaround pour les limitations de ffmpeg, inutile avec le vrai DRC             |
| Étapes ffmpeg conservées   | Mix composites (amix + pan), découpe segments (-ss -to -c copy), encodage MP3 320k         |
| Config preset              | Référence par nom (`preset: "Lead Vocals"`) ET paramètres directs supportés                |
| Nouveaux paramètres config | `lookahead` et `makeup` ajoutés aux blocs `compression`                                    |
| Helper                     | Script Python dédié `scripts/audacity_process.py`                                          |

---

## Prérequis utilisateur (one-time setup)

mod-script-pipe doit être activé dans Audacity avant la première utilisation :
Edit → Preferences → Modules → mod-script-pipe : Enabled → redémarrer Audacity.

---

## Stories

### 26.1 — Helper `scripts/audacity_process.py`

Créer un script Python qui pilote Audacity via mod-script-pipe pour appliquer la chaîne complète **compressor → normalize → gain** sur un fichier FLAC.

La chaîne s'applique dans cet ordre fixe pour chaque piste :
1. **Compressor** (optionnel — si `--preset` ou paramètres directs fournis)
2. **Normalize** (toujours — `audio.normalize_peak_db` global, défaut -1 dBFS)
3. **Gain** (optionnel — si `--gain` fourni)

Comportement du script :
- Détecte si le pipe `/tmp/audacity_script_pipe.to.<uid>` existe
- Si non : lance `flatpak run org.audacityteam.Audacity` en arrière-plan, attend le pipe (timeout 30 s, erreur explicite sinon)
- Pour chaque fichier FLAC passé en argument :
  - `OpenFiles: Filename=<path>`
  - `SelectAll`
  - Si compression configurée : applique DRC Compressor (preset ou paramètres directs)
  - `Normalize: PeakLevel=<normalize_peak_db>` (toujours)
  - Si `--gain` non nul : `Amplify: Ratio=<gain_factor>` (gain_factor = 10^(gain_db/20))
  - `Export2: Filename=<path>` (FLAC, sur place)
  - `Close: SaveChanges=No`
- Ne quitte pas Audacity à la fin (laisser l'instance ouverte)
- Si `--preset <nom>` est fourni, résout les paramètres depuis la table de presets embarquée (issue de `docs/audacity-presets/compressor.md`)

Interface CLI :
```
# Compression via preset + normalize global + gain optionnel
python3 scripts/audacity_process.py \
  --preset "Lead Vocals" \
  --normalize -1 \
  [--gain 2] \
  track.flac

# Compression via paramètres directs
python3 scripts/audacity_process.py \
  --threshold -14 --ratio 5.2 --attack 1 --release 60 \
  --knee 5.5 --lookahead 1 --makeup 0 \
  --normalize -1 \
  track.flac

# Normalize seule (piste sans compression, ex. GUIT MIX)
python3 scripts/audacity_process.py \
  --normalize -1 \
  --gain -8 \
  track.flac
```

### 26.2 — Mise à jour `scripts/rehearsal-config.yaml`

Adapter la config pour le nouveau pipeline. Les blocs `compression` passent en syntaxe preset ; les pistes sans compression conservent uniquement `gain_db`.

- Supprimer `dynaudnorm` de toutes les pistes
- Supprimer les paramètres `target` et `mode` (normalisation peak désormais gérée par l'helper)
- Remplacer les blocs `compression` par les presets définis ci-dessous

Config cible par piste :

```yaml
"01 BASS":
  compression:
    preset: "Bass Guitar"

"02 GUIT MIX":
  gain_db: -8

"04 KEYS MIX":
  gain_db: -14

"09 BACKING VOC":
  compression:
    preset: "Lead Vocals"

"10 LEAD VOCAL":
  compression:
    preset: "Lead Vocals"

"11 DR KICK":
  compression:
    preset: "Kick Drums"

"12 DR HH SD":
  compression:
    preset: "Modern"
```

Les deux syntaxes restent supportées (preset par nom OU paramètres directs avec `lookahead` et `makeup`) pour permettre des ajustements futurs sans être contraint aux presets.

### 26.3 — Mise à jour `scripts/setup.sh`

Ajouter la vérification des outils requis par le pipeline Audacity.

- Vérifier que `flatpak` est installé (apt-get si absent)
- Vérifier que le Flatpak `org.audacityteam.Audacity` est installé (`flatpak list`)
- Si absent : installer via `flatpak install flathub org.audacityteam.Audacity`
- Afficher un rappel sur le prérequis mod-script-pipe (ne peut pas être automatisé) :
  > "⚠ Activer mod-script-pipe dans Audacity : Edit → Preferences → Modules → mod-script-pipe: Enabled → redémarrer Audacity"
- Aucun nouveau paquet apt requis (Python stdlib suffit pour `audacity_process.py`)

### 26.5 — Multi-pass : répétition de la chaîne compressor → normalize

Permettre de répéter la chaîne **compressor → normalize** plusieurs fois sur une même piste via un marqueur `multi_pass` dans le bloc `compression` du YAML.

Avec `multi_pass: 2`, la chaîne appliquée est :  
**compressor → normalize → compressor → normalize → gain** (le gain reste unique, après toutes les passes).

Config YAML :
```yaml
"01 BASS":
  multi_pass: 2
  compression:
    preset: "Bass Guitar"
```

Interface CLI :
```
python3 scripts/audacity_process.py --preset "Bass Guitar" --multi-pass 2 --normalize -1 track.flac
```

Règles :
- `multi_pass: 1` (ou absent) → comportement identique à avant
- La compression est requise pour que `multi_pass > 1` ait un sens (si aucun preset/paramètre, les passes n'appliquent que normalize plusieurs fois — comportement permis mais sans intérêt pratique)
- `multi_pass` est directement sous la piste (pas un paramètre global, pas dans le bloc `compression`)

### 26.4 — Mise à jour `scripts/process-rehearsal.sh`

Supprimer les étapes ffmpeg de compression et normalisation, les remplacer par l'appel à `audacity_process.py`.

- Supprimer l'étape 2 : compression ffmpeg (`acompressor`)
- Supprimer l'étape 3 : détection de niveau (`volumedetect`), calcul de gain, normalisation (`volume=`), `dynaudnorm`
- Remplacer par un appel à `audacity_process.py` par piste, avec les paramètres issus du YAML
- Le fichier de sortie (`${WORK_DIR}/normalized/${name}.flac`) est produit directement par l'helper
- Les étapes 1 (mix), 4 (découpe), 5 (MP3) restent strictement inchangées

---

## Critères d'acceptance

- [ ] `process-rehearsal.sh` ne contient plus aucune occurrence de `acompressor`, `dynaudnorm`, `volumedetect`, `volume=` (filtre audio ffmpeg)
- [ ] `rehearsal-config.yaml` ne contient plus `dynaudnorm`, ni `target`, ni `mode` au sens normalisation ffmpeg
- [ ] Les paramètres de la section `audio` (notamment `normalize_peak_db`) s'appliquent par défaut à toutes les pistes et peuvent être surchargés par piste dans `tracks.per_track` — ex. une piste avec `normalize_peak_db: -3` utilise -3 dBFS au lieu du défaut global
- [ ] La chaîne **compressor → normalize → gain** est appliquée dans cet ordre pour toutes les pistes — normalize s'exécute toujours (valeur globale `audio.normalize_peak_db` sauf surcharge par piste), compressor et gain uniquement si configurés pour la piste
- [ ] Piste avec compression : `python3 scripts/audacity_process.py --preset "Lead Vocals" --normalize -1 track.flac` produit un FLAC compressé puis normalisé à -1 dBFS
- [ ] Piste sans compression : `python3 scripts/audacity_process.py --normalize -1 --gain -8 track.flac` produit un FLAC normalisé à -1 dBFS puis atténué de 8 dB (GUIT MIX, KEYS MIX)
- [ ] Piste avec compression et gain : `python3 scripts/audacity_process.py --preset "Lead Vocals" --normalize -1 --gain 2 track.flac` applique les trois étapes dans l'ordre
- [ ] Si Audacity n'est pas lancé au démarrage du script, il démarre automatiquement (Flatpak)
- [ ] Si Audacity est déjà ouvert (cas nominal : étiquettes en cours), le script réutilise l'instance sans la relancer
- [ ] `scripts/setup.sh` vérifie la présence de `flatpak` et du Flatpak `org.audacityteam.Audacity`, les installe si absents, et affiche le rappel mod-script-pipe
- [ ] `multi_pass: 2` directement sous une piste applique la chaîne `compressor → normalize` deux fois : `python3 scripts/audacity_process.py --preset "Bass Guitar" --multi-pass 2 --normalize -1 track.flac` produit un FLAC traité en deux passes avant le gain final
- [ ] Le pipeline `process-rehearsal.sh` complet produit des pistes FLAC par segment sans erreur
