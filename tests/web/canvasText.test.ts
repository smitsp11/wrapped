import { describe, expect, it } from 'vitest'
import { fitText, splitTitle } from '../../web/src/maker/canvasText'

describe('splitTitle', () => {
  it('splits at the space nearest the middle', () => {
    expect(splitTitle('Friday Poker Night Crew')).toEqual(['Friday Poker', 'Night Crew'])
  })
  it('never leaves an emoji on a line by itself', () => {
    expect(splitTitle('Poker 🃏')).toEqual(['Poker 🃏'])
    expect(splitTitle('🃏 Poker Night 4 life 🃏')).toEqual(['🃏 Poker Night', '4 life 🃏'])
  })
  it('keeps a one-word title on one line', () => {
    expect(splitTitle('Roomies')).toEqual(['Roomies'])
  })
  it('never makes an empty line', () => {
    expect(splitTitle('Hi ')).toEqual(['Hi'])
  })
})

/** A fake canvas context: every character is half the font size wide. */
function fakeCtx() {
  const ctx = {
    font: '',
    measureText(text: string) {
      const px = Number(/(\d+)px/.exec(ctx.font)![1])
      return { width: text.length * px * 0.5 }
    },
  }
  return ctx as unknown as CanvasRenderingContext2D
}

describe('fitText', () => {
  it('keeps short text at full size', () => {
    const ctx = fakeCtx()
    expect(fitText(ctx, 'Hi', 800, 120, 900)).toEqual({ text: 'Hi', px: 120 })
    expect(ctx.font).toContain('120px')
  })
  it('shrinks long text until it fits', () => {
    const ctx = fakeCtx()
    const text = 'x'.repeat(40)
    const out = fitText(ctx, text, 800, 120, 900)
    expect(out.text).toBe(text)
    expect(out.px).toBeLessThan(120)
    expect(ctx.measureText(text).width).toBeLessThanOrEqual(900)
  })
  it('truncates with an ellipsis at the minimum size when it still does not fit', () => {
    const ctx = fakeCtx()
    const out = fitText(ctx, 'y'.repeat(500), 800, 120, 900)
    expect(out.text.endsWith('…')).toBe(true)
    expect(out.px).toBe(24)
    expect(ctx.measureText(out.text).width).toBeLessThanOrEqual(900)
  })
  it('never goes below a per-line minimum', () => {
    const ctx = fakeCtx()
    const out = fitText(ctx, 'z'.repeat(60), 800, 120, 900, 64)
    expect(out.px).toBe(64)
    expect(out.text.endsWith('…')).toBe(true)
    expect(ctx.font).toContain('64px')
    expect(ctx.measureText(out.text).width).toBeLessThanOrEqual(900)
  })
  it('does not split an emoji when truncating', () => {
    const ctx = fakeCtx()
    const out = fitText(ctx, '👨‍👩‍👧'.repeat(100), 800, 120, 900, 64)
    expect(out.text.endsWith('…')).toBe(true)
    expect(out.text.slice(0, -1)).toMatch(/^(👨‍👩‍👧)+$/u)
  })
})
