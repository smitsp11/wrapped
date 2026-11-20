import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import type { Wrap } from '../../src/types'
import { PERSONALITIES } from '../../src/wrap/personality'
import { HEIGHT, WIDTH, type YouCard, cardStats, drawYouCard, notePositions, wrapLines, youCardFrom } from '../../web/src/maker/youCard'

describe('youCardFrom', () => {
  it('describes the fake solo wrap with your own numbers', () => {
    expect(youCardFrom(makeFakeWrap('solo'))).toEqual({
      year: '2026',
      personality: PERSONALITIES['double-texter'],
      textsSent: 85,
      peakHour: '8 PM',
      typicalReply: '14 min',
      longestStreakDays: 61,
      awards: ['Double Texter'],
    })
  })

  it('keeps your top emoji and only your awards', () => {
    const wrap = makeFakeWrap('solo')
    wrap.words.topEmoji = [{ emoji: '😭', count: 9 }, { emoji: '💀', count: 3 }]
    wrap.awards = [
      { id: 'hype', title: 'Hype Man', personId: 'me', value: 9, label: 'gave 9 reactions' },
      { id: 'ghost', title: 'The Ghost', personId: 'p1', value: 90, label: 'median reply 1h 30m' },
    ]
    const card = youCardFrom(wrap)
    expect(card.topEmoji).toBe('😭')
    expect(card.awards).toEqual(['Hype Man'])
  })

  it('leaves out what the wrap does not have instead of guessing', () => {
    const wrap = makeFakeWrap('solo')
    wrap.timing.byHour = new Array(24).fill(0)
    wrap.timing.longestStreakDays = 1
    wrap.replies.repliesByPerson.me = 4
    wrap.words.topEmoji = []
    wrap.awards = []
    const card = youCardFrom(wrap)
    expect(card).not.toHaveProperty('peakHour')
    expect(card).not.toHaveProperty('typicalReply')
    expect(card).not.toHaveProperty('longestStreakDays')
    expect(card).not.toHaveProperty('topEmoji')
    expect(card.awards).toEqual([])
  })

  it('formats a fast typical reply in seconds', () => {
    const wrap = makeFakeWrap('solo')
    wrap.replies.medianReplyMinutesByPerson.me = 0.7
    expect(youCardFrom(wrap).typicalReply).toBe('42 sec')
  })

  it('says 0 texts sent when you sent nothing, and ignores an inherited "me"', () => {
    const wrap = makeFakeWrap('solo')
    wrap.volume.byPerson = Object.create({ me: 99 }) as Record<string, number>
    expect(youCardFrom(wrap).textsSent).toBe(0)
  })

  it('never holds another name, a chat title, a quote or a word you texted', () => {
    const secrets = [
      'Zebulon Quackenbush', 'Marigold Featherstone', 'Everyone else', 'Secret Bunker Crew', 'Thursday Trivia Gang',
      'the pineapple incident was not my fault', 'flibbertigibbet', 'snorkelwax', 'xylograph', '+1 555 0100',
    ]
    const wrap: Wrap = makeFakeWrap('solo')
    wrap.people = { me: 'You', p1: secrets[0]!, p2: secrets[1]!, others: secrets[2]! }
    wrap.topChats = [{ name: secrets[3]!, messages: 200 }, { name: secrets[4]!, messages: 100 }]
    wrap.greatestHits = [{ senderId: 'me', text: secrets[5]!, sentAt: '2026-02-01T00:00:00.000Z', reactions: 4, laughs: 3 }]
    wrap.words.signatureWordByPerson = { me: secrets[6]!, p1: secrets[7]! }
    wrap.words.topWords = [{ word: secrets[8]!, count: 50 }]
    wrap.words.topEmoji = [{ emoji: '🃏', count: 5 }]
    wrap.title = secrets[9]!
    wrap.awards.push({ id: 'ghost', title: 'The Ghost', personId: 'p1', value: 300, label: 'median reply 5h 0m' })

    const json = JSON.stringify(youCardFrom(wrap)).toLowerCase()
    for (const secret of secrets) expect(json).not.toContain(secret.toLowerCase())
    for (const name of Object.values(wrap.people).filter((n) => n !== 'You')) expect(json).not.toContain(name.toLowerCase())
    // The Ghost went to someone else, so it isn't on your card either.
    expect(json).not.toContain('ghost')
  })
})

