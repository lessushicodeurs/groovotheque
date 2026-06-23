# Epic 01 — Project Setup

## Objectif
Initialiser le projet Node.js, configurer Express, l'authentification et la structure de dossiers.

## Stories

### 1.1 — Initialisation npm
- `npm init` avec les champs essentiels
- Dépendances : `express`, `express-basic-auth`, `marked`
- `.gitignore` : `node_modules/`, `grooves/`, `cache/`, `.auth`, `.env`

### 1.2 — Serveur Express de base
- `server.js` : Express sur le port `process.env.PORT || 3099`
- Servir `public/` en static
- Middleware JSON + URL-encoded
- Logging des requêtes (morgan ou console simple)

### 1.3 — Authentification Basic Auth
- Middleware `express-basic-auth` appliqué à toutes les routes
- Lecture du fichier `.auth` au démarrage (format `user:password` par ligne)
- Rechargement à chaud non requis (redémarrage suffisant)
- Fichier `.auth.example` commité avec credentials fictifs

### 1.4 — Structure dossiers
- Création des dossiers `grooves/`, `cache/`, `public/css/`, `public/js/`
- Dossier `grooves/sample-title/` avec 2-3 fichiers audio factices pour le dev
- Fichier `notes.md` d'exemple dans le dossier sample

### 1.5 — Configuration AlwaysData
- Documentation du démarrage de l'app sur AlwaysData (section dans README ou doc dédiée)
- Variable `PORT` gérée par AlwaysData automatiquement

## Critères d'acceptance
- `node server.js` démarre sans erreur
- `http://localhost:3000` demande un login
- Mauvais credentials → 401
- Bons credentials → page blanche (ou 200) sans crash
