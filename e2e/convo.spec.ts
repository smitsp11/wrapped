import { expect, test, type Locator, type Page } from '@playwright/test'

/** "What was the convo?" on the demo wrap: its two greatest hits each have a made-up conversation. */

const currentSlide = (page: Page) => page.getByTestId('slide').getAttribute('data-slide')

async function toHits(page: Page): Promise<void> {
  await page.goto('/#demo')
  await expect(page.getByTestId('slide')).toBeVisible()
  for (let i = 0; i < 40 && (await currentSlide(page)) !== 'hits'; i++) await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')
}

const isTouch = (page: Page) => page.evaluate(() => matchMedia('(pointer: coarse)').matches)

/** A tap on a phone, a click on a laptop. */
async function press(locator: Locator): Promise<void> {
  if (await isTouch(locator.page())) await locator.tap()
  else await locator.click()
}

/**
 * Drags from the middle of `locator` by `dy` px, holding still for `holdMs` first: a real mouse on a laptop, and touch
 * pointer events on a phone (Playwright has no touch drag or long press).
 */
async function drag(locator: Locator, { dy = 0, holdMs = 0 }: { dy?: number; holdMs?: number }): Promise<void> {
  const page = locator.page()
  const box = (await locator.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  if (!(await isTouch(page))) {
    await page.mouse.move(x, y)
    await page.mouse.down()
    if (holdMs) await page.waitForTimeout(holdMs)
    if (dy) await page.mouse.move(x, y + dy, { steps: 6 })
    await page.mouse.up()
    return
  }
  const touch = { pointerType: 'touch', isPrimary: true, pointerId: 7, button: 0, bubbles: true }
  const at = (step: number) => ({ ...touch, clientX: x, clientY: y + step })
  await locator.dispatchEvent('pointerdown', at(0))
  if (holdMs) await page.waitForTimeout(holdMs)
  for (const step of [dy / 3, (2 * dy) / 3, dy].filter(Boolean)) await locator.dispatchEvent('pointermove', at(step))
  await locator.dispatchEvent('pointerup', at(dy))
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'what was the convo?' })

/** How far the hit's middle is from the middle of the visible thread, in px. */
function offCentre(page: Page): Promise<number> {
  return dialog(page).evaluate((el) => {
    const thread = el.querySelector('.thread')!.getBoundingClientRect()
    const hit = el.querySelector('[data-hit]')!.getBoundingClientRect()
    return Math.abs(hit.top + hit.height / 2 - (thread.top + thread.height / 2))
  })
}

/** The hit bubble's scale, from its computed transform (1 when it isn't lifted). */
function hitScale(page: Page): Promise<number> {
  return dialog(page).locator('[data-hit] .bubble').evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
}

const seeConvo = (page: Page, i: number) => page.locator(`[data-convo="${i}"] .see-convo`)

test('"see the convo" opens the conversation, lifted and centred, without flipping the page', async ({ page }) => {
  await toHits(page)
  await press(seeConvo(page, 0))
  await expect(dialog(page)).toBeVisible()
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')

  // Focus moves into the dialog, onto its labelled close button.
  await expect(page.getByRole('button', { name: '← back to the wrap' })).toBeFocused()
  await expect(dialog(page)).toHaveAttribute('aria-modal', 'true')

  await expect(dialog(page)).toHaveAttribute('data-state', 'lifted')
  const hit = dialog(page).locator('[data-hit]')
  await expect(hit).toContainText('poker tonight?')
  await expect(hit.locator('.tapback')).toHaveText('😂 ×4')
  await expect.poll(() => hitScale(page)).toBeGreaterThan(1.1)
  // The rest stays visible behind it, dimmed.
  await expect.poll(() => dialog(page).locator('.msg:not(.hit)').first().evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.5)
  expect(await dialog(page).locator('.msg').count()).toBeGreaterThan(10)
  expect(await offCentre(page)).toBeLessThan(40)
})

