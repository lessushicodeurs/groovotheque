# Epic 31 — Fiche BPM dans notes.md

## Objectif

Actuellement, `process-rehearsal.sh` écrit la fiche BPM dans un fichier nommé d'après le dossier du groove (ex. `2024-03-15_-_01_-_Funk.md`). Ce nom varie à chaque groove et rend la détection de la fiche difficile à automatiser. Renommer ce fichier en `notes.md` — nom fixe et prévisible — simplifie les lectures ultérieures (UI, scripts tiers) et s'aligne sur la convention « fichier de notes accompagnant un groove ».

## Dépendances

- *(aucune)*

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Nouveau nom du fichier | `notes.md` (fixe, indépendant du nom du dossier) |
| Comportement si `notes.md` existe déjà | Ignorer (warn), identique au comportement actuel pour l'ancien nom |
| Contenu du fichier | Inchangé (frontmatter `bpm:`, titre `#`, ligne `- X bpm`) |

---

## Stories

### 31.1 — Renommer le fichier de sortie

Dans la fonction `create_md_sheets` de `scripts/process-rehearsal.sh` :

- Remplacer `local md_file="${out_dir}/${out_dir_name}.md"` par `local md_file="${out_dir}/notes.md"`
- Mettre à jour le message `warn` (nom du fichier vérifié) et le message `ok` en conséquence

---

## Critères d'acceptance

- [ ] Après exécution du script sur un dossier de répétition, chaque sous-dossier de groove contient un fichier `notes.md` (et non `<nom-du-dossier>.md`)
- [ ] Si `notes.md` existe déjà dans un sous-dossier, le script affiche un `warn` et ne l'écrase pas
- [ ] Le contenu de `notes.md` est identique à celui qui était produit avant (frontmatter `bpm:`, titre, ligne `- X bpm`)
- [ ] Aucun autre comportement du script n'est modifié
