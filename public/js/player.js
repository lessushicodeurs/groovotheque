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
const loadBarEl        = document.getElementById('load-bar')
const mainEl           = document.getElementById('player-main')
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
const btnLoopGoIn      = document.getElementById('btn-loop-go-in')
const btnLoopGoOut     = document.getElementById('btn-loop-go-out')
const btnLoopClear     = document.getElementById('btn-loop-clear')
const btnSaveMix       = document.getElementById('btn-save-mix')
const btnDownloadAll   = document.getElementById('btn-download-all')
const tempoSliderEl    = document.getElementById('tempo-slider')
const tempoValueEl     = document.getElementById('tempo-value')
const tempoBadgeEl     = document.getElementById('tempo-badge')
const tempoPresets     = Array.from(document.querySelectorAll('.tempo-preset'))

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
let currentTracks  = []   // groove.tracks list, set at init time
let pendingLoop    = null // loop à restaurer dès que la waveform est prête
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
  tempoPresets.forEach(btn => {
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
  volSliders.push(volSlider)
  wavesurfers.push(ws)
  ws.setPlaybackRate(currentTempo / 100, true)

  // ── Drag-to-create loop regions ───────────────
  // region-created ne fire qu'au pointerup (fin de drag). Pour afficher la
  // zone sur toutes les pistes dès le début, on intercepte le pointermove
  // et on met à jour les éléments DOM des régions miroir directement.
  regionsPlugin.enableDragSelection({ color: 'rgba(255,255,255,0.2)' })
  regionsPlugin.on('region-created', (region) => {
    syncRegionToAll(region.start, region.end)
  })

  let dragPreview = null  // état du drag en cours sur cette piste

  waveEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !totalDuration) return
    const rect = waveEl.getBoundingClientRect()
    dragPreview = {
      startTime: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * totalDuration,
      startX: e.clientX,
      mirrors: new Map(),  // trackIndex → Region
      active: false,
    }

    function onMove(me) {
      if (!dragPreview) return
      if (!dragPreview.active) {
        if (Math.abs(me.clientX - dragPreview.startX) < 3) return
        dragPreview.active = true
        // Créer les régions miroir sur toutes les autres pistes
        isSyncingRegion = true
        trackRegions.forEach((rp, i) => {
          if (i === idx) return
          rp.clearRegions()
          const m = rp.addRegion({
            start: dragPreview.startTime, end: dragPreview.startTime,
            color: 'rgba(255,255,255,0.2)', drag: false, resize: false,
          })
          dragPreview.mirrors.set(i, m)
        })
        isSyncingRegion = false
      }
      if (!dragPreview.mirrors.size) return
      const rect2 = waveEl.getBoundingClientRect()
      const curTime = Math.max(0, Math.min(1, (me.clientX - rect2.left) / rect2.width)) * totalDuration
      const s   = Math.min(dragPreview.startTime, curTime)
      const end = Math.max(dragPreview.startTime, curTime)
      // setOptions() appelle renderPosition() interne (left+right, pas width)
      dragPreview.mirrors.forEach((m) => {
        if (!m) return
        if (typeof m.setOptions === 'function') {
          m.setOptions({ start: s, end })
        } else if (m.element) {
          m.element.style.left  = `${(s / totalDuration) * 100}%`
          m.element.style.right = `${Math.max(0, 100 - (end / totalDuration) * 100)}%`
          m.element.style.width = ''
        }
      })
    }

    function onUp() {
      dragPreview = null
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, { passive: true })

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

  // ── Load bar segment ──────────────────────
  ws.on('ready', () => {
    markSegmentLoaded(idx, TRACK_COLORS[idx % TRACK_COLORS.length])
  })

  ws.on('error', () => {
    markSegmentLoaded(idx, '#c44')
  })

  // ── Timecode + seek bar + duration + loop from first track ─
  if (idx === 0) {
    ws.on('ready', () => {
      totalDuration = ws.getDuration()
      durationEl.textContent = formatTimecode(totalDuration)
      if (pendingLoop) {
        syncRegionToAll(pendingLoop.in, pendingLoop.out)
        pendingLoop = null
      }
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
      if (loopEnabled && activeLoopOut !== null && t >= activeLoopOut && !loopJumping && isPlaying) {
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

// 11.3 — Chargement silencieux du mix sauvegardé
async function loadMix(tracks) {
  try {
    const res = await fetch(`/api/mix/${encodeURIComponent(grooveSlug)}`)
    if (!res.ok) return
    const mix = await res.json()
    if (mix.tracks && typeof mix.tracks === 'object') {
      tracks.forEach((track, i) => {
        const vol = mix.tracks[track.filename]
        if (typeof vol === 'number') {
          trackStates[i].volume = vol / 100
          volSliders[i].value = String(vol)
        }
      })
      applyVolumes()
    }
    if (mix.loop && typeof mix.loop.in === 'number' && typeof mix.loop.out === 'number') {
      // La waveform n'est pas encore rendue ici — on diffère à l'événement ready
      pendingLoop = { in: mix.loop.in, out: mix.loop.out }
    }
  } catch { /* chargement silencieux */ }
}

// 11.4 — Sauvegarde du mix courant (admin uniquement)
async function saveMix() {
  const mixData = { tracks: {} }
  currentTracks.forEach((track, i) => {
    mixData.tracks[track.filename] = Math.round(trackStates[i].volume * 100)
  })
  if (activeLoopIn !== null && activeLoopOut !== null) {
    mixData.loop = { in: activeLoopIn, out: activeLoopOut }
  }
  try {
    const res = await fetch(`/api/mix/${encodeURIComponent(grooveSlug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mixData),
    })
    return res.ok
  } catch {
    return false
  }
}

async function init() {
  if (!grooveSlug) {
    showFatalError('Aucun groove spécifié.')
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
      showFatalError('Aucune piste audio dans ce groove.', false)
      return
    }

    initLoadBar(groove.tracks.length)
    tracksContainer.removeAttribute('hidden')
    minimapContainer.removeAttribute('hidden')
    transportEl.removeAttribute('hidden')
    btnDownloadAll.removeAttribute('hidden')
    btnDownloadAll.addEventListener('click', () => {
      btnDownloadAll.disabled = true
      btnDownloadAll.textContent = 'Préparation…'
      const a = document.createElement('a')
      a.href = `/api/grooves/${encodeURIComponent(grooveSlug)}/download`
      a.download = `${grooveSlug}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => {
        btnDownloadAll.disabled = false
        btnDownloadAll.textContent = '↓ Tout télécharger'
      }, 2000)
    })

    currentTracks = groove.tracks
    for (const track of groove.tracks) {
      buildTrackRow(track, track.index)
    }

    await loadMix(groove.tracks)

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

    // ── Loop button + navigation ───────────────
    btnLoop.addEventListener('click', () => setLoopEnabled(!loopEnabled))
    btnLoopGoIn.addEventListener('click', () => { if (activeLoopIn !== null) performSeek(activeLoopIn) })
    btnLoopGoOut.addEventListener('click', () => { if (activeLoopOut !== null) performSeek(activeLoopOut) })
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
