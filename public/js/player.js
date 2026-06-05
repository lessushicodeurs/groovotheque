import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js'
import TimelinePlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/timeline.esm.js'
import MinimapPlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/minimap.esm.js'
import HoverPlugin from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/hover.esm.js'

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

// No shared AudioContext at module load — each WaveSurfer manages its own.
// play() is always called from within a user-gesture handler so the browser's
// autoplay policy is satisfied on iOS Safari too.

const wavesurfers = []
const trackStates = []  // { volume, muted, soloed }
let isPlaying = false
let seekGen = 0  // increments on every seek; async play() checks it before updating state

function slugToName(slug) {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatTime(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
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
  timecodeEl.textContent = '0:00'
}

// Called when any track fires 'finish'. Stops and rewinds all tracks.
// The `if (!isPlaying)` guard prevents double-execution when multiple tracks
// finish within the same tick (typical for same-length recordings).
function onFinish() {
  if (!isPlaying) return
  isPlaying = false
  btnPlay.textContent = '▶'
  wavesurfers.forEach(w => { w.pause(); w.setTime(0) })
  timecodeEl.textContent = '0:00'
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
  // Each track gets its own container so MinimapPlugin does not stack N
  // canvases on top of each other in the shared minimapContainer.
  const minimapRow = document.createElement('div')
  minimapRow.className = 'minimap-row'
  minimapContainer.appendChild(minimapRow)

  // ── Plugins ───────────────────────────────────
  const plugins = [
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

  // ── Seek sync ─────────────────────────────────
  // seekGen prevents stale async play() calls from updating state after a
  // subsequent seek has already taken over (rapid scrubbing scenario).
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

  // ── Timecode from first track; finish from all ─
  if (idx === 0) {
    ws.on('timeupdate', t => { timecodeEl.textContent = formatTime(t) })
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

    btnPlay.addEventListener('click', () => isPlaying ? pauseAll() : playAll())
    btnStop.addEventListener('click', stopAll)

  } catch (err) {
    stateEl.textContent = `Erreur de chargement : ${err.message}`
    stateEl.classList.add('error')
  }
}

init()
