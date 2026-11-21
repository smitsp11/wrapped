import fs from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { makeFakeWrap } from '../fixtures/fakeWrap'
import { packWrap } from '../src/share/pack'
import type { Wrap } from '../src/types'

/** "save ↓" on the demo wrap: greatest hits, the vocabulary and each award can be saved as a story image. */

const demo = () => JSON.parse(fs.readFileSync('web/public/demo.json', 'utf8')) as Wrap
const currentSlide = (page: Page) => page.getByTestId('slide').getAttribute('data-slide')
const control = (page: Page) => page.locator('.save-slide')
const isTouch = (page: Page) => page.evaluate(() => matchMedia('(pointer: coarse)').matches)

/** A tap on a phone, a click on a laptop. */
async function press(locator: Locator): Promise<void> {
  if (await isTouch(locator.page())) await locator.tap()
  else await locator.click()
}

async function toSlide(page: Page, id: string): Promise<void> {
  await page.goto('/#demo')
  await expect(page.getByTestId('slide')).toBeVisible()
  for (let i = 0; i < 40 && (await currentSlide(page)) !== id; i++) await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', id)
}

/** Width and height from a PNG's header. */
function pngSize(bytes: Uint8Array): [number, number] {
  expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]) // "PNG"
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  return [view.getUint32(16), view.getUint32(20)]
}

/**
 * Stands in for the phone's share sheet. "shares" records what was shared, "cancels" acts like closing the sheet,
 * "unsupported" is a browser that can't share files.
 */
async function stubShare(page: Page, behaviour: 'shares' | 'cancels' | 'unsupported'): Promise<void> {
  await page.addInitScript((mode) => {
    const w = window as unknown as { shared: ShareData[] }
    w.shared = []
    const share =
      mode === 'unsupported'
        ? undefined
        : async (data: ShareData) => {
            if (mode === 'cancels') throw new DOMException('Share canceled', 'AbortError')
            w.shared.push(data)
          }
    const canShare = mode === 'unsupported' ? undefined : (data?: ShareData) => !!data?.files?.length
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true })
  }, behaviour)
}

/** The first file handed to the stubbed share sheet: its name, type and PNG size. */
function sharedFile(page: Page) {
  return page.evaluate(async () => {
    const { shared } = window as unknown as { shared: ShareData[] }
    const file = shared[0]!.files![0]!
    return { count: shared.length, files: shared[0]!.files!.length, name: file.name, type: file.type, bytes: [...new Uint8Array(await file.arrayBuffer()).slice(0, 24)] }
  })
}

/** The boxes around the text itself (not the element), so a full-width heading only counts where its letters are. */
function textBoxes(locator: Locator) {
  return locator.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return [...range.getClientRects()].map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right }))
  })
}
type Box = { top: number; bottom: number; left: number; right: number }
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

test('save ↓ is on greatest hits, the vocabulary, each award and the summary card, clear of the progress bar and heading', async ({ page }) => {
  await page.goto('/#demo')
  await expect(page.getByTestId('slide')).toBeVisible()
  const withControl: string[] = []
  for (let i = 0; i < 40; i++) {
    const id = (await currentSlide(page))!
    if ((await control(page).count()) > 0) {
      withControl.push(id)
      await expect(control(page)).toBeVisible()
      await expect(control(page)).toHaveText('save ↓')
      const button = (await control(page).boundingBox())!
      const progress = (await page.locator('.progress').boundingBox())!
      expect(button.y).toBeGreaterThanOrEqual(progress.y + progress.height)
      // The writing doesn't sit on the slide's heading (the button's padding may).
      const label = await textBoxes(control(page))
      const heading = await textBoxes(page.getByTestId('slide').locator('h2, .hand-title').first())
      for (const a of label) for (const b of heading) expect(overlaps(a, b)).toBe(false)
    }
    if (id === 'outro') break
    await page.keyboard.press('ArrowRight')
  }
  expect(withControl).toEqual(['words', 'hits', ...demo().awards.map((a) => `award-${a.id}`), 'summary'])
})

