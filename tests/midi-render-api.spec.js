/**
 * Test Playwright — écriture et invalidation des rendus audio MIDI (epic 39).
 *
 * Couvre les critères d'acceptance vérifiables sans navigateur :
 *   - le rendu est écrit à plat dans le dossier du groove, sous `midi-<nom>.flac`
 *   - le rendu est listé une seule fois comme piste, sans le préfixe à l'affichage
 *   - modifier le .gp périme le rendu : il est effacé du dossier, pas listé,
 *     et l'empreinte reste dans le cache
 *   - le zip du groove contient le rendu une seule fois
 *   - un chemin contenant « .. » et un nom de fichier hors convention sont rejetés
 *   - seul un flux FLAC est accepté au POST
 *
 * Usage : npx playwright test tests/midi-render-api.spec.js
 */

const { test, expect } = require('@playwright/test')
const { spawn } = require('child_process')
const path = require('path'), fs = require('fs'), bcrypt = require('bcrypt')

const ROOT = path.join(__dirname, '..')
const AUTH_FILE = path.join(ROOT, '.auth')
const TEST_USER = 'playwright_test', TEST_PASS = 'pw_test_secret_2024', PORT = 3202
const BASE_URL = `http://localhost:${PORT}`
const GROOVE = 'Ghismo/Tabs/The_Clark_Sisters_-_Ha_Ya'
const GROOVE_DIR = path.join(ROOT, 'grooves', GROOVE)
const MIDI_CACHE_DIR = path.join(ROOT, 'cache', GROOVE, 'midi')
const RENDER_NAME = 'midi-Piste de test.flac'

// Le serveur n'exige qu'une chose du corps : la signature d'un flux FLAC.
const FAKE_FLAC = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(64, 0x11)])

let server = null

async function waitForPort(port, timeout = 15000) {
  const net = require('net'); const start = Date.now()
  return new Promise((res, rej) => {
    const check = () => {
      const c = net.connect(port, '127.0.0.1', () => { c.destroy(); res() })
      c.on('error', () => Date.now() - start > timeout ? rej(new Error('no port')) : setTimeout(check, 200))
    }; check()
  })
}

function gpFile() {
  return path.join(GROOVE_DIR, fs.readdirSync(GROOVE_DIR).find(n => n.toLowerCase().endsWith('.gp')))
}

// Les rendus vivent maintenant chez l'utilisateur : le ménage porte sur le
// dossier du groove autant que sur l'empreinte restée en cache.
function cleanRenders() {
  fs.rmSync(MIDI_CACHE_DIR, { recursive: true, force: true })
  for (const name of fs.readdirSync(GROOVE_DIR)) {
    if (name.startsWith('midi-') && name.endsWith('.flac')) {
      fs.rmSync(path.join(GROOVE_DIR, name), { force: true })
    }
  }
}

test.beforeAll(async () => {
  const orig = fs.readFileSync(AUTH_FILE, 'utf8')
  if (!orig.includes(`${TEST_USER}:`)) fs.writeFileSync(AUTH_FILE, `${TEST_USER}:${bcrypt.hashSync(TEST_PASS, 5)}\n` + orig)
  cleanRenders()
  server = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' })
  await waitForPort(PORT)
})

test.afterAll(() => {
  const c = fs.readFileSync(AUTH_FILE, 'utf8')
  fs.writeFileSync(AUTH_FILE, c.split('\n').filter(l => !l.startsWith(`${TEST_USER}:`)).join('\n'))
  cleanRenders()
  server?.kill()
})

test.beforeEach(() => cleanRenders())

async function api(playwright) {
  return await playwright.request.newContext({
    baseURL: BASE_URL,
    httpCredentials: { username: TEST_USER, password: TEST_PASS },
  })
}

const encPath = p => p.split('/').map(encodeURIComponent).join('/')
const renderUrl = (groove, name) => `/api/midi-render/${encPath(groove)}/${encodeURIComponent(name)}`
const grooveUrl = groove => `/api/grooves/${encPath(groove)}`

test('39.3 — le rendu est écrit dans le dossier du groove et listé une seule fois', async ({ playwright }) => {
  const req = await api(playwright)

  const post = await req.post(renderUrl(GROOVE, RENDER_NAME), {
    headers: { 'Content-Type': 'audio/flac' },
    data: FAKE_FLAC,
  })
  expect(post.status()).toBe(201)

  // Sur disque : chez l'utilisateur, à plat dans son dossier
  expect(fs.existsSync(path.join(GROOVE_DIR, RENDER_NAME))).toBe(true)
  // Seule l'empreinte du .gp reste dans le cache
  expect(fs.existsSync(path.join(MIDI_CACHE_DIR, 'fingerprint.json'))).toBe(true)
  const fp = JSON.parse(fs.readFileSync(path.join(MIDI_CACHE_DIR, 'fingerprint.json'), 'utf8'))
  expect(fp.files).toContain(RENDER_NAME)
  expect(fp.source.size).toBeGreaterThan(0)

  // Listé une seule fois comme piste, et sans le préfixe à l'affichage
  const listed = (await (await req.get(grooveUrl(GROOVE))).json()).tracks
  const mine = listed.filter(t => t.filename === RENDER_NAME)
  expect(mine).toHaveLength(1)
  expect(mine[0].displayName).toBe('Piste de test')

  // Et il se sert comme n'importe quelle piste audio
  const audio = await req.get(`/audio/${encPath(GROOVE)}/${encodeURIComponent(RENDER_NAME)}`)
  expect(audio.status()).toBe(200)
  expect(Buffer.from(await audio.body()).equals(FAKE_FLAC)).toBe(true)

  await req.dispose()
})

