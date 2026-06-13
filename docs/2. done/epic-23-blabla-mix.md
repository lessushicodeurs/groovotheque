# Epic 23 — Mix stéréo unique pour les segments "blabla"

## Objectif

Les segments étiquetés `blabla` dans les fichiers Audacity correspondent à du
bavardage entre morceaux. Ces segments ne nécessitent pas d'export piste par
piste — un seul fichier stéréo suffit pour les retrouver facilement.

## Dépendances

- Epic 12 complet (import rehearsal — pipeline `process-rehearsal.sh`)

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Déclencheur | Label de segment exactement égal à `blabla` (casse sensible) |
| Export | Un seul fichier `blabla.mp3` — pas de pistes individuelles |
| Sélection des pistes | Identique aux segments normaux (exclusions respectées, sources de mix remplacées par leur mix) |
| Panoramique | Défini par piste dans une section `blabla_mix.pans` du YAML (fallback 0 si absent) |
| Convention de pan | Entier −100 (gauche) à +100 (droite), même convention que les sources de mix |
| Traitement audio | Mêmes fichiers normalisés que les segments normaux (pas de retraitement) |
| Section YAML | `blabla_mix` optionnelle — pipeline inchangé si absente et qu'il n'y a pas de segment blabla |

---

## Config YAML — section à ajouter dans `rehearsal-config.yaml`

```yaml
blabla_mix:
  pans:
    "01 BASS": 0
    "02 GUIT MIX": 0
    "04 KEYS MIX": 0
    "09 BACKING VOC": 0
    "10 LEAD VOCAL": 0
    "11 DRUMS MIX": 0
```

---

## Stories

### 21.1 — Chargement de la config `blabla_mix`

Dans `load_config_python` (et `load_config_yq`) :

- Lire `blabla_mix.pans` et exposer les variables shell `BLABLA_PAN_<nom>=<valeur>`
- Si la section est absente, ne rien exposer (pas d'erreur)

### 21.2 — Détection et mix blabla dans `split_segments`

Pour chaque segment dont `SEGMENT_LABELS[si] == "blabla"` :

- Ne pas découper les pistes individuelles
- Construire un filtre FFmpeg `pan=stereo` + `amix` sur tous les fichiers
  normalisés du segment, en appliquant le pan YAML de chaque piste
- Convertir les pistes mono en stéréo avant le mixage (`aformat=channel_layouts=stereo`)
- Sortie : `_work/segments/XX/blabla.flac`

### 21.3 — Export dans `convert_output`

Pour les segments blabla :

- Convertir uniquement `_work/segments/XX/blabla.flac` → `blabla.mp3`
  (bitrate `MP3_BITRATE` habituel)
- Ne pas itérer sur `ALL_TRACK_NAMES` pour ces segments

---

## Critères d'acceptance

- [ ] Un segment étiqueté `blabla` produit un dossier contenant uniquement `blabla.mp3`
- [ ] Un segment étiqueté autrement n'est pas affecté
- [ ] La section `blabla_mix` est optionnelle dans le YAML (fallback pan=0, pas d'erreur si absente)
- [ ] Les pistes stéréo (mixes) et mono (pistes simples) se mixent sans erreur FFmpeg
- [ ] Le pan de chaque piste est correctement appliqué dans le mix stéréo
