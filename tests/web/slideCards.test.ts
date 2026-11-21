import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { buildSlides } from '../../web/src/slides'
import { HEIGHT, WIDTH } from '../../web/src/maker/canvasPaper'
import { drawSlideCard } from '../../web/src/save/drawSlideCard'
import { saveMethod } from '../../web/src/save/saveControl'
import { type SlideCard, slideCardFor } from '../../web/src/save/slideCards'
import { drawYouCard, youCardFrom } from '../../web/src/maker/youCard'

const group = () => makeFakeWrap('group')

describe('slideCardFor: which slides can be saved', () => {
  it('is greatest hits, the vocabulary, each award and the summary card, and nothing else', () => {
    for (const wrap of [group(), makeFakeWrap('solo')]) {
      const saveable = buildSlides(wrap)
        .map((s) => s.id)
        .filter((id) => slideCardFor(wrap, id))
      expect(saveable).toEqual(['words', 'hits', ...wrap.awards.map((a) => `award-${a.id}`), 'summary'])
    }
  })

  it('is null for a slide the wrap does not have', () => {
    const wrap = group()
    wrap.greatestHits = []
    wrap.words.topWords = []
    wrap.words.topEmoji = []
    expect(slideCardFor(wrap, 'hits')).toBeNull()
    expect(slideCardFor(wrap, 'words')).toBeNull()
    expect(slideCardFor(wrap, 'award-lurker')).toBeNull()
    expect(slideCardFor(wrap, 'outro')).toBeNull()
  })
})

describe('slideCardFor: greatest hits', () => {
  it('has the quotes, names, reaction counts and dates as the slide shows them', () => {
    expect(slideCardFor(group(), 'hits')).toEqual({
      kind: 'hits',
      kicker: 'Poker Night · Wrapped 2026',
      fileName: 'poker-night-greatest-hits.png',
      quotes: [
        { text: 'poker tonight?', who: 'Alex Chen', reactions: '4 reactions', when: 'Jan 12, 8:00 PM' },
        { text: 'omw', who: 'You', reactions: '3 reactions', when: 'Jan 25, 8:14 PM' },
        { text: 'who has the cards and chips. run it back', who: 'You', reactions: '3 reactions', when: 'Jan 26, 8:40 PM' },
      ],
    })
  })

  it('leaves out the conversations behind the quotes', async () => {
    const wrap = group()
    const card = slideCardFor(wrap, 'hits')!
    expect(JSON.stringify(card)).not.toMatch(/conversation|messages/)
    const quotes = wrap.greatestHits.map((h) => h.text)
    const around = wrap.greatestHits
      .flatMap((h) => h.conversation?.messages ?? [])
      .map((m) => m.text)
      .filter((text) => text && !quotes.includes(text))
    expect(around.length).toBeGreaterThan(0)
    const { all } = await drawn(card)
    for (const text of around) expect(all).not.toContain(text)
  })

  it('keeps the top three, says "1 reaction", and names someone it does not know "Someone"', () => {
    const wrap = group()
    const hit = wrap.greatestHits[0]!
    wrap.greatestHits = [hit, { ...hit, reactions: 1, senderId: 'nobody' }, hit, hit]
    const card = slideCardFor(wrap, 'hits')!
    if (card.kind !== 'hits') throw new Error('expected hits')
    expect(card.quotes).toHaveLength(3)
    expect(card.quotes[1]).toMatchObject({ who: 'Someone', reactions: '1 reaction' })
  })
})

describe('slideCardFor: vocabulary', () => {
  it("has the group's top words (most used first), emoji and everyone's signature word", () => {
    expect(slideCardFor(group(), 'words')).toEqual({
      kind: 'words',
      kicker: 'Poker Night · Wrapped 2026',
      fileName: 'poker-night-vocabulary.png',
      heading: "The group's vocabulary",
      words: [
        { word: 'poker', count: '120' },
        { word: 'rebuy', count: '90' },
        { word: 'chips', count: '81' },
        { word: 'omw', count: '65' },
        { word: 'run it back', count: '50' },
      ],
      emoji: ['🃏'],
      // Most messages sent first, like the slide.
      signatures: [
        { says: 'Alex Chen says', word: 'run it back' },
        { says: 'You say', word: 'omw' },
        { says: 'Sam Rivera says', word: 'chips' },
        { says: 'Jordan Lee says', word: 'rebuy' },
        { says: 'Riley Park says', word: 'dealer' },
      ],
    })
  })

  it('shows the same words as the slide', () => {
    const wrap = group()
    const html = buildSlides(wrap).find((s) => s.id === 'words')!.html
    const shown = [...html.matchAll(/<span class="word">([^<]*)<\/span>/g)].map((m) => m[1])
    const card = slideCardFor(wrap, 'words')!
    if (card.kind !== 'words') throw new Error('expected words')
    expect(card.words.map((w) => w.word)).toEqual(shown)
  })

  it('names a shared wrap’s sender, and titles a solo wrap "Your vocabulary"', () => {
    const shared = group()
    shared.people.me = 'Riya'
    const card = slideCardFor(shared, 'words')!
    if (card.kind !== 'words') throw new Error('expected words')
    expect(card.signatures).toContainEqual({ says: 'Riya says', word: 'omw' })

    const solo = slideCardFor(makeFakeWrap('solo'), 'words')!
    expect(solo).toMatchObject({ heading: 'Your vocabulary', kicker: 'Texts Wrapped 2026', fileName: 'my-texts-vocabulary.png' })
  })
})

