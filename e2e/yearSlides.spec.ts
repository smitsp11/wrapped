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

    test('the demo shows its peak month and busiest day, with no caption and no last year', async ({ page }) => {
      await page.goto('/#demo')
      await page.evaluate(() => document.fonts.ready)
      await goTo(page, 'months')
      const slide = page.getByTestId('slide')
      await expect(slide.getByRole('heading', { name: 'Peak month' })).toBeVisible()
      await expect(slide.locator('.aside')).toHaveCount(0)
      await expect(slide).not.toContainText('2025')
      await expect(slide.locator('.months span')).toHaveCount(12)
      await expect(slide.locator('.day-page')).toHaveText('May 21')
      await expect(slide.getByText('633 messages')).toBeVisible()
      await expectFits(page)
    })

    test('My year shows your person month by month and the streak with one person', async ({ page }) => {
      await page.goto(`/#${await soloLink()}`)
      await goTo(page, 'month-people')
      const cards = page.locator('.month-people li')
      await expect(cards).toHaveCount(12)
      await expect(cards.nth(3)).toHaveText('AprSam')
      await expect(cards.nth(5)).toHaveText('JunJordan')
      await expectFits(page, '.month-people .name')
      await goTo(page, 'streak')
      await expect(page.getByText('62 days')).toBeVisible()
      await expect(page.getByText('in a row with Sam')).toBeVisible()
      await expect(page.getByText('Apr 1 → Jun 1')).toBeVisible()
      await expect(page.locator('.aside, .lede, .never-missed')).toHaveCount(0)
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
      await page.goto(`/#${await packWrap(wrap)}`)
      await page.evaluate(() => document.fonts.ready)
      await goTo(page, 'streak')
      await expect(page.locator('.never-missed')).toHaveText('and you never missed a day of texting')
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
  await expect(page.locator('.aside')).toHaveCount(0)
  await goTo(page, 'streak')
  await expect(page.getByText('in a row with at least one message')).toBeVisible()
  await expect(page.locator('[data-slide="month-people"]')).toHaveCount(0)
  await goTo(page, 'outro')
  await goTo(page, 'summary')
})

test('the demo link stays well under the limit', async () => {
  expect((await packWrap(demo())).length).toBeLessThan(4000)
})
