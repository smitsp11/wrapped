import { expect, test, type Page } from '@playwright/test'
import { makeFakeWrap } from '../fixtures/fakeWrap'
import { unpackWrap } from '../src/share/pack'
import type { Wrap } from '../src/types'

const SITE = 'https://wrapped.smitpatel.xyz'
const groups = Array.from({ length: 7 }, (_, i) => ({
  id: i + 1, title: `Chat ${i + 1}`, messages: 900 - i, memberNames: i === 2 ? ['Priya', 'Sam', 'Jordan', 'Lee', 'Max'] : ['Alex', 'Sam'],
  wrapId: `chat-${i + 1}-${i + 1}-2026`, made: false,
}))
type State = {
  site: string
  period: { label: string; year: number }
  solo: { wrapId: string; made: boolean }
  groups: typeof groups
  senderName: string
  update: { current: string; latest: string } | null
}
const baseState: State = { site: SITE, period: { label: '2026 so far', year: 2026 }, solo: { wrapId: 'me-2026', made: false }, groups, senderName: '', update: null }

let buildCalls = 0
let buildBodies: unknown[] = []

type Mock = { state?: State; wrapFor?: (id: string) => Wrap | null; built?: (body: { kind: string; chatIds?: number[] }) => string[] }

/** Fakes the local app. The page's session request is left open, like the real app does while it runs. */
async function mockApi(page: Page, mock: Mock = {}) {
  const state = mock.state ?? baseState
  const wrapFor = mock.wrapFor ?? ((id: string) => makeFakeWrap(id.startsWith('me-') ? 'solo' : 'group'))
  const built =
    mock.built ?? ((body) => (body.kind === 'solo' ? ['me-2026'] : body.chatIds!.map((id) => groups.find((g) => g.id === id)!.wrapId)))
  buildCalls = 0
  buildBodies = []
  // Like the real app, a wrap counts as made once it's built, so later pages don't build it again.
  const madeIds = new Set<string>()
  const current = (): State => ({
    ...state,
    solo: { ...state.solo, made: state.solo.made || madeIds.has(state.solo.wrapId) },
    groups: state.groups.map((g) => ({ ...g, made: g.made || madeIds.has(g.wrapId) })),
  })
  await page.route('**/api/state', (r) => r.fulfill({ json: current() }))
  await page.route('**/api/session', () => new Promise(() => undefined))
  await page.route('**/api/build', async (r) => {
    buildCalls++
    const body = r.request().postDataJSON()
    buildBodies.push(body)
    const ids = built(body)
    for (const id of ids) madeIds.add(id)
    await r.fulfill({ json: { ids, failed: [], undecodable: 0 } })
  })
  await page.route('**/api/wraps**', (r) => {
    const ids = (new URL(r.request().url()).searchParams.get('ids') ?? '').split(',').filter(Boolean)
    const wraps = ids.flatMap((id) => {
      const wrap = wrapFor(id)
      return wrap ? [{ id, wrap }] : []
    })
    return r.fulfill({ json: { wraps } })
  })
  await page.route('**/api/open-messages', (r) => r.fulfill({ status: 204 }))
  await page.route('**/api/close', (r) => r.fulfill({ status: 204 }))
  await page.route('**/api/sender-name', (r) => r.fulfill({ status: 204 }))
}

const rows = (page: Page) => page.getByTestId('chat-row')

// ---------- Home ----------

test('home: My year, then every group chat busiest first, with search', async ({ page }) => {
  await mockApi(page)
  await page.goto('/maker.html?t=tok')
  await expect(page.getByRole('heading', { name: 'What should we wrap?' })).toBeVisible()
  await expect(page.getByText('✨ My year')).toBeVisible()
  await expect(rows(page)).toHaveCount(7)
  await expect(rows(page).first()).toContainText('Chat 1')
  await expect(rows(page).first()).toContainText('900 messages')
  await expect(rows(page).nth(2)).toContainText('Priya, Sam, Jordan +2')
  await page.getByRole('searchbox', { name: 'Search your group chats' }).fill('priya')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page)).toContainText('Chat 3')
  await page.getByRole('searchbox').fill('chat 6')
  await expect(rows(page)).toHaveCount(1)
  await page.getByRole('searchbox').fill('nobody')
  await expect(page.getByText('No group chats match "nobody".')).toBeVisible()
})

