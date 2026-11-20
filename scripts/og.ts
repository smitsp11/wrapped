// Renders scripts/og/og.html to web/public/og.png (1200×630), the image link previews show.
// Run with: npm run og   (needs Playwright's Chromium: npx playwright install chromium)
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')
const page = pathToFileURL(path.join(root, 'scripts/og/og.html')).href
const out = path.join(root, 'web/public/og.png')

const browser = await chromium.launch()
try {
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await tab.goto(page)
  await tab.evaluate(() => document.fonts.ready)
  await tab.screenshot({ path: out })
  console.log(`Wrote ${path.relative(root, out)}`)
} finally {
  await browser.close()
}
