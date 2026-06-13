# Epic 25 — Détection BPM automatique en fin de pipeline

## Objectif

À la fin du traitement `process-rehearsal.sh`, le BPM de chaque morceau n'est nulle part
capturé : il faut l'écouter ou le mesurer séparément. Cette epic ajoute une étape de
détection automatique après la conversion MP3 : pour chaque segment non-blabla, les
pistes MP3 sont analysées via `aubiotempo`, la médiane est calculée, et un fichier
`{nom_dossier}.md` est créé dans le dossier de sortie avec le BPM en frontmatter YAML
et dans le body. Si le fichier existe déjà (contenu manuel), il est ignoré. Si aucun
BPM n'est détecté, aucun fichier n'est créé.

## Dépendances

- Epic 12 complet (import rehearsal — pipeline `process-rehearsal.sh`)

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Outil | `aubiotempo` (package système `aubio-tools`) |
| Dépendance | Optionnelle — si `aubiotempo` absent, étape ignorée avec un warn |
| Segments traités | Tous les dossiers de sortie non-blabla (`OUTPUT_DIRS`) |
| Pistes analysées | Tous les `.mp3` du dossier de sortie du segment |
| Agrégation | Médiane des BPM par piste (via Python `statistics.median`) |
| Précision | Arrondi à l'entier |
| Fichier de sortie | `{out_dir_name}.md` à la racine du dossier de sortie |
| Si le `.md` existe déjà | Skip — ne pas écraser le contenu manuel |
| Si aucun BPM valide | Ne pas créer le fichier |
| Frontmatter YAML | `bpm` uniquement |
| Body | `# {seg_num} {label}` + `- BPM bpm` |

---

## Format du fichier généré

```markdown
---
bpm: 106
---

# 01 Intro + Superstition

- 106 bpm
```

---

## Stories

### 25.1 — Vérification optionnelle de `aubiotempo`

Dans `check_deps` :

- Ne pas faire `die` si `aubiotempo` est absent
- Positionner une variable `HAS_AUBIO=true/false`
- Afficher un `warn` si absent : `aubiotempo introuvable — création des fiches .md désactivée`

### 25.2 — Étape `create_md_sheets`

Nouvelle fonction appelée après `convert_output`, avant `cleanup` :

- Si `HAS_AUBIO=false`, afficher un warn et retourner immédiatement
- Pour chaque dossier dans `OUTPUT_DIRS` :
  - Si le nom contient `blabla`, skip
  - Construire le chemin cible : `{out_dir}/{out_dir_name}.md`
  - Si le fichier existe déjà, skip avec `warn "fiche existante, ignorée : {out_dir_name}.md"`
  - Lancer `aubiotempo -i <fichier>.mp3` sur chaque `.mp3` du dossier
  - Capturer la valeur BPM de chaque sortie (ignorer les pistes sans résultat valide)
  - Si aucune valeur valide, skip sans créer de fichier
  - Calculer la médiane via `python3 -c "import statistics; …"`, arrondir à l'entier
  - Extraire `seg_num` et `label` depuis le nom du dossier (`SOURCE_NAME - NN - LABEL`)
  - Écrire le fichier `.md` avec frontmatter + titre + bullet BPM
  - Afficher `ok "→ {out_dir_name}.md (BPM : {valeur})"`

### 25.3 — Affichage dans `print_summary`

- Ajouter une ligne par segment avec son BPM détecté : `BPM : {label} → {valeur}`
- `TOTAL_STEPS` passe de 7 à 8

---

## Critères d'acceptance

- [ ] Chaque dossier de sortie non-blabla reçoit un `{nom_dossier}.md` avec `bpm: N` en frontmatter et `- N bpm` dans le body
- [ ] Si le `.md` existe déjà, il n'est pas modifié
- [ ] Si aucun MP3 ne donne de BPM valide pour un segment, aucun `.md` n'est créé pour ce segment
- [ ] Sans `aubiotempo` installé, le pipeline se termine sans erreur (warn + skip)
- [ ] Les segments blabla ne génèrent pas de `.md`
- [ ] Le BPM apparaît dans le résumé final par segment
