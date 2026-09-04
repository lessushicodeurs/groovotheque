// Epic 38.6 — Encodage MP3 dans un Worker (lamejs, portage JavaScript de LAME)
//
// Entrée : { pcm: Int16Array entrelacé, channels, sampleRate, frames }
// Sortie : { ok: true, data: [Int8Array, …] } — les fragments du fichier MP3

const BITRATE_KBPS = 192   // débit constant, non réglable
const BLOCK_FRAMES = 1152  // taille de trame MP3

let loadError = null
try {
  importScripts('/vendor/lamejs/lame.min.js')
} catch (err) {
  loadError = `Bibliothèque MP3 introuvable : ${err.message}`
}

self.onmessage = (ev) => {
  if (loadError) {
    self.postMessage({ ok: false, error: loadError })
    return
  }
  try {
    const { pcm, channels, sampleRate, frames } = ev.data
    self.postMessage({ ok: true, data: encode(pcm, channels, sampleRate, frames) })
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || String(err) })
  }
}

function encode(pcm, channels, sampleRate, frames) {
  if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) {
    throw new Error('Bibliothèque MP3 non chargée.')
  }
  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, BITRATE_KBPS)
  const chunks = []

  const left  = new Int16Array(BLOCK_FRAMES)
  const right = new Int16Array(BLOCK_FRAMES)

  for (let start = 0; start < frames; start += BLOCK_FRAMES) {
    const n = Math.min(BLOCK_FRAMES, frames - start)
    const l = n === BLOCK_FRAMES ? left : left.subarray(0, n)
    const r = n === BLOCK_FRAMES ? right : right.subarray(0, n)
    for (let i = 0; i < n; i++) {
      const base = (start + i) * channels
      l[i] = pcm[base]
      r[i] = channels > 1 ? pcm[base + 1] : pcm[base]
    }
    const buf = encoder.encodeBuffer(l, r)
    if (buf.length > 0) chunks.push(buf)
  }

  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(tail)
  return chunks
}
