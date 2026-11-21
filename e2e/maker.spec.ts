import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { makeFakeWrap } from '../fixtures/fakeWrap'
import { MAX_LINK_CHARS, unpackWrap } from '../src/share/pack'
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

test('home: a made wrap has a quiet "update" link that builds it again and opens it', async ({ page }) => {
  const state = { ...baseState, solo: { wrapId: 'me-2026', made: true }, groups: groups.map((g) => ({ ...g, made: g.id === 2 })) }
  await mockApi(page, { state })
  await page.goto('/maker.html?t=tok')
  await expect(page.getByRole('button', { name: /^Update/ })).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'update', exact: true })).toHaveCount(0) // labelled with the chat's name
  await expect(rows(page).nth(0).getByRole('button', { name: /^Update/ })).toHaveCount(0) // not made yet: Wrap it
  const update = rows(page).nth(1).getByRole('button', { name: 'Update Chat 2 with new messages' })
  await expect(update).toHaveText('update')
  // Small words, a 44×44 tap area.
  const box = (await update.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
  await update.click()
  await expect(page).toHaveURL(/#\/wrap\/chat-2-2-2026$/)
  await page.getByRole('link', { name: '← All chats' }).click()
  await page.getByRole('button', { name: 'Update my year with new messages' }).click()
  await expect(page).toHaveURL(/#\/wrap\/me-2026$/)
  expect(buildBodies).toEqual([{ kind: 'groups', chatIds: [2] }, { kind: 'solo' }])
})

test('home: each "Made ✓ · Watch" says which chat it watches', async ({ page }) => {
  const state = { ...baseState, solo: { wrapId: 'me-2026', made: true }, groups: groups.map((g) => ({ ...g, made: g.id === 2 })) }
  await mockApi(page, { state })
  await page.goto('/maker.html?t=tok')
  await expect(page.getByRole('button', { name: 'Made ✓ · Watch Chat 2', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Made ✓ · Watch my year', exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: 'Send to group chat' }).click()
  await page.getByRole('button', { name: /^Bonus/ }).click()
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

/** Makes the first pack (the link for the first wrap opened) slow, so it finishes after anything that happens next. */
async function slowFirstPack(page: Page) {
  await page.addInitScript(() => {
    if (window !== window.top) return
    const original = Response.prototype.arrayBuffer
    let calls = 0
    Response.prototype.arrayBuffer = async function (this: Response) {
      const buffer = await original.call(this)
      if (++calls === 1) await new Promise((resolve) => setTimeout(resolve, 1500))
      return buffer
    }
  })
}

test('wrap: Send is the only action, with no name field, cover image or quote list', async ({ page }) => {
  await mockApi(page)
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  const section = page.locator('section[data-wrap]')
  await expect(page.getByRole('button', { name: 'Send to group chat' })).toBeEnabled()
  await expect(section.getByRole('button')).toHaveCount(1)
  await expect(section.locator('input, img')).toHaveCount(0)
  for (const gone of ['Copy cover image', 'Change', 'Includes stats', 'Your name in the wrap']) await expect(page.getByText(gone)).toHaveCount(0)
})

test('wrap: quotes with a phone number or email stay out of the link; every other quote and signature word goes in', async ({ page }) => {
  const wrap = withHits(['call me at 416 555 0199', 'fine quote', 'mail me at sam@example.com', 'another one'])
  await mockApi(page, { wrapFor: () => wrap })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  const link = await linkOf(page)
  expect(link.greatestHits.map((h) => h.text)).toEqual(['fine quote', 'another one'])
  expect(link.words.signatureWordByPerson).toEqual(wrap.words.signatureWordByPerson)
})

test('wrap: a slow link for wrap A never lands on wrap B', async ({ page }) => {
  await slowFirstPack(page)
  await mockApi(page, { wrapFor: (id) => withHits([id === 'chat-1-1-2026' ? 'QUOTE A' : 'QUOTE B']) })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.locator('section[data-wrap="chat-1-1-2026"]')).toBeVisible()
  await page.evaluate(() => (location.hash = '#/wrap/chat-2-2-2026'))
  await expect(page.locator('section[data-wrap="chat-2-2-2026"]')).toBeVisible()
  expect((await linkOf(page)).greatestHits.map((h) => h.text)).toEqual(['QUOTE B'])
  await page.waitForTimeout(2000) // wrap A's link is done by now
  expect((await linkOf(page)).greatestHits.map((h) => h.text)).toEqual(['QUOTE B'])
})

test('wrap: a link still being made does not paint over the closed page', async ({ page }) => {
  await slowFirstPack(page)
  await mockApi(page)
  page.on('dialog', (d) => void d.accept())
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.locator('section[data-wrap]')).toBeVisible()
  await page.getByRole('button', { name: 'Close iMessage Wrapped' }).click()
  await expect(page.getByText('iMessage Wrapped is closed.')).toBeVisible()
  await page.waitForTimeout(2000)
  await expect(page.getByText('iMessage Wrapped is closed.')).toBeVisible()
  await expect(page.locator('iframe.phone')).toHaveCount(0)
})

test('wrap: a very long unbroken quote and title do not scroll the page sideways', async ({ page }) => {
  await mockApi(page, { wrapFor: () => ({ ...withHits(['x'.repeat(600), 'short']), title: 'T'.repeat(65) }) })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.getByRole('button', { name: 'Send to group chat' })).toBeEnabled()
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

test('wrap: a wrap too big for one link leaves out its least-reacted quotes and can still be sent', async ({ page }) => {
  // Incompressible letters (no digits or @, so none look like contact info) in the shown quotes' conversations, and a
  // title, push the link past the limit.
  const noise = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 58))).join('')
  const base = withHits(Array.from({ length: 3 }, () => noise(100)))
  const wrap = {
    ...base,
    title: noise(2500),
    greatestHits: base.greatestHits.map((h) => ({ ...h, conversation: { ...h.conversation!, messages: h.conversation!.messages.map((m) => ({ ...m, text: noise(280) })) } })),
  }
  await mockApi(page, { wrapFor: () => wrap })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.getByRole('button', { name: 'Send to group chat' })).toBeEnabled()
  const kept = (await linkOf(page)).greatestHits.map((h) => h.text)
  expect(kept.length).toBeGreaterThan(0)
  expect(kept.length).toBeLessThanOrEqual(3)
  expect(kept).toEqual(wrap.greatestHits.slice(0, kept.length).map((h) => h.text)) // the first (most-reacted) ones stay
  expect((await linkOf(page)).greatestHits.some((h) => !h.conversation)).toBe(true) // conversations went first
  const src = (await page.locator('iframe.phone').getAttribute('src'))!
  expect(src.length - src.indexOf('#') - 1).toBeLessThanOrEqual(MAX_LINK_CHARS)
})

/** Where the wrap page's pieces sit, in page pixels. */
async function wrapLayout(page: Page) {
  const box = async (selector: string) => (await page.locator(selector).boundingBox())!
  return {
    phone: await box('iframe.phone'),
    heading: await box('[data-heading]'),
    send: await box('[data-send]'),
    column: await box('.send-column'),
    headingSize: await page.locator('[data-heading]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  }
}

test('wrap: on a laptop the preview leads, with the title and Send beside it, centred on its height', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page)
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.getByRole('button', { name: 'Send to group chat' })).toBeEnabled()
  await expect(page.getByText('344 messages · 5 people')).toBeVisible()
  const before = await wrapLayout(page)
  expect(before.phone.width).toBeGreaterThan(280)
  expect(before.phone.width).toBeLessThan(360)
  expect(before.phone.height).toBeLessThan(700) // fits a laptop screen with the page around it
  expect(before.heading.x).toBeGreaterThan(before.phone.x + before.phone.width) // beside, not above
  expect(before.headingSize).toBeLessThanOrEqual(40)
  expect(before.send.width).toBeLessThan(before.column.width * 0.8) // a normal button, not stretched across
  const middle = (before.heading.y + before.send.y + before.send.height) / 2
  expect(Math.abs(middle - (before.phone.y + before.phone.height / 2))).toBeLessThan(60)
  await page.getByRole('button', { name: 'Send to group chat' }).click()
  await page.getByRole('button', { name: /^Bonus/ }).click()
  await expect(page.locator('img.you-card')).toHaveAttribute('src', /^data:image\/png/, { timeout: 10_000 })
  const card = (await page.locator('img.you-card').boundingBox())!
  expect(card.x).toBeGreaterThan(before.phone.x + before.phone.width) // under Send, beside the preview
  expect(card.width).toBeLessThan(before.phone.width / 2)
  expect((await wrapLayout(page)).overflow).toBeLessThanOrEqual(0)
})

