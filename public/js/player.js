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

const params = new URLSearchParams(location.search)
const grooveSlug = params.get('groove')

const titleEl          = document.getElementById('groove-title')
const stateEl          = document.getElementById('player-state')
const tracksContainer  = document.getElementById('tracks-container')
const minimapContainer = document.getElementById('minimap-container')
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
const tempoSliderEl    = document.getElementById('tempo-slider')
const tempoValueEl     = document.getElementById('tempo-value')
const tempoBadgeEl     = document.getElementById('tempo-badge')

const wavesurfers  = []
const trackStates  = []   // { volume, muted, soloed }
const trackRegions = []   // RegionsPlugin instance per track
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

function slugToName(slug) {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
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
  document.querySelectorAll('.tempo-preset').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.value) === pct)
  })
}

function applyVolumes() {
  const anySolo = trackStates.some(s => s.soloed)
  wavesurfers.forEach((ws, i) => {
    const s = trackStates[i]
    ws.setVolume(anySolo ? (s.soloed ? s.volume : 0) : (s.muted ? 0 : s.volume))
  })
}

async function playAll() {
  if (isPlaying) return
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

function buildTrackRow(track, idx) {
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

  const sidebarTop = document.createElement('div')
  sidebarTop.className = 'track-sidebar-top'
  sidebarTop.append(dot, nameEl)

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

  // ── Waveform container ────────────────────────
  const waveEl = document.createElement('div')
  waveEl.className = 'track-wave'

  row.append(sidebar, waveEl)
  tracksContainer.appendChild(row)

  // ── Dedicated minimap row per track ───────────
  const minimapRow = document.createElement('div')
  minimapRow.className = 'minimap-row'
  minimapContainer.appendChild(minimapRow)

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
    MinimapPlugin.create({
      height: 22,
      waveColor,
      progressColor,
      container: minimapRow,
    }),
  ]

  if (idx === 0) {
    plugins.push(TimelinePlugin.create({
      height: 18,
      timeInterval: 5,
      primaryLabelInterval: 30,
      secondaryLabelInterval: 10,
      style: { color: '#555', fontSize: '10px' },
    }))
  }

  // ── WaveSurfer instance ───────────────────────
  const ws = WaveSurfer.create({
    container: waveEl,
    waveColor,
    progressColor,
    url: track.url,
    height: 64,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
    interact: true,
    plugins,
  })

  const state = { volume: 1, muted: false, soloed: false }
  trackStates.push(state)
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
    if (wasPlaying) {
      try {
        await Promise.all(wavesurfers.map(w => w.play()))
        if (myGen === seekGen) { isPlaying = true; btnPlay.textContent = '⏸' }
      } catch { /* ignored */ }
    }
  })

  // ── Timecode + seek bar + duration + loop from first track ─
  if (idx === 0) {
    ws.on('ready', () => {
      totalDuration = ws.getDuration()
      durationEl.textContent = formatTimecode(totalDuration)
    })

    ws.on('timeupdate', (t) => {
      timecodeEl.textContent = formatTimecode(t)
      if (totalDuration > 0) {
        seekFillEl.style.width = `${(t / totalDuration) * 100}%`
        seekBarEl.setAttribute('aria-valuenow', Math.round((t / totalDuration) * 100))
      }
      // Loop rebounding: when playhead reaches loop out, jump to loop in.
      // loopJumping flag prevents double-trigger when timeupdate fires again
      // before setTime() has advanced the playhead past activeLoopOut.
      if (loopEnabled && activeLoopOut !== null && t >= activeLoopOut && !loopJumping) {
        loopJumping = true
        seekAllTo(activeLoopIn ?? 0)
        setTimeout(() => { loopJumping = false }, 50)
      }
    })
  }

  ws.on('finish', onFinish)

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
}

async function init() {
  if (!grooveSlug) {
    stateEl.textContent = 'Aucun groove spécifié.'
    stateEl.classList.add('error')
    return
  }

  try {
    const res = await fetch(`/api/grooves/${encodeURIComponent(grooveSlug)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const groove = await res.json()

    const name = slugToName(groove.slug)
    titleEl.textContent = name
    document.title = `${name} — Groovotheque`

    if (!groove.tracks?.length) {
      stateEl.textContent = 'Aucune piste audio dans ce groove.'
      return
    }

    stateEl.remove()
    tracksContainer.removeAttribute('hidden')
    minimapContainer.removeAttribute('hidden')
    transportEl.removeAttribute('hidden')

    for (const track of groove.tracks) {
      buildTrackRow(track, track.index)
    }

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

    // ── Loop button ────────────────────────────
    btnLoop.addEventListener('click', () => setLoopEnabled(!loopEnabled))

    // ── Tempo control ──────────────────────────
    tempoSliderEl.addEventListener('input', () => applyTempo(Number(tempoSliderEl.value)))
    tempoSliderEl.addEventListener('dblclick', () => applyTempo(100))
    document.querySelectorAll('.tempo-preset').forEach(btn => {
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
    stateEl.textContent = `Erreur de chargement : ${err.message}`
    stateEl.classList.add('error')
  }
}

init()
