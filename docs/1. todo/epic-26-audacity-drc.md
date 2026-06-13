# Epic 26 — Traitement des pistes via Audacity DRC (remplacement ffmpeg)

## Objectif

Le script `process-rehearsal.sh` utilise ffmpeg pour la compression et la normalisation de chaque piste audio. Des jours de travail n'ont pas permis de répliquer avec ffmpeg le résultat obtenu en 3 clics dans Audacity (Compressor → Normalize → Save). La cause racine est documentée dans `docs/audacity-presets/compressor.md` : le DRC d'Audacity possède `lookaheadMs` et `makeupGainDb` qui n'ont pas d'équivalent dans `acompressor` de ffmpeg. Cette epic remplace la chaîne ffmpeg compress/normalize par des appels au VRAI DRC d'Audacity 3.7.7 via mod-script-pipe.

## Dépendances

- Epic 12 complet (rehearsal-import — pipeline process-rehearsal.sh)
- *(aucune)* autre dépendance

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Mécanisme d'appel Audacity | mod-script-pipe (IPC via pipes nommés — seul mécanisme appelant le VRAI DRC natif) |
| CLI-Anything Audacity | Écarté — réimplémentation Python basique sans lookahead, pas le vrai DRC |
| Outil Audacity | Flatpak 3.7.7 (`flatpak run org.audacityteam.Audacity`) |
| Démarrage Audacity | Auto-start si pipe absent, réutilisation si déjà ouvert (cas normal : étiquettes en cours) |
| dynaudnorm | Supprimé — workaround pour les limitations de ffmpeg, inutile avec le vrai DRC |
| Étapes ffmpeg conservées | Mix composites (amix + pan), découpe segments (-ss -to -c copy), encodage MP3 320k |
| Config preset | Référence par nom (`preset: "Lead Vocals"`) ET paramètres directs supportés |
| Nouveaux paramètres config | `lookahead` et `makeup` ajoutés aux blocs `compression` |
| Helper | Script Python dédié `scripts/audacity_process.py` |

---

## Prérequis utilisateur (one-time setup)

mod-script-pipe doit être activé dans Audacity avant la première utilisation :
Edit → Preferences → Modules → mod-script-pipe : Enabled → redémarrer Audacity.

---

## Stories

### 26.1 — Helper `scripts/audacity_process.py`

Créer un script Python qui pilote Audacity via mod-script-pipe pour appliquer DRC + Normalize sur un fichier FLAC.

- Détecte si le pipe `/tmp/audacity_script_pipe.to.<uid>` existe
- Si non : lance `flatpak run org.audacityteam.Audacity` en arrière-plan, attend le pipe (timeout 30 s, erreur explicite sinon)
- Pour chaque fichier FLAC passé en argument :
  - `OpenFiles: Filename=<path>`
  - `SelectAll`
  - Applique DRC Compressor avec les paramètres résolus (threshold, ratio, attack, release, knee, lookahead, makeup)
  - `Normalize: PeakLevel=<target>`
  - `Export2: Filename=<path>` (export sur place en FLAC)
  - `Close: SaveChanges=No`
- Ne quitte pas Audacity à la fin (laisser l'instance ouverte)
- Si `--preset <nom>` est fourni, résout les paramètres depuis la table `docs/audacity-presets/compressor.md` (embarquée dans le script)

Interface CLI :
```
# Via preset
python3 scripts/audacity_process.py --preset "Lead Vocals" --normalize -1 track.flac

# Via paramètres directs
python3 scripts/audacity_process.py \
  --threshold -14 --ratio 5.2 --attack 1 --release 60 \
  --knee 5.5 --lookahead 1 --makeup 0 \
  --normalize -1 track.flac
```

### 26.2 — Mise à jour `scripts/rehearsal-config.yaml`

Adapter la config pour le nouveau pipeline.

- Supprimer `dynaudnorm` de toutes les pistes
- Supprimer les paramètres `target` et `mode` (normalisation peak, désormais gérée par l'helper)
- Ajouter `lookahead` et `makeup` aux blocs `compression` existants (valeurs issues de `docs/audacity-presets/compressor.md`)
- Supporter les deux syntaxes :

```yaml
# Syntaxe preset (nice to have)
compression:
  preset: "Lead Vocals"

# Syntaxe paramètres directs (obligatoire, avec les nouveaux champs)
compression:
  threshold: -14
  ratio: 5.2
  attack: 1
  release: 60
  knee: 5.5
  lookahead: 1    # ← nouveau
  makeup: 0       # ← nouveau
```

### 26.3 — Mise à jour `scripts/process-rehearsal.sh`

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
- [ ] `python3 scripts/audacity_process.py --preset "Lead Vocals" --normalize -1 track.flac` s'exécute sans erreur et produit un FLAC modifié
- [ ] `python3 scripts/audacity_process.py --threshold -14 --ratio 5.2 --attack 1 --release 60 --knee 5.5 --lookahead 1 --makeup 0 --normalize -1 track.flac` produit le même résultat
- [ ] Si Audacity n'est pas lancé au démarrage du script, il démarre automatiquement
- [ ] Si Audacity est déjà ouvert (cas nominal), le script réutilise l'instance sans la relancer
- [ ] Le pipeline `process-rehearsal.sh` complet produit des pistes FLAC par segment sans erreur
