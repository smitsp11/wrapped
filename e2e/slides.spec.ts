import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { makeFakeWrap } from '../fixtures/fakeWrap'
import { AWARD_TITLES } from '../src/awards/rules'
import { MAX_LINK_CHARS, packWrap } from '../src/share/pack'
import type { Wrap } from '../src/types'

const demo = () => JSON.parse(fs.readFileSync('web/public/demo.json', 'utf8')) as Wrap

type Page = import('@playwright/test').Page

/** A point inside the slide card: `x` is a fraction of its width. Taps are measured against the card, not the window. */
async function tap(page: Page, x: number): Promise<void> {
  const box = (await page.getByTestId('slide').boundingBox())!
  await page.mouse.click(box.x + box.width * x, box.y + box.height / 2)
}

const currentSlide = (page: Page) => page.getByTestId('slide').getAttribute('data-slide')

/**
 * Taps the middle of each page, greatest hits included: only their "see the convo" link opens a conversation. Each tap
 * waits for the page to settle, so a quote card sliding into place can't carry its link under the tap.
 */
async function tapUntilOutro(page: Page): Promise<void> {
  const slide = page.getByTestId('slide')
  for (let i = 0; i < 40 && (await currentSlide(page)) !== 'outro'; i++) {
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
    await tap(page, 0.8) // right = next
  }
  await expect(slide).toHaveAttribute('data-slide', 'outro')
}

test('the landing page explains who can make a wrap and opens the demo', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Open Terminal and paste')).toBeVisible()
  await expect(page.getByText("the year's almost over. who did you actually text the most?")).toBeVisible()
  // Mac comes up once, beside the install line, where it matters.
  expect((await page.locator('.landing').innerText()).match(/\bMac\b/g)).toEqual(['Mac'])
  await expect(page.getByText('Needs a Mac with Messages.')).toBeVisible()
  await expect(page.locator('[data-beta-tag]')).toHaveText('Beta')
  await page.getByRole('link', { name: 'See a demo' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'intro')
  await tap(page, 0.8)
  const second = await currentSlide(page)
  await tap(page, 0.8)
  const third = await currentSlide(page)
  expect(third).not.toBe(second)
  await tap(page, 0.15) // left third of the card = back
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', second!)
  await tapUntilOutro(page)
  await tap(page, 0.15)
  await expect(page.getByTestId('slide')).not.toHaveAttribute('data-slide', 'outro')
})

test('a packed link plays the wrap inside it', async ({ page }) => {
  await page.goto(`/#${await packWrap({ ...demo(), title: 'Linked Chat' })}`)
  await expect(page.getByRole('heading', { name: 'Linked Chat' })).toBeVisible()
  await tapUntilOutro(page)
})

test('a link ending in "-" or "_" still plays', async ({ page }) => {
  // Vary the title until the packed link ends in one of the URL-safe characters. Deterministic: same titles every run.
  // Without the conversations the wrap is small enough that the title still changes how the link ends.
  const small = { ...demo(), greatestHits: demo().greatestHits.map(({ conversation: _, ...hit }) => hit) }
  let title = ''
  let packed = ''
  for (let i = 0; i < 5000 && !/[-_]$/.test(packed); i++) {
    title = `Linked Chat ${i}`
    packed = await packWrap({ ...small, title })
  }
  expect(packed).toMatch(/[-_]$/)
  await page.goto(`/#${packed}`)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await tapUntilOutro(page)
})

test('a broken link says so', async ({ page }) => {
  await page.goto('/#not-a-real-wrap')
  await expect(page.getByText('This link is broken')).toBeVisible()
})

test('a link with characters changed in the middle is broken', async ({ page }) => {
  const packed = await packWrap({ ...demo(), title: 'Linked Chat' })
  const mid = Math.floor(packed.length / 2)
  const swapped = packed.slice(mid, mid + 6).replace(/./g, (c) => (c === 'A' ? 'B' : 'A'))
  await page.goto(`/#${packed.slice(0, mid)}${swapped}${packed.slice(mid + 6)}`)
  await expect(page.getByText('This link is broken')).toBeVisible()
})

