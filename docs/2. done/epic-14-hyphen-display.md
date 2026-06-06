# Epic 14 — Correction de l'affichage des tirets dans les noms

## Objectif

Corriger la transformation trop agressive des caractères spéciaux dans les noms affichés : seul le `_` doit être converti en espace, le `-` doit être conservé tel quel. La capitalisation automatique des mots doit également être supprimée — les majuscules sont de la responsabilité de l'auteur du nom de dossier ou de fichier.

## Contexte

L'application transforme actuellement les noms de dossiers (grooves) et de fichiers audio (tracks) à l'affichage en remplaçant tous les caractères `[-_]` par des espaces et en appliquant une capitalisation automatique. Ce comportement est trop agressif :

- `_` → espace : correct (convention de nommage sans espaces)
- `-` → espace : **incorrect** — le tiret est un séparateur sémantique valide en français (noms composés, structure `date-nom - segment`)
- Capitalisation automatique : **incorrecte** — supprime l'intention de l'auteur

**Exemple concret** : le dossier `260606-ShkShk - 01` est affiché `260606 ShkShk   01` alors qu'il devrait être affiché `260606-ShkShk - 01`.

## Périmètre

Deux fonctions dans [server.js](../../server.js) sont concernées :

- `getTrackDisplayName` (ligne ~59) — noms des fichiers audio
- Transformation des slugs de grooves (ligne ~88) — noms des dossiers

## Stories

### 14.1 — Correction du nom affiché des tracks

**Fichier** : [server.js](../../server.js), fonction `getTrackDisplayName`

**Avant** :
```js
return withoutExt.replace(/^\d+[-_]/, '').replace(/[-_]/g, ' ');
```

**Après** :
```js
return withoutExt.replace(/^\d+_/, '').replace(/_/g, ' ');
```

- Le séparateur numérique de préfixe n'est supprimé que si c'est un `_` (ex: `01_bass` → `bass`)
- Les tirets dans le nom sont conservés (ex: `01_rock-progressif` → `rock-progressif`)

### 14.2 — Correction du nom affiché des grooves

**Fichier** : [server.js](../../server.js), transformation du slug

**Avant** :
```js
const name = slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
```

**Après** :
```js
const name = slug.replace(/_/g, ' ');
```

- Seuls les `_` sont remplacés par des espaces
- Les tirets sont conservés
- La capitalisation automatique est supprimée — le casing du nom de dossier est respecté tel quel

## Critères d'acceptance

- `260606-ShkShk - 01` s'affiche `260606-ShkShk - 01` (tirets conservés)
- `rock_progressif` s'affiche `rock progressif` (underscore → espace)
- `rock-progressif` s'affiche `rock-progressif` (tiret conservé, pas de capitalisation)
- `Ma-Répétition` s'affiche `Ma-Répétition` (casse originale respectée)
- Un fichier `01_bass.mp3` s'affiche `bass` (préfixe numérique supprimé car séparé par `_`)
- Un fichier `01-bass.mp3` s'affiche `01-bass` (préfixe numérique conservé car séparé par `-`)

### 14.3 — Ignorer les fichiers et dossiers terminant par `~`

Les fichiers et dossiers dont le nom se termine par `~` (fichiers de sauvegarde temporaire créés par certains éditeurs) doivent être ignorés partout dans l'application : listing des grooves, listing des tracks, téléchargements.

**Fichier** : [server.js](../../server.js)

- Lors du scan des dossiers grooves : exclure les entrées dont `entry.name` se termine par `~`
- Lors du scan des fichiers audio d'un groove : exclure les fichiers dont le nom se termine par `~`
- Ces entrées ne doivent pas apparaître dans les réponses API ni dans les archives ZIP de téléchargement

## Notes

- La convention de nommage des sessions par date (`260606-NomSession`) utilise le tiret comme séparateur date/nom — ce correctif est essentiel pour que ces noms s'affichent correctement.
- Aucune migration de données nécessaire — les noms de dossiers et fichiers ne sont pas modifiés, seul l'affichage change.
- Les fichiers `~` sont typiquement des sauvegardes automatiques d'éditeurs (Emacs, vi, etc.) — les ignorer évite qu'ils polluent le listing et les archives.
