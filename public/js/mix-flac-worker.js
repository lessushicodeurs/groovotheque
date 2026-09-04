// Epic 38.5 — Encodage FLAC dans un Worker (libflacjs / libFLAC compilé en WebAssembly)
//
// Entrée  : { pcm: Int16Array entrelacé, channels, sampleRate, frames }
// Sortie  : { ok: true, data: [Uint8Array, …] } — les fragments du fichier FLAC

// Indique à libflac.js où trouver le fichier .wasm (même dossier que le script).
self.FLAC_SCRIPT_LOCATION = '/vendor/libflac/'

const COMPRESSION_LEVEL = 5   // défaut de l'outil `flac` : bon compromis vitesse / taille
const BITS_PER_SAMPLE = 16
const BLOCK_FRAMES = 4096     // frames par appel à process_interleaved

let loadError = null
try {
  importScripts('/vendor/libflac/libflac.min.wasm.js')
} catch (err) {
  loadError = `Bibliothèque FLAC introuvable : ${err.message}`
}

self.onmessage = (ev) => {
  if (loadError) {
    self.postMessage({ ok: false, error: loadError })
    return
  }
  const { pcm, channels, sampleRate, frames } = ev.data
  whenReady(() => {
    try {
      const data = encode(pcm, channels, sampleRate, frames)
      self.postMessage({ ok: true, data })
    } catch (err) {
      self.postMessage({ ok: false, error: err.message || String(err) })
    }
  })
}

function whenReady(fn) {
  if (typeof Flac === 'undefined') {
    self.postMessage({ ok: false, error: 'Bibliothèque FLAC non chargée.' })
    return
  }
  // Flac.on('ready') se déclenche immédiatement si la bibliothèque est déjà initialisée.
  Flac.on('ready', fn)
}

function encode(pcm, channels, sampleRate, frames) {
  const chunks = []
  let metaData = null

  const encoder = Flac.create_libflac_encoder(
    sampleRate, channels, BITS_PER_SAMPLE, COMPRESSION_LEVEL, frames, false,
  )
  if (!encoder) throw new Error('Initialisation de l’encodeur FLAC impossible.')

  const status = Flac.init_encoder_stream(
    encoder,
    (buffer) => { chunks.push(new Uint8Array(buffer)) },
    (meta) => { metaData = meta },
    false, 0,
  )
  if (status !== 0) {
    Flac.FLAC__stream_encoder_delete(encoder)
    throw new Error(`Encodeur FLAC : erreur d’initialisation (${status}).`)
  }

  // libFLAC attend un Int32Array de valeurs 16 bits signées, entrelacées.
  try {
    const block = new Int32Array(BLOCK_FRAMES * channels)
    for (let start = 0; start < frames; start += BLOCK_FRAMES) {
      const n = Math.min(BLOCK_FRAMES, frames - start)
      const len = n * channels
      const view = n === BLOCK_FRAMES ? block : block.subarray(0, len)
      for (let i = 0; i < len; i++) view[i] = pcm[start * channels + i]
      if (!Flac.FLAC__stream_encoder_process_interleaved(encoder, view, n)) {
        const state = Flac.FLAC__stream_encoder_get_state(encoder)
        throw new Error(`Encodage FLAC interrompu (état ${state}).`)
      }
    }
    Flac.FLAC__stream_encoder_finish(encoder)
  } finally {
    Flac.FLAC__stream_encoder_delete(encoder)
  }

  if (metaData) patchStreamInfo(chunks, metaData)
  return chunks
}

// L'encodeur ne peut pas revenir en arrière sur un flux : min/max framesize, nombre
// total d'échantillons et somme MD5 doivent être réécrits dans le bloc STREAMINFO
// à partir des métadonnées finales (portage de `addFLACMetaData` de libflacjs).
function patchStreamInfo(chunks, meta) {
  let index = 0
  let offset = 4
  let data = chunks[0]
  if (!data || data.length < 4 || String.fromCharCode(...data.subarray(0, 4)) !== 'fLaC') return
  if (data.length === 4) {
    index = 1
    offset = 0
    data = chunks[1]
    if (!data) return
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  view.setUint8(offset + 8,  meta.min_framesize >> 16)
  view.setUint8(offset + 9,  meta.min_framesize >> 8)
  view.setUint8(offset + 10, meta.min_framesize)
  view.setUint8(offset + 11, meta.max_framesize >> 16)
  view.setUint8(offset + 12, meta.max_framesize >> 8)
  view.setUint8(offset + 13, meta.max_framesize)
  view.setUint8(offset + 18, meta.total_samples >> 24)
  view.setUint8(offset + 19, meta.total_samples >> 16)
  view.setUint8(offset + 20, meta.total_samples >> 8)
  view.setUint8(offset + 21, meta.total_samples)
  const md5 = meta.md5sum || ''
  for (let i = 0; i * 2 < md5.length; i++) {
    view.setUint8(offset + 22 + i, parseInt(md5.substring(i * 2, i * 2 + 2), 16))
  }
  chunks[index] = data
}
