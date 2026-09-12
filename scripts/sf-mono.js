#!/usr/bin/env node
// sf-mono.js — repasse en mono les samples stéréo d'un soundfont SF2/SF3.
//
// Pourquoi. AlphaTab (TinySoundFont) ne charge que les samples mono
// (`sampleType & 1`) et écarte les samples stéréo — mais il **conserve** les
// régions qui les référencent. Ces régions gardent leurs métadonnées (offset,
// end, boucle) avec un tableau de samples vide : à la note suivante, la lecture
// hors du tableau produit `undefined`, donc NaN. Et NaN × 0 = NaN, c'est-à-dire
// qu'une seule piste fautive — même à volume nul — empoisonne le mix entier,
// jusqu'à la fin du morceau (la voix ne meurt jamais). Converti en Int16, le
// NaN donne 0 : silence numérique complet.
//
// Sur MuseScore_General.sf3 : 146 samples stéréo sur 1246 (11,7 %), soit
// 4 presets totalement muets (Grand Piano, Bright Grand, Honky-Tonk, Mellow
// Grand) et 31 presets partiels.
//
// Ce que fait la conversion. Elle réécrit `sfSampleType` dans le chunk `shdr` :
// 2 octets par sample, **aucune donnée audio n'est touchée**, aucun Vorbis à
// décoder, aucun outil externe, ~1 s pour 38 Mo. Chaque moitié d'une paire
// stéréo devient un sample mono à part entière : les deux voix sont jouées et
// panoramiquées par leurs régions respectives, le timbre est conservé.
//
// Usage :
//   node scripts/sf-mono.js <fichier.sf2|sf3>     convertit sur place
//   node scripts/sf-mono.js --check <fichier>     compte sans rien écrire
//                                                 (sortie 1 s'il reste du stéréo)

'use strict';

const fs = require('fs');
const path = require('path');

// Bits de `sfSampleType` (spécification SoundFont 2.04, § 7.10).
const TYPE_MONO   = 0x0001;
const TYPE_RIGHT  = 0x0002;
const TYPE_LEFT   = 0x0004;
const TYPE_LINKED = 0x0008;
const TYPE_VORBIS = 0x0010; // extension SF3 : échantillon compressé en Vorbis
const TYPE_ROM    = 0x8000; // renvoie à une ROM absente : jamais chargé, laissé tel quel

// Un enregistrement `shdr` fait 46 octets, dont les 2 derniers portent le type.
const SHDR_RECORD = 46;
const SHDR_TYPE_OFFSET = 44;

/** Liste les sous-chunks RIFF présents entre `off` et `end`. */
function listChunks(buf, off, end) {
  const out = [];
  let p = off;
  while (p + 8 <= end) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    out.push({ id, off: p + 8, size });
    p += 8 + size + (size & 1); // les chunks RIFF sont alignés sur 2 octets
  }
  return out;
}

/**
 * Localise le chunk `shdr` (table des en-têtes de samples).
 * @returns {{off: number, count: number}|null}
 */
function findShdr(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  const top = listChunks(buf, 12, Math.min(buf.length, 8 + buf.readUInt32LE(4)));
  for (const c of top) {
    if (c.id !== 'LIST') continue;
    if (buf.toString('ascii', c.off, c.off + 4) !== 'pdta') continue;
    for (const sub of listChunks(buf, c.off + 4, c.off + c.size)) {
      if (sub.id !== 'shdr') continue;
      // Le dernier enregistrement est le terminateur « EOS », pas un sample.
      return { off: sub.off, count: Math.floor(sub.size / SHDR_RECORD) - 1 };
    }
  }
  return null;
}

/**
 * Compte les samples qu'AlphaTab refuserait de charger (tout ce qui n'est pas
 * mono, hors ROM).
 * @returns {{total: number, stereo: number}|null} null si le fichier n'est pas
 *          un soundfont RIFF lisible.
 */
function countSamples(buf) {
  const shdr = findShdr(buf);
  if (!shdr || shdr.count <= 0) return null;
  let stereo = 0;
  for (let i = 0; i < shdr.count; i++) {
    const type = buf.readUInt16LE(shdr.off + i * SHDR_RECORD + SHDR_TYPE_OFFSET);
    if (type & TYPE_ROM) continue;
    if (!(type & TYPE_MONO)) stereo++;
  }
  return { total: shdr.count, stereo };
}

/**
 * Réécrit le buffer en place pour marquer tous les samples comme mono.
 * @returns {{total: number, changed: number}|null}
 */
function convertToMono(buf) {
  const shdr = findShdr(buf);
  if (!shdr || shdr.count <= 0) return null;
  let changed = 0;
  for (let i = 0; i < shdr.count; i++) {
    const at = shdr.off + i * SHDR_RECORD + SHDR_TYPE_OFFSET;
    const type = buf.readUInt16LE(at);
    if (type & TYPE_ROM) continue;
    // On garde le drapeau Vorbis (il dit comment décoder les octets) et on
    // efface gauche / droite / lié au profit du seul bit mono.
    const mono = (type & TYPE_VORBIS) | TYPE_MONO;
    if (type !== mono) {
      buf.writeUInt16LE(mono, at);
      changed++;
    }
  }
  return { total: shdr.count, changed };
}

/** Lit un fichier et compte ses samples stéréo. `null` si illisible. */
function countSamplesInFile(filePath) {
  try {
    return countSamples(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

/**
 * Convertit un fichier sur place, par écriture atomique (`.part` puis rename) :
 * une interruption ne laisse jamais un soundfont à moitié réécrit.
 * @returns {{total: number, changed: number}|null}
 */
function convertFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const result = convertToMono(buf);
  if (!result) return null;
  if (result.changed === 0) return result;
  const tmp = filePath + '.part';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, filePath);
  return result;
}

module.exports = { countSamples, countSamplesInFile, convertToMono, convertFile };

if (require.main === module) {
  const args = process.argv.slice(2);
  const check = args[0] === '--check';
  const file = check ? args[1] : args[0];
  if (!file) {
    console.error('Usage : node scripts/sf-mono.js [--check] <fichier.sf2|sf3>');
    process.exit(2);
  }
  const name = path.basename(file);
  if (check) {
    const counted = countSamplesInFile(file);
    if (!counted) { console.error(`✗  ${name} : soundfont illisible.`); process.exit(2); }
    console.log(`${name} : ${counted.stereo} sample(s) stéréo sur ${counted.total}.`);
    process.exit(counted.stereo > 0 ? 1 : 0);
  }
  let result;
  try {
    result = convertFile(file);
  } catch (err) {
    console.error(`✗  ${name} : ${err.message}`);
    process.exit(2);
  }
  if (!result) { console.error(`✗  ${name} : soundfont illisible.`); process.exit(2); }
  console.log(result.changed === 0
    ? `${name} : déjà entièrement mono (${result.total} samples), rien à faire.`
    : `${name} : ${result.changed} sample(s) repassé(s) en mono sur ${result.total}.`);
}
