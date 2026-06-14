# Epic 33 — Droits d'accès par dossier de premier niveau

## Objectif

Permettre de restreindre l'accès de certains utilisateurs à un sous-ensemble de dossiers de premier niveau. Un utilisateur sans restriction (admin) voit tout ; un utilisateur listé dans le fichier `.acl` ne voit et n'accède qu'aux dossiers explicitement autorisés, et ce sur toutes les routes (navigation, lecture audio, tablature, mix, marqueurs, commentaires, recherche).

La restriction s'applique au **premier niveau de dossier** uniquement : un utilisateur autorisé sur `Ghismo` peut accéder à tous les sous-dossiers et fichiers dans `Ghismo/`, sans qu'il soit nécessaire de déclarer chaque sous-dossier.

## Dépendances

Aucune — cette epic est autonome et ne dépend d'aucune epic en cours.

---

## Décisions de conception

| Sujet | Décision |
|---|---|
| Format config | Fichier `.acl` séparé du `.auth` : `username:slug1,slug2,...` |
| Absence du fichier | Pas de `.acl` → tous les utilisateurs ont accès total (rétrocompatibilité) |
| Utilisateur absent du `.acl` | Accès total (comportement admin — il suffit de ne pas l'y ajouter) |
| Utilisateur présent dans `.acl` | Whitelist stricte : uniquement les slugs listés |
| Slug = nom du dossier | Valeur exacte du nom de dossier sur disque (ex : `Archives Higgins Mixer`), pas le displayName ni l'encodé URL |
| Profondeur | Premier segment du chemin seulement — `Ghismo/Live/2025` → contrôle sur `Ghismo` |
| Recharge `.acl` | Au démarrage du serveur uniquement (même comportement que `.auth`) |
| Scope de la garde | Toutes les routes qui référencent un chemin groove : API, audio, tab, peaks, comments |
| Réponse en cas d'accès refusé | 403 JSON `{ error: 'Accès interdit' }` (identique aux gardes path traversal existantes) |
| UI | Pas de changement front-end : les dossiers filtrés disparaissent naturellement de la liste |

---

## Stories

### 33.1 — Fichier `.acl` et helper `isAllowed`

Créer la mécanique de configuration et le helper central utilisé par toutes les autres stories.

- Fichier `.acl.example` à la racine du projet :
  ```
  # Droits d'accès par dossier de premier niveau
  # Format : username:slug1,slug2,...
  # Un utilisateur absent de ce fichier a accès à tout.
  # Les slugs correspondent exactement aux noms de dossiers dans grooves/
  musicien:Ghismo,Shook_Shook
  invité:Just_Higgins
  ```
- Fonction `loadAcl()` dans `server.js` :
  - Si `.acl` absent → retourner `{}` (accès total pour tous)
  - Parser chaque ligne non-commentée : `username → Set<slug>`
  - Ligne `username:` sans slugs → `Set` vide (aucun accès)
- Fonction `isAllowed(acl, username, topSlug)` :
  - Si `acl` est vide (`{}`) → `true`
  - Si `username` absent de `acl` → `true` (utilisateur admin)
  - Sinon → `acl[username].has(topSlug)`
- Appeler `loadAcl()` au démarrage, stocker dans `const acl = loadAcl()`
- Fonction utilitaire `firstSegment(relPath)` : `relPath.split('/')[0]` ou `''` si chemin vide

### 33.2 — Filtrage de la liste racine (`GET /api/grooves`)

Appliquer l'ACL sur la route de navigation principale.

- Route `GET /api/grooves` (sans `?path`) : après avoir collecté les `items`, filtrer avec `isAllowed(acl, user, item.slug)` avant d'envoyer la réponse
- Route `GET /api/grooves?path=X` : si `X` est non vide, extraire `firstSegment(X)` et retourner 403 si `!isAllowed(acl, user, seg)`
- L'utilisateur restreint naviguant dans un sous-dossier autorisé (`?path=Ghismo/Live`) ne voit jamais de dossiers d'un autre conteneur racine — le contrôle au premier segment suffit
- `GET /api/search` : filtrer chaque résultat par `isAllowed(acl, user, firstSegment(groove.path))`
- `GET /api/comments-summary` : filtrer de même les grooves renvoyés dans le résumé

### 33.3 — Garde sur les routes d'accès aux contenus API

Protéger toutes les routes qui acceptent un chemin groove en paramètre.

- Créer une fonction helper `checkAccess(req, res, groovePath)` :
  ```js
  function checkAccess(req, res, groovePath) {
    const seg = firstSegment(groovePath);
    if (seg && !isAllowed(acl, req.auth.user, seg)) {
      res.status(403).json({ error: 'Accès interdit' });
      return false;
    }
    return true;
  }
  ```
- Appeler `checkAccess` en tête de chaque handler des routes suivantes (juste après `resolveGrooveDir` quand elle existe) :
  - `GET /api/grooves/*/md`
  - `GET /api/grooves/*/download`
  - `GET /api/grooves/*` (détail groove)
  - `GET /api/mix/*` et `POST /api/mix/*`
  - `GET /api/loop/*` et `POST /api/loop/*`
  - `GET /api/markers/*` et `POST /api/markers/*`
  - `GET /api/comments/*`, `POST /api/comments/*`, `DELETE` et `PATCH` comments
  - `GET /api/peaks/*` et `POST /api/peaks/*`
- Le chemin groove est toujours `req.params[0]` (avant `decodeURIComponent`) pour ces routes

### 33.4 — Garde sur les fichiers servis (`/audio/*`, `/tab/*`)

Protéger les routes de streaming de fichiers, qui reconstruisent le `groovePath` depuis le chemin de la requête.

- Dans `GET /audio/*` : après avoir calculé `groovePath` (ligne 435), appeler `checkAccess(req, res, groovePath)` avant `res.sendFile`
- Dans `GET /tab/*` : même chose après calcul de `groovePath` (ligne 455)
- Le `groovePath` dans ces routes est déjà le chemin sans le nom de fichier (ex : `Ghismo/Live`), donc `firstSegment` retourne `Ghismo` — pas besoin de traitement supplémentaire

### 33.5 — Documentation et `.acl.example`

Finaliser et documenter le mécanisme.

- Vérifier que `.acl.example` est bien présent et complet (cf. story 33.1)
- Ajouter `.acl` à `.gitignore` (comme `.auth`) s'il n'y est pas déjà
- Mettre à jour le `README.md` (section configuration) pour mentionner le fichier `.acl`, son format, et la sémantique whitelist/absence

---

## Critères d'acceptance

- [ ] Sans fichier `.acl`, tous les utilisateurs voient tous les dossiers — comportement identique à avant l'epic
- [ ] Avec un `.acl` déclarant `musicien:Ghismo`, l'utilisateur `musicien` ne voit que `Ghismo` dans la liste racine
- [ ] L'utilisateur `admin` absent du `.acl` voit tous les dossiers même si `.acl` existe
- [ ] Un utilisateur restreint qui accède directement à `GET /api/grooves?path=Archives Higgins Mixer` reçoit 403
- [ ] Un utilisateur restreint qui accède à `/audio/Archives Higgins Mixer/chanson/track.mp3` reçoit 403
- [ ] Un utilisateur restreint peut ouvrir et lire un fichier audio dans son dossier autorisé sans erreur
- [ ] Un utilisateur restreint ne voit dans `GET /api/search` que les grooves de ses dossiers autorisés
- [ ] Un utilisateur restreint ne voit dans `GET /api/comments-summary` que les grooves autorisés
- [ ] Ajouter ou retirer un slug dans `.acl` prend effet au prochain redémarrage du serveur (pas de rechargement à chaud nécessaire)
- [ ] Un slug inexistant dans `.acl` (faute de frappe) ne génère pas d'erreur — le dossier est simplement absent de la liste
- [ ] Aucune régression sur la navigation, le player, le mix, les marqueurs ni les commentaires pour un utilisateur sans restrictions
