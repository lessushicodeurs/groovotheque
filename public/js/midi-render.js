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
  // 0,5 et non 1,0 : à plein volume le synthétiseur écrête. Mesuré sur
  // « Kate Bush — Babooshka », la piste Drums sort à +2,1 dBFS avec
  // masterVolume 1,0 — l'encodage en entiers 16 bits la rabote. Un facteur 0,5
  // (−6 dB) ramène le pire cas à −3,9 dBFS et laisse toutes les autres pistes
  // très en dessous ; le volume de piste du player rattrape la différence.
  // Changer cette valeur change le son de tous les rendus : incrémenter
  // MIDI_RENDER_VERSION dans server.js pour périmer les fichiers existants.
  options.masterVolume    = 0.5
  if (soundFont) options.soundFonts = [soundFont]

  // Isolation : la piste visée à fond, toutes les autres à zéro. AlphaTab
  // retraduit ces index de piste en canaux MIDI.
  const trackCount = score?.tracks?.length ?? 0
  for (let i = 0; i < trackCount; i++) {
    options.trackVolume.set(i, i === trackIndex ? 1.0 : 0.0)
  }

  // Fuite du métronome, sans contournement connu côté appelant.
  // `AlphaSynthAudioExporter` initialise son canal de métronome sur le canal 16
  // (`DefaultChannelCount - 1`), puis `setup()` relit le volume voulu par
  // `channelGetMixVolume(16)`. Sur un score assez fourni pour que le canal 16
  // appartienne à une vraie piste, c'est le `trackVolume` de cette piste qui est
  // relu : isoler cette piste met 1,0 sur le canal 16 et rallume le métronome
  // malgré `metronomeVolume: 0`. Le rendu de la piste concernée porte alors un
  // clic sur chaque temps (constaté sur « Piano RH » de Babooshka, canaux 15/16).
  // Rien à faire d'ici : en navigateur l'exporteur vit dans un worker et son
  // interface (`AlphaSynthAudioExporterWorkerApi`) n'expose que `initialize`,
  // `render` et `destroy` — aucun réglage de canal après coup. Et les volumes
  // passés en options sont indexés par piste, pas par canal : impossible de
  // distinguer le canal 16 de la piste qui le porte. À reprendre si AlphaTab
  // corrige le calcul ou ouvre l'accès aux canaux de l'exporteur.
  // Collision de canaux : `trackVolume` est indexé par piste, mais AlphaTab le
  // retraduit en canaux MIDI (voir isolateTrackChannels). Deux pistes sur le
  // même canal s’écrasent. On écarte donc les voisines avant l'export.
  const relocated = isolateTrackChannels(score, trackIndex)
  let exporter
  try {
    exporter = await api.exportAudio(options)
  } finally {
    // Le MIDI est généré de bout en bout par exportAudio() avant qu'il ne rende
    // la main : les canaux d'origine peuvent revenir tout de suite, et le
    // synthétiseur du player (mode tab-only) les retrouve intacts.
    restoreTrackChannels(relocated)
  }

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
  // dise. Les causes qui restent une fois les canaux démêlés tiennent au
  // fichier lui-même ou au soundfont — `trackVolume` n'est qu'un multiplicateur.
  // (La collision de canaux, qui produisait exactement ce silence sur les
  // pistes de percussion, est traitée en amont par isolateTrackChannels.)
  if (peakAmplitude(buffer) < SILENCE_PEAK) {
    throw new Error(
      'le rendu est muet (aucun signal au-dessus de −80 dBFS). '
      + 'La piste est peut-être vide, muette ou à volume nul dans le fichier '
      + 'Guitar Pro, ou son instrument est absent du soundfont.',
    )
  }
  return buffer
}