test('home: Wrap it makes just that chat and opens it', async ({ page }) => {
  await mockApi(page)
  await page.goto('/maker.html?t=tok')
  await page.getByRole('button', { name: 'Wrap Chat 3' }).click()
  await expect(page).toHaveURL(/#\/wrap\/chat-3-3-2026$/)
  expect(buildBodies).toEqual([{ kind: 'groups', chatIds: [3] }])
  await expect(page.getByRole('button', { name: 'Send to group chat' })).toBeVisible()
})

test('home: Make my year builds the solo wrap', async ({ page }) => {
  await mockApi(page)
  await page.goto('/maker.html?t=tok')
  await page.getByRole('button', { name: 'Make my year' }).click()
  await expect(page).toHaveURL(/#\/wrap\/me-2026$/)
  expect(buildBodies).toEqual([{ kind: 'solo' }])
})

test('home: wraps made before show Made ✓ · Watch and open without building again', async ({ page }) => {
  const state = { ...baseState, solo: { wrapId: 'me-2026', made: true }, groups: groups.map((g) => ({ ...g, made: g.id === 2 })) }
  await mockApi(page, { state })
  await page.goto('/maker.html?t=tok')
  await expect(page.getByRole('button', { name: 'Made ✓ · Watch' })).toHaveCount(2)
  await expect(rows(page).nth(1).getByRole('button', { name: 'Made ✓ · Watch' })).toBeVisible()
  await rows(page).nth(1).getByRole('button', { name: 'Made ✓ · Watch' }).click()
  await expect(page).toHaveURL(/#\/wrap\/chat-2-2-2026$/)
  expect(buildCalls).toBe(0)
})

test('home: a double click makes the wrap once', async ({ page }) => {
  await mockApi(page)
  await page.goto('/maker.html?t=tok')
  await page.getByRole('button', { name: 'Wrap Chat 1' }).dblclick()
  await expect(page).toHaveURL(/#\/wrap\//)
  expect(buildCalls).toBe(1)
})

test('home: a chat that fails to build says why and can be tried again', async ({ page }) => {
  await mockApi(page)
  await page.route('**/api/build', (r) => r.fulfill({ json: { ids: [], failed: [{ title: 'Chat 1', message: 'No messages in this period.' }], undecodable: 0 } }))
  await page.goto('/maker.html?t=tok')
  await page.getByRole('button', { name: 'Wrap Chat 1' }).click()
  await expect(page.getByText('Chat 1: No messages in this period.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Wrap Chat 1' })).toBeEnabled()
  await expect(page).not.toHaveURL(/#\/wrap\//)
})

test('home: a reload keeps the token', async ({ page }) => {
  await mockApi(page)
  const tokens: (string | undefined)[] = []
  await page.route('**/api/state', (r) => {
    tokens.push(r.request().headers()['x-wrapped-token'])
    return r.fulfill({ json: baseState })
  })
  await page.goto('/maker.html?t=tok')
  await expect(rows(page)).toHaveCount(7)
  await expect(page).toHaveURL(/maker\.html$/) // the token is kept out of the address bar
  await page.reload()
  await expect(rows(page)).toHaveCount(7)
  expect(tokens).toEqual(['tok', 'tok'])
})

test('home: a long unbroken chat title does not scroll the page sideways', async ({ page }) => {
  await mockApi(page, { state: { ...baseState, groups: [{ ...groups[0]!, title: 'T'.repeat(65), memberNames: ['M'.repeat(65)] }] } })
  await page.goto('/maker.html?t=tok')
  await expect(rows(page)).toHaveCount(1)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('home: an update notice shows and can be dismissed', async ({ page }) => {
  await mockApi(page, { state: { ...baseState, update: { current: '0.2.0-beta.3', latest: '0.2.0-beta.4' } } })
  await page.goto('/maker.html?t=tok')
  const notice = page.getByText('Update available: 0.2.0-beta.3 → 0.2.0-beta.4. Run: wrapped update')
  await expect(notice).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss the update notice' }).click()
  await expect(notice).toHaveCount(0)
})

test('home: when the app answers with an error, the page says so', async ({ page }) => {
  await mockApi(page)
  await page.route('**/api/state', (r) => r.fulfill({ status: 500 }))
  await page.goto('/maker.html?t=tok')
  await expect(page.getByText('Something went wrong')).toBeVisible()
  await expect(page.getByText('The app answered 500.')).toBeVisible()
})

test('maker UI never reassures about uploads or AI', async ({ page }) => {
  await mockApi(page)
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await page.getByRole('button', { name: 'Change' }).click()
  await page.getByRole('button', { name: 'Send to group chat' }).click()
  await expect(page.getByText('Now post yours')).toBeVisible()
  const text = (await page.locator('body').innerText()).toLowerCase()
  for (const phrase of ['upload', 'no ai', 'leaves your mac', 'stays on your mac', 'private']) expect(text).not.toContain(phrase)
})

// ---------- One wrap ----------

function withHits(texts: string[]): Wrap {
  const base = makeFakeWrap('group')
  const hit = base.greatestHits[0]!
  return { ...base, greatestHits: texts.map((text) => ({ ...hit, text })) }
}

async function linkOf(page: Page): Promise<Wrap> {
  await expect(page.locator('iframe.phone')).toHaveAttribute('src', /#/)
  const src = (await page.locator('iframe.phone').getAttribute('src'))!
  return unpackWrap(src.slice(src.indexOf('#') + 1))
}

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

const openReview = (page: Page) => page.getByRole('button', { name: 'Change' }).click()

test('wrap: what is in the link is one line; Change opens the tick boxes', async ({ page }) => {
  await mockApi(page, { wrapFor: () => withHits(['one', 'two', 'three']) })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.getByText('Includes stats, first names and 3 quotes')).toBeVisible()
  await expect(page.locator('input[data-hit]')).toHaveCount(0)
  await openReview(page)
  await expect(page.locator('input[data-hit]')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true')
  const frame = page.locator('iframe.phone')
  const before = await frame.getAttribute('src')
  await page.locator('input[data-hit="0"]').uncheck()
  await expect(frame).not.toHaveAttribute('src', before!)
  await expect(page.getByText('Includes stats, first names and 2 quotes')).toBeVisible()
  await page.getByRole('button', { name: 'Hide' }).click()
  await expect(page.locator('input[data-hit]')).toHaveCount(0)
})

test('wrap: a quote with a phone number starts unticked and stays out of the link', async ({ page }) => {
  await mockApi(page, { wrapFor: () => withHits(['call me at 416 555 0199', 'fine quote']) })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.getByText('Includes stats, first names and 1 quote ·')).toBeVisible()
  expect((await linkOf(page)).greatestHits.map((h) => h.text)).toEqual(['fine quote'])
  await openReview(page)
  await expect(page.locator('input[data-hit="0"]')).not.toBeChecked()
  await expect(page.getByText('looks like a phone number or email')).toBeVisible()
})

test('wrap: signature words are listed and a ticked box keeps keyboard focus', async ({ page }) => {
  await mockApi(page)
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await openReview(page)
  await expect(page.getByText('Your word: "omw"')).toBeVisible()
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

test('wrap: two quick ticks, the slower earlier redraw does not win', async ({ page }) => {
  await slowSecondPack(page)
  await mockApi(page, { wrapFor: () => withHits(['ZEROQUOTE', 'ONEQUOTE', 'TWOQUOTE']) })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await openReview(page)
  await page.locator('input[data-hit="0"]').uncheck() // the 2nd pack: slow
  await page.locator('input[data-hit="1"]').uncheck() // the 3rd: fast, and the one that counts
  await page.waitForTimeout(2000)
  expect((await linkOf(page)).greatestHits.map((h) => h.text)).toEqual(['TWOQUOTE'])
  await expect(page.locator('input[data-hit="0"]')).not.toBeChecked()
  await expect(page.locator('input[data-hit="1"]')).not.toBeChecked()
})

test('wrap: a tick on wrap A while wrap B opens never changes wrap B', async ({ page }) => {
  await mockApi(page, { wrapFor: () => withHits(['call me at 416 555 0199', 'fine quote']) })
  // Wrap B's wrap arrives slowly, so wrap A is still on screen after the page has moved on to B.
  await page.route('**/api/wraps?ids=chat-2-2-2026', async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await r.fulfill({ json: { wraps: [{ id: 'chat-2-2-2026', wrap: withHits(['call me at 416 555 0199', 'fine quote']) }] } })
  })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await openReview(page)
  await expect(page.locator('section[data-wrap="chat-1-1-2026"] input[data-hit="0"]')).toBeVisible()
  await page.evaluate(() => (location.hash = '#/wrap/chat-2-2-2026'))
  // Wrap A is still on screen while B loads. Tick A's flagged quote.
  await page.locator('section[data-wrap="chat-1-1-2026"] input[data-hit="0"]').check()
  await expect(page.locator('section[data-wrap="chat-2-2-2026"]')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(500)
  await expect(page.locator('section[data-wrap="chat-1-1-2026"]')).toHaveCount(0)
  expect((await linkOf(page)).greatestHits.map((h) => h.text)).toEqual(['fine quote'])
  await openReview(page)
  await expect(page.locator('input[data-hit="0"]')).not.toBeChecked()
})

test('wrap: a pending redraw does not paint over the closed page', async ({ page }) => {
  await slowSecondPack(page)
  await mockApi(page)
  page.on('dialog', (d) => void d.accept())
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await openReview(page)
  await page.locator('input[data-hit="0"]').uncheck() // the 2nd pack: slow
  await page.getByRole('button', { name: 'Close iMessage Wrapped' }).click()
  await expect(page.getByText('iMessage Wrapped is closed.')).toBeVisible()
  await page.waitForTimeout(2000)
  await expect(page.getByText('iMessage Wrapped is closed.')).toBeVisible()
  await expect(page.locator('iframe.phone')).toHaveCount(0)
})

test('wrap: a very long unbroken quote does not scroll the page sideways', async ({ page }) => {
  await mockApi(page, { wrapFor: () => ({ ...withHits(['x'.repeat(600), 'short']), title: 'T'.repeat(65) }) })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await openReview(page)
  await expect(page.locator('input[data-hit="0"]')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('wrap: an id the app does not know says so', async ({ page }) => {
  await mockApi(page, { wrapFor: () => null })
  await page.goto('/maker.html?t=tok#/wrap/nope-2026')
  await expect(page.getByText('No wrap to show.')).toBeVisible()
  await page.getByRole('link', { name: '← All chats' }).click()
  await expect(rows(page)).toHaveCount(7)
})

test('wrap: quotes left out for length are shown as left out', async ({ page }) => {
  // Incompressible letters (no digits or @, so none look like contact info) push the link past the limit.
  const noise = () => Array.from({ length: 700 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 58))).join('')
  const wrap = withHits(Array.from({ length: 14 }, noise))
  await mockApi(page, { wrapFor: () => wrap })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await openReview(page)
  await expect(page.getByText('left out (link too long)').first()).toBeVisible()
  const leftOut = page.locator('input[data-hit="13"]')
  await expect(leftOut).toBeEnabled()
  await expect(leftOut).toBeChecked() // user intent: still wanted, just not in the link right now
  await leftOut.uncheck()
  await expect(leftOut).not.toBeChecked()
  await expect(page.locator('label.left-out', { has: leftOut })).toHaveCount(0)
})

test('wrap: a quote the user unticked while left out stays out when space frees up', async ({ page }) => {
  const noise = () => Array.from({ length: 700 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 58))).join('')
  const wrap = withHits(Array.from({ length: 14 }, noise))
  await mockApi(page, { wrapFor: () => wrap })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await openReview(page)
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

test('wrap: the sender is named instead of "You" in a shared group wrap, and the name is remembered', async ({ page }) => {
  await mockApi(page, { state: { ...baseState, senderName: 'Smit' } })
  const saved: unknown[] = []
  await page.route('**/api/sender-name', async (r) => {
    saved.push(r.request().postDataJSON())
    await r.fulfill({ status: 204 })
  })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  const field = page.getByLabel('Your name in the wrap')
  await expect(field).toHaveValue('Smit')
  await expect.poll(async () => (await linkOf(page)).people.me).toBe('Smit') // the preview shows what friends see
  await openReview(page)
  await expect(page.getByText('Smit\'s word: "omw"')).toBeVisible()
  await field.fill('Smitty')
  await field.press('Enter')
  await expect.poll(async () => (await linkOf(page)).people.me).toBe('Smitty')
  await field.fill('')
  await field.press('Tab')
  await expect.poll(async () => (await linkOf(page)).people.me).toBe('You') // empty keeps "You"
  await expect(page.getByText('Your word: "omw"')).toBeVisible()
  expect(saved).toEqual([{ name: 'Smitty' }, { name: '' }])
})

test('wrap: My year keeps "You" and has no name field', async ({ page }) => {
  await mockApi(page, { state: { ...baseState, senderName: 'Smit', solo: { wrapId: 'me-2026', made: true } } })
  await page.goto('/maker.html?t=tok#/wrap/me-2026')
  await expect(page.getByRole('button', { name: 'Send in Messages' })).toBeEnabled()
  await expect(page.getByLabel('Your name in the wrap')).toHaveCount(0)
  expect((await linkOf(page)).people.me).toBe('You')
})

test('send: a name typed just before Send goes into the link that is sent', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page)
  let opened: { link: string } | null = null
  await page.route('**/api/open-messages', async (r) => {
    opened = r.request().postDataJSON()
    await r.fulfill({ status: 204 })
  })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.getByRole('button', { name: 'Send to group chat' })).toBeEnabled()
  await page.getByLabel('Your name in the wrap').fill('Priya')
  await page.getByRole('button', { name: 'Send to group chat' }).click() // the field's change fires on the way
  await expect(page.getByText('Link copied · Messages is open')).toBeVisible()
  expect((await unpackWrap(opened!.link.slice(opened!.link.indexOf('#') + 1))).people.me).toBe('Priya')
})

// ---------- Send ----------

test('send: one button copies the link and opens Messages with it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page)
  let opened: { link: string } | null = null
  await page.route('**/api/open-messages', async (r) => {
    opened = r.request().postDataJSON()
    await r.fulfill({ status: 204 })
  })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.getByText("Type the group's name")).toHaveCount(0)
  for (const old of ['Copy link', 'Open Messages', 'Done']) await expect(page.getByRole('button', { name: old, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Send to group chat' }).click()
  await expect(page.getByText('Link copied · Messages is open, pick your group and send')).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.startsWith(`${SITE}/#`)).toBe(true)
  expect(opened!.link).toBe(copied)
  await page.getByRole('button', { name: 'Copy cover image' }).click()
  await expect(page.getByText('Cover copied ✓')).toBeVisible()
})

test('send: when the clipboard is blocked, it says so plainly and still opens Messages', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'))
  })
  await mockApi(page)
  let openCalls = 0
  await page.route('**/api/open-messages', async (r) => {
    openCalls++
    await r.fulfill({ status: 204 })
  })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await page.getByRole('button', { name: 'Send to group chat' }).click()
  await expect(page.getByText("Couldn't copy the link: the browser blocked the clipboard.")).toBeVisible()
  await expect(page.getByText('Link copied')).toHaveCount(0)
  expect(openCalls).toBe(1)
})

test('send: a failing Open Messages shows the error; the button is disabled while it runs', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/api/open-messages', async (r) => {
    await gate
    await r.fulfill({ status: 500, body: '{}' })
  })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  const send = page.getByRole('button', { name: 'Send to group chat' })
  await send.click()
  await expect(send).toBeDisabled()
  release()
  await expect(page.getByText("Link copied, but Messages didn't open: The app answered 500.")).toBeVisible()
  await expect(send).toBeEnabled()
  await expect(send).toBeFocused()
})

test('send: unticking a quote after sending says the link changed', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page)
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await page.getByRole('button', { name: 'Send to group chat' }).click()
  await expect(page.getByText('Link copied · Messages is open')).toBeVisible()
  await openReview(page)
  await page.locator('input[data-hit="0"]').uncheck()
  await expect(page.getByText('The link changed. Send it again.')).toBeVisible()
  await page.getByRole('button', { name: 'Send to group chat' }).click()
  await expect(page.getByText('Link copied · Messages is open')).toBeVisible()
})

