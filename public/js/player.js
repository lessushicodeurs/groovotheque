import { marked } from '/vendor/marked.esm.js'
import WaveSurfer from '/vendor/wavesurfer.esm.js'
import TimelinePlugin from '/vendor/plugins/timeline.esm.js'
import HoverPlugin from '/vendor/plugins/hover.esm.js'
import RegionsPlugin from '/vendor/plugins/regions.esm.js'
import {
  getSeenIds, markCommentsSeen, isDiscussionSeen,
  displayAuthor, formatRelativeDate,
  formatPosition as formatCommentPosition,
} from './comments-shared.js'
import { exportMix } from './mix-export.js'

const TRACK_COLORS = [
  '#4fc3f7',
  '#a5d6a7',
  '#ffb74d',
  '#f48fb1',
  '#ce93d8',
  '#80cbc4',
  '#fff176',
  '#ef9a9a',
]

const isMobile = window.innerWidth < 768

// Shared Web Audio context for pan/gain routing across all tracks.
// Created eagerly; browsers suspend it until first user gesture.
const sharedAudioCtx = new AudioContext()

const params = new URLSearchParams(location.search)
const grooveSlug = params.get('groove')

// Encode un chemin relatif pour l'utiliser dans une URL path
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/')
}

// 13.7 — Desktop only: tablature désactivée sur mobile.
// Même seuil que isMobile : à 768 px exactement, un groove tab-only affichait
// sinon le message « ouvrez-le sur desktop » sur un affichage desktop.
const IS_DESKTOP = window.matchMedia('(min-width: 768px)').matches

const titleEl          = document.getElementById('groove-title')
const loadBarEl        = document.getElementById('load-bar')
const mainEl           = document.getElementById('player-main')
const tracksContainer  = document.getElementById('tracks-container')
const drawerEl         = document.getElementById('transport-drawer')
const handleEl         = document.getElementById('transport-handle')
const transportEl      = document.getElementById('transport')
const btnPlay          = document.getElementById('btn-play')
const btnStop          = document.getElementById('btn-stop')
const timecodeEl       = document.getElementById('timecode')
const durationEl       = document.getElementById('duration')
const btnTimeModeEl    = document.getElementById('btn-time-mode')
const seekBarEl        = document.getElementById('seek-bar')
const seekFillEl       = document.getElementById('seek-fill')
const loopInEl         = document.getElementById('loop-in')
const loopOutEl        = document.getElementById('loop-out')
const btnLoop          = document.getElementById('btn-loop')
const btnLoopGoIn      = document.getElementById('btn-loop-go-in')
const btnLoopGoOut     = document.getElementById('btn-loop-go-out')
const btnLoopClear     = document.getElementById('btn-loop-clear')
const btnPrev          = document.getElementById('btn-prev')
const btnNext          = document.getElementById('btn-next')
const btnSaveMix       = document.getElementById('btn-save-mix')
const btnDownloadAll   = document.getElementById('btn-download-all')
const downloadWrap     = document.getElementById('download-wrap')
const downloadMenu     = document.getElementById('download-menu')
const downloadStatusEl = document.getElementById('download-status')

// ── Epic 22 — DOM refs commentaires ──────────────────────────────────────
const btnAddComment        = document.getElementById('btn-add-comment')
const btnToggleComments    = document.getElementById('btn-toggle-comments')
const transportCommentsEl  = document.getElementById('transport-comments')
const commentBadgeEl       = document.getElementById('comment-badge')
const commentModalBackdrop = document.getElementById('comment-modal-backdrop')
const commentModalPosition = document.getElementById('comment-modal-position')
const commentModalText     = document.getElementById('comment-modal-text')
const commentModalCancel   = document.getElementById('comment-modal-cancel')
const commentModalSubmit   = document.getElementById('comment-modal-submit')
// 37.5 — signature du rédacteur
const commentModalSigned     = document.getElementById('comment-modal-signed')
const commentModalSignedName = document.getElementById('comment-modal-signed-name')
const commentModalEditName   = document.getElementById('comment-modal-edit-name')
const commentModalName       = document.getElementById('comment-modal-name')
const authorNameBackdrop     = document.getElementById('author-name-backdrop')
const authorNameInput        = document.getElementById('author-name-input')
const authorNameCancel       = document.getElementById('author-name-cancel')
const authorNameSubmit       = document.getElementById('author-name-submit')
const commentPopoverEl     = document.getElementById('comment-popover')
const cpInitials           = document.getElementById('cp-initials')
const cpAuthor             = document.getElementById('cp-author')
const cpPos                = document.getElementById('cp-pos')
const cpText               = document.getElementById('cp-text')
const cpDate               = document.getElementById('cp-date')
const cpReplies            = document.getElementById('cp-replies')
const cpReplyInput         = document.getElementById('cp-reply-input')
const cpReplySend          = document.getElementById('cp-reply-send')
const cpActions            = document.getElementById('cp-actions')
const tempoSliderEl    = document.getElementById('tempo-slider')
const tempoValueEl     = document.getElementById('tempo-value')
const tempoBadgeEl     = document.getElementById('tempo-badge')
const tempoPresets     = Array.from(document.querySelectorAll('.tempo-preset'))

// ── Epic 18 — Contrôles de zoom ──────────────────────────────────────────
const btnZoomOut   = document.getElementById('btn-zoom-out')
const btnZoomIn    = document.getElementById('btn-zoom-in')
const btnZoomLevel = document.getElementById('btn-zoom-level')
const wfScrollbarEl    = document.getElementById('waveform-scrollbar')
const wfScrollThumbEl  = document.getElementById('waveform-scrollbar-thumb')

// 13.2 — Tab drawer DOM elements
const tabDrawerEl       = document.getElementById('tab-drawer')
const tabHandleEl       = document.getElementById('tab-handle')
const tabContentEl      = document.getElementById('tab-content')
const tabTrackListEl    = document.getElementById('tab-track-list')

const btnTabFullscreen   = document.getElementById('btn-tab-fullscreen')
const btnTabStrip        = document.getElementById('btn-tab-strip')
const btnTabCollapse     = document.getElementById('btn-tab-collapse')

const btnTabScrollResume = document.getElementById('btn-tab-scroll-resume')

let prevSlug = null
let nextSlug = null

btnPrev.addEventListener('click', () => {
  if (prevSlug) location.href = '/player.html?groove=' + encodePath(prevSlug)
})
btnNext.addEventListener('click', () => {
  if (nextSlug) location.href = '/player.html?groove=' + encodePath(nextSlug)
})

let loadedCount = 0
let totalTracks = 0

function initLoadBar(n) {
  totalTracks = n
  loadBarEl.classList.add('segmented')
  loadBarEl.setAttribute('aria-valuenow', '0')
  const segWidth = 100 / n
  for (let i = 0; i < n; i++) {
    const seg = document.createElement('div')
    seg.className = 'load-bar-segment'
    seg.style.left = `${i * segWidth}%`
    seg.style.width = `${segWidth}%`
    seg.dataset.idx = String(i)
    loadBarEl.appendChild(seg)
  }
}

function markSegmentLoaded(idx, color) {
  const seg = loadBarEl.querySelector(`[data-idx="${idx}"]`)
  if (!seg || seg.dataset.loaded) return
  seg.dataset.loaded = '1'
  seg.style.backgroundColor = color
  loadedCount++
  loadBarEl.setAttribute('aria-valuenow', String(Math.round((loadedCount / totalTracks) * 100)))
  if (loadedCount >= totalTracks) finishLoading()
}

function finishLoading() {
  mainEl.classList.remove('loading')
  loadBarEl.classList.add('done')
  btnLoopGoIn.disabled = false
  btnLoopGoOut.disabled = false
}

function showFatalError(msg, isError = true) {
  mainEl.classList.remove('loading')
  loadBarEl.classList.add('done')
  const p = document.createElement('p')
  p.className = isError ? 'state-msg error' : 'state-msg'
  p.textContent = msg
  mainEl.prepend(p)
}

const wavesurfers  = []
const trackStates  = []   // { volume, muted, soloed }
const trackRegions = []   // RegionsPlugin instance per track
const volSliders   = []   // input[type=range] per track, for mix restore
const gainNodes    = []   // GainNode per track (volume in Web Audio graph)
const panNodes     = []   // StereoPannerNode per track
const panKnobs       = []   // PanKnob UI per track
const webAudioRouted = []   // true if MediaElementSource successfully connected
const waveEls        = []   // .track-wave div per track (contenu à la largeur effective)
const waveVpEls      = []   // .track-wave-vp div per track (viewport, largeur proportionnelle)
// Source décodable de chaque piste pour l'export (URL serveur, ou URL d'objet
// pour le backing track embarqué dans le fichier GP), null si non exportable.
const trackSourceUrls = []
const trackDurations = []   // duration in seconds per track, set on 'ready'
let timelinePluginRef = null  // TimelinePlugin instance (track 0), for duration correction
let timelineExtEl     = null  // container DOM element for TimelinePlugin (in .timeline-row)
let timelineVpEl      = null  // .timeline-wave-vp (viewport de la rangée timeline)
let timelineWaveColEl = null  // .timeline-wave-col (contenu à la largeur effective)
let currentTracks  = []   // groove.tracks list, set at init time
let pendingLoop    = null // loop à restaurer dès que toutes les waveforms sont prêtes
let isPlaying       = false
let seekGen         = 0    // increments on every seek; prevents stale async play() callbacks
let totalDuration   = 0
let activeLoopIn    = null // seconds or null
let activeLoopOut   = null // seconds or null
let loopEnabled     = false
let isSyncingRegion = false
let loopJumping     = false  // prevents double-trigger of loop rebound
let loopFieldCommitting = false  // prevents blur re-running commit after Enter
let currentTempo    = 100  // percent (50–120)
let drawerOpen      = true

// ── Epic 17 — Marker band state ───────────────────────────────────────────
let markerLaneEl      = null
let markerPopoverEl   = null
let markers           = []    // { id, start, end, label }[]
let markerAnchorId    = null  // premier marqueur cliqué (ancre de la sélection)
let markerSelectionIn = null  // borne gauche de la sélection courante (peut couvrir N marqueurs)
let markerSelectionOut= null  // borne droite
let markerIdCounter   = 0

// ── Epic 18 — Zoom horizontal ─────────────────────────────────────────────
// Le zoom élargit le *contenu* (timeline, bande de marqueurs, waveforms) à
// `largeurViewport × zoomLevel`. Tout le positionnement existant est en % du
// contenu, il suit donc le zoom sans calcul supplémentaire. Le défilement est
// une simple translation appliquée identiquement à toutes les rangées, ce qui
// garantit un alignement au pixel près.
// Le plafond n'est pas le navigateur mais le cache de peaks, figé à 8000 points
// par piste : au-delà de 8000 × (barWidth + barGap) / largeur du viewport, le
// zoom n'affiche plus d'information supplémentaire. 32× est le dernier palier
// qui apporte encore de la précision de pointage.
const ZOOM_LEVELS = [1, 2, 4, 8, 16, 32]
let zoomLevel        = 1      // palier courant (session uniquement, jamais persisté)
let zoomScrollX      = 0      // décalage horizontal courant, en pixels
let zoomUserScrolled = false  // 18.5 — l'utilisateur a repris la main sur le défilement

// ── Epic 22 — Comments state ──────────────────────────────────────────────
let commentMarkersLaneEl  = null  // div dans .timeline-wave-col pour les triangles
let currentComments       = []    // { id, position, author, text, createdAt, replies }[]
let commentsVisible       = true
let activeCommentId       = null  // commentaire ouvert dans le popover
let commentModalPosition_ = 0    // position capturée à l'ouverture de la modal

// 37.4 — lien profond ?comment=<id> : seek + popover à l'arrivée
let pendingDeepLinkCommentId = params.get('comment')
let commentsLoaded = false

// Appelé après le chargement des commentaires ET après le rendu des pistes
// (adjustTrackWidths), quel que soit l'ordre d'arrivée. ID inconnu ou
// commentaire supprimé entre-temps : le player s'ouvre normalement.
function tryOpenDeepLinkComment() {
  if (!pendingDeepLinkCommentId || !commentsLoaded || !totalDuration) return
  const comment = currentComments.find(c => c.id === pendingDeepLinkCommentId)
  pendingDeepLinkCommentId = null
  if (!comment) return
  const markerEl = commentMarkersLaneEl?.querySelector(`[data-comment-id="${comment.id}"]`)
  openCommentPopover(comment, markerEl ?? commentMarkersLaneEl)
}

// getSeenIds / markCommentsSeen / isDiscussionSeen / formatCommentPosition
// vivent dans comments-shared.js (partagés avec l'index)

function markCommentSeen(id) {
  markCommentsSeen([id])
}

function initials(name) {
  if (!name) return '?'
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

// ── 37.5 — Nom de rédacteur ───────────────────────────────────────────────

const AUTHOR_KEY = 'groovotheque:author_name'

function getAuthorName() {
  try { return (localStorage.getItem(AUTHOR_KEY) || '').trim() } catch { return '' }
}

function setAuthorName(name) {
  try { localStorage.setItem(AUTHOR_KEY, name.trim()) } catch { /* ignore */ }
}

// Garde-fou d'ergonomie (pas de sécurité serveur) : Éditer/Supprimer visibles
// sur ses propres commentaires ; l'admin voit tout ; les commentaires
// antérieurs à l'epic (sans authorName) restent gérables par le même compte.
function canManageComment(comment) {
  if (window.CURRENT_USER === 'admin') return true
  if (comment.author !== window.CURRENT_USER) return false
  return !comment.authorName || comment.authorName === getAuthorName()
}

// Demande le prénom via une petite modal si absent du localStorage.
// Résout avec le nom, ou null si l'utilisateur annule.
let authorNamePromptResolve = null

function ensureAuthorName() {
  const existing = getAuthorName()
  if (existing) return Promise.resolve(existing)
  return new Promise(resolve => {
    authorNamePromptResolve = resolve
    authorNameInput.value = ''
    authorNameSubmit.disabled = true
    authorNameBackdrop.removeAttribute('hidden')
    authorNameInput.focus()
  })
}

function closeAuthorNamePrompt(result) {
  authorNameBackdrop.setAttribute('hidden', '')
  const resolve = authorNamePromptResolve
  authorNamePromptResolve = null
  if (resolve) resolve(result)
}

function initAuthorNamePrompt() {
  authorNameInput.addEventListener('input', () => {
    authorNameSubmit.disabled = authorNameInput.value.trim().length === 0
  })
  authorNameSubmit.addEventListener('click', () => {
    const name = authorNameInput.value.trim()
    if (!name) return
    setAuthorName(name)
    closeAuthorNamePrompt(name)
  })
  authorNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); authorNameSubmit.click() }
  })
  authorNameCancel.addEventListener('click', () => closeAuthorNamePrompt(null))
  authorNameBackdrop.addEventListener('click', (e) => {
    if (e.target === authorNameBackdrop) closeAuthorNamePrompt(null)
  })
  // Échap ferme la modal quel que soit le focus (capture : passe avant le
  // raccourci global du player qui déclencherait stopAll())
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !authorNameBackdrop.hasAttribute('hidden')) {
      e.stopPropagation()
      e.preventDefault()
      closeAuthorNamePrompt(null)
    }
  }, { capture: true })
}

const MARKER_EPS = 0.05  // 50 ms — tolérance de contigüité

function isMarkerInSelection(marker) {
  return markerSelectionIn !== null &&
    marker.start >= markerSelectionIn - MARKER_EPS &&
    marker.end   <= markerSelectionOut + MARKER_EPS
}

function nextMarkerId() { return 'mk_' + (++markerIdCounter) }

// Hauteur réelle de la barre de transport, ferrée en bas de la fenêtre.
// La tablature s'adosse dessus et player-main réserve la place des deux :
// on la mesure plutôt que de la coder en dur, la barre passant sur deux
// lignes ou plus selon la largeur de fenêtre.
function observeTransportHeight() {
  if (!drawerEl) return
  const publish = () => {
    const h = drawerEl.getBoundingClientRect().height
    document.documentElement.style.setProperty('--transport-height', Math.round(h) + 'px')
  }
  publish()
  if (typeof ResizeObserver === 'function') new ResizeObserver(publish).observe(drawerEl)
  window.addEventListener('resize', publish)
}

// ── Drawer (mobile bottom sheet) ──────────────────────────────────────────

function setDrawerOpen(open) {
  drawerOpen = open
  drawerEl.classList.toggle('drawer-closed', !open)
  handleEl.setAttribute('aria-expanded', String(open))
}

function initDrawer() {
  if (!isMobile) return
  let touchStartY = 0

  handleEl.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY
  }, { passive: true })

  handleEl.addEventListener('touchend', (e) => {
    e.preventDefault()
    const dy = e.changedTouches[0].clientY - touchStartY
    if      (dy >  40) setDrawerOpen(false)
    else if (dy < -40) setDrawerOpen(true)
    else               setDrawerOpen(!drawerOpen)
  }, { passive: false })

  // Keyboard/desktop fallback (handle visible only on mobile via CSS)
  handleEl.addEventListener('click', () => setDrawerOpen(!drawerOpen))
}

// 13.3–13.6 — Tablature state
let alphaTabApi    = null  // AlphaTabApi instance
let tabState       = 'strip'  // 'collapsed' | 'strip' | 'fullscreen'
// L'utilisateur a pris la main sur le scroll de la tablature : le défilement
// automatique est suspendu. À l'arrêt c'est sans conséquence (rien ne défile) ;
// en lecture le bouton « ⤓ défilement » permet de rendre la main, et toute
// nouvelle lecture repart en défilement automatique.
let tabAutoScroll = true
let tabSyncRafId   = null
let tabDragBeat    = null  // Beat object — start of drag selection
// Points de synchro natifs du fichier GP (MidiFileGenerator.generateSyncPoints).
// Chacun porte le couple (synthTick, syncTime) : position en ticks MIDI et
// instant correspondant dans l'audio. Sert aux conversions hors lecture
// (règle de mesures, bornes de boucle) ; pendant la lecture c'est AlphaTab
// lui-même qui convertit, via le mode EnabledExternalMedia.
let tabSyncPoints  = null  // BackingTrackSyncPoint[] triés par synthTick, ou null

// 35.1 — AlphaTab pilote la position musicale
let tabMaster        = false  // true dès qu'un score GP est chargé
// Mode « média externe » : nos instances WaveSurfer sont l'axe temps d'AlphaTab.
// C'est AlphaTab qui convertit temps audio ↔ position dans la partition, à
// partir des points de synchro du fichier. Faux en tab-only sans aucun audio,
// où le synthétiseur MIDI joue et porte sa propre horloge.
let tabExternal      = false
// Vrai pendant que le player déplace lui-même les waveforms : les ordres
// renvoyés par AlphaTab au média externe sont alors ignorés (anti-boucle).
let extSuppress      = false
// En mode synthétiseur, l'horloge n'avance qu'une fois la soundfont chargée.
// Tant que playerReady / playerPositionChanged n'ont rien émis, WaveSurfer
// reste la source de temps : sinon un synthé lent ou en échec fige tout.
let tabClockLive     = false
let tabScore         = null   // Score AlphaTab chargé
let scoreDurationSec = 0      // durée du score en secondes (axe temps audio)
// 35.5 — affichage du temps : 'time' (mm:ss) ou 'bbt' (mesure:temps)
const TIME_MODE_KEY  = 'groovotheque:time_mode'
let timeMode         = 'time'
let bbtTimelineEl    = null  // graduations de mesures (mode BBT)
// 35.6 — boucle lue en BBT dans loop.json, à convertir dès que le score est là
let pendingBbtLoop   = null
// true si une tablature va être chargée (fichier GP présent et desktop) : sans
// elle, une boucle enregistrée en mesure:temps n'est pas convertible.
let tabWillLoad      = false
// 35.3 — lignes de pistes MIDI : { track, muted, soloed, volume, visible, btnMute, btnSolo, btnShow }
let midiTracks       = []
// Tolérance de dérive avant de re-caler une instance WaveSurfer sur l'horloge
// AlphaTab. Trop bas → re-seek permanent (audio haché) ; trop haut → décalage
// audible. 80 ms est sous le seuil de perception pour un accompagnement.
const WS_DRIFT_TOL   = 0.08

// ── PanKnob ────────────────────────────────────────────────────────────────
// Custom SVG knob for stereo pan (-1 to +1).
// Arc from 7 o'clock (L, pan=-1) to 5 o'clock (R, pan=+1), center at 12h.
// Drag up → right (+), drag down → left (-). 200px drag = full range.
// Double-click resets to 0. Fires CustomEvent('change', {detail: value}) on wrap.
class PanKnob {
  constructor(container, color) {
    this.value = 0
    this.cx    = 12
    this.cy    = 12
    this.r     = 8
    this._p12  = { x: 12, y: 4 }  // pre-computed 12 o'clock (cx=12, cy-r=4)
    this.color = color || '#888'
    this._build(container)
    this._setupInteraction()
  }

  // Pan (-1..+1) → SVG point on the 8px-radius arc
  _panToPoint(pan) {
    // degrees clockwise from top: 7h=210°, 12h=360°(=0°), 5h=510°(=150°)
    const fromTop = ((pan + 1) / 2) * 300 + 210
    const rad = (fromTop - 90) * Math.PI / 180  // SVG: 0° = east, clockwise
    return {
      x: this.cx + this.r * Math.cos(rad),
      y: this.cy + this.r * Math.sin(rad),
    }
  }

  _build(container) {
    this.wrap = document.createElement('div')
    this.wrap.className = 'pan-knob-wrap'

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '24')
    svg.setAttribute('height', '24')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-label', 'Pan')
    svg.setAttribute('role', 'slider')
    svg.setAttribute('aria-valuemin', '-100')
    svg.setAttribute('aria-valuemax', '100')
    svg.setAttribute('aria-valuenow', '0')
    svg.style.cursor = 'ns-resize'
    this.svg = svg

    // Background track arc: 7h (8,18.93) → 5h (16,18.93), 300°, clockwise
    this.trackPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    this.trackPath.setAttribute('d', 'M 8,18.93 A 8,8 0 1,1 16,18.93')
    this.trackPath.setAttribute('stroke', '#555')
    this.trackPath.setAttribute('stroke-width', '2')
    this.trackPath.setAttribute('fill', 'none')
    this.trackPath.setAttribute('stroke-linecap', 'round')

    // Value arc: 12h → current position (dynamic)
    this.valuePath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    this.valuePath.setAttribute('stroke', this.color)
    this.valuePath.setAttribute('stroke-width', '2')
    this.valuePath.setAttribute('fill', 'none')
    this.valuePath.setAttribute('stroke-linecap', 'round')

