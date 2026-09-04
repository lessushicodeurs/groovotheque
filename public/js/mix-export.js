// Epic 38 — Export du mix stéréo
//
// Rejoue hors-ligne le graphe Web Audio du player (gain + pan par piste) dans un
// OfflineAudioContext, puis encode le résultat en WAV (natif), FLAC (libflacjs) ou
// MP3 (lamejs). Tout se passe côté client : aucun appel serveur en dehors du
// téléchargement des pistes sources (déjà en cache navigateur après la lecture).

const SAMPLE_RATE = 44100

// ── 38.2 — Rendu hors-ligne ───────────────────────────────────────────────

/**
 * Rend le mix des pistes fournies dans un AudioBuffer stéréo 44,1 kHz.
 *
 * @param {Array<{url: string, volume: number, pan: number}>} tracks
 *        Pistes non silencieuses, avec le gain et le pan courants du player.
 * @param {(step: string) => void} [onProgress] Notification d'étape (facultatif).
 * @returns {Promise<{buffer: AudioBuffer, attenuationDb: number}>}
 *        `attenuationDb` vaut 0 si aucune atténuation anti-écrêtage n'a été appliquée,
 *        sinon la valeur négative appliquée à l'ensemble du buffer.
 */
export async function renderMix(tracks, onProgress) {
  if (!tracks.length) throw new Error('aucune piste audible, le mix serait silencieux.')

  onProgress?.('decode')

  // decodeAudioData a besoin d'un contexte ; celui-ci fixe aussi la fréquence de
  // rééchantillonnage des pistes sources.
  const decodeCtx = new OfflineAudioContext(2, 1, SAMPLE_RATE)

  let buffers = await Promise.all(tracks.map(async (track) => {
    const res = await fetch(track.url)
    if (!res.ok) throw new Error(`Piste inaccessible (HTTP ${res.status})`)
    const data = await res.arrayBuffer()
    return decodeCtx.decodeAudioData(data)
  }))

  const duration = buffers.reduce((max, b) => Math.max(max, b.duration), 0)
  if (!(duration > 0)) throw new Error('Durée de mix nulle.')

  onProgress?.('render')

  const offline = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE)
  buffers.forEach((buffer, i) => {
    const src = offline.createBufferSource()
    src.buffer = buffer
    const gain = offline.createGain()
    gain.gain.value = tracks[i].volume
    const pan = offline.createStereoPanner()
    pan.pan.value = tracks[i].pan
    src.connect(gain)
    gain.connect(pan)
    pan.connect(offline.destination)
    src.start(0)
  })

  const rendered = await offline.startRendering()

  // Libérer les buffers sources dès la fin du rendu (6 pistes × 5 min ≈ 320 Mo).
  buffers = null

  const attenuationDb = preventClipping(rendered)
  return { buffer: rendered, attenuationDb }
}

/**
 * Cherche le pic absolu du buffer ; s'il dépasse 1.0, atténue tout le buffer.
 * @returns {number} l'atténuation appliquée en dB (0 si aucune).
 */
function preventClipping(buffer) {
  let peak = 0
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i])
      if (v > peak) peak = v
    }
  }
  if (peak <= 1) return 0

  const factor = 1 / peak
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) data[i] *= factor
  }
  return 20 * Math.log10(factor)
}

// ── 38.3 — Encodage WAV ───────────────────────────────────────────────────

/**
 * Encode un AudioBuffer en WAV PCM 16 bits entrelacé (en-tête RIFF/WAVE 44 octets).
 * @returns {ArrayBuffer}
 */
export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const dataSize = frames * blockAlign

  const out = new ArrayBuffer(44 + dataSize)
  const view = new DataView(out)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)                             // taille du bloc fmt
  view.setUint16(20, 1, true)                              // format PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * blockAlign, true) // octets par seconde
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 8 * bytesPerSample, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  const chans = []
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c))

  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      view.setInt16(offset, toInt16(chans[c][i]), true)
      offset += 2
    }
  }
  return out
}

function writeAscii(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

function toInt16(sample) {
  const s = Math.max(-1, Math.min(1, sample))
  return s < 0 ? s * 0x8000 : s * 0x7fff
}

/**
 * Convertit un AudioBuffer en Int16Array PCM entrelacé (format d'entrée des encodeurs).
 */
export function toInterleavedInt16(buffer) {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const chans = []
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c))

  const out = new Int16Array(frames * channels)
  let k = 0
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) out[k++] = toInt16(chans[c][i])
  }
  return out
}

