// Epic 39 — Rendu audio des pistes MIDI
//
// 39.1 — Encapsule `api.exportAudio()` d'AlphaTab pour rendre **une** piste du
// score hors-ligne et en faire un AudioBuffer stéréo.
//
// Le rendu fonctionne quel que soit le PlayerMode actif : en média externe
// (mode mixte), AlphaTab crée un synthétiseur jetable dans un worker dédié.
// Corollaire : ce synthétiseur n'a aucun soundfont chargé, il faut donc lui
// fournir explicitement les octets du sf2 — sans quoi le rendu sort muet.

export const MIDI_RENDER_SAMPLE_RATE = 44100

// Taille de tranche demandée à l'exporteur. 1 s donne une progression fluide
// sans multiplier les allers-retours avec le worker.
const CHUNK_MS = 1000

// Seuil de silence : −80 dBFS. En dessous, le rendu ne contient rien
// d'audible — un bruit de fond de synthétiseur reste bien au-dessus.
const SILENCE_PEAK = 1e-4

/**
 * Rend une piste MIDI du score en AudioBuffer stéréo 44,1 kHz.
 *
 * @param {object} opts
 * @param {object} opts.api           instance AlphaTabApi
 * @param {object} opts.alphaTab      module AlphaTab (pour `synth.AudioExportOptions`)
 * @param {object} opts.score         score chargé (pour le nombre de pistes)
 * @param {number} opts.trackIndex    index de la piste à isoler
 * @param {Uint8Array} [opts.soundFont] octets du soundfont à utiliser
 * @param {(ratio: number) => void} [opts.onProgress] progression 0 → 1
 * @returns {Promise<AudioBuffer>}
 */
export async function renderMidiTrack({ api, alphaTab, score, trackIndex, soundFont, onProgress }) {
  const options = new alphaTab.synth.AudioExportOptions()
  options.sampleRate      = MIDI_RENDER_SAMPLE_RATE
  options.useSyncPoints   = true   // rendu déjà calé sur les points de synchro du .gp
  options.metronomeVolume = 0
  options.masterVolume    = 1.0
  if (soundFont) options.soundFonts = [soundFont]

  // Isolation : la piste visée à fond, toutes les autres à zéro. AlphaTab
  // retraduit ces index de piste en canaux MIDI.
  const trackCount = score?.tracks?.length ?? 0
  for (let i = 0; i < trackCount; i++) {
    options.trackVolume.set(i, i === trackIndex ? 1.0 : 0.0)
  }

  const exporter = await api.exportAudio(options)

  const chunks = []
  let totalSamples = 0
  try {
    for (;;) {
      // Un chunk `undefined` signale la fin du morceau.
      const chunk = await exporter.render(CHUNK_MS)
      if (!chunk) break
      if (chunk.samples?.length > 0) {
        chunks.push(chunk.samples)
        totalSamples += chunk.samples.length
      }
      if (chunk.endTime > 0) {
        onProgress?.(Math.min(1, chunk.currentTime / chunk.endTime))
      }
    }
  } finally {
    // L'exporteur tient un synthétiseur (et son worker) : toujours le libérer.
    try { exporter.destroy() } catch { /* déjà détruit */ }
  }

  onProgress?.(1)
  const buffer = interleavedToAudioBuffer(chunks, totalSamples)

  // Un rendu plein de zéros s'encode et se met en cache sans broncher : la
  // piste reviendrait muette à chaque ouverture du groove sans que rien ne le
  // dise. Les causes sont connues (soundfont absent, piste muette ou à volume
  // nul dans le .gp — `trackVolume` est un multiplicateur), autant les nommer.
  if (peakAmplitude(buffer) < SILENCE_PEAK) {
    throw new Error(
      'le rendu est muet (aucun signal au-dessus de −80 dBFS). '
      + 'Vérifiez que la piste n’est ni muette ni à volume nul dans le fichier '
      + 'Guitar Pro, et que le soundfont est bien disponible.',
    )
  }
  return buffer
}

/** Pic absolu d'un AudioBuffer, tous canaux confondus. */
export function peakAmplitude(buffer) {
  let peak = 0
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i])
      if (v > peak) peak = v
    }
  }
  return peak
}

/**
 * Concatène les tranches stéréo entrelacées en un AudioBuffer 2 canaux.
 * @param {Float32Array[]} chunks
 * @param {number} totalSamples nombre total d'échantillons (canaux confondus)
 */
function interleavedToAudioBuffer(chunks, totalSamples) {
  const frames = Math.floor(totalSamples / 2)
  if (frames <= 0) throw new Error('Le rendu MIDI n’a produit aucun son.')

  // createBuffer() n'existe que sur un contexte ; l'OfflineAudioContext le
  // fournit sans toucher à la sortie audio de la page.
  const ctx = new OfflineAudioContext(2, 1, MIDI_RENDER_SAMPLE_RATE)
  const buffer = ctx.createBuffer(2, frames, MIDI_RENDER_SAMPLE_RATE)
  const left  = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)

  let frame = 0
  // Les tranches ne se terminent pas forcément sur une frame entière : on suit
  // la parité d'un bout à l'autre plutôt que de traiter chaque tranche à part.
  let pending = null
  for (const chunk of chunks) {
    let i = 0
    if (pending !== null) {
      left[frame] = pending
      right[frame] = chunk[0]
      frame++
      i = 1
      pending = null
    }
    for (; i + 1 < chunk.length; i += 2) {
      left[frame]  = chunk[i]
      right[frame] = chunk[i + 1]
      frame++
      if (frame >= frames) return buffer
    }
    if (i < chunk.length) pending = chunk[i]
  }
  return buffer
}
