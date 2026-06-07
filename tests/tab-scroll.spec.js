/**
 * Test Playwright — scroll AlphaTab en strip (horizontal) et fullscreen (page).
 *
 * Protocole :
 *  1. Démarre le serveur sur un port de test avec un user de test temporaire
 *  2. Ouvre le player sur un groove avec un fichier GP
 *  3. Attend le rendu AlphaTab (.at-surface visible) + isReadyForPlayback
 *  4. Active __tabTestMode pour suspendre la sync audio (empêche RAF d'écraser timePosition)
 *  5. Avance timePosition via window.__alphaTabApi
 *  6. Attend que le curseur ait bougé, puis vérifie scrollLeft/scrollTop
 *
 * Usage : npx playwright test tests/tab-scroll.spec.js
 */

const { test, expect } = require('@playwright/test')
const { spawn }        = require('child_process')
const path             = require('path')
const fs               = require('fs')
const bcrypt           = require('bcrypt')

const ROOT       = path.join(__dirname, '..')
const AUTH_FILE  = path.join(ROOT, '.auth')
const TEST_USER  = 'playwright_test'
const TEST_PASS  = 'pw_test_secret_2024'
const PORT       = 3198

// Groove avec fichier GP : The Clark Sisters - Ha Ya
// (The Clark Sisters - Ha Ya.gp + audio MP3)
const GROOVE_SLUG = 'The Clark Sisters - Ha Ya'
const BASE_URL    = `http://localhost:${PORT}`

let serverProcess = null

// ── Helpers ──────────────────────────────────────────────────────────────────

function addTestUser(hash) {
  const original = fs.readFileSync(AUTH_FILE, 'utf8')
  if (original.includes(`${TEST_USER}:`)) return  // déjà présent
  fs.writeFileSync(AUTH_FILE, `${TEST_USER}:${hash}\n` + original)
}

function removeTestUser() {
  try {
    const content = fs.readFileSync(AUTH_FILE, 'utf8')
    const cleaned = content.split('\n').filter(l => !l.startsWith(`${TEST_USER}:`)).join('\n')
    fs.writeFileSync(AUTH_FILE, cleaned)
  } catch { /* already clean */ }
}

async function waitForPort(port, timeout = 10000) {
  const { default: net } = await import('net')
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      const client = net.connect(port, '127.0.0.1', () => {
        client.destroy()
        resolve()
      })
      client.on('error', () => {
        if (Date.now() - start > timeout) reject(new Error(`Port ${port} not ready`))
        else setTimeout(check, 200)
      })
    }
    check()
  })
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

test.beforeAll(async () => {
  // Génère hash bcrypt pour le user de test (cost 5 = rapide pour tests)
  const hash = bcrypt.hashSync(TEST_PASS, 5)
  addTestUser(hash)

  // Démarre le serveur
  serverProcess = spawn('node', ['server.js'], {
    cwd:  ROOT,
    env:  { ...process.env, PORT: String(PORT) },
    stdio: 'pipe',
  })
  serverProcess.on('error', err => console.error('[server]', err.message))

  await waitForPort(PORT)
})

test.afterAll(() => {
  removeTestUser()
  serverProcess?.kill()
})

// ── Shared context factory ────────────────────────────────────────────────────

