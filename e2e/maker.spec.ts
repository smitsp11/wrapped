import { expect, test, type Page } from '@playwright/test'
import { makeFakeWrap } from '../fixtures/fakeWrap'
import { unpackWrap } from '../src/share/pack'
import type { Wrap } from '../src/types'

const groups = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, title: `Chat ${i + 1}`, messages: 900 - i, memberNames: ['Alex', 'Sam'] }))
const state = { mode: 'pick', site: 'https://wrapped.smitpatel.xyz', period: { label: '2026 so far', year: 2026 }, groups, ids: [] }

let buildCalls = 0

async function mockApi(page: Page, built: string[], wrapFor: (id: string) => Wrap = () => makeFakeWrap('group')) {
  let buildBody: unknown = null
  buildCalls = 0
  await page.route('**/api/state', (r) => r.fulfill({ json: state }))
  await page.route('**/api/build', async (r) => {
    buildCalls++
    buildBody = r.request().postDataJSON()
    await r.fulfill({ json: { ids: built, failed: [], undecodable: 0 } })
  })
  await page.route('**/api/wraps**', (r) => r.fulfill({ json: { wraps: built.map((id) => ({ id, wrap: wrapFor(id) })) } }))
  await page.route('**/api/open-messages', (r) => r.fulfill({ status: 204 }))
  await page.route('**/api/done', (r) => r.fulfill({ status: 204 }))
  return () => buildBody
}

