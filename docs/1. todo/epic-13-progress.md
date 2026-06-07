# Epic 13 — Progression de l'implémentation

Branche : `feature/epic-13-tablature`  
Worktree : `.worktrees/epic-13-tablature/`

## Statut global

| Issue | Titre | Statut |
|-------|-------|--------|
| EPIC-13-001 | Détection GP côté serveur | ✅ DONE |
| EPIC-13-002 | Markup HTML drawer | ✅ DONE |
| EPIC-13-003 | CSS drawer 3 états | ✅ DONE |
| EPIC-13-004 | Mobile detection guard | ✅ DONE |
| EPIC-13-005 | Chargement lazy AlphaTab | ✅ DONE |
| EPIC-13-006 | State machine drawer + drag | ✅ DONE |
| EPIC-13-007 | Init AlphaTab + load score | ✅ DONE |
| EPIC-13-008 | Sélecteur pistes GP | ✅ DONE |
| EPIC-13-009 | Boucle RAF sync | ✅ DONE |
| EPIC-13-010 | Boucles par mesure | ✅ DONE |

---

## Journal

### 2026-06-06 — Implémentation complète

**Branche** : `feature/epic-13-tablature`  
**Worktree** : `.worktrees/epic-13-tablature/`  
**Port de test** : 3113 (ou tout port libre — `PORT=3113 node server.js`)

**Symlinks requis (créés)** :
- `grooves/` → lien vers `<projet>/grooves` 
- `node_modules/` → lien vers `<projet>/node_modules`
- `.auth` → copie du fichier principal

**Vérification** : `curl -si http://localhost:3113/ | head -1` → `HTTP/1.1 401 Unauthorized` ✓

**Fichiers modifiés** :
- `server.js` : `GP_EXTENSIONS`, `tabFile` dans `/api/grooves/:name`, route `/tab/:groove/:file`
- `public/player.html` : ajout `#tab-drawer` (drawer HTML)
- `public/css/style.css` : styles drawer 3 états + transport sticky ajusté
- `public/js/player.js` : `IS_DESKTOP`, tab DOM refs, `setTabState`, drag handle, `startTabSync/stopTabSync`, `buildTrackSelector`, `initTabDrawer`, beat loop handler

**Note de test** : Pour tester la tablature, placer un fichier `.gp8` dans un dossier de `grooves/`. Le drawer s'ouvre automatiquement en mode strip au chargement du player.

**À vérifier empiriquement** :
- La formule de sync `timePosition = ws.getCurrentTime() * 1000` est la plus logique. Si drift observé, expérimenter `timePosition = raw / tempoFactor` comme suggéré dans l'epic.
- AlphaTab CDN chargement (~2MB) : tester avec connection normale et dégradée.