test('wrap: on a phone it stacks title, preview, then Send, with no sideways scroll', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.getByRole('button', { name: 'Send to group chat' })).toBeEnabled()
  const before = await wrapLayout(page)
  expect(before.heading.y + before.heading.height).toBeLessThanOrEqual(before.phone.y)
  expect(before.phone.y + before.phone.height).toBeLessThanOrEqual(before.send.y)
  expect(before.phone.width).toBeLessThanOrEqual(390)
  expect(before.overflow).toBeLessThanOrEqual(0)
  await page.getByRole('button', { name: 'Send to group chat' }).click()
  await page.getByRole('button', { name: /^Bonus/ }).click()
  await expect(page.locator('img.you-card')).toHaveAttribute('src', /^data:image\/png/, { timeout: 10_000 })
  expect((await wrapLayout(page)).overflow).toBeLessThanOrEqual(0)
})

test('wrap: a group wrap names the sender from their contact card, with no field to change it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page, { state: { ...baseState, senderName: 'Smit' } })
  let opened: { link: string } | null = null
  await page.route('**/api/open-messages', async (r) => {
    opened = r.request().postDataJSON()
    await r.fulfill({ status: 204 })
  })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect.poll(async () => (await linkOf(page)).people.me).toBe('Smit') // the preview shows what friends see
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByText('Your name in the wrap')).toHaveCount(0)
  await page.getByRole('button', { name: 'Send to group chat' }).click()
  await expect(page.getByText('Link copied · Messages is open')).toBeVisible()
  expect((await unpackWrap(opened!.link.slice(opened!.link.indexOf('#') + 1))).people.me).toBe('Smit')
})

