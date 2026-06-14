# Epic 28 — Refonte config effets : chaîne `effects:` ordonnée

## Objectif

Remplacer les champs `compression:`, `multi_pass:` et `gain_db` du config par une liste ordonnée `effects:` qui exprime explicitement chaque étape de traitement audio. La logique multi-pass (anciennement `multi_pass: 2`) devient une répétition explicite de steps `compress + normalize` dans la liste, sans logique préconcue dans le script. L'ordre d'application des effets est garanti par l'ordre de la liste YAML.

## Dépendances

- Epic 12 complet (rehearsal-import — pipeline `process-rehearsal.sh`)
- Epic 27 remplacée par cette epic (même problème, approche plus générale)

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Discriminant | `type:` obligatoire sur chaque step (`type: compress`, `type: normalize`, `type: gain`, `type: pan`) |
| Types supportés | `compress`, `normalize`, `gain`, `pan` uniquement |
| Type inconnu | Erreur fatale — le script s'arrête |
| Ordre des effets | Garanti par la liste YAML — aucune réorganisation implicite |
| Multi-pass | Répétition explicite des steps dans la liste (ex. compress → normalize → compress → normalize) |
| Preset + override | `preset: X` accepte des paramètres inline qui écrasent le preset (`ratio: 6` surcharge le ratio du preset) |
| `label:` | Champ optionnel sur chaque step, ignoré par le script |
| `normalize.target_db` | Optionnel, défaut `-1` dBFS |
| `gain.db` | Obligatoire |
| `pan.position` | Entier -100 à +100 |
| Track sans `effects:` | Warning affiché, passthrough silencieux |
| Héritage global | Aucun — chaque track définit sa propre chaîne |
| `audio.normalize_peak_db` | Supprimé — remplacé par un step explicite `type: normalize` dans chaque track |
| Rétrocompatibilité | Rupture franche — `compression:`, `multi_pass:`, `gain_db` supprimés |
| Mixes | Même syntaxe `effects:` que les tracks |

---

## Stories

### 28.1 — Migration de `rehearsal-config.yaml`

Réécrire toutes les pistes du config pour utiliser la nouvelle syntaxe `effects:`.

- Supprimer tous les champs `compression:`, `multi_pass:`, `gain_db:` et `audio.normalize_peak_db`
- Pour chaque piste avec `multi_pass: 2` : traduire en deux cycles `compress + normalize` explicites
- Pour les pistes sans compression : ajouter uniquement `type: normalize` (ou laisser sans `effects:` avec warning attendu)
- Mettre à jour la section `mixes:` pour utiliser `effects:` — `pan` devient un step de la liste

Pistes concernées par la migration multi-pass : `01 BASS`, `09 BACKING VOC`, `10 LEAD VOCAL`, `11 DR KICK`, `12 DR HH SD`.

### 28.2 — Parser YAML dans `process-rehearsal.sh`

Mettre à jour le chargement du config (Python/bash) pour lire la liste `effects:` par track.

- Exposer la liste ordonnée des steps pour chaque track (type + paramètres)
- Supprimer la lecture de `compression:`, `multi_pass:`, `gain_db:`
- Valider chaque step au chargement : type connu, paramètres requis présents — erreur fatale sinon
- Émettre un `[WARN]` si une track n'a pas de bloc `effects:`

### 28.3 — Moteur d'exécution de la chaîne d'effets

Remplacer la logique hardcodée compress → normalize → gain dans `process-rehearsal.sh` par un moteur qui itère sur la liste `effects:`.

- Boucler sur la liste et appliquer chaque step dans l'ordre
- `type: compress` : appel ffmpeg `acompressor` avec les paramètres du preset ou inline ; si `preset:` défini, charger les params du preset puis appliquer les overrides inline
- `type: normalize` : `volumedetect` + `volume=` avec `target_db` (défaut -1 dBFS)
- `type: gain` : `volume=` avec `db`
- `type: pan` : filtre ffmpeg `pan` avec `position`
- Chaque step écrit dans un fichier FLAC intermédiaire ; le step suivant prend ce fichier en entrée

---

## Critères d'acceptance

- [ ] `rehearsal-config.yaml` ne contient plus aucun champ `compression:`, `multi_pass:` ou `gain_db:`
- [ ] Les 5 pistes anciennement `multi_pass: 2` appliquent deux cycles compress + normalize, visible dans les logs ffmpeg
- [ ] Une piste sans `effects:` produit un `[WARN]` dans la sortie et un fichier MP3 non traité
- [ ] Un `type: reverb` (type inconnu) provoque une erreur fatale avec message explicite
- [ ] Un step `type: normalize` sans `target_db` normalise à -1 dBFS
- [ ] Un preset avec override inline (`preset: Bass Guitar` + `ratio: 6`) applique bien le ratio overridé
- [ ] Le pipeline complet produit des MP3 sans erreur pour toutes les pistes configurées
- [ ] Les mixes (KEYS, DRUMS) supportent `effects:` incluant `type: pan`
