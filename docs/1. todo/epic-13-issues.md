# Epic 13 — Issues détaillées

> Généré depuis epic-13-tablature.md pour guider l'implémentation.

---

## EPIC-13-001 — Détection GP côté serveur

**Story** : 13.1  
**Fichier** : `server.js`

### Changements
- Ajouter `const GP_EXTENSIONS = new Set(['.gp', '.gpx', '.gp8'])`
- Dans `/api/grooves/:name` : scanner les entrées pour un fichier GP, inclure `tabFile: filename | null` dans la réponse JSON
- Ajouter route `GET /tab/:groove/:file` qui sert les fichiers GP (identique à `/audio` mais pour extensions GP)

### Critère d'acceptance
`GET /api/grooves/mon_groove` retourne `{ ..., "tabFile": "partition.gp8" }` si le fichier existe, `"tabFile": null` sinon.

---

## EPIC-13-002 — Markup HTML du drawer

**Story** : 13.2  
**Fichier** : `public/player.html`

### Changements
Ajouter le bloc `#tab-drawer` juste avant `<script>` dans le body, HORS de `#player-main` :

```html
<div id="tab-drawer" class="tab-drawer" hidden>
  <div id="tab-handle" class="tab-handle">
    <div class="tab-handle-grip"></div>
    <div class="tab-drawer-header">
      <span class="tab-drawer-title">Tablature</span>
      <div id="tab-track-list" class="tab-track-list"></div>
      <div class="tab-loop-controls" id="tab-loop-controls" hidden>
        <button id="btn-tab-loop-clear" class="tab-btn" title="Effacer la boucle tablature">✕ boucle</button>
      </div>
      <button id="btn-tab-strip" class="tab-btn tab-btn--state" title="Mode strip" aria-pressed="true">▬</button>
      <button id="btn-tab-expand" class="tab-btn tab-btn--state" title="Étendre" aria-pressed="false">⤢</button>
      <button id="btn-tab-collapse" class="tab-btn tab-btn--state" title="Réduire" aria-pressed="false">−</button>
    </div>
  </div>
  <div id="tab-content" class="tab-content"></div>
</div>
```

---

## EPIC-13-003 — CSS drawer 3 états + transport ajustement

**Story** : 13.2  
**Fichier** : `public/css/style.css`

### Changements
- `.tab-drawer` : `position: fixed; bottom: 0; left: 0; right: 0; z-index: 8; background: #141414; border-top: 1px solid #2a2a2a; transition: height 200ms ease`
- État `collapsed` : `height: 40px; overflow: hidden`
- État `strip` : `height: 160px`
- État `expanded` : `height: 60vh`
- `.tab-handle` : zone draggable en haut du drawer, curseur `ns-resize`
- `.tab-content` : `flex: 1; overflow: hidden; position: relative`
- Transport : `bottom: var(--drawer-height, 0px)` pour sticky au-dessus du drawer
- `#player-main` : `padding-bottom: var(--drawer-height, 0px)`

---

## EPIC-13-004 — Mobile detection guard

**Story** : 13.7  
**Fichier** : `public/js/player.js`

### Changements
```js
const IS_DESKTOP = window.matchMedia('(min-width: 769px)').matches
```
Toute la logique tablature est conditionnée par `IS_DESKTOP`. Sur mobile :
- Pas de markup drawer ajouté
- AlphaTab non chargé
- `tabFile` ignoré même si présent dans la réponse API

---

## EPIC-13-005 — Chargement lazy AlphaTab

**Story** : 13.3  
**Fichier** : `public/js/player.js`

### Changements
```js
async function loadAlphaTab() {
  const CDN = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1/dist/alphatab.mjs'
  const mod = await import(CDN)
  return mod
}
```
Appelé uniquement si `groove.tabFile !== null` et `IS_DESKTOP`.

---

## EPIC-13-006 — State machine du drawer + drag handle

**Story** : 13.2 (JS)  
**Fichier** : `public/js/player.js`

### Changements
- Variable `tabState = 'strip' | 'collapsed' | 'expanded'`
- Fonction `setTabState(state)` : met à jour classList du drawer, met à jour `--drawer-height` CSS var, reconfigure AlphaTab layout mode
- Drag handle : mousedown sur `.tab-handle`, delta Y → snap à l'état le plus proche
- Boutons strip/expand/collapse dans le header

Heights cibles :
- collapsed : 40px
- strip : 160px  
- expanded : 60% de la viewport height

---

## EPIC-13-007 — Init AlphaTab + chargement score

**Story** : 13.3  
**Fichier** : `public/js/player.js`

