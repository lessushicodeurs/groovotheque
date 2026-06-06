# Epic 11 — Sauvegarde du mix

## Objectif
Permettre à l'admin de sauvegarder les volumes par piste et la position de loop d'un groove dans un fichier `mix.json`, rechargé automatiquement à chaque ouverture du player.

## Dépendances
- Epic 03 complet (player multipiste + contrôles par piste)
- Epic 04 complet (transport + loop regions)

## Contexte

Les musiciens ajustent régulièrement les volumes des pistes (chant trop bas, clavier trop fort…). Sans persistance, ces réglages sont perdus à chaque rechargement. Un seul mix partagé par groove est sauvegardé côté serveur dans le dossier du groove lui-même, cohérent avec le principe "filesystem = source de vérité".

Seul l'utilisateur `admin` peut sauvegarder un mix. Tous les utilisateurs bénéficient du mix chargé automatiquement.

### Format du fichier `mix.json`

```json
{
  "tracks": {
    "01 BASS.mp3": 80,
    "02 GUIT.mp3": 100,
    "03 LEAD.mp3": 65,
    "04 KEYS.mp3": 90
  },
  "loop": {
    "in": 12.4,
    "out": 34.8
  }
}
```

- Clé `tracks` : nom de fichier audio → volume en pourcentage (0–100)
- Clé `loop` : position IN/OUT en secondes (absente si aucune loop n'était définie)
- Fichier situé dans `grooves/<nom-du-groove>/mix.json`

### Comportement sur pistes orphelines

- Piste dans le mix mais absente du groove → ignorée
- Piste présente dans le groove mais absente du mix → volume à 100%

## Stories

### 11.1 — Détection du rôle admin côté client

- Au chargement de `player.html`, le serveur injecte dans un `<script>` inline :
  ```js
  window.CURRENT_USER = "admin"; // ou le nom d'utilisateur courant
  ```
- Le middleware Basic Auth expose déjà `req.auth.user` — l'injecter dans le template HTML au moment du rendu de `player.html`
- Le frontend lit `window.CURRENT_USER === 'admin'` pour conditionner l'affichage du bouton

### 11.2 — API : lecture et écriture du mix

Deux nouveaux endpoints :

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/mix/:groove` | Retourne le contenu de `mix.json` ou `{}` si absent |
| POST | `/api/mix/:groove` | Écrit `mix.json` dans le dossier du groove (admin uniquement) |

- `POST` protégé côté serveur : si `req.auth.user !== 'admin'` → 403
- Corps de la requête : JSON brut `{ tracks: {...}, loop: {...} }`
- Dossier cible : `grooves/<groove>/mix.json`

### 11.3 — Chargement automatique du mix au démarrage

- Au chargement du player, après initialisation des pistes WaveSurfer, appel `GET /api/mix/:groove`
- Si la réponse contient des données `tracks` : appliquer les volumes aux pistes correspondantes
- Si la réponse contient `loop` : positionner la région de loop (sans l'activer)
- Les pistes absentes du mix reçoivent 100%
- Les pistes du mix absentes du groove sont ignorées silencieusement
- Aucune notification à l'utilisateur (chargement silencieux)

### 11.4 — Bouton "Sauvegarder le mix" (admin uniquement)

- Bouton affiché uniquement si `window.CURRENT_USER === 'admin'`
- Placement : header global du player, en haut à droite
- Libellé par défaut : "Sauvegarder le mix"
- Au clic :
  1. Collecter les volumes courants de chaque piste
  2. Collecter la position IN/OUT de la loop courante (si définie)
  3. `POST /api/mix/:groove` avec le JSON construit
  4. Succès : bouton passe à "Sauvegardé ✓" pendant 2 secondes, puis revient au libellé initial
  5. Erreur : bouton passe à "Erreur ✗" pendant 2 secondes

## Critères d'acceptance

- Le bouton "Sauvegarder le mix" est visible uniquement pour l'admin
- Un clic sauvegarde les volumes courants et la position de loop dans `grooves/<groove>/mix.json`
- Au rechargement du player sur ce groove, les volumes sont restaurés automatiquement
- La position de loop est restaurée (sans être activée)
- Si une piste a été ajoutée depuis la sauvegarde, elle démarre à 100%
- Si une piste a été supprimée depuis la sauvegarde, aucune erreur n'est levée
- Un utilisateur non-admin ne peut pas appeler `POST /api/mix/:groove` (403)
- Le fichier `mix.json` est lisible et valide directement dans le dossier FTP du groove
