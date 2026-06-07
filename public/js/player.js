import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js'
import TimelinePlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/timeline.esm.js'
import MinimapPlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/minimap.esm.js'
import HoverPlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/hover.esm.js'
import RegionsPlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.esm.js'

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

// 13.7 — Desktop only: tablature désactivée sur mobile
const IS_DESKTOP = window.matchMedia('(min-width: 769px)').matches

const titleEl          = document.getElementById('groove-title')
const loadBarEl        = document.getElementById('load-bar')
const mainEl           = document.getElementById('player-main')
const tracksContainer  = document.getElementById('tracks-container')
const minimapContainer = document.getElementById('minimap-container')
const drawerEl         = document.getElementById('transport-drawer')
const handleEl         = document.getElementById('transport-handle')
const transportEl      = document.getElementById('transport')
const btnPlay          = document.getElementById('btn-play')
const btnStop          = document.getElementById('btn-stop')
const timecodeEl       = document.getElementById('timecode')
const durationEl       = document.getElementById('duration')
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
const minimapRowEls  = []   // .minimap-row div per track (for proportional width)
const trackDurations = []   // duration in seconds per track, set on 'ready'
let timelinePluginRef = null  // TimelinePlugin instance (track 0), for duration correction
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
let markerLaneEl     = null
let markerPopoverEl  = null
let markers          = []    // { id, start, end, label }[]
let selectedMarkerId = null
let markerIdCounter  = 0

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
function applyVolumes() {
  const anySolo = trackStates.some(s => s.soloed)
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

async function playAll() {
  if (isPlaying) return
  // Resume Web Audio graph if suspended (requires prior user gesture — satisfied by this click)
  if (sharedAudioCtx.state === 'suspended') await sharedAudioCtx.resume()
  if (loopEnabled && activeLoopIn !== null && activeLoopOut !== null) {
    const cur = wavesurfers[0]?.getCurrentTime() ?? 0
    if (cur < activeLoopIn || cur >= activeLoopOut) seekAllTo(activeLoopIn)
  }
  isPlaying = true
  btnPlay.textContent = '⏸'
  try {
    await Promise.all(wavesurfers.map(ws => ws.play()))
  } catch (err) {
    console.warn('play failed:', err)
    if (!wavesurfers.some(ws => ws.isPlaying())) {
      isPlaying = false
      btnPlay.textContent = '▶'
    }
  }
}

function pauseAll() {
  if (!isPlaying) return
  wavesurfers.forEach(ws => ws.pause())
  isPlaying = false
  btnPlay.textContent = '▶'
}

function stopAll() {
  wavesurfers.forEach(ws => { ws.pause(); ws.setTime(0) })
  isPlaying = false
  btnPlay.textContent = '▶'
  timecodeEl.textContent = formatTimecode(0)
  seekFillEl.style.width = '0%'
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
  wavesurfers.forEach(w => { w.pause(); w.setTime(0) })
  timecodeEl.textContent = formatTimecode(0)
  seekFillEl.style.width = '0%'
}

function seekAllTo(time) {
  wavesurfers.forEach(ws => ws.setTime(time))
  if (alphaTabApi && tabState !== 'collapsed') {
    alphaTabApi.timePosition = audioTimeToSynthTime(time * 1000)
  }
}

// Shared seek-with-resume logic: pauses if playing, seeks all tracks, then
// resumes. seekGen prevents stale async play() callbacks from updating state
// after a subsequent seek has already taken over (rapid scrubbing scenario).
async function performSeek(time) {
  const myGen = ++seekGen
  const wasPlaying = isPlaying
  if (wasPlaying) { isPlaying = false; wavesurfers.forEach(ws => ws.pause()) }
  seekAllTo(time)
  if (wasPlaying) {
    try {
      await Promise.all(wavesurfers.map(ws => ws.play()))
      if (myGen === seekGen) { isPlaying = true; btnPlay.textContent = '⏸' }
    } catch { /* ignored */ }
  }
}

function nudge(delta) {
  if (!wavesurfers.length) return
  const current = wavesurfers[0].getCurrentTime()
  const next = Math.max(0, Math.min(totalDuration, current + delta))
  performSeek(next)
}

function updateLoopFields() {
  const hasRegion = activeLoopIn !== null && activeLoopOut !== null
  loopInEl.value = hasRegion ? formatLoopTime(activeLoopIn) : '—'
  loopOutEl.value = hasRegion ? formatLoopTime(activeLoopOut) : '—'
  loopInEl.disabled = !hasRegion
  loopOutEl.disabled = !hasRegion
  btnLoopGoIn.disabled = !hasRegion
  btnLoopGoOut.disabled = !hasRegion
  btnLoopClear.disabled = !hasRegion
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
function syncRegionToAll(start, end) {
  if (isSyncingRegion) return
  isSyncingRegion = true

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
    region.on('update-end', () => syncRegionToAll(region.start, region.end))
  })

  isSyncingRegion = false
}