describe('cardStats', () => {
  const card: YouCard = {
    year: '2026', personality: PERSONALITIES.yapper, textsSent: 38412, peakHour: '1 AM', typicalReply: '42 sec',
    longestStreakDays: 143, awards: [],
  }
  it('lists texts sent, peak hour, typical reply and streak in that order', () => {
    expect(cardStats(card)).toEqual([
      { value: '38,412', label: 'texts sent' },
      { value: '1 AM', label: 'peak hour' },
      { value: '42 sec', label: 'typical reply' },
      { value: '143 days', label: 'longest streak' },
    ])
  })
  it('skips the ones the card does not have', () => {
    expect(cardStats({ ...card, peakHour: undefined, longestStreakDays: undefined }).map((s) => s.label)).toEqual([
      'texts sent', 'typical reply',
    ])
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

describe('wrapLines', () => {
  it('keeps a short line whole', () => {
    const ctx = fakeCtx()
    ctx.font = '700 10px Caveat'
    expect(wrapLines(ctx, 'One message is never enough.', 1000)).toEqual(['One message is never enough.'])
  })
  it('breaks at spaces so each line fits', () => {
    const ctx = fakeCtx()
    ctx.font = '700 10px Caveat'
    const lines = wrapLines(ctx, 'Why send a text when you can send a paragraph?', 120)
    expect(lines.join(' ')).toBe('Why send a text when you can send a paragraph?')
    for (const line of lines) expect(ctx.measureText(line).width).toBeLessThanOrEqual(120)
    expect(lines.length).toBeGreaterThan(1)
  })
  it('gives a word too long for any line a line to itself', () => {
    const ctx = fakeCtx()
    ctx.font = '700 10px Caveat'
    expect(wrapLines(ctx, 'hi supercalifragilistic yo', 40)).toEqual(['hi', 'supercalifragilistic', 'yo'])
  })
})

describe('notePositions', () => {
  it('lays four notes out two by two', () => {
    const at = notePositions(4)
    expect(at[0]!.y).toBe(at[1]!.y)
    expect(at[2]!.y).toBe(at[3]!.y)
    expect(at[2]!.y).toBeGreaterThan(at[0]!.y)
    expect(at[0]!.x).toBe(at[2]!.x)
  })
  it('centres an odd note out on its own row', () => {
    const at = notePositions(3)
    expect(at[2]!.y).toBeGreaterThan(at[0]!.y)
    expect(at[2]!.x - at[0]!.x).toBe(at[1]!.x - at[2]!.x)
    expect(notePositions(1)[0]!.x).toBe(at[2]!.x)
  })
  it('keeps every note on the card, above the award chips', () => {
    for (const { x, y } of notePositions(4)) {
      expect(x).toBeGreaterThanOrEqual(40)
      expect(x + 440).toBeLessThanOrEqual(WIDTH - 40)
      expect(y + 190).toBeLessThan(1600)
    }
  })
})

/** A canvas whose context records every fillText and ignores other drawing calls. */
function recordingCanvas() {
  const texts: string[] = []
  const state: Record<string | symbol, unknown> = { font: '10px sans-serif' }
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === 'fillText') return (text: string) => texts.push(text)
      if (key === 'measureText') {
        return (text: string) => ({ width: text.length * Number(/(\d+)px/.exec(String(target.font))![1]) * 0.5 })
      }
      if (key in target) return target[key]
      return () => {}
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
  const canvas = { width: 0, height: 0, getContext: () => ctx }
  return { canvas: canvas as unknown as HTMLCanvasElement, texts }
}

describe('drawYouCard', () => {
  it('draws a 1080×1920 card with the heading, personality, stamp, stats, awards and site', async () => {
    const wrap = makeFakeWrap('solo')
    wrap.words.topEmoji = [{ emoji: '😭', count: 9 }]
    const { canvas, texts } = recordingCanvas()
    await drawYouCard(canvas, youCardFrom(wrap))
    expect([canvas.width, canvas.height]).toEqual([WIDTH, HEIGHT])
    expect(texts).toEqual(expect.arrayContaining([
      'my 2026', 'in texts', 'Double', 'Texter', 'CERTIFIED', '😭', '85', 'texts sent', '★ Double Texter', 'wrapped.smitpatel.xyz',
    ]))
    const drawn = texts.join(' ')
    expect(drawn).toContain('One message is never enough.')
    for (const name of ['Alex Chen', 'Sam Rivera', 'Jordan Lee', 'Riley Park', 'Poker Night']) expect(drawn).not.toContain(name)
  })

  it('skips the postage stamp without a top emoji', async () => {
    const { canvas, texts } = recordingCanvas()
    await drawYouCard(canvas, youCardFrom(makeFakeWrap('solo')))
    expect(texts).not.toContain('TOP EMOJI')
  })
})
