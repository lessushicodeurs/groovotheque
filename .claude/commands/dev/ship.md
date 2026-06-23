---
name: dev:ship
description: Merge le worktree d'une epic dans master, nettoie le worktree, arrête les serveurs de recette, et archive l'epic dans docs/2. done/. Déclencher quand l'utilisateur valide une epic et veut la livrer.
allowed-tools: Bash, Read, Glob
---

Livre l'epic : $ARGUMENTS

`$ARGUMENTS` est soit le chemin du fichier epic (`docs/1. todo/epic-23-blabla-mix.md`), soit le slug du worktree (`epic-23-blabla-mix`).

---

## 1. Identifier l'epic

Dériver depuis `$ARGUMENTS` :
- Le slug du worktree (ex: `epic-23-blabla-mix`)
- Le nom de branche (identique au slug)
- Le chemin du worktree : `.worktrees/<slug>`
- Le fichier epic : chercher dans `docs/1. todo/` un fichier dont le nom contient le slug

```bash
ls "docs/1. todo/" | grep <slug>
```

Si le fichier n'est pas dans `docs/1. todo/`, vérifier `docs/2. done/` — il est peut-être déjà archivé.

## 2. Arrêter les serveurs de recette

Tuer tous les processus node qui tournent depuis le worktree (lancés lors des tests de recette) :

```bash
pkill -f "worktrees/<slug>" 2>/dev/null || true
```

Confirmer qu'aucun process ne tourne plus sur ce worktree :

```bash
pgrep -fa "worktrees/<slug>" || echo "Aucun process actif"
```

## 3. Merger dans master

```bash
git checkout master
git merge --no-ff <slug> -m "feat: epic <N> — <titre> (merge worktree)"
```

Si le merge échoue (conflits), lister les fichiers en conflit et les résoudre avant de continuer.

## 4. Supprimer le worktree

```bash
git worktree remove --force .worktrees/<slug>
git branch -d <slug>
```

Si `git branch -d` refuse (branche non fusionnée selon git), utiliser `-D` — le merge vient d'être fait.

## 5. Archiver l'epic

Si le fichier epic est dans `docs/1. todo/` :

```bash
git mv "docs/1. todo/epic-<N>-<slug>.md" "docs/2. done/"
git commit -m "docs(epic-<N>): archiver <slug> dans done/"
```

Si le fichier est déjà dans `docs/2. done/` ou absent, passer cette étape.

## 6. Rapport final

Annoncer :
- La branche mergée et le commit de merge
- Le worktree supprimé
- L'epic archivée (ou déjà archivée)
- Les serveurs arrêtés (ou aucun trouvé)