test('picker B: top 5, see all, pick two, make wraps', async ({ page }) => {
  const sent = await mockApi(page, ['chat-1-1-2026', 'chat-3-3-2026'])
  await page.goto('/maker.html?t=tok#/pick')
  await expect(page.getByTestId('chat-card')).toHaveCount(5)
  await expect(page.getByRole('button', { name: /Make 0 wraps/ })).toBeDisabled()
  await page.getByRole('button', { name: 'See all 7 →' }).click()
  await expect(page.getByTestId('chat-card')).toHaveCount(7)
  await page.getByLabel('Chat 1', { exact: false }).check()
  await page.getByLabel('Chat 3', { exact: false }).check()
  await page.getByRole('button', { name: 'Make 2 wraps' }).click()
  expect(sent()).toEqual({ kind: 'groups', chatIds: [1, 3] })
  await expect(page).toHaveURL(/#\/wraps\?ids=chat-1-1-2026,chat-3-3-2026/)
})

test('picker B: "My year" builds the solo wrap', async ({ page }) => {
  const sent = await mockApi(page, ['me-2026'])
  await page.goto('/maker.html?t=tok#/pick')
  await page.getByRole('button', { name: /My year/ }).click()
  await expect(page).toHaveURL(/#\/wraps\?ids=me-2026/)
  expect(sent()).toEqual({ kind: 'solo' })
})

test('picker B: keyboard focus survives ticking a box and "See all"', async ({ page }) => {
  await mockApi(page, [])
  await page.goto('/maker.html?t=tok#/pick')
  const first = page.locator('input[data-chat="1"]')
  await first.focus()
  await page.keyboard.press('Space')
  await expect(first).toBeChecked()
  await expect(first).toBeFocused()
  await page.getByRole('button', { name: 'See all 7 →' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('chat-card')).toHaveCount(7)
  await expect(page.locator('input[data-chat="6"]')).toBeFocused()
})

test('picker B: a double click makes the wraps once', async ({ page }) => {
  await mockApi(page, ['chat-1-1-2026', 'chat-2-2-2026'])
  await page.goto('/maker.html?t=tok#/pick')
  await page.getByLabel('Chat 1', { exact: false }).check()
  await page.getByLabel('Chat 2', { exact: false }).check()
  await page.getByRole('button', { name: 'Make 2 wraps' }).dblclick()
  await expect(page).toHaveURL(/#\/wraps/)
  expect(buildCalls).toBe(1)
})

test('picker B: a reload keeps the token', async ({ page }) => {
  await mockApi(page, [])
  const tokens: (string | undefined)[] = []
  await page.route('**/api/state', (r) => {
    tokens.push(r.request().headers()['x-wrapped-token'])
    return r.fulfill({ json: state })
  })
  await page.goto('/maker.html?t=tok#/pick')
  await expect(page.getByTestId('chat-card')).toHaveCount(5)
  await page.reload()
  await expect(page.getByTestId('chat-card')).toHaveCount(5)
  expect(tokens).toEqual(['tok', 'tok'])
})

test('your wraps: preview, untick a quote, next, done', async ({ page }) => {
  await mockApi(page, ['a-1-2026', 'b-2-2026'])
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026,b-2-2026')
  await expect(page.getByText('1 of 2')).toBeVisible()
  await expect(page.getByText('Your word: "omw"')).toBeVisible()
  const frame = page.locator('iframe.phone')
  const before = await frame.getAttribute('src')
  await page.locator('input[data-hit="0"]').uncheck()
  await expect(frame).not.toHaveAttribute('src', before!)
  await page.getByRole('button', { name: /Next:/ }).click()
  await expect(page.getByText('2 of 2')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('All done ✓')).toBeVisible()
  await expect(page.getByText(/Tell Smit/)).toHaveCount(0)
})

test('your wraps: a ticked box keeps keyboard focus', async ({ page }) => {
  await mockApi(page, ['a-1-2026'])
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  const box = page.locator('input[data-hit="0"]')
  await box.focus()
  await page.keyboard.press('Space')
  await expect(box).not.toBeChecked()
  await expect(box).toBeFocused()
  const sig = page.locator('input[data-sig]').first()
  await sig.focus()
  await page.keyboard.press('Space')
  await expect(sig).not.toBeChecked()
  await expect(sig).toBeFocused()
})

test('your wraps: a double click on Done calls the app once', async ({ page }) => {
  await mockApi(page, ['a-1-2026'])
  let doneCalls = 0
  await page.route('**/api/done', async (r) => {
    doneCalls++
    await new Promise((resolve) => setTimeout(resolve, 200))
    await r.fulfill({ status: 204 })
  })
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  await page.getByRole('button', { name: 'Done' }).dblclick()
  await expect(page.getByText('All done ✓')).toBeVisible()
  expect(doneCalls).toBe(1)
})

test('your wraps: a failing Done shows the error and can be retried', async ({ page }) => {
  await mockApi(page, ['a-1-2026'])
  await page.route('**/api/done', (r) => r.fulfill({ status: 500 }))
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('The app answered 500.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Done' })).toBeEnabled()
})

/** Makes the 2nd pack (the first redraw after the page loads) slow, so it finishes after later ones. */
async function slowSecondPack(page: Page) {
  await page.addInitScript(() => {
    if (window !== window.top) return
    const original = Response.prototype.arrayBuffer
    let calls = 0
    Response.prototype.arrayBuffer = async function (this: Response) {
      const buffer = await original.call(this)
      if (++calls === 2) await new Promise((resolve) => setTimeout(resolve, 1500))
      return buffer
    }
  })
}

function withHits(texts: string[]): Wrap {
  const base = makeFakeWrap('group')
  const hit = base.greatestHits[0]!
  return { ...base, greatestHits: texts.map((text) => ({ ...hit, text })) }
}

async function linkOf(page: Page): Promise<Wrap> {
  const src = (await page.locator('iframe.phone').getAttribute('src'))!
  return unpackWrap(src.slice(src.indexOf('#') + 1))
}

test('your wraps: two quick ticks, the slower earlier redraw does not win', async ({ page }) => {
  await slowSecondPack(page)
  await mockApi(page, ['a-1-2026'], () => withHits(['ZEROQUOTE', 'ONEQUOTE', 'TWOQUOTE']))
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  await page.locator('input[data-hit="0"]').uncheck()
  await page.locator('input[data-hit="1"]').uncheck()
  await page.waitForTimeout(2000)
  const texts = (await linkOf(page)).greatestHits.map((h) => h.text)
  expect(texts).toEqual(['TWOQUOTE'])
  await expect(page.locator('input[data-hit="0"]')).not.toBeChecked()
  await expect(page.locator('input[data-hit="1"]')).not.toBeChecked()
})

test('your wraps: Done is not painted over by a pending redraw', async ({ page }) => {
  await slowSecondPack(page)
  await mockApi(page, ['a-1-2026'])
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  await page.locator('input[data-hit="0"]').uncheck()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('All done ✓')).toBeVisible()
  await page.waitForTimeout(2000)
  await expect(page.getByText('All done ✓')).toBeVisible()
  await expect(page.locator('iframe.phone')).toHaveCount(0)
})

test('your wraps: a tick on wrap A during Next never changes wrap B', async ({ page }) => {
  await slowSecondPack(page)
  const flagged = () => withHits(['call me at 416 555 0199', 'fine quote'])
  await mockApi(page, ['a-1-2026', 'b-2-2026'], flagged)
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026,b-2-2026')
  await page.getByRole('button', { name: /Next:/ }).click()
  // Wrap A is still on screen while B's slow redraw runs. Tick A's flagged quote.
  await expect(page.getByText('1 of 2')).toBeVisible()
  await page.locator('section[data-wrap="a-1-2026"] input[data-hit="0"]').check()
  await expect(page.getByText('2 of 2')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('input[data-hit="0"]')).not.toBeChecked()
  expect((await linkOf(page)).greatestHits.map((h) => h.text)).toEqual(['fine quote'])
})

test('your wraps: a very long unbroken quote does not scroll the page sideways', async ({ page }) => {
  await mockApi(page, ['a-1-2026'], () => ({ ...withHits(['x'.repeat(600), 'short']), title: 'T'.repeat(65) }))
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  await expect(page.getByText('1 of 1')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('picker B: a long unbroken chat title does not scroll the page sideways', async ({ page }) => {
  await mockApi(page, [])
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { ...state, groups: [{ id: 1, title: 'T'.repeat(65), messages: 9, memberNames: ['M'.repeat(65)] }] } }),
  )
  await page.goto('/maker.html?t=tok#/pick')
  await expect(page.getByTestId('chat-card')).toHaveCount(1)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('your wraps: ids given but the app returns no wraps says so', async ({ page }) => {
  await mockApi(page, [])
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  await expect(page.getByText('No wraps to show.')).toBeVisible()
})

test('your wraps: no ids says so instead of crashing', async ({ page }) => {
  await mockApi(page, [])
  await page.goto('/maker.html?t=tok#/wraps?ids=')
  await expect(page.getByText('No wraps to show.')).toBeVisible()
})

test('your wraps: Next moves focus to the new wrap heading', async ({ page }) => {
  await mockApi(page, ['a-1-2026', 'b-2-2026'])
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026,b-2-2026')
  await page.getByRole('button', { name: /Next:/ }).click()
  await expect(page.getByText('2 of 2')).toBeVisible()
  await expect(page.locator('[data-heading]')).toBeFocused()
})

test('your wraps: quotes left out for length are shown as left out', async ({ page }) => {
  // Incompressible letters (no digits or @, so none look like contact info) push the link past the limit.
  const noise = () => Array.from({ length: 700 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 58))).join('')
  const wrap = withHits(Array.from({ length: 14 }, noise))
  await mockApi(page, ['a-1-2026'], () => wrap)
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  await expect(page.getByText('left out (link too long)').first()).toBeVisible()
  const leftOut = page.locator('input[data-hit="13"]')
  await expect(leftOut).toBeEnabled()
  await expect(leftOut).toBeChecked() // user intent: still wanted, just not in the link right now
  await leftOut.uncheck()
  await expect(leftOut).not.toBeChecked()
  await expect(page.locator('label.left-out', { has: leftOut })).toHaveCount(0)
})

test('your wraps: a quote the user unticked while left out stays out when space frees up', async ({ page }) => {
  const noise = () => Array.from({ length: 700 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 58))).join('')
  const wrap = withHits(Array.from({ length: 14 }, noise))
  await mockApi(page, ['a-1-2026'], () => wrap)
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  await expect(page.getByText('left out (link too long)').first()).toBeVisible()
  await page.locator('input[data-hit="13"]').uncheck()
  for (let i = 0; i < 8; i++) {
    await page.locator(`input[data-hit="${i}"]`).uncheck()
    await expect(page.locator(`input[data-hit="${i}"]`)).not.toBeChecked()
  }
  await page.waitForTimeout(300)
  const texts = (await linkOf(page)).greatestHits.map((h) => h.text)
  expect(texts).not.toContain(wrap.greatestHits[13]!.text)
  expect(texts).toContain(wrap.greatestHits[8]!.text)
  await expect(page.locator('input[data-hit="13"]')).not.toBeChecked()
})

test('send: copy the link, open Messages with it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page, ['a-1-2026'])
  let opened: { link: string } | null = null
  await page.route('**/api/open-messages', async (r) => {
    opened = r.request().postDataJSON()
    await r.fulfill({ status: 204 })
  })
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  await page.getByRole('button', { name: 'Copy link' }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.startsWith('https://wrapped.smitpatel.xyz/#')).toBe(true)
  await page.getByRole('button', { name: 'Open Messages' }).click()
  await expect(page.getByText('Messages is open')).toBeVisible()
  expect(opened!.link).toBe(copied)
  await page.getByRole('button', { name: 'Copy cover image' }).click()
  await expect(page.getByText('Cover copied ✓')).toBeVisible()
})