    // L/C/R label centered inside the SVG
    this.labelEl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    this.labelEl.setAttribute('x', '12')
    this.labelEl.setAttribute('y', '13')
    this.labelEl.setAttribute('text-anchor', 'middle')
    this.labelEl.setAttribute('dominant-baseline', 'middle')
    this.labelEl.setAttribute('font-size', '7')
    this.labelEl.setAttribute('font-weight', '700')
    this.labelEl.setAttribute('fill', '#444')
    this.labelEl.setAttribute('pointer-events', 'none')
    this.labelEl.textContent = 'C'

    svg.append(this.trackPath, this.valuePath, this.labelEl)

    this.wrap.append(svg)
    container.appendChild(this.wrap)
    this._updateVisual()
  }

  _updateVisual() {
    const pan = this.value
    if (Math.abs(pan) < 0.005) {
      this.valuePath.removeAttribute('d')
    } else {
      const p0    = this._p12             // 12 o'clock (pre-computed)
      const p1    = this._panToPoint(pan)
      const sweep = pan > 0 ? 1 : 0     // clockwise for R
      // Arc spans |pan|*150° — always < 180°, so large-arc = 0
      this.valuePath.setAttribute('d',
        `M ${p0.x.toFixed(2)},${p0.y.toFixed(2)}` +
        ` A ${this.r},${this.r} 0 0,${sweep}` +
        ` ${p1.x.toFixed(2)},${p1.y.toFixed(2)}`
      )
    }

    this.svg.setAttribute('aria-valuenow', String(Math.round(pan * 100)))
    if      (pan < -0.05) this.labelEl.textContent = 'L'
    else if (pan >  0.05) this.labelEl.textContent = 'R'
    else                  this.labelEl.textContent = 'C'
  }

  _setupInteraction() {
    let startY = 0, startValue = 0

    const emit = () =>
      this.wrap.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true }))

    const onMove = (clientY) => {
      const delta = (startY - clientY) / 200  // 200px = full range
      this.setValue(Math.max(-1, Math.min(1, startValue + delta)))
      emit()
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    const onMouseMove = (e) => onMove(e.clientY)

    this.svg.addEventListener('mousedown', (e) => {
      e.preventDefault()
      startY = e.clientY; startValue = this.value
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    })

    this.svg.addEventListener('dblclick', (e) => {
      e.preventDefault()
      this.setValue(0)
      emit()
    })

    this.svg.addEventListener('touchstart', (e) => {
      e.preventDefault()
      startY = e.touches[0].clientY; startValue = this.value
    }, { passive: false })

    this.svg.addEventListener('touchmove', (e) => {
      e.preventDefault()
      onMove(e.touches[0].clientY)
    }, { passive: false })
  }

  setValue(v) {
    this.value = Math.max(-1, Math.min(1, v))
    this._updateVisual()
  }

  getValue() { return this.value }
}

// ── Audio helpers ──────────────────────────────────────────────────────────

function setPan(idx, value) {
  if (panNodes[idx]) panNodes[idx].pan.value = value
  panKnobs[idx]?.setValue(value)
}

// 6.3 — Peaks cache helpers
async function fetchPeaks(groove, filename) {
  try {
    const res = await fetch(`/api/peaks/${encodePath(groove)}/${encodeURIComponent(filename)}`)
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data.peaks) ? data.peaks : null
  } catch {
    return null
  }
}

// ── Title marquee ──────────────────────────────────────────────────────────
// Scrolls the groove title horizontally when it overflows, then resets.
// Uses a CSS variable --title-overflow for the exact pixel amount so the
// animation never scrolls too far or not far enough.

function setupTitleMarquee() {
  const span = document.createElement('span')
  span.className = 'title-scroll'
  span.textContent = titleEl.textContent
  titleEl.textContent = ''
  titleEl.appendChild(span)

  function update() {
    const overflow = span.scrollWidth - titleEl.clientWidth
    if (overflow > 4) {
      titleEl.style.setProperty('--title-overflow', `${-overflow}px`)
      span.classList.add('title-scroll--active')
    } else {
      titleEl.style.removeProperty('--title-overflow')
      span.classList.remove('title-scroll--active')
    }
  }

  requestAnimationFrame(() => requestAnimationFrame(update))

  let resizeTimer
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(update, 150)
  }, { passive: true })
}

