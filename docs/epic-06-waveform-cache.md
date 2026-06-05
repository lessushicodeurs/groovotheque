# Epic 06 — Cache des waveforms (peaks)

## Objectif
Accélérer le chargement du player en persistant les données de peaks JSON côté serveur, calculées une seule fois par le client.

## Dépendances
- Epic 02 (routes API)
- Epic 03 (player chargé, wavesurfer initialisé)

## Contexte technique

Wavesurfer.js peut soit décoder l'audio et générer les peaks lui-même (lent sur gros fichiers), soit recevoir un tableau de peaks pré-calculés (affichage instantané).

Flux :
1. Player démarre → pour chaque piste, `GET /api/peaks/:groove/:file`
2. Si cache hit → wavesurfer utilise les peaks directement
3. Si cache miss (404) → wavesurfer décode l'audio, génère les peaks
4. Une fois générés → `POST /api/peaks/:groove/:file` avec le JSON
5. Rechargement suivant → cache hit, affichage immédiat

## Stories

### 6.1 — API GET /api/peaks/:groove/:file
- Vérifie l'existence de `./cache/:groove/:file.peaks.json`
- Si présent → retourne le JSON (peaks array)
- Si absent → 404
- Validation du chemin (anti path traversal)

### 6.2 — API POST /api/peaks/:groove/:file
- Reçoit le JSON body `{ peaks: Float32Array | number[] }`
- Crée le dossier `./cache/:groove/` si nécessaire
- Écrit `./cache/:groove/:file.peaks.json`
- Retourne 201
- Validation : body non vide, peaks est un tableau, taille max 10MB

### 6.3 — Intégration côté client
Dans `player.js`, au chargement de chaque piste :
```js
// Pseudo-code
const peaks = await fetchPeaks(groove, filename)
if (peaks) {
  wavesurfer.load(url, peaks)
} else {
  wavesurfer.load(url) // décode + génère
  wavesurfer.on('ready', () => {
    postPeaks(groove, filename, wavesurfer.exportPeaks())
  })
}
```

### 6.4 — Indicateur de chargement
- Pendant le décodage initial (premier chargement) : barre de progression ou spinner par piste
- Une fois peaks disponibles : waveform s'affiche
- Les pistes avec cache chargent quasi-instantanément

### 6.5 — Invalidation du cache
- Pas d'invalidation automatique (v1)
- Si un fichier audio est remplacé en FTP, supprimer manuellement le `.peaks.json` correspondant dans `cache/`
- Documenter ce comportement

## Critères d'acceptance
- Premier chargement d'un titre : peaks générés et persistés (vérifiable dans `cache/`)
- Deuxième chargement : waveforms apparaissent instantanément (< 500ms)
- `POST /api/peaks` avec un body invalide → 400
- Path traversal (`../../../etc/passwd`) → 400 ou 403
