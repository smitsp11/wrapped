import { expect, test } from '@playwright/test'

// The demo keeps a way out: "Try it yourself →" goes back to the landing page and its install line, on every page,
// without covering anything on the page and without turning it.
for (const [width, height] of [[390, 844], [430, 932]] as const) {
  test(`the demo has a "Try it yourself" link on every page that covers nothing (${width}×${height})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height })
    await page.goto('/#demo')
    const slide = page.getByTestId('slide')
    for (let i = 0; i < 40; i++) {
      const id = (await slide.getAttribute('data-slide'))!
      const covered = await page.evaluate(() => {
        const pill = document.querySelector('[data-demo-exit]')!.getBoundingClientRect()
        return [...document.querySelectorAll('[data-testid=slide] *')]
          .filter((el) => el.children.length === 0)
          .map((el) => ({ text: (el.textContent ?? '').trim().slice(0, 30), r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width && r.height && r.bottom > pill.top && r.top < pill.bottom && r.right > pill.left && r.left < pill.right)
          .map(({ text }) => text)
      })
      expect(covered, id).toEqual([])
      if (id === 'summary') break
      await page.keyboard.press('ArrowRight')
    }
    await page.getByRole('link', { name: 'Try it yourself →' }).click()
    await expect(page.getByText('Open Terminal and paste')).toBeVisible()
  })
}

test('a shared wrap has no "Try it yourself" link; its outro has "Make yours"', async ({ page }) => {
  await page.goto('/#demo')
  await expect(page.locator('[data-demo-exit]')).toHaveCount(1)
  await page.goto('/')
  await expect(page.locator('[data-demo-exit]')).toHaveCount(0)
})

test('on a short screen the demo closes with the ✕ by the progress bar, and the pill is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/#demo')
  await expect(page.getByTestId('slide')).toBeVisible()
  await expect(page.locator('[data-demo-exit]')).toBeHidden()
  const [close, progress] = await Promise.all([page.locator('.demo-close').boundingBox(), page.locator('.progress').boundingBox()])
  expect(close!.x).toBeGreaterThanOrEqual(progress!.x + progress!.width) // beside the bar, not on it
  await page.getByRole('link', { name: 'Close the demo' }).click()
  await expect(page.getByText('Open Terminal and paste')).toBeVisible()
})
