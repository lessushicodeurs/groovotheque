/**
 * Test Playwright — copies recalables des pistes.
 *
 * Chrome ne rejoint pas la position demandée dans un MP3 à débit variable (il
 * passe par la table Xing, trop grossière) ni dans l'AAC du backing track
 * embarqué dans un `.gp` (il en oublie l'amorce après un seek). Mesuré sur
 * « Ha Ya » : jusqu'à 370 ms d'erreur, différente selon l'endroit visé, donc
 * backing et stems qui ne jouent plus ensemble dès qu'on ne part pas du début.
 * La parade est une copie FLAC dans le cache, lue à la place de l'original.
 *
 * Protocole :
 *  1. Démarre le serveur avec un user de test temporaire, cache des copies mis
 *     de côté (le test doit partir d'un groove jamais converti)
 *  2. Ouvre le player : les copies se fabriquent en tâche de fond
 *  3. Vérifie les dépôts, puis ce que l'API annonce pour chaque piste
 *  4. Décode copie et original dans le navigateur : même fréquence, même
 *     nombre d'échantillons, mêmes échantillons — la copie ne change que le
 *     conteneur
 *  5. Vérifie qu'une source modifiée périme la copie
 *
 * Usage : npx playwright test tests/seekable-copies.spec.js
 */

const { test, expect } = require('@playwright/test')
const { snapshotRenders, cleanNewRenders } = require('./midi-render-guard')
const { spawn } = require('child_process')
const path  = require('path')
const fs    = require('fs')
const bcrypt = require('bcrypt')

const ROOT      = path.join(__dirname, '..')
const AUTH_FILE = path.join(ROOT, '.auth')
const TEST_USER = 'playwright_test'
const TEST_PASS = 'pw_test_secret_2024'
const PORT      = 3196

// Groove de référence : 5 pistes MP3 + un `.gp` qui embarque un backing track.
const GROOVE   = 'Ghismo/Tabs/The_Clark_Sisters_-_Ha_Ya'
const BASE_URL = `http://localhost:${PORT}`

const SEEKABLE_DIR = path.join(ROOT, 'cache', GROOVE, 'seekable')
const BACKUP_DIR   = `${SEEKABLE_DIR}.testbak`

const encodePath = p => p.split('/').map(encodeURIComponent).join('/')

let serverProcess = null
let renderSnapshot = null

test.beforeAll(async () => {
  renderSnapshot = snapshotRenders()
  // Les copies déjà en cache sont celles de l'utilisateur : mises de côté le
  // temps du test, remises en place à la fin.
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true })
  if (fs.existsSync(SEEKABLE_DIR)) fs.renameSync(SEEKABLE_DIR, BACKUP_DIR)

  const hash = bcrypt.hashSync(TEST_PASS, 5)
  const original = fs.readFileSync(AUTH_FILE, 'utf8')
  if (!original.includes(`${TEST_USER}:`)) {
    fs.writeFileSync(AUTH_FILE, `${TEST_USER}:${hash}\n` + original)
  }

  serverProcess = spawn('node', ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe',
  })
  const net = (await import('net')).default
  await new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      const client = net.connect(PORT, '127.0.0.1', () => { client.destroy(); resolve() })
      client.on('error', () => {
        if (Date.now() - start > 10000) reject(new Error(`Port ${PORT} not ready`))
        else setTimeout(check, 200)
      })
    }
    check()
  })
})

test.afterAll(() => {
  try {
    const content = fs.readFileSync(AUTH_FILE, 'utf8')
    fs.writeFileSync(AUTH_FILE, content.split('\n').filter(l => !l.startsWith(`${TEST_USER}:`)).join('\n'))
  } catch { /* already clean */ }
  serverProcess?.kill()
  cleanNewRenders(renderSnapshot)
  // Les copies fabriquées par le test partent ; celles de l'utilisateur reviennent.
  fs.rmSync(SEEKABLE_DIR, { recursive: true, force: true })
  if (fs.existsSync(BACKUP_DIR)) fs.renameSync(BACKUP_DIR, SEEKABLE_DIR)
})

// Le décodage + l'encodage FLAC des six pistes tiennent en une dizaine de
// secondes, mais la machine peut être chargée.
test.setTimeout(300000)

