---
name: dev:release
description: Publie une release sur GitHub — incrémente la version, alimente le CHANGELOG depuis les commits, tague, pousse et crée la release. Déclencher quand l'utilisateur veut publier une version.
allowed-tools: Bash, Read, Write, Edit, Glob
---

Publie une release : $ARGUMENTS

`$ARGUMENTS` est optionnel : `patch`, `minor` ou `major` pour forcer l'incrément. Sans argument, l'incrément est déduit des commits (voir §3).

---

## 1. Vérifier l'état du dépôt

```bash
git branch --show-current
git status --porcelain
git fetch --tags origin
```

**Bloquer et le dire à l'utilisateur si :**
- la branche courante n'est pas `master`
- l'arbre de travail n'est pas propre (commits ou stash à faire d'abord)

Récupérer le dernier tag :

```bash
git describe --tags --abbrev=0 2>/dev/null || echo "AUCUN"
```

## 2. Déterminer la version actuelle

- **Aucun tag** (première release) : la version de départ est `0.0.0`, quelle que soit la valeur dans `package.json` (elle vaut `1.0.0` par défaut npm et n'a jamais été maintenue). La version publiée sera donc `0.0.1`.
- **Sinon** : la version actuelle est celle du dernier tag (`vX.Y.Z`).

## 3. Calculer la nouvelle version

Projet en **alpha** : on reste en `0.x.y` tant que l'utilisateur ne demande pas explicitement `major`.

Si `$ARGUMENTS` contient `patch`, `minor` ou `major`, appliquer cet incrément. Sinon le déduire des commits depuis le dernier tag :

| Commits trouvés | Incrément |
|---|---|
| au moins un `feat` | `minor` (0.1.0 → 0.2.0) |
| uniquement `fix`, `refactor`, `docs`, `chore`, `style` | `patch` |
| un `BREAKING CHANGE` ou un `!` dans le type | `minor` en 0.x — signaler à l'utilisateur, ne jamais passer en 1.0.0 sans demande explicite |

**Exception première release** : la v0.0.1, même si l'historique contient des `feat`.

Annoncer la version calculée à l'utilisateur **avant** de continuer.

## 4. Rassembler les commits

```bash
# première release
git log --pretty='%h%x09%s' --no-merges
# releases suivantes
git log <dernier-tag>..HEAD --pretty='%h%x09%s' --no-merges
```

Écarter les commits de merge et les commits de release (`chore(release): ...`).

Classer par type Conventional Commits :

| Type | Section du changelog |
|---|---|
| `feat` | Ajouté |
| `fix` | Corrigé |
| `refactor`, `perf` | Modifié |
| `docs` | Documentation |
| `chore`, `style` | Divers |

Un commit hors convention va dans **Divers**, avec son sujet tel quel.

## 5. Écrire le CHANGELOG

Fichier `CHANGELOG.md` à la racine, format [Keep a Changelog], **en français**, version la plus récente en haut.

En-tête du fichier (créé seulement s'il n'existe pas) :

```markdown
# Changelog

Toutes les évolutions notables de groovothèque.

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage [SemVer](https://semver.org/lang/fr/). Le projet est en alpha (`0.x`) :
l'API et les formats peuvent changer d'une version à l'autre.
```

Puis, inséré juste après l'en-tête :

```markdown
## [0.1.0] - 2026-09-11

### Ajouté

- Téléchargement du mix complet en un seul fichier (`7be158e`)

### Corrigé

- Réécriture du bloc STREAMINFO des fichiers FLAC (`7bb9a6a`)
```

Règles de rédaction :
- Reprendre la description du commit, **pas** son type ni son scope
- Reformuler en phrase lisible par un utilisateur du logiciel, pas par un développeur — fusionner plusieurs commits en une ligne quand ils décrivent la même évolution
- Le hash court entre backticks en fin de ligne
- Ne pas inventer d'entrée qui ne corresponde à aucun commit
- Une section vide est omise

Si le projet a des epics archivées dans `docs/2. done/` livrées depuis le dernier tag, les consulter pour reformuler les `feat` en termes fonctionnels.

## 6. Mettre à jour package.json

```bash
npm version <nouvelle-version> --no-git-tag-version
```

Vérifier que `package-lock.json` a bien suivi.

## 7. Commiter et taguer

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): v<X.Y.Z>"
git tag -a v<X.Y.Z> -m "v<X.Y.Z>"
```

## 8. Demander confirmation avant publication

**Ne jamais pousser ni créer la release sans accord explicite.** Montrer à l'utilisateur :
- la version
- les sections du changelog générées
- ce qui sera poussé (`git log origin/master..HEAD --oneline`)

Attendre son feu vert.

## 9. Pousser et créer la release GitHub

```bash
git push origin master
git push origin v<X.Y.Z>
```

Extraire la section du changelog correspondante dans un fichier temporaire, puis :

```bash
gh release create v<X.Y.Z> \
  --title "v<X.Y.Z>" \
  --notes-file <fichier-notes> \
  --prerelease
```

`--prerelease` tant que la version est en `0.x` — le projet est en alpha.

## 10. Rapport final

Annoncer :
- La version publiée et l'incrément appliqué (déduit ou forcé)
- Le nombre de commits couverts et les sections du changelog
- L'URL de la release GitHub (retournée par `gh release create`)

---

## Règles

- Jamais de release depuis une branche autre que `master`
- Jamais de `1.0.0` sans demande explicite de l'utilisateur
- Jamais de `git push --force`, jamais de tag réécrit : une version publiée est immuable. Une erreur se corrige par une version suivante.
- Si `gh` n'est pas authentifié (`gh auth status`), s'arrêter et le signaler plutôt que de contourner
