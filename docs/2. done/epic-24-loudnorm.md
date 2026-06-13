# Epic 24 — Normalisation loudnorm par piste

## Objectif

Le compresseur `acompressor` de FFmpeg avec les paramètres des presets Audacity ne produit
pas les mêmes résultats qu'Audacity : il réduit seulement les pics (−3 dB) sans toucher
la dynamique moyenne, là où Audacity utilise un compresseur RMS avec lookahead qui monte
le niveau moyen de 10 à 14 dB. Résultat : les pistes compressées sonnent "thin" dans
process-rehearsal. Remplacer la chaîne `acompressor → volumedetect → volume` par `loudnorm`
permet d'obtenir le même crest factor que la référence Audacity (~18 dB pour la basse).

## Dépendances

- Epic 12 complet (import rehearsal — pipeline `process-rehearsal.sh`)

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Filtre de normalisation | `loudnorm` (EBU R128) remplace `acompressor` + peak norm pour les pistes concernées |
| Paramètre de config | `lufs_target` par piste dans `rehearsal-config.yaml` (entier négatif, ex. `-18`) |
| Fallback | Si `lufs_target` absent, comportement actuel conservé (peak -1 dBFS) |
| True peak | Limité à `-1 dBTP` via `loudnorm TP=-1` |
| LRA (loudness range) | `11 LU` par défaut — configurable globalement si besoin |
| Suppression de `compression:` | Les blocs `compression:` par piste deviennent obsolètes une fois `lufs_target` défini ; les deux coexistent pendant la transition |

---

## Stories

### 24.1 — Chargement de `lufs_target` par piste

Dans `load_config_python` (et `load_config_yq`) :

- Lire `tracks.per_track.<name>.lufs_target` et l'exposer via `PER_TRACK_<i>_LUFS`
- Peupler la table associative `TRACK_LUFS_TARGET` dans `load_config()`

### 24.2 — Branche `loudnorm` dans `compress_normalize`

Dans la boucle de traitement par piste :

- Si `TRACK_LUFS_TARGET[$name]` est défini : appliquer
  `loudnorm=I=<target>:LRA=11:TP=-1` directement sur la source (ou sur le fichier
  compressé si un bloc `compression:` est aussi défini)
- Court-circuiter les étapes `volumedetect` + `volume=` pour cette piste
- Logger : `Normalisation LUFS : ${name} (cible=${lufs})`

### 24.3 — Mise à jour de `rehearsal-config.yaml`

Remplacer les blocs `compression:` par des `lufs_target` sur les pistes concernées,
en s'appuyant sur les mesures de crest factor établies en session :

| Piste | `lufs_target` | Justification |
|---|---|---|
| `01 BASS` | `-18` | crest factor ~18 dB = référence Audacity Bass Guitar |
| `09 BACKING VOC` | `-18` | idem |
| `10 LEAD VOCAL` | `-20` | crest factor ~21 dB = référence Audacity Lead Vocals |
| `11 DRUMS MIX` | `-18` | crest factor ~18 dB = référence Audacity Kick Drums |

---

## Critères d'acceptance

- [ ] Une piste avec `lufs_target: -18` produit un fichier avec peak ≈ −1 dBFS et mean ≈ −17 dB (±1 dB)
- [ ] Une piste sans `lufs_target` continue à être traitée comme avant (peak -1 dBFS, mode peak/rms)
- [ ] Le crest factor de la basse traitée est ≤ 19 dB (vs 27 dB avec l'ancienne approche)
- [ ] La comparaison visuelle des formes d'ondes avec la référence Audacity montre des amplitudes similaires