function postPeaks(groove, filename, peaks) {
  fetch(`/api/peaks/${encodePath(groove)}/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peaks }),
  }).catch(() => { /* best effort */ })
}

function slugToName(slug) {
  const leaf = slug.includes('/') ? slug.split('/').pop() : slug
  return leaf.replace(/_/g, ' ')
}

// mm:ss.ms with 3 decimal digits — robust against floating-point rounding
function formatTimecode(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const totalMs = Math.round(sec * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60)
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
}

// mm:ss.cs with 2 decimal digits (centiseconds) for IN/OUT fields
function formatLoopTime(sec) {
  if (sec === null || !isFinite(sec)) return '—'
  const totalCs = Math.round(sec * 100)
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60)
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

// Parse mm:ss.cs → seconds, returns null if format invalid
function parseLoopTime(str) {
  const match = str.trim().match(/^(\d+):(\d{1,2})\.(\d{1,2})$/)
  if (!match) return null
  const m = parseInt(match[1], 10)
  const s = parseInt(match[2], 10)
  const cs = parseInt(match[3].padEnd(2, '0'), 10)
  return m * 60 + s + cs / 100
}

function applyTempo(pct) {
  currentTempo = pct
  const ratio = pct / 100
  wavesurfers.forEach(ws => ws.setPlaybackRate(ratio, true))
  // AlphaTab suit le même ratio. Le changement de vitesse déclenche chez lui
  // un recalage de position : on l'inhibe pour ne pas déplacer les waveforms.
  if (alphaTabApi) {
    extSuppress = true
    try { alphaTabApi.playbackSpeed = ratio } catch { /* player pas encore prêt */ }
    finally { extSuppress = false }
  }
  tempoSliderEl.value = String(pct)
  tempoValueEl.textContent = `${pct}%`
  tempoValueEl.classList.toggle('tempo-value--active', pct !== 100)
  if (pct !== 100) {
    tempoBadgeEl.textContent = `×${ratio.toFixed(2)}`
    tempoBadgeEl.removeAttribute('hidden')
  } else {
    tempoBadgeEl.setAttribute('hidden', '')
  }
  tempoPresets.forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.value) === pct)
  })
}

// Volume is controlled via GainNodes when Web Audio routing succeeded, or via
// ws.setVolume() as fallback. Chain: MediaElementSource → GainNode → StereoPannerNode → dest.
// 35.3 — Le solo porte sur l'ensemble des lignes du player, MIDI comprises :
// soloer une piste MIDI doit couper les pistes audio, et inversement.
function anySoloActive() {
  // En média externe les pistes MIDI n'ont pas de son : leur solo ne doit pas
  // couper les pistes audio, il n'isolerait rien.
  return trackStates.some(s => s.soloed) || (!tabExternal && midiTracks.some(t => t.soloed))
}

// Applique l'état mute/solo/volume aux pistes audio ET aux pistes MIDI.
function applyMix() {
  applyVolumes()
  applyMidiTracksAudio()
}

function applyVolumes() {
  const anySolo = anySoloActive()
  gainNodes.forEach((gainNode, i) => {
    const s = trackStates[i]
    const vol = anySolo ? (s.soloed ? s.volume : 0) : (s.muted ? 0 : s.volume)
    if (webAudioRouted[i]) {
      gainNode.gain.value = vol
    } else {
      wavesurfers[i]?.setVolume(vol)
    }
  })
}

// L'horloge du synthétiseur MIDI ne fait autorité qu'en tab-only : elle avance
// au tempo écrit, sans rapport avec la durée réelle des enregistrements. En
// présence d'audio c'est le média qui porte le temps et AlphaTab le suit.
function tabClockDrives() {
  return tabMaster && !!alphaTabApi && !tabExternal && (tabClockLive || wavesurfers.length === 0)
}

// Sortie « média externe » d'AlphaTab, une fois le mode actif et le player prêt.
function externalOutput() {
  const out = alphaTabApi?.player?.output
  return (out && typeof out.updatePosition === 'function') ? out : null
}

// Pousse la position audio courante dans AlphaTab : c'est lui qui en déduit la
// position dans la partition, via les points de synchro du fichier.
function pushExternalPosition(sec) {
  if (!tabExternal) return
  const out = externalOutput()
  if (!out) return
  const t = (sec !== undefined) ? sec : wavesurfers[0]?.getCurrentTime()
  if (t === undefined) return
  out.updatePosition(t * 1000)
}

// Média externe piloté par AlphaTab : nos instances WaveSurfer.
// Les temps échangés sont en millisecondes sur l'axe du fichier audio, comme
// les `syncTime` des points de synchro. `extSuppress` évite le retour de
// boucle quand c'est le player qui vient de déplacer les waveforms.
const externalMediaHandler = {
  get backingTrackDuration() { return (wavesurfers[0]?.getDuration() ?? 0) * 1000 },
  get playbackRate() { return currentTempo / 100 },
  set playbackRate(value) {
    if (!(value > 0)) return
    wavesurfers.forEach(ws => ws.setPlaybackRate(value, true))
  },
  // Le mixage se fait piste par piste (mute/solo/volume) : rien à faire ici.
  get masterVolume() { return 1 },
  set masterVolume(_value) { /* volume global non utilisé */ },
  seekTo(ms) {
    if (extSuppress) return
    const sec = ms / 1000
    wavesurfers.forEach(ws => ws.setTime(sec))
  },
  play() {
    if (extSuppress) return
    wavesurfers.forEach(ws => { ws.play().catch(() => { /* geste utilisateur requis */ }) })
  },
  pause() {
    if (extSuppress) return
    wavesurfers.forEach(ws => ws.pause())
  },
}

// Branche le média externe dès que le player AlphaTab correspondant existe.
function attachExternalMedia() {
  const out = externalOutput()
  if (!out) return false
  out.handler = externalMediaHandler
  pushExternalPosition(wavesurfers[0]?.getCurrentTime() ?? 0)
  return true
}

// L'audio peut être plus long que le score (mixte) : passé la fin du score, le
// synthé n'émet plus rien et c'est la piste audio qui pilote la fin.
function audioOutlastsScore() {
  return wavesurfers.length > 0 && totalDuration - scoreDurationSec > 0.25
}

// 35.1 — Position courante en secondes sur l'axe temps « audio ».
// AlphaTab est la source de vérité dès qu'un score est chargé et que son
// horloge tourne.
function currentTimeSec() {
  if (tabClockDrives()) return tickToAudioSec(alphaTabApi.tickPosition)
  return wavesurfers[0]?.getCurrentTime() ?? 0
}

// Affichage timecode + seek bar, quelle que soit l'horloge maître.
function updateTimeDisplay(t) {
  timecodeEl.textContent = formatPosition(t)
  if (totalDuration > 0) {
    const ratio = Math.max(0, Math.min(1, t / totalDuration))
    seekFillEl.style.width = `${ratio * 100}%`
    seekBarEl.setAttribute('aria-valuenow', Math.round(ratio * 100))
  }
}

// Rebond de boucle : quand la tête de lecture atteint OUT, saut vers IN.
// loopJumping évite le double déclenchement avant que le seek ait pris effet.
function checkLoopRebound(t) {
  if (loopEnabled && activeLoopOut !== null && t >= activeLoopOut && !loopJumping && isPlaying) {
    loopJumping = true
    seekAllTo(activeLoopIn ?? 0)
    setTimeout(() => { loopJumping = false }, 50)
  }
}

async function playAll() {
  if (isPlaying) return
  zoomUserScrolled = false  // 18.5 — Play relance le suivi de la tête de lecture
  // Resume Web Audio graph if suspended (requires prior user gesture — satisfied by this click)
  if (sharedAudioCtx.state === 'suspended') await sharedAudioCtx.resume()
  if (loopEnabled && activeLoopIn !== null && activeLoopOut !== null) {
    const cur = currentTimeSec()
    if (cur < activeLoopIn || cur >= activeLoopOut) seekAllTo(activeLoopIn)
  }
  isPlaying = true
  setTabAutoScroll(true)   // une nouvelle lecture recale toujours la tablature
  btnPlay.textContent = '⏸'
  if (tabMaster && alphaTabApi) alphaTabApi.play()
  try {
    await Promise.all(wavesurfers.map(ws => ws.play()))
  } catch (err) {
    console.warn('play failed:', err)
    if (!tabMaster && !wavesurfers.some(ws => ws.isPlaying())) {
      isPlaying = false
      btnPlay.textContent = '▶'
    }
  }
}

function pauseAll() {
  if (!isPlaying) return
  if (tabMaster && alphaTabApi) alphaTabApi.pause()
  wavesurfers.forEach(ws => ws.pause())
  isPlaying = false
  btnPlay.textContent = '▶'
  updateTabScrollButton()
}

function stopAll() {
  if (tabMaster && alphaTabApi) alphaTabApi.stop()
  wavesurfers.forEach(ws => ws.pause())
  seekAllTo(0)
  isPlaying = false
  btnPlay.textContent = '▶'
  updateTabScrollButton()
  updateTimeDisplay(0)
  // 18.4 — setTime() direct : il faut réancrer la vue nous-mêmes, sinon la tête
  // repart à 0 hors écran dès que l'utilisateur avait défilé à la main.
  ensurePlayheadVisible(0)
}

// Called when any track fires 'finish'. Stops and rewinds all tracks, or loops.
// isPlaying=false is set first so subsequent finish events from other tracks
// (which end at nearly the same time) are blocked by the guard.
function onFinish() {
  if (!isPlaying) return
  isPlaying = false
  updateTabScrollButton()

  if (loopEnabled && activeLoopIn !== null) {
    seekAllTo(activeLoopIn)
    // Defer playAll() so all other tracks' finish events drain and are blocked
    // by isPlaying=false before we start playing again.
    setTimeout(playAll, 0)
    return
  }

  btnPlay.textContent = '▶'
  if (tabMaster && alphaTabApi) alphaTabApi.stop()
  wavesurfers.forEach(w => { w.pause(); w.setTime(0) })
  updateTimeDisplay(0)
}

function seekAllTo(time) {
  extSuppress = true
  try { wavesurfers.forEach(ws => ws.setTime(time)) } finally { extSuppress = false }
  if (tabExternal) {
    pushExternalPosition(time)
  } else if (alphaTabApi && (tabMaster || tabState !== 'collapsed')) {
    alphaTabApi.tickPosition = audioSecToTick(time)
  }
  if (tabMaster) updateTimeDisplay(time)
  ensurePlayheadVisible(time)  // 18.4 — la tête reste visible en mode zoomé
}

// Shared seek-with-resume logic: pauses if playing, seeks all tracks, then
// resumes. seekGen prevents stale async play() callbacks from updating state
// after a subsequent seek has already taken over (rapid scrubbing scenario).
async function performSeek(time) {
  const myGen = ++seekGen
  const wasPlaying = isPlaying
  if (wasPlaying) {
    isPlaying = false
    if (tabMaster && alphaTabApi) alphaTabApi.pause()
    wavesurfers.forEach(ws => ws.pause())
  }
  seekAllTo(time)
  if (wasPlaying) {
    if (tabMaster && alphaTabApi) alphaTabApi.play()
    try {
      await Promise.all(wavesurfers.map(ws => ws.play()))
      if (myGen === seekGen) { isPlaying = true; btnPlay.textContent = '⏸' }
    } catch { /* ignored */ }
  }
}

function nudge(delta) {
  if (!wavesurfers.length && !tabMaster) return
  const current = currentTimeSec()
  const next = Math.max(0, Math.min(totalDuration, current + delta))
  performSeek(next)
}

function updateLoopFields() {
  const hasRegion = activeLoopIn !== null && activeLoopOut !== null
  loopInEl.value = hasRegion ? formatLoopPosition(activeLoopIn) : '—'
  loopOutEl.value = hasRegion ? formatLoopPosition(activeLoopOut) : '—'
  loopInEl.disabled = !hasRegion
  loopOutEl.disabled = !hasRegion
  btnLoopClear.disabled = !hasRegion
}

// 35.6 — IN/OUT affichés en mesure:temps quand le mode BBT est actif
function formatLoopPosition(sec) {
  return bbtEnabled() ? formatBBT(sec) : formatLoopTime(sec)
}

function parseLoopPosition(str) {
  if (!bbtEnabled()) return parseLoopTime(str)
  const m = str.trim().match(/^(\d+):(\d+)$/)
  if (!m) return parseLoopTime(str)
  return barBeatToSec(parseInt(m[1], 10) - 1, parseInt(m[2], 10) - 1)
}

// Arrondit une position au temps (beat) le plus proche du score.
function snapSecToBeat(sec) {
  const bars = tabScore?.masterBars
  if (!bars || bars.length === 0) return sec
  const tick = audioSecToTick(sec)
  const bb   = tickToBarBeat(tick)
  if (!bb) return sec
  const r = barTickRange(bb.bar)
  if (!r) return sec
  const num = r.masterBar.timeSignatureNumerator || 4
  const ticksPerBeat = r.span / num
  if (!(ticksPerBeat > 0)) return sec
  let bar = bb.bar
  let beat = bb.beat
  if ((tick - r.start) / ticksPerBeat - beat > 0.5) {
    beat += 1
    if (beat >= num) { beat = 0; bar += 1 }
  }
  if (bar >= bars.length) return tickToAudioSec(scoreTotalTicks(tabScore))
  return barBeatToSec(bar, beat)
}

function clearLoop() {
  trackRegions.forEach(rp => rp.clearRegions())
  activeLoopIn = null
  activeLoopOut = null
  updateLoopFields()
  if (loopEnabled) setLoopEnabled(false)
}

// Creates/replaces regions on ALL tracks with the same IN/OUT.
// Attaches update-end listeners to each newly created region.
// isSyncingRegion prevents re-entrancy: WaveSurfer v7 fires region-created
// synchronously inside addRegion(), so this guard is essential.
// opts.snap : aligne les bornes sur le temps le plus proche (drag en mode BBT)
function syncRegionToAll(start, end, opts = {}) {
  if (isSyncingRegion) return
  isSyncingRegion = true

  if (opts.snap && bbtEnabled()) {
    const snappedStart = snapSecToBeat(start)
    const snappedEnd   = snapSecToBeat(end)
    if (snappedEnd > snappedStart) {
      start = snappedStart
      end   = snappedEnd
    }
  }

  activeLoopIn = start
  activeLoopOut = end
  updateLoopFields()

  trackRegions.forEach(rp => {
    rp.clearRegions()
    const region = rp.addRegion({
      start,
      end,
      color: 'rgba(255,255,255,0.2)',
      drag: true,
      resize: true,
    })
    region.on('update-end', () => syncRegionToAll(region.start, region.end, { snap: true }))
  })

  isSyncingRegion = false
}

function setLoopEnabled(val) {
  loopEnabled = val
  btnLoop.classList.toggle('active', loopEnabled)
  btnLoop.setAttribute('aria-pressed', String(loopEnabled))
}

// ── Epic 21 — Rangée timeline / marqueurs détachée ────────────────────────
// Insère une .timeline-row avant toutes les .track-row. Elle contient le
// TimelinePlugin et la bande de marqueurs, alignés avec les zones waveform
// via une .timeline-sidebar placeholder de la même largeur que .track-sidebar.
function buildTimelineRow() {
  const row = document.createElement('div')
  row.className = 'timeline-row'

  const sidebar = document.createElement('div')
  sidebar.className = 'timeline-sidebar'

  timelineVpEl = document.createElement('div')
  timelineVpEl.className = 'timeline-wave-vp'

  const waveCol = document.createElement('div')
  waveCol.className = 'timeline-wave-col'
  timelineWaveColEl = waveCol

  timelineExtEl = document.createElement('div')
  timelineExtEl.className = 'track-timeline-ext'
  // 18.6 — la règle temporelle repositionne la tête ; la conversion px → s
  // passe par laneXToTime() qui mesure le contenu zoomé et défilé.
  timelineExtEl.addEventListener('click', (e) => {
    if (!totalDuration) return
    zoomUserScrolled = false  // 18.5 — repositionner la tête rend la main au suivi
    performSeek(laneXToTime(e.clientX))
  })

  // 35.5 — graduations de mesures, affichées à la place du TimelinePlugin
  // quand le mode BBT est actif
  bbtTimelineEl = document.createElement('div')
  bbtTimelineEl.className = 'bbt-timeline'
  bbtTimelineEl.hidden = true

  markerLaneEl = document.createElement('div')
  markerLaneEl.className = 'marker-lane'
  markerLaneEl.setAttribute('aria-label', 'Bande de marqueurs')

  commentMarkersLaneEl = document.createElement('div')
  commentMarkersLaneEl.className = 'comment-markers-lane'

  waveCol.append(timelineExtEl, bbtTimelineEl, markerLaneEl, commentMarkersLaneEl)
  timelineVpEl.appendChild(waveCol)
  row.append(sidebar, timelineVpEl)
  tracksContainer.appendChild(row)
}

// opts.blob        : Blob audio à charger via loadBlob() au lieu de track.url
// opts.insertBefore : ligne devant laquelle insérer (ordre MIDI → backing → audio)
// opts.isBacking    : marque la ligne comme backing track embarqué
function buildTrackRow(track, idx, cachedPeaks = null, opts = {}) {
  const color         = TRACK_COLORS[(opts.colorIndex ?? idx) % TRACK_COLORS.length]
  const waveColor     = color + '55'  // dim = unplayed
  const progressColor = color         // bright = played

  const row = document.createElement('div')
  row.className = opts.isBacking ? 'track-row track-row--backing' : 'track-row'

  // ── Sidebar ──────────────────────────────────
  const sidebar = document.createElement('div')
  sidebar.className = 'track-sidebar'

  const dot = document.createElement('span')
  dot.className = 'track-color-dot'
  dot.style.background = color

  const nameEl = document.createElement('span')
  nameEl.className = 'track-name'
  nameEl.textContent = track.displayName
  nameEl.title = track.displayName

  const sidebarTop = document.createElement('div')
  sidebarTop.className = 'track-sidebar-top'
  sidebarTop.append(dot, nameEl)

  // Le backing track est embarqué dans le fichier GP : pas de fichier à
  // télécharger, donc pas de lien de téléchargement.
  if (track.url) {
    const dlLink = document.createElement('a')
    dlLink.href = track.url
    dlLink.download = track.filename
    dlLink.className = 'btn-track-download'
    dlLink.title = `Télécharger ${track.filename}`
    dlLink.textContent = '↓'
    sidebarTop.append(dlLink)
  }

  const btnMute = document.createElement('button')
  btnMute.className = 'track-btn btn-mute'
  btnMute.textContent = 'M'
  btnMute.title = 'Mute'
  btnMute.setAttribute('aria-pressed', 'false')

  const btnSolo = document.createElement('button')
  btnSolo.className = 'track-btn btn-solo'
  btnSolo.textContent = 'S'
  btnSolo.title = 'Solo'
  btnSolo.setAttribute('aria-pressed', 'false')

  const volSlider = document.createElement('input')
  volSlider.type = 'range'
  volSlider.className = 'track-volume'
  volSlider.min = '0'
  volSlider.max = '100'
  volSlider.value = '100'
  volSlider.setAttribute('aria-label', 'Volume')

  const sidebarCtrl = document.createElement('div')
  sidebarCtrl.className = 'track-sidebar-ctrl'
  sidebarCtrl.append(btnMute, btnSolo)

  // Pan knob between Solo and volume fader
  const panKnob = new PanKnob(sidebarCtrl, color)
  panKnobs.push(panKnob)

  sidebarCtrl.append(volSlider)

  sidebar.append(sidebarTop, sidebarCtrl)

  // ── Waveform container ────────────────────────
  // Epic 18 — .track-wave-vp est le viewport (largeur proportionnelle à la
  // durée de la piste) ; .track-wave est le contenu, élargi par le zoom.
  const waveVp = document.createElement('div')
  waveVp.className = 'track-wave-vp'

  const waveEl = document.createElement('div')
  waveEl.className = 'track-wave'
  waveVp.appendChild(waveEl)

  row.append(sidebar, waveVp)
  if (opts.insertBefore) tracksContainer.insertBefore(row, opts.insertBefore)
  else                   tracksContainer.appendChild(row)
  waveEls.push(waveEl)
  waveVpEls.push(waveVp)

  // ── Plugins ───────────────────────────────────
  const regionsPlugin = RegionsPlugin.create()
  trackRegions.push(regionsPlugin)

  const plugins = [
    regionsPlugin,
    HoverPlugin.create({
      lineColor: '#ffffff55',
      lineWidth: 1,
      labelBackground: '#1a1a1a',
      labelColor: '#999',
      labelSize: '10px',
    }),
  ]

  if (idx === 0) {
    timelinePluginRef = TimelinePlugin.create({
      height: 18,
      timeInterval: 5,
      primaryLabelInterval: 30,
      secondaryLabelInterval: 10,
      style: { color: '#555', fontSize: '10px' },
      container: timelineExtEl,
    })
    plugins.push(timelinePluginRef)
  }

  // ── WaveSurfer instance ───────────────────────
  const wsOpts = {
    container: waveEl,
    waveColor,
    progressColor,
    height: isMobile ? 48 : 64,
    barWidth: isMobile ? 1 : 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
    interact: true,
    plugins,
  }
  if (track.url) wsOpts.url = track.url
  if (cachedPeaks?.length > 0) wsOpts.peaks = cachedPeaks
  const ws = WaveSurfer.create(wsOpts)
  // Backing track : les octets viennent du fichier GP, pas d'une URL serveur.
  // wsOpts.peaks n'est pris en compte que par le chargement d'URL : les peaks
  // en cache doivent être passés explicitement à loadBlob().
  if (opts.blob) {
    ws.loadBlob(opts.blob, cachedPeaks?.length > 0 ? cachedPeaks : undefined)
      .catch(err => {
        console.warn('[backing] chargement impossible:', err)
        // Format audio non lu par le navigateur : le dire sur la ligne plutôt
        // que de laisser une piste muette et vide.
        waveEl.classList.add('track-wave--error')
        waveEl.textContent = 'Backing track illisible par le navigateur'
      })
  }

  // ── Web Audio routing ─────────────────────────
  // WaveSurfer v7 plays through an HTML5 audio element. Routing it through the
  // Web Audio graph gives us StereoPanner support without touching WaveSurfer
  // internals. Once createMediaElementSource() is called, audio flows exclusively
  // through our graph: MediaElementSource → GainNode → StereoPannerNode → dest.
  const gainNode = sharedAudioCtx.createGain()
  const panNode  = sharedAudioCtx.createStereoPanner()
  gainNode.connect(panNode)
  panNode.connect(sharedAudioCtx.destination)
  gainNodes.push(gainNode)
  panNodes.push(panNode)

  let routed = false
  try {
    const mediaEl = ws.getMediaElement()
    if (!(mediaEl instanceof HTMLMediaElement))
      throw new Error(`getMediaElement() returned unexpected type: ${typeof mediaEl}`)
    sharedAudioCtx.createMediaElementSource(mediaEl).connect(gainNode)
    routed = true
  } catch (err) {
    // applyVolumes() will fall back to ws.setVolume() for this track.
    console.warn('[pan] MediaElement routing unavailable, using WaveSurfer volume:', err)
  }
  webAudioRouted.push(routed)

  const state = { volume: 1, muted: false, soloed: false }
  trackStates.push(state)
  trackSourceUrls.push(track.url ?? (opts.blob ? URL.createObjectURL(opts.blob) : null))
  volSliders.push(volSlider)
  wavesurfers.push(ws)
  ws.setPlaybackRate(currentTempo / 100, true)

  // ── Drag-to-create loop regions ───────────────
  // Creating a region on any track syncs to all other tracks.
  regionsPlugin.enableDragSelection({ color: 'rgba(255,255,255,0.2)' })
  regionsPlugin.on('region-created', (region) => {
    syncRegionToAll(region.start, region.end, { snap: true })
  })

  // ── Seek sync ─────────────────────────────────
  // The 'interaction' event is handled separately from performSeek() because
  // WaveSurfer has already seeked the interacting track internally — only
  // siblings need to be explicitly synced.
  ws.on('interaction', async (newTime) => {
    const myGen = ++seekGen
    const wasPlaying = isPlaying
    if (wasPlaying) { isPlaying = false; wavesurfers.forEach(w => w.pause()) }
    wavesurfers.forEach((w, j) => { if (j !== idx) w.setTime(newTime) })
    if (tabExternal) {
      pushExternalPosition(newTime)
    } else if (alphaTabApi && (tabMaster || tabState !== 'collapsed')) {
      alphaTabApi.tickPosition = audioSecToTick(newTime)
    }
    if (tabMaster) updateTimeDisplay(newTime)
    // 18.5 — repositionner la tête à la main rend la main à l'auto-défilement.
    // Pas de recentrage ici : l'endroit cliqué est déjà sous les yeux.
    zoomUserScrolled = false
    if (wasPlaying) {
      if (tabMaster && alphaTabApi) alphaTabApi.play()
      try {
        await Promise.all(wavesurfers.map(w => w.play()))
        if (myGen === seekGen) { isPlaying = true; btnPlay.textContent = '⏸' }
      } catch { /* ignored */ }
    }
  })

  // ── Load bar + peaks save + timecode (track 0) ─
  ws.on('ready', () => {
    markSegmentLoaded(idx, TRACK_COLORS[idx % TRACK_COLORS.length])
    if (!cachedPeaks || cachedPeaks.length === 0) {
      // Peaks were just computed from audio — persist them for future loads
      postPeaks(grooveSlug, track.filename, ws.exportPeaks())
    }
    if (idx === 0) {
      totalDuration = ws.getDuration()
      updateDurationDisplay()
    }
    trackDurations[idx] = ws.getDuration()
    if (trackDurations.filter(d => d > 0).length === wavesurfers.length) {
      adjustTrackWidths()
      if (pendingLoop) {
        syncRegionToAll(pendingLoop.in, pendingLoop.out)
        pendingLoop = null
      } else if (activeLoopIn !== null && activeLoopOut !== null) {
        syncRegionToAll(activeLoopIn, activeLoopOut)
      }
    }
  })

  ws.on('error', () => {
    markSegmentLoaded(idx, '#c44')
  })

  // ── Timecode + seek bar + duration + loop from first track ─
  if (idx === 0) {

    ws.on('timeupdate', (t) => {
      // 35.1 — quand l'horloge AlphaTab tourne, c'est playerPositionChanged qui
      // pilote l'affichage et le rebond de boucle. WaveSurfer reprend la main
      // tant que le synthé n'a rien émis, et au-delà de la fin du score.
      if (tabClockDrives() && t < scoreDurationSec - 0.05) return
      updateTimeDisplay(t)
      // 18.5 — en mode zoomé, la vue suit la tête pendant la lecture, sauf si
      // l'utilisateur a repris la main sur le défilement.
      if (isPlaying && !zoomUserScrolled) zoomAutoScroll(t)
      checkLoopRebound(t)
    })
  }

  ws.on('finish', () => {
    // 35.1 — AlphaTab master : la fin est signalée par playerFinished, sauf si
    // l'horloge du synthé ne tourne pas ou si l'audio dépasse le score.
    if (tabClockDrives() && !audioOutlastsScore()) return
    // Ignore finish from tracks shorter than the longest track — a short track
    // (e.g. metronome) reaching its end must not stop the whole playback.
    const maxDur = Math.max(...trackDurations.filter(d => d > 0))
    if (maxDur > 0 && ws.getDuration() < maxDur - 0.1) return
    onFinish()
  })

  // ── Per-track controls ────────────────────────
  btnMute.addEventListener('click', () => {
    state.muted = !state.muted
    btnMute.classList.toggle('active', state.muted)
    btnMute.setAttribute('aria-pressed', String(state.muted))
    applyMix()
  })

  btnSolo.addEventListener('click', () => {
    state.soloed = !state.soloed
    btnSolo.classList.toggle('active', state.soloed)
    btnSolo.setAttribute('aria-pressed', String(state.soloed))
    applyMix()
  })

  volSlider.addEventListener('input', () => {
    state.volume = Number(volSlider.value) / 100
    applyVolumes()
  })

  // Pan knob → StereoPannerNode
  panKnob.wrap.addEventListener('change', (e) => {
    setPan(idx, e.detail)
  })
}

// ── Proportional track widths ──────────────────────────────────────────────

function adjustTrackWidths() {
  // 35.4 — la durée du score dépend de l'axe temps audio (sync points), donc de
  // la durée des waveforms : elle doit être recalculée une fois celles-ci prêtes
  // (le backing track embarqué arrive après scoreLoaded).
  if (tabScore) scoreDurationSec = tickToAudioSec(scoreTotalTicks(tabScore))

  const durs = trackDurations.filter(d => d > 0)
  // 35.2 — en tab-only il n'y a aucune waveform : la durée vient du score.
  let maxDur = durs.length > 0 ? Math.max(...durs) : 0
  if (tabMaster && scoreDurationSec > maxDur) maxDur = scoreDurationSec
  if (!(maxDur > 0)) return

  // Track 0 may be shorter than others (e.g. a metronome). Always sync
  // totalDuration and the timeline to the actual longest track.
  totalDuration = maxDur
  updateDurationDisplay()
  if (timelinePluginRef) {
    timelinePluginRef.options.duration = maxDur
    wavesurfers[0]?.emit('redraw')
  }

  // Epic 18 — la largeur proportionnelle s'applique au viewport ; le contenu
  // (.track-wave) en dérive via applyZoomWidths().
  waveVpEls.forEach((el, i) => {
    setWaveWidth(el, (trackDurations[i] ?? maxDur) / maxDur)
  })

  // 35.3 — les aires MIDI couvrent la durée du score, pas celle du groove :
  // sans ce calage elles resteraient pleine largeur en mode mixte et ne
  // s'aligneraient plus avec la timeline BBT ni avec les pistes audio.
  if (scoreDurationSec > 0) {
    midiTracks.forEach(t => setWaveWidth(t.waveEl, scoreDurationSec / maxDur))
  }

  renderBbtTimeline()
  applyZoomWidths()  // 18.1 — largeur effective = largeur viewport × zoomLevel

  renderMarkers()
  renderCommentMarkers()
  animateSeenComments()
  tryOpenDeepLinkComment()  // 37.4 — pistes prêtes, commentaires peut-être aussi
}

// Largeur d'une aire de piste proportionnelle à la durée totale du groove.
function setWaveWidth(el, ratio) {
  if (!el) return
  if (!(ratio < 1)) {
    // Piste la plus longue (ou durée inconnue) : largeur gérée par le CSS.
    el.style.flex = ''
    el.style.width = ''
    return
  }
  el.style.flex = 'none'
  // Measure the actual available width at runtime so the calc remains
  // correct on all screen sizes (desktop sidebar = 176px fixed, but on
  // tablet/mobile the sidebar becomes a full-width strip and must not be
  // subtracted).  getBoundingClientRect() reflects the live CSS geometry
  // after media-query reflows.
  const row     = el.parentElement
  const sidebar = row?.querySelector('.track-sidebar')
  if (row && sidebar) {
    // En layout colonne (tablet/mobile), la sidebar est empilée au-dessus
    // de la waveform : sidebarW ≈ rowW donc availW ≈ 0. Laisser le CSS
    // (flex: 1 / width: 100%) gérer la largeur dans ce cas.
    const rowStyle = window.getComputedStyle(row)
    if (rowStyle.flexDirection === 'column') {
      el.style.width = ''
      return
    }
    const rowW     = row.getBoundingClientRect().width
    const sidebarW = sidebar.getBoundingClientRect().width
    const availW   = rowW - sidebarW
    if (availW > 0) {
      el.style.width = `${(ratio * availW).toFixed(2)}px`
    } else {
      // DOM masqué ou onglet inactif : getBoundingClientRect() peut
      // retourner 0. Fallback sur le calc CSS desktop.
      el.style.width = `calc(${ratio.toFixed(6)} * (100% - 176px))`
    }
  } else {
    // Fallback: CSS calc with desktop constant
    el.style.width = `calc(${ratio.toFixed(6)} * (100% - 176px))`
  }
}

// ── Epic 35 — Pistes MIDI (AlphaTab) ──────────────────────────────────────
// Une ligne par piste du score GP, insérée au-dessus des pistes audio.
// Sidebar identique aux pistes audio (nom, mute/solo/volume) + bouton
// « afficher dans la tab » qui est le seul signe distinctif d'une piste MIDI.
// Aucune instance WaveSurfer : la zone waveform est une aire vide colorée (v1).

// Première ligne devant laquelle insérer les pistes MIDI (= première piste
// audio ou backing), ou null pour ajouter à la fin du conteneur.
function firstAudioRowEl() {
  return tracksContainer.querySelector('.track-row:not(.track-row--midi)')
}

// Le solo est résolu ici pour toutes les pistes MIDI (et non délégué à
// changeTrackSolo) afin qu'un solo posé sur une piste audio les coupe aussi.
function applyMidiTracksAudio() {
  if (!alphaTabApi) return
  const anySolo = anySoloActive()
  midiTracks.forEach(t => {
    const muted = anySolo ? !t.soloed : t.muted
    try {
      alphaTabApi.changeTrackSolo([t.track], false)
      alphaTabApi.changeTrackMute([t.track], muted)
      alphaTabApi.changeTrackVolume([t.track], t.volume)
    } catch (err) {
      console.warn('[tab] contrôle de piste MIDI indisponible:', err)
    }
  })
}

// Sélection des portées rendues dans le drawer AlphaTab.
function applyTabTrackSelection() {
  if (!alphaTabApi || !tabScore) return
  const selected = midiTracks.filter(t => t.visible).map(t => t.track)
  alphaTabApi.renderTracks(selected.length > 0 ? selected : [tabScore.tracks[0]])
}

// Source unique de vérité partagée par le bouton « afficher dans la tab »
// de la sidebar et les cases à cocher du header du drawer.
function setTabTrackVisible(idx, visible) {
  const t = midiTracks[idx]
  if (!t) return
  t.visible = visible
  t.btnShow.classList.toggle('active', visible)
  t.btnShow.setAttribute('aria-pressed', String(visible))
  const cb = tabTrackListEl?.querySelectorAll('input[type=checkbox]')[idx]
  if (cb && cb.checked !== visible) cb.checked = visible
  applyTabTrackSelection()
}

function buildMidiTrackRow(track, idx, color) {
  const row = document.createElement('div')
  row.className = 'track-row track-row--midi'

  const sidebar = document.createElement('div')
  sidebar.className = 'track-sidebar'

  const dot = document.createElement('span')
  dot.className = 'track-color-dot'
  dot.style.background = color

  const nameEl = document.createElement('span')
  nameEl.className = 'track-name'
  const label = track.name || `Piste ${idx + 1}`
  nameEl.textContent = label
  nameEl.title = label

  const btnShow = document.createElement('button')
  btnShow.className = 'track-btn btn-tab-show active'
  btnShow.textContent = '♪'
  btnShow.title = 'Afficher dans la tablature'
  btnShow.setAttribute('aria-pressed', 'true')

  const sidebarTop = document.createElement('div')
  sidebarTop.className = 'track-sidebar-top'
  sidebarTop.append(dot, nameEl, btnShow)

  const btnMute = document.createElement('button')
  btnMute.className = 'track-btn btn-mute'
  btnMute.textContent = 'M'
  btnMute.title = 'Mute'
  btnMute.setAttribute('aria-pressed', 'false')

  const btnSolo = document.createElement('button')
  btnSolo.className = 'track-btn btn-solo'
  btnSolo.textContent = 'S'
  btnSolo.title = 'Solo'
  btnSolo.setAttribute('aria-pressed', 'false')

  const volSlider = document.createElement('input')
  volSlider.type = 'range'
  volSlider.className = 'track-volume'
  volSlider.min = '0'
  volSlider.max = '100'
  volSlider.value = '100'
  volSlider.setAttribute('aria-label', 'Volume')

  const sidebarCtrl = document.createElement('div')
  sidebarCtrl.className = 'track-sidebar-ctrl'
  sidebarCtrl.append(btnMute, btnSolo, volSlider)
  sidebar.append(sidebarTop, sidebarCtrl)

  // Le son des pistes MIDI vient du synthétiseur d'AlphaTab, qui ne tourne
  // qu'en tab-only. Dès qu'il y a de l'audio, la tablature suit l'enregistrement
  // et rien n'est synthétisé : mute/solo/volume n'auraient aucun effet, on les
  // désactive plutôt que de laisser croire qu'ils agissent. Le bouton
  // « afficher dans la tablature » reste actif, c'est de l'affichage.
  // La piste est de fait muette : on l'affiche mute (bouton M allumé), sans
  // possibilité de la démuter tant qu'il y a de l'audio.
  if (tabExternal) {
    const why = 'Son MIDI indisponible : la tablature suit les pistes audio'
    for (const el of [btnMute, btnSolo, volSlider]) {
      el.disabled = true
      el.title = why
    }
    btnMute.classList.add('active')
    btnMute.setAttribute('aria-pressed', 'true')
    sidebarCtrl.classList.add('track-sidebar-ctrl--inert')
  }

  // Aire vide colorée (v1) — pas de piano-roll
  const waveEl = document.createElement('div')
  waveEl.className = 'track-wave track-wave--midi'
  waveEl.style.setProperty('--midi-color', color)
  waveEl.style.height = (isMobile ? 48 : 64) + 'px'

  row.append(sidebar, waveEl)
  tracksContainer.insertBefore(row, firstAudioRowEl())

  const state = { track, muted: false, soloed: false, volume: 1, visible: true, btnShow, waveEl }
  midiTracks.push(state)
  const myIdx = midiTracks.length - 1

  btnMute.addEventListener('click', () => {
    state.muted = !state.muted
    btnMute.classList.toggle('active', state.muted)
    btnMute.setAttribute('aria-pressed', String(state.muted))
    applyMix()
  })

  btnSolo.addEventListener('click', () => {
    state.soloed = !state.soloed
    btnSolo.classList.toggle('active', state.soloed)
    btnSolo.setAttribute('aria-pressed', String(state.soloed))
    applyMix()
  })

  volSlider.addEventListener('input', () => {
    state.volume = Number(volSlider.value) / 100
    applyMidiTracksAudio()
  })

  btnShow.addEventListener('click', () => setTabTrackVisible(myIdx, !state.visible))
}

function buildMidiTrackRows(score) {
  tracksContainer.querySelectorAll('.track-row--midi').forEach(el => el.remove())
  midiTracks = []
  // Couleurs : palette existante, indices après les pistes audio
  const colorOffset = currentTracks.length
  score.tracks.forEach((track, i) => {
    buildMidiTrackRow(track, i, TRACK_COLORS[(colorOffset + i) % TRACK_COLORS.length])
  })
  // Un solo posé sur une piste audio avant le chargement du score doit aussi
  // couper les pistes MIDI qui viennent d'apparaître.
  applyMidiTracksAudio()
}

// ── 35.4 — Backing track embarqué dans le fichier GP ──────────────────────

// Nom de cache des peaks du backing track (pas de fichier sur disque).
const BACKING_PEAKS_NAME = '_backing'

// Les octets bruts n'ont pas de type MIME : sans lui certains navigateurs
// refusent de lire le Blob. Déduction depuis les octets d'en-tête.
function sniffAudioMime(bytes) {
  const ascii = (off, len) => String.fromCharCode(...bytes.slice(off, off + len))
  if (ascii(0, 3) === 'ID3')  return 'audio/mpeg'
  if (ascii(0, 4) === 'OggS') return 'audio/ogg'
  if (ascii(0, 4) === 'fLaC') return 'audio/flac'
  if (ascii(0, 4) === 'RIFF') return 'audio/wav'
  if (ascii(4, 4) === 'ftyp') return 'audio/mp4'
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg'
  return 'audio/mpeg'
}

// Première ligne de piste audio « fichier » (ni MIDI, ni backing)
function firstPlainAudioRowEl() {
  return tracksContainer.querySelector('.track-row:not(.track-row--midi):not(.track-row--backing)')
}

async function buildBackingTrackRow(score) {
  const raw = score?.backingTrack?.rawAudioFile
  if (!raw || raw.length === 0) return
  const blob = new Blob([raw], { type: sniffAudioMime(raw) })
  const cachedPeaks = await fetchPeaks(grooveSlug, BACKING_PEAKS_NAME)
  const idx = wavesurfers.length
  buildTrackRow(
    // Le format GP n'expose aucun libellé pour le backing track : nom par défaut.
    { index: idx, filename: BACKING_PEAKS_NAME, displayName: 'Backing Track', url: null },
    idx,
    cachedPeaks,
    {
      blob, isBacking: true, insertBefore: firstPlainAudioRowEl(),
      // Les pistes MIDI ont déjà consommé les couleurs suivant les pistes audio :
      // sans décalage le backing aurait la même couleur que la 1re piste MIDI,
      // dont il est voisin.
      colorIndex: currentTracks.length + midiTracks.length,
    },
  )
  // Tab-only : le backing track est la seule piste mixable du groove.
  setMixDownloadsAvailable(true)
}

// ── Epic 18 — Zoom horizontal ──────────────────────────────────────────────

// Largeur visible d'un viewport, en pixels *fractionnaires*. clientWidth arrondit
// à l'entier : à 32× cette demi-pixel perdue devient 16 px de décalage, et une
// piste plus courte que le morceau retrouve la largeur d'une piste pleine — donc
// une waveform étirée et un clic qui ne tombe plus sur l'instant visé.
function vpWidth(el) {
  return el ? el.getBoundingClientRect().width : 0
}

// Largeur visible de la zone waveform (rangée timeline = piste la plus longue).
function zoomViewportWidth() {
  return vpWidth(timelineVpEl)
}

// Largeur effective du contenu à zoomLevel.
function zoomContentWidth() {
  return zoomViewportWidth() * zoomLevel
}

function zoomMaxScrollX() {
  return Math.max(0, zoomContentWidth() - zoomViewportWidth())
}

// Applique la largeur effective à la colonne timeline et à chaque piste.
// À 1× les largeurs sont remises à leur valeur CSS (100 %) : comportement
// strictement identique à l'avant-epic.
function applyZoomWidths() {
  tracksContainer.classList.toggle('tracks-container--zoomed', zoomLevel > 1)
  setScrollbarVisible(zoomLevel > 1)

  // Conteneur masqué (tablature plein écran) ou pas encore mis en page : toutes
  // les mesures valent 0 et un recalcul écraserait les largeurs à zéro, sans
  // que rien ne les restaure ensuite. On garde les dernières valeurs connues ;
  // adjustTrackWidths() repasse dès que les pistes redeviennent visibles.
  if (zoomLevel > 1 && zoomViewportWidth() <= 0) return

  if (timelineVpEl && timelineWaveColEl) {
    timelineWaveColEl.style.width = zoomLevel > 1
      ? `${(vpWidth(timelineVpEl) * zoomLevel).toFixed(2)}px`
      : ''
  }
  waveVpEls.forEach((vp, i) => {
    const el = waveEls[i]
    if (!el) return
    if (zoomLevel <= 1) { el.style.width = ''; return }
    const w = vpWidth(vp)
    if (w <= 0) return
    el.style.width = `${(w * zoomLevel).toFixed(2)}px`
  })

  setZoomScrollX(zoomScrollX)
  applyTimelineIntervals()
  // Le TimelinePlugin recalcule ses graduations depuis la largeur du wrapper.
  wavesurfers[0]?.emit('redraw')
}

// Paliers de graduation « ronds » pour la règle temporelle. Les deux plus fins
// ne servent qu'aux forts grossissements sur les morceaux courts, où 0,1 s
// passerait sous le seuil de lisibilité.
const TIMELINE_INTERVALS = [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120]

function pickTimelineInterval(pxPerSec, minPx) {
  return TIMELINE_INTERVALS.find(v => v * pxPerSec >= minPx)
      ?? TIMELINE_INTERVALS[TIMELINE_INTERVALS.length - 1]
}

// « a est-il un multiple entier de b ? » — le modulo flottant ne suffit pas en
// dessous de la seconde : 0.25 % 0.05 vaut 0.049999…, ce qui ferait retomber
// le libellé principal sur le secondaire et poserait un libellé sur chaque
// graduation.
function isMultipleOf(a, b) {
  if (b <= 0) return false
  const ratio = a / b
  return Math.abs(ratio - Math.round(ratio)) < 1e-6
}

// Sans cela les graduations resteraient tous les 5 s : illisibles à 32×, où
// l'utilisateur cherche justement la seconde près. À 1× on restaure exactement
// les valeurs d'origine.
function applyTimelineIntervals() {
  if (!timelinePluginRef || !totalDuration) return
  if (zoomLevel <= 1) {
    timelinePluginRef.options.timeInterval           = 5
    timelinePluginRef.options.primaryLabelInterval   = 30
    timelinePluginRef.options.secondaryLabelInterval = 10
    return
  }
  const pxPerSec = zoomContentWidth() / totalDuration
  if (pxPerSec <= 0) return
  const secondary = pickTimelineInterval(pxPerSec, 45)
  // Le libellé principal doit tomber sur un libellé secondaire, sinon la règle
  // alterne deux rythmes sans rapport (10 s / 15 s).
  const primary = TIMELINE_INTERVALS.find(
    v => v * pxPerSec >= 110 && isMultipleOf(v, secondary)
  ) ?? secondary
  timelinePluginRef.options.timeInterval           = pickTimelineInterval(pxPerSec, 18)
  timelinePluginRef.options.secondaryLabelInterval = secondary
  timelinePluginRef.options.primaryLabelInterval   = primary
}

// Applique le décalage horizontal, identique pour toutes les rangées.
function setZoomScrollX(x) {
  zoomScrollX = Math.max(0, Math.min(zoomMaxScrollX(), x))
  const transform = zoomLevel > 1 ? `translateX(${-zoomScrollX}px)` : ''
  if (timelineWaveColEl) timelineWaveColEl.style.transform = transform
  waveEls.forEach(el => { el.style.transform = transform })
  updateScrollbarThumb()
}

// Largeur minimale du curseur, en pixels. Vit ici et non en CSS : le placement
// se calcule à partir d'elle, les deux ne peuvent donc pas diverger.
const SCROLLBAR_THUMB_MIN_W = 24

// 18.7 — Affiche ou masque la scrollbar de la zone waveform. `hidden` la retire
// déjà de l'arbre d'accessibilité, mais aria-hidden est piloté avec lui pour ne
// pas laisser d'attribut figé qui la masquerait une fois affichée.
function setScrollbarVisible(visible) {
  if (!wfScrollbarEl) return
  wfScrollbarEl.hidden = !visible
  wfScrollbarEl.setAttribute('aria-hidden', String(!visible))
}

// Géométrie du curseur, en pixels réels : c'est le repère qu'utilise aussi
// scrollFromBarX() pour convertir un clic en décalage.
function scrollbarThumbGeometry() {
  const barW = wfScrollbarEl?.clientWidth ?? 0
  if (barW <= 0) return null
  const thumbW = Math.min(barW, Math.max(SCROLLBAR_THUMB_MIN_W, barW / zoomLevel))
  return { barW, thumbW, travel: barW - thumbW }
}

// 18.7 — Le curseur reflète la portion visible du morceau.
function updateScrollbarThumb() {
  if (!wfScrollThumbEl || zoomLevel <= 1) return
  const geo = scrollbarThumbGeometry()
  if (!geo) return
  const maxScroll = zoomMaxScrollX()
  const progress  = maxScroll > 0 ? zoomScrollX / maxScroll : 0
  wfScrollThumbEl.style.width = `${geo.thumbW.toFixed(2)}px`
  wfScrollThumbEl.style.left  = `${(progress * geo.travel).toFixed(2)}px`
  wfScrollbarEl.setAttribute('aria-valuenow', String(Math.round(progress * 100)))
}

// Conversion temps → pixel dans le repère du contenu zoomé.
function zoomTimeToPx(t) {
  if (!totalDuration) return 0
  return (t / totalDuration) * zoomContentWidth()
}

// Défilement de bord pendant un glisser en mode zoomé : sans lui, impossible
// d'étendre ou de déplacer un marqueur (epic 17) au-delà de la portion visible
// sans lâcher, défiler, reprendre — alors que c'est le cas d'usage annoncé du
// zoom. `onScroll` rejoue le calcul du glisser quand la vue a bougé sous le
// curseur resté immobile.
const EDGE_SCROLL_ZONE  = 44   // largeur de la zone sensible, en pixels
const EDGE_SCROLL_SPEED = 22   // déplacement maximal par image, en pixels

function startEdgeScroll(onScroll) {
  let clientX = null
  let raf     = null

  const step = () => {
    raf = null
    if (clientX === null || zoomLevel <= 1) return
    const vp = timelineVpEl?.getBoundingClientRect()
    if (vp) {
      let delta = 0
      if (clientX < vp.left + EDGE_SCROLL_ZONE) {
        delta = -EDGE_SCROLL_SPEED *
          Math.min(1, (vp.left + EDGE_SCROLL_ZONE - clientX) / EDGE_SCROLL_ZONE)
      } else if (clientX > vp.right - EDGE_SCROLL_ZONE) {
        delta = EDGE_SCROLL_SPEED *
          Math.min(1, (clientX - (vp.right - EDGE_SCROLL_ZONE)) / EDGE_SCROLL_ZONE)
      }
      if (delta !== 0) {
        const before = zoomScrollX
        setZoomScrollX(zoomScrollX + delta)
        if (zoomScrollX !== before) {
          zoomUserScrolled = true
          onScroll(clientX)
        }
      }
    }
    raf = requestAnimationFrame(step)
  }

  return {
    update(x) {
      clientX = x
      if (raf === null) raf = requestAnimationFrame(step)
    },
    stop() {
      clientX = null
      if (raf !== null) { cancelAnimationFrame(raf); raf = null }
    },
  }
}

// Position courante de la tête de lecture, en secondes.
function playheadTime() {
  return wavesurfers[0]?.getCurrentTime() ?? 0
}

// 18.4 — Recentre la vue sur la tête de lecture, en restant dans les bornes.
function centerPlayhead(time = playheadTime()) {
  if (zoomLevel <= 1) return
  setZoomScrollX(zoomTimeToPx(time) - zoomViewportWidth() / 2)
}

// 18.4 — Ne bouge que si la tête sort de la zone visible (marge de 10 %).
function ensurePlayheadVisible(time = playheadTime(), margin = 0.1) {
  if (zoomLevel <= 1) return
  const vpW = zoomViewportWidth()
  const px  = zoomTimeToPx(time)
  if (px < zoomScrollX + vpW * margin || px > zoomScrollX + vpW * (1 - margin)) {
    centerPlayhead(time)
  }
}

// 18.5 — Défilement automatique pendant la lecture : la tête est ramenée au
// centre dès qu'elle dépasse les trois quarts de la zone visible, ce qui laisse
// voir ce qui arrive plutôt que de recentrer à chaque image.
function zoomAutoScroll(time) {
  if (zoomLevel <= 1) return
  const vpW = zoomViewportWidth()
  const px  = zoomTimeToPx(time)
  if (px < zoomScrollX || px > zoomScrollX + vpW * 0.75) {
    setZoomScrollX(px - vpW * 0.5)
  }
}

// 18.2 — Passage à un palier de zoom. L'ancrage se fait sur la tête de lecture :
// elle reste au centre de l'écran (ou au plus près que les bornes permettent).
function applyZoom(level) {
  if (!ZOOM_LEVELS.includes(level) || level === zoomLevel) return
  const time = playheadTime()
  zoomLevel = level
  zoomUserScrolled = false  // 18.5 — la vue est réancrée sur la tête, le suivi reprend
  updateZoomUI()
  applyZoomWidths()
  centerPlayhead(time)
}

function updateZoomUI() {
  if (btnZoomLevel) {
    btnZoomLevel.textContent = `${zoomLevel}×`
    btnZoomLevel.setAttribute('aria-label', `Niveau de zoom : ${zoomLevel}×`)
    btnZoomLevel.classList.toggle('zoom-level-btn--active', zoomLevel > 1)
  }
  if (btnZoomOut) btnZoomOut.disabled = zoomLevel <= ZOOM_LEVELS[0]
  if (btnZoomIn)  btnZoomIn.disabled  = zoomLevel >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
}

function stepZoom(direction) {
  const idx  = ZOOM_LEVELS.indexOf(zoomLevel)
  const next = ZOOM_LEVELS[idx + direction]
  if (next) applyZoom(next)
}

function initZoomControls() {
  updateZoomUI()
  btnZoomIn?.addEventListener('click', () => stepZoom(1))
  btnZoomOut?.addEventListener('click', () => stepZoom(-1))
  btnZoomLevel?.addEventListener('click', () => applyZoom(1))
}

// 18.3 — Défilement manuel : molette / trackpad sur desktop, swipe sur mobile.
// Un seul décalage est appliqué à toutes les rangées, donc l'alignement entre
// timeline, bande de marqueurs et pistes est conservé au pixel près.
function initZoomScroll() {
  tracksContainer.addEventListener('wheel', (e) => {
    if (zoomLevel <= 1) return
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)
    const delta = horizontal ? e.deltaX : (e.shiftKey ? e.deltaY : 0)
    if (!delta) return
    e.preventDefault()
    setZoomScrollX(zoomScrollX + delta)
    zoomUserScrolled = true
  }, { passive: false })

  // Swipe tactile. Les écouteurs sont en phase de capture : preventDefault()
  // y est appliqué avant que WaveSurfer ne traite le pointermove, ce qui
  // l'empêche de démarrer une création de région pendant le défilement.
  let swipeId = null
  let swipeStartX = 0
  let swipeStartY = 0
  let swipeStartScroll = 0
  let swiping = false

  tracksContainer.addEventListener('pointerdown', (e) => {
    if (zoomLevel <= 1 || e.pointerType !== 'touch') return
    swipeId          = e.pointerId
    swipeStartX      = e.clientX
    swipeStartY      = e.clientY
    swipeStartScroll = zoomScrollX
    swiping          = false
  }, { capture: true })

  tracksContainer.addEventListener('pointermove', (e) => {
    if (swipeId === null || e.pointerId !== swipeId) return
    const dx = e.clientX - swipeStartX
    const dy = e.clientY - swipeStartY
    if (!swiping) {
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return
      swiping = true
    }
    e.preventDefault()
    setZoomScrollX(swipeStartScroll - dx)
    zoomUserScrolled = true
  }, { capture: true, passive: false })

  const endSwipe = (e) => {
    if (swipeId === null || e.pointerId !== swipeId) return
    swipeId = null
    swiping = false
  }
  window.addEventListener('pointerup', endSwipe, true)
  window.addEventListener('pointercancel', endSwipe, true)
}

// 18.7 — Scrollbar horizontale sous les pistes. Sur mobile elle reste un simple
// indicateur : la navigation se fait au swipe.
function initZoomScrollbar() {
  if (!wfScrollbarEl || !wfScrollThumbEl || isMobile) return

  // Convertit une abscisse écran sur la barre en décalage de défilement, dans
  // le même repère en pixels que scrollbarThumbGeometry().
  const scrollFromBarX = (clientX) => {
    const geo = scrollbarThumbGeometry()
    if (!geo || geo.travel <= 0) return 0
    const left  = wfScrollbarEl.getBoundingClientRect().left
    const ratio = (clientX - left - geo.thumbW / 2) / geo.travel
    return Math.max(0, Math.min(1, ratio)) * zoomMaxScrollX()
  }

  let dragging = false

  wfScrollThumbEl.addEventListener('mousedown', (e) => {
    e.preventDefault()
    dragging = true
    wfScrollThumbEl.classList.add('waveform-scrollbar-thumb--dragging')
  })

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return
    setZoomScrollX(scrollFromBarX(e.clientX))
    zoomUserScrolled = true
  })

  window.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    wfScrollThumbEl.classList.remove('waveform-scrollbar-thumb--dragging')
  })

  // Clic sur la piste de la barre (hors curseur) : saut direct.
  wfScrollbarEl.addEventListener('click', (e) => {
    if (e.target === wfScrollThumbEl) return
    setZoomScrollX(scrollFromBarX(e.clientX))
    zoomUserScrolled = true
  })
}

// ── Epic 13 — Tablature synchronisée ──────────────────────────────────────

const TAB_HEIGHTS = { collapsed: 40, strip: 280 }

function tabFullscreenHeight() {
  const headerH    = document.querySelector('.player-header')?.getBoundingClientRect().height || 60
  const transportH = document.getElementById('transport')?.getBoundingClientRect().height     || 100
  return Math.max(300, window.innerHeight - headerH - transportH - 8)
}
function getStateHeight(state) {
  if (state === 'fullscreen') return tabFullscreenHeight()
  return TAB_HEIGHTS[state] ?? 280
}

function setDrawerCssHeight(px) {
  document.documentElement.style.setProperty('--drawer-height', px + 'px')
}

function setTabState(newState) {
  if (!tabDrawerEl) return
  tabState = newState
  tabDrawerEl.classList.remove('tab-drawer--collapsed', 'tab-drawer--strip', 'tab-drawer--fullscreen')
  tabDrawerEl.classList.add(`tab-drawer--${newState}`)

  const h = getStateHeight(newState)
  tabDrawerEl.style.height = h + 'px'
  setDrawerCssHeight(h)
  updateTabScrollButton()

  // En mode plein écran : contraindre player-main + bloquer scroll page
  if (newState === 'fullscreen') {
    const headerH    = document.querySelector('.player-header')?.getBoundingClientRect().height || 60
    const transportH = drawerEl?.getBoundingClientRect().height || 0
    const playerH    = window.innerHeight - headerH - h - transportH
    document.documentElement.style.setProperty('--player-main-h', playerH + 'px')
    document.documentElement.classList.add('tab-no-scroll')
    document.body.classList.add('tab-no-scroll')
    window.scrollTo({ top: 0 })
  } else {
    document.documentElement.classList.remove('tab-no-scroll')
    document.body.classList.remove('tab-no-scroll')
    document.documentElement.style.removeProperty('--player-main-h')
  }

  // Show/hide waveform tracks in fullscreen mode
  const tracksEl  = document.getElementById('tracks-container')
  if (newState === 'fullscreen') {
    tracksEl?.classList.add('tab-hidden')
  } else if (tracksEl?.classList.contains('tab-hidden')) {
    tracksEl.classList.remove('tab-hidden')
    // Epic 18 — les largeurs n'ont pas pu être mesurées tant que le conteneur
    // était masqué : les recalculer une fois la mise en page rétablie.
    requestAnimationFrame(adjustTrackWidths)
  }

  const stateMap = { fullscreen: btnTabFullscreen, strip: btnTabStrip, collapsed: btnTabCollapse }
  ;[btnTabFullscreen, btnTabStrip, btnTabCollapse].forEach(btn => {
    btn?.classList.remove('active')
    btn?.setAttribute('aria-pressed', 'false')
  })
  stateMap[newState]?.classList.add('active')
  stateMap[newState]?.setAttribute('aria-pressed', 'true')

  // En média externe la boucle continue même drawer replié : elle alimente
  // AlphaTab en position audio (le défilement du curseur, lui, est déjà inhibé).
  if (newState === 'collapsed') {
    if (!tabExternal) stopTabSync()
  } else {
    startTabSync()
    if (alphaTabApi) {
      const mod = window.__alphaTabModule
      if (mod) {
        const usePageLayout = newState === 'fullscreen'
        const newMode = usePageLayout ? mod.LayoutMode.Page : mod.LayoutMode.Horizontal
        if (alphaTabApi.settings.display.layoutMode !== newMode) {
          alphaTabApi.settings.display.layoutMode = newMode
          alphaTabApi.updateSettings()
          alphaTabApi.render()
        }
      }
    }
  }
}

function setupTabHandleDrag() {
  if (!tabHandleEl) return
  let dragging = false
  let startY = 0
  let startH = 0

  const onMove = (e) => {
    if (!dragging) return
    const newH = Math.max(TAB_HEIGHTS.collapsed, Math.min(window.innerHeight * 0.9, startH - (e.clientY - startY)))
    tabDrawerEl.style.transition = 'none'
    tabDrawerEl.style.height = newH + 'px'
    setDrawerCssHeight(newH)
  }

  const commit = () => {
    if (!dragging) return
    dragging = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', commit)
    tabDrawerEl.style.transition = ''
    const h = tabDrawerEl.getBoundingClientRect().height
    const distances = [
      { state: 'collapsed',  dist: Math.abs(h - TAB_HEIGHTS.collapsed) },
      { state: 'strip',      dist: Math.abs(h - TAB_HEIGHTS.strip) },
      { state: 'fullscreen', dist: Math.abs(h - tabFullscreenHeight()) },
    ]
    const nearest = distances.reduce((a, b) => a.dist < b.dist ? a : b).state
    setTabState(nearest)
  }

  tabHandleEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, label, input')) return
    dragging = true
    startY = e.clientY
    startH = tabDrawerEl.getBoundingClientRect().height
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', commit)
    e.preventDefault()
  })

  tabHandleEl.addEventListener('touchstart', (e) => {
    if (e.target.closest('button, label, input')) return
    dragging = true
    startY = e.touches[0].clientY
    startH = tabDrawerEl.getBoundingClientRect().height
    e.preventDefault()
  }, { passive: false })

  tabHandleEl.addEventListener('touchmove', (e) => {
    if (!dragging) return
    onMove(e.touches[0].clientY)
    e.preventDefault()
  }, { passive: false })

  tabHandleEl.addEventListener('touchend', commit)
}

// ── Axe temps : ticks MIDI ↔ secondes audio ───────────────────────────────
// Les points de synchro du fichier GP portent, chacun, un tick MIDI
// (`synthTick`) et l'instant correspondant dans l'audio (`syncTime`, en ms).
// La conversion est donc une interpolation linéaire par morceaux sur ces
// couples. Au-delà du dernier point, on prolonge au tempo de synchro du
// fichier (`syncBpm`) : la durée d'une waveform n'a aucun rapport avec la fin
// du score et ne doit jamais servir d'ancre.
//
// Pendant la lecture ces fonctions ne servent pas : AlphaTab fait lui-même la
// conversion (mode EnabledExternalMedia). Elles alimentent l'affichage hors
// lecture — règle de mesures, bornes de boucle, durée du score.

const MIDI_QUARTER_TICKS = 960

function scoreTempoBpm() {
  return alphaTabApi?.score?.tempo || tabScore?.tempo || 120
}

function ticksToSec(ticks, bpm) {
  return ticks * 60 / ((bpm || scoreTempoBpm()) * MIDI_QUARTER_TICKS)
}

// Segment de la table de synchro contenant `tick` (ou le dernier).
function syncSegmentForTick(tick) {
  const sps = tabSyncPoints
  let i = sps.length - 1
  for (let j = 0; j < sps.length - 1; j++) {
    if (tick < sps[j + 1].synthTick) { i = j; break }
  }
  return [sps[i], (i + 1 < sps.length) ? sps[i + 1] : null]
}

// Tick MIDI (axe de lecture, reprises dépliées) → seconde sur l'axe audio.
function tickToAudioSec(tick) {
  const sps = tabSyncPoints
  if (!sps || sps.length === 0) return ticksToSec(tick, scoreTempoBpm())
  const [a, b] = syncSegmentForTick(tick)
  if (!b) return a.syncTime / 1000 + ticksToSec(tick - a.synthTick, a.syncBpm || a.synthBpm)
  const dTick = b.synthTick - a.synthTick
  if (dTick <= 0) return a.syncTime / 1000
  return (a.syncTime + (tick - a.synthTick) / dTick * (b.syncTime - a.syncTime)) / 1000
}

// Seconde sur l'axe audio → tick MIDI. Inverse exact de tickToAudioSec.
function audioSecToTick(sec) {
  const sps = tabSyncPoints
  const ms  = sec * 1000
  if (!sps || sps.length === 0) return ms * scoreTempoBpm() * MIDI_QUARTER_TICKS / 60000
  let i = sps.length - 1
  for (let j = 0; j < sps.length - 1; j++) {
    if (ms < sps[j + 1].syncTime) { i = j; break }
  }
  const a = sps[i]
  const b = (i + 1 < sps.length) ? sps[i + 1] : null
  if (!b) {
    const bpm = a.syncBpm || a.synthBpm || scoreTempoBpm()
    return a.synthTick + (ms - a.syncTime) * bpm * MIDI_QUARTER_TICKS / 60000
  }
  const dMs = b.syncTime - a.syncTime
  if (dMs <= 0) return a.synthTick
  return a.synthTick + (ms - a.syncTime) / dMs * (b.synthTick - a.synthTick)
}

// Lissage du scroll téléprompter — amortissement critique (type SmoothDamp) :
// la vitesse de défilement est un état persistant qu'on fait converger vers la
// cible, et non un saut recalculé à chaque frame. Le mouvement reste donc
// continu et régulier même quand la cible avance par paliers (changement de
// beat en strip, changement de ligne en page), et un seek se rattrape sans
// à-coup. Un état par axe : les deux modes ne défilent jamais ensemble.
const TAB_SCROLL_SMOOTH_TIME = 0.30   // secondes pour rejoindre la cible
const tabScrollH = { pos: 0, vel: 0 } // axe horizontal (strip)
const tabScrollV = { pos: 0, vel: 0 } // axe vertical (page)
let   tabScrollLastTs = 0

// Secondes écoulées depuis la frame précédente, bornées pour absorber une
// mise en veille de l'onglet.
function tabScrollDelta() {
  const now = performance.now()
  const dt  = tabScrollLastTs ? (now - tabScrollLastTs) / 1000 : 0.0167
  tabScrollLastTs = now
  return Math.min(0.1, dt)
}

function smoothDamp(state, target, dt) {
  const omega  = 2 / TAB_SCROLL_SMOOTH_TIME
  const x      = omega * dt
  const exp    = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = state.pos - target
  const temp   = (state.vel + omega * change) * dt
  state.vel = (state.vel - omega * temp) * exp
  state.pos = target + (change + temp) * exp
  if (Math.abs(target - state.pos) < 0.25) { state.pos = target; state.vel = 0 }
  return state.pos
}

// Position *rendue* du curseur, en pixels de contenu : { x, y, h }.
// AlphaTab n'écrit dans `style.transform` que la position du beat *suivant*,
// et laisse une transition CSS linéaire faire le trajet : lire le style inline
// donne donc une valeur en escalier, alors que le style calculé donne la
// valeur interpolée par le navigateur — continue, exactement ce que suit l'œil.
// `h` (facteur d'échelle vertical) est la hauteur du système courant, donc la
// hauteur d'une ligne de partition.
function renderedCursorBox(el) {
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return null
  try {
    const m = new DOMMatrixReadOnly(t)
    if (!Number.isFinite(m.m41) || !Number.isFinite(m.m42)) return null
    return { x: m.m41, y: m.m42, h: m.m22 }
  } catch { return null }
}

// Scroll téléprompter — lit la position X/Y du curseur depuis son CSS transform
// (coordonnées contenu, non affectées par scrollLeft/scrollTop), puis cible le scroll
// pour maintenir le curseur fixe à une position relative dans le viewport.
// Appelé chaque frame RAF depuis startTabSync.
function enforceTabCursorVisible() {
  if (!tabContentEl || tabState === 'collapsed') return
  const cursor = tabContentEl.querySelector('.at-cursor-beat')
  if (!cursor) return
  const t = cursor.style.transform  // "translate(Xpx, Ypx) scale(w, h)"
  if (!t) return

  // Défilement suspendu : l'utilisateur explore la partition à la main, le
  // téléprompteur ne doit pas la lui reprendre. On suit quand même sa position
  // pour repartir de là sans saut quand il rendra la main.
  if (!tabAutoScroll) {
    tabScrollH.pos = tabContentEl.scrollLeft; tabScrollH.vel = 0
    tabScrollV.pos = tabContentEl.scrollTop;  tabScrollV.vel = 0
    tabScrollLastTs = 0
    return
  }

  const box = renderedCursorBox(cursor)
  const dt  = tabScrollDelta()

  if (tabState === 'strip') {
    // Cible : ce qui est joué au centre de la fenêtre. Tant que le curseur n'a
    // pas atteint le centre (début du morceau), le clamp à 0 laisse la
    // partition immobile et c'est le curseur qui avance ; ensuite le scroll
    // prend le relais et le curseur reste au milieu.
    const W   = tabContentEl.clientWidth
    const max = Math.max(0, tabContentEl.scrollWidth - W)

    let cursorX = box?.x
    if (cursorX === undefined) {
      const mx = /translate\((-?[\d.]+)px/.exec(t)
      if (!mx) return
      cursorX = parseFloat(mx[1])
    }
    const target = Math.min(max, Math.max(0, cursorX - W / 2))

    // Resync si le scroll a bougé hors de notre contrôle (rendu, scroll manuel)
    if (Math.abs(tabScrollH.pos - tabContentEl.scrollLeft) > 2) tabScrollH.pos = tabContentEl.scrollLeft

    tabContentEl.scrollLeft = smoothDamp(tabScrollH, target, dt)
  } else if (tabState === 'fullscreen') {
    // Cible : la ligne en cours de lecture en *deuxième* position dans la page,
    // de sorte que tout ce qui reste sous elle soit déjà lisible en avance.
    // On ne scrolle donc plus seulement quand le curseur déborde : la cible
    // suit la ligne courante en permanence, et l'amortissement transforme le
    // passage d'une ligne à l'autre en glissé plutôt qu'en saut.
    const H   = tabContentEl.clientHeight
    const max = Math.max(0, tabContentEl.scrollHeight - H)

    let contentY, lineH
    if (box) {
      contentY = box.y
      lineH    = box.h
    } else {
      const my = /translate\(-?[\d.]+px,\s*(-?[\d.]+)px\)\s*scale\([^,]+,\s*(-?[\d.]+)/.exec(t)
      if (!my) return
      contentY = parseFloat(my[1])
      lineH    = parseFloat(my[2])
    }
    if (!(lineH > 0)) lineH = H * 0.2

    // Une ligne complète laissée au-dessus : la ligne active est la deuxième
    // visible. Bornée à un tiers de la page pour rester en haut sur les
    // partitions à systèmes très hauts.
    const headroom = Math.min(lineH, H / 3)
    const target   = Math.min(max, Math.max(0, contentY - headroom))

    if (Math.abs(tabScrollV.pos - tabContentEl.scrollTop) > 2) tabScrollV.pos = tabContentEl.scrollTop

    tabContentEl.scrollTop = smoothDamp(tabScrollV, target, dt)
  }
}

// Scroll manuel à la molette. En strip la tablature ne défile
// qu'horizontalement : sans conversion, la molette verticale — la seule que
// la plupart des souris possèdent — n'y ferait rien. En page le défilement
// vertical natif convient, on se contente de noter la reprise en main.
// Le bouton de reprise n'a de sens que pendant la lecture : à l'arrêt rien ne
// défile, la tablature est libre et il n'y a rien à reprendre.
function updateTabScrollButton() {
  if (!btnTabScrollResume) return
  const show = !tabAutoScroll && isPlaying && tabState !== 'collapsed'
  if (show) btnTabScrollResume.removeAttribute('hidden')
  else      btnTabScrollResume.setAttribute('hidden', '')
}

// Suspend ou reprend le défilement automatique.
function setTabAutoScroll(on) {
  tabAutoScroll = on
  updateTabScrollButton()
}

function setupTabManualScroll() {
  if (!tabContentEl) return
  btnTabScrollResume?.addEventListener('click', () => setTabAutoScroll(true))
  tabContentEl.addEventListener('wheel', (e) => {
    if (tabState === 'collapsed') return
    setTabAutoScroll(false)
    if (tabState !== 'strip') return
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (!delta) return
    e.preventDefault()
    tabContentEl.scrollLeft += delta
    tabScrollH.pos = tabContentEl.scrollLeft
    tabScrollH.vel = 0
  }, { passive: false })
}

function startTabSync() {
  if (tabSyncRafId !== null) return
  const loop = () => {
    // Mode média externe : le RAF pousse la position audio dans AlphaTab, qui
    // en déduit la mesure et le temps courants. Une fois par frame, soit bien
    // plus fin que les 50 ms recommandés par AlphaTab.
    pushExternalPosition()
    if (alphaTabApi && tabState !== 'collapsed') {
      enforceTabCursorVisible()
    }
    tabSyncRafId = requestAnimationFrame(loop)
  }
  tabSyncRafId = requestAnimationFrame(loop)
}

function stopTabSync() {
  if (tabSyncRafId !== null) {
    cancelAnimationFrame(tabSyncRafId)
    tabSyncRafId = null
  }
}

// 35.1 / 35.5 — Repères musicaux du score
// AlphaTab publie sa propre table de lecture (`api.tickCache.masterBars`) :
// une entrée par mesure *jouée*, reprises dépliées, avec ses bornes en ticks.
// C'est elle qui fait autorité — la liste `score.masterBars` est l'écriture,
// pas la lecture, et ignore les reprises.
function barLookups() {
  const lut = alphaTabApi?.tickCache?.masterBars
  return (lut && lut.length > 0) ? lut : null
}

// Durée totale du score en ticks MIDI (fin de la dernière mesure jouée).
function scoreTotalTicks(score) {
  const lut = barLookups()
  if (lut) return lut[lut.length - 1].end
  const bars = score?.masterBars
  if (!bars || bars.length === 0) return 0
  const last = bars[bars.length - 1]
  return last.start + last.calculateDuration()
}

// Tick MIDI → { bar, beat } 0-indexés. `bar` est l'index d'écriture de la
// mesure : une mesure jouée deux fois (reprise) porte le même numéro les
// deux fois, ce qui est bien ce qu'attend un musicien qui lit la partition.
function tickToBarBeat(tick) {
  const lut = barLookups()
  if (lut) {
    let lo = 0, hi = lut.length - 1, idx = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (lut[mid].start <= tick) { idx = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    const entry = lut[idx]
    const mb    = entry.masterBar
    const num   = mb?.timeSignatureNumerator || 4
    const span  = entry.end - entry.start
    const ticksPerBeat = span / num
    const beat = ticksPerBeat > 0
      ? Math.max(0, Math.min(num - 1, Math.floor((tick - entry.start) / ticksPerBeat)))
      : 0
    return { bar: mb?.index ?? idx, beat }
  }
  const bars = tabScore?.masterBars
  if (!bars || bars.length === 0) return null
  let lo = 0, hi = bars.length - 1, idx = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid].start <= tick) { idx = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  const mb  = bars[idx]
  const num = mb.timeSignatureNumerator || 4
  const ticksPerBeat = mb.calculateDuration() / num
  const beat = ticksPerBeat > 0
    ? Math.max(0, Math.min(num - 1, Math.floor((tick - mb.start) / ticksPerBeat)))
    : 0
  return { bar: idx, beat }
}

// Bornes en ticks de la mesure d'index `i`, à sa première lecture.
function barTickRange(i) {
  const bars = tabScore?.masterBars
  if (!bars || bars.length === 0) return null
  const mb = bars[Math.max(0, Math.min(bars.length - 1, i))]
  const cache = alphaTabApi?.tickCache
  if (cache) {
    try {
      const entry = cache.getMasterBar(mb)
      if (entry && entry.end > entry.start) {
        return { start: entry.start, span: entry.end - entry.start, masterBar: mb }
      }
    } catch { /* mesure hors lecture : repli sur l'écriture */ }
  }
  return { start: mb.start, span: mb.calculateDuration(), masterBar: mb }
}

// { bar, beat } 0-indexés → tick MIDI
function barBeatToTick(bar, beat) {
  const r = barTickRange(bar)
  if (!r) return 0
  const num = r.masterBar.timeSignatureNumerator || 4
  return r.start + Math.max(0, Math.min(num - 1, beat)) * (r.span / num)
}

function barBeatToSec(bar, beat) {
  return tickToAudioSec(barBeatToTick(bar, beat))
}

// Le mode BBT n'a de sens qu'avec un score chargé.
function bbtEnabled() {
  return timeMode === 'bbt' && tabMaster && !!tabScore?.masterBars?.length
}

// Position en secondes → « mesure:temps » 1-indexé (ex. 5:3)
function formatBBT(sec) {
  const bb = tickToBarBeat(audioSecToTick(Math.max(0, sec)))
  if (!bb) return formatTimecode(sec)
  return `${bb.bar + 1}:${bb.beat + 1}`
}

// Formatage du timecode selon le mode actif
function formatPosition(sec) {
  return bbtEnabled() ? formatBBT(sec) : formatTimecode(sec)
}

function updateDurationDisplay() {
  if (bbtEnabled()) {
    // Nombre de mesures *jouées* : cohérent avec la règle de mesures, qui
    // déroule les reprises.
    durationEl.textContent = `${barLookups()?.length ?? tabScore.masterBars.length} mes.`
  } else {
    durationEl.textContent = totalDuration > 0 ? formatTimecode(totalDuration) : '—'
  }
}

// 35.5 — Graduations de mesures, reconstruites depuis score.masterBars.
// Positions converties en % de la durée totale : insensibles au redimensionnement.
function renderBbtTimeline() {
  if (!bbtTimelineEl) return
  const on = bbtEnabled()
  bbtTimelineEl.hidden = !on
  if (timelineExtEl) timelineExtEl.hidden = on
  if (!on || !(totalDuration > 0)) return

  bbtTimelineEl.innerHTML = ''
  // Une graduation par mesure *jouée* : sur un morceau à reprises, la même
  // mesure apparaît autant de fois qu'elle est jouée, au bon endroit.
  const lut  = barLookups()
  const bars = lut
    ? lut.map(e => ({ start: e.start, label: (e.masterBar?.index ?? 0) + 1 }))
    : tabScore.masterBars.map((mb, i) => ({ start: mb.start, label: i + 1 }))
  const width   = bbtTimelineEl.getBoundingClientRect().width || 800
  const pxPerBar = width / bars.length
  // Une étiquette tous les N marqueurs pour garder ~36 px entre deux libellés
  const labelStep = Math.max(1, Math.ceil(36 / Math.max(pxPerBar, 1)))

  for (let i = 0; i < bars.length; i++) {
    const sec = tickToAudioSec(bars[i].start)
    if (sec > totalDuration) break
    const tick = document.createElement('div')
    tick.className = 'bbt-tick'
    tick.style.left = `${(sec / totalDuration) * 100}%`
    if (i % labelStep === 0) {
      tick.classList.add('bbt-tick--labeled')
      const label = document.createElement('span')
      label.className = 'bbt-tick-label'
      label.textContent = String(bars[i].label)
      tick.appendChild(label)
    }
    bbtTimelineEl.appendChild(tick)
  }
}

function setTimeMode(mode) {
  timeMode = mode === 'bbt' ? 'bbt' : 'time'
  try { localStorage.setItem(TIME_MODE_KEY, timeMode) } catch { /* ignore */ }
  if (btnTimeModeEl) {
    btnTimeModeEl.textContent = timeMode === 'bbt' ? 'BBT' : 'm:s'
    btnTimeModeEl.setAttribute('aria-pressed', String(timeMode === 'bbt'))
    btnTimeModeEl.classList.toggle('active', timeMode === 'bbt')
  }
  updateTimeDisplay(currentTimeSec())
  updateDurationDisplay()
  updateLoopFields()
  renderBbtTimeline()
}

function initTimeMode() {
  let saved = 'time'
  try { saved = localStorage.getItem(TIME_MODE_KEY) || 'time' } catch { /* ignore */ }
  timeMode = saved === 'bbt' ? 'bbt' : 'time'
  if (btnTimeModeEl) {
    btnTimeModeEl.textContent = timeMode === 'bbt' ? 'BBT' : 'm:s'
    btnTimeModeEl.setAttribute('aria-pressed', String(timeMode === 'bbt'))
    btnTimeModeEl.classList.toggle('active', timeMode === 'bbt')
    btnTimeModeEl.addEventListener('click', () => {
      setTimeMode(timeMode === 'bbt' ? 'time' : 'bbt')
    })
  }
}

function buildTrackSelector(score) {
  if (!tabTrackListEl) return
  tabTrackListEl.innerHTML = ''
  score.tracks.forEach((track, i) => {
    const label = document.createElement('label')
    label.className = 'tab-track-label'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = true
    cb.dataset.trackIdx = String(i)
    cb.addEventListener('change', () => setTabTrackVisible(i, cb.checked))
    label.append(cb, document.createTextNode(track.name || `Piste ${i + 1}`))
    tabTrackListEl.appendChild(label)
  })
}

// 35.2 — Échec du chargement de la tablature. En tab-only, aucune waveform ne
// viendra terminer le chargement : la page resterait indéfiniment en « loading ».
let tabLoadErrorShown = false
function tabLoadFailed(msg) {
  console.warn('[tab]', msg)
  // Sans score, une boucle enregistrée en mesure:temps reste inconvertible.
  tabWillLoad = false
  warnBbtLoopUnavailable()
  if (tabContentEl && !tabLoadErrorShown) {
    tabContentEl.textContent = msg
    tabContentEl.classList.remove('tab-content--loading')
  }
  if (currentTracks.length === 0 && !tabLoadErrorShown) showFatalError(msg)
  tabLoadErrorShown = true
}

async function initTabDrawer(tabFile) {
  if (!IS_DESKTOP) return
  if (!tabDrawerEl) {
    tabLoadFailed('Tablature indisponible : interface non initialisée.')
    return
  }

  tabContentEl.classList.add('tab-content--loading')
  tabDrawerEl.removeAttribute('hidden')
  setTabState('strip')
  setupTabHandleDrag()
  setupTabManualScroll()

  btnTabFullscreen?.addEventListener('click', () => setTabState('fullscreen'))
  btnTabStrip?.addEventListener('click',     () => setTabState('strip'))
  btnTabCollapse?.addEventListener('click',  () => setTabState('collapsed'))

  // Note: le package alphaTab utilise un T majuscule dans les noms de fichiers dist
  const AT_BASE = '/vendor/alphatab'

  let alphaTabMod
  try {
    alphaTabMod = await import(`${AT_BASE}/alphaTab.mjs`)
    window.__alphaTabModule = alphaTabMod
  } catch (err) {
    console.warn('[tab] Échec chargement AlphaTab:', err)
    tabLoadFailed('AlphaTab non disponible (erreur de chargement).')
    return
  }

  // Le mode du player dépend de ce que le fichier contient : un `.gp` porteur
  // d'un backing track a du son même sans piste audio sur le disque. Le savoir
  // impose de lire le fichier ici, avant d'instancier l'API — le mode ne peut
  // plus être changé ensuite, et il conditionne l'UI des pistes MIDI
  // (construite dès scoreLoaded) autant que le transport.
  // Le score parsé est passé tel quel à `load()` : AlphaTab l'accepte et ne le
  // ré-analyse pas, le fichier n'est donc lu qu'une fois.
  let preloadedScore = null
  const tabUrl = `/tab/${encodePath(grooveSlug)}/${encodeURIComponent(tabFile)}`
  try {
    const bytes = new Uint8Array(await (await fetch(tabUrl)).arrayBuffer())
    preloadedScore = alphaTabMod.importer.ScoreLoader.loadScoreFromBytes(bytes)
  } catch (err) {
    // Lecture impossible ici : on laisse AlphaTab charger l'URL lui-même et
    // signaler l'erreur par son propre événement.
    console.warn('[tab] pré-lecture du fichier impossible:', err)
  }

  tabContentEl.classList.remove('tab-content--loading')

  // Média externe dès qu'il y a du son à suivre, qu'il vienne des pistes du
  // groove ou du backing track embarqué dans le `.gp`. Sans cela AlphaTab
  // démarre son synthétiseur : celui-ci sonne par-dessus l'enregistrement et,
  // pire, son horloge devient maîtresse et recale l'audio plusieurs fois par
  // seconde dès que les points de synchro écartent la partition du temps réel.
  tabExternal = currentTracks.length > 0
    || (preloadedScore?.backingTrack?.rawAudioFile?.length ?? 0) > 0

  alphaTabApi = new alphaTabMod.AlphaTabApi(tabContentEl, {
    core: {
      workerFile:    `${AT_BASE}/alphaTab.worker.mjs`,
      fontDirectory: `${AT_BASE}/font/`,
      logLevel:      alphaTabMod.LogLevel.Warning,
    },
    player: {
      // Dès qu'il y a de l'audio, ce sont nos instances WaveSurfer qui portent
      // le temps : AlphaTab les traite comme un « média externe » et convertit
      // lui-même temps audio ↔ position dans la partition, à partir des points
      // de synchro du fichier GP. Sans aucun audio (tab-only), le synthétiseur
      // MIDI joue et porte sa propre horloge.
      playerMode:           tabExternal
        ? alphaTabMod.PlayerMode.EnabledExternalMedia
        : alphaTabMod.PlayerMode.EnabledSynthesizer,
      enableCursor:         true,
      enableUserInteraction: true,
      soundFont:            `${AT_BASE}/soundfont/sonivox.sf2`,
      scrollMode:           0,   // Off — scroll géré par enforceTabCursorVisible (AlphaTab scroll ne fonctionne pas sans son player interne actif)
    },
    display: {
      layoutMode:   alphaTabMod.LayoutMode.Horizontal,
      staveProfile: alphaTabMod.StaveProfile.ScoreTab,
      scale:        0.9,
    },
  })

  window.__alphaTabApi = alphaTabApi
  // Surface de test : le temps se pilote désormais par l'axe audio, pas par
  // l'horloge du synthé — les tests doivent passer par le transport du player.
  window.__playerSeek     = (sec) => seekAllTo(sec)
  window.__playerPosition = () => currentTimeSec()

  // Le player interne est prêt : en média externe, c'est le moment de lui
  // brancher nos waveforms ; en synthétiseur, son horloge devient utilisable.
  alphaTabApi.playerReady.on(() => {
    tabClockLive = true
    if (tabExternal) attachExternalMedia()
  })

  alphaTabApi.error.on(err => {
    console.error('[AlphaTab]', err)
    // Fichier GP illisible : le score ne sera jamais chargé.
    if (!tabScore) tabLoadFailed('Tablature illisible (fichier Guitar Pro invalide).')
  })

  // Auto-fit strip height once rendering is complete (postRenderFinished = once, not per partial)
  alphaTabApi.postRenderFinished.on(() => {
    // Reset scroll à chaque nouveau rendu (changement de layout ou de pistes)
    tabContentEl.scrollLeft = 0
    tabContentEl.scrollTop  = 0
    tabScrollH.pos = 0; tabScrollH.vel = 0
    tabScrollV.pos = 0; tabScrollV.vel = 0
    setTabAutoScroll(true)

    if (tabState !== 'strip') return
    const atSurface = tabContentEl.querySelector('.at-surface')
    if (!atSurface) return
    const surfaceH = parseInt(atSurface.style.height || '0', 10)
    if (surfaceH <= 0) return
    const handleH = tabHandleEl?.getBoundingClientRect().height || 50
    const newH = surfaceH + handleH + 8
    if (newH === TAB_HEIGHTS.strip) return   // no change → no action
    TAB_HEIGHTS.strip = newH
    document.documentElement.style.setProperty('--tab-strip-height', newH + 'px')
    tabDrawerEl.style.height = newH + 'px'
    setDrawerCssHeight(newH)
    // DO NOT call render() here — it would trigger postRenderFinished → infinite loop
  })

  // Track selector + sync points after score load
  alphaTabApi.scoreLoaded.on(score => {
    // 35.1 — dès qu'un score est chargé, AlphaTab devient l'horloge maître
    tabScore   = score
    tabMaster  = true
    try { alphaTabApi.playbackSpeed = currentTempo / 100 } catch { /* player pas prêt */ }
    buildMidiTrackRows(score)
    buildBackingTrackRow(score).catch(err => console.warn('[tab] backing track:', err))
    buildTrackSelector(score)
    // 35.3 — les boutons « afficher dans la tab » et les cases du drawer sont
    // tous actifs au départ : AlphaTab, lui, ne rend que sa piste par défaut.
    // Sans cet appel l'UI annoncerait des portées absentes de la tablature.
    applyTabTrackSelection()
    // Table de synchro du fichier, pour les conversions hors lecture.
    // AlphaTab la charge déjà lui-même dans son player ; on en garde une copie
    // pour placer la règle de mesures et les bornes de boucle.
    try {
      const mod = window.__alphaTabModule
      const sps = mod?.midi?.MidiFileGenerator?.generateSyncPoints(score)
      if (sps?.length > 0) {
        tabSyncPoints = sps
        console.info('[tab] points de synchro :', sps.length,
          sps.map(p => `mes.${p.masterBarIndex + 1}@${(p.syncTime / 1000).toFixed(2)}s`).join(' '))
      }
    } catch (e) {
      console.warn('[tab] lecture des points de synchro impossible :', e)
    }

    // Durée du score sur l'axe audio (dépend des points de synchro)
    scoreDurationSec = tickToAudioSec(scoreTotalTicks(score))
    if (scoreDurationSec > totalDuration) {
      totalDuration = scoreDurationSec
      updateDurationDisplay()
    }

    // 35.6 — boucle lue en BBT : convertible maintenant que le score est là
    applyPendingBbtLoop()

    // 35.5 — le score est là : la bascule BBT ↔ mm:ss devient disponible
    btnTimeModeEl?.removeAttribute('hidden')
    updateTimeDisplay(currentTimeSec())
    updateDurationDisplay()
    updateLoopFields()
    renderBbtTimeline()

    // 35.2 — tab-only : aucune waveform ne viendra terminer le chargement
    if (currentTracks.length === 0) {
      finishLoading()
      if (pendingLoop) {
        syncRegionToAll(pendingLoop.in, pendingLoop.out)
        pendingLoop = null
      }
      adjustTrackWidths()
    }
  })

  // Mode synthétiseur (tab-only) : l'horloge MIDI pilote l'affichage, la boucle
  // et le recalage des waveforms — il n'y a pas d'autre source de temps.
  // Mode média externe : c'est l'audio qui mène, cet événement n'est plus que
  // l'accusé de réception d'AlphaTab et ne doit rien recaler.
  alphaTabApi.playerPositionChanged.on(args => {
    if (!tabMaster || tabExternal) return
    tabClockLive = true
    const audioSec = tickToAudioSec(args.currentTick)
    updateTimeDisplay(audioSec)
    for (const ws of wavesurfers) {
      if (args.isSeek || Math.abs(ws.getCurrentTime() - audioSec) > WS_DRIFT_TOL) {
        ws.setTime(audioSec)
      }
    }
    // 18.5 — l'horloge AlphaTab pilote aussi le suivi de la vue zoomée,
    // puisque le timeupdate de WaveSurfer ne fait plus rien dans ce mode.
    if (isPlaying && !zoomUserScrolled) zoomAutoScroll(audioSec)
    checkLoopRebound(audioSec)
  })

  alphaTabApi.playerFinished.on(() => {
    if (!tabMaster) return
    // En média externe la fin du morceau est celle de l'audio : la dernière
    // mesure de la tablature peut tomber bien avant (transcription partielle).
    if (tabExternal) return
    // Mixte avec un score plus court que l'audio : la fin du synthé n'est pas la
    // fin du morceau, c'est la piste audio la plus longue qui la signalera.
    if (audioOutlastsScore()) return
    onFinish()
  })

  // 13.6 — Drag-to-select loop: mousedown → drag → mouseup
  alphaTabApi.beatMouseDown.on(beat => {
    if (tabState === 'collapsed') return
    tabDragBeat = beat
    alphaTabApi.highlightPlaybackRange(beat, beat)
  })

  alphaTabApi.beatMouseMove.on(beat => {
    if (!tabDragBeat || tabState === 'collapsed') return
    const [s, e] = tabDragBeat.absolutePlaybackStart <= beat.absolutePlaybackStart
      ? [tabDragBeat, beat] : [beat, tabDragBeat]
    alphaTabApi.highlightPlaybackRange(s, e)
  })

  alphaTabApi.beatMouseUp.on(beat => {
    if (!tabDragBeat || tabState === 'collapsed') { tabDragBeat = null; return }
    const endBeat = beat ?? tabDragBeat
    alphaTabApi.clearPlaybackRangeHighlight()

    const [startBeat, lastBeat] = tabDragBeat.absolutePlaybackStart <= endBeat.absolutePlaybackStart
      ? [tabDragBeat, endBeat] : [endBeat, tabDragBeat]

    const loopStart = tickToAudioSec(startBeat.absolutePlaybackStart)
    const loopEnd   = tickToAudioSec(lastBeat.absolutePlaybackStart + lastBeat.playbackDuration)
    const singleBeat = startBeat === lastBeat
    tabDragBeat = null

    // Clic simple sur une note : on place la tête de lecture à son attaque.
    // Boucler sur une seule note n'a aucun usage musical, alors que reprendre
    // la lecture depuis un endroit précis de la partition en a un constamment.
    // La boucle éventuellement en place n'est pas touchée : seul le glisser,
    // qui désigne une plage, la redéfinit.
    if (singleBeat) {
      performSeek(loopStart)
      return
    }

    if (loopEnd - loopStart < 0.05) return
    syncRegionToAll(loopStart, loopEnd)
    setLoopEnabled(true)
  })

  alphaTabApi.load(preloadedScore ?? tabUrl)
  startTabSync()
}

// 20.8 — Fil d'Ariane du player
function renderPlayerBreadcrumb() {
  const nav = document.getElementById('player-breadcrumb')
  if (!nav) return

  const parentPath = grooveSlug.includes('/')
    ? grooveSlug.split('/').slice(0, -1).join('/')
    : ''
  const backBtn = document.getElementById('back-btn')
  if (backBtn) backBtn.href = parentPath ? `/?path=${encodePath(parentPath)}` : '/'

  const home = document.createElement('a')
  home.href = '/'
  home.className = 'breadcrumb-link'
  home.textContent = 'Accueil'
  nav.appendChild(home)

  if (!grooveSlug) return

  // Le dernier segment est le nom du groove, déjà affiché dans le <h1>
  // Tous les segments parents restent des liens cliquables
  const segments = grooveSlug.split('/').slice(0, -1)
  segments.forEach((seg, i) => {
    const sep = document.createElement('span')
    sep.className = 'breadcrumb-sep'
    sep.textContent = '›'
    nav.appendChild(sep)

    const partialPath = segments.slice(0, i + 1).join('/')
    const link = document.createElement('a')
    link.href = `/?path=${encodePath(partialPath)}`
    link.className = 'breadcrumb-link'
    link.textContent = seg.replace(/_/g, ' ')
    nav.appendChild(link)
  })
}

// 30.3 — Chargement du mix (tracks uniquement) avec indicateur de source
async function loadMixTracks(tracks) {
  try {
    const res = await fetch(`/api/mix/${encodePath(grooveSlug)}`)
    if (!res.ok) return
    const mix = await res.json()

    if (mix.tracks && typeof mix.tracks === 'object') {
      tracks.forEach((track, i) => {
        const entry = mix.tracks[track.filename]
        let vol = null, pan = null
        if (entry && typeof entry === 'object') {
          // New format: { volume: 80, pan: -0.4 }
          if (typeof entry.volume === 'number') vol = entry.volume
          if (typeof entry.pan    === 'number') pan = entry.pan
        } else if (typeof entry === 'number') {
          // Legacy format: plain volume number
          vol = entry
        }
        if (vol !== null) {
          trackStates[i].volume = vol / 100
          volSliders[i].value = String(vol)
        }
        if (pan !== null) {
          setPan(i, pan)
        }
      })
      applyVolumes()
    }
  } catch { /* chargement silencieux */ }
}

// 30.3 — Chargement du loop (groove-level uniquement)
async function loadLoop() {
  try {
    const res = await fetch(`/api/loop/${encodePath(grooveSlug)}`)
    if (!res.ok) return
    const loop = await res.json()
    // 35.6 — bornes musicales : conversion différée (score pas encore chargé)
    if (loop && typeof loop.in === 'object' && loop.in !== null &&
        typeof loop.out === 'object' && loop.out !== null) {
      pendingBbtLoop = { in: loop.in, out: loop.out }
      if (tabScore) applyPendingBbtLoop()
      else warnBbtLoopUnavailable()
      return
    }
    if (loop && typeof loop.in === 'number' && typeof loop.out === 'number') {
      pendingLoop = { in: loop.in, out: loop.out }
      // Si toutes les waveforms sont déjà prêtes avant que le fetch revienne
      if (wavesurfers.length > 0 && trackDurations.filter(d => d > 0).length === wavesurfers.length) {
        syncRegionToAll(pendingLoop.in, pendingLoop.out)
        pendingLoop = null
      }
    }
  } catch { /* chargement silencieux */ }
}

// 35.6 — Une boucle en mesure:temps n'a de sens qu'avec le score : sans
// tablature (mobile, fichier GP absent ou illisible) elle est ignorée — le dire
// plutôt que de la faire disparaître en silence.
function warnBbtLoopUnavailable() {
  if (!pendingBbtLoop || tabWillLoad) return
  console.warn('[loop] boucle enregistrée en mesure:temps ignorée : tablature indisponible')
  loopInEl.title = loopOutEl.title =
    'Boucle enregistrée en mesure:temps — indisponible sans la tablature'
}

// 35.6 — Convertit la boucle BBT de loop.json en secondes, une fois le score là
function applyPendingBbtLoop() {
  if (!pendingBbtLoop || !tabScore) return
  const { in: bIn, out: bOut } = pendingBbtLoop
  pendingBbtLoop = null
  const inSec  = barBeatToSec((bIn.bar | 0) - 1, (bIn.beat | 0) - 1)
  const outSec = barBeatToSec((bOut.bar | 0) - 1, (bOut.beat | 0) - 1)
  if (!(outSec > inSec)) return
  const allReady = wavesurfers.length > 0 &&
    trackDurations.filter(d => d > 0).length === wavesurfers.length
  if (allReady || wavesurfers.length === 0) syncRegionToAll(inSec, outSec)
  else pendingLoop = { in: inSec, out: outSec }
}

// 30.3 — Chargement des marqueurs (groove-level uniquement)
async function loadMarkers() {
  try {
    const res = await fetch(`/api/markers/${encodePath(grooveSlug)}`)
    if (!res.ok) return
    const data = await res.json()
    // Epic 17 — charger les marqueurs (rendu différé dans adjustTrackWidths)
    if (Array.isArray(data) && data.length > 0) {
      markers = data
        .filter(m => typeof m.in === 'number' && typeof m.out === 'number' && m.out > m.in)
        .map(m => ({
          id:    nextMarkerId(),
          start: m.in,
          end:   m.out,
          label: String(m.label ?? ''),
        }))
    }
  } catch { /* chargement silencieux */ }
}

// 30.3 — Charge mix + loop + markers en parallèle
// ── Epic 38 — Téléchargement (pistes séparées / mix stéréo) ────────────────

const DOWNLOAD_LABELS = {
  zip:  'Pistes séparées (zip)',
  mp3:  'Mix stéréo (MP3)',
  flac: 'Mix stéréo (FLAC)',
  wav:  'Mix stéréo (WAV)',
}

let downloadBusy = false
let downloadStatusTimer = null

// 38.1 — Menu déroulant : ouverture/fermeture, clic extérieur, Échap
// Le zip serveur contient toujours quelque chose (les pistes audio, le fichier
// Guitar Pro, ou les deux). Les exports de mix, eux, demandent de l'audio
// décodable : en tab-only sans backing track, audibleTracks() est vide et tout
// rendu échouerait — les entrées correspondantes restent masquées.
function setMixDownloadsAvailable(available) {
  downloadMenu.querySelectorAll('.download-menu-item:not([data-format="zip"])')
    .forEach(el => el.closest('li')?.toggleAttribute('hidden', !available))
}

let downloadMenuReady = false
function initDownloadMenu() {
  if (downloadMenuReady) return
  downloadMenuReady = true
  downloadWrap.removeAttribute('hidden')
  setMixDownloadsAvailable(currentTracks.length > 0)

  btnDownloadAll.addEventListener('click', (e) => {
    e.stopPropagation()
    if (downloadMenu.hasAttribute('hidden')) openDownloadMenu()
    else closeDownloadMenu()
  })

  downloadMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.download-menu-item')
    if (!item || item.disabled) return
    const format = item.dataset.format
    if (format === 'zip') {
      closeDownloadMenu()
      downloadTracksZip()
    } else {
      downloadMixFile(format, item)
    }
  })

  document.addEventListener('click', (e) => {
    if (!downloadWrap.contains(e.target)) closeDownloadMenu()
  })

  // Navigation clavier du menu. Le handler global (espace, Échap, flèches) se retire
  // dès que le menu est ouvert : voir isDownloadMenuOpen() dans les raccourcis.
  downloadWrap.addEventListener('keydown', (e) => {
    if (!isDownloadMenuOpen()) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeDownloadMenu()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      moveDownloadMenuFocus(e.key === 'ArrowDown' ? 1 : -1)
    }
  })

  // Échap hors du menu (focus ailleurs dans la page) le ferme aussi.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isDownloadMenuOpen()) return
    if (downloadWrap.contains(e.target)) return   // déjà traité ci-dessus
    e.preventDefault()
    e.stopPropagation()
    closeDownloadMenu()
  })
}

function isDownloadMenuOpen() {
  return !!downloadMenu && !downloadMenu.hasAttribute('hidden')
}

function downloadMenuItems() {
  return [...downloadMenu.querySelectorAll('.download-menu-item:not([disabled])')]
}

// Flèches haut/bas : déplacement circulaire du focus entre les entrées du menu.
function moveDownloadMenuFocus(delta) {
  const items = downloadMenuItems()
  if (!items.length) return
  const current = items.indexOf(document.activeElement)
  const next = current === -1
    ? (delta > 0 ? 0 : items.length - 1)
    : (current + delta + items.length) % items.length
  items[next].focus()
}

function openDownloadMenu() {
  downloadMenu.removeAttribute('hidden')
  btnDownloadAll.setAttribute('aria-expanded', 'true')
  hideDownloadStatus()
  downloadMenuItems()[0]?.focus()
}

function closeDownloadMenu() {
  if (downloadBusy) return   // un rendu est en cours : le menu reste visible
  // Ne pas laisser le focus sur une entrée qui disparaît.
  const focusWasInside = downloadWrap.contains(document.activeElement)
  downloadMenu.setAttribute('hidden', '')
  btnDownloadAll.setAttribute('aria-expanded', 'false')
  if (focusWasInside) btnDownloadAll.focus()
}

// 38.4 — Message discret sous le bouton (atténuation, erreur)
function showDownloadStatus(msg, isError) {
  clearTimeout(downloadStatusTimer)
  downloadStatusEl.textContent = msg
  downloadStatusEl.classList.toggle('error', !!isError)
  downloadStatusEl.removeAttribute('hidden')
  downloadStatusTimer = setTimeout(hideDownloadStatus, isError ? 8000 : 6000)
}

function hideDownloadStatus() {
  clearTimeout(downloadStatusTimer)
  downloadStatusEl.setAttribute('hidden', '')
  downloadStatusEl.textContent = ''
}

// Epic 09 — Téléchargement des pistes séparées (comportement d'origine)
function downloadTracksZip() {
  btnDownloadAll.disabled = true
  btnDownloadAll.textContent = 'Préparation…'
  const a = document.createElement('a')
  a.href = `/api/grooves/${encodePath(grooveSlug)}/download`
  a.download = `${grooveSlug.split('/').pop()}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => {
    btnDownloadAll.disabled = false
    btnDownloadAll.textContent = '↓ Tout télécharger'
  }, 2000)
}

