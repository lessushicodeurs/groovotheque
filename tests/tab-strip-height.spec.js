/**
 * Test Playwright — hauteur du tiroir tablature en mode strip.
 *
 * Kate Bush - Babooshka compte dix pistes : un système entier mesure plus de
 * 1500 px, bien plus que la fenêtre. Le tiroir doit rester plafonné et le
 * débord rester atteignable au scroll vertical du contenu.
 *
 * Usage : npx playwright test tests/tab-strip-height.spec.js
 */

const { test, expect } = require('@playwright/test')
const { snapshotRenders, cleanNewRenders } = require('./midi-render-guard')
const { spawn }        = require('child_process')
const path             = require('path')
const fs               = require('fs')
const bcrypt           = require('bcrypt')

const ROOT      = path.join(__dirname, '..')
const AUTH_FILE = path.join(ROOT, '.auth')
const TEST_USER = 'playwright_test'
const TEST_PASS = 'pw_test_secret_2024'
const PORT      = 3199
const BASE_URL  = `http://localhost:${PORT}`
const GROOVE    = 'Ghismo/Tabs/Kate Bush - Babooshka'

let serverProcess = null

function addTestUser(hash) {
  const original = fs.readFileSync(AUTH_FILE, 'utf8')
  if (original.includes(`${TEST_USER}:`)) return
  fs.writeFileSync(AUTH_FILE, `${TEST_USER}:${hash}\n` + original)
}
function removeTestUser() {
  try {
    const content = fs.readFileSync(AUTH_FILE, 'utf8')
    fs.writeFileSync(AUTH_FILE, content.split('\n').filter(l => !l.startsWith(`${TEST_USER}:`)).join('\n'))
  } catch {}
}
async function waitForPort(port, timeout = 15000) {
  const { default: net } = await import('net')
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      const c = net.connect(port, '127.0.0.1', () => { c.destroy(); resolve() })
      c.on('error', () => Date.now() - start > timeout ? reject(new Error('port')) : setTimeout(check, 200))
    }
    check()
  })
}

// 39.3 — le rendu MIDI part tout seul à l'ouverture et s'écrit dans le dossier
// du groove : on efface après coup ce que la série a produit, et rien d'autre.
let renderSnapshot = null

test.beforeAll(async () => {
  renderSnapshot = snapshotRenders()
  addTestUser(bcrypt.hashSync(TEST_PASS, 5))
  serverProcess = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' })
  await waitForPort(PORT)
})
test.afterAll(() => { removeTestUser(); serverProcess?.kill(); cleanNewRenders(renderSnapshot) })

test('strip — hauteur plafonnée sur une partition à 8 pistes', async ({ browser }) => {
  const context = await browser.newContext({
    httpCredentials: { username: TEST_USER, password: TEST_PASS },
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/player.html?groove=${encodeURIComponent(GROOVE)}`)
  await page.waitForSelector('.tab-drawer:not([hidden])', { timeout: 20000 })
  await page.waitForSelector('.at-surface', { timeout: 60000 })
  await page.waitForFunction(() => window.__alphaTabApi?.score != null, { timeout: 60000 })
  await page.waitForTimeout(3000)

  const m = await page.evaluate(() => {
    const d = document.querySelector('.tab-drawer')
    const c = document.querySelector('#tab-content')
    const s = document.querySelector('.at-surface')
    return {
      tracks: window.__alphaTabApi.score.tracks.length,
      state: d.className,
      drawerH: d.getBoundingClientRect().height,
      contentH: c.clientHeight,
      scrollH: c.scrollHeight,
      surfaceH: parseInt(s.style.height || '0', 10),
      winH: window.innerHeight,
    }
  })
  console.log(JSON.stringify(m, null, 2))
  expect(m.drawerH).toBeLessThanOrEqual(m.winH * 0.62)
  expect(m.scrollH).toBeGreaterThan(m.contentH)   // le débord est atteignable au scroll
  await context.close()
})