test('on a computer, save ↓ downloads a 1080×1920 PNG and the page stays put', async ({ page }) => {
  test.skip(await isTouch(page), 'phones share instead (below)')
  await toSlide(page, 'hits')
  const [download] = await Promise.all([page.waitForEvent('download'), control(page).click()])
  expect(download.suggestedFilename()).toBe('poker-night-greatest-hits.png')
  expect(pngSize(fs.readFileSync((await download.path())!))).toEqual([1080, 1920])
  await expect(control(page)).toHaveText('saved ✓')
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')
  // And it goes back to "save ↓" after a moment.
  await expect(control(page)).toHaveText('save ↓', { timeout: 5000 })
})

test('the page before the outro is a summary card that saves as an image: the group\'s, or your own in My year', async ({ page }) => {
  test.skip(await isTouch(page), 'phones share instead (below)')
  await toSlide(page, 'summary')
  const card = page.getByTestId('slide').locator('.summary-card')
  await expect(card.locator('.photo')).toContainText('Poker Night')
  await expect(card.locator('.summary-notes li')).toHaveCount(2)
  await expect(card.locator('.summary-notes')).toContainText('top word')
  await expect(card.locator('.summary-chips li')).toHaveCount(3)
  const [download] = await Promise.all([page.waitForEvent('download'), control(page).click()])
  expect(download.suggestedFilename()).toBe('poker-night-2026-in-texts.png')
  expect(pngSize(fs.readFileSync((await download.path())!))).toEqual([1080, 1920])

  await page.goto(`/#${await packWrap(makeFakeWrap('solo'))}`)
  await expect(page.getByTestId('slide')).toBeVisible()
  for (let i = 0; i < 40 && (await currentSlide(page)) !== 'summary'; i++) await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('slide').locator('.photo')).toContainText('my texting personality', { ignoreCase: true })
  await expect(page.getByTestId('slide').locator('.summary-notes')).toContainText('texts sent')
  const [mine] = await Promise.all([page.waitForEvent('download'), control(page).click()])
  expect(mine.suggestedFilename()).toBe('my-2026-in-texts.png')
  expect(pngSize(fs.readFileSync((await mine.path())!))).toEqual([1080, 1920])
})

test('each award saves as its own image', async ({ page }) => {
  test.skip(await isTouch(page), 'phones share instead (below)')
  await toSlide(page, 'award-ghost')
  const [download] = await Promise.all([page.waitForEvent('download'), control(page).click()])
  expect(download.suggestedFilename()).toBe('poker-night-the-ghost.png')
  expect(pngSize(fs.readFileSync((await download.path())!))).toEqual([1080, 1920])
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'award-ghost')
})

test('on a phone, save ↓ opens the share sheet with a 1080×1920 PNG and the page stays put', async ({ page }) => {
  await stubShare(page, 'shares')
  test.skip(!(await isTouch(page)), 'computers download instead (above)')
  for (const [id, name] of [['words', 'poker-night-vocabulary.png'], ['award-main-character', 'poker-night-main-character.png']]) {
    await toSlide(page, id!)
    await page.evaluate(() => ((window as unknown as { shared: ShareData[] }).shared = []))
    await press(control(page))
    await expect(control(page)).toHaveText('done ✓')
    const file = await sharedFile(page)
    expect(file).toMatchObject({ count: 1, files: 1, name, type: 'image/png' })
    expect(pngSize(new Uint8Array(file.bytes))).toEqual([1080, 1920])
    await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', id!)
  }
})

test('on a phone, closing the share sheet changes nothing', async ({ page }) => {
  await stubShare(page, 'cancels')
  test.skip(!(await isTouch(page)), 'only phones share')
  await toSlide(page, 'hits')
  await press(control(page))
  await expect(control(page)).toHaveText('save ↓')
  await expect(page.locator('.save-preview')).toHaveCount(0)
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')
})

test("a phone that can't share files shows the image to press and hold, and Done closes it", async ({ page }) => {
  await stubShare(page, 'unsupported')
  test.skip(!(await isTouch(page)), 'only phones show the image')
  await toSlide(page, 'hits')
  await press(control(page))
  const preview = page.getByRole('dialog', { name: 'Save this image' })
  await expect(preview).toBeVisible()
  await expect(preview.getByText('press and hold the image to save it')).toBeVisible()
  const size = await preview.locator('img').evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    return [img.naturalWidth, img.naturalHeight]
  })
  expect(size).toEqual([1080, 1920])
  await press(preview.getByRole('button', { name: 'Done' }))
  await expect(preview).toHaveCount(0)
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')
})