test('an over-long link is broken', async ({ page }) => {
  await page.goto(`/#${'A'.repeat(MAX_LINK_CHARS + 1)}`)
  await expect(page.getByText('This link is broken')).toBeVisible()
})

test('a wrap from a newer version says so', async ({ page }) => {
  await page.goto(`/#${await packWrap({ ...demo(), version: 2 } as unknown as Wrap)}`)
  await expect(page.getByText('made by a newer version')).toBeVisible()
})

test('arrow keys and Space move through the slides and stop at both ends', async ({ page }) => {
  await page.goto('/#demo')
  const slide = page.getByTestId('slide')
  await expect(slide).toHaveAttribute('data-slide', 'intro')
  await page.keyboard.press('ArrowLeft')
  await expect(slide).toHaveAttribute('data-slide', 'intro')
  await page.keyboard.press('ArrowRight')
  const second = await currentSlide(page)
  expect(second).not.toBe('intro')
  await page.keyboard.press('Space')
  expect(await currentSlide(page)).not.toBe(second)
  await page.keyboard.press('ArrowLeft')
  await expect(slide).toHaveAttribute('data-slide', second!)
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight')
  await expect(slide).toHaveAttribute('data-slide', 'summary')
  await page.keyboard.press('ArrowRight')
  await expect(slide).toHaveAttribute('data-slide', 'summary')
})

