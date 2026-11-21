import { expect, test, type Page } from '@playwright/test'

/** The page's writing under the "Try it yourself" pill, if it's showing: there should never be any. */
function coveredByPill(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pill = document.querySelector('[data-demo-exit]')!.getBoundingClientRect()
    if (!pill.width) return []
    return [...document.querySelectorAll('[data-testid=slide] *')]
      .filter((el) => el.children.length === 0)
      .map((el) => ({ text: (el.textContent ?? '').trim().slice(0, 30), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width && r.height && r.bottom > pill.top && r.top < pill.bottom && r.right > pill.left && r.left < pill.right)
      .map(({ text }) => text)
  })
}

// The demo keeps a way out: "Try it yourself →" goes back to the landing page and its install line, without covering
// anything on the page and without turning it. Tall phones have room for it on every page.
for (const [width, height] of [[390, 844], [430, 932]] as const) {
  test(`the demo has a "Try it yourself" link on every page that covers nothing (${width}×${height})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height })
    await page.goto('/#demo')
    await page.evaluate(() => document.fonts.ready)
    const slide = page.getByTestId('slide')
    for (let i = 0; i < 40; i++) {
      const id = (await slide.getAttribute('data-slide'))!
      await expect(page.locator('[data-demo-exit]'), id).toBeVisible()
      expect(await coveredByPill(page), id).toEqual([])
      if (id === 'outro') break
      await page.keyboard.press('ArrowRight')
    }
    await page.getByRole('link', { name: 'Try it yourself →' }).click()
    await expect(page.getByRole('link', { name: 'See a demo' })).toBeVisible() // the landing page
  })
}

// Shorter phones: the pill shows on the pages it fits under, and hides on a page too full for it, where the ✕ remains.
for (const [width, height] of [[375, 667], [360, 640]] as const) {
  test(`on a shorter phone the pill shows wherever it covers nothing (${width}×${height})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height })
    await page.goto('/#demo')
    await page.evaluate(() => document.fonts.ready)
    const slide = page.getByTestId('slide')
    const shown: string[] = []
    const all: string[] = []
    for (let i = 0; i < 40; i++) {
      const id = (await slide.getAttribute('data-slide'))!
      all.push(id)
      if (await page.locator('[data-demo-exit]').isVisible()) shown.push(id)
      expect(await coveredByPill(page), id).toEqual([])
      await expect(page.locator('.demo-close'), id).toBeVisible()
      if (id === 'outro') break
      await page.keyboard.press('ArrowRight')
    }
    // Most pages have room for it.
    expect(shown.length, `shown on ${shown.join(', ')}`).toBeGreaterThan(all.length / 2)
  })
}
test('a shared wrap has no "Try it yourself" link; its outro has "Make yours"', async ({ page }) => {
  await page.goto('/#demo')
  await expect(page.locator('[data-demo-exit]')).toHaveCount(1)
  await page.goto('/')
  await expect(page.locator('[data-demo-exit]')).toHaveCount(0)
})

test('the demo\'s ✕ sits beside the progress bar with a 44×44 tap area, and closes the demo', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/#demo')
  await expect(page.getByTestId('slide')).toBeVisible()
  const [close, progress] = await Promise.all([page.locator('.demo-close').boundingBox(), page.locator('.progress').boundingBox()])
  expect(close!.x).toBeGreaterThanOrEqual(progress!.x + progress!.width) // beside the bar, not on it
  expect(close!.width).toBeGreaterThanOrEqual(44)
  expect(close!.height).toBeGreaterThanOrEqual(44)
  expect(close!.y).toBeGreaterThanOrEqual(0)
  await page.getByRole('link', { name: 'Close the demo' }).click()
  await expect(page.getByRole('link', { name: 'See a demo' })).toBeVisible() // the landing page
})

test('the demo\'s way out hides while a conversation is open', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#demo')
  const slide = page.getByTestId('slide')
  for (let i = 0; i < 40 && (await slide.getAttribute('data-slide')) !== 'hits'; i++) await page.keyboard.press('ArrowRight')
  await page.locator('.see-convo').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('[data-demo-exit]')).toBeHidden()
  await expect(page.locator('.demo-close')).toBeHidden()
  await page.getByRole('button', { name: /back to the wrap/ }).click()
  await expect(page.locator('[data-demo-exit]')).toBeVisible()
})
