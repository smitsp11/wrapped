import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { makeFakeWrap } from '../fixtures/fakeWrap'
import { packWrap } from '../src/share/pack'
import type { Wrap } from '../src/types'

/**
 * Greatest hits with three long quotes (made up): every quote is cut to about 120 characters on the page, the page
 * fits without scrolling, nothing overlaps, and each "see the convo" opens its own conversation with the whole message.
 */

const LONG_QUOTES = [
  // 261 characters: near the longest a hit can be (280)
  'ok so hear me out: we rent the cabin for the long weekend, everyone brings exactly one dish, nobody is allowed to ' +
    'talk about work, and we finally finish that 2000 piece puzzle from last year. if you are in, heart this. if you ' +
    'are out, explain yourself on sunday',
  'reminder that the deposit for the cabin is due friday and I am not fronting it again like last time, venmo me ' +
    'before thursday night or your bunk goes to whoever pays first',
  'whoever keeps leaving the board game box open on the shelf, the cat has now eaten three tokens, one die and most of ' +
    'the rules, so we are playing by vibes from now on',
]

const demo = () => JSON.parse(fs.readFileSync('web/public/demo.json', 'utf8')) as Wrap

/**
 * `wrap` with its three greatest hits saying LONG_QUOTES, in the quote and in its conversation, sent late on a
 * two-digit day, and (in a group) by people with long names, so the date has to go under the name.
 */
function withLongQuotes(wrap: Wrap): Wrap {
  const people = { ...wrap.people }
  const greatestHits = wrap.greatestHits.slice(0, 3).map((hit, i) => {
    const text = LONG_QUOTES[i]!
    const convo = hit.conversation!
    const messages = convo.messages.map((m, j) => (j === convo.hit ? { ...m, text } : m))
    if (hit.senderId !== 'me') people[hit.senderId] = 'Maximiliana Featherstone'
    return { ...hit, text, sentAt: '2026-12-23T23:59:00.000Z', reactions: 12, conversation: { ...convo, messages } }
  })
  return { ...wrap, people, greatestHits }
}

const currentSlide = (page: Page) => page.getByTestId('slide').getAttribute('data-slide')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'what was the convo?' })

type Box = { top: number; bottom: number; left: number; right: number }

/**
 * Where everything on the page is laid out, with tilts turned off: a transform never moves the layout, and the
 * boxes of tilted cards would overlap by a pixel or two at their corners.
 */
function layout(page: Page) {
  return page.getByTestId('slide').evaluate((slide) => {
    const style = document.createElement('style')
    style.textContent = '#app *, #app *::before { transform: none !important; }'
    document.head.append(style)
    const toBox = (r: DOMRect): Box => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
    const box = (el: Element | null) => toBox(el!.getBoundingClientRect())
    // The words themselves: the link's box is taller than its line, to tap, and hangs into the space around it.
    const words = (el: Element | null) => {
      const range = document.createRange()
      range.selectNodeContents(el!)
      return toBox(range.getBoundingClientRect())
    }
    const figures = [...slide.querySelectorAll('.quotes figure')]
    const result = {
      scroll: { down: slide.scrollHeight - slide.clientHeight, across: slide.scrollWidth - slide.clientWidth },
      slide: box(slide),
      progress: box(document.querySelector('.progress')),
      heading: box(slide.querySelector('h2')),
      figures: figures.map((f) => ({
        card: box(f),
        quote: f.querySelector('blockquote')!.textContent!,
        who: words(f.querySelector('figcaption .by')),
        time: words(f.querySelector('time')),
        link: words(f.querySelector('.see-convo')),
      })),
    }
    style.remove()
    return result
  })
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

for (const [width, height] of [[300, 600], [390, 844]] as const) {
  test.describe(`at ${width}×${height}`, () => {
    test.use({ viewport: { width, height }, timezoneId: 'UTC' })

    for (const [name, wrap] of [['My year', () => makeFakeWrap('solo')], ['a group', demo]] as const) {
      test(`${name}: three long quotes fit, cut short, with nothing overlapping, and each opens its own conversation`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(`/#${await packWrap(withLongQuotes(wrap()))}`)
        await page.evaluate(() => document.fonts.ready)
        for (let i = 0; i < 40 && (await currentSlide(page)) !== 'hits'; i++) await page.keyboard.press('ArrowRight')
        await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')

        const at = await layout(page)
        expect(at.scroll, 'the page scrolls').toEqual({ down: 0, across: 0 })
        expect(at.figures).toHaveLength(3)
        expect(at.heading.top, 'the heading runs into the progress bar').toBeGreaterThanOrEqual(at.progress.bottom)
        expect(at.heading.bottom, 'the heading runs into the first quote').toBeLessThanOrEqual(at.figures[0]!.card.top)
        at.figures.forEach((f, i) => {
          // “…” around about 120 characters
          expect(Array.from(f.quote).length, `quote ${i}`).toBeLessThanOrEqual(122)
          expect(f.quote, `quote ${i}`).toMatch(/^“.+…”$/)
          expect(overlaps(f.time, f.link), `quote ${i}: the date runs into "see the convo"`).toBe(false)
          expect(overlaps(f.who, f.link), `quote ${i}: the name runs into "see the convo"`).toBe(false)
          expect(overlaps(f.who, f.time), `quote ${i}: the name runs into the date`).toBe(false)
          for (const part of [f.time, f.link, f.who]) {
            expect(part.left, `quote ${i} sticks out`).toBeGreaterThanOrEqual(at.slide.left)
            expect(part.right, `quote ${i} sticks out`).toBeLessThanOrEqual(at.slide.right)
          }
          expect(f.card.bottom, `quote ${i} runs off the page`).toBeLessThanOrEqual(at.slide.bottom)
          if (i > 0) expect(f.card.top, `quote ${i} runs into the one above`).toBeGreaterThanOrEqual(at.figures[i - 1]!.card.bottom)
        })

        for (const i of [0, 1, 2]) {
          const link = page.locator(`[data-convo="${i}"] .see-convo`)
          if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await link.tap()
          else await link.click()
          await expect(dialog(page)).toBeVisible()
          await expect(dialog(page).locator('[data-hit]')).toContainText(LONG_QUOTES[i]!) // the whole message
          await page.keyboard.press('Escape')
          await expect(dialog(page)).toHaveCount(0)
          await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')
        }
      })
    }
  })
}