test('Escape goes home, and taps there do nothing', async ({ page }) => {
  await page.goto('/#demo')
  await expect(page.getByTestId('slide')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Open Terminal and paste')).toBeVisible()
  await page.mouse.click(300, 300)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Open Terminal and paste')).toBeVisible()
  await expect(page.getByTestId('slide')).toHaveCount(0)
})

test('the outro asks you to make your own and can watch again', async ({ page }) => {
  await page.goto('/#demo')
  await tapUntilOutro(page)
  await expect(page.getByText('make one for your group chat')).toBeVisible()
  const make = page.getByRole('link', { name: 'Make yours', exact: true })
  await expect(make).toBeVisible()
  await expect(make).toHaveAttribute('href', '/')
  // One line, even on a phone: its height is one line of text plus the padding.
  const lines = await make.evaluate((el) => {
    const style = getComputedStyle(el)
    const text = el.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    return Math.round(text / parseFloat(style.lineHeight))
  })
  expect(lines).toBe(1)
  await page.getByRole('link', { name: 'Watch again' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'intro')
})

test('a failed demo fetch says the demo could not load, not that a link is broken', async ({ page }) => {
  await page.route('**/demo.json', (route) => route.fulfill({ status: 500, body: 'nope' }))
  await page.goto('/#demo')
  await expect(page.getByText("Couldn't load the demo. Try again.")).toBeVisible()
  await expect(page.getByText('This link is broken')).toHaveCount(0)
})

test('long names and quotes never overflow a slide', async ({ page }) => {
  const wrap = demo()
  const longName = 'W'.repeat(24)
  const quote = 'this is a very long quote that keeps going and going '.repeat(3).slice(0, 150)
  const long: Wrap = {
    ...wrap,
    people: { ...wrap.people, p1: longName, p2: longName.toLowerCase() },
    greatestHits: [1, 2, 3].map((n) => ({
      senderId: 'p1',
      text: `${n} ${quote}`,
      sentAt: '2026-01-12T20:00:00.000Z',
      reactions: 9 - n,
      laughs: 1,
    })),
  }
  await page.goto(`/#${await packWrap(long)}`)
  const slide = page.getByTestId('slide')
  let sawHits = false
  for (let i = 0; i < 40; i++) {
    const overflow = await slide.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow, `slide ${i} overflows sideways`).toBeLessThanOrEqual(0)
    const id = await currentSlide(page)
    if (id === 'hits') {
      sawHits = true
      await expect(page.getByRole('heading', { name: 'Greatest hits' })).toBeVisible()
    }
    if (id === 'summary') break
    await page.keyboard.press('ArrowRight')
  }
  expect(sawHits).toBe(true)
})

test('long names are never hyphenated: one line on ranked cards, and an award winner fits its name', async ({ page }) => {
  const wrap = demo()
  // Fake names. p1 wins several awards in the demo, so its one long word is a winner too.
  const long: Wrap = { ...wrap, people: { ...wrap.people, p1: 'BARTHOLOMEW', p2: 'Maximiliana Featherstonehaugh' } }
  await page.goto(`/#${await packWrap(long)}`)
  const slide = page.getByTestId('slide')
  let sawBars = false
  let sawWinner = false
  for (let i = 0; i < 40; i++) {
    const names = await slide.evaluate((el) =>
      [...el.querySelectorAll('.bars .name, .winner')].map((name) => {
        const style = getComputedStyle(name)
        const lines = Math.round(name.getBoundingClientRect().height / parseFloat(style.lineHeight))
        return { text: name.textContent!, winner: name.classList.contains('winner'), hyphens: style.hyphens, lines }
      }),
    )
    for (const name of names) {
      expect(name.hyphens, `"${name.text}" may be hyphenated`).not.toBe('auto')
      if (!name.winner) {
        sawBars = true
        expect(name.lines, `"${name.text}" wraps on a ranked card`).toBe(1)
      } else if (name.text === 'BARTHOLOMEW') {
        sawWinner = true
        expect(name.lines, 'a one-word winner breaks mid-word').toBe(1)
      }
    }
    if ((await currentSlide(page)) === 'summary') break
    await page.keyboard.press('ArrowRight')
  }
  expect(sawBars).toBe(true)
  expect(sawWinner).toBe(true)
})

/**
 * The title on a stamp, word by word: how many line boxes each word takes (1 = not broken), and its width as a share
 * of the stamp's inside (its width less padding). Layout pixels, so the stamp's tilt doesn't matter. Runs in the page.
 */
function stampWords(el: Element, selector: string) {
  const title = el.querySelector<HTMLElement>(selector)!
  const stamp = title.closest<HTMLElement>('.stamp')!
  const style = getComputedStyle(stamp)
  const inside = stamp.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const text = title.firstChild!
  const words: { word: string; boxes: number; share: number }[] = []
  for (const match of text.textContent!.matchAll(/\S+/g)) {
    const range = document.createRange()
    range.setStart(text, match.index)
    range.setEnd(text, match.index + match[0].length)
    const probe = document.createElement('span')
    probe.style.cssText = 'position: absolute; white-space: nowrap; font: inherit; letter-spacing: inherit'
    probe.textContent = match[0]
    title.append(probe)
    words.push({ word: match[0], boxes: range.getClientRects().length, share: probe.offsetWidth / inside })
    probe.remove()
  }
  return { title: title.textContent!, words }
}

/** Every word on one line, with room to spare: fonts render a little wider in some browsers (Safari broke "Characte / r"). */
function expectWholeWords(stamp: ReturnType<typeof stampWords>) {
  for (const { word, boxes, share } of stamp.words) {
    expect(boxes, `"${word}" in "${stamp.title}" breaks across lines`).toBe(1)
    expect(share, `"${word}" in "${stamp.title}" nearly fills the stamp`).toBeLessThanOrEqual(0.9)
  }
}

// Phones (390, 375), the preview in the maker (300), and a laptop, where the page is a card in the middle.
for (const [width, height] of [[390, 844], [375, 667], [300, 560], [1280, 720]] as const) {
  test(`every award title fits its stamp without breaking a word (${width}×${height})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height })
    const wrap = demo()
    const awards = AWARD_TITLES.map(({ id, title }) => ({ ...wrap.awards[0]!, id, title }))
    await page.goto(`/#${await packWrap({ ...wrap, awards })}`)
    const slide = page.getByTestId('slide')
    const seen: string[] = []
    for (let i = 0; i < 40 && (await currentSlide(page)) !== 'outro'; i++) {
      if ((await currentSlide(page))!.startsWith('award-')) {
        const stamp = await slide.evaluate(stampWords, '.stamp h2')
        seen.push(stamp.title)
        expectWholeWords(stamp)
      }
      await page.keyboard.press('ArrowRight')
    }
    expect(seen).toEqual(AWARD_TITLES.map((a) => a.title))
  })
}