describe('slideCardFor: awards', () => {
  it('has the award, the year, the winner and the number behind it', () => {
    expect(slideCardFor(group(), 'award-main-character')).toEqual({
      kind: 'award',
      kicker: 'Poker Night · Wrapped 2026',
      fileName: 'poker-night-main-character.png',
      title: 'Main Character',
      year: '2026',
      winner: 'Alex Chen',
      label: '27% of all messages',
    })
    expect(slideCardFor(group(), 'award-double-texter')).toMatchObject({ winner: 'You', fileName: 'poker-night-double-texter.png' })
  })

  it('makes a file name from any title, emoji and all', () => {
    const wrap = group()
    wrap.title = 'Poker 🃏 Night!!'
    expect(slideCardFor(wrap, 'award-ghost')!.fileName).toBe('poker-night-the-ghost.png')
    wrap.title = '🃏🃏'
    expect(slideCardFor(wrap, 'hits')!.fileName).toBe('greatest-hits.png')
  })
})

/** A canvas that records every piece of text drawn on it. Every character is half the font size wide. */
function recordingCanvas() {
  const texts: string[] = []
  const state: Record<string | symbol, unknown> = { font: '10px sans-serif' }
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === 'fillText') return (text: string) => texts.push(text)
      if (key === 'measureText') {
        return (text: string) => ({ width: [...text].length * Number(/(\d+)px/.exec(String(target.font))![1]) * 0.5 })
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

async function drawn(card: SlideCard): Promise<{ size: number[]; texts: string[]; all: string }> {
  const { canvas, texts } = recordingCanvas()
  await drawSlideCard(canvas, card)
  return { size: [canvas.width, canvas.height], texts, all: texts.join(' ') }
}

describe('drawSlideCard', () => {
  it('draws greatest hits as a 1080×1920 story with the quotes, who, reactions, dates and the site', async () => {
    const { size, texts, all } = await drawn(slideCardFor(group(), 'hits')!)
    expect(size).toEqual([WIDTH, HEIGHT])
    expect(texts).toEqual(expect.arrayContaining([
      'POKER NIGHT · WRAPPED 2026', 'Alex Chen · 4 reactions', 'Jan 12, 8:00 PM', 'You · 3 reactions',
      'Jan 25, 8:14 PM', 'wrapped.smitpatel.xyz',
    ]))
    expect(all).toContain('Greatest hits')
    expect(all).toContain('“poker tonight?”')
    expect(all).toContain('“omw”')
    expect(all).not.toContain('see the convo')
    expect(all).not.toContain('ranked by')
  })

  it('cuts a very long quote short rather than running off the card', async () => {
    const wrap = group()
    wrap.greatestHits = wrap.greatestHits.map((h) => ({ ...h, text: 'so '.repeat(400).trim() }))
    const { texts } = await drawn(slideCardFor(wrap, 'hits')!)
    expect(texts.filter((t) => t.endsWith('…”'))).toHaveLength(3)
  })

  it('draws the vocabulary with every word, count, emoji and signature word', async () => {
    const { size, texts, all } = await drawn(slideCardFor(group(), 'words')!)
    expect(size).toEqual([WIDTH, HEIGHT])
    expect(texts).toEqual(expect.arrayContaining([
      'Top words & phrases', 'poker', '120', 'run it back', '50', 'Top emoji', '🃏', 'Alex Chen says ', '“run it back”',
      'You say ', '“omw”', 'wrapped.smitpatel.xyz',
    ]))
    expect(all).toContain("The group's")
    expect(all).toContain('vocabulary')
  })

  it('draws an award: the stamp with its title and year, the winner and the number behind it', async () => {
    const { size, texts, all } = await drawn(slideCardFor(group(), 'award-main-character')!)
    expect(size).toEqual([WIDTH, HEIGHT])
    expect(texts).toEqual(expect.arrayContaining([
      'and the award for…', 'CERTIFIED', '2026', 'goes to', 'Alex Chen', '27% of all messages', 'wrapped.smitpatel.xyz',
    ]))
    expect(all).toContain('Main')
    expect(all).toContain('Character')
  })

  it('splits a long winner name over two lines', async () => {
    const wrap = group()
    wrap.people.p1 = 'Alexandra Montgomery-Chen Fitzgerald'
    const { texts } = await drawn(slideCardFor(wrap, 'award-main-character')!)
    expect(texts).toEqual(expect.arrayContaining(['Alexandra Montgomery-Chen', 'Fitzgerald']))
  })
})

describe('slideCardFor: the summary card', () => {
  it("is your personal share card in My year, saved under the maker's name for it", () => {
    const solo = makeFakeWrap('solo')
    const card = slideCardFor(solo, 'summary')!
    expect(card).toMatchObject({ kind: 'you', fileName: 'my-2026-in-texts.png' })
    if (card.kind !== 'you') throw new Error('expected your card')
    expect(card.card).toEqual(youCardFrom(solo))
  })

  it("is the group's card in a group wrap: its name, total, top word, top emoji and three award winners", () => {
    expect(slideCardFor(group(), 'summary')).toEqual({
      kind: 'group',
      fileName: 'poker-night-2026-in-texts.png',
      card: {
        year: '2026',
        title: 'Poker Night',
        period: 'Jan 1 → Dec 31',
        messages: group().volume.total,
        topWord: 'poker',
        topEmoji: '🃏',
        awards: [
          { title: 'Main Character', winner: 'Alex Chen' },
          { title: 'The Ghost', winner: expect.any(String) },
          { title: 'The Starter', winner: expect.any(String) },
        ],
      },
    })
  })

  it('leaves out what the group wrap does not have', () => {
    const wrap = group()
    wrap.words.topWords = []
    wrap.words.topEmoji = []
    wrap.awards = []
    const card = slideCardFor(wrap, 'summary')!
    if (card.kind !== 'group') throw new Error('expected the group card')
    expect(card.card).not.toHaveProperty('topWord')
    expect(card.card).not.toHaveProperty('topEmoji')
    expect(card.card.awards).toEqual([])
  })
})

describe('drawSlideCard: the summary cards', () => {
  it('draws your share card, the same as the maker does', async () => {
    const solo = makeFakeWrap('solo')
    const { size, texts } = await drawn(slideCardFor(solo, 'summary')!)
    const own = recordingCanvas()
    await drawYouCard(own.canvas, youCardFrom(solo))
    expect(size).toEqual([WIDTH, HEIGHT])
    expect(texts).toEqual(own.texts)
    expect(texts).toEqual(expect.arrayContaining(['my 2026', 'in texts', 'MY TEXTING PERSONALITY', 'texts sent']))
  })

  it("draws the group's card: name, total, top word and the winners", async () => {
    const wrap = group()
    const { size, texts, all } = await drawn(slideCardFor(wrap, 'summary')!)
    expect(size).toEqual([WIDTH, HEIGHT])
    expect(texts).toEqual(expect.arrayContaining([
      'our 2026', 'in texts', 'OUR GROUP CHAT', 'Jan 1 → Dec 31', wrap.volume.total.toLocaleString('en-US'),
      'messages', '“poker”', 'top word', 'TOP EMOJI', '🃏', '★ Main Character · Alex Chen', 'wrapped.smitpatel.xyz',
    ]))
    expect(all).toContain('Poker') // one line or two, as it fits
    expect(all).toContain('Night')
    expect(all).not.toContain('MY TEXTING PERSONALITY')
  })
})

describe('saveMethod', () => {
  it('shares the file on a phone that can, so the share sheet offers Save Image, Messages and Instagram', () => {
    expect(saveMethod({ touch: true, canShareFiles: true })).toBe('share')
  })
  it('shows the image to press and hold on a phone that cannot share files', () => {
    expect(saveMethod({ touch: true, canShareFiles: false })).toBe('preview')
  })
  it('downloads on a computer, even one that can share', () => {
    expect(saveMethod({ touch: false, canShareFiles: true })).toBe('download')
    expect(saveMethod({ touch: false, canShareFiles: false })).toBe('download')
  })
})
