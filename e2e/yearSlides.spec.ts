import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { makeFakeWrap } from '../fixtures/fakeWrap'
import { packWrap } from '../src/share/pack'
import type { Wrap } from '../src/types'

/** Peak month, busiest day, your person month by month, and the streak with one person. Fake data only. */
const demo = () => JSON.parse(fs.readFileSync('web/public/demo.json', 'utf8')) as Wrap
const soloLink = async () => packWrap(makeFakeWrap('solo', { yearRound: true }))

async function goTo(page: Page, id: string): Promise<void> {
  const slide = page.getByTestId('slide')
  for (let i = 0; i < 30 && (await slide.getAttribute('data-slide')) !== id; i++) await page.keyboard.press('ArrowRight')
  await expect(slide).toHaveAttribute('data-slide', id)
}

/** Each of `selector`'s elements takes at most `max` lines. */
async function expectLines(page: Page, selector: string, max: number): Promise<void> {
  for (const el of await page.locator(selector).all()) {
    const { text, lines } = await el.evaluate((e) => ({ text: e.textContent, lines: Math.round((e as HTMLElement).offsetHeight / parseFloat(getComputedStyle(e).lineHeight)) }))
    expect(lines, `"${text}" takes too many lines`).toBeLessThanOrEqual(max)
  }
}