function setLoopEnabled(val) {
  loopEnabled = val
  btnLoop.classList.toggle('active', loopEnabled)
  btnLoop.setAttribute('aria-pressed', String(loopEnabled))
}

function buildTrackRow(track, idx, cachedPeaks = null) {
  const color         = TRACK_COLORS[idx % TRACK_COLORS.length]
  const waveColor     = color + '55'  // dim = unplayed
  const progressColor = color         // bright = played

  const row = document.createElement('div')
  row.className = 'track-row'

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

  const dlLink = document.createElement('a')
  dlLink.href = track.url
  dlLink.download = track.filename
  dlLink.className = 'btn-track-download'
  dlLink.title = `Télécharger ${track.filename}`
  dlLink.textContent = '↓'

  const sidebarTop = document.createElement('div')
  sidebarTop.className = 'track-sidebar-top'
  sidebarTop.append(dot, nameEl, dlLink)

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

  // Track 0 gets a column wrapper so the timeline renders above the waveform
  // in the light DOM (via TimelinePlugin's container option), avoiding Shadow DOM offsets.
  let timelineExtEl = null
  if (idx === 0) {
    const waveCol = document.createElement('div')
    waveCol.className = 'track-wave-col'
    timelineExtEl = document.createElement('div')
    timelineExtEl.className = 'track-timeline-ext'
    // Epic 17: marker lane between timeline and first waveform
    markerLaneEl = document.createElement('div')
    markerLaneEl.className = 'marker-lane'
    markerLaneEl.setAttribute('aria-label', 'Bande de marqueurs')
    waveCol.append(timelineExtEl, markerLaneEl, waveEl)
    row.append(sidebar, waveCol)
  } else {
    row.append(sidebar, waveEl)
  }
  tracksContainer.appendChild(row)
  waveEls.push(waveEl)

  // ── Dedicated minimap row per track ───────────
  const minimapRow = document.createElement('div')
  minimapRow.className = 'minimap-row'
  minimapContainer.appendChild(minimapRow)
  minimapRowEls.push(minimapRow)

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

  if (!isMobile) {
    plugins.push(MinimapPlugin.create({
      height: 22,
      waveColor,
      progressColor,
      container: minimapRow,
    }))
  }

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
    url: track.url,
    height: isMobile ? 48 : 64,
    barWidth: isMobile ? 1 : 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
    interact: true,
    plugins,
  }
  if (cachedPeaks?.length > 0) wsOpts.peaks = cachedPeaks
  const ws = WaveSurfer.create(wsOpts)

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
  volSliders.push(volSlider)
  wavesurfers.push(ws)
  ws.setPlaybackRate(currentTempo / 100, true)

  // ── Drag-to-create loop regions ───────────────
  // Creating a region on any track syncs to all other tracks.
  regionsPlugin.enableDragSelection({ color: 'rgba(255,255,255,0.2)' })
  regionsPlugin.on('region-created', (region) => {
    syncRegionToAll(region.start, region.end)
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
    if (alphaTabApi && tabState !== 'collapsed') {
      alphaTabApi.timePosition = audioTimeToSynthTime(newTime * 1000)
    }
    if (wasPlaying) {
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
      durationEl.textContent = formatTimecode(totalDuration)
    }
    trackDurations[idx] = ws.getDuration()
    if (trackDurations.filter(d => d > 0).length === wavesurfers.length) {
      adjustTrackWidths()
      if (pendingLoop) {
        syncRegionToAll(pendingLoop.in, pendingLoop.out)
        pendingLoop = null
      }
    }
  })

  ws.on('error', () => {
    markSegmentLoaded(idx, '#c44')
  })

  // ── Timecode + seek bar + duration + loop from first track ─
  if (idx === 0) {

    ws.on('timeupdate', (t) => {
      timecodeEl.textContent = formatTimecode(t)
      if (totalDuration > 0) {
        seekFillEl.style.width = `${(t / totalDuration) * 100}%`
        seekBarEl.setAttribute('aria-valuenow', Math.round((t / totalDuration) * 100))
      }
      // Loop rebounding: when playhead reaches loop out, jump to loop in.
      // loopJumping flag prevents double-trigger when timeupdate fires again
      // before setTime() has advanced the playhead past activeLoopOut.
      if (loopEnabled && activeLoopOut !== null && t >= activeLoopOut && !loopJumping && isPlaying) {
        loopJumping = true
        seekAllTo(activeLoopIn ?? 0)
        setTimeout(() => { loopJumping = false }, 50)
      }
    })
  }

  ws.on('finish', () => {
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
    applyVolumes()
  })

  btnSolo.addEventListener('click', () => {
    state.soloed = !state.soloed
    btnSolo.classList.toggle('active', state.soloed)
    btnSolo.setAttribute('aria-pressed', String(state.soloed))
    applyVolumes()
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
  const maxDur = Math.max(...trackDurations.filter(d => d > 0))
  if (!maxDur) return

  // Track 0 may be shorter than others (e.g. a metronome). Always sync
  // totalDuration and the timeline to the actual longest track.
  totalDuration = maxDur
  durationEl.textContent = formatTimecode(maxDur)
  if (timelinePluginRef) {
    timelinePluginRef.options.duration = maxDur
    wavesurfers[0]?.emit('redraw')
  }

  // sidebar width is fixed at 176px (matches .track-sidebar { width: 176px })
  const SIDEBAR_W = 176

  waveEls.forEach((el, i) => {
    const ratio = (trackDurations[i] ?? maxDur) / maxDur
    if (ratio < 1) {
      el.style.flex = 'none'
      // calc uses 100% = track-row width, dynamically correct on resize
      el.style.width = `calc(${ratio.toFixed(6)} * (100% - ${SIDEBAR_W}px))`
    }
  })

  const minimapW = minimapContainer.offsetWidth
  minimapRowEls.forEach((el, i) => {
    const ratio = (trackDurations[i] ?? maxDur) / maxDur
    if (ratio < 1) {
      el.style.width = Math.floor(minimapW * ratio) + 'px'
    }
  })

  renderMarkers()
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
  const minimapEl = document.getElementById('minimap-container')
  if (newState === 'fullscreen') {
    tracksEl?.classList.add('tab-hidden')
    minimapEl?.classList.add('tab-hidden')
  } else {
    tracksEl?.classList.remove('tab-hidden')
    minimapEl?.classList.remove('tab-hidden')
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
    const totalAudioMs  = (wavesurfers[0]?.getDuration() ?? 0) * 1000 || sp0.syncTime
    const totalSynthMs  = alphaTabApi?.endTime || sp0.synthTime
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
    const tempo    = alphaTabApi?.score?.tempo || 120
    const synthMs  = tick * 60000 / (tempo * 960)
    return synthMs / 1000
  }
  let i = sps.length - 1
  for (let j = 0; j < sps.length - 1; j++) {
    if (tick < sps[j + 1].synthTick) { i = j; break }
  }
  const sp0      = sps[i]
  const bpm      = sp0.synthBpm || alphaTabApi?.score?.tempo || 98.5
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
    const totalAudioMs  = (wavesurfers[0]?.getDuration() ?? 0) * 1000 || sp0.syncTime
    const totalSynthMs  = alphaTabApi?.endTime || sp0.synthTime
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
    if (alphaTabApi && tabState !== 'collapsed') {
      // window.__tabTestMode = true suspend la sync audio pour les tests Playwright
      if (!window.__tabTestMode && wavesurfers.length > 0) {
        const audioMs = wavesurfers[0].getCurrentTime() * 1000
        alphaTabApi.timePosition = audioTimeToSynthTime(audioMs)
      }
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
    cb.addEventListener('change', () => {
      if (!alphaTabApi) return
      const cbs = tabTrackListEl.querySelectorAll('input[type=checkbox]')
      const selected = score.tracks.filter((_, j) => cbs[j]?.checked)
      alphaTabApi.renderTracks(selected.length > 0 ? selected : [score.tracks[0]])
    })
    label.append(cb, document.createTextNode(track.name || `Piste ${i + 1}`))
    tabTrackListEl.appendChild(label)
  })
}