### Changements
```js
const alphaTabApi = new alphaTab.AlphaTabApi(tabContentEl, {
  player: {
    enablePlayer: true,
    enableCursor: true,
    enableUserInteraction: true,
    soundFont: null,
  },
  display: {
    layoutMode: alphaTab.LayoutMode.HorizontalLine,
    staveProfile: alphaTab.StaveProfile.ScoreTab,
  },
  core: {
    logLevel: alphaTab.LogLevel.None,
  }
})
alphaTabApi.load(`/tab/${grooveSlug}/${groove.tabFile}`)
```

Gestion des événements :
- `alphaTabApi.scoreLoaded.on(score => { buildTrackSelector(score) })`
- `alphaTabApi.renderFinished.on(() => { ... })`

---

## EPIC-13-008 — Sélecteur de pistes GP

**Story** : 13.4  
**Fichier** : `public/js/player.js`

### Changements
Après `scoreLoaded` :
```js
function buildTrackSelector(score) {
  const container = document.getElementById('tab-track-list')
  container.innerHTML = ''
  score.tracks.forEach((track, i) => {
    const label = document.createElement('label')
    label.className = 'tab-track-label'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = true
    cb.addEventListener('change', updateTrackSelection)
    label.append(cb, document.createTextNode(track.name))
    container.appendChild(label)
  })
}
function updateTrackSelection() {
  const cbs = document.querySelectorAll('#tab-track-list input[type=checkbox]')
  const selected = alphaTabApi.score.tracks.filter((_, i) => cbs[i]?.checked)
  alphaTabApi.renderTracks(selected.length > 0 ? selected : [alphaTabApi.score.tracks[0]])
}
```

---

## EPIC-13-009 — Boucle RAF sync

**Story** : 13.5  
**Fichier** : `public/js/player.js`

### Changements
```js
let tabSyncRafId = null

function startTabSync() {
  if (tabSyncRafId) return
  function loop() {
    if (alphaTabApi && tabState !== 'collapsed') {
      const wsMs = (wavesurfers[0]?.getCurrentTime() ?? 0) * 1000
      alphaTabApi.timePosition = wsMs
    }
    tabSyncRafId = requestAnimationFrame(loop)
  }
  tabSyncRafId = requestAnimationFrame(loop)
}

function stopTabSync() {
  if (tabSyncRafId) {
    cancelAnimationFrame(tabSyncRafId)
    tabSyncRafId = null
  }
}
```

Démarré quand drawer passe en strip/expanded.
Suspendu quand collapsed.

Note : pas de tempoFactor dans `timePosition` car `getCurrentTime()` retourne la position fichier (pas le temps réel), qui correspond directement au temps score.

---

## EPIC-13-010 — Boucles par mesure

**Story** : 13.6  
**Fichier** : `public/js/player.js`

### Changements
Quand `tabState !== 'collapsed'` :
- Désactiver la création de régions par drag WaveSurfer (ne pas appeler `enableDragSelection`)
- Activer écoute sur `alphaTabApi.beatMouseDown`

```js
let tabLoopPending = null  // 'start' | null

alphaTabApi.beatMouseDown.on(beat => {
  if (tabState === 'collapsed') return
  
  // Lire la position temporelle du beat via tick → time
  const prevTickPos = alphaTabApi.tickPosition
  alphaTabApi.tickPosition = beat.absolutePlaybackStart
  const beatMs = alphaTabApi.timePosition
  alphaTabApi.tickPosition = prevTickPos  // restaurer
  
  const wsTimeSec = beatMs / 1000  // direct, pas de tempoFactor (voir EPIC-13-009)
  
  if (tabLoopPending === null) {
    tabLoopPending = wsTimeSec
    // visual feedback: highlight start
  } else {
    const start = Math.min(tabLoopPending, wsTimeSec)
    const end = Math.max(tabLoopPending, wsTimeSec)
    tabLoopPending = null
    syncRegionToAll(start, end)
    setLoopEnabled(true)
    document.getElementById('tab-loop-controls').removeAttribute('hidden')
  }
})
```

Bouton "Effacer la boucle" dans le header : appelle `clearLoop()` + `tabLoopPending = null`.

---

## Notes d'implémentation

- AlphaTab CDN : `https://cdn.jsdelivr.net/npm/@coderline/alphatab@1/dist/alphatab.mjs`
- Le worker AlphaTab est auto-découvert via `import.meta.url` depuis le CDN
- `enablePlayer: true` est nécessaire pour que le curseur fonctionne même sans audio
- `soundFont: null` désactive la synthèse audio interne
- En mode `strip` : `LayoutMode.HorizontalLine` (une ligne continue)
- En mode `expanded` : `LayoutMode.Page` (multi-lignes)
- Drawer z-index 8 < transport z-index 10 → transport toujours visible au-dessus

