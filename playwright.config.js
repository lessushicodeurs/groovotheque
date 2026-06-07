const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir:   './tests',
  timeout:   90000,   // AlphaTab charge depuis CDN + rendu GP → long
  retries:   0,
  reporter:  [['list']],
  use: {
    headless:     true,
    launchOptions: {
      // Désactive les limites de rate sur les ressources CDN
      args: ['--disable-web-security', '--ignore-certificate-errors'],
    },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
