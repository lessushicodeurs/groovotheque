// Copies recalables des pistes
//
// Chrome ne rejoint pas la position demandée dans un MP3 à débit variable : il
// passe par la table Xing, trop grossière (100 entrées pour tout le fichier),
// et manque sa cible de plusieurs centaines de millisecondes — d'une valeur
// différente selon l'endroit visé. Le backing track embarqué dans le `.gp`,
// lui, est de l'AAC, dont Chrome oublie les échantillons d'amorce après un
// seek (+47,9 ms constants). Résultat : après un seek ou un rebond de boucle,
// le backing et les stems ne jouent plus ensemble.
//
// Ce module fabrique la parade : une copie FLAC de la piste, déposée dans le
// cache du serveur et lue à la place de l'originale. Le FLAC se rejoint à la
// trame près. Le fichier de l'utilisateur n'est jamais touché.

import { encodeFlac } from './mix-export.js'

/** Nom de la copie du backing track, qui n'est un fichier d'aucun dossier. */
export const BACKING_SEEKABLE_NAME = '_backing'

const DEFAULT_SAMPLE_RATE = 44100

const MPEG_RATES = {
  3: [44100, 48000, 32000],  // MPEG-1
  2: [22050, 24000, 16000],  // MPEG-2
  0: [11025, 12000, 8000],   // MPEG-2.5
}

/**
 * Fréquence d'échantillonnage de la source, lue dans ses octets.
 *
 * decodeAudioData rééchantillonne vers la fréquence du contexte : sans cette
 * lecture, une piste à 48 kHz serait recopiée à 44,1 kHz, c'est-à-dire
 * dégradée par une correction qui ne parle que de calage. À défaut de savoir,
 * 44,1 kHz — la fréquence de tout ce qui sort d'un CD ou d'un séparateur de
 * pistes.
 */
export function probeSampleRate(bytes) {
  // Le conteneur d'abord : cherchée à l'aveugle dans un MP4, une synchro de
  // trame MP3 finit toujours par apparaître au milieu des octets audio et
  // donne une fréquence fantaisiste — 12 kHz sur le backing de « Ha Ya », soit
  // une copie rééchantillonnée quatre fois trop bas.
  const isMp4 = bytes[4] === 0x66 && bytes[5] === 0x74
             && bytes[6] === 0x79 && bytes[7] === 0x70  // « ftyp »
  const rate = isMp4 ? probeMp4SampleRate(bytes) : probeMp3SampleRate(bytes)
  return rate ?? DEFAULT_SAMPLE_RATE
}

function probeMp3SampleRate(bytes) {
  let i = 0
  // Un tag ID3v2 précède les trames : sa taille est codée sur 4 octets de
  // 7 bits utiles (« syncsafe »), le 8e bit de chaque octet étant toujours 0.
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    i = 10 + ((bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14
            | (bytes[8] & 0x7f) << 7  | (bytes[9] & 0x7f))
  }
  const limit = Math.min(bytes.length - 4, i + 65536)
  for (; i < limit; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue
    const version = (bytes[i + 1] >> 3) & 0x03
    const layer   = (bytes[i + 1] >> 1) & 0x03
    const bitrate = (bytes[i + 2] >> 4) & 0x0f
    const index   = (bytes[i + 2] >> 2) & 0x03
    // Une vraie trame n'a ni version ni couche « réservée », et son index de
    // débit n'est ni libre (0) ni invalide (15). Sans ces contrôles, n'importe
    // quel 0xFFE tombé au milieu des données passerait pour un en-tête.
    if (version === 1 || layer === 0 || bitrate === 0 || bitrate === 15) continue
    const rates = MPEG_RATES[version]
    if (rates && index < 3) return rates[index]
  }
  return null
}

function probeMp4SampleRate(bytes) {
  // La fréquence d'une piste MP4 est l'échelle de temps de sa boîte `mdhd`.
  for (let i = 0; i < bytes.length - 24; i++) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x64
        || bytes[i + 2] !== 0x68 || bytes[i + 3] !== 0x64) continue
    const payload = i + 4
    const version = bytes[payload]
    const at = payload + (version === 1 ? 20 : 12)
    if (at + 4 > bytes.length) return null
    const rate = (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0
    return rate >= 8000 && rate <= 192000 ? rate : null
  }
  return null
}

/**
 * Décode les octets d'une piste et les ré-encode en FLAC, sans rien changer au
 * son : même fréquence, même durée, même nombre d'échantillons.
 *
 * @param {Uint8Array} bytes Octets de la piste d'origine.
 * @returns {Promise<Blob>} la copie FLAC.
 */
export async function buildSeekableCopy(bytes) {
  const rate = probeSampleRate(bytes)
  // decodeAudioData a besoin d'un contexte, et c'est lui qui fixe la fréquence
  // de sortie. Un contexte hors-ligne d'un seul échantillon suffit : rien n'y
  // est joué.
  const decodeCtx = new OfflineAudioContext(2, 1, rate)
  // decodeAudioData détache le tampon qu'on lui donne : la copie évite de vider
  // celui de l'appelant, qui garde ses octets (le backing track les réutilise).
  const buffer = await decodeCtx.decodeAudioData(bytes.slice().buffer)
  return encodeFlac(buffer)
}

/** URL de dépôt d'une copie dans le cache du serveur. */
export function seekablePostUrl(encodedGroovePath, name) {
  return `/api/seekable/${encodedGroovePath}/${encodeURIComponent(name)}`
}