/** The page fits without scrolling, nothing sticks out sideways, and no name in `selector` is cut short. */
async function expectFits(page: Page, selector?: string): Promise<void> {
  const slide = page.getByTestId('slide')
  expect(await slide.evaluate((el) => ({ down: el.scrollHeight - el.clientHeight, across: el.scrollWidth - el.clientWidth }))).toEqual({ down: 0, across: 0 })
  if (selector) {
    for (const name of await page.locator(selector).all()) expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
}

for (const size of [{ width: 390, height: 844 }, { width: 300, height: 600 }]) {
  test.describe(`at ${size.width}×${size.height}`, () => {
    test.use({ viewport: size })

    test('the demo shows its peak month as the yap era and its busiest day, and no last year', async ({ page }) => {
      await page.goto('/#demo')
      await page.evaluate(() => document.fonts.ready)
      await goTo(page, 'months')
      const slide = page.getByTestId('slide')
      await expect(slide.getByRole('heading', { name: 'Peak month' })).toBeVisible()
      await expect(slide.locator('.aside')).toHaveText("May was the chat's yap era")
      await expect(slide).not.toContainText('2025')
      await expect(slide.locator('.months span')).toHaveCount(12)
      await expect(slide.locator('.day-page')).toHaveText('May 21')
      await expect(slide.getByText('633 messages')).toBeVisible()
      await expect(slide.locator('.busiest .what')).toHaveText('what happened on May 21?')
      await expectLines(page, '.aside, .busiest .what', 2)
      await expectFits(page)
    })

    test("My year's peak month is your yap era, and fits", async ({ page }) => {
      await page.goto(`/#${await soloLink()}`)
      await page.evaluate(() => document.fonts.ready)
      await goTo(page, 'months')
      await expect(page.locator('.aside')).toHaveText(/^\w+ was your yap era$/)
      await expect(page.locator('.busiest .what')).toHaveText(/^what happened on \w{3} \d+\?$/)
      await expectLines(page, '.aside, .busiest .what', 2)
      await expectFits(page)
    })

    for (const months of [12, 11]) {
      test(`long names on your person's ${months} cards are written smaller or wrap, never cut, with a count under each`, async ({ page }) => {
        const wrap = makeFakeWrap('solo', { yearRound: true })
        if (months === 11) wrap.period = { from: '2026-01-01', to: '2026-11-22' }
        Object.assign(wrap.people, { p1: 'Alexandria Moss', p2: 'Bartholomew Finch', p3: 'Valentinovich Okafor', p4: 'Maximiliano Ruiz' })
        wrap.people.p5 = 'Wolfeschlegelsteinhausenberger Jr' // absurd: the only name allowed to end in "…"
        wrap.topPersonByMonth = ['p1', 'p2', 'p3', 'p4', 'p5', null, 'p1', 'p2', 'p3', 'p4', 'p1', 'p2']
        wrap.topPersonCountByMonth = [412, 1204, 87, 3, 12345, 0, 640, 99, 2210, 18, 404, 777]
        await page.goto(`/#${await packWrap(wrap)}`)
        await page.evaluate(() => document.fonts.ready)
        await goTo(page, 'month-people')
        await expect(page.locator('.month-people li')).toHaveCount(months)
        await expect(page.locator('.month-people .count')).toHaveCount(months - 1)
        await expect(page.locator('.month-people li').first()).toContainText('412')
        const names = await page.locator('.month-people .name').evaluateAll((items) =>
          items.map((el) => ({
            text: el.textContent!,
            lines: Math.round((el as HTMLElement).offsetHeight / parseFloat(getComputedStyle(el).lineHeight)),
            cut: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth,
          })),
        )
        for (const name of names) {
          expect(name.lines, `"${name.text}" takes too many lines`).toBeLessThanOrEqual(2)
          if (!name.text.startsWith('Wolfe')) expect(name.cut, `"${name.text}" is cut off`).toBe(false)
        }
        await expect(page.locator('.aside').first()).toHaveText('who you texted the most, month by month')
        await expectFits(page)
      })
    }

    test('My year shows your person month by month and the streak with one person', async ({ page }) => {
      await page.goto(`/#${await soloLink()}`)
      await goTo(page, 'month-people')
      const cards = page.locator('.month-people li')
      await expect(cards).toHaveCount(12)
      await expect(cards.nth(3).locator('.name')).toHaveText('Sam')
      await expect(cards.nth(5).locator('.name')).toHaveText('Jordan')
      await expect(cards.nth(3).locator('.count')).toHaveText(/^\d[\d,]*$/)
      await expect(page.locator('.aside').first()).toHaveText('who you texted the most, month by month')
      await expectFits(page, '.month-people .name')
      await goTo(page, 'streak')
      await expect(page.getByText('62 days')).toBeVisible()
      await expect(page.getByText('in a row with Sam')).toBeVisible()
      await expect(page.getByText('Apr 1 → Jun 1')).toBeVisible()
      await expect(page.locator('.aside, .lede, .never-missed')).toHaveCount(0) // 62 days: not long enough to move in
      await expectFits(page)
    })

    test('a streak over 100 days says to move in together, and still fits', async ({ page }) => {
      const wrap = makeFakeWrap('solo', { yearRound: true })
      wrap.personStreak = { personId: 'p2', days: 150, from: '2026-03-01' }
      await page.goto(`/#${await packWrap(wrap)}`)
      await page.evaluate(() => document.fonts.ready)
      await goTo(page, 'streak')
      await expect(page.locator('.aside')).toHaveText('at this point just move in together')
      await expect(page.locator('.never-missed')).toHaveCount(0)
      await expectLines(page, '.aside', 2)
      await expectFits(page)
    })

    test('the summary card: "top emoji" inside the stamp, and four even notes with one-line labels', async ({ page }) => {
      const solo = (first: string) => {
        const wrap = makeFakeWrap('solo', { yearRound: true })
        wrap.words.topEmoji = [{ emoji: '😭', count: 900 }]
        wrap.people.p1 = `${first} Raghunathan`
        wrap.personStreak = { personId: 'p1', days: 117, from: '2026-03-01' }
        wrap.volume.byPerson.me = 49887
        return wrap
      }
      for (const [wrap, streakLabel] of [[solo('Marisol'), 'streak w Marisol'], [solo('Valentinovich'), 'streak w Valentinovich'], [demo(), null]] as const) {
        await page.goto('about:blank')
        await page.goto(`/#${await packWrap(wrap)}`)
        await page.evaluate(() => document.fonts.ready)
        await goTo(page, 'summary')
        const slide = page.getByTestId('slide')
        await expect(slide.locator('.postage-label')).toHaveText('top emoji')
        await expect(slide).not.toContainText('most used')
        const at = await slide.evaluate((el) => {
          const stamp = el.querySelector('.postage > span')!
          const parts = [...stamp.children].map((part) => ({
            inside: part.getBoundingClientRect().left >= stamp.getBoundingClientRect().left - 0.5 &&
              part.getBoundingClientRect().right <= stamp.getBoundingClientRect().right + 0.5 &&
              part.getBoundingClientRect().top >= stamp.getBoundingClientRect().top - 0.5 &&
              part.getBoundingClientRect().bottom <= stamp.getBoundingClientRect().bottom + 0.5,
            cut: part.scrollWidth > part.clientWidth + 1,
          }))
          // Layout boxes (offset*), so the notes' tilts don't count.
          const notes = [...el.querySelectorAll<HTMLElement>('.summary-notes li')].map((li) => {
            const value = li.querySelector<HTMLElement>('b')!
            const label = li.querySelector<HTMLElement>('.hand')!
            return {
              height: li.offsetHeight, valueTop: value.offsetTop, labelTop: label.offsetTop, row: li.offsetTop,
              labelLines: Math.round((label.offsetHeight - 3) / parseFloat(getComputedStyle(label).fontSize)),
              valueCut: value.scrollWidth > value.clientWidth + 1,
              label: { text: label.textContent!, cut: label.scrollWidth > label.clientWidth + 1 },
            }
          })
          return { parts, notes }
        })
        for (const part of at.parts) expect(part, 'something sticks out of the stamp').toEqual({ inside: true, cut: false })
        for (const note of at.notes) {
          expect(note.height, 'the notes differ in height').toBeCloseTo(at.notes[0]!.height, 0)
          expect(note.valueTop).toBeCloseTo(at.notes[0]!.valueTop, 0)
          expect(note.labelTop).toBeCloseTo(at.notes[0]!.labelTop, 0)
          expect(note.labelLines, `"${note.label.text}" wraps`).toBe(1)
          expect(note.valueCut, 'a number is cut off').toBe(false)
        }
        if (streakLabel) {
          const streak = at.notes.find((n) => n.label.text === streakLabel)!
          expect(streak).toBeTruthy()
          // "Marisol" fits whole everywhere; a longer name is written smaller, then ends in "…" if it still doesn't fit.
          if (streakLabel === 'streak w Marisol') expect(streak.label.cut).toBe(false)
          await expect(slide.locator('.summary-notes b', { hasText: '49,887' })).toBeVisible()
        }
        await expectFits(page)
      }
    })

    test('a streak with no day missed gets a handwritten note under the calendar, and still fits', async ({ page }) => {
      const wrap = makeFakeWrap('solo', { yearRound: true })
      wrap.period = { from: '2026-01-01', to: '2026-11-22' }
      wrap.timing.longestStreakDays = 325
      wrap.personStreak = { personId: 'p2', days: 200, from: '2026-01-01' } // moving in applies too, but only one line shows
      await page.goto(`/#${await packWrap(wrap)}`)
      await page.evaluate(() => document.fonts.ready)
      await goTo(page, 'streak')
      await expect(page.locator('.never-missed')).toHaveText('and you never missed a day of texting')
      await expect(page.locator('.aside')).toHaveCount(0)
      await expectFits(page)
    })
  })
}

test('a link made before these stats still plays, with the months it already had', async ({ page }) => {
  const { topPersonByMonth: _m, personStreak: _s, vsLastYear: _v, ...older } = makeFakeWrap('solo', { yearRound: true })
  delete older.timing.busiestDay
  await page.goto(`/#${await packWrap(older as Wrap)}`)
  await goTo(page, 'months')
  await expect(page.locator('.busiest')).toHaveCount(0)
  await expect(page.locator('.aside')).toHaveText(/ was your yap era$/)
  await goTo(page, 'streak')
  await expect(page.getByText('in a row with at least one message')).toBeVisible()
  await expect(page.locator('[data-slide="month-people"]')).toHaveCount(0)
  await goTo(page, 'outro')
  await goTo(page, 'summary')
})

test('the demo link stays well under the limit', async () => {
  expect((await packWrap(demo())).length).toBeLessThan(4000)
})
