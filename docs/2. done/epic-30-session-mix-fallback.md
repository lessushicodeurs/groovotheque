# Epic 30 — Session mix fallback + dissociation mix/loop/markers

## Objectif

Quand on exporte les pistes d'une session d'enregistrement, plusieurs grooves partagent les mêmes niveaux de mix (même instrument = même volume/pan). Plutôt que de dupliquer `mix.json` dans chaque groove, on place un seul `mix.json` au niveau du dossier conteneur (parent) : si un groove n'a pas son propre `mix.json`, il utilise celui du parent.

Corollaire architectural : `mix.json` contient actuellement trois responsabilités (tracks, loop, markers). On les sépare en trois fichiers à responsabilité unique.

## Dépendances

- Epic 11 complet (mix save — format tracks/loop)
- Epic 17 complet (markers/sections)

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Fichiers | 3 fichiers distincts : `mix.json` (tracks uniquement), `loop.json`, `markers.json` |
| Fallback | Pur (tout ou rien) — si `mix.json` absent dans le groove → on lit celui du parent |
| Profondeur du fallback | Un seul niveau (dossier parent immédiat) |
| Scope du fallback | `mix.json` uniquement — `loop.json` et `markers.json` restent strictement groove-level |
| Sauvegarde depuis l'UI | Crée un `mix.json` local dans le groove (le parent n'est jamais modifié par l'UI) |
| Migration | Script one-shot — éclate les `mix.json` existants en 3 fichiers |

---

## Stories

### 30.1 — Dissociation des fichiers côté serveur

Refactorer les endpoints `/api/mix/*` pour ne gérer que `tracks`. Créer deux nouveaux endpoints pour `loop.json` et `markers.json`.

- `GET /api/mix/:path` → lit `mix.json` (champ `tracks` uniquement). Retourne `{}` si absent.
- `POST /api/mix/:path` → écrit `mix.json` avec `{ tracks: ... }` dans le dossier du groove (crée le fichier si absent).
- `GET /api/loop/:path` → lit `loop.json`. Retourne `{}` si absent.
- `POST /api/loop/:path` → écrit `loop.json` avec `{ in, out }`.
- `GET /api/markers/:path` → lit `markers.json`. Retourne `[]` si absent.
- `POST /api/markers/:path` → écrit `markers.json` avec le tableau de marqueurs (tri par `in` avant écriture).
- Tous les endpoints POST restent admin uniquement.

### 30.2 — Fallback mix.json côté serveur

Dans `GET /api/mix/:path`, si `mix.json` est absent dans le dossier du groove, tenter de le lire dans le dossier parent.

- Résolution du chemin parent : `path.dirname(grooveDir)`
- Si le parent contient un `mix.json` → le retourner (même format `{ tracks }`)
- Si ni le groove ni le parent n'ont de `mix.json` → retourner `{}`
- Le `POST /api/mix/:path` écrit toujours dans le dossier du groove (jamais dans le parent)
- Ajouter un champ `_source` dans la réponse GET : `"groove"` | `"parent"` | `"none"` — utile pour le client (story 30.3)

### 30.3 — Mise à jour du client

Éclater `loadMix()` / `saveMix()` en trois paires de fonctions indépendantes.

- `loadMix()` → `GET /api/mix/{slug}` — applique volumes et pans aux pistes WaveSurfer
- `loadLoop()` → `GET /api/loop/{slug}` — restaure les bornes de loop
- `loadMarkers()` → `GET /api/markers/{slug}` — restaure les marqueurs
- `saveMix()` → `POST /api/mix/{slug}` — inchangé en apparence, écrit toujours dans le groove
- `saveLoop()` → `POST /api/loop/{slug}`
- `saveMarkers()` → `POST /api/markers/{slug}`
- Au chargement d'un groove, les trois appels sont lancés en parallèle (pas de dépendance entre eux)
- Utiliser `_source` retourné par `GET /api/mix` pour afficher un indicateur discret si le mix vient du parent (ex. mention dans le panneau mix : "mix partagé" / "mix local")

### 30.4 — Script de migration

Script `scripts/migrate-split-mix.js` à jouer une fois sur le dossier `grooves/`.

```
node scripts/migrate-split-mix.js ./grooves
```

- Parcourt récursivement tous les `mix.json` trouvés
- Pour chaque fichier :
  - Si `loop` présent → crée `loop.json` à côté avec `{ in, out }`
  - Si `markers` présent → crée `markers.json` à côté avec le tableau
  - Réécrit `mix.json` avec uniquement `{ tracks }` (supprime `loop` et `markers`)
  - Si `mix.json` ne contient que `tracks` (déjà migré) → skip silencieux
- Affiche un résumé : N fichiers traités, N loop.json créés, N markers.json créés, N skippés
- Dry-run disponible via `--dry-run` (affiche ce qui serait fait sans écrire)
- Ne touche pas aux fichiers déjà séparés

---

## Critères d'acceptance

- [ ] Un groove sans `mix.json` local utilise le `mix.json` du dossier parent s'il existe
- [ ] Un groove avec `mix.json` local utilise le sien (le parent est ignoré)
- [ ] `loop.json` et `markers.json` ne remontent jamais au dossier parent
- [ ] Sauvegarder le mix depuis l'UI crée un `mix.json` local dans le groove — le `mix.json` du parent n'est pas modifié
- [ ] L'UI affiche un indicateur discret quand le mix est hérité du parent
- [ ] `loop.json` et `markers.json` se chargent et se sauvegardent indépendamment de `mix.json`
- [ ] `node scripts/migrate-split-mix.js --dry-run ./grooves` affiche le plan sans écrire
- [ ] `node scripts/migrate-split-mix.js ./grooves` éclate tous les `mix.json` mixtes en 3 fichiers distincts
- [ ] Après migration, le chargement d'un groove existant donne le même résultat qu'avant (mix, loop, markers identiques)
- [ ] Si ni le groove ni le parent n'ont de `mix.json` → mix vide (comportement identique à aujourd'hui)