// 38.2 — Pistes audibles avec leurs réglages courants (mémoire, pas mix.json).
// Même règle que applyVolumes() : le solo l'emporte sur le mute.
// Toutes les lignes audio sont prises, backing track embarqué compris (il est
// audible, il doit être dans l'export). Les pistes MIDI, elles, sont rendues par
// le synthétiseur d'AlphaTab et restent hors de l'export.
function audibleTracks() {
  const anySolo = anySoloActive()
  return trackStates.map((s, i) => {
    const volume = anySolo ? (s.soloed ? s.volume : 0) : (s.muted ? 0 : s.volume)
    // Le pan n'est audible que si le routage Web Audio a abouti ; sinon le player
    // se rabat sur ws.setVolume() et n'applique aucun pan. L'export doit rendre ce
    // que l'on entend, donc pan neutre dans ce cas.
    const pan = webAudioRouted[i] ? (panNodes[i]?.pan.value ?? 0) : 0
    return { url: trackSourceUrls[i], volume, pan }
  }).filter(t => t.url && t.volume > 0)
}

// 38.2 à 38.6 — Rendu du mix, encodage et téléchargement
async function downloadMixFile(format, item) {
  if (downloadBusy) return
  downloadBusy = true
  pauseAll()
  hideDownloadStatus()

  const items = [...downloadMenu.querySelectorAll('.download-menu-item')]
  items.forEach(el => { el.disabled = true })
  btnDownloadAll.disabled = true
  const setStep = (label) => { item.textContent = label }
  setStep('Rendu…')

  let notice = null
  let isError = false
  try {
    const { attenuationDb } = await exportMix({
      tracks: audibleTracks(),
      format,
      baseName: `${grooveSlug.split('/').pop()}-mix`,
      onProgress: (step) => {
        if (step === 'decode') setStep('Lecture des pistes…')
        else if (step === 'render') setStep('Rendu…')
        else if (step === 'encode') setStep('Encodage…')
      },
    })
    if (attenuationDb < 0) {
      const db = Math.abs(attenuationDb).toFixed(1).replace('.', ',')
      notice = `Mix atténué de −${db} dB pour éviter la saturation`
    }
  } catch (err) {
    console.error('[mix-export]', err)
    notice = `Export impossible : ${err.message}`
    isError = true
  } finally {
    items.forEach(el => { el.disabled = false })
    btnDownloadAll.disabled = false
    item.textContent = DOWNLOAD_LABELS[format]
    downloadBusy = false
    closeDownloadMenu()
    if (notice) showDownloadStatus(notice, isError)
  }
}

