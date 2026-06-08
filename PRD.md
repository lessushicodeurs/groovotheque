# Groovotheque — Product Requirements Document

## Contexte

Groovotheque est un outil web interne destiné à un groupe de musique. Le preneur de son dépose les fichiers audio des sessions d'enregistrement via FTP sur le serveur. Le site permet aux musiciens de retrouver, écouter et travailler les titres enregistrés depuis n'importe quel appareil, en répétition comme en studio.

## Objectif

Fournir une interface de lecture multipiste légère, accessible depuis un navigateur, sans logique de gestion de fichiers côté app. Le filesystem est la source de vérité. L'app lit, jamais n'écrit (sauf cache de waveforms).

## Stack technique

| Couche | Choix |
|---|---|
| Serveur | Node.js + Express |
| Frontend | Vanilla JS (ES modules, no build step) |
| Player audio | Wavesurfer.js v7 (tous plugins) |
| Time stretching | SoundTouch.js (AudioWorklet) |
| Auth | HTTP Basic Auth (fichier `.auth`) |
| Hébergement | AlwaysData (mutualisé, filesystem persistant) |

## Structure des fichiers

```
groovotheque/
├── grooves/                    # gitignored — dépôt FTP
│   └── nom-du-titre/
│       ├── 01-batterie.wav
│       ├── 02-basse.mp3
│       ├── 03-guitare.flac
│       └── notes.md            # optionnel
├── cache/                      # gitignored — peaks JSON générés
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js
│       └── player.js
├── server.js
├── .auth                       # gitignored — credentials basic auth
├── .gitignore
└── package.json
```

### Convention de nommage des pistes

- **Primaire** : préfixe numérique `01-nom.ext`, `02-nom.ext` → tri par numéro, nom = partie après le premier tiret
- **Fallback** : nom libre `guitare.mp3` → tri alphabétique, nom = nom de fichier sans extension
- Formats supportés : `.mp3`, `.wav`, `.flac`

### Fichier de métadonnées

- Nom : `notes.md` (ou tout fichier `.md` dans le dossier)
- Format : Markdown libre, aucun schéma imposé
- Affiché rendu HTML dans un tooltip au survol du titre dans le listing

## Fonctionnalités

### 1. Listing des titres

- Scan du dossier `grooves/` à chaque requête
- Nom du titre = nom du dossier (les tirets/underscores remplacés par des espaces)
- Tri alphabétique des titres
- Tooltip au survol : contenu du `.md` rendu en HTML
- Clic → ouverture du player multipiste

### 2. Authentification

- HTTP Basic Auth sur toutes les routes
- Credentials stockés dans `.auth` (format `user:password`, un par ligne)
- Middleware Express, configuré au démarrage

### 3. Player multipiste

- Un WaveSurfer par piste, synchronisés via le plugin Multitrack
- Plugins actifs : Multitrack, Regions, Timeline, Hover
- Thème dark, couleur unique par piste (palette fixe, assignée par index)
- Affichage du nom de la piste à gauche de la waveform
- Contrôles par piste : Mute, Solo, Volume (slider)

### 4. Transport

- Play / Pause / Stop (retour à 0)
- Position courante affichée en timecode (mm:ss.ms)
- Durée totale

### 5. Régions de loop

- Création par cliquer-glisser sur n'importe quelle waveform
- Affichage des valeurs IN / OUT éditables (champs texte)
- Activation / désactivation du loop
- Couleur de la région : blanc semi-transparent

### 6. Tempo sans pitch

- Slider 50% → 120% du tempo original
- Presets rapides : 50%, 75%, 90%, 100%, 110%, 120%
- Implémentation via SoundTouch.js en AudioWorklet
- Appliqué globalement à toutes les pistes

### 7. Cache des waveforms (peaks)

- Endpoint `GET /api/peaks/:groove/:file` → retourne le JSON de peaks si en cache
- Endpoint `POST /api/peaks/:groove/:file` → reçoit et persiste le JSON de peaks
- Wavesurfer calcule les peaks côté client au premier chargement, les poste au serveur
- Les chargements suivants utilisent le cache (affichage instantané)

## API REST

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/grooves` | Liste des titres avec métadonnées |
| GET | `/api/grooves/:name` | Détail d'un titre (pistes, md) |
| GET | `/audio/:groove/:file` | Stream audio (range requests) |
| GET | `/api/peaks/:groove/:file` | Récupère peaks cachés |
| POST | `/api/peaks/:groove/:file` | Sauvegarde peaks |

## Contraintes

- Pas de base de données — filesystem uniquement
- Pas de build step frontend — ES modules natifs + CDN pour wavesurfer/soundtouch
- Fully responsive — optimisé desktop, dégradé gracieux sur mobile/tablette
- Read-only — aucun upload, aucune modification de fichiers audio
- Dépendances npm minimales : `express`, `express-basic-auth`, `marked`

## Non-inclus (v1)

- Enregistrement audio (Record plugin wavesurfer)
- Gestion multi-groupes
- Commentaires / annotations persistées
- Export / mixdown