test('send: the cover is an image', async ({ page }) => {
  await mockApi(page)
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.locator('img.cover')).toHaveAttribute('src', /^data:image\/png/)
})

// ---------- After sending ----------

test('after sending: Now post yours builds My year for the card, then Make another goes home', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page)
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.getByText('Now post yours')).toBeHidden()
  await page.getByRole('button', { name: 'Send to group chat' }).click()
  await expect(page.getByText('Now post yours')).toBeVisible()
  await expect(page.locator('img.you-card')).toHaveAttribute('src', /^data:image\/png/, { timeout: 10_000 })
  expect(buildBodies).toEqual([{ kind: 'solo' }])
  const size = await page.locator('img.you-card').evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])
  expect(size).toEqual([1080, 1920])
  const save = page.getByRole('link', { name: 'Save image' })
  await expect(save).toHaveAttribute('download', 'my-2026-in-texts.png')
  await expect(save).toHaveAttribute('href', /^data:image\/png/)
  await page.getByRole('button', { name: 'Copy image' }).click()
  await expect(page.getByText('Card copied ✓')).toBeVisible()
  await page.getByRole('button', { name: 'Make another' }).click()
  await expect(page).toHaveURL(/maker\.html#\/$/)
  await expect(page.getByRole('heading', { name: 'What should we wrap?' })).toBeVisible()
})

