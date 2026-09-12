/**
 * Test Playwright — isolation d'une piste qui partage son canal MIDI (epic 39).
 *
 * `AudioExportOptions.trackVolume` est indexé par piste, mais AlphaTab le
 * retraduit en canaux MIDI juste avant l'export : deux pistes sur le même canal
 * écrivent dans la même case et la dernière gagne. Or **toutes les percussions
 * d'un fichier Guitar Pro sont sur le canal 10** (indice 9). Sans précaution,
 * isoler une percussion donne un rendu muet ou un rendu contenant toutes les
 * percussions mélangées — constaté sur « Just the two of us ».
 *
 * La série vérifie le démêlage des canaux, sans synthétiser quoi que ce soit :
 * `isolateTrackChannels()` est appelée sur des partitions factices, puis les
 * canaux d'origine doivent revenir intacts.
 *
 * Usage : npx playwright test tests/midi-channel-isolation.spec.js
 */

const { test, expect } = require('@playwright/test')
const { spawn } = require('child_process')
const path = require('path'), fs = require('fs'), bcrypt = require('bcrypt')

const ROOT      = path.join(__dirname, '..')
const AUTH_FILE = path.join(ROOT, '.auth')
const TEST_USER = 'playwright_chan'
const TEST_PASS = 'pw_chan_secret_2024'
const PORT      = 3204
const BASE_URL  = `http://localhost:${PORT}`

let serverProcess = null

async function waitForPort(port, timeout = 15000) {
  const net = require('net'); const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      const c = net.connect(port, '127.0.0.1', () => { c.destroy(); resolve() })
      c.on('error', () => Date.now() - start > timeout ? reject(new Error('port')) : setTimeout(check, 200))
    }
    check()
  })
}

