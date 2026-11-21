import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test'
import { makeFakeWrap } from '../fixtures/fakeWrap'
import { makePng } from '../fixtures/makePng'
import { fitToLimit, shownHits, unpackWrap } from '../src/share/pack'
import type { Wrap } from '../src/types'

/**
 * The maker's preview, on your own Mac, shows your photos in a conversation (from the app); a shared link never does.
 * Conversations themselves are in the link, for a group wrap and My year alike. The app is faked: /api is mocked, and the "photo" is a generated PNG.
 */

const GROUP_ID = 'poker-night-1-2026'
const SOLO_ID = 'me-2026'
const group = makeFakeWrap('group')
const solo = makeFakeWrap('solo')
/** A wrap as its link holds it: only the quotes the slide shows, as it shows them (see shownHits). */
const linked = (wrap: Wrap): Wrap => ({ ...wrap, greatestHits: shownHits(wrap.greatestHits) })
/** Jordan's photo in the first quote's conversation */
const PHOTO_AT = group.greatestHits[0]!.conversation!.messages.findIndex((m) => m.media === 'photo')
const PHOTO_ID = 'c0ffee00'.repeat(4)
const PNG = makePng(240, 300, [233, 108, 47])
/** A text message in My year's conversation, for a photo sent with it */
const SOLO_TEXT_AT = solo.greatestHits[0]!.conversation!.messages.findIndex((m, i) => i !== solo.greatestHits[0]!.conversation!.hit && m.text !== '')
const state = {
  site: 'https://wrapped.smitpatel.xyz',
  period: { label: '2026 so far', year: 2026 },
  solo: { wrapId: SOLO_ID, made: true },
  groups: [{ id: 1, title: 'Poker Night', messages: 302, memberNames: ['Alex', 'Sam'], wrapId: GROUP_ID, made: true }],
  senderName: '',
  update: null,
}

type Options = {
  items?: { hit: number; message: number; id: string }[]
  mediaStatus?: number
  /** what the app lists for My year */
  soloItems?: { hit: number; message: number; id: string }[]
  groupWrap?: Wrap
}

/** Fakes the local app. Returns the calls it sees, with the token each media call carried. */
async function mockApi(
  page: Page,
  { items = [{ hit: 0, message: PHOTO_AT, id: PHOTO_ID }], mediaStatus = 200, soloItems = [], groupWrap = group }: Options = {},
) {
  const calls = { list: [] as string[], media: [] as { url: string; token: string | undefined }[] }
  const wraps: Record<string, Wrap> = { [GROUP_ID]: groupWrap, [SOLO_ID]: solo }
  await page.route('**/api/state', (r) => r.fulfill({ json: state }))
  await page.route('**/api/session', () => new Promise(() => undefined))
  await page.route('**/api/wraps**', (r) => {
    const id = new URL(r.request().url()).searchParams.get('ids')!
    return r.fulfill({ json: { wraps: [{ id, wrap: wraps[id] }] } })
  })
  await page.route('**/api/convo-media**', (r) => {
    calls.list.push(r.request().url())
    const forSolo = r.request().url().includes(SOLO_ID)
    return r.fulfill({ json: { items: forSolo ? soloItems : items } })
  })
  await page.route('**/api/media/**', (r) => {
    calls.media.push({ url: r.request().url(), token: r.request().headers()['x-wrapped-token'] })
    return mediaStatus === 200 ? r.fulfill({ body: PNG, contentType: 'image/png' }) : r.fulfill({ status: mediaStatus })
  })
  return calls
}

type Root = Page | FrameLocator
const dialogIn = (root: Root) => root.getByRole('dialog', { name: 'what was the convo?' })
/**
 * A click, as an event: the slides turn with an animation, so Playwright's wait for a still element can outlast a
 * test when many run at once. The page only looks at which element was clicked.
 */
const tap = (root: Root | Locator, selector: string) => root.locator(selector).first().dispatchEvent('click')

/** Flips to Greatest hits. */
async function toHits(root: Root): Promise<void> {
  const slide = root.getByTestId('slide')
  await expect(slide).toBeVisible()
  // A key press for the page itself, whether or not it's in the maker's frame.
  const next = () => root.locator('body').evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })))
  for (let i = 0; i < 40 && (await slide.getAttribute('data-slide')) !== 'hits'; i++) await next()
  await expect(slide).toHaveAttribute('data-slide', 'hits')
}

async function openFirstConvo(root: Root): Promise<void> {
  await toHits(root)
  await tap(root, '[data-convo="0"] .see-convo')
  await expect(dialogIn(root)).toBeVisible()
}

async function openPreview(page: Page, id = GROUP_ID): Promise<FrameLocator> {
  await page.goto(`/maker.html?t=tok#/wrap/${id}`)
  await expect(page.getByRole('button', { name: id === SOLO_ID ? 'Send in Messages' : 'Send to group chat' })).toBeEnabled()
  return page.frameLocator('iframe.phone')
}