async function loadMix(tracks) {
  await Promise.all([
    loadMixTracks(tracks),
    loadLoop(),
    loadMarkers(),
  ])
}

// 30.3 — Sauvegarde du mix courant (tracks uniquement) — ne touche jamais au parent
async function saveMixTracks() {
  const mixData = { tracks: {} }
  currentTracks.forEach((track, i) => {
    mixData.tracks[track.filename] = {
      volume: Math.round(trackStates[i].volume * 100),
      pan:    Math.round((panKnobs[i]?.getValue() ?? 0) * 100) / 100,
    }
  })
  try {
    const res = await fetch(`/api/mix/${encodePath(grooveSlug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mixData),
    })
    return res.ok
  } catch {
    return false
  }
}

// 30.3 — Sauvegarde du loop courant
// Si le loop est absent (null), envoie {} pour effacer le loop.json existant
async function saveLoop() {
  // 35.6 — boucle définie en mode BBT : stockée en { bar, beat } 1-indexés
  const toBound = (sec) => {
    if (!bbtEnabled()) return sec
    const bb = tickToBarBeat(audioSecToTick(sec))
    return bb ? { bar: bb.bar + 1, beat: bb.beat + 1 } : sec
  }
  const body = (activeLoopIn === null || activeLoopOut === null)
    ? {}
    : { in: toBound(activeLoopIn), out: toBound(activeLoopOut) }
  try {
    const res = await fetch(`/api/loop/${encodePath(grooveSlug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

// 30.3 — Sauvegarde des marqueurs courants
async function saveMarkers() {
  const markersData = markers.map(({ start, end, label }) => ({ in: start, out: end, label }))
  try {
    const res = await fetch(`/api/markers/${encodePath(grooveSlug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(markersData),
    })
    return res.ok
  } catch {
    return false
  }
}

// 30.3 — Sauvegarde complète : mix + loop + markers en parallèle
// Crée un mix.json local dans le groove (le parent n'est jamais modifié)
async function saveMix() {
  const results = await Promise.all([
    saveMixTracks(),
    saveLoop(),
    saveMarkers(),
  ])
  const ok = results.every(Boolean)
  return ok
}

// 20.8 — Voisins restreints au dossier courant du groove
async function fetchNeighbours() {
  try {
    const parentPath = grooveSlug.includes('/')
      ? grooveSlug.split('/').slice(0, -1).join('/')
      : ''
    const url = parentPath ? `/api/grooves?path=${encodeURIComponent(parentPath)}` : '/api/grooves'
    const res = await fetch(url)
    if (!res.ok) return
    const items = await res.json()
    const grooves = items.filter(g => g.type === 'groove')
    const idx = grooves.findIndex(g => g.path === grooveSlug)
    if (idx === -1) return
    prevSlug = idx > 0 ? grooves[idx - 1].path : null
    nextSlug = idx < grooves.length - 1 ? grooves[idx + 1].path : null
  } catch {
    // fetch échoue silencieusement — boutons restent disabled
  }
  btnPrev.disabled = prevSlug === null
  btnNext.disabled = nextSlug === null
}

// ── Epic 17 — Marker band implementation ──────────────────────────────────

function laneXToTime(clientX) {
  if (!markerLaneEl || !totalDuration) return 0
  const rect = markerLaneEl.getBoundingClientRect()
  return Math.max(0, Math.min(totalDuration, ((clientX - rect.left) / rect.width) * totalDuration))
}

// Returns the free interval [minStart, maxEnd] at anchorTime, or null if blocked
function creationBoundsForAnchor(anchorTime) {
  const sorted = [...markers].sort((a, b) => a.start - b.start)
  let minStart = 0
  let maxEnd = totalDuration
  for (const m of sorted) {
    if (m.end <= anchorTime)        minStart = Math.max(minStart, m.end)
    else if (m.start >= anchorTime) { maxEnd = Math.min(maxEnd, m.start); break }
    else return null  // anchorTime is inside an existing region
  }
  return { minStart, maxEnd }
}

// Returns [minStart, maxEnd] for moving marker id as a rigid block of given duration
function getMoveBounds(id) {
  const self = markers.find(m => m.id === id)
  if (!self) return { minStart: 0, maxEnd: totalDuration }
  const others = markers.filter(m => m.id !== id).sort((a, b) => a.start - b.start)
  let minStart = 0
  let maxEnd = totalDuration
  for (const m of others) {
    if (m.end <= self.start)       minStart = Math.max(minStart, m.end)
    else if (m.start >= self.end)  { maxEnd = Math.min(maxEnd, m.start); break }
  }
  return { minStart, maxEnd }
}

// Returns [leftBound, rightBound] for resizing edges of marker id
function getResizeBounds(id) {
  const self = markers.find(m => m.id === id)
  if (!self) return { leftBound: 0, rightBound: totalDuration }
  const others = markers.filter(m => m.id !== id).sort((a, b) => a.start - b.start)
  let leftBound = 0
  let rightBound = totalDuration
  for (const m of others) {
    if (m.end <= self.start)       leftBound = Math.max(leftBound, m.end)
    else if (m.start >= self.end)  { rightBound = Math.min(rightBound, m.start); break }
  }
  return { leftBound, rightBound }
}

function updateRegionElPosition(el, marker) {
  if (!totalDuration) return
  const left  = (marker.start / totalDuration) * 100
  const width = ((marker.end - marker.start) / totalDuration) * 100
  el.style.left  = left + '%'
  el.style.width = width + '%'
  el.title = marker.label
  const span = el.querySelector('.marker-region-text')
  if (span) span.textContent = marker.label
  el.classList.toggle('marker-region--selected', isMarkerInSelection(marker))
}

function setupRegionInteraction(el, marker) {
  const edgeL = el.querySelector('.marker-region-edge--left')
  const edgeR = el.querySelector('.marker-region-edge--right')
  let didDrag = false

  // Single click → select region (set IN/OUT) ; Ctrl/Cmd+click → étend la sélection
  el.addEventListener('click', (e) => {
    if (didDrag) return
    const m = markers.find(mk => mk.id === marker.id)
    if (m) selectMarker(m.id, e.ctrlKey || e.metaKey)
  })

  // Double-click → edit label (desktop only)
  el.addEventListener('dblclick', (e) => {
    if (isMobile) return
    e.stopPropagation()
    const m = markers.find(mk => mk.id === marker.id)
    if (m) openPopover(m, el)
  })

  // Body drag → move region
  el.addEventListener('mousedown', (e) => {
    if (isMobile || e.button !== 0) return
    if (e.target === edgeL || e.target === edgeR) return
    e.preventDefault()
    e.stopPropagation()
    didDrag = false
    const startX = e.clientX
    const m = markers.find(mk => mk.id === marker.id)
    if (!m) return
    const duration  = m.end - m.start
    const { minStart, maxEnd } = getMoveBounds(m.id)
    // Décalage entre le début de la région et le point saisi, en secondes.
    // Raisonner en temps absolu (et non en delta d'abscisse écran) rend le
    // déplacement correct quand la vue défile sous un curseur immobile.
    const grabOffset = m.start - laneXToTime(startX)

    const applyMove = (clientX) => {
      const ns = Math.max(minStart, Math.min(laneXToTime(clientX) + grabOffset, maxEnd - duration))
      m.start = ns
      m.end   = ns + duration
      updateRegionElPosition(el, m)
    }
    const edge = startEdgeScroll(applyMove)
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > 3) didDrag = true
      applyMove(ev.clientX)
      edge.update(ev.clientX)
    }
    const onUp = () => {
      edge.stop()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // Update cycle if this is the selected region
      if (isMarkerInSelection(m)) syncRegionToAll(markerSelectionIn, markerSelectionOut)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  })

  // Edge drag → resize
  function setupEdge(edgeEl, isLeft) {
    edgeEl.addEventListener('mousedown', (e) => {
      if (isMobile || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const m = markers.find(mk => mk.id === marker.id)
      if (!m) return
      const { leftBound, rightBound } = getResizeBounds(m.id)

      const applyResize = (clientX) => {
        const t = laneXToTime(clientX)
        if (isLeft) m.start = Math.max(leftBound,  Math.min(t, m.end - 0.1))
        else        m.end   = Math.min(rightBound, Math.max(t, m.start + 0.1))
        updateRegionElPosition(el, m)
      }
      const edge = startEdgeScroll(applyResize)
      const onMove = (ev) => {
        applyResize(ev.clientX)
        edge.update(ev.clientX)
      }
      const onUp = () => {
        edge.stop()
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        if (isMarkerInSelection(m)) syncRegionToAll(markerSelectionIn, markerSelectionOut)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    })
  }
  setupEdge(edgeL, true)
  setupEdge(edgeR, false)

  // Mobile: tap → set cycle
  if (isMobile) {
    el.addEventListener('touchend', (e) => {
      e.preventDefault()
      const m = markers.find(mk => mk.id === marker.id)
      if (m) selectMarker(m.id)
    }, { passive: false })
  }
}

function buildRegionEl(marker) {
  const el = document.createElement('div')
  el.className = 'marker-region'
  el.dataset.markerId = marker.id

  const edgeL = document.createElement('div')
  edgeL.className = 'marker-region-edge marker-region-edge--left'

  const labelDiv = document.createElement('div')
  labelDiv.className = 'marker-region-label'
  const span = document.createElement('span')
  span.className = 'marker-region-text'
  span.textContent = marker.label
  labelDiv.appendChild(span)

  const edgeR = document.createElement('div')
  edgeR.className = 'marker-region-edge marker-region-edge--right'

  el.append(edgeL, labelDiv, edgeR)
  updateRegionElPosition(el, marker)
  setupRegionInteraction(el, marker)
  return el
}

function renderMarkers() {
  if (!markerLaneEl || !totalDuration) return
  markerLaneEl.querySelectorAll('.marker-region').forEach(el => el.remove())
  for (const m of markers) {
    markerLaneEl.appendChild(buildRegionEl(m))
  }
}

function refreshMarkerSelectionVisual() {
  markerLaneEl?.querySelectorAll('.marker-region').forEach(el => {
    const m = markers.find(mk => mk.id === el.dataset.markerId)
    if (m) el.classList.toggle('marker-region--selected', isMarkerInSelection(m))
  })
}

function selectMarker(id, extend = false) {
  const m = markers.find(mk => mk.id === id)
  if (!m) return

  if (extend && markerSelectionIn !== null) {
    const touchesRight = Math.abs(m.start - markerSelectionOut) < MARKER_EPS
    const touchesLeft  = Math.abs(m.end   - markerSelectionIn)  < MARKER_EPS
    if (touchesRight || touchesLeft) {
      // Extension contigüe
      markerSelectionIn  = Math.min(markerSelectionIn,  m.start)
      markerSelectionOut = Math.max(markerSelectionOut, m.end)
    } else {
      // Pas contigu → nouvelle sélection simple
      markerAnchorId    = id
      markerSelectionIn  = m.start
      markerSelectionOut = m.end
    }
  } else {
    markerAnchorId    = id
    markerSelectionIn  = m.start
    markerSelectionOut = m.end
  }

  refreshMarkerSelectionVisual()
  syncRegionToAll(markerSelectionIn, markerSelectionOut)
}

function openPopover(marker, regionEl) {
  if (!markerPopoverEl) return
  // Close any open popover (fires commit on previous input via onblur)
  if (!markerPopoverEl.hasAttribute('hidden')) closePopover()

  const input   = markerPopoverEl.querySelector('.marker-popover-input')
  const datalist = markerPopoverEl.querySelector('#marker-label-suggestions')
  const delBtn  = markerPopoverEl.querySelector('.marker-popover-delete')

  input.value = marker.label
  // Autosuggestion: labels already used in this groove (excluding current)
  const suggestions = [...new Set(markers.filter(m => m.id !== marker.id && m.label).map(m => m.label))]
  datalist.innerHTML = ''
  suggestions.forEach(s => {
    const opt = document.createElement('option')
    opt.value = s
    datalist.appendChild(opt)
  })

  // Position near region
  const rect = regionEl.getBoundingClientRect()
  markerPopoverEl.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 220)) + 'px'
  markerPopoverEl.style.top  = (rect.bottom + 4) + 'px'
  markerPopoverEl.removeAttribute('hidden')
  input.focus()
  input.select()

  const commit = () => {
    const m = markers.find(mk => mk.id === marker.id)
    if (m) {
      m.label = input.value.trim()
      const el = markerLaneEl?.querySelector(`[data-marker-id="${m.id}"]`)
      if (el) updateRegionElPosition(el, m)
    }
    closePopover()
  }

  input.onkeydown = (e) => {
    if (e.key === 'Enter')  { commit(); e.preventDefault() }
    if (e.key === 'Escape') { closePopover(); e.preventDefault() }
  }
  // Delay blur so delete-button click fires first
  input.onblur = () => setTimeout(commit, 150)

  delBtn.onclick = () => {
    const idx = markers.findIndex(mk => mk.id === marker.id)
    if (idx !== -1) markers.splice(idx, 1)
    if (isMarkerInSelection(marker)) {
      markerAnchorId = null
      markerSelectionIn = null
      markerSelectionOut = null
      clearLoop()
    }
    const el = markerLaneEl?.querySelector(`[data-marker-id="${marker.id}"]`)
    el?.remove()
    // Prevent the blur-commit from re-running after we close
    input.onblur = null
    closePopover()
  }
}

function closePopover() {
  if (!markerPopoverEl) return
  markerPopoverEl.setAttribute('hidden', '')
  const input  = markerPopoverEl.querySelector('.marker-popover-input')
  const delBtn = markerPopoverEl.querySelector('.marker-popover-delete')
  if (input)  { input.onkeydown = null; input.onblur = null }
  if (delBtn) delBtn.onclick = null
}

function setupLaneDragCreate() {
  if (!markerLaneEl || isMobile) return

  markerLaneEl.addEventListener('mousedown', (e) => {
    // Only fire on the lane itself (not on existing regions)
    if (e.target !== markerLaneEl) return
    if (e.button !== 0) return
    if (!totalDuration) return
    e.preventDefault()

    const anchorTime = laneXToTime(e.clientX)
    const bounds = creationBoundsForAnchor(anchorTime)
    if (!bounds) return  // anchorTime is inside an existing region

    let ghost = document.createElement('div')
    ghost.className = 'marker-lane-ghost'
    ghost.style.left  = ((anchorTime / totalDuration) * 100) + '%'
    ghost.style.width = '0%'
    markerLaneEl.appendChild(ghost)

    const applyGhost = (clientX) => {
      const cur = laneXToTime(clientX)
      const s   = Math.max(bounds.minStart, Math.min(anchorTime, cur))
      const end = Math.min(bounds.maxEnd,   Math.max(anchorTime, cur))
      if (!ghost) return
      ghost.style.left  = ((s / totalDuration) * 100) + '%'
      ghost.style.width = (((end - s) / totalDuration) * 100) + '%'
    }
    const edge = startEdgeScroll(applyGhost)
    const onMove = (ev) => {
      applyGhost(ev.clientX)
      edge.update(ev.clientX)
    }

    const onUp = (ev) => {
      edge.stop()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      ghost.remove()
      ghost = null

      const cur   = laneXToTime(ev.clientX)
      const start = Math.max(bounds.minStart, Math.min(anchorTime, cur))
      const end   = Math.min(bounds.maxEnd,   Math.max(anchorTime, cur))
      if (end - start < 0.1) return  // too small → ignore

      const id = nextMarkerId()
      const m  = { id, start, end, label: '' }
      markers.push(m)
      const el = buildRegionEl(m)
      markerLaneEl.appendChild(el)

      selectMarker(id)
      openPopover(m, el)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  })
}

function initMarkerLane() {
  // Build singleton popover
  markerPopoverEl = document.createElement('div')
  markerPopoverEl.className = 'marker-popover'
  markerPopoverEl.setAttribute('hidden', '')
  markerPopoverEl.innerHTML = `
    <input type="text" class="marker-popover-input" placeholder="Label…" list="marker-label-suggestions" autocomplete="off">
    <datalist id="marker-label-suggestions"></datalist>
    <button class="marker-popover-delete" title="Supprimer la région">×</button>
  `
  document.body.appendChild(markerPopoverEl)
  setupLaneDragCreate()
}

// Points d'ancrage du transport : début, marqueurs, et bornes de la boucle
// quand elle est active. Trie croissant, doublons écartés.
function transportAnchors() {
  const pts = [0, totalDuration]
  markers.forEach(m => pts.push(m.start))
  if (loopEnabled && activeLoopIn !== null && activeLoopOut !== null) {
    pts.push(activeLoopIn, activeLoopOut)
  }
  return [...new Set(pts.filter(p => Number.isFinite(p) && p >= 0))]
    .sort((a, b) => a - b)
}

// Navigate to the previous/next anchor from current playhead (17.6)
// Toujours un repli sur 0 / fin : le transport ne doit jamais rester coincé
// sur une boucle, même désactivée ou supprimée.
function navigatePrevMarker() {
  const cur  = currentTimeSec()
  const prev = transportAnchors().filter(p => p < cur - 0.05).pop()
  performSeek(prev ?? 0)
  return true
}

function navigateNextMarker() {
  const cur  = currentTimeSec()
  const next = transportAnchors().find(p => p > cur + 0.05)
  performSeek(next ?? totalDuration)
  return true
}

// ── Epic 22 — Comments implementation ────────────────────────────────────

// ── API helpers ─────────────────────────────────────────────────────────
async function fetchComments() {
  try {
    const res = await fetch(`/api/comments/${encodePath(grooveSlug)}`)
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

async function apiCreateComment(position, text, authorName) {
  const res = await fetch(`/api/comments/${encodePath(grooveSlug)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position, text, authorName }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function apiUpdateComment(id, text) {
  const res = await fetch(`/api/comments/${encodePath(grooveSlug)}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function apiDeleteComment(id) {
  const res = await fetch(`/api/comments/${encodePath(grooveSlug)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function apiAddReply(id, text, authorName) {
  const res = await fetch(`/api/comments/${encodePath(grooveSlug)}/${encodeURIComponent(id)}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, authorName }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ── Badge transport ──────────────────────────────────────────────────────
function updateCommentBadge() {
  const total = currentComments.length
  if (total === 0) {
    commentBadgeEl.setAttribute('hidden', '')
    btnToggleComments.classList.remove('active')
    return
  }
  const seen = getSeenIds()
  // 37.2 — les réponses non vues comptent dans l'état non-lu
  const hasUnseen = currentComments.some(c => !isDiscussionSeen(c, seen))
  commentBadgeEl.textContent = String(total)
  commentBadgeEl.removeAttribute('hidden')
  commentBadgeEl.classList.toggle('comment-badge--unseen', hasUnseen)
  btnToggleComments.classList.toggle('active', commentsVisible)
}

// ── Rendu des marqueurs de commentaires ──────────────────────────────────
function renderCommentMarkers() {
  if (!commentMarkersLaneEl || !totalDuration) return

  // Effacer la lane triangles
  commentMarkersLaneEl.innerHTML = ''

  // Effacer les lignes verticales dans chaque track-wave
  waveEls.forEach(el => {
    el.querySelectorAll('.comment-line').forEach(l => l.remove())
  })

  if (!commentsVisible) return

  const seen = getSeenIds()

  for (const comment of currentComments) {
    if (comment.position > totalDuration) continue
    const leftPct = (comment.position / totalDuration) * 100

    // 37.2 — une réponse non vue rend le marqueur non-lu
    const isSeen = isDiscussionSeen(comment, seen)

    // Triangle dans la lane
    const markerEl = document.createElement('div')
    markerEl.className = 'comment-marker' +
      (isSeen ? ' comment-marker--seen' : ' comment-marker--unseen')
    markerEl.style.left = leftPct + '%'
    markerEl.dataset.commentId = comment.id

    const triangle = document.createElement('div')
    triangle.className = 'comment-marker-triangle'
    markerEl.appendChild(triangle)

    markerEl.addEventListener('click', () => openCommentPopover(comment, markerEl))
    commentMarkersLaneEl.appendChild(markerEl)

    // Ligne verticale dans chaque track-wave
    waveEls.forEach(el => {
      const line = document.createElement('div')
      line.className = 'comment-line' + (isSeen ? ' comment-line--seen' : '')
      line.style.left = leftPct + '%'
      line.dataset.commentId = comment.id
      el.appendChild(line)
    })
  }
}

// 22.7 — Animation "déjà consulté" au chargement
function animateSeenComments() {
  if (!commentMarkersLaneEl) return
  const seen = getSeenIds()
  commentMarkersLaneEl.querySelectorAll('.comment-marker--seen').forEach(el => {
    const id = el.dataset.commentId
    if (seen.has(id)) {
      el.classList.add('comment-marker--seen-anim')
      // Retirer la classe après la fin de l'animation pour ne pas boucler
      el.addEventListener('animationend', () => el.classList.remove('comment-marker--seen-anim'), { once: true })
    }
  })
}

// ── Popover commentaire ──────────────────────────────────────────────────
function closeCommentPopover() {
  activeCommentId = null
  commentPopoverEl.setAttribute('hidden', '')
  cpReplyInput.value = ''
  cpActions.innerHTML = ''
  cpActions.setAttribute('hidden', '')
  // Remettre le texte en mode lecture (annuler édition éventuelle)
  const editArea = commentPopoverEl.querySelector('.comment-edit-textarea')
  if (editArea) {
    const textEl = commentPopoverEl.querySelector('#cp-text')
    if (textEl) textEl.removeAttribute('hidden')
    editArea.remove()
  }
}

function renderReplies(replies) {
  cpReplies.innerHTML = ''
  if (!replies?.length) return
  for (const reply of replies) {
    const item = document.createElement('div')
    item.className = 'comment-reply'

    const ini = document.createElement('div')
    ini.className = 'comment-reply-initials'
    ini.textContent = initials(displayAuthor(reply))

    const body = document.createElement('div')
    body.className = 'comment-reply-body'

    const auth = document.createElement('span')
    auth.className = 'comment-reply-author'
    auth.textContent = displayAuthor(reply) + ' '

    const txt = document.createElement('span')
    txt.className = 'comment-reply-text'
    txt.textContent = reply.text

    const date = document.createElement('div')
    date.className = 'comment-reply-date'
    date.textContent = formatRelativeDate(reply.createdAt)

    body.append(auth, txt, date)
    item.append(ini, body)
    cpReplies.appendChild(item)
  }
}

function openCommentPopover(comment, anchorEl, autoEdit = false) {
  // Seek à la position du commentaire
  performSeek(comment.position)

  // Marquer comme vu — 37.2 : le racine ET les réponses affichées
  markCommentsSeen([comment.id, ...(comment.replies || []).map(r => r.id)])
  activeCommentId = comment.id

  // Mettre à jour le visuel du marqueur (vu)
  const markerEl = commentMarkersLaneEl?.querySelector(`[data-comment-id="${comment.id}"]`)
  if (markerEl) {
    markerEl.classList.remove('comment-marker--unseen')
    markerEl.classList.add('comment-marker--seen')
    markerEl.querySelector('.comment-marker-triangle').style.removeProperty('animation')
  }
  waveEls.forEach(el => {
    el.querySelector(`.comment-line[data-comment-id="${comment.id}"]`)
      ?.classList.add('comment-line--seen')
  })

  // Remplir le popover — 37.5 : nom de rédacteur en priorité
  cpInitials.textContent = initials(displayAuthor(comment))
  cpAuthor.textContent = displayAuthor(comment)
  cpPos.textContent = formatCommentPosition(comment.position)
  cpText.textContent = comment.text
  cpText.removeAttribute('hidden')
  cpDate.textContent = formatRelativeDate(comment.createdAt)
  renderReplies(comment.replies)

  // Actions auteur — 37.5 : même rédacteur (ou admin) uniquement
  cpActions.innerHTML = ''
  if (canManageComment(comment)) {
    cpActions.removeAttribute('hidden')

    const editBtn = document.createElement('button')
    editBtn.className = 'comment-popover-btn'
    editBtn.textContent = 'Modifier'
    editBtn.addEventListener('click', () => {
      editBtn.setAttribute('hidden', '')
      delBtn.setAttribute('hidden', '')

      cpText.setAttribute('hidden', '')
      const area = document.createElement('textarea')
      area.className = 'comment-edit-textarea'
      area.value = comment.text
      area.rows = 3
      cpText.parentNode.insertBefore(area, cpText)
      area.focus()

      const exitEdit = () => {
        area.remove()
        saveBtn.remove()
        cpText.removeAttribute('hidden')
        editBtn.removeAttribute('hidden')
        delBtn.removeAttribute('hidden')
      }

      const saveBtn = document.createElement('button')
      saveBtn.className = 'comment-popover-btn'
      saveBtn.textContent = 'Sauvegarder'
      saveBtn.addEventListener('click', async () => {
        const newText = area.value.trim()
        if (!newText) return
        saveBtn.disabled = true
        try {
          const updated = await apiUpdateComment(comment.id, newText)
          comment.text = updated.text
          comment.updatedAt = updated.updatedAt
          cpText.textContent = updated.text
          exitEdit()
        } catch {
          saveBtn.textContent = 'Erreur ✗'
          saveBtn.disabled = false
        }
      })

      area.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); exitEdit() }
      })

      cpActions.appendChild(saveBtn)
    })

    const delBtn = document.createElement('button')
    delBtn.className = 'comment-popover-btn comment-popover-btn--danger'
    delBtn.textContent = 'Supprimer'
    delBtn.addEventListener('click', async () => {
      delBtn.disabled = true
      try {
        await apiDeleteComment(comment.id)
        currentComments = currentComments.filter(c => c.id !== comment.id)
        renderCommentMarkers()
        updateCommentBadge()
        closeCommentPopover()
      } catch {
        delBtn.disabled = false
        delBtn.textContent = 'Erreur ✗'
      }
    })

    cpActions.append(editBtn, delBtn)
    if (autoEdit) editBtn.click()
  } else {
    cpActions.setAttribute('hidden', '')
  }

  // Positionner le popover près du marqueur
  positionCommentPopover(anchorEl)
  commentPopoverEl.removeAttribute('hidden')

  // Mettre à jour le badge (le commentaire vient d'être vu)
  updateCommentBadge()
}

function positionCommentPopover(anchorEl) {
  const rect = anchorEl.getBoundingClientRect()
  const pw = 280
  const gap = 8
  let left = rect.left + (rect.width / 2) - pw / 2
  left = Math.max(gap, Math.min(left, window.innerWidth - pw - gap))
  const spaceBelow = window.innerHeight - rect.bottom - gap
  let top
  if (spaceBelow >= 200) {
    top = rect.bottom + gap
  } else {
    top = Math.max(gap, rect.top - gap - commentPopoverEl.offsetHeight)
  }
  commentPopoverEl.style.left = left + 'px'
  commentPopoverEl.style.top  = top + 'px'
}

function initCommentPopover() {
  // Bouton fermer
  commentPopoverEl.querySelector('.comment-popover-close').addEventListener('click', closeCommentPopover)

  // Fermer au clic en dehors — 37.5 : sauf clic dans la modal de prénom
  document.addEventListener('mousedown', (e) => {
    if (commentPopoverEl.hasAttribute('hidden')) return
    if (!authorNameBackdrop.hasAttribute('hidden')) return
    if (!commentPopoverEl.contains(e.target) && !e.target.closest('.comment-marker')) {
      closeCommentPopover()
    }
  })

  // Envoyer une réponse
  cpReplySend.addEventListener('click', async () => {
    const text = cpReplyInput.value.trim()
    if (!text || !activeCommentId) return
    // Capturer l'ID avant l'attente : la modal de prénom peut fermer le popover
    const commentId = activeCommentId
    // Désactivé AVANT l'attente : un second clic pendant la modal de prénom
    // écraserait authorNamePromptResolve et gèlerait la première promesse
    cpReplySend.disabled = true
    try {
      // 37.5 — demander le prénom à la première rédaction
      const authorName = await ensureAuthorName()
      if (authorName === null) return
      const reply = await apiAddReply(commentId, text, authorName)
      // 37.2 — sa propre réponse est immédiatement vue
      markCommentSeen(reply.id)
      const comment = currentComments.find(c => c.id === commentId)
      if (comment) {
        comment.replies.push(reply)
        renderReplies(comment.replies)
        cpReplyInput.value = ''
        cpReplies.scrollTop = cpReplies.scrollHeight
      }
    } catch {
      // silent
    } finally {
      cpReplySend.disabled = false
    }
  })

  cpReplyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      cpReplySend.click()
    }
  })
}

// ── Modal de création ────────────────────────────────────────────────────
function openCommentModal() {
  const pos = currentTimeSec()

  // Si un commentaire existe déjà à ce timestamp, passer en modification
  const TOLERANCE = 0.5
  const existing = currentComments.find(c => Math.abs(c.position - pos) < TOLERANCE)
  if (existing) {
    const markerEl = commentMarkersLaneEl?.querySelector(`[data-comment-id="${existing.id}"]`)
    openCommentPopover(existing, markerEl ?? commentMarkersLaneEl, canManageComment(existing))
    return
  }

  commentModalPosition_ = pos
  commentModalPosition.textContent = `Position : ${formatCommentPosition(commentModalPosition_)}`
  commentModalText.value = ''
  updateModalSignature()
  updateModalSubmitState()
  commentModalBackdrop.removeAttribute('hidden')
  commentModalText.focus()
}

// 37.5 — Affiche « signé X · modifier » si le prénom est connu,
// sinon le champ de saisie du prénom (première rédaction).
function updateModalSignature() {
  const name = getAuthorName()
  if (name) {
    commentModalSignedName.textContent = name
    commentModalSigned.removeAttribute('hidden')
    commentModalName.setAttribute('hidden', '')
  } else {
    commentModalSigned.setAttribute('hidden', '')
    commentModalName.value = ''
    commentModalName.removeAttribute('hidden')
  }
}

// L'envoi requiert un texte ET un prénom (connu ou saisi)
function updateModalSubmitState() {
  const hasText = commentModalText.value.trim().length > 0
  const hasName = commentModalName.hasAttribute('hidden')
    ? getAuthorName().length > 0
    : commentModalName.value.trim().length > 0
  commentModalSubmit.disabled = !(hasText && hasName)
}

function closeCommentModal() {
  commentModalBackdrop.setAttribute('hidden', '')
}

function initCommentModal() {
  commentModalText.addEventListener('input', updateModalSubmitState)

  // 37.5 — champ prénom + « signé X · modifier »
  commentModalName.addEventListener('input', updateModalSubmitState)
  commentModalEditName.addEventListener('click', () => {
    commentModalName.value = getAuthorName()
    commentModalSigned.setAttribute('hidden', '')
    commentModalName.removeAttribute('hidden')
    commentModalName.focus()
    commentModalName.select()
    updateModalSubmitState()
  })

  commentModalCancel.addEventListener('click', closeCommentModal)

  commentModalBackdrop.addEventListener('click', (e) => {
    if (e.target === commentModalBackdrop) closeCommentModal()
  })

  commentModalSubmit.addEventListener('click', async () => {
    const text = commentModalText.value.trim()
    if (!text) return
    // 37.5 — mémoriser le prénom saisi avant l'envoi
    if (!commentModalName.hasAttribute('hidden')) {
      const name = commentModalName.value.trim()
      if (!name) return
      setAuthorName(name)
    }
    const authorName = getAuthorName()
    if (!authorName) return
    commentModalSubmit.disabled = true
    try {
      const comment = await apiCreateComment(commentModalPosition_, text, authorName)
      // 37.2 — son propre commentaire est immédiatement vu
      markCommentSeen(comment.id)
      currentComments.push(comment)
      currentComments.sort((a, b) => a.position - b.position)
      renderCommentMarkers()
      updateCommentBadge()
      closeCommentModal()
      // Ouvrir le popover sur le nouveau commentaire
      const newMarkerEl = commentMarkersLaneEl?.querySelector(`[data-comment-id="${comment.id}"]`)
      if (newMarkerEl) openCommentPopover(comment, newMarkerEl)
    } catch {
      commentModalSubmit.textContent = 'Erreur ✗'
      setTimeout(() => {
        commentModalSubmit.textContent = 'Envoyer'
        commentModalSubmit.disabled = false
      }, 2000)
    }
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !commentModalBackdrop.hasAttribute('hidden')) {
      e.stopPropagation()
      closeCommentModal()
    }
  }, { capture: true })
}

// ── Chargement initial + boutons ─────────────────────────────────────────
async function loadComments() {
  currentComments = await fetchComments()
  currentComments.sort((a, b) => a.position - b.position)
  renderCommentMarkers()
  updateCommentBadge()

  // Révéler les boutons dans le transport. C'est le groupe entier qui est
  // masqué, séparateur compris : sans cela il resterait deux « | » collés
  // entre le zoom et le temps quand les commentaires ne sont pas affichés.
  transportCommentsEl?.removeAttribute('hidden')

  // 37.4 — commentaires prêts, pistes peut-être aussi
  commentsLoaded = true
  tryOpenDeepLinkComment()
}

function initCommentControls() {
  btnToggleComments.addEventListener('click', () => {
    commentsVisible = !commentsVisible
    btnToggleComments.classList.toggle('active', commentsVisible)
    btnToggleComments.setAttribute('aria-pressed', String(commentsVisible))
    renderCommentMarkers()
  })

  btnAddComment.addEventListener('click', openCommentModal)

  initCommentPopover()
  initCommentModal()
  initAuthorNamePrompt()  // 37.5
}

// ── Epic 36 — Tags du groove ──────────────────────────────────────────────

const tagsBarEl        = document.getElementById('tags-bar')
const tagsChipsEl      = document.getElementById('tags-chips')
const tagAddInputEl    = document.getElementById('tag-add-input')
const tagSuggestionsEl = document.getElementById('tag-suggestions')
const tagsErrorEl      = document.getElementById('tags-error')

let grooveTags    = []   // tags du groove courant
let tagVocabulary = []   // union des tags de tous les grooves (autocomplétion)
let tagSuggestionIndex = -1
let tagsErrorTimer = null

// Affichage d'un tag : le « # » décoratif vient du CSS (::before), on ne double
// donc pas un « # » initial saisi par l'utilisateur. La valeur stockée reste
// intacte (aucune normalisation), seul le rendu est ajusté.
function displayTag(tag) {
  return tag.startsWith('#') ? tag.slice(1) : tag
}

function showTagsError(message) {
  if (!tagsErrorEl) return
  tagsErrorEl.textContent = message
  tagsErrorEl.removeAttribute('hidden')
  clearTimeout(tagsErrorTimer)
  tagsErrorTimer = setTimeout(() => tagsErrorEl.setAttribute('hidden', ''), 4000)
}

async function loadTagVocabulary() {
  try {
    const res = await fetch('/api/tags-summary')
    if (!res.ok) return
    const summary = await res.json()
    const seen = new Set()
    for (const tags of Object.values(summary)) {
      for (const t of tags) seen.add(t)
    }
    tagVocabulary = [...seen].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
  } catch { /* vocabulaire indisponible : autocomplétion dégradée */ }
}

async function saveTags() {
  try {
    const res = await fetch(`/api/tags/${encodePath(grooveSlug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: grooveTags }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    grooveTags = data.tags ?? grooveTags
    // Rafraîchir le vocabulaire : un tag retiré de son dernier groove
    // disparaît des autocomplétions, un tag créé y entre.
    loadTagVocabulary()
  } catch {
    // Échec de sauvegarde : prévenir et resynchroniser avec l'état serveur
    // pour ne pas afficher des chips que tags.json ne contient pas (pattern
    // « Erreur ✗ » des commentaires, adapté à la barre de tags).
    showTagsError('Sauvegarde des tags impossible')
    try {
      const res = await fetch(`/api/tags/${encodePath(grooveSlug)}`)
      if (res.ok) grooveTags = (await res.json()).tags ?? []
    } catch { /* serveur injoignable : on garde l'état local faute de mieux */ }
  }
  renderTagChips()
}

function renderTagChips() {
  tagsChipsEl.innerHTML = ''
  for (const tag of grooveTags) {
    const chip = document.createElement('span')
    chip.className = 'tag-chip'
    chip.title = `Voir les grooves tagués « ${tag} »`

    const label = document.createElement('span')
    label.className = 'tag-chip-label'
    label.textContent = displayTag(tag)
    chip.appendChild(label)

    const removeBtn = document.createElement('button')
    removeBtn.className = 'tag-chip-x'
    removeBtn.setAttribute('aria-label', `Retirer le tag ${tag}`)
    removeBtn.textContent = '×'
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      grooveTags = grooveTags.filter(t => t !== tag)
      renderTagChips()
      saveTags()
    })
    chip.appendChild(removeBtn)

    // Clic sur le chip (hors croix) : ouvre l'index filtré sur ce tag
    chip.addEventListener('click', () => {
      location.href = `index.html?tags=${encodeURIComponent(tag)}`
    })

    tagsChipsEl.appendChild(chip)
  }
}

function hideTagSuggestions() {
  tagSuggestionsEl.setAttribute('hidden', '')
  tagSuggestionsEl.innerHTML = ''
  tagSuggestionIndex = -1
}

function renderTagSuggestions() {
  const query = tagAddInputEl.value.trim().toLowerCase()
  const matches = query
    ? tagVocabulary.filter(t =>
        t.toLowerCase().includes(query) && !grooveTags.includes(t)
      )
    : []
  if (matches.length === 0) {
    hideTagSuggestions()
    return
  }
  tagSuggestionsEl.innerHTML = ''
  tagSuggestionIndex = -1
  matches.slice(0, 12).forEach(tag => {
    const li = document.createElement('li')
    li.className = 'tag-suggestion'
    li.setAttribute('role', 'option')
    li.dataset.tag = tag // valeur réelle (l'affichage strip un « # » initial)
    li.textContent = displayTag(tag)
    // mousedown pour devancer le blur du champ
    li.addEventListener('mousedown', (e) => {
      e.preventDefault()
      addTag(tag)
    })
    tagSuggestionsEl.appendChild(li)
  })
  tagSuggestionsEl.removeAttribute('hidden')
}

function moveTagSuggestion(delta) {
  const items = Array.from(tagSuggestionsEl.children)
  if (items.length === 0) return
  tagSuggestionIndex = (tagSuggestionIndex + delta + items.length) % items.length
  items.forEach((li, i) => li.classList.toggle('active', i === tagSuggestionIndex))
}

function addTag(tag) {
  const trimmed = tag.trim()
  if (!trimmed) return
  if (!grooveTags.includes(trimmed)) {
    grooveTags.push(trimmed)
    renderTagChips()
    saveTags()
  }
  tagAddInputEl.value = ''
  hideTagSuggestions()
}

async function initTags() {
  // Le GET renvoie { tags: [] } si le fichier est absent : tout échec ici
  // (500 sur tags.json corrompu, réseau…) est une vraie erreur. Dans ce cas
  // on désactive l'édition, sinon le premier ajout ré-écrirait tags.json en
  // écrasant les tags existants.
  let loadFailed = false
  try {
    const [tagsRes] = await Promise.all([
      fetch(`/api/tags/${encodePath(grooveSlug)}`),
      loadTagVocabulary(),
    ])
    if (tagsRes.ok) grooveTags = (await tagsRes.json()).tags ?? []
    else loadFailed = true
  } catch { loadFailed = true }

  renderTagChips()
  tagsBarEl.removeAttribute('hidden')

  if (loadFailed) {
    tagAddInputEl.setAttribute('disabled', '')
    tagAddInputEl.placeholder = 'Tags indisponibles'
    showTagsError('Tags illisibles : édition désactivée')
    return
  }

  tagAddInputEl.addEventListener('input', renderTagSuggestions)

  tagAddInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveTagSuggestion(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveTagSuggestion(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const items = Array.from(tagSuggestionsEl.children)
      if (tagSuggestionIndex >= 0 && items[tagSuggestionIndex]) {
        addTag(items[tagSuggestionIndex].dataset.tag)
      } else {
        // Aucun match sélectionné : création implicite du tag tel que saisi
        addTag(tagAddInputEl.value)
      }
    } else if (e.key === 'Escape') {
      hideTagSuggestions()
    }
  })

  tagAddInputEl.addEventListener('blur', () => {
    // Laisser le mousedown des suggestions s'exécuter avant de fermer
    setTimeout(hideTagSuggestions, 150)
  })
}

async function initNotePanel() {
  const btnNote  = document.getElementById('btn-note')
  const notePanel = document.getElementById('note-panel')
  try {
    const res = await fetch(`/api/grooves/${encodePath(grooveSlug)}/md`)
    if (!res.ok) return
    const { mdContent } = await res.json()
    if (!mdContent) return
    const html = marked.parse(mdContent)
      .replace(/<table>/g, '<div class="table-wrap"><table>')
      .replace(/<\/table>/g, '</table></div>')
    const inner = document.createElement('div')
    inner.className = 'note-panel-inner'
    inner.innerHTML = html
    notePanel.appendChild(inner)
    btnNote.removeAttribute('hidden')
    btnNote.addEventListener('click', () => {
      const open = notePanel.classList.toggle('note-panel--open')
      btnNote.setAttribute('aria-expanded', String(open))
    })
  } catch { /* pas de note */ }
}

async function init() {
  if (!grooveSlug) {
    showFatalError('Aucun groove spécifié.')
    return
  }

  fetchNeighbours()
  renderPlayerBreadcrumb()

  try {
    const res = await fetch(`/api/grooves/${encodePath(grooveSlug)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const groove = await res.json()

    const name = slugToName(grooveSlug)
    titleEl.textContent = name
    document.title = `${name} — Groovotheque`
    setupTitleMarquee()
    initNotePanel()
    initTags()

    // 35.2 — groove « tab-only » : un dossier ne contenant qu'un fichier GP
    // s'ouvre comme un groove à part entière, piloté par AlphaTab.
    const tabOnly = !groove.tracks?.length
    tabWillLoad = !!groove.tabFile && IS_DESKTOP
    if (tabOnly) {
      if (!groove.tabFile) {
        showFatalError('Aucune piste audio dans ce groove.', false)
        return
      }
      if (!IS_DESKTOP) {
        showFatalError('Ce groove ne contient qu\'une tablature — ouvrez-le sur desktop pour la voir.', false)
        return
      }
    } else {
      initLoadBar(groove.tracks.length)
    }
    tracksContainer.removeAttribute('hidden')
    drawerEl.removeAttribute('hidden')
    observeTransportHeight()
    initDrawer()
    initTimeMode()

    // 6.3 — Fetch all cached peaks in parallel before building tracks
    const cachedPeaksArr = await Promise.all(
      (groove.tracks ?? []).map(track => fetchPeaks(grooveSlug, track.filename))
    )

    currentTracks = groove.tracks ?? []
    // Après l'affectation de currentTracks, dont initDownloadMenu() a besoin
    // pour savoir s'il y a de l'audio à mixer.
    initDownloadMenu()
    buildTimelineRow()
    currentTracks.forEach((track, i) => {
      buildTrackRow(track, track.index, cachedPeaksArr[i])
    })

    // Epic 17 — init marker lane (markerLaneEl set during buildTimelineRow)
    initMarkerLane()

    // Epic 22 — init comment controls (UI wiring, always active)
    initCommentControls()

    await loadMix(currentTracks)

    // Epic 22 — charger les commentaires après le mix (rendu différé dans adjustTrackWidths)
    loadComments()

    // 13.1 / 13.3 — Init tablature si fichier GP présent (desktop uniquement)
    if (groove.tabFile && IS_DESKTOP) {
      initTabDrawer(groove.tabFile)
    }

    // 11.4 — Bouton Save Mix visible uniquement pour l'admin
    if (window.CURRENT_USER === 'admin') {
      btnSaveMix.removeAttribute('hidden')
      btnSaveMix.addEventListener('click', async () => {
        btnSaveMix.disabled = true
        const ok = await saveMix()
        btnSaveMix.textContent = ok ? 'Sauvegardé ✓' : 'Erreur ✗'
        setTimeout(() => {
          btnSaveMix.textContent = 'Sauvegarder le mix'
          btnSaveMix.disabled = false
        }, 2000)
      })
    }

    // Reconcile tempo UI with the slider's actual value (covers browser form
    // restoration where slider.value may differ from the HTML default of 100).
    applyTempo(Number(tempoSliderEl.value))

    // ── Transport controls ─────────────────────
    btnPlay.addEventListener('click', () => isPlaying ? pauseAll() : playAll())
    btnStop.addEventListener('click', stopAll)

    // ── Seek bar ───────────────────────────────
    seekBarEl.addEventListener('click', (e) => {
      if (!totalDuration) return
      const rect = seekBarEl.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      performSeek(ratio * totalDuration)
    })

    seekBarEl.addEventListener('touchstart', (e) => {
      if (!totalDuration) return
      e.preventDefault()
      const touch = e.touches[0]
      const rect = seekBarEl.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width))
      performSeek(ratio * totalDuration)
    }, { passive: false })

    // ── Loop button + navigation ───────────────
    btnLoop.addEventListener('click', () => setLoopEnabled(!loopEnabled))
    // Epic 17 — |<< and >>| navigate markers when present, else go to IN/OUT
    btnLoopGoIn.addEventListener('click', navigatePrevMarker)
    btnLoopGoOut.addEventListener('click', navigateNextMarker)
    btnLoopClear.addEventListener('click', clearLoop)

    // ── Zoom horizontal (epic 18) ──────────────
    initZoomControls()
    initZoomScroll()
    initZoomScrollbar()

    // ── Tempo control ──────────────────────────
    tempoSliderEl.addEventListener('input', () => applyTempo(Number(tempoSliderEl.value)))
    tempoSliderEl.addEventListener('dblclick', () => applyTempo(100))
    tempoPresets.forEach(btn => {
      btn.addEventListener('click', () => applyTempo(Number(btn.dataset.value)))
    })

    // ── IN/OUT editable fields ─────────────────
    // loopFieldCommitting prevents the blur event (which fires synchronously
    // after a programmatic .blur() call) from double-invoking commit when
    // the user presses Enter.
    function commitLoopIn() {
      const val = parseLoopPosition(loopInEl.value)
      if (val !== null && activeLoopOut !== null && val < activeLoopOut) {
        syncRegionToAll(val, activeLoopOut)
      } else {
        updateLoopFields() // reset invalid input
      }
    }
    function commitLoopOut() {
      const val = parseLoopPosition(loopOutEl.value)
      if (val !== null && activeLoopIn !== null && val > activeLoopIn) {
        syncRegionToAll(activeLoopIn, val)
      } else {
        updateLoopFields()
      }
    }

    loopInEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        loopFieldCommitting = true
        commitLoopIn()
        loopInEl.blur()
        loopFieldCommitting = false
      }
    })
    loopInEl.addEventListener('blur', () => { if (!loopFieldCommitting) commitLoopIn() })

    loopOutEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        loopFieldCommitting = true
        commitLoopOut()
        loopOutEl.blur()
        loopFieldCommitting = false
      }
    })
    loopOutEl.addEventListener('blur', () => { if (!loopFieldCommitting) commitLoopOut() })

    // ── Keyboard shortcuts ─────────────────────
    document.addEventListener('keydown', (e) => {
      // Skip when user is interacting with any input or textarea element
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      // 38.1 — Menu de téléchargement ouvert : il gère lui-même Échap et les flèches,
      // et Espace doit activer nativement l'entrée focalisée.
      if (isDownloadMenuOpen()) return

      if (e.key === ' ') {
        e.preventDefault()
        isPlaying ? pauseAll() : playAll()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        stopAll()
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        setLoopEnabled(!loopEnabled)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        nudge(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        nudge(1)
      }
    })

  } catch (err) {
    showFatalError(`Erreur de chargement : ${err.message}`)
  }
}

// ── Responsive track widths on resize ─────────────────────────────────────
// adjustTrackWidths() now measures pixel geometry at runtime, so it must be
// called again whenever the layout changes (window resize, orientation change).
;(function initResizeHandler() {
  let resizeTimer
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      // 18.4 — le décalage est en pixels : il doit être repris après un
      // changement de largeur.
      const maxBefore = zoomMaxScrollX()
      const ratio     = maxBefore > 0 ? zoomScrollX / maxBefore : 0
      adjustTrackWidths()
      if (zoomUserScrolled) {
        // L'utilisateur s'est positionné à la main : on conserve la portion
        // qu'il regarde. Sur mobile, l'apparition de la barre d'URL déclenche
        // des resize ; sauter sur la tête à chaque fois serait intenable.
        setZoomScrollX(ratio * zoomMaxScrollX())
      } else {
        ensurePlayheadVisible()
      }
    }, 150)
  }, { passive: true })
})()

init()
