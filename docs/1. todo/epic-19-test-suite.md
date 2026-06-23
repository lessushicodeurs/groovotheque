# Epic 19 — Suite de tests automatisés

## Objectif

Mettre en place une suite de tests automatisés couvrant l'ensemble du projet — API serveur, logique pure JS et parcours UI complets — avec captures d'écran au premier échec et régression visuelle sélective sur les écrans critiques. Pose également les bases d'une pratique TDD pour les épics futures.

## Décisions d'architecture

| Sujet | Décision |
|-------|----------|
| Tests E2E / UI | Playwright (`@playwright/test`) + Chromium |
| Tests API | Jest + Supertest |
| Tests unitaires | Jest (sans DOM) |
| Screenshots | On-failure automatique + baselines visuelles sur 4 écrans stables |
| Fixtures audio | Synthétiques (WAV ~1s) sauf tests AlphaTab → groove réel |
| Auth de test | `TEST_AUTH_FILE` env var dans `server.js` → fichier `.auth` dédié |
| Organisation | Un spec par domaine fonctionnel (`ui/`, `api/`, `unit/`) |
| CI | Hors scope |

## Méthodologie TDD (objectif pour les épics futures)

À partir de cette epic, chaque nouvelle implémentation suit ce protocole :

1. **Créer le spec en premier** : avant d'écrire le code, créer `tests/ui/<feature>.spec.js` avec les `test.skip()` correspondant aux critères d'acceptance de l'epic
2. **Red** : les tests échouent (l'implémentation n'existe pas encore)
3. **Green** : implémenter jusqu'à ce que tous les tests passent
4. **Refactor** : nettoyer sans casser les tests

Convention de nommage : le nom du test décrit le comportement attendu en langage naturel (`'le curseur AlphaTab suit la tête de lecture en strip'`), pas l'implémentation.

---

## Dépendances techniques à installer

```bash
npm install --save-dev @playwright/test jest supertest
npx playwright install chromium
```

---

## Stories

### 19.1 — Infrastructure et configuration

**Installer les outils**
- `npm install --save-dev @playwright/test jest supertest`
- `npx playwright install chromium`

**Structure de répertoires**
```
tests/
  fixtures/
    grooves/
      _test-groove/        # 2 pistes WAV ~1s, pas de fichier GP
        01-bass.wav
        02-guitar.wav
    .auth                  # hash bcrypt d'un user `test` et d'un `admin`
  unit/
  api/
  ui/
```

**`playwright.config.js`**
```js
module.exports = defineConfig({
  testDir: './tests',
  timeout: 90000,           // AlphaTab + CDN = lent
  retries: 0,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  expect: {
    toMatchSnapshot: { maxDiffPixelRatio: 0.02 },  // tolérance 2%
  },
  webServer: {
    command: 'TEST_AUTH_FILE=tests/fixtures/.auth node server.js',
    url: 'http://localhost:3099',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
```

**`jest.config.js`**
```js
module.exports = {
  testMatch: ['**/tests/unit/**/*.spec.js', '**/tests/api/**/*.spec.js'],
  testEnvironment: 'node',
}
```

**Scripts npm**
```json
"test:unit":  "jest tests/unit",
"test:api":   "jest tests/api",
"test:ui":    "playwright test tests/ui",
"test":       "npm run test:unit && npm run test:api && npm run test:ui"
```

**Helper partagé `tests/helpers/auth.js`**
- Encode les credentials basic auth en base64 pour Supertest et Playwright
- Expose `testUser`, `adminUser`, `BASE_URL`

---

### 19.2 — Modification mineure de `server.js`

Lire `process.env.TEST_AUTH_FILE` en fallback de `.auth` :

```js
const AUTH_FILE = process.env.TEST_AUTH_FILE || path.join(__dirname, '.auth')
```

Aucun autre changement — les vrais credentials de prod ne sont jamais touchés par les tests.

---

### 19.3 — Extraction de `public/js/utils.js`

Extraire de `player.js` et `app.js` les fonctions pures suivantes dans `public/js/utils.js`, puis les importer en retour :