for (const width of [390, 1280]) {
  test(`the landing collage stamp keeps "Main Character" whole (${width} wide)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    const stamp = await page.locator('.collage').evaluate(stampWords, '.stamp strong')
    expect(stamp.title).toBe('Main Character')
    expectWholeWords(stamp)
  })
}

// A phone (390) and the preview in the maker (300).
for (const [width, height] of [[390, 844], [300, 600]] as const) {
  test(`each top word and its count stay on one line (${width}×${height})`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const wrap = demo()
    const topWords = [
      { word: 'bro', count: 1224 }, { word: 'gotta', count: 336 }, { word: 'tonight', count: 120 },
      { word: 'whatever', count: 98 }, { word: 'supercalifragilistic', count: 12 },
    ]
    await page.goto(`/#${await packWrap({ ...wrap, words: { ...wrap.words, topWords } })}`)
    for (let i = 0; i < 40 && (await currentSlide(page)) !== 'words'; i++) await page.keyboard.press('ArrowRight')
    const rows = await page.locator('.words li').evaluateAll((items) =>
      items.map((li) => {
        const el = li as HTMLElement
        return { text: el.innerText, height: el.offsetHeight, line: parseFloat(getComputedStyle(el).lineHeight), overflow: el.scrollWidth - el.clientWidth }
      }),
    )
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.height, `"${row.text}" wraps`).toBeLessThanOrEqual(row.line + 1)
      expect(row.overflow, `"${row.text}" spills out of the card`).toBeLessThanOrEqual(0)
    }
    expect(rows[0]!.text).toMatch(/^bro\s+1,224$/)
  })
}

