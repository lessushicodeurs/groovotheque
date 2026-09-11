# Groovotheque

Lecteur multipiste web pour sessions d'enregistrement.

## Démarrage local

```bash
npm install
htpasswd -B -c .auth musicien   # crée .auth avec un premier utilisateur
htpasswd -B .auth admin          # ajoute un utilisateur supplémentaire
node server.js
```

Ouvrir http://localhost:3099

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
| `restart-server.sh` | Redémarre le serveur Node.js |
| `process-rehearsal.sh` | Pipeline de traitement audio (découpe, normalisation, export) |
| `strip-parent-prefix.sh` | Supprime le préfixe parent des sous-dossiers de grooves |
| `markers-to-md.py` | Injecte la section Structure (marqueurs + BPM) dans le .md d'un groove |

> **Audacity 3.x requis.** `process-rehearsal.sh` pilote Audacity par `mod-script-pipe`,
> supprimé dans Audacity 4.0 et sans remplacement. Garder une instance 3.x et geler sa
> mise à jour : `flatpak mask org.audacityteam.Audacity`.
> Détails dans [scripts/README.md](scripts/README.md).

> **Config locale.** `process-rehearsal.sh` lit `scripts/process-rehearsal.yaml`, ignoré par
> git. Le créer depuis le modèle suivi :
> `cp scripts/process-rehearsal.yaml.example scripts/process-rehearsal.yaml`

## Licence

[AGPL v3](LICENSE) — libre d'utiliser, modifier et redistribuer, à condition de publier tes modifications sous la même licence (y compris si tu en fais un service en ligne).

Ce projet est personnel, sans support ni suivi de demandes. Les PR ne sont pas acceptées.