test('wrap: with no contact card for the sender, a group wrap keeps "You"', async ({ page }) => {
  await mockApi(page, { state: { ...baseState, senderName: '' } })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.getByRole('button', { name: 'Send to group chat' })).toBeEnabled()
  expect((await linkOf(page)).people.me).toBe('You')
})

test('wrap: My year keeps "You"', async ({ page }) => {
  await mockApi(page, { state: { ...baseState, senderName: 'Smit', solo: { wrapId: 'me-2026', made: true } } })
  await page.goto('/maker.html?t=tok#/wrap/me-2026')
  await expect(page.getByRole('button', { name: 'Send in Messages' })).toBeEnabled()
  expect((await linkOf(page)).people.me).toBe('You')
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
  expect((await linkOf(page)).title).toBe('Poker Night') // the preview plays the link that was sent
  expect(opened!.link.slice(opened!.link.indexOf('#'))).toBe((await page.locator('iframe.phone').getAttribute('src'))!.slice('/index.html'.length))
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

// ---------- After sending ----------

test('after sending a group wrap: the card about your year is an opt-in bonus that builds My year on click', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page)
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  const bonus = page.getByRole('button', { name: 'Bonus: make a card about your own year →' })
  await expect(bonus).toBeHidden()
  await page.getByRole('button', { name: 'Send to group chat' }).click()
  await expect(bonus).toBeVisible()
  await expect(page.getByText('Now post yours')).toBeHidden()
  await page.waitForTimeout(300)
  expect(buildBodies).toEqual([]) // nothing is built until it's asked for
  await bonus.click()
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

test('after sending: a click on the card opens it larger, and Escape closes it', async ({ page }) => {
  await mockApi(page, { state: { ...baseState, solo: { wrapId: 'me-2026', made: true } } })
  await page.goto('/maker.html?t=tok#/wrap/me-2026')
  const thumb = page.getByRole('button', { name: 'Open your 2026 in texts share card larger' })
  await expect(thumb).toBeVisible({ timeout: 10_000 })
  await thumb.click()
  const box = page.getByRole('dialog', { name: 'Your 2026 in texts share card' })
  await expect(box).toBeVisible()
  const big = (await box.locator('img').boundingBox())!
  expect(big.width).toBeGreaterThan(200)
  await page.keyboard.press('Escape')
  await expect(box).toHaveCount(0)
  await expect(thumb).toBeFocused()
  await thumb.click()
  await box.click({ position: { x: 5, y: 5 } })
  await expect(box).toHaveCount(0)
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

// ---------- Saving a page from the preview ----------

test('wrap: "save ↓" works in the preview too, without turning its page', async ({ page }) => {
  await mockApi(page)
  // On a phone the preview shares the image; this stands in for the share sheet (it runs in the preview's frame too).
  await page.addInitScript(() => {
    const w = window as unknown as { shared: File[] }
    w.shared = []
    Object.defineProperty(navigator, 'canShare', { value: (data?: ShareData) => !!data?.files?.length, configurable: true })
    Object.defineProperty(navigator, 'share', { value: async (data: ShareData) => void w.shared.push(...data.files!), configurable: true })
  })
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.locator('iframe.phone')).toHaveAttribute('src', /#/)
  const preview = page.frameLocator('iframe.phone')
  const slide = preview.getByTestId('slide')
  await expect(slide).toBeVisible()
  // A tap on the right of the page turns it.
  const box = (await slide.boundingBox())!
  for (let i = 0; i < 40 && (await slide.getAttribute('data-slide')) !== 'hits'; i++) {
    await slide.click({ position: { x: box.width * 0.8, y: box.height / 2 } })
  }
  await expect(slide).toHaveAttribute('data-slide', 'hits')

  const save = preview.locator('.save-slide')
  let bytes: number[]
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    await save.tap()
    await expect(save).toHaveText('done ✓')
    const frame = page.frames().find((f) => f.url().includes('/index.html'))!
    bytes = await frame.evaluate(async () => {
      const file = (window as unknown as { shared: File[] }).shared[0]!
      return [...new Uint8Array(await file.arrayBuffer()).slice(0, 24)]
    })
  } else {
    const [download] = await Promise.all([page.waitForEvent('download'), save.click()])
    expect(download.suggestedFilename()).toBe('poker-night-greatest-hits.png')
    await expect(save).toHaveText('saved ✓')
    bytes = [...readFileSync((await download.path())!).subarray(0, 24)]
  }
  const header = new DataView(new Uint8Array(bytes).buffer)
  expect([header.getUint32(16), header.getUint32(20)]).toEqual([1080, 1920])
  await expect(slide).toHaveAttribute('data-slide', 'hits')
})

/** WCAG contrast of an rgb() colour against the paper (#F6EEDF). */
function contrastOnPaper(rgb: string): number {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number)
  const lum = (c: number[]) => {
    const [R, G, B] = c.map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * R! + 0.7152 * G! + 0.0722 * B!
  }
  const [a, p] = [lum([r!, g!, b!]), lum([246, 238, 223])]
  return (Math.max(a, p) + 0.05) / (Math.min(a, p) + 0.05)
}

test('home: the green "Made" stamp reads at 4.5:1 or better', async ({ page }) => {
  const state = { ...baseState, groups: groups.map((g) => ({ ...g, made: g.id === 1 })) }
  await mockApi(page, { state })
  await page.goto('/maker.html?t=tok')
  const color = await page.locator('.made').first().evaluate((el) => getComputedStyle(el).color)
  expect(contrastOnPaper(color)).toBeGreaterThanOrEqual(4.5)
})

test('wrap: the preview shows a focus ring when the keyboard reaches it', async ({ page }) => {
  test.skip(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'a keyboard is a laptop thing')
  await mockApi(page)
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.locator('iframe.phone')).toHaveAttribute('src', /#/)
  await expect(page.frameLocator('iframe.phone').getByTestId('slide')).toBeVisible()
  for (let i = 0; i < 20 && !(await page.evaluate(() => document.activeElement?.matches('iframe.phone'))); i++) await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.matches('iframe.phone'))).toBe(true)
  await expect.poll(() => page.locator('iframe.phone').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
})

test('wrap: in the preview, Escape stays on the wrap and "Make yours" opens the real site in a new tab', async ({ page }) => {
  await mockApi(page)
  await page.goto('/maker.html?t=tok#/wrap/chat-1-1-2026')
  await expect(page.locator('iframe.phone')).toHaveAttribute('src', /#/)
  const preview = page.frameLocator('iframe.phone')
  const slide = preview.getByTestId('slide')
  await expect(slide).toBeVisible()
  const box = (await slide.boundingBox())!
  await slide.click({ position: { x: box.width * 0.8, y: box.height / 2 } }) // the keys go to the preview now
  const second = await slide.getAttribute('data-slide')
  await page.keyboard.press('Escape')
  await expect(slide).toHaveAttribute('data-slide', second!)
  await expect(preview.locator('.landing')).toHaveCount(0)
  for (let i = 0; i < 40 && (await slide.getAttribute('data-slide')) !== 'outro'; i++) await page.keyboard.press('ArrowRight')
  await expect(slide).toHaveAttribute('data-slide', 'outro')
  const make = preview.getByRole('link', { name: 'Make yours' })
  await expect(make).toHaveAttribute('href', SITE)
  await expect(make).toHaveAttribute('target', '_blank')
})