- `formatTimecode(seconds)` — depuis `player.js`
- `sanitizeHtml(html)` — depuis `app.js`

Aucun changement de comportement. Permet l'import dans les tests Jest sans browser.

---

### 19.4 — Tests unitaires (`tests/unit/utils.spec.js`)

**`formatTimecode`**
- `0` → `'0:00.0'`
- `1.5` → `'0:01.5'`
- `59.9` → `'0:59.9'`
- `60` → `'1:00.0'`
- `3661.2` → `'61:01.2'`
- Valeur décimale arrondie à 1 décimale

**`sanitizeHtml`**
- `<script>alert(1)</script>` → chaîne vide
- `<p onclick="x()">texte</p>` → `<p>texte</p>` (attribut `on*` supprimé)
- `<a href="javascript:void(0)">lien</a>` → `<a>lien</a>`
- `<iframe src="x">` → supprimé
- `<p><em>texte</em></p>` → conservé intact

---

### 19.5 — Tests API (`tests/api/server.spec.js`)

**Authentification**
- `GET /api/grooves` sans credentials → 401
- `GET /api/grooves` avec credentials valides → 200

**Listing et détail**
- `GET /api/grooves` retourne `_test-groove`, exclut les dossiers `hidden~`
- `GET /api/grooves/_test-groove` retourne les pistes triées par préfixe numérique
- `GET /api/grooves/_test-groove` sans fichier GP → `tabFile` absent ou null
- `GET /api/grooves/clark-sisters-ha-ya` avec fichier `.gp8` → `tabFile` renseigné

**Sécurité**
- `GET /audio/_test-groove/../../.auth` → 403 (path traversal)
- `GET /audio/_test-groove/inexistant.mp3` → 404

**Peaks et mix**
- `GET /api/peaks/_test-groove/01-bass.wav` → 404 avant tout cache
- `POST /api/peaks/_test-groove/01-bass.wav` (admin) → 200, fichier `.peaks.json` créé
- `GET /api/peaks/_test-groove/01-bass.wav` après POST → 200
- `POST /api/mix/_test-groove` avec user non-admin → 403
- `POST /api/mix/_test-groove` avec admin → 200
- `GET /api/mix/_test-groove` après POST → retourne les données sauvegardées

**Template**
- `GET /player.html` → contient `window.CURRENT_USER`

---

### 19.6 — Tests UI : liste de grooves (`tests/ui/groove-list.spec.js`)

- La page d'accueil affiche au moins un groove
- Un groove avec notes disponibles : hover → tooltip visible
- Un groove sans notes : hover → pas de tooltip
- Tooltip trop à droite du viewport → repositionné à gauche (viewport 600px)

---

### 19.7 — Tests UI : transport (`tests/ui/transport.spec.js`)

- Le player charge les 2 pistes de `_test-groove`
- Bouton Play → état `isPlaying` reflété sur le bouton (aria ou classe CSS)
- Bouton Pause → lecture stoppée
- Bouton Stop → timecode revient à `0:00.0`
- Seek par clic sur la waveform → timecode mis à jour
- Champ IN défini → valeur reflétée dans le transport
- Champ OUT défini → valeur reflétée dans le transport
- Bouton Clear loop → IN et OUT réinitialisés
- Slider tempo à 80% → `currentTempoRatio` dans `window` = 0.8
- **Snapshot visuel** : transport bar desktop (1280×800) après chargement complet

---

### 19.8 — Tests UI : contrôles de piste (`tests/ui/tracks.spec.js`)

- Bouton Mute piste 0 → classe ou aria indiquant l'état muet
- Deuxième clic Mute → état normal rétabli
- Bouton Solo piste 0 → les autres pistes passent en état muet
- Deuxième clic Solo → état normal rétabli
- Slider volume piste → `trackStates[0].volume` mis à jour dans `window`
- Pan knob → `trackStates[0].pan` mis à jour dans `window` (simulation drag)
- **Snapshot visuel** : disposition des pistes desktop (1280×800)

---

### 19.9 — Tests UI : mix admin (`tests/ui/mix-admin.spec.js`)