test('after sending: a saved My year is used for the card without building it again', async ({ page }) => {
  await mockApi(page, { state: { ...baseState, solo: { wrapId: 'me-2026', made: true } } })
  await page.goto('/maker.html?t=tok#/wrap/me-2026')
  // My year has no group to send to first, so its card shows straight away.
  await expect(page.getByRole('button', { name: 'Send in Messages' })).toBeVisible()
  await expect(page.locator('img.you-card')).toHaveAttribute('src', /^data:image\/png/, { timeout: 10_000 })
  expect(buildCalls).toBe(0)
})

// ---------- Closing ----------

test('close: the footer link confirms, closes the app and says how to reopen it', async ({ page }) => {
  await mockApi(page)
  let closeCalls = 0
  await page.route('**/api/close', async (r) => {
    closeCalls++
    await r.fulfill({ status: 204 })
  })
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void (dialogs.length === 1 ? d.dismiss() : d.accept())
  })
  await page.goto('/maker.html?t=tok')
  const close = page.getByRole('button', { name: 'Close iMessage Wrapped' })
  await close.click() // "Keep going"
  await expect(rows(page)).toHaveCount(7)
  expect(closeCalls).toBe(0)
  await close.click()
  await expect(page.getByText('iMessage Wrapped is closed.')).toBeVisible()
  await expect(page.getByText('Run wrapped in Terminal to open it again.')).toBeVisible()
  await expect(close).toBeHidden()
  expect(closeCalls).toBe(1)
  expect(dialogs[0]).toContain('Close iMessage Wrapped?')
})

test('close: when the app stops on its own (q in the terminal), the page says it is closed', async ({ page }) => {
  await mockApi(page)
  await page.route('**/api/session', (r) => r.abort())
  await page.goto('/maker.html?t=tok')
  await expect(page.getByText('iMessage Wrapped is closed.')).toBeVisible({ timeout: 10_000 })
})
