/**
 * Epic 39 — garde-fou des tests qui ouvrent le player.
 *
 * Depuis que le rendu des pistes MIDI part tout seul à l'ouverture et s'écrit
 * dans le dossier du groove, un simple `npx playwright test` laisse des
 * `midi-*.flac` dans les dossiers de l'utilisateur. On photographie l'état
 * avant la série et on efface après coup ce qui est apparu — uniquement cela :
 * un rendu déjà présent avant les tests est laissé tranquille.
 */

const fs = require('fs'), path = require('path')

const ROOT = path.join(__dirname, '..')
const GROOVES = path.join(ROOT, 'grooves')
const CACHE = path.join(ROOT, 'cache')

function walk(dir, onFile, onDir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!onDir?.(p, e.name)) walk(p, onFile, onDir) }
    else onFile(p, e.name)
  }
}

function listRenders() {
  const out = new Set()
  walk(GROOVES, (p, name) => {
    if (name.startsWith('midi-') && name.endsWith('.flac')) out.add(p)
  })
  return out
}

function listMidiCaches() {
  const out = new Set()
  walk(CACHE, () => {}, (p, name) => {
    if (name === 'midi') { out.add(p); return true }
    return false
  })
  return out
}

/** Photographie l'état avant la série de tests. */
function snapshotRenders() {
  return { renders: listRenders(), caches: listMidiCaches() }
}

/** Efface les rendus et empreintes apparus depuis la photo. */
function cleanNewRenders(before) {
  if (!before) return
  for (const p of listRenders()) {
    if (before.renders.has(p)) continue
    fs.rmSync(p, { force: true })
    // Les peaks du rendu vivent dans le cache, sous le même nom de fichier.
    const rel = path.relative(GROOVES, p)
    fs.rmSync(path.join(CACHE, rel + '.peaks.json'), { force: true })
  }
  for (const p of listMidiCaches()) {
    if (before.caches.has(p)) continue
    fs.rmSync(p, { recursive: true, force: true })
  }
}

module.exports = { snapshotRenders, cleanNewRenders }
