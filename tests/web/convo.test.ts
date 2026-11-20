import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { withSenderName } from '../../src/share/senderName'
import type { Convo, Hit } from '../../src/stats/greatestHits'
import { convoHtml, reactionSummary } from '../../web/src/convo'

const wrap = makeFakeWrap('group')
const hitWith = (conversation: Convo): Hit => ({ ...wrap.greatestHits[0]!, conversation })
/** The text of each list item in the thread, in order. */
const thread = (html: string) =>
  [...html.matchAll(/<li class="([^"]+)"[^>]*>(.*?)<\/li>/g)].map(([, cls = '', inner = '']) => ({ cls, inner }))

describe('the fake demo', () => {
  it('gives each greatest hit a short made-up conversation around it', () => {
    const [poker, omw] = wrap.greatestHits
    expect(poker!.conversation!.messages[poker!.conversation!.hit]!.text).toBe('poker tonight?')
    expect(poker!.conversation!.messages[0]!.text).toBe('you good? you left in a hurry last night')
    expect(poker!.conversation!.messages.some((m) => m.media === 'photo')).toBe(true) // Jordan's photo, read from its type
    expect(omw!.conversation!.messages[omw!.conversation!.hit]).toMatchObject({ senderId: 'me', text: 'omw', hearts: 3 })
  })

  it('never puts a conversation in a solo wrap', () => {
    expect(makeFakeWrap('solo').greatestHits.every((h) => h.conversation === undefined)).toBe(true)
  })
})

describe('convoHtml', () => {
  it('draws the thread as a dated chat screenshot with the hit marked', () => {
    const html = convoHtml(wrap, wrap.greatestHits[0]!)
    expect(html).toContain('<b>Poker Night</b>')
    expect(html).toContain('<time datetime="2026-01-12T18:30:00.000Z">Mon, Jan 12, 6:30 PM</time>')
    expect(html).toContain('<button type="button" class="convo-back" data-convo-close>← back to the wrap</button>')
    expect(html.match(/data-hit/g)).toHaveLength(1)
    expect(html).toContain('<li class="msg theirs hit" data-hit><span class="who">Alex</span>')
    expect(html).toContain('<p class="bubble media">📷 Photo</p>')
  })

  it('names the first message of each run by first name, and puts your own on the right', () => {
    const t = (sentAt: string) => `2026-01-12T${sentAt}:00.000Z`
    const items = thread(
      convoHtml(wrap, hitWith({
        messages: [
          { senderId: 'p1', text: 'one', sentAt: t('20:00') },
          { senderId: 'p1', text: 'two', sentAt: t('20:01') },
          { senderId: 'me', text: 'three', sentAt: t('20:02') },
          { senderId: 'me', text: 'four', sentAt: t('21:30') }, // over an hour later: the time, then a new run
        ],
        hit: 2,
      })),
    )
    expect(items.map((i) => i.cls)).toEqual(['msg theirs', 'msg theirs', 'msg mine hit', 'when', 'msg mine'])
    expect(items.map((i) => i.inner.match(/class="who">([^<]+)/)?.[1] ?? null)).toEqual(['Alex', null, 'You', null, 'You'])
    expect(items[3]!.inner).toBe('9:30 PM')
  })

  it("uses the sender's name for \"me\" in a shared group wrap", () => {
    const shared = withSenderName(wrap, 'Taylor Morgan')
    expect(convoHtml(shared, shared.greatestHits[1]!)).toContain('<span class="who">Taylor</span>')
  })

  it('escapes message text, names and the title', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const html = convoHtml(
      { ...wrap, title: evil, people: { ...wrap.people, p1: evil } },
      hitWith({ messages: [{ senderId: 'p1', text: evil, sentAt: '2026-01-12T20:00:00.000Z' }], hit: 0 }),
    )
    expect(html).not.toContain('<img')
  })

  it('shows media as a placeholder and unknown people as "Someone"', () => {
    const at = '2026-01-12T20:00:00.000Z'
    const html = convoHtml(wrap, hitWith({
      messages: [
        { senderId: 'p1', text: '', sentAt: at, media: 'photo' },
        { senderId: 'p1', text: '', sentAt: at, media: 'video' },
        { senderId: 'p9', text: 'hi', sentAt: at },
      ],
      hit: 2,
    }))
    expect(html).toContain('📷 Photo')
    expect(html).toContain('🎥 Video')
    expect(html).toContain('<span class="who">Someone</span>')
  })

  it('is empty for a hit without a conversation', () => {
    const { conversation: _, ...hit } = wrap.greatestHits[0]!
    expect(convoHtml(wrap, hit)).toBe('')
  })
})

describe('reactionSummary', () => {
  const m = { senderId: 'p1', text: 'x', sentAt: '2026-01-01T00:00:00Z' }
  it('lists laughs, hearts, then the rest', () => {
    expect(reactionSummary({ ...m, reactions: 4, laughs: 4 })).toBe('😂 ×4')
    expect(reactionSummary({ ...m, reactions: 3, hearts: 3 })).toBe('❤️ ×3')
    expect(reactionSummary({ ...m, reactions: 5, laughs: 2, hearts: 1 })).toBe('😂 ×2 ❤️ ×1 +2')
    expect(reactionSummary({ ...m, reactions: 2 })).toBe('+2')
    expect(reactionSummary(m)).toBe('')
  })
})