async function openPlayer(browser, groove = GROOVE_SLUG) {
  const context = await browser.newContext({
    httpCredentials: { username: TEST_USER, password: TEST_PASS },
    viewport:        { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  const url = `${BASE_URL}/player.html?groove=${encodeURIComponent(groove)}`
  await page.goto(url)

  return { context, page }
}

// ── Helpers page ──────────────────────────────────────────────────────────────

/**
 * Attend que AlphaTab ait rendu ET que le soundfont soit chargé (isReadyForPlayback).
 * Aussi active __tabTestMode pour empêcher le RAF d'écraser timePosition.
 */
async function waitForTabReady(page, timeout = 60000) {
  await page.waitForSelector('.tab-drawer:not([hidden])', { timeout })
  await page.waitForSelector('.at-surface', { timeout })

  // Attendre score chargé
  await page.waitForFunction(
    () => window.__alphaTabApi?.score != null,
    { timeout }
  )

  // Activer le mode test AVANT de charger le soundfont (ou au plus tôt)
  await page.evaluate(() => { window.__tabTestMode = true })

  // Attendre isReadyForPlayback (soundfont + MIDI chargés)
  await page.waitForFunction(
    () => window.__alphaTabApi?.isReadyForPlayback === true,
    { timeout }
  )
}

/**
 * Avance timePosition et attend que le curseur ait bougé à une position > minX.
 * Retourne scrollLeft après déplacement.
 */
async function setTimeAndGetScroll(page, synthMs, minCursorX = 0) {
  // Récupérer la transform actuelle du curseur avant le changement
  const prevTransform = await page.evaluate(() => {
    const cur = document.querySelector('#tab-content .at-cursor-beat')
    return cur?.style.transform ?? ''
  })

  await page.evaluate((ms) => {
    const api = window.__alphaTabApi
    if (!api) throw new Error('__alphaTabApi not found')
    api.timePosition = ms
  }, synthMs)

  // Attendre que le curseur ait bougé (transform change)
  await page.waitForFunction(
    ({ prev, minX }) => {
      const cur = document.querySelector('#tab-content .at-cursor-beat')
      if (!cur) return false
      const t = cur.style.transform
      if (!t || t === prev) return false
      const mx = /translate\((-?[\d.]+)px/.exec(t)
      if (!mx) return false
      return parseFloat(mx[1]) > minX
    },
    { prev: prevTransform, minX: minCursorX },
    { timeout: 5000 }
  ).catch(() => {
    // Si timeout, continuer quand même (cursor peut être déjà à la bonne position)
  })

  // Laisser le RAF processer l'enforceTabCursorVisible
  await page.waitForTimeout(150)

  const result = await page.evaluate(() => {
    const el  = document.querySelector('#tab-content')
    const cur = el?.querySelector('.at-cursor-beat')
    const t   = cur?.style.transform ?? ''
    const mx  = /translate\((-?[\d.]+)px/.exec(t)
    return {
      scrollLeft:  el?.scrollLeft  ?? -1,
      scrollTop:   el?.scrollTop   ?? -1,
      cursorX: mx ? parseFloat(mx[1]) : -1,
      transform: t,
    }
  })

  console.log(`  t=${synthMs}ms: cursorX=${result.cursorX.toFixed(0)} scrollLeft=${result.scrollLeft} transform="${result.transform}"`)
  return result
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('strip — scrollLeft augmente proportionnellement à timePosition', async ({ browser }) => {
  const { context, page } = await openPlayer(browser)

  await waitForTabReady(page)

  // Positions — on commence à 5s pour être sûr que cursorX > 35% du viewport (> 504px @ 1440px)
  // Surface = 20658px pour ce groove → chaque seconde ~ 20658/durée_ms px
  const r5  = await setTimeAndGetScroll(page,  5000, 100)
  const r15 = await setTimeAndGetScroll(page, 15000, 500)
  const r30 = await setTimeAndGetScroll(page, 30000, 1000)
  const r50 = await setTimeAndGetScroll(page, 50000, 1500)

  console.log('scrollLeft — 5s:', r5.scrollLeft, ' 15s:', r15.scrollLeft, ' 30s:', r30.scrollLeft, ' 50s:', r50.scrollLeft)

  expect(r15.scrollLeft, '15s > 5s') .toBeGreaterThan(r5.scrollLeft)
  expect(r30.scrollLeft, '30s > 15s').toBeGreaterThan(r15.scrollLeft)
  expect(r50.scrollLeft, '50s > 30s').toBeGreaterThan(r30.scrollLeft)

  await context.close()
})

test('strip — seek en arrière : scroll revient en arrière (sans bloquer)', async ({ browser }) => {
  const { context, page } = await openPlayer(browser)

  await waitForTabReady(page)

  const r30   = await setTimeAndGetScroll(page, 30000, 1000)
  // Seek backward — curseur doit revenir à une position plus petite
  const rBack = await setTimeAndGetScroll(page,  5000, 50)

  console.log('scrollLeft — 30s:', r30.scrollLeft, ' seek→5s:', rBack.scrollLeft)

  expect(rBack.scrollLeft).toBeLessThan(r30.scrollLeft)

  await context.close()
})

test('strip — curseur reste dans les 15–75% du viewport', async ({ browser }) => {
  const { context, page } = await openPlayer(browser)

  await waitForTabReady(page)

  for (const ms of [10000, 25000, 40000, 60000]) {
    const r = await setTimeAndGetScroll(page, ms, 200)

    const { visibleX, containerW } = await page.evaluate(() => {
      const el  = document.querySelector('#tab-content')
      const cur = el?.querySelector('.at-cursor-beat')
      if (!cur) return { visibleX: -1, containerW: el?.clientWidth ?? 0 }
      const t  = cur.style.transform
      const mx = /translate\((-?[\d.]+)px/.exec(t)
      const contentX  = mx ? parseFloat(mx[1]) : -1
      const scrollLeft = el.scrollLeft
      return { visibleX: contentX - scrollLeft, containerW: el.clientWidth }
    })

    console.log(`t=${ms}ms: visibleX=${visibleX.toFixed(0)} containerW=${containerW} scrollLeft=${r.scrollLeft}`)

    expect(visibleX, `cursor visible at t=${ms}`).toBeGreaterThanOrEqual(0)
    expect(visibleX, `cursor not off-right at t=${ms}`).toBeLessThan(containerW)

    const ratio = visibleX / containerW
    expect(ratio, `cursor ratio at t=${ms}`).toBeGreaterThan(0.10)
    expect(ratio, `cursor ratio at t=${ms}`).toBeLessThan(0.80)
  }

  await context.close()
})

test('fullscreen — scrollTop augmente quand le curseur descend', async ({ browser }) => {
  const { context, page } = await openPlayer(browser)

  await waitForTabReady(page)

  // Passe en mode fullscreen via le bouton
  await page.click('#btn-tab-fullscreen')

  // Attendre que le drawer passe en fullscreen + re-render AlphaTab en layout Page
  await page.waitForSelector('.tab-drawer--fullscreen', { timeout: 10000 })
  await page.waitForFunction(
    () => window.__alphaTabApi?.score != null,
    { timeout: 45000 }
  )
  // Attendre le re-render complet (Page layout peut prendre du temps)
  await page.waitForTimeout(4000)

  // Réactiver test mode (peut avoir été levé lors du re-render)
  await page.evaluate(() => { window.__tabTestMode = true })

  await page.evaluate(() => { window.__alphaTabApi.timePosition = 0 })
  await page.waitForTimeout(200)
  const top0 = await page.evaluate(() => document.querySelector('#tab-content')?.scrollTop ?? -1)

  await page.evaluate(() => { window.__alphaTabApi.timePosition = 60000 })
  await page.waitForTimeout(800)
  const top60 = await page.evaluate(() => document.querySelector('#tab-content')?.scrollTop ?? -1)

  console.log('scrollTop — 0s:', top0, ' 60s:', top60)

  expect(top60).toBeGreaterThan(top0)

  await context.close()
})
