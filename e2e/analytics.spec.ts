import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { makeFakeWrap } from '../fixtures/fakeWrap'
import { FAKE_PEOPLE } from '../fixtures/makeFakeDb'
import { packWrap } from '../src/share/pack'

/**
 * The page is served as https://wrapped.smitpatel.xyz (every request to it is answered from the local dev server),
 * so the analytics turn on exactly as on the real site. Nothing here reaches the internet.
 *
 * /_vercel/insights/script.js is a stand-in that sends what Vercel's script (v0.1.3) sends: it hands beforeSend
 * the page's full address, # part included, and posts { o: <the url beforeSend returns>, r: <referrer> }.
 * Set WRAPPED_VA_SCRIPT to a saved copy of the real script (https://va.vercel-scripts.com/v1/script.js) to run
 * these tests against it instead.
 */
const SITE = 'https://wrapped.smitpatel.xyz'

const STAND_IN = `(() => {
  let before = (event) => event
  let first = true
  window.va = (name, options) => {
    if (name === 'beforeSend') before = options
    if (name !== 'pageview' || !options) return
    const event = before({ type: 'pageview', url: location.href })
    if (!event) return
    const body = { o: event.url, sv: '0.1.3', ...(first && document.referrer ? { r: document.referrer } : {}) }
    first = false
    fetch('/_vercel/insights/view', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }
  for (const [name, options] of window.vaq || []) window.va(name, options)
})()`

type Sent = { url: string; body: string }

/** Serves the site under its real name and records everything sent to Vercel's analytics or to /api/c. */
async function asProduction(page: Page, dev: string): Promise<{ insights: Sent[]; tallies: Sent[] }> {
  const insights: Sent[] = []
  const tallies: Sent[] = []
  const real = process.env.WRAPPED_VA_SCRIPT
  if (real) {
    // Vercel's script stays quiet under automation; let it run as in a normal browser.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })
      const ua = navigator.userAgent.replace('Headless', '')
      Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => ua })
    })
  }
  // Vite's live-reload socket would otherwise try the real site.
  await page.routeWebSocket(/.*/, (ws) => ws.close())
  await page.route(`${SITE}/**`, async (route) => {
    const request = route.request()
    const { pathname, search } = new URL(request.url())
    if (pathname === '/_vercel/insights/script.js') {
      return route.fulfill({ contentType: 'text/javascript', body: real ? fs.readFileSync(real, 'utf8') : STAND_IN })
    }
    if (pathname.startsWith('/_vercel/insights/')) {
      insights.push({ url: request.url(), body: request.postData() ?? '' })
      return route.fulfill({ status: 200, body: 'OK' })
    }
    if (pathname === '/api/c') {
      tallies.push({ url: request.url(), body: request.postData() ?? '' })
      return route.fulfill({ status: 204 })
    }
    // The page may close while a file is on its way (the test is over); that's not a failure.
    try {
      const response = await route.fetch({ url: dev.replace(/\/$/, '') + pathname + search })
      await route.fulfill({ response })
    } catch {}
  })
  return { insights, tallies }
}

/** The first page view's address, once the script has sent it. */
const viewed = (sent: Sent[]) => sent.filter((s) => s.url.endsWith('/_vercel/insights/view')).map((s) => JSON.parse(s.body).o as string)

async function wrapLink(): Promise<{ packed: string; secrets: string[] }> {
  const wrap = makeFakeWrap('group')
  const packed = await packWrap(wrap)
  const secrets = [packed, packed.slice(0, 24), wrap.title, ...Object.values(FAKE_PEOPLE).flatMap((p) => [p.name, p.handle])]
  return { packed, secrets }
}

/** Nothing sent carries a #, the wrap, or a name, handle or title from it. */
function expectClean(sent: Sent[], secrets: string[]): void {
  for (const { url, body } of sent) {
    const text = decodeURIComponent(url) + body
    expect(text).not.toContain('#')
    for (const secret of secrets) expect(text).not.toContain(secret)
  }
}

test('a landing page view is sent as "/" with one landing_visit tally', async ({ page, baseURL }) => {
  const { insights, tallies } = await asProduction(page, baseURL!)
  await page.goto(`${SITE}/?utm_source=x`)
  await expect(page.getByRole('link', { name: 'See a demo' })).toBeVisible() // the landing page
  await expect.poll(() => viewed(insights)).toEqual([`${SITE}/`])
  await expect.poll(() => tallies.map((t) => JSON.parse(t.body))).toEqual([{ event: 'landing_visit' }])
  expectClean([...insights, ...tallies], [])
  expect(insights.map((s) => s.url + s.body).join('')).not.toContain('utm_source')
})

test('a wrap link is sent as "/w": no #, no wrap, no names, and one link_open tally', async ({ page, baseURL }) => {
  const { packed, secrets } = await wrapLink()
  const { insights, tallies } = await asProduction(page, baseURL!)
  await page.goto(`${SITE}/#${packed}`)
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'intro')
  await expect.poll(() => viewed(insights)).toEqual([`${SITE}/w`])
  await expect.poll(() => tallies.map((t) => JSON.parse(t.body))).toEqual([{ event: 'link_open' }])
  // Tapping through doesn't send more.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  expect(viewed(insights)).toEqual([`${SITE}/w`])
  expect(tallies).toHaveLength(1)
  expectClean([...insights, ...tallies], secrets)
})

test('the demo, opened from the landing page, is sent as "/demo" with one demo_open tally', async ({ page, baseURL }) => {
  const { insights, tallies } = await asProduction(page, baseURL!)
  await page.goto(`${SITE}/`)
  await expect.poll(() => viewed(insights)).toEqual([`${SITE}/`])
  await page.getByRole('link', { name: 'See a demo' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'intro')
  await expect.poll(() => viewed(insights)).toEqual([`${SITE}/`, `${SITE}/demo`])
  await expect.poll(() => tallies.map((t) => JSON.parse(t.body))).toEqual([{ event: 'landing_visit' }, { event: 'demo_open' }])
  expectClean([...insights, ...tallies], [])
})

test('a demo link opened directly is sent as "/demo"', async ({ page, baseURL }) => {
  const { insights, tallies } = await asProduction(page, baseURL!)
  await page.goto(`${SITE}/#demo`)
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'intro')
  await expect.poll(() => viewed(insights)).toEqual([`${SITE}/demo`])
  await expect.poll(() => tallies.map((t) => JSON.parse(t.body))).toEqual([{ event: 'demo_open' }])
  expectClean([...insights, ...tallies], [])
})

test('off the real site (localhost, the maker preview) nothing is loaded or sent', async ({ page }) => {
  const { packed } = await wrapLink()
  const requests: string[] = []
  page.on('request', (r) => requests.push(new URL(r.url()).pathname))
  await page.goto(`/#${packed}`)
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'intro')
  await page.goto('/#demo')
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'intro')
  await page.waitForTimeout(300)
  expect(requests.filter((p) => p.startsWith('/_vercel/') || p === '/api/c')).toEqual([])
  expect(await page.evaluate(() => 'va' in window)).toBe(false)
})