// A phone, the maker's preview and a laptop: a phrase stays whole, on at most two ruled lines, its count on the first.
for (const [width, height] of [[390, 844], [300, 600], [1440, 900]] as const) {
  test(`a top phrase wraps between its words instead of being cut (${width}×${height})`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const wrap = demo()
    const topWords = [
      { word: 'aggressive cut down', count: 412 }, { word: 'run it back', count: 233 }, { word: 'bro', count: 90 },
    ]
    await page.goto(`/#${await packWrap({ ...wrap, words: { ...wrap.words, topWords } })}`)
    for (let i = 0; i < 40 && (await currentSlide(page)) !== 'words'; i++) await page.keyboard.press('ArrowRight')
    await expect(page.locator('.note.lined .label')).toHaveText('Top words & phrases')
    const rows = await page.locator('.words li').evaluateAll((items) =>
      items.map((li) => {
        const word = li.querySelector('.word') as HTMLElement
        const count = li.querySelector('small')!.getBoundingClientRect()
        const line = parseFloat(getComputedStyle(li).lineHeight)
        return {
          text: word.innerText.replace(/\s+/g, ' '),
          lines: Math.round(word.offsetHeight / line),
          cut: word.scrollWidth - word.clientWidth,
          countOnFirstLine: count.top < li.getBoundingClientRect().top + line,
        }
      }),
    )
    expect(rows.map((r) => r.text)).toEqual(['aggressive cut down', 'run it back', 'bro'])
    for (const row of rows) {
      expect(row.cut, `"${row.text}" is cut off`).toBeLessThanOrEqual(0)
      expect(row.lines, `"${row.text}" takes too many lines`).toBeLessThanOrEqual(2)
      expect(row.countOnFirstLine, `"${row.text}" count moved`).toBe(true)
    }
    const overflow = await page.getByTestId('slide').evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

// A phone (390) and the preview in the maker (300). The quips are switched on, since they make the captions longest.
for (const [width, height] of [[390, 844], [300, 600]] as const) {
  test(`every slide's caption fits on two lines above what it describes (${width}×${height})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height })
    const wrap = demo()
    wrap.volume.total = 1000
    wrap.volume.byPerson = { p1: 600, p2: 100, p3: 100, me: 200 } // "(it's not close)"
    wrap.timing.byHour = wrap.timing.byHour.map((_, hour) => (hour === 2 ? 500 : 5)) // "(way past bedtime)"
    await page.goto(`/#${await packWrap(wrap)}`)
    const slide = page.getByTestId('slide')
    const captioned: string[] = []
    for (let i = 0; i < 40; i++) {
      const id = (await currentSlide(page))!
      const asides = await slide.evaluate((el) => {
        const first = el.querySelector('.stage > *')?.getBoundingClientRect()
        return [...el.querySelectorAll<HTMLElement>('.aside')].map((aside) => {
          const box = aside.getBoundingClientRect()
          const quip = aside.querySelector('.quip')
          return {
            text: aside.innerText,
            lines: Math.round(aside.offsetHeight / parseFloat(getComputedStyle(aside).lineHeight)),
            clear: !first || box.bottom <= first.top,
            quipBoxes: quip ? quip.getClientRects().length : 1,
          }
        })
      })
      for (const aside of asides) {
        captioned.push(id)
        expect(aside.lines, `"${aside.text}" on ${id}`).toBeLessThanOrEqual(2)
        expect(aside.clear, `"${aside.text}" runs into ${id}`).toBe(true)
        expect(aside.quipBoxes, `the quip in "${aside.text}" splits`).toBe(1)
      }
      if (id === 'summary') break
      await page.keyboard.press('ArrowRight')
    }
    // Only short captions are left; the rest of the pages have none.
    expect(captioned).toEqual(['volume', 'hours', 'texting-styles', 'outro'])
  })
}

// A phone (390) and the preview in the maker (300×600): no page of a group or solo wrap scrolls, quips included.
for (const [width, height] of [[390, 844], [300, 600]] as const) {
  test(`every slide fits its page without scrolling (${width}×${height})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height })
    const quips = demo()
    quips.volume.total = 1000
    quips.volume.byPerson = { p1: 600, p2: 100, p3: 100, p4: 50, me: 150 } // "(it's not close)" over five names
    quips.timing.byHour = quips.timing.byHour.map((_, hour) => (hour === 2 ? 500 : 5))
    quips.timing.longestStreakDays = 150
    for (const [name, wrap] of [['group', demo()], ['group with quips', quips], ['solo', makeFakeWrap('solo')]] as const) {
      await page.goto('about:blank')
      await page.goto(`/#${await packWrap(wrap)}`)
      await page.evaluate(() => document.fonts.ready)
      const slide = page.getByTestId('slide')
      for (let i = 0; i < 40; i++) {
        const id = (await currentSlide(page))!
        const over = await slide.evaluate((el) => ({ down: el.scrollHeight - el.clientHeight, across: el.scrollWidth - el.clientWidth }))
        expect(over, `${name}: ${id} scrolls`).toEqual({ down: 0, across: 0 })
        if (id === 'summary') break
        await page.keyboard.press('ArrowRight')
      }
      await expect(slide).toHaveAttribute('data-slide', 'summary')
    }
  })
}

