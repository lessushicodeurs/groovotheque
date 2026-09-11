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

// 13.2 — Tab drawer DOM elements
const tabDrawerEl       = document.getElementById('tab-drawer')
const tabHandleEl       = document.getElementById('tab-handle')
const tabContentEl      = document.getElementById('tab-content')
const tabTrackListEl    = document.getElementById('tab-track-list')
const tabLoopControlsEl  = document.getElementById('tab-loop-controls')
const btnTabFullscreen   = document.getElementById('btn-tab-fullscreen')
const btnTabStrip        = document.getElementById('btn-tab-strip')
const btnTabCollapse     = document.getElementById('btn-tab-collapse')
const btnTabLoopClear    = document.getElementById('btn-tab-loop-clear')

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
const waveEls        = []   // .track-wave div per track (for proportional width)
// Source décodable de chaque piste pour l'export (URL serveur, ou URL d'objet
// pour le backing track embarqué dans le fichier GP), null si non exportable.
const trackSourceUrls = []
const trackDurations = []   // duration in seconds per track, set on 'ready'
let timelinePluginRef = null  // TimelinePlugin instance (track 0), for duration correction
let timelineExtEl     = null  // container DOM element for TimelinePlugin (in .timeline-row)
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
let tabSyncRafId   = null
let tabDragBeat    = null  // Beat object — start of drag selection
let tabSyncPoints  = null  // BackingTrackSyncPoint[] from GP sync markers, or null