// ── Isolation d'une piste qui partage son canal MIDI ──────────────────────
//
// `AudioExportOptions.trackVolume` est indexé par piste, mais AlphaTab le
// retraduit en canaux MIDI juste avant l'export :
//
//   trackVolume.set(track.playbackInfo.primaryChannel, volume)
//   trackVolume.set(track.playbackInfo.secondaryChannel, volume)
//
// Deux pistes sur le même canal écrivent donc dans la même case, et la
// dernière gagne. Or les pistes de percussion d'un fichier Guitar Pro sont
// **toutes** sur le canal 10 (indice 9) : c'est le canal de percussion de la
// norme General MIDI, et `Score.finish()` d'AlphaTab les y force. Sur « Just
// the two of us » (Drums, Congas, Tambourin, Agogo, tous canal 9), isoler
// Drums posait 1,0 sur le canal 9 puis Congas, Tambourin et Agogo y posaient
// 0,0 : rendu parfaitement muet, refusé par le garde-fou. Et isoler Agogo — la
// dernière piste, donc la dernière à écrire — donnait 1,0 sur le canal 9 et un
// rendu contenant les quatre pistes mélangées.
//
// Correctif : avant l'export, la piste visée garde son canal (le 9 porte le kit
// de batterie du soundfont, elle ne peut pas en changer sans perdre son timbre)
// et **les autres pistes qui partagent ce canal sont déplacées** sur des canaux
// libres. Leur volume étant à 0, le timbre qu'elles y prennent n'a aucune
// importance : elles sont muettes, elles ne font plus que libérer la place.

// Le canal 17 (indice 16) est celui du métronome de l'exporteur : on n'y
// déplace jamais rien. Cf. la note sur la fuite du métronome plus haut.
const MIDI_CHANNEL_COUNT = 16

/**
 * Déplace les pistes qui partagent un canal avec la piste visée, pour que
 * `trackVolume` puisse réellement l'isoler.
 *
 * @param {object} score
 * @param {number} trackIndex piste à isoler
 * @returns {Array<{info: object, primary: number, secondary: number}>} les
 *   canaux d'origine à rendre après l'export
 */
export function isolateTrackChannels(score, trackIndex) {
  const tracks = score?.tracks ?? []
  const target = tracks[trackIndex]
  if (!target) return []

  const targetChannels = new Set([
    target.playbackInfo.primaryChannel,
    target.playbackInfo.secondaryChannel,
  ])

  // Canaux occupés par l'ensemble du score : on ne déplace pas une piste sur le
  // canal d'une autre, ce serait remplacer une collision par une autre.
  const used = new Set()
  for (const t of tracks) {
    used.add(t.playbackInfo.primaryChannel)
    used.add(t.playbackInfo.secondaryChannel)
  }

  const free = []
  for (let c = 0; c < MIDI_CHANNEL_COUNT; c++) if (!used.has(c)) free.push(c)

  const relocated = []
  for (const t of tracks) {
    if (t.index === trackIndex) continue
    const info = t.playbackInfo
    const hitsPrimary   = targetChannels.has(info.primaryChannel)
    const hitsSecondary = targetChannels.has(info.secondaryChannel)
    if (!hitsPrimary && !hitsSecondary) continue

    const needed = (hitsPrimary ? 1 : 0)
      + (hitsSecondary && info.secondaryChannel !== info.primaryChannel ? 1 : 0)
    if (free.length < needed) {
      restoreTrackChannels(relocated)
      throw new Error(
        `la piste « ${target.name} » partage le canal MIDI `
        + `${[...targetChannels].map(c => c + 1).join(' / ')} avec d’autres pistes, `
        + 'et il ne reste aucun canal libre pour les écarter : elle ne peut pas '
        + 'être rendue seule.',
      )
    }

    relocated.push({ info, primary: info.primaryChannel, secondary: info.secondaryChannel })
    if (hitsPrimary) {
      const c = free.shift()
      used.add(c)
      if (info.secondaryChannel === info.primaryChannel) {
        // Piste à canal unique (cas des percussions) : les deux suivent.
        info.primaryChannel = c
        info.secondaryChannel = c
        continue
      }
      info.primaryChannel = c
    }
    if (hitsSecondary && info.secondaryChannel !== info.primaryChannel) {
      const c = free.shift()
      used.add(c)
      info.secondaryChannel = c
    }
  }
  return relocated
}

/** Rend leurs canaux d'origine aux pistes déplacées. */
export function restoreTrackChannels(relocated) {
  for (const { info, primary, secondary } of relocated) {
    info.primaryChannel = primary
    info.secondaryChannel = secondary
  }
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
