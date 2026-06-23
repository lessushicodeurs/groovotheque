# Groovotheque

Lecteur multipiste web pour sessions d'enregistrement.

## Démarrage local

```bash
npm install
htpasswd -B -c .auth musicien   # crée .auth avec un premier utilisateur
htpasswd -B .auth admin          # ajoute un utilisateur supplémentaire
node server.js
```

Ouvrir http://localhost:3000

## Structure

- `grooves/` — dossiers déposés par FTP (un sous-dossier = un titre)
- `cache/` — peaks JSON générés côté client et mis en cache
- `public/` — frontend statique (HTML/CSS/JS, pas de build)
- `.auth` — credentials Basic Auth (`user:password`, un par ligne)

## Scripts

Tous les scripts sont dans `scripts/`.

| Script | Rôle |
|---|---|
| `setup.sh` | Installe les dépendances système du pipeline audio |
| `process-rehearsal.sh` | Pipeline de traitement audio (découpe, normalisation, export) |
| `restart-server.sh` | Redémarre le serveur Node.js |
| `strip-parent-prefix.sh` | Supprime le préfixe parent des sous-dossiers de grooves |
| `test-bpm.sh` | Harnais de test ciblé pour la détection BPM |
