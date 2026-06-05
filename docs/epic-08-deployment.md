# Epic 08 — Déploiement AlwaysData

## Objectif
Configurer et déployer l'application sur l'hébergement mutualisé AlwaysData.

## Dépendances
- Tous les epics précédents

## Contexte AlwaysData

AlwaysData supporte Node.js via leur interface d'administration :
- Création d'une "Site" de type Node.js dans le panel admin
- Ils injectent automatiquement la variable `PORT` (ou via `ALWAYSDATA_HTTPD_PORT`)
- L'app doit écouter sur ce port
- Le filesystem est persistant — parfait pour `grooves/` et `cache/`
- SSH disponible pour les opérations manuelles

## Stories

### 8.1 — Configuration du port
- `server.js` écoute sur `process.env.PORT || process.env.ALWAYSDATA_HTTPD_PORT || 3000`
- Vérifier la variable exacte dans la doc AlwaysData

### 8.2 — Configuration AlwaysData
Dans le panel admin AlwaysData :
- Créer un site de type **Node.js**
- Commande de démarrage : `node server.js`
- Répertoire : dossier racine du projet
- Installer les dépendances via SSH : `npm install --production`

### 8.3 — Structure FTP
Sur AlwaysData, le dossier `grooves/` est accessible en FTP :
- Chemin FTP : `~/groovotheque/grooves/` (à adapter selon l'arborescence du compte)
- Le preneur de son dépose ses dossiers directement ici
- Aucune action requise côté app après dépôt

### 8.4 — Fichier .auth
- Créé manuellement via SSH après déploiement
- Format : `username:password` (un par ligne)
- Jamais commité dans git

### 8.5 — Checklist de mise en production
- [ ] `npm install --production` exécuté
- [ ] Fichier `.auth` créé avec credentials définitifs
- [ ] Dossier `grooves/` créé
- [ ] Dossier `cache/` créé
- [ ] App démarrée et accessible sur le domaine AlwaysData
- [ ] Test login / accès
- [ ] Dépôt d'un titre de test en FTP
- [ ] Vérification listing + player

## Notes
- AlwaysData redémarre l'app si elle crashe (comportement selon leur config)
- Logs accessibles via leur panel ou SSH (`~/logs/`)
- Pas de `pm2` nécessaire — AlwaysData gère le process
