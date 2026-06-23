---
name: commit
description: Crée un ou plusieurs commits unitaires en respectant les conventions du projet (Conventional Commits, descriptions en français).
---

## Workflow

### 1. Analyser les changements

```bash
git diff --stat
git diff
```

Identifier les **groupes logiques indépendants** — chaque groupe donnera un commit distinct.

### 2. Définir les commits

Un commit = **une seule intention** : on doit pouvoir lire le titre et comprendre exactement ce qui change, sans lire le diff.

Exemples de mauvais découpage à éviter :
- Mélanger un fix et une feature dans le même commit
- Grouper des changements sur des composants sans rapport
- "misc fixes" ou "wip"

### 3. Format Conventional Commits

```
<type>(<scope>): <description en français, minuscule>
```

**Types utilisés dans ce projet :**

| Type | Usage |
|---|---|
| `feat` | Nouvelle fonctionnalité |
| `fix` | Correction de bug |
| `refactor` | Restructuration sans changement de comportement |
| `chore` | Maintenance, config, dépendances, déploiement |
| `docs` | Documentation uniquement |
| `style` | Mise en forme, CSS pur sans logique |

**Scopes courants :** `player`, `index`, `scripts`, `rehearsal`, `deploy`, `server`, `config`, `claude`, `css`, `epic-XX`

Scope optionnel si le changement est transverse.

**Description :** en français, sans majuscule initiale, sans point final, sans verbe auxiliaire ("ajouter le bouton" et non "j'ai ajouté" ni "add button").

### 4. Créer les commits dans l'ordre logique

Pour chaque groupe :

```bash
git add <fichiers concernés>
git commit -m "type(scope): description"
```

Ne jamais faire `git add .` sans vérifier ce qui sera inclus.

---

## Règles

- **Ne jamais committer sans que l'utilisateur l'ait demandé explicitement**
- Un commit ne doit pas mélanger des fichiers sans lien logique
- Préférer plusieurs petits commits à un gros commit fourre-tout
- Si un changement est atomique mais touche plusieurs fichiers cohérents (ex. script + config associée), un seul commit est correct
- Ne pas inclure `.env`, fichiers de credentials, ou binaires non intentionnels
