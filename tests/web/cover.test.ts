import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { coverLines, fitText, splitTitle } from '../../web/src/maker/cover'

describe('coverLines', () => {
  it('describes a group wrap', () => {
    const lines = coverLines(makeFakeWrap('group'))
    expect(lines.hand).toBe('our 2026, wrapped')
    expect(lines.title).toBe('Pasta Gang')
    expect(lines.count).toBe('302')
    expect(lines.countLabel).toBe('messages')
    expect(lines.awards).toEqual([
      { title: 'Main Character', name: 'Alex Chen' },
      { title: 'The Ghost', name: 'Jordan Lee' },
    ])
  })
  it('describes a solo wrap', () => {
    expect(coverLines(makeFakeWrap('solo')).hand).toBe('my 2026, in texts')
  })
  it('says "message" for exactly one', () => {
    const wrap = makeFakeWrap('group')
    wrap.volume.total = 1
    expect(coverLines(wrap).countLabel).toBe('message')
  })
  it('names an id missing from people "Someone"', () => {
    const wrap = makeFakeWrap('group')
    wrap.awards[0]!.personId = 'toString'
    expect(coverLines(wrap).awards[0]!.name).toBe('Someone')
  })
})

describe('splitTitle', () => {
  it('splits at the space nearest the middle', () => {
    expect(splitTitle('Pasta Gang')).toEqual(['Pasta', 'Gang'])
    expect(splitTitle('The Pasta Gang Forever')).toEqual(['The Pasta', 'Gang Forever'])
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
