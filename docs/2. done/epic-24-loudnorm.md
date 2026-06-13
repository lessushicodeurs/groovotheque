# Epic 24 — Normalisation dynaudnorm par piste

## Objectif

Ajouter `dynaudnorm` (normaliseur dynamique FFmpeg) comme couche de normalisation
opt-in par piste, appliquée **après** la normalisation peak/rms existante.
Supprimer le support `loudnorm` ajouté en début d'epic (inefficace sur ce projet).

## Dépendances

- Epic 12 complet (import rehearsal — pipeline `process-rehearsal.sh`)

---

## Décisions de conception

| Sujet | Décision |
| --- | --- |
| Bloc de config | `dynaudnorm:` par piste dans `rehearsal-config.yaml` — bloc seul (sans paramètres) active avec les valeurs par défaut |
| Paramètres exposés | `peak` (0–1), `max_gain`, `frame_length_ms` |
| Valeurs par défaut | `peak: 0.95`, `max_gain: 3`, `frame_length_ms: 500` |
| Position dans le pipeline | Après `volumedetect + volume=(norm_gain)`, avant `volume=(gain_db)` |
| `gain_db` | Appliqué **après** dynaudnorm comme trim fin (séparé du norm_gain) |
| Implémentation | Une seule passe FFmpeg : `volume=Xdb,dynaudnorm=...[,volume=YdB]` |
| Limiteur de sécurité | **Supprimé** si dynaudnorm actif + `warn "Limiteur de sécurité désactivé (dynaudnorm actif) : ${name}"` |
| Code `loudnorm` | Supprimé de `process-rehearsal.sh` |

Pipeline complet quand dynaudnorm est défini :

```
compression (opt-in) → volumedetect → volume=(norm_gain) → dynaudnorm → volume=(gain_db)
```

---

## Stories

### 24.1 — Supprimer le support `loudnorm`

Dans `process-rehearsal.sh` :

- Supprimer `declare -A TRACK_LOUDNORM`
- Supprimer les variables `PER_TRACK_<i>_LOUDNORM_*` dans `load_config_python`
- Supprimer la population de `TRACK_LOUDNORM` dans `load_config()`
- Supprimer la branche `if [[ -n "${TRACK_LOUDNORM[$name]:-}" ]]` dans `compress_normalize`

### 24.2 — Chargement de `dynaudnorm` par piste

Dans `load_config_python` :

- Lire `tracks.per_track.<name>.dynaudnorm` et exposer :
  - `PER_TRACK_<i>_DYNAUDNORM` : `"1"` si le bloc est présent, `""` sinon
  - `PER_TRACK_<i>_DYNAUDNORM_PEAK` (`peak`, défaut `0.95`)
  - `PER_TRACK_<i>_DYNAUDNORM_MAXGAIN` (`max_gain`, défaut `3`)
  - `PER_TRACK_<i>_DYNAUDNORM_FRAME` (`frame_length_ms`, défaut `500`)
- Peupler `declare -A TRACK_DYNAUDNORM` (clé = nom de piste, valeur = `peak:max_gain:frame`) dans `load_config()`

### 24.3 — Branche `dynaudnorm` dans `compress_normalize`

Dans la boucle de traitement par piste, après le calcul du `total_gain` :

- Si `TRACK_DYNAUDNORM[$name]` est défini :
  - Logger : `warn "Limiteur de sécurité désactivé (dynaudnorm actif) : ${name}"`
  - Construire le filtre : `volume=${norm_gain}dB,dynaudnorm=f=${frame}:p=${peak}:m=${max_gain}`
  - Si `extra_gain != 0` : ajouter `,volume=${extra_gain}dB` au filtre
  - Appliquer en une passe FFmpeg vers `normalized/${name}.flac`
  - Court-circuiter le limiteur de sécurité et le `volume= total_gain` classique

### 24.4 — Mise à jour de `rehearsal-config.yaml`

Ajouter `dynaudnorm:` sur les pistes suivantes (valeurs par défaut — bloc vide suffisant) :

| Piste | `dynaudnorm:` ajouté |
|---|---|
| `01 BASS` | bloc complet pour documentation (peak=0.95, max_gain=3, frame=500ms) |
| `09 BACKING VOC` | bloc vide |
| `10 LEAD VOCAL` | bloc vide |
| `11 DR KICK` | bloc vide |
| `12 DR HH SD` | bloc vide |

Les valeurs par défaut (`peak: 0.95`, `max_gain: 3`, `frame_length_ms: 500`) ne sont
pas écrites dans le YAML si on ne dévie pas des défauts.

---

## Critères d'acceptance

- [ ] Une piste avec `dynaudnorm:` (bloc vide) est traitée avec `peak=0.95 max_gain=3 frame=500ms`
- [ ] Une piste avec `dynaudnorm:` produit un `warn` "Limiteur de sécurité désactivé" dans les logs
- [ ] Une piste sans `dynaudnorm:` est traitée comme avant (limiteur de sécurité actif)
- [ ] Le `gain_db` s'applique après dynaudnorm (un trim positif n'est pas compensé par dynaudnorm)
- [ ] Une piste avec `compression:` ET `dynaudnorm:` applique bien les deux : compression → norm → dynaudnorm → gain_db
- [ ] Aucune trace de `loudnorm` dans `process-rehearsal.sh`