test.beforeAll(async () => {
  const original = fs.readFileSync(AUTH_FILE, 'utf8')
  if (!original.includes(`${TEST_USER}:`)) {
    fs.writeFileSync(AUTH_FILE, `${TEST_USER}:${bcrypt.hashSync(TEST_PASS, 5)}\n` + original)
  }
  serverProcess = spawn('node', ['server.js'],
    { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' })
  await waitForPort(PORT)
})

test.afterAll(() => {
  try {
    const c = fs.readFileSync(AUTH_FILE, 'utf8')
    fs.writeFileSync(AUTH_FILE, c.split('\n').filter(l => !l.startsWith(`${TEST_USER}:`)).join('\n'))
  } catch {}
  serverProcess?.kill()
})

// Le module est un fichier statique du player : une page quelconque de la même
// origine suffit à l'importer, sans ouvrir de groove ni instancier AlphaTab.
async function openSandbox(browser) {
  const context = await browser.newContext({
    httpCredentials: { username: TEST_USER, password: TEST_PASS },
  })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/index.html`)
  return page
}

/**
 * Joue `isolateTrackChannels()` sur une partition factice et rend, pour chaque
 * piste, ses canaux pendant l'export puis après restauration.
 */
async function isolate(page, tracks, trackIndex) {
  return await page.evaluate(async ({ tracks, trackIndex }) => {
    const { isolateTrackChannels, restoreTrackChannels } = await import('/js/midi-render.js')
    const score = {
      tracks: tracks.map((t, i) => ({
        index: i, name: t.name ?? `Piste ${i}`,
        playbackInfo: { primaryChannel: t.primary, secondaryChannel: t.secondary },
      })),
    }
    const snap = () => score.tracks.map(t =>
      [t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel])
    try {
      const relocated = isolateTrackChannels(score, trackIndex)
      const during = snap()
      restoreTrackChannels(relocated)
      return { during, after: snap() }
    } catch (e) {
      return { error: e.message, after: snap() }
    }
  }, { tracks, trackIndex })
}

// La partition de « Just the two of us » : une basse, quatre percussions toutes
// sur le canal 10 (indice 9).
const JUST_THE_TWO_OF_US = [
  { name: 'Bass',      primary: 0, secondary: 1 },
  { name: 'Drums',     primary: 9, secondary: 9 },
  { name: 'Congas',    primary: 9, secondary: 9 },
  { name: 'Tambourin', primary: 9, secondary: 9 },
  { name: 'Agogo',     primary: 9, secondary: 9 },
]

test('chaque percussion se retrouve seule sur son canal, et le canal 10 reste à la piste visée', async ({ browser }) => {
  const page = await openSandbox(browser)
  for (const trackIndex of [1, 2, 3, 4]) {
    const { during, after, error } = await isolate(page, JUST_THE_TWO_OF_US, trackIndex)
    expect(error, `piste ${trackIndex}`).toBeUndefined()

    // La piste visée garde le canal de percussion : c'est lui qui porte le kit
    // de batterie du soundfont.
    expect(during[trackIndex], `piste ${trackIndex}`).toEqual([9, 9])

    // Plus aucune autre piste ne partage ses canaux, et personne n'atterrit sur
    // le canal du métronome (indice 16).
    const others = during.filter((_, i) => i !== trackIndex)
    for (const [p, s] of others) {
      expect(p).not.toBe(9)
      expect(s).not.toBe(9)
      expect(p).not.toBe(16)
      expect(s).not.toBe(16)
    }
    // Aucun canal n'est occupé deux fois : sinon on aurait juste déplacé la
    // collision ailleurs.
    const all = during.flatMap(([p, s]) => p === s ? [p] : [p, s])
    expect(new Set(all).size).toBe(all.length)

    // Les canaux d'origine reviennent : le synthétiseur du player les retrouve
    // intacts après l'export.
    expect(after).toEqual(JUST_THE_TWO_OF_US.map(t => [t.primary, t.secondary]))
  }
  await page.close()
})

test('une piste sans canal partagé n’est pas touchée', async ({ browser }) => {
  const page = await openSandbox(browser)
  const { during, after, error } = await isolate(page, JUST_THE_TWO_OF_US, 0)
  expect(error).toBeUndefined()
  const origin = JUST_THE_TWO_OF_US.map(t => [t.primary, t.secondary])
  expect(during).toEqual(origin)
  expect(after).toEqual(origin)
  await page.close()
})

test('la piste isolée quitte le canal du métronome', async ({ browser }) => {
  const page = await openSandbox(browser)
  // Forme de « Babooshka » : « Piano RH » occupe les canaux d'indice 15 et 16,
  // le 16 étant celui que l'exporteur réserve à son métronome.
  const tracks = [
    { name: 'Piano RH',      primary: 15, secondary: 16 },
    { name: 'Fretless Bass', primary: 17, secondary: 18 },
  ]
  const { during, after, error } = await isolate(page, tracks, 0)
  expect(error).toBeUndefined()
  expect(during[0][0]).toBe(15)
  expect(during[0][1]).not.toBe(16)
  expect(during[1]).toEqual([17, 18])       // les autres pistes ne bougent pas
  expect(after).toEqual([[15, 16], [17, 18]])
  await page.close()
})

test('sans canal libre, le rendu est refusé avec un message explicite et rien ne reste déplacé', async ({ browser }) => {
  const page = await openSandbox(browser)
  // Tous les canaux atteignables sont pris, et deux pistes partagent le canal 9 :
  // impossible de les séparer.
  const tracks = []
  for (let c = 0; c <= 64; c++) tracks.push({ name: `Bouche-trou ${c}`, primary: c, secondary: c })
  tracks.push({ name: 'Congas', primary: 9, secondary: 9 })
  const origin = tracks.map(t => [t.primary, t.secondary])

  const { error, after } = await isolate(page, tracks, 9)
  expect(error).toContain('aucun canal libre')
  expect(after).toEqual(origin)
  await page.close()
})
