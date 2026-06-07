# Epic 20 — Arborescence des grooves (sous-dossiers)

## Objectif

Introduire une arborescence à n niveaux dans `grooves/` pour organiser les grooves en dossiers conteneurs, sans modifier le workflow FTP/deploy existant.

## Décisions d'architecture

| Sujet | Décision |
|-------|----------|
| Détection groove vs conteneur | Basée sur le contenu : présence de fichiers audio ou GP → groove ; sous-dossiers uniquement → conteneur |
| Dossier mixte (audio + sous-dossiers) | L'audio gagne — les sous-dossiers internes sont ignorés (rangement source) |
| Profondeur | N niveaux arbitraires |
| Navigation | Page entière, query param `/?path=SHK/session-2026` |
| URL du groove dans le player | Chemin complet : `?groove=SHK/session-2026/260606-groove` |
| Fil d'Ariane | Index + player (remplace le `<-` dans le player) |
| Affichage conteneurs | Même carte que les grooves + icône dossier + style visuel distinct |
| Nommage des conteneurs | Même logique de formatage que les slugs de groove |
| Tri | Conteneurs en premier (alpha), grooves ensuite (alpha) |
| API navigation | `GET /api/grooves?path=` — contenu d'un niveau |
| API recherche | `GET /api/search` — tous les grooves récursivement |
| Recherche | Client-side, live, fil d'Ariane dans chaque carte de résultat |
| Cache peaks | Miroir du chemin du groove : `cache/SHK/session-2026/groove/<file>.peaks.json` |
| `process-rehearsal.sh` | Hors scope |

---

## Stories

### 20.1 — Backend — Parcours récursif et détection

- Refactoriser la lecture de `grooves/` pour parcourir récursivement l'arborescence
- Règle de détection :
  - Un dossier contient au moins un fichier audio (`.mp3`, `.wav`, `.flac`, `.ogg`) ou GP (`.gp`, `.gpx`, `.gp5`, `.gp4`, `.gp8`) → **groove** (les sous-dossiers éventuels sont ignorés)
  - Un dossier ne contient que des sous-dossiers → **conteneur**
- Étendre `resolveGrooveDir()` pour valider des chemins multi-niveaux (anti path traversal)
- Le chemin complet relatif depuis `grooves/` devient l'identifiant d'un groove

### 20.2 — API — `GET /api/grooves?path=`

- Retourne le contenu d'un seul niveau à l'adresse `path` (défaut : racine)
- Réponse : tableau d'objets distinguant conteneurs et grooves
  ```json
  [
    { "type": "folder", "name": "SHK", "slug": "SHK", "displayName": "SHK" },
    { "type": "groove", "slug": "260606-groove", "displayName": "Groove", "path": "260606-groove", ... }
  ]
  ```
- Tri : conteneurs en premier (alpha), grooves ensuite (alpha)
- Retourne 404 si le chemin n'existe pas ou ne correspond pas à un conteneur

### 20.3 — API — `GET /api/search`

- Retourne tous les grooves récursivement (feuilles uniquement) avec leur chemin complet
- Chaque entrée inclut `path` (chemin relatif depuis `grooves/`) et `displayName`
- Utilisé par le client pour la recherche live

### 20.4 — API — Adaptation des routes existantes aux chemins multi-segments

Les routes suivantes utilisent actuellement `:name` (pas de slash). Les adapter pour accepter un chemin à n segments :

- `GET /api/grooves/:name` → `/api/grooves/*`
- `GET /audio/:groove/:file` → adapter pour chemin profond
- `GET /api/peaks/:groove/:file` → adapter
- `POST /api/peaks/:groove/:file` → adapter
- `GET /api/mix/:groove` → adapter
- `POST /api/mix/:groove` → adapter
- `GET /tab/:groove/:file` → adapter
- `GET /api/grooves/:name/md` → adapter
- `GET /api/grooves/:name/download` → adapter

Le cache peaks suit le chemin du groove : `cache/<chemin-groove>/<file>.peaks.json`

### 20.5 — Index — Navigation par dossiers

- Lire le query param `path` au chargement (`/?path=SHK/session-2026`)
- Appeler `/api/grooves?path=<value>` pour afficher le contenu du niveau courant
- Cartes conteneurs : même template que les grooves, icône dossier + fond ou bordure distinct
- Nommage des conteneurs : appliquer la même fonction de formatage que les slugs de groove
- Clic sur un conteneur → navigation vers `/?path=<chemin-conteneur>`

### 20.6 — Index — Fil d'Ariane

- Afficher un fil d'Ariane cliquable en haut de la liste (ex: `Accueil > SHK > session-2026`)
- Chaque segment est un lien vers `/?path=<chemin-partiel>`
- `Accueil` pointe vers `/` (racine)

### 20.7 — Index — Recherche live

- Ajouter une barre de recherche sur la page d'index
- Au focus ou à la première frappe : appel unique à `/api/search` pour charger tous les grooves
- Filtrage client-side sur le `displayName` du groove
- En mode recherche, masquer la liste de navigation et afficher les résultats
- Chaque carte de résultat affiche un fil d'Ariane (chemin relatif) en sous-titre

### 20.8 — Player — Chemin complet et fil d'Ariane

- Adapter la lecture du paramètre `?groove=` pour accepter un chemin multi-segments (ex: `SHK/session-2026/260606-groove`)
- Passer ce chemin aux appels API du player (`/api/grooves/*`, `/audio/*`, etc.)
- Remplacer le bouton `<-` par un fil d'Ariane cliquable (chaque segment → `/?path=<chemin-partiel>`)

### 20.9 — `deploy-grooves.sh` — Structure arborescente

- Parcourir récursivement la structure locale de `grooves/`
- Pour chaque **conteneur** : créer le répertoire correspondant sur le serveur et récurser
- Pour chaque **groove** : uploader uniquement les fichiers utiles (fichiers audio, `mix.json`, `notes.md`, fichiers GP) — exclure les sous-dossiers internes

---

## Rétrocompatibilité

Les grooves existants à la racine de `grooves/` restent au niveau 0 de la nouvelle arborescence — aucune migration requise.

## Hors scope

- `process-rehearsal.sh` (pas de paramètre `--output`)
- Création de dossiers conteneurs via l'UI (structure locale + deploy suffisent)
- Renommage / déplacement de grooves via l'UI

---

## Ordre d'implémentation recommandé

1. **20.1** — détection récursive (fondation de tout le reste)
2. **20.2 + 20.3** — nouvelles routes API
3. **20.4** — adaptation des routes existantes
4. **20.5 + 20.6** — navigation et fil d'Ariane dans l'index
5. **20.8** — player
6. **20.7** — recherche
7. **20.9** — deploy script

---

## Critères d'acceptance

- Un dossier contenant uniquement des sous-dossiers est affiché comme conteneur (icône dossier, style distinct)
- Un dossier contenant des fichiers audio est affiché comme groove, même s'il contient des sous-dossiers
- La navigation `/?path=SHK/session-2026` affiche le contenu du dossier `session-2026`
- Le fil d'Ariane permet de remonter à n'importe quel niveau en un clic (index et player)
- Le player charge correctement un groove imbriqué via `?groove=SHK/session-2026/260606-groove`
- La recherche retrouve un groove quel que soit son niveau d'imbrication
- Les cartes de résultats de recherche affichent le chemin du groove
- `deploy-grooves.sh` reproduit la structure locale et n'uploade pas les sous-dossiers internes d'un groove
- Les grooves existants à la racine continuent de fonctionner sans modification