test('39.3 — un .gp modifié périme le rendu : il est effacé du dossier', async ({ playwright }) => {
  const req = await api(playwright)
  await req.post(renderUrl(GROOVE, RENDER_NAME), {
    headers: { 'Content-Type': 'audio/flac' }, data: FAKE_FLAC,
  })
  expect(fs.existsSync(path.join(GROOVE_DIR, RENDER_NAME))).toBe(true)

  // L'empreinte porte la taille et la mtime du .gp : décaler la mtime suffit.
  const gp = gpFile()
  const st = fs.statSync(gp)
  fs.utimesSync(gp, st.atime, new Date(st.mtimeMs + 60000))
  try {
    const listed = (await (await req.get(grooveUrl(GROOVE))).json()).tracks
    expect(listed.some(t => t.filename === RENDER_NAME)).toBe(false)
    // Le rendu périmé ne traîne pas dans le dossier de l'utilisateur
    expect(fs.existsSync(path.join(GROOVE_DIR, RENDER_NAME))).toBe(false)
    expect(fs.existsSync(path.join(MIDI_CACHE_DIR, 'fingerprint.json'))).toBe(false)
  } finally {
    fs.utimesSync(gp, st.atime, st.mtime)   // le .gp retrouve sa mtime d'origine
  }

  await req.dispose()
})

test('39.3 — un fichier déposé à la main n’est jamais effacé par la purge', async ({ playwright }) => {
  const req = await api(playwright)
  const manual = path.join(GROOVE_DIR, 'midi-depose a la main.flac')
  fs.writeFileSync(manual, FAKE_FLAC)
  const gp = gpFile()
  const st = fs.statSync(gp)
  fs.utimesSync(gp, st.atime, new Date(st.mtimeMs + 60000))
  try {
    await req.get(grooveUrl(GROOVE))
    // La purge ne touche que les fichiers listés dans l'empreinte
    expect(fs.existsSync(manual)).toBe(true)
  } finally {
    fs.utimesSync(gp, st.atime, st.mtime)
    fs.rmSync(manual, { force: true })
  }
  await req.dispose()
})

test('39.3 — le zip du groove contient le rendu une seule fois', async ({ playwright }) => {
  const req = await api(playwright)
  await req.post(renderUrl(GROOVE, RENDER_NAME), {
    headers: { 'Content-Type': 'audio/flac' }, data: FAKE_FLAC,
  })

  const zip = Buffer.from(await (await req.get(`${grooveUrl(GROOVE)}/download`)).body())
  // Les noms d'entrée apparaissent en clair dans les en-têtes locaux du zip
  const occurrences = zip.toString('latin1').split(RENDER_NAME).length - 1
  // Un en-tête local + une entrée de catalogue central = 2 occurrences par fichier
  expect(occurrences).toBe(2)

  await req.dispose()
})

test('39.3 — chemin « .. » et nom hors convention sont rejetés', async ({ playwright }) => {
  const req = await api(playwright)

  // Le chemin de groove passe désormais par resolveGrooveDir() : une remontée
  // est refusée en 403 (« Accès interdit ») plutôt qu'en 400. Ce qui compte est
  // qu'elle soit refusée et que rien ne soit écrit.
  const evil = `/api/midi-render/${encodeURIComponent('../../etc')}/${encodeURIComponent(RENDER_NAME)}`
  expect([400, 403]).toContain(
    (await req.post(evil, { headers: { 'Content-Type': 'audio/flac' }, data: FAKE_FLAC })).status())

  // Sans le préfixe marqueur : refusé, sinon n'importe quel fichier du dossier
  // pourrait être écrasé par un POST.
  const noPrefix = renderUrl(GROOVE, 'notes.md')
  expect((await req.post(noPrefix, { headers: { 'Content-Type': 'audio/flac' }, data: FAKE_FLAC })).status())
    .toBe(400)

  // Avec un séparateur dans le nom : refusé aussi
  const traversal = `/api/midi-render/${encPath(GROOVE)}/${encodeURIComponent('midi-../../evil.flac')}`
  expect((await req.post(traversal, { headers: { 'Content-Type': 'audio/flac' }, data: FAKE_FLAC })).status())
    .toBe(400)

  expect(fs.existsSync(path.join(ROOT, 'evil.flac'))).toBe(false)
  expect(fs.existsSync(path.join(ROOT, 'grooves', 'evil.flac'))).toBe(false)

  await req.dispose()
})

test('39.3 — le POST refuse un corps qui n’est pas du FLAC', async ({ playwright }) => {
  const req = await api(playwright)
  const name = 'midi-Pas du flac.flac'

  const post = await req.post(renderUrl(GROOVE, name), {
    headers: { 'Content-Type': 'audio/flac' },
    data: Buffer.from('pas du flac du tout'),
  })
  expect(post.status()).toBe(400)
  expect(fs.existsSync(path.join(GROOVE_DIR, name))).toBe(false)

  await req.dispose()
})