async function initTabDrawer(tabFile) {
  if (!IS_DESKTOP || !tabDrawerEl) return

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
  const AT_VER  = '1.8.3'
  const AT_BASE = `https://cdn.jsdelivr.net/npm/@coderline/alphatab@${AT_VER}/dist`

  let alphaTabMod
  try {
    alphaTabMod = await import(`${AT_BASE}/alphaTab.mjs`)
    window.__alphaTabModule = alphaTabMod
  } catch (err) {
    tabContentEl.textContent = 'AlphaTab non disponible (vérifier la connexion).'
    tabContentEl.classList.remove('tab-content--loading')
    console.warn('[tab] Échec chargement AlphaTab:', err)
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
      enablePlayer:         true,
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
  alphaTabApi.error.on(err => console.error('[AlphaTab]', err))

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
    buildTrackSelector(score)
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

// 11.3 / 15.5 — Chargement silencieux du mix sauvegardé
async function loadMix(tracks) {
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
    if (mix.loop && typeof mix.loop.in === 'number' && typeof mix.loop.out === 'number') {
      pendingLoop = { in: mix.loop.in, out: mix.loop.out }
      // Si toutes les waveforms sont déjà prêtes avant que le fetch mix revienne
      if (wavesurfers.length > 0 && trackDurations.filter(d => d > 0).length === wavesurfers.length) {
        syncRegionToAll(pendingLoop.in, pendingLoop.out)
        pendingLoop = null
      }
    }
    // Epic 17 — charger les marqueurs (rendu différé dans adjustTrackWidths)
    if (Array.isArray(mix.markers) && mix.markers.length > 0) {
      markers = mix.markers
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

// 11.4 / 15.5 — Sauvegarde du mix courant (admin uniquement)
async function saveMix() {
  const mixData = { tracks: {} }
  currentTracks.forEach((track, i) => {
    mixData.tracks[track.filename] = {
      volume: Math.round(trackStates[i].volume * 100),
      pan:    Math.round((panKnobs[i]?.getValue() ?? 0) * 100) / 100,
    }
  })
  if (activeLoopIn !== null && activeLoopOut !== null) {
    mixData.loop = { in: activeLoopIn, out: activeLoopOut }
  }
  // Epic 17 — sauvegarder les marqueurs
  if (markers.length > 0) {
    mixData.markers = markers.map(({ start, end, label }) => ({ in: start, out: end, label }))
  }
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
  el.classList.toggle('marker-region--selected', marker.id === selectedMarkerId)
}

function setupRegionInteraction(el, marker) {
  const edgeL = el.querySelector('.marker-region-edge--left')
  const edgeR = el.querySelector('.marker-region-edge--right')
  let didDrag = false

  // Single click → select region (set IN/OUT)
  el.addEventListener('click', () => {
    if (didDrag) return
    const m = markers.find(mk => mk.id === marker.id)
    if (m) selectMarker(m.id)
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
      if (m.id === selectedMarkerId) syncRegionToAll(m.start, m.end)
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
        if (m.id === selectedMarkerId) syncRegionToAll(m.start, m.end)
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

function selectMarker(id) {
  selectedMarkerId = id
  markerLaneEl?.querySelectorAll('.marker-region').forEach(el => {
    el.classList.toggle('marker-region--selected', el.dataset.markerId === id)
  })
  const m = markers.find(mk => mk.id === id)
  if (m) syncRegionToAll(m.start, m.end)
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
    if (selectedMarkerId === marker.id) {
      selectedMarkerId = null
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
  if (!markers.length || !wavesurfers.length) return false
  const cur    = wavesurfers[0].getCurrentTime()
  const sorted = [...markers].sort((a, b) => a.start - b.start)
  const prev   = sorted.filter(m => m.start < cur - 0.05).pop()
  if (prev) { performSeek(prev.start); return true }
  return false
}

function navigateNextMarker() {
  if (!markers.length || !wavesurfers.length) return false
  const cur    = wavesurfers[0].getCurrentTime()
  const sorted = [...markers].sort((a, b) => a.start - b.start)
  const next   = sorted.find(m => m.start > cur + 0.05)
  if (next) { performSeek(next.start); return true }
  return false
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

    if (!groove.tracks?.length) {
      showFatalError('Aucune piste audio dans ce groove.', false)
      return
    }

    initLoadBar(groove.tracks.length)
    tracksContainer.removeAttribute('hidden')
    minimapContainer.removeAttribute('hidden')
    drawerEl.removeAttribute('hidden')
    initDrawer()
    btnDownloadAll.removeAttribute('hidden')
    btnDownloadAll.addEventListener('click', () => {
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
    })

    // 6.3 — Fetch all cached peaks in parallel before building tracks
    const cachedPeaksArr = await Promise.all(
      groove.tracks.map(track => fetchPeaks(grooveSlug, track.filename))
    )

    currentTracks = groove.tracks
    groove.tracks.forEach((track, i) => {
      buildTrackRow(track, track.index, cachedPeaksArr[i])
    })

    // Epic 17 — init marker lane (markerLaneEl set during buildTrackRow idx=0)
    initMarkerLane()

    await loadMix(groove.tracks)

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
      const val = parseLoopTime(loopInEl.value)
      if (val !== null && activeLoopOut !== null && val < activeLoopOut) {
        syncRegionToAll(val, activeLoopOut)
      } else {
        updateLoopFields() // reset invalid input
      }
    }
    function commitLoopOut() {
      const val = parseLoopTime(loopOutEl.value)
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
      // Skip when user is interacting with any input element (text fields,
      // range sliders) — arrow keys on range inputs must work natively.
      if (e.target instanceof HTMLInputElement) return

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

init()
