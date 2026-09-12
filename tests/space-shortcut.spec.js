/**
 * Test Playwright — la barre d'espace ne pilote que le play/pause.
 *
 * Couvre : focus sur le body, focus sur un bouton (aucune activation native),
 * saisie de texte (Espace reste un espace) et absence de défilement de page.
 *
 * Usage : npx playwright test tests/space-shortcut.spec.js
 */

const { test, expect } = require('@playwright/test')
const { snapshotRenders, cleanNewRenders } = require('./midi-render-guard')
const { spawn } = require('child_process')
const path = require('path'), fs = require('fs'), bcrypt = require('bcrypt')

const ROOT = __dirname + '/..'
const AUTH_FILE = path.join(ROOT, '.auth')
const TEST_USER = 'playwright_test', TEST_PASS = 'pw_test_secret_2024', PORT = 3201
const GROOVE = 'Ghismo/Tabs/The_Clark_Sisters_-_Ha_Ya'
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

// 39.3 — le rendu MIDI part tout seul à l'ouverture et s'écrit dans le dossier
// du groove : on efface après coup ce que la série a produit, et rien d'autre.
let renderSnapshot = null

test.beforeAll(async () => {
  renderSnapshot = snapshotRenders()
  const orig = fs.readFileSync(AUTH_FILE, 'utf8')
  if (!orig.includes(`${TEST_USER}:`)) fs.writeFileSync(AUTH_FILE, `${TEST_USER}:${bcrypt.hashSync(TEST_PASS, 5)}\n` + orig)
  server = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' })
  await waitForPort(PORT)
})
test.afterAll(() => {
  const c = fs.readFileSync(AUTH_FILE, 'utf8')
  fs.writeFileSync(AUTH_FILE, c.split('\n').filter(l => !l.startsWith(`${TEST_USER}:`)).join('\n'))
  server?.kill()
  cleanNewRenders(renderSnapshot)
})

async function open(browser) {
  const ctx = await browser.newContext({
    httpCredentials: { username: TEST_USER, password: TEST_PASS },
    viewport: { width: 1440, height: 900 },
  })
  const page = await ctx.newPage()
  await page.goto(`http://localhost:${PORT}/player.html?groove=${GROOVE.split('/').map(encodeURIComponent).join('/')}`)
  await page.waitForSelector('#btn-play', { timeout: 30000 })
  await page.waitForSelector('.tab-drawer:not([hidden])', { timeout: 60000 })
  return { ctx, page }
}
const playState = (page) => page.$eval('#btn-play', el => el.textContent.trim())

test('espace depuis le body → play/pause', async ({ browser }) => {
  const { ctx, page } = await open(browser)
  expect(await playState(page)).toBe('▶')
  await page.keyboard.press('Space')
  await page.waitForTimeout(500)
  expect(await playState(page)).toBe('⏸')
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  expect(await playState(page)).toBe('▶')
  await ctx.close()
})

test('espace avec un bouton focalisé → play/pause, pas de ré-activation du bouton', async ({ browser }) => {
  const { ctx, page } = await open(browser)
  // Focus sur un bouton de tempo (son état "active" ne doit pas bouger)
  const tempoBtn = page.locator('.transport-row--tempo button').first()
  await tempoBtn.focus()
  const before = await tempoBtn.evaluate(el => el.className + '|' + el.textContent)
  await page.keyboard.press('Space')
  await page.waitForTimeout(500)
  expect(await playState(page)).toBe('⏸')
  const after = await tempoBtn.evaluate(el => el.className + '|' + el.textContent)
  expect(after).toBe(before)
  await ctx.close()
})

test('espace sur le bouton stop focalisé → pause, pas de stop', async ({ browser }) => {
  const { ctx, page } = await open(browser)
  await page.waitForFunction(() => typeof window.__playerSeek === 'function', { timeout: 60000 })
  await page.evaluate(() => window.__playerSeek(42))
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    window.__stopClicks = 0
    document.getElementById('btn-stop').addEventListener('click', () => window.__stopClicks++)
  })
  await page.locator('#btn-stop').focus()
  await page.keyboard.press('Space')            // lecture
  await page.waitForTimeout(400)
  expect(await playState(page)).toBe('⏸')
  await page.keyboard.press('Space')            // pause, surtout pas stop
  await page.waitForTimeout(300)
  expect(await playState(page)).toBe('▶')
  expect(await page.evaluate(() => window.__stopClicks)).toBe(0)   // le bouton stop n'a jamais été activé
  await ctx.close()
})

test('espace après un clic sur une case de piste → play/pause, la case ne rebascule pas', async ({ browser }) => {
  const { ctx, page } = await open(browser)
  await page.waitForSelector('#tab-track-list input[type=checkbox]', { timeout: 60000 })
  const boxes = page.locator('#tab-track-list input[type=checkbox]')
  const n = await boxes.count()
  console.log('cases de piste :', n)
  const cb = boxes.nth(n > 1 ? 1 : 0)
  await cb.click({ timeout: 10000 })                // la case garde le focus
  await page.waitForTimeout(1000)                  // re-rendu AlphaTab
  const afterClick = await cb.isChecked()
  await page.keyboard.press('Space')
  await page.waitForTimeout(600)
  expect(await cb.isChecked(), 'la case ne doit pas rebasculer').toBe(afterClick)
  expect(await playState(page)).toBe('⏸')
  await ctx.close()
})

test('espace dans un champ texte → espace saisi, pas de lecture', async ({ browser }) => {
  const { ctx, page } = await open(browser)
  const input = page.locator('#tag-add-input')
  await input.fill('ab')
  await input.press('Space')
  expect(await input.inputValue()).toBe('ab ')
  expect(await playState(page)).toBe('▶')
  await ctx.close()
})

test('espace ne fait pas défiler la page', async ({ browser }) => {
  const { ctx, page } = await open(browser)
  const y0 = await page.evaluate(() => window.scrollY)
  await page.keyboard.press('Space')
  await page.waitForTimeout(400)
  expect(await page.evaluate(() => window.scrollY)).toBe(y0)
  await ctx.close()
})