// ── 38.5 / 38.6 — Encodage dans un Worker ─────────────────────────────────

function encodeInWorker(workerUrl, buffer) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(workerUrl)
    } catch (err) {
      reject(new Error(`Encodeur indisponible : ${err.message}`))
      return
    }
    const pcm = toInterleavedInt16(buffer)
    worker.onmessage = (ev) => {
      const { ok, data, error } = ev.data || {}
      worker.terminate()
      if (ok) resolve(data)
      else reject(new Error(error || 'Échec de l’encodage.'))
    }
    worker.onerror = (ev) => {
      worker.terminate()
      reject(new Error(ev.message || 'Échec de l’encodage.'))
    }
    worker.postMessage({
      pcm,
      channels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
      frames: buffer.length,
    }, [pcm.buffer])
  })
}

/** 38.5 — FLAC sans perte, niveau de compression 5. */
export async function encodeFlac(buffer) {
  const chunks = await encodeInWorker('/js/mix-flac-worker.js', buffer)
  return new Blob(chunks, { type: 'audio/flac' })
}

/** 38.6 — MP3 192 kbps constant. */
export async function encodeMp3(buffer) {
  const chunks = await encodeInWorker('/js/mix-mp3-worker.js', buffer)
  return new Blob(chunks, { type: 'audio/mpeg' })
}

// ── 38.3 — Déclenchement du téléchargement ────────────────────────────────

/** Déclenche le téléchargement d'un Blob via un <a download> synthétique. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Révoquer l'URL dans le même tick annule le téléchargement sur certains
  // navigateurs : laisser au navigateur le temps de démarrer avant de libérer
  // le Blob (qui peut peser plusieurs dizaines de Mo).
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// Le rendu de l'OfflineAudioContext n'est pas garanti reproductible au bit près d'une
// passe à l'autre (écarts d'un LSB, soit −90 dBFS). Garder le dernier rendu garantit
// que deux formats exportés d'affilée portent exactement le même signal — et évite un
// second rendu.
//
// Pas d'expiration par durée : la signature (URLs + gain + pan) suffit à invalider le
// cache dès que le mix change, et un délai ferait retomber sur un nouveau rendu au
// milieu d'une série d'exports (le critère « FLAC strictement identique au WAV »).
// Coût : un AudioBuffer stéréo reste en mémoire jusqu'au prochain rendu ou au
// déchargement de la page (≈ 21 Mo par minute de mix en float32).
let lastRender = null

/** Laisse passer une frame de rendu pour que l'UI posée juste avant soit peinte. */
function nextPaint() {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

function renderSignature(tracks) {
  return JSON.stringify(tracks.map(t => [t.url, t.volume, t.pan]))
}

async function renderCached(tracks, onProgress) {
  const signature = renderSignature(tracks)
  if (lastRender && lastRender.signature === signature) return lastRender
  // N'invalider qu'en cas de succès : un rendu raté ne doit pas détruire un cache valide.
  const result = await renderMix(tracks, onProgress)
  lastRender = { signature, ...result }
  return lastRender
}

/**
 * Rend puis encode et télécharge le mix.
 *
 * @param {object} opts
 * @param {Array} opts.tracks    pistes non silencieuses ({url, volume, pan})
 * @param {'wav'|'flac'|'mp3'} opts.format
 * @param {string} opts.baseName nom de fichier sans extension (« {slug}-mix »)
 * @param {(step: string) => void} [opts.onProgress]
 * @returns {Promise<{attenuationDb: number, size: number}>}
 */
export async function exportMix({ tracks, format, baseName, onProgress }) {
  const { buffer, attenuationDb } = await renderCached(tracks, onProgress)

  onProgress?.('encode')
  // L'encodage WAV bloque le thread principal : laisser le navigateur peindre le
  // libellé « Encodage… » avant de partir dans la boucle.
  await nextPaint()

  let blob
  if (format === 'wav') {
    blob = new Blob([encodeWav(buffer)], { type: 'audio/wav' })
  } else if (format === 'flac') {
    blob = await encodeFlac(buffer)
  } else if (format === 'mp3') {
    blob = await encodeMp3(buffer)
  } else {
    throw new Error(`Format inconnu : ${format}`)
  }

  downloadBlob(blob, `${baseName}.${format}`)
  return { attenuationDb, size: blob.size }
}