// 35.1 — AlphaTab master clock
let tabMaster        = false  // true dès qu'un score GP est chargé : AlphaTab pilote le transport
// Le synthé n'avance son horloge qu'une fois la soundfont chargée. Tant que
// playerReady / playerPositionChanged n'ont rien émis, WaveSurfer reste la
// source de temps : sinon un synthé lent ou en échec fige tout le transport.
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
  // 35.1 — AlphaTab suit le même ratio quand il est master clock
  if (alphaTabApi) {
    try { alphaTabApi.playbackSpeed = ratio } catch { /* player pas encore prêt */ }
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
  return trackStates.some(s => s.soloed) || midiTracks.some(t => t.soloed)
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

// 35.1 — L'horloge AlphaTab ne fait autorité que lorsqu'elle avance vraiment,
// ou qu'il n'y a aucune waveform pour prendre le relais (groove tab-only).
function tabClockDrives() {
  return tabMaster && !!alphaTabApi && (tabClockLive || wavesurfers.length === 0)
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
  if (tabClockDrives()) return synthTimeToAudioTime(alphaTabApi.timePosition) / 1000
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
  // Resume Web Audio graph if suspended (requires prior user gesture — satisfied by this click)
  if (sharedAudioCtx.state === 'suspended') await sharedAudioCtx.resume()
  if (loopEnabled && activeLoopIn !== null && activeLoopOut !== null) {
    const cur = currentTimeSec()
    if (cur < activeLoopIn || cur >= activeLoopOut) seekAllTo(activeLoopIn)
  }
  isPlaying = true
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
}

function stopAll() {
  if (tabMaster && alphaTabApi) alphaTabApi.stop()
  wavesurfers.forEach(ws => { ws.pause(); ws.setTime(0) })
  isPlaying = false
  btnPlay.textContent = '▶'
  updateTimeDisplay(0)
}

// Called when any track fires 'finish'. Stops and rewinds all tracks, or loops.
// isPlaying=false is set first so subsequent finish events from other tracks
// (which end at nearly the same time) are blocked by the guard.
function onFinish() {
  if (!isPlaying) return
  isPlaying = false

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
  wavesurfers.forEach(ws => ws.setTime(time))
  if (alphaTabApi && (tabMaster || tabState !== 'collapsed')) {
    alphaTabApi.timePosition = audioTimeToSynthTime(time * 1000)
  }
  if (tabMaster) updateTimeDisplay(time)
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
  const mb  = bars[bb.bar]
  const num = mb.timeSignatureNumerator || 4
  const ticksPerBeat = mb.calculateDuration() / num
  if (!(ticksPerBeat > 0)) return sec
  let bar = bb.bar
  let beat = bb.beat
  if ((tick - mb.start) / ticksPerBeat - beat > 0.5) {
    beat += 1
    if (beat >= num) { beat = 0; bar += 1 }
  }
  if (bar >= bars.length) {
    const last = bars[bars.length - 1]
    return beatTickToAudioTimeSec(last.start + last.calculateDuration())
  }
  return barBeatToSec(bar, beat)
}

function clearLoop() {
  trackRegions.forEach(rp => rp.clearRegions())
  activeLoopIn = null
  activeLoopOut = null
  tabLoopControlsEl?.setAttribute('hidden', '')
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

  // 35.2 — en tab-only il n'y a aucune waveform pour dessiner la région : les
  // contrôles de boucle de la tablature sont le seul retour visuel.
  if (tabScore) tabLoopControlsEl?.removeAttribute('hidden')

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

  const waveCol = document.createElement('div')
  waveCol.className = 'timeline-wave-col'

  timelineExtEl = document.createElement('div')
  timelineExtEl.className = 'track-timeline-ext'

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
  row.append(sidebar, waveCol)
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
  const waveEl = document.createElement('div')
  waveEl.className = 'track-wave'

  row.append(sidebar, waveEl)
  if (opts.insertBefore) tracksContainer.insertBefore(row, opts.insertBefore)
  else                   tracksContainer.appendChild(row)
  waveEls.push(waveEl)

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
    if (alphaTabApi && (tabMaster || tabState !== 'collapsed')) {
      alphaTabApi.timePosition = audioTimeToSynthTime(newTime * 1000)
    }
    if (tabMaster) updateTimeDisplay(newTime)
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
  if (tabScore) scoreDurationSec = beatTickToAudioTimeSec(scoreTotalTicks(tabScore))

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

  waveEls.forEach((el, i) => {
    setWaveWidth(el, (trackDurations[i] ?? maxDur) / maxDur)
  })

  // 35.3 — les aires MIDI couvrent la durée du score, pas celle du groove :
  // sans ce calage elles resteraient pleine largeur en mode mixte et ne
  // s'aligneraient plus avec la timeline BBT ni avec les pistes audio.
  if (scoreDurationSec > 0) {
    midiTracks.forEach(t => setWaveWidth(t.waveEl, scoreDurationSec / maxDur))
  }

  renderBbtTimeline()
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

  // En mode plein écran : contraindre player-main + bloquer scroll page
  if (newState === 'fullscreen') {
    const headerH = document.querySelector('.player-header')?.getBoundingClientRect().height || 60
    const playerH = window.innerHeight - headerH - h
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
  } else {
    tracksEl?.classList.remove('tab-hidden')
  }

  const stateMap = { fullscreen: btnTabFullscreen, strip: btnTabStrip, collapsed: btnTabCollapse }
  ;[btnTabFullscreen, btnTabStrip, btnTabCollapse].forEach(btn => {
    btn?.classList.remove('active')
    btn?.setAttribute('aria-pressed', 'false')
  })
  stateMap[newState]?.classList.add('active')
  stateMap[newState]?.setAttribute('aria-pressed', 'true')

  if (newState === 'collapsed') {
    stopTabSync()
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

// Fin de l'axe « audio » au-delà du dernier point de sync. Avec une waveform de
// référence c'est sa durée ; sans aucune waveform (tab-only) il n'y a pas d'axe
// audio réel : on prolonge le dernier point de sync à l'échelle 1:1, sinon le
// temps se figerait sur tout le dernier segment.
function tailAudioMs(sp0, totalSynthMs) {
  const wsMs = (wavesurfers[0]?.getDuration() ?? 0) * 1000
  if (wsMs > 0) return wsMs
  return sp0.syncTime + Math.max(0, totalSynthMs - sp0.synthTime)
}

// 13.9 — Conversion audio↔synth time using GP sync markers.
// BackingTrackSyncPoint: syncTime=ms in audio, synthTime=ms in score-tempo clock.
// Piecewise-linear interpolation between anchor points.
function audioTimeToSynthTime(audioMs) {
  const sps = tabSyncPoints
  if (!sps || sps.length === 0) return audioMs

  let i = sps.length - 1
  for (let j = 0; j < sps.length - 1; j++) {
    if (audioMs < sps[j + 1].syncTime) { i = j; break }
  }
  const sp0 = sps[i]
  const sp1 = (i + 1 < sps.length) ? sps[i + 1] : null

  if (!sp1) {
    const totalSynthMs  = alphaTabApi?.endTime || sp0.synthTime
    const totalAudioMs  = tailAudioMs(sp0, totalSynthMs)
    const dt = totalAudioMs - sp0.syncTime
    if (dt <= 0) return sp0.synthTime
    return sp0.synthTime + ((audioMs - sp0.syncTime) / dt) * (totalSynthMs - sp0.synthTime)
  }

  const dt = sp1.syncTime - sp0.syncTime
  if (dt <= 0) return sp0.synthTime
  return sp0.synthTime + ((audioMs - sp0.syncTime) / dt) * (sp1.synthTime - sp0.synthTime)
}

// Converts a MIDI tick position to audio seconds using sync points + synthBpm.
function beatTickToAudioTimeSec(tick) {
  const sps = tabSyncPoints
  if (!sps || sps.length === 0) {
    // No sync data: use score tempo directly
    const tempo    = alphaTabApi?.score?.tempo || tabScore?.tempo || 120
    const synthMs  = tick * 60000 / (tempo * 960)
    return synthMs / 1000
  }
  let i = sps.length - 1
  for (let j = 0; j < sps.length - 1; j++) {
    if (tick < sps[j + 1].synthTick) { i = j; break }
  }
  const sp0      = sps[i]
  const bpm      = sp0.synthBpm || alphaTabApi?.score?.tempo || tabScore?.tempo || 98.5
  const deltaTick = tick - sp0.synthTick
  const synthMs  = sp0.synthTime + deltaTick * 60000 / (bpm * 960)
  return synthTimeToAudioTime(synthMs) / 1000
}

function synthTimeToAudioTime(synthMs) {
  const sps = tabSyncPoints
  if (!sps || sps.length === 0) return synthMs

  let i = sps.length - 1
  for (let j = 0; j < sps.length - 1; j++) {
    if (synthMs < sps[j + 1].synthTime) { i = j; break }
  }
  const sp0 = sps[i]
  const sp1 = (i + 1 < sps.length) ? sps[i + 1] : null

  if (!sp1) {
    const totalSynthMs  = alphaTabApi?.endTime || sp0.synthTime
    const totalAudioMs  = tailAudioMs(sp0, totalSynthMs)
    const dt = totalSynthMs - sp0.synthTime
    if (dt <= 0) return sp0.syncTime
    return sp0.syncTime + ((synthMs - sp0.synthTime) / dt) * (totalAudioMs - sp0.syncTime)
  }

  const dt = sp1.synthTime - sp0.synthTime
  if (dt <= 0) return sp0.syncTime
  return sp0.syncTime + ((synthMs - sp0.synthTime) / dt) * (sp1.syncTime - sp0.syncTime)
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

  if (tabState === 'strip') {
    const mx = /translate\((-?[\d.]+)px/.exec(t)
    if (!mx) return
    const contentX = parseFloat(mx[1])
    const W = tabContentEl.clientWidth
    // Curseur fixe à 35% — la partition défile en dessous (téléprompteur)
    const target = Math.max(0, contentX - W * 0.35)
    const diff = target - tabContentEl.scrollLeft
    // Avance normale (≤ 5px/frame) → sync direct ; seek → ease 15%
    tabContentEl.scrollLeft = Math.abs(diff) <= 5 ? target : tabContentEl.scrollLeft + diff * 0.15
  } else if (tabState === 'fullscreen') {
    const my = /translate\(-?[\d.]+px,\s*(-?[\d.]+)px/.exec(t)
    if (!my) return
    const contentY = parseFloat(my[1])
    const H = tabContentEl.clientHeight
    // OffScreen + ease : ne scroll que si curseur sort de la zone lisible (0–80% du viewport)
    const visibleY = contentY - tabContentEl.scrollTop
    if (visibleY > H * 0.8 || visibleY < 0) {
      const target = Math.max(0, contentY - H * 0.25)
      tabContentEl.scrollTop += (target - tabContentEl.scrollTop) * 0.15
    }
  }
}

function startTabSync() {
  if (tabSyncRafId !== null) return
  const loop = () => {
    // 35.1 — AlphaTab est master clock : le RAF ne sert plus qu'au défilement
    // téléprompteur du curseur (plus de push WaveSurfer → AlphaTab).
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

// 35.1 / 35.5 — Repères musicaux du score (masterBars)
// Durée totale du score en ticks MIDI (dernier masterBar + sa durée).
function scoreTotalTicks(score) {
  const bars = score?.masterBars
  if (!bars || bars.length === 0) return 0
  const last = bars[bars.length - 1]
  return last.start + last.calculateDuration()
}

// Temps « synth » (ms) → tick MIDI. Inverse de beatTickToAudioTimeSec.
function synthTimeToTick(synthMs) {
  const sps = tabSyncPoints
  const fallbackBpm = alphaTabApi?.score?.tempo || tabScore?.tempo || 120
  if (!sps || sps.length === 0) return synthMs * fallbackBpm * 960 / 60000

  let i = sps.length - 1
  for (let j = 0; j < sps.length - 1; j++) {
    if (synthMs < sps[j + 1].synthTime) { i = j; break }
  }
  const sp0 = sps[i]
  const bpm = sp0.synthBpm || fallbackBpm
  return sp0.synthTick + (synthMs - sp0.synthTime) * bpm * 960 / 60000
}

function audioSecToTick(sec) {
  return synthTimeToTick(audioTimeToSynthTime(sec * 1000))
}

// Tick MIDI → { bar, beat } 0-indexés (recherche dichotomique sur masterBars)
function tickToBarBeat(tick) {
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

// { bar, beat } 0-indexés → tick MIDI
function barBeatToTick(bar, beat) {
  const bars = tabScore?.masterBars
  if (!bars || bars.length === 0) return 0
  const i = Math.max(0, Math.min(bars.length - 1, bar))
  const mb  = bars[i]
  const num = mb.timeSignatureNumerator || 4
  const ticksPerBeat = mb.calculateDuration() / num
  return mb.start + Math.max(0, Math.min(num - 1, beat)) * ticksPerBeat
}

function barBeatToSec(bar, beat) {
  return beatTickToAudioTimeSec(barBeatToTick(bar, beat))
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
    durationEl.textContent = `${tabScore.masterBars.length} mes.`
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
  const bars    = tabScore.masterBars
  const width   = bbtTimelineEl.getBoundingClientRect().width || 800
  const pxPerBar = width / bars.length
  // Une étiquette tous les N marqueurs pour garder ~36 px entre deux libellés
  const labelStep = Math.max(1, Math.ceil(36 / Math.max(pxPerBar, 1)))

  for (let i = 0; i < bars.length; i++) {
    const sec = beatTickToAudioTimeSec(bars[i].start)
    if (sec > totalDuration) break
    const tick = document.createElement('div')
    tick.className = 'bbt-tick'
    tick.style.left = `${(sec / totalDuration) * 100}%`
    if (i % labelStep === 0) {
      tick.classList.add('bbt-tick--labeled')
      const label = document.createElement('span')
      label.className = 'bbt-tick-label'
      label.textContent = String(i + 1)
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

  btnTabFullscreen?.addEventListener('click', () => setTabState('fullscreen'))
  btnTabStrip?.addEventListener('click',     () => setTabState('strip'))
  btnTabCollapse?.addEventListener('click',  () => setTabState('collapsed'))

  btnTabLoopClear?.addEventListener('click', () => {
    clearLoop()
    tabDragBeat = null
    tabLoopControlsEl?.setAttribute('hidden', '')
  })

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

  tabContentEl.classList.remove('tab-content--loading')

  alphaTabApi = new alphaTabMod.AlphaTabApi(tabContentEl, {
    core: {
      workerFile:    `${AT_BASE}/alphaTab.worker.mjs`,
      fontDirectory: `${AT_BASE}/font/`,
      logLevel:      alphaTabMod.LogLevel.Warning,
    },
    player: {
      // 35.1 / 35.4 — le synthétiseur MIDI est toujours utilisé, même quand le
      // fichier embarque un backing track : celui-ci est joué en parallèle par
      // WaveSurfer. En mode automatique, AlphaTab basculerait en lecture du
      // backing track et n'avancerait plus son horloge de synthèse.
      playerMode:           alphaTabMod.PlayerMode.EnabledSynthesizer,
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

  // 35.1 — le synthé est prêt : son horloge peut piloter le transport.
  alphaTabApi.playerReady.on(() => { tabClockLive = true })

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
    // Generate sync points from embedded GP markers (mod.midi.MidiFileGenerator)
    try {
      const mod = window.__alphaTabModule
      const sps = mod?.midi?.MidiFileGenerator?.generateSyncPoints(score)
      if (sps?.length > 0) {
        tabSyncPoints = sps
        alphaTabApi.updateSyncPoints()
        console.info('[tab] sync points:', sps.length,
          sps.map(p => `bar${p.masterBarIndex}@${(p.syncTime/1000).toFixed(2)}s→${(p.synthTime/1000).toFixed(2)}s`).join(' '))
      }
    } catch (e) {
      console.warn('[tab] sync points extraction failed:', e)
    }

    // Durée du score (après les sync points : ils redéfinissent l'axe temps)
    scoreDurationSec = beatTickToAudioTimeSec(scoreTotalTicks(score))
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

  // 35.1 — AlphaTab master clock : sa position pilote l'affichage, la boucle
  // et le recalage des instances WaveSurfer (followers).
  alphaTabApi.playerPositionChanged.on(args => {
    if (!tabMaster) return
    tabClockLive = true
    const audioSec = synthTimeToAudioTime(args.currentTime) / 1000
    updateTimeDisplay(audioSec)
    for (const ws of wavesurfers) {
      if (args.isSeek || Math.abs(ws.getCurrentTime() - audioSec) > WS_DRIFT_TOL) {
        ws.setTime(audioSec)
      }
    }
    checkLoopRebound(audioSec)
  })

  alphaTabApi.playerFinished.on(() => {
    if (!tabMaster) return
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

    const loopStart = beatTickToAudioTimeSec(startBeat.absolutePlaybackStart)
    const loopEnd   = beatTickToAudioTimeSec(lastBeat.absolutePlaybackStart + lastBeat.playbackDuration)
    tabDragBeat = null

    if (loopEnd - loopStart < 0.05) return
    syncRegionToAll(loopStart, loopEnd)
    setLoopEnabled(true)
    tabLoopControlsEl?.removeAttribute('hidden')
  })

  alphaTabApi.load(`/tab/${encodePath(grooveSlug)}/${encodeURIComponent(tabFile)}`)
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
    const origStart = m.start
    const duration  = m.end - m.start
    const { minStart, maxEnd } = getMoveBounds(m.id)

    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > 3) didDrag = true
      const rect = markerLaneEl.getBoundingClientRect()
      const dt   = ((ev.clientX - startX) / rect.width) * totalDuration
      let ns = Math.max(minStart, Math.min(origStart + dt, maxEnd - duration))
      m.start = ns
      m.end   = ns + duration
      updateRegionElPosition(el, m)
    }
    const onUp = () => {
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

      const onMove = (ev) => {
        const t = laneXToTime(ev.clientX)
        if (isLeft) m.start = Math.max(leftBound,  Math.min(t, m.end - 0.1))
        else        m.end   = Math.min(rightBound, Math.max(t, m.start + 0.1))
        updateRegionElPosition(el, m)
      }
      const onUp = () => {
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

    const onMove = (ev) => {
      const cur = laneXToTime(ev.clientX)
      const s   = Math.max(bounds.minStart, Math.min(anchorTime, cur))
      const end = Math.min(bounds.maxEnd,   Math.max(anchorTime, cur))
      ghost.style.left  = ((s / totalDuration) * 100) + '%'
      ghost.style.width = (((end - s) / totalDuration) * 100) + '%'
    }

    const onUp = (ev) => {
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

// Navigate to the previous/next marker from current playhead (17.6)
function navigatePrevMarker() {
  if (!markers.length) return false
  const cur    = currentTimeSec()
  const sorted = [...markers].sort((a, b) => a.start - b.start)
  const prev   = sorted.filter(m => m.start < cur - 0.05).pop()
  if (prev) { performSeek(prev.start); return true }
  return false
}

function navigateNextMarker() {
  if (!markers.length) return false
  const cur    = currentTimeSec()
  const sorted = [...markers].sort((a, b) => a.start - b.start)
  const next   = sorted.find(m => m.start > cur + 0.05)
  if (next) { performSeek(next.start); return true }
  return false
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

  // Révéler les boutons dans le transport
  btnToggleComments.removeAttribute('hidden')
  btnAddComment.removeAttribute('hidden')

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
    btnLoopGoIn.addEventListener('click', () => {
      if (markers.length > 0) {
        if (!navigatePrevMarker()) performSeek(0)
      } else {
        if (activeLoopIn !== null) performSeek(activeLoopIn)
      }
    })
    btnLoopGoOut.addEventListener('click', () => {
      if (markers.length > 0) {
        if (!navigateNextMarker()) performSeek(totalDuration)
      } else {
        if (activeLoopOut !== null) performSeek(activeLoopOut)
      }
    })
    btnLoopClear.addEventListener('click', clearLoop)

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
    resizeTimer = setTimeout(adjustTrackWidths, 150)
  }, { passive: true })
})()

init()
