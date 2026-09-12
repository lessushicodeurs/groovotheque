/**
 * Test Playwright — soundfont paramétrable (epic 39).
 *
 * Couvre les critères vérifiables sans navigateur :
 *   - le soundfont vient de config.json, et le même sert au rendu et à la lecture
 *   - un soundfont absent retombe proprement sur celui livré avec AlphaTab
 *   - /soundfont ne sert que le fichier retenu, rien d'autre
 *   - changer de soundfont périme les rendus MIDI du dossier
 *
 * Le serveur tourne sur sa propre configuration (GROOVOTHEQUE_CONFIG) et son
 * propre groove jetable : la série ne touche ni au config.json du dépôt ni aux
 * dossiers de l'utilisateur.
 *
 * Usage : npx playwright test tests/soundfont-config.spec.js
 */

const { test, expect } = require('@playwright/test')
const { spawn } = require('child_process')
const path = require('path'), fs = require('fs'), os = require('os'), bcrypt = require('bcrypt')

const ROOT       = path.join(__dirname, '..')
const AUTH_FILE  = path.join(ROOT, '.auth')
const TEST_USER  = 'playwright_sf'
const TEST_PASS  = 'pw_sf_secret_2024'
const PORT       = 3203
const BASE_URL   = `http://localhost:${PORT}`

// Groove jetable : le seul que la série écrit et efface.
const GROOVE      = '_playwright_soundfont'
const GROOVE_DIR  = path.join(ROOT, 'grooves', GROOVE)
const CACHE_DIR   = path.join(ROOT, 'cache', GROOVE)
const RENDER_NAME = 'midi-Piste de test.flac'
const FAKE_FLAC   = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(64, 0x11)])

const CONFIG_FILE = path.join(os.tmpdir(), `groovotheque-sf-${process.pid}.json`)
const writeConfig = value => fs.writeFileSync(CONFIG_FILE, JSON.stringify({ soundFont: value }))

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

test.beforeAll(async () => {
  const orig = fs.readFileSync(AUTH_FILE, 'utf8')
  if (!orig.includes(`${TEST_USER}:`)) {
    fs.writeFileSync(AUTH_FILE, `${TEST_USER}:${bcrypt.hashSync(TEST_PASS, 5)}\n` + orig)
  }
  // Un groove tenant dans un fichier Guitar Pro factice : seule son empreinte
  // (taille + mtime) compte ici, aucune route de cette série ne le lit.
  fs.mkdirSync(GROOVE_DIR, { recursive: true })
  fs.writeFileSync(path.join(GROOVE_DIR, 'test.gp'), 'faux fichier Guitar Pro')
  writeConfig('sonivox.sf3')
  server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), GROOVOTHEQUE_CONFIG: CONFIG_FILE },
    stdio: 'pipe',
  })
  await waitForPort(PORT)
})

test.afterAll(() => {
  const c = fs.readFileSync(AUTH_FILE, 'utf8')
  fs.writeFileSync(AUTH_FILE, c.split('\n').filter(l => !l.startsWith(`${TEST_USER}:`)).join('\n'))
  server?.kill()
  fs.rmSync(GROOVE_DIR, { recursive: true, force: true })
  fs.rmSync(CACHE_DIR, { recursive: true, force: true })
  fs.rmSync(CONFIG_FILE, { force: true })
})

async function api(playwright) {
  return await playwright.request.newContext({
    baseURL: BASE_URL,
    httpCredentials: { username: TEST_USER, password: TEST_PASS },
  })
}

const grooveUrl = `/api/grooves/${encodeURIComponent(GROOVE)}`
const renderUrl = `/api/midi-render/${encodeURIComponent(GROOVE)}/${encodeURIComponent(RENDER_NAME)}`

test('le soundfont vient de config.json, et le player reçoit le même', async ({ playwright }) => {
  const req = await api(playwright)
  writeConfig('sonivox.sf3')

  const cfg = (await (await req.get('/api/config')).json()).soundFont
  expect(cfg.name).toBe('sonivox.sf3')
  expect(cfg.fallback).toBe(false)
  expect(cfg.url).toBe('/soundfont/sonivox.sf3')

  // Le fichier est bien servi, et lui seul : un autre nom n'ouvre rien.
  const served = await req.get(cfg.url)
  expect(served.status()).toBe(200)
  expect((await served.body()).length).toBe(cfg.size)
  expect((await req.get('/soundfont/sonivox.sf2')).status()).toBe(404)
  expect((await req.get('/soundfont/..%2f..%2fserver.js')).status()).toBe(404)

  // Rendu et lecture directe lisent la même valeur : elle est injectée une
  // seule fois dans la page du player.
  const page = await (await req.get('/player.html')).text()
  expect(page).toContain(`window.SOUNDFONT = ${JSON.stringify(cfg)}`)

  await req.dispose()
})

test('un soundfont absent retombe sur celui livré avec AlphaTab', async ({ playwright }) => {
  const req = await api(playwright)
  writeConfig('Absent_De_Ce_Disque.sf3')

  const cfg = (await (await req.get('/api/config')).json()).soundFont
  expect(cfg.fallback).toBe(true)
  expect(cfg.requested).toBe('Absent_De_Ce_Disque.sf3')
  expect(cfg.name).toBe('sonivox.sf2')
  expect((await req.get(cfg.url)).status()).toBe(200)

  await req.dispose()
})

test('changer de soundfont périme les rendus du dossier', async ({ playwright }) => {
  const req = await api(playwright)
  writeConfig('sonivox.sf3')

  const post = await req.post(renderUrl, {
    headers: { 'Content-Type': 'audio/flac' }, data: FAKE_FLAC,
  })
  expect(post.status()).toBe(201)
  expect(fs.existsSync(path.join(GROOVE_DIR, RENDER_NAME))).toBe(true)

  // Le soundfont retenu fait partie de l'empreinte du rendu.
  const fp = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'midi', 'fingerprint.json'), 'utf8'))
  expect(fp.source.soundFont).toMatch(/^sonivox\.sf3:\d+$/)

  // Tant que rien ne change, le groove se liste avec sa piste.
  expect((await (await req.get(grooveUrl)).json()).tracks).toHaveLength(1)

  // Changement de soundfont : la porte d'entrée du player purge le rendu.
  writeConfig('sonivox.sf2')
  expect((await (await req.get(grooveUrl)).json()).tracks).toHaveLength(0)
  expect(fs.existsSync(path.join(GROOVE_DIR, RENDER_NAME))).toBe(false)

  await req.dispose()
})