async function openPlayer(browser) {
  const context = await browser.newContext({
    httpCredentials: { username: TEST_USER, password: TEST_PASS },
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  return { context, page }
}

// Ouvre le player et attend que toutes les copies du groove soient en cache.
// Playwright relance son worker après un échec, donc chaque test doit pouvoir
// partir d'un cache vide : c'est l'ouverture du player qui fabrique les copies.
async function openPlayerWithCopies(browser) {
  const { context, page } = await openPlayer(browser)
  await page.goto(`${BASE_URL}/player.html?groove=${encodeURIComponent(GROOVE)}`)
  await expect.poll(async () => {
    const api = await page.evaluate(
      async p => (await fetch(`/api/grooves/${p}`)).json(), encodePath(GROOVE))
    return api.tracks.every(t => !t.needsSeekable) && !!api.backingPlaybackUrl
  }, { timeout: 240000 }).toBe(true)
  return { context, page }
}

test('les copies se fabriquent à l’ouverture et remplacent les pistes qui se calent mal', async ({ browser }) => {
  const { context, page } = await openPlayer(browser)
  const posted = []
  const served = new Set()
  page.on('response', r => {
    if (r.url().includes('/api/seekable/')) posted.push(r.status())
    else if (r.url().includes('/seekable/')) served.add(decodeURIComponent(r.url().split('/').pop()))
  })

  await page.goto(`${BASE_URL}/player.html?groove=${encodeURIComponent(GROOVE)}`)
  // 5 MP3 du dossier + le backing track embarqué dans le `.gp`.
  await expect.poll(() => posted.length, { timeout: 240000 }).toBe(6)
  expect(posted.every(s => s === 201)).toBe(true)

  const api = await page.evaluate(
    async p => (await fetch(`/api/grooves/${p}`)).json(), encodePath(GROOVE))

  const mp3 = api.tracks.filter(t => t.filename.toLowerCase().endsWith('.mp3'))
  expect(mp3.length).toBe(5)
  for (const track of mp3) {
    expect(track.playbackUrl, track.filename).toContain('/seekable/')
    expect(track.needsSeekable, track.filename).toBe(false)
  }
  // Le FLAC se cale déjà juste : aucune copie pour lui.
  const flac = api.tracks.find(t => t.filename.toLowerCase().endsWith('.flac'))
  expect(flac?.playbackUrl ?? null).toBeNull()
  expect(flac?.needsSeekable ?? false).toBe(false)
  // Le backing track n'est pas une piste du dossier : sa copie s'annonce à part.
  expect(api.backingPlaybackUrl).toContain('/seekable/')

  // Et chaque piste bascule sur sa copie sans attendre un rechargement : les
  // éléments média de WaveSurfer vivent hors du DOM, c'est donc ce qu'ils
  // demandent au serveur qui le dit.
  await expect.poll(() => served.size, { timeout: 60000 }).toBe(6)
  expect([...served].sort()).toEqual([
    '01 bass.mp3', '02 drums.mp3', '03 others.mp3', '04 vocals.mp3',
    '99 metronome.mp3', '_backing',
  ])

  await context.close()
})

test('une copie porte exactement le son de son original', async ({ browser }) => {
  const { context, page } = await openPlayerWithCopies(browser)

  const cmp = await page.evaluate(async ([copyUrl, sourceUrl]) => {
    // Un contexte à 48 kHz rééchantillonnerait les deux de la même façon et
    // masquerait une copie faite à la mauvaise fréquence : c'est justement ce
    // qu'il faut détecter, donc on décode à la fréquence attendue.
    const ctx = new OfflineAudioContext(2, 1, 44100)
    const load = async url => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`)
      return ctx.decodeAudioData(await res.arrayBuffer())
    }
    const [copy, source] = await Promise.all([load(copyUrl), load(sourceUrl)])
    // Une copie rééchantillonnée garde la durée mais perd le haut du spectre :
    // la comparaison échantillon par échantillon est le seul contrôle sûr.
    const a = copy.getChannelData(0), b = source.getChannelData(0)
    let maxDiff = 0
    for (let i = 0; i < Math.min(a.length, b.length); i += 7) {
      const d = Math.abs(a[i] - b[i])
      if (d > maxDiff) maxDiff = d
    }
    return { copyLength: copy.length, sourceLength: source.length, maxDiff }
  }, [
    `/seekable/${encodePath(GROOVE)}/${encodeURIComponent('04 vocals.mp3')}`,
    `/audio/${encodePath(GROOVE)}/${encodeURIComponent('04 vocals.mp3')}`,
  ])

  expect(cmp.copyLength).toBe(cmp.sourceLength)
  // 16 bits : un échantillon vaut 1/32768. L'écart tient à l'arrondi, pas à un
  // rééchantillonnage ni à un décalage.
  expect(cmp.maxDiff).toBeLessThan(2 / 32768)

  await context.close()
})

test('une source modifiée périme sa copie', async ({ browser }) => {
  const { context, page } = await openPlayerWithCopies(browser)
  const stampPath = path.join(SEEKABLE_DIR, '04 vocals.mp3.json')
  const original = fs.readFileSync(stampPath, 'utf8')
  const stamp = JSON.parse(original)
  // Même effet qu'un fichier remplacé dans le dossier du groove, sans toucher
  // au fichier de l'utilisateur.
  stamp.source.size += 1
  fs.writeFileSync(stampPath, JSON.stringify(stamp), 'utf8')

  const api = await page.evaluate(
    async p => (await fetch(`/api/grooves/${p}`)).json(), encodePath(GROOVE))
  const track = api.tracks.find(t => t.filename === '04 vocals.mp3')
  expect(track.playbackUrl).toBeNull()
  expect(track.needsSeekable).toBe(true)

  // Et la copie périmée n'est plus servie : le player retombe sur l'original.
  const status = await page.evaluate(
    async url => (await fetch(url)).status,
    `/seekable/${encodePath(GROOVE)}/${encodeURIComponent('04 vocals.mp3')}`)
  expect(status).toBe(404)

  fs.writeFileSync(stampPath, original, 'utf8')
  await context.close()
})