test.describe('greatest hits show when each was sent', () => {
  test.use({ timezoneId: 'America/Toronto' })
  // A phone (390) and the preview in the maker (300).
  for (const [width, height] of [[390, 844], [300, 600]] as const) {
    test(`in the viewer's time zone, on one line (${width}×${height})`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      const wrap = demo()
      const hit = { senderId: 'p4', text: 'who is bringing chips tonight?', reactions: 12, laughs: 0 }
      const greatestHits = [
        { ...hit, sentAt: '2026-01-12T20:00:00.000Z' }, // 3:00 PM in Toronto
        { ...hit, sentAt: '2026-11-30T04:59:00.000Z' }, // 11:59 PM the day before
        { ...hit, sentAt: '2026-07-04T16:30:00.000Z' }, // summer time: 12:30 PM
      ]
      await page.goto(`/#${await packWrap({ ...wrap, greatestHits })}`)
      for (let i = 0; i < 40 && (await currentSlide(page)) !== 'hits'; i++) await page.keyboard.press('ArrowRight')
      const times = await page.locator('figcaption time').evaluateAll((items) =>
        items.map((el) => ({ text: (el as HTMLElement).innerText, lines: Math.round((el as HTMLElement).offsetHeight / parseFloat(getComputedStyle(el).lineHeight)) })),
      )
      expect(times.map((t) => t.text)).toEqual(['Jan 12, 3:00 PM', 'Nov 29, 11:59 PM', 'Jul 4, 12:30 PM'])
      for (const time of times) expect(time.lines, `"${time.text}" wraps`).toBe(1)
      const overflow = await page.getByTestId('slide').evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }
})

test('landing shows the install line', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('pre.command')).toContainText('curl -fsSL')
  await expect(page.locator('pre.command')).toContainText('| sh')
})

test('the copy button says so when the clipboard is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Copy' }).click()
  await expect(page.getByRole('button', { name: 'Select the line and copy it' })).toBeVisible()
})

test('the page has link-preview tags pointing at the og image', async ({ page }) => {
  await page.goto('/')
  const meta = (selector: string) => page.locator(selector).getAttribute('content')
  expect(await meta('meta[property="og:image"]')).toBe('https://wrapped.smitpatel.xyz/og.png')
  expect(await meta('meta[property="og:url"]')).toBe('https://wrapped.smitpatel.xyz/')
  expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image')
  expect(await meta('meta[property="og:title"]')).toBeTruthy()
  expect(await meta('meta[property="og:description"]')).toMatch(/^the year's almost over\. who did you actually text the most\?/)
  const og = await page.request.get('/og.png')
  expect(og.headers()['content-type']).toBe('image/png')
})

test('the landing page and a wrap make no third-party requests, and the fonts load', async ({ page, baseURL }) => {
  const hosts = new Set<string>()
  page.on('request', (request) => {
    if (!request.url().startsWith('data:')) hosts.add(new URL(request.url()).host)
  })
  await page.goto('/')
  await page.goto('/#demo')
  await expect(page.getByTestId('slide')).toBeVisible()
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return ['800 20px "Bricolage Grotesque"', '700 20px Caveat'].map((face) => document.fonts.check(face))
  })
  expect(loaded).toEqual([true, true])
  expect([...hosts]).toEqual([new URL(baseURL!).host])
})

test('the demo shows everyone\'s texting style on one page, with nothing cut off', async ({ page }) => {
  await page.goto('/#demo')
  const slide = page.getByTestId('slide')
  for (let i = 0; i < 40 && (await currentSlide(page)) !== 'texting-styles'; i++) await page.keyboard.press('ArrowRight')
  await expect(slide).toHaveAttribute('data-slide', 'texting-styles')
  await expect(slide.getByRole('heading', { name: 'Texting styles' })).toBeVisible()
  await expect(slide.locator('.styles li')).toHaveCount(5)
  await expect(slide.locator('.styles li', { hasText: 'Riley Park' })).toContainText('Spray n Pray')
  await expect(slide.locator('.styles li', { hasText: 'Jordan Lee' })).toContainText('Paragraph Texter')
  await expect(slide.locator('.styles li', { hasText: 'You' })).toContainText('Nonchalant')
  const fits = await slide.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)
  expect(fits).toBe(true)
})