- Connecté en user non-admin → bouton "Sauvegarder le mix" absent du DOM
- Connecté en admin → bouton visible
- Admin modifie le volume piste 0, clique Sauvegarder → `GET /api/mix/` retourne la valeur modifiée
- Rechargement du player → mix restauré

---

### 19.10 — Tests UI : responsive (`tests/ui/responsive.spec.js`)

- Viewport 375×667 : drawer transport visible en bas
- Viewport 375×667 : contrôles de piste accessibles via le drawer
- Viewport 1280×800 : sidebar visible sans drawer
- **Snapshot visuel** : transport mobile (375×667) après chargement

---

### 19.11 — Tests UI : tablature (`tests/ui/tablature.spec.js`)

Migrer et compléter `tests/tab-scroll.spec.js` du worktree epic-13 :

**Présence conditionnelle**
- Groove sans fichier GP → aucun élément `.tab-drawer` dans le DOM
- Groove avec `.gp8` sur desktop → `.tab-drawer` monté en état `strip`
- Mobile viewport (375×667) → aucun drawer, `window.__alphaTabApi` inexistant

**États du drawer**
- Drag du handle vers le haut → classe `tab-drawer--expanded`
- Drag du handle vers le bas → classe `tab-drawer--collapsed`
- **Snapshot visuel** : drawer en mode strip après rendu AlphaTab

**Synchronisation** *(tests migrés depuis `tab-scroll.spec.js`)*
- `scrollLeft` augmente proportionnellement à `timePosition`
- Seek en arrière → `scrollLeft` diminue
- Curseur reste entre 15% et 75% du viewport en mode strip
- Mode fullscreen → `scrollTop` augmente quand le curseur descend

---

### 19.12 — Stubs pour les épics futures

Créer des fichiers avec `test.skip()` pour chaque critère d'acceptance, à compléter lors de la livraison de l'epic correspondante :

**`tests/ui/markers.spec.js`** (epic 17)
- Lane de marqueurs visible au-dessus des pistes
- Drag crée une région
- Double-clic → popover d'édition du label
- Clic sur une région → IN/OUT mis à jour dans le transport
- `|<<` / `>>|` naviguent entre régions
- Mobile : tap set le cycle, pas de création
- Mix sauvegardé/rechargé → marqueurs présents

**`tests/ui/zoom.spec.js`** (epic 18)
- Bouton `+` → indicateur passe à `2×`
- Bouton `−` désactivé à `1×`, actif à `2×`
- Clic sur l'indicateur → reset à `1×`
- Zoom > 1× → scrollbar horizontale visible
- Clic sur waveform zoomée → positionnement précis de la tête de lecture

---

### 19.13 — Génération des baselines visuelles

Une fois tous les tests verts, générer les 4 snapshots de référence :

```bash
npx playwright test --update-snapshots tests/ui/transport.spec.js
npx playwright test --update-snapshots tests/ui/tracks.spec.js
npx playwright test --update-snapshots tests/ui/responsive.spec.js
npx playwright test --update-snapshots tests/ui/tablature.spec.js
```

Les `.png` générés dans `tests/ui/__snapshots__/` sont commités. Toute variation > 2% fait échouer le test.

---

## Ordre d'implémentation recommandé

1. **19.1 → 19.2 → 19.3** : infrastructure + prérequis
2. **19.4 → 19.5** : tests sans browser, validation rapide de la stack
3. **19.7 → 19.8 → 19.9 → 19.10** : UI core avec fixtures synthétiques
4. **19.6** : liste grooves
5. **19.11** : tablature (après merge de l'epic-13)
6. **19.12** : stubs futures
7. **19.13** : baselines visuelles (tout vert)

---

## Critères d'acceptance

- `npm test` passe en headless sans intervention manuelle
- Aucun test ne touche le `.auth` de production
- Aucun test ne dépend de fichiers audio de production (sauf `tablature.spec.js`)
- Un test qui échoue produit un screenshot automatique dans `test-results/`
- Les 4 baselines visuelles sont commitées et stables
- Les stubs épics 17 et 18 sont présents avec leurs critères d'acceptance en `test.skip()`