test('a tap settles the hit so the whole thread reads and scrolls; tapping the quote lifts it again', async ({ page }) => {
  await toHits(page)
  await press(seeConvo(page, 0))
  await expect(dialog(page)).toHaveAttribute('data-state', 'lifted')
  await press(dialog(page).locator('.shot-top'))
  await expect(dialog(page)).toHaveAttribute('data-state', 'settled')
  await expect.poll(() => hitScale(page)).toBe(1)
  await expect.poll(() => dialog(page).locator('.msg:not(.hit)').first().evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1)

  const thread = dialog(page).locator('.thread')
  expect(await thread.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto')
  await thread.evaluate((el) => el.scrollTo({ top: 0 }))
  await expect(dialog(page).getByText('you good? you left in a hurry last night')).toBeInViewport()
  await expect(dialog(page)).toHaveAttribute('data-state', 'settled')

  await press(dialog(page).locator('[data-hit] .bubble'))
  await expect(dialog(page)).toHaveAttribute('data-state', 'lifted')
})

test('back returns to the same slide, with focus on the quote that opened it', async ({ page }) => {
  await toHits(page)
  await press(seeConvo(page, 1))
  await expect(dialog(page).locator('[data-hit]')).toContainText('omw')
  await press(page.getByRole('button', { name: '← back to the wrap' }))
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')
  await expect(page.locator('[data-convo="1"] .see-convo')).toBeFocused()
  // The story works again.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('slide')).not.toHaveAttribute('data-slide', 'hits')
})

test('Escape closes it and stays on the slide; keys never flip the page underneath', async ({ page }) => {
  await toHits(page)
  await press(seeConvo(page, 0))
  await expect(dialog(page)).toBeVisible()
  await press(dialog(page).locator('.shot-top')) // focus leaves the back button (where Space would press it)
  for (const key of ['ArrowRight', 'ArrowLeft', 'Space', 'Enter']) await page.keyboard.press(key)
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')
  await expect(page.locator('#app')).not.toHaveAttribute('inert')
})

test('a tap elsewhere on the card turns the page like any other tap', async ({ page }) => {
  await toHits(page)
  await press(page.locator('[data-convo="0"] blockquote'))
  await expect(page.getByTestId('slide')).not.toHaveAttribute('data-slide', 'hits')
  await expect(dialog(page)).toHaveCount(0)
})

test('the "see the convo" link is at least 44px tall to tap', async ({ page }) => {
  await toHits(page)
  for (const i of [0, 1]) expect((await seeConvo(page, i).boundingBox())!.height).toBeGreaterThanOrEqual(44)
})

test('pressing and holding a card opens its conversation, and letting go neither settles it nor flips the page', async ({ page }) => {
  await toHits(page)
  await drag(page.locator('[data-convo="1"] blockquote'), { holdMs: 700 })
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).locator('[data-hit]')).toContainText('omw')
  await expect(dialog(page)).toHaveAttribute('data-state', 'lifted')
  await page.waitForTimeout(300)
  await expect(dialog(page)).toHaveAttribute('data-state', 'lifted')
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')
})

test('a press that slides away instead of holding does not open it', async ({ page }) => {
  await toHits(page)
  await drag(page.locator('[data-convo="0"] blockquote'), { dy: 40, holdMs: 0 })
  await page.waitForTimeout(700)
  await expect(dialog(page)).toHaveCount(0)
})

test('swiping the page down closes it; a short swipe springs back', async ({ page }) => {
  await toHits(page)
  await press(seeConvo(page, 0))
  await expect(dialog(page)).toHaveAttribute('data-state', 'lifted')
  await drag(dialog(page).locator('.convo-title'), { dy: 40 })
  await expect(dialog(page)).toBeVisible()
  await expect.poll(() => dialog(page).locator('.convo-sheet').evaluate((el) => getComputedStyle(el).transform)).toBe('none')
  await drag(dialog(page).locator('.convo-title'), { dy: 160 })
  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')
  await expect(seeConvo(page, 0)).toBeFocused()
})

test('the keyboard opens it from "see the convo", and Enter there does not flip the page', async ({ page }) => {
  await toHits(page)
  await page.locator('[data-convo="0"] .see-convo').focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  await expect(page.getByTestId('slide')).toHaveAttribute('data-slide', 'hits')
})

test('with reduced motion the hit is lifted straight away', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toHits(page)
  await press(seeConvo(page, 0))
  await expect(dialog(page)).toHaveAttribute('data-state', 'lifted', { timeout: 100 })
  expect(await hitScale(page)).toBeGreaterThan(1.1)
})

// A phone, a laptop, and the 300×600 preview inside the maker: the page fits, nothing spills sideways, the hit is centred.
for (const [width, height] of [[390, 844], [1440, 900], [300, 600]] as const) {
  test(`fits at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await toHits(page)
    await press(seeConvo(page, 0))
    await expect(dialog(page)).toHaveAttribute('data-state', 'lifted')
    const box = (await dialog(page).locator('.convo-sheet').boundingBox())!
    expect(box.width).toBeLessThanOrEqual(width)
    expect(box.height).toBeLessThanOrEqual(height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    await expect(dialog(page).getByRole('button', { name: '← back to the wrap' })).toBeInViewport()
    expect(await offCentre(page)).toBeLessThan(40)
  })
}
