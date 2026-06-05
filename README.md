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

## Déploiement AlwaysData

1. Pousser le code via Git ou FTP (hors `node_modules/`, `grooves/`, `cache/`, `.auth`).
2. Dans l'admin AlwaysData → **Sites** → **Node.js** :
   - Commande de démarrage : `node server.js`
   - Répertoire de travail : chemin vers le projet
   - La variable `PORT` est injectée automatiquement par AlwaysData.
3. Créer le fichier `.auth` directement sur le serveur (SSH ou gestionnaire de fichiers).
4. Créer les dossiers `grooves/` et `cache/` sur le serveur.
5. Redémarrer le site depuis l'admin pour prendre en compte `.auth`.

> Le dossier `grooves/` est la source de vérité. Le preneur de son dépose les fichiers audio par FTP directement dans ce dossier.