async function linkIn(page: Page): Promise<Wrap> {
  const src = (await page.locator('iframe.phone').getAttribute('src'))!
  return unpackWrap(src.slice(src.indexOf('#') + 1))
}

/** Every /api call the page (or its frame) makes. */
function watchApi(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/')) seen.push(req.url())
  })
  return seen
}

// ---------- Photos ----------

test("photos: the preview's convo shows your own photo, fetched with the app's token, and the link stays the same", async ({ page }) => {
  const calls = await mockApi(page)
  const frame = await openPreview(page)
  await openFirstConvo(frame)
  const photo = dialogIn(frame).locator('.bubble.photo')
  await expect(photo).toHaveCount(1)
  // The image is lazy: it shows once the thread is settled and scrolled to it (the frame holds its place till then).
  await expect(dialogIn(frame)).toHaveAttribute('data-state', 'lifted')
  await tap(dialogIn(frame), '.shot-top')
  await expect(dialogIn(frame)).toHaveAttribute('data-state', 'settled')
  await photo.scrollIntoViewIfNeeded()
  await expect(photo).toHaveClass(/loaded/)
  const img = photo.locator('img')
  await expect(img).toHaveAttribute('alt', 'Photo')
  await expect(img).toHaveAttribute('loading', 'lazy')
  await expect(img).toHaveAttribute('src', /^blob:/)
  expect(await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([240, 300])
  await expect(dialogIn(frame).locator('.bubble.media', { hasText: '📷 Photo' })).toHaveCount(0)
  expect(calls.list).toEqual([expect.stringContaining(`/api/convo-media?wrap=${GROUP_ID}`)])
  expect(calls.media).toEqual([{ url: expect.stringContaining(`/api/media/${PHOTO_ID}`), token: 'tok' }])

  // Opened again, the photo comes from memory.
  await tap(dialogIn(frame), '[data-convo-close]')
  await tap(frame, '[data-convo="0"] .see-convo')
  await expect(dialogIn(frame)).toHaveAttribute('data-state', 'lifted')
  await tap(dialogIn(frame), '.shot-top')
  await dialogIn(frame).locator('.bubble.photo').scrollIntoViewIfNeeded()
  await expect(dialogIn(frame).locator('.bubble.photo')).toHaveClass(/loaded/)
  expect(calls.media).toHaveLength(1)

  // The link holds the saved wrap and nothing else (tests/share/linkUnchanged.test.ts checks its bytes).
  const inLink = await linkIn(page)
  expect(inLink).toEqual(linked(group))
  expect(JSON.stringify(inLink)).not.toContain(PHOTO_ID)
})

test('photos: one the app cannot send falls back to "📷 Photo"', async ({ page }) => {
  const calls = await mockApi(page, { mediaStatus: 415 })
  await openFirstConvo(await openPreview(page))
  const frame = page.frameLocator('iframe.phone')
  await expect(dialogIn(frame).locator('.bubble.media', { hasText: '📷 Photo' })).toHaveCount(1)
  await expect(dialogIn(frame).locator('.bubble.photo, img')).toHaveCount(0)
  expect(calls.media).toHaveLength(1)
})

test('photos: a wrap saved before photos (none listed) keeps its placeholders and fetches nothing', async ({ page }) => {
  const calls = await mockApi(page, { items: [] })
  const frame = await openPreview(page)
  await openFirstConvo(frame)
  await expect(dialogIn(frame).locator('.bubble.media', { hasText: '📷 Photo' })).toHaveCount(1)
  await expect(dialogIn(frame).locator('.bubble.photo, img')).toHaveCount(0)
  expect(calls.list).toHaveLength(1)
  expect(calls.media).toHaveLength(0)
})

test('photos: a text sent with a photo shows the photo above the text', async ({ page }) => {
  const convo = group.greatestHits[0]!.conversation!
  const messages = convo.messages.map((m, i) => (i === PHOTO_AT ? { senderId: m.senderId, sentAt: m.sentAt, text: 'look at this' } : m))
  const withText = { ...group, greatestHits: [{ ...group.greatestHits[0]!, conversation: { ...convo, messages } }, ...group.greatestHits.slice(1)] }
  await mockApi(page, { groupWrap: withText })
  const frame = await openPreview(page)
  await openFirstConvo(frame)
  const wrapEl = dialogIn(frame).locator('.bubble-wrap', { has: frame.locator('.bubble.photo') })
  await expect(wrapEl.locator('> *')).toHaveCount(2)
  await expect(wrapEl.locator('> :first-child')).toHaveClass(/photo above/)
  await expect(wrapEl.locator('> :nth-child(2)')).toHaveText('look at this')
  await expect(dialogIn(frame)).toHaveAttribute('data-state', 'lifted')
  await tap(dialogIn(frame), '.shot-top')
  await wrapEl.scrollIntoViewIfNeeded()
  await expect(wrapEl.locator('.bubble.photo')).toHaveClass(/loaded/)
  const [photoBox, textBox] = [await wrapEl.locator('.bubble.photo').boundingBox(), await wrapEl.locator('p.bubble').boundingBox()]
  expect(photoBox!.y + photoBox!.height).toBeLessThanOrEqual(textBox!.y)
})

test('photos: if a photo above a text fails, the text stays on its own', async ({ page }) => {
  const convo = group.greatestHits[0]!.conversation!
  const messages = convo.messages.map((m, i) => (i === PHOTO_AT ? { senderId: m.senderId, sentAt: m.sentAt, text: 'look at this' } : m))
  const withText = { ...group, greatestHits: [{ ...group.greatestHits[0]!, conversation: { ...convo, messages } }, ...group.greatestHits.slice(1)] }
  await mockApi(page, { groupWrap: withText, mediaStatus: 415 })
  const frame = await openPreview(page)
  await openFirstConvo(frame)
  await expect(dialogIn(frame).getByText('look at this')).toHaveCount(1)
  await expect(dialogIn(frame).locator('.bubble.photo, .bubble.media:has-text("📷 Photo")')).toHaveCount(0)
})

// ---------- My year ----------

test("my year: the preview's quote opens its conversation from the link, titled with its chat, with your photo", async ({ page }) => {
  const calls = await mockApi(page, { soloItems: [{ hit: 0, message: SOLO_TEXT_AT, id: PHOTO_ID }] })
  const frame = await openPreview(page, SOLO_ID)
  await openFirstConvo(frame)
  const dialog = dialogIn(frame)
  await expect(dialog.locator('.shot-top b')).toHaveText('Poker Night')
  await expect(dialog.locator('[data-hit]')).toContainText(solo.greatestHits[0]!.text)
  await expect(dialog.locator('[data-hit]')).toHaveClass(/mine/)
  await expect(dialog.getByText('the prodigal texter returns')).toHaveCount(1)
  await expect(dialog.locator('.who', { hasText: 'Riley' }).first()).toBeAttached()
  // Photos work in My year's preview too: here one sent with a text.
  await expect(dialog.locator('.bubble.photo.above')).toHaveCount(1)
  await expect(dialog).toHaveAttribute('data-state', 'lifted')
  await tap(dialog, '.shot-top')
  await dialog.locator('.bubble.photo').scrollIntoViewIfNeeded()
  await expect(dialog.locator('.bubble.photo')).toHaveClass(/loaded/)
  expect(calls.list).toEqual([expect.stringContaining(`/api/convo-media?wrap=${SOLO_ID}`)])

  const inLink = await linkIn(page)
  expect(inLink).toEqual(linked(solo))
  expect(inLink.greatestHits[0]!.conversation!.title).toBe('Poker Night')
  expect(JSON.stringify(inLink)).not.toContain(PHOTO_ID)
})

// ---------- The public page ----------

test('public page: no photos, on the demo or a group link opened on its own', async ({ page }) => {
  const calls = await mockApi(page)
  const api = watchApi(page)

  await page.goto('/#demo')
  await openFirstConvo(page)
  await expect(dialogIn(page).locator('.bubble.media', { hasText: '📷 Photo' })).toHaveCount(1)
  await expect(dialogIn(page).locator('.bubble.photo, img')).toHaveCount(0)

  await page.goto('about:blank')
  await page.goto(`/#${(await fitToLimit(group)).packed}`)
  await openFirstConvo(page)
  await expect(dialogIn(page).locator('.bubble.media', { hasText: '📷 Photo' })).toHaveCount(1)
  await expect(dialogIn(page).locator('.bubble.photo, img')).toHaveCount(0)
  expect(await page.evaluate(() => 'wrappedLocalPreview' in window)).toBe(false)

  expect(api).toEqual([])
  expect(calls.media).toHaveLength(0)
})

test('public page: a My year link has "see the convo", with its chat and names, and asks the app for nothing', async ({ page }) => {
  await mockApi(page)
  const api = watchApi(page)
  await page.goto(`/#${(await fitToLimit(solo)).packed}`)
  await openFirstConvo(page)
  const dialog = dialogIn(page)
  await expect(dialog.locator('.shot-top b')).toHaveText('Poker Night')
  await expect(dialog.locator('[data-hit]')).toContainText('omw')
  await expect(dialog.locator('.who', { hasText: 'Riley' }).first()).toBeAttached()
  await expect(dialog.locator('.bubble.photo, img')).toHaveCount(0)
  expect(api).toEqual([])
})
