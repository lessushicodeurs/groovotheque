---
name: create-epic
description: Crée une nouvelle epic dans docs/1. todo/ en respectant la numérotation et le format du projet.
---

## Workflow

### 1. Trouver le prochain numéro

```bash
git ls-tree -r --name-only HEAD -- "docs/1. todo/" "docs/2. done/" \
  | grep -oP 'epic-\K\d+' | sort -n | tail -1
```

Le prochain numéro = résultat + 1. **Toujours vérifier les deux dossiers** — des epics peuvent être dans `done` avec un numéro plus élevé que celles dans `todo`.

### 2. Lire un epic existant pour calibrer le niveau de détail

```bash
cat "docs/1. todo/epic-<N>-<slug>.md"
```

Exemple de référence : `docs/1. todo/epic-18-horizontal-zoom.md`.

### 3. Rédiger l'epic

Fichier : `docs/1. todo/epic-<NN>-<slug-kebab-case>.md`

```markdown
# Epic <N> — <Titre>

## Objectif

<Pourquoi cette epic, quel problème elle résout — 2 à 4 phrases.>

## Dépendances

- Epic XX complet (<nom>)
- *(aucune)* si pas de dépendance

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| <aspect> | <décision retenue> |

---

## Stories

### <N>.1 — <Titre>

<Description de la story — ce qui doit être fait et pourquoi.>

- Détail ou contrainte technique
- …

### <N>.2 — <Titre>

…

---

## Critères d'acceptance

- [ ] <Critère vérifiable oui/non>
- [ ] …
```

### 4. Créer le fichier

Écrire dans `docs/1. todo/epic-<NN>-<slug>.md` avec le contenu rédigé.

---

## Règles

- **Répertoire** : `docs/1. todo/` — avec un espace, pas `docs/todo/`
- **Numérotation** : vérifier les deux dossiers `todo` et `done` avant d'attribuer un numéro
- **Slug** : kebab-case, court, descriptif (ex. `blabla-mix`, `horizontal-zoom`)
- **Décisions** : remplir le tableau uniquement avec les décisions déjà prises — ne pas inventer
- **Stories** : une story = une unité livrable testable indépendamment
- **Critères d'acceptance** : formulés comme des assertions observables, pas des tâches
- Ne pas committer — laisser l'utilisateur valider le contenu d'abord
