/**
 * Test Playwright — routes de cache des rendus audio MIDI (epic 39).
 *
 * Couvre les critères d'acceptance vérifiables sans navigateur :
 *   - le rendu est écrit dans cache/<groove-path>/midi/, pas dans le groove
 *   - modifier le .gp invalide le rendu (empreinte) et purge le cache
 *   - un chemin contenant « .. » est rejeté par les deux routes
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
const TRACK = 7   // index sans rapport avec le contenu réel : le serveur ne lit pas le .gp

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

function cleanMidiCache() {
  fs.rmSync(MIDI_CACHE_DIR, { recursive: true, force: true })
}

test.beforeAll(async () => {
  const orig = fs.readFileSync(AUTH_FILE, 'utf8')
  if (!orig.includes(`${TEST_USER}:`)) fs.writeFileSync(AUTH_FILE, `${TEST_USER}:${bcrypt.hashSync(TEST_PASS, 5)}\n` + orig)
  cleanMidiCache()
  server = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' })
  await waitForPort(PORT)
})

test.afterAll(() => {
  const c = fs.readFileSync(AUTH_FILE, 'utf8')
  fs.writeFileSync(AUTH_FILE, c.split('\n').filter(l => !l.startsWith(`${TEST_USER}:`)).join('\n'))
  cleanMidiCache()
  server?.kill()
})

async function api(playwright) {
  return await playwright.request.newContext({
    baseURL: BASE_URL,
    httpCredentials: { username: TEST_USER, password: TEST_PASS },
  })
}

function renderUrl(groove, track) {
  return `/api/midi-render/${groove.split('/').map(encodeURIComponent).join('/')}/${track}`
}

test('39.3 — le rendu est écrit dans cache/<groove-path>/midi/, pas dans le groove', async ({ playwright }) => {
  const req = await api(playwright)
  const url = renderUrl(GROOVE, TRACK)

  // Rien en cache au départ
  expect((await req.get(url)).status()).toBe(404)

  const post = await req.post(url + '?name=Basse', {
    headers: { 'Content-Type': 'audio/flac' },
    data: FAKE_FLAC,
  })
  expect(post.status()).toBe(201)

  // Sur disque : dans le cache, avec son empreinte — et rien dans le groove
  expect(fs.existsSync(path.join(MIDI_CACHE_DIR, `${TRACK}.flac`))).toBe(true)
  expect(fs.existsSync(path.join(MIDI_CACHE_DIR, `${TRACK}.json`))).toBe(true)
  expect(fs.readdirSync(GROOVE_DIR).some(n => n.startsWith(String(TRACK)))).toBe(false)

  const meta = JSON.parse(fs.readFileSync(path.join(MIDI_CACHE_DIR, `${TRACK}.json`), 'utf8'))
  expect(meta.trackIndex).toBe(TRACK)
  expect(meta.trackName).toBe('Basse')
  expect(meta.source.size).toBeGreaterThan(0)

  // Et le GET le rend tel quel
  const get = await req.get(url)
  expect(get.status()).toBe(200)
  expect(Buffer.from(await get.body()).equals(FAKE_FLAC)).toBe(true)

  await req.dispose()
})

test('39.3 — un .gp modifié invalide le rendu et purge le cache', async ({ playwright }) => {
  const req = await api(playwright)
  const url = renderUrl(GROOVE, TRACK)

  await req.post(url, { headers: { 'Content-Type': 'audio/flac' }, data: FAKE_FLAC })
  expect((await req.get(url)).status()).toBe(200)

  // L'empreinte porte la taille et la mtime du .gp : décaler la mtime suffit.
  const gp = gpFile()
  const st = fs.statSync(gp)
  fs.utimesSync(gp, st.atime, new Date(st.mtimeMs + 60000))
  try {
    const stale = await req.get(url)
    expect(stale.status()).toBe(404)
    // Le rendu périmé ne doit pas rester indéfiniment dans le cache
    expect(fs.existsSync(path.join(MIDI_CACHE_DIR, `${TRACK}.flac`))).toBe(false)
    expect(fs.existsSync(path.join(MIDI_CACHE_DIR, `${TRACK}.json`))).toBe(false)
  } finally {
    fs.utimesSync(gp, st.atime, st.mtime)   // le .gp retrouve sa mtime d'origine
  }

  await req.dispose()
})

test('39.3 — un chemin contenant « .. » est rejeté par les deux routes', async ({ playwright }) => {
  const req = await api(playwright)
  const evil = `/api/midi-render/${encodeURIComponent('../../etc')}/0`

  const get = await req.get(evil)
  expect(get.status()).toBe(400)

  const post = await req.post(evil, { headers: { 'Content-Type': 'audio/flac' }, data: FAKE_FLAC })
  expect(post.status()).toBe(400)

  // Rien n'a été écrit hors du cache
  expect(fs.existsSync(path.join(ROOT, 'midi'))).toBe(false)

  await req.dispose()
})

test('39.3 — le POST refuse un corps qui n’est pas du FLAC', async ({ playwright }) => {
  const req = await api(playwright)
  const url = renderUrl(GROOVE, 9)

  const post = await req.post(url, {
    headers: { 'Content-Type': 'audio/flac' },
    data: Buffer.from('pas du flac du tout'),
  })
  expect(post.status()).toBe(400)
  expect(fs.existsSync(path.join(MIDI_CACHE_DIR, '9.flac'))).toBe(false)

  await req.dispose()
})