test('send: a failing Open Messages shows the error; the button is disabled while it runs', async ({ page }) => {
  await mockApi(page, ['a-1-2026'])
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/api/open-messages', async (r) => {
    await gate
    await r.fulfill({ status: 500, body: '{}' })
  })
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  const open = page.getByRole('button', { name: 'Open Messages' })
  await open.click()
  await expect(open).toBeDisabled()
  release()
  await expect(page.getByText('The app answered 500.')).toBeVisible()
  await expect(open).toBeEnabled()
  await expect(open).toBeFocused()
})

test('send: unticking a quote after copying the link says the link changed', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page, ['a-1-2026'])
  await page.goto('/maker.html?t=tok#/wraps?ids=a-1-2026')
  await page.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.getByText('Link copied ✓')).toBeVisible()
  await page.locator('input[data-hit="0"]').uncheck()
  await expect(page.getByText('The link changed. Copy it again.')).toBeVisible()
  await page.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.getByText('Link copied ✓')).toBeVisible()
})

test('send: the cover is an image and solo wraps get the solo instruction', async ({ page }) => {
  await mockApi(page, ['me-2026'], () => makeFakeWrap('solo'))
  await page.goto('/maker.html?t=tok#/wraps?ids=me-2026')
  await expect(page.locator('img.cover')).toHaveAttribute('src', /^data:image\/png/)
  await expect(page.getByText('Send it to anyone you like, or keep it.')).toBeVisible()
})
