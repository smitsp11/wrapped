import { describe, expect, it } from 'vitest'
import { MINUTE } from '../../src/stats/conversation'
import { MAX_CONVO_MESSAGES, around, greatestHits } from '../../src/stats/greatestHits'
import type { Message } from '../../src/types'
import { msg, react } from '../../fixtures/messages'

it('ranks text messages by reactions, needing at least 2', () => {
  const top = msg({ senderId: 'alex', sentAt: '2026-01-01T10:00:00Z', text: 'poker tonight?' })
  const second = msg({ senderId: 'me', sentAt: '2026-01-02T10:00:00Z', text: 'omw' })
  const single = msg({ senderId: 'sam', sentAt: '2026-01-03T10:00:00Z', text: 'bet' })
  const photo = msg({ senderId: 'sam', sentAt: '2026-01-04T10:00:00Z', text: null, hasAttachment: true })
  const at = '2026-01-05T10:00:00Z'
  const hits = greatestHits([
    top, second, single, photo,
    react('sam', top, 'laugh', at), react('me', top, 'laugh', at), react('riley', top, 'love', at),
    react('alex', second, 'love', at), react('sam', second, 'love', at),
    react('alex', single, 'love', at),
    ...['a', 'b', 'c', 'd', 'e'].map((who) => react(who, photo, 'love', at)),
  ])
  expect(hits).toEqual([
    { senderId: 'alex', text: 'poker tonight?', sentAt: '2026-01-01T10:00:00.000Z', reactions: 3, laughs: 2 },
    { senderId: 'me', text: 'omw', sentAt: '2026-01-02T10:00:00.000Z', reactions: 2, laughs: 0 },
  ])
})

const at = '2026-01-05T10:00:00Z'

it('ignores self-reactions', () => {
  const m = msg({ senderId: 'alex', sentAt: '2026-01-01T10:00:00Z', text: 'hi' })
  expect(greatestHits([m, react('alex', m, 'love', at), react('alex', m, 'laugh', at)])).toEqual([])
})

it('counts each person once per message', () => {
  const m = msg({ senderId: 'alex', sentAt: '2026-01-01T10:00:00Z', text: 'hi' })
  expect(greatestHits([m, react('sam', m, 'love', at), react('sam', m, 'laugh', at)])).toEqual([])
})

it('caps the list at the limit', () => {
  const ms = [1, 2, 3].map((d) => msg({ senderId: 'alex', sentAt: `2026-01-0${d}T10:00:00Z`, text: `m${d}` }))
  const reactions = ms.flatMap((m) => [react('sam', m, 'love', at), react('riley', m, 'love', at)])
  expect(greatestHits([...ms, ...reactions], { limit: 2 })).toHaveLength(2)
})

it('breaks ties by laughs, then older first', () => {
  const old = msg({ senderId: 'alex', sentAt: '2026-01-01T10:00:00Z', text: 'old' })
  const newer = msg({ senderId: 'alex', sentAt: '2026-01-02T10:00:00Z', text: 'newer' })
  const funny = msg({ senderId: 'alex', sentAt: '2026-01-03T10:00:00Z', text: 'funny' })
  const hits = greatestHits([
    newer, old, funny,
    react('sam', old, 'love', at), react('riley', old, 'love', at),
    react('sam', newer, 'love', at), react('riley', newer, 'love', at),
    react('sam', funny, 'laugh', at), react('riley', funny, 'love', at),
  ])
  expect(hits.map((h) => h.text)).toEqual(['funny', 'old', 'newer'])
})

it('returns nothing for no messages', () => {
  expect(greatestHits([])).toEqual([])
})

it('truncates by whole code points and marks the cut', () => {
  const m = msg({ senderId: 'alex', sentAt: '2026-01-01T10:00:00Z', text: 'a'.repeat(279) + '😂😂' })
  const text = greatestHits([m, react('sam', m, 'love', at), react('riley', m, 'love', at)])[0]?.text ?? ''
  expect(() => encodeURIComponent(text)).not.toThrow() // throws on a lone surrogate
  expect(text).toBe('a'.repeat(279) + '😂…')
})

describe('the conversation around each hit', () => {
  /** `count` messages a minute apart from 10:00, alternating alex and sam, with "m0", "m1"… as text. */
  function chat(count: number, start = '2026-01-01T10:00:00Z'): Message[] {
    return Array.from({ length: count }, (_, i) =>
      msg({ senderId: i % 2 === 0 ? 'alex' : 'sam', sentAt: new Date(Date.parse(start) + i * MINUTE).toISOString(), text: `m${i}` }),
    )
  }
  const reactedTo = (m: Message) => [react('riley', m, 'laugh', at), react('jordan', m, 'love', at), react('me', m, 'laugh', at)]
  const convoOf = (messages: Message[]) => greatestHits(messages, { withConversations: true })[0]!.conversation!

  it('is left out unless asked for, so solo wraps never carry one', () => {
    const messages = chat(5)
    expect(greatestHits([...messages, ...reactedTo(messages[2]!)])[0]).not.toHaveProperty('conversation')
  })

  it('keeps a short conversation whole, in order, and points at the hit', () => {
    const messages = chat(5)
    const convo = convoOf([...messages, ...reactedTo(messages[2]!)])
    expect(convo.messages.map((m) => m.text)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
    expect(convo.hit).toBe(2)
    expect(convo.messages[2]).toEqual({ senderId: 'alex', text: 'm2', sentAt: '2026-01-01T10:02:00.000Z', reactions: 3, laughs: 2, hearts: 1 })
    expect(convo.messages[0]).toEqual({ senderId: 'alex', text: 'm0', sentAt: '2026-01-01T10:00:00.000Z' }) // no zero counts
  })

  it(`caps at ${MAX_CONVO_MESSAGES} messages around the hit, more before than after`, () => {
    const messages = chat(100)
    const convo = convoOf([...messages, ...reactedTo(messages[50]!)])
    expect(convo.messages).toHaveLength(MAX_CONVO_MESSAGES)
    expect(convo.messages[convo.hit]!.text).toBe('m50')
    const after = convo.messages.length - convo.hit - 1
    expect(convo.hit).toBeGreaterThan(after)
    expect(after).toBeGreaterThanOrEqual(10)
  })

  it('gives the other side the room when the hit is near the start or the end', () => {
    const messages = chat(100)
    const early = convoOf([...messages, ...reactedTo(messages[3]!)])
    expect(early.messages.map((m) => m.text).slice(0, 4)).toEqual(['m0', 'm1', 'm2', 'm3'])
    expect([early.messages.length, early.hit]).toEqual([MAX_CONVO_MESSAGES, 3])
    const late = convoOf([...messages, ...reactedTo(messages[98]!)])
    expect(late.messages.at(-1)!.text).toBe('m99')
    expect([late.messages.length, late.hit]).toEqual([MAX_CONVO_MESSAGES, MAX_CONVO_MESSAGES - 2])
  })

  it('stops at the conversation boundaries: a 6-hour gap and another chat', () => {
    const before = chat(4, '2026-01-01T02:00:00Z') // ends 02:03, 6h57m before 09:00
    const convo = chat(4, '2026-01-01T09:00:00Z')
    const otherChat = chat(4, '2026-01-01T09:00:30Z').map((m) => ({ ...m, chatId: 2, guid: `${m.guid}-x` }))
    const later = chat(2, '2026-01-01T15:03:00Z') // exactly 6h after 09:03 starts a new conversation
    const result = convoOf([...before, ...convo, ...otherChat, ...later, ...reactedTo(convo[1]!)])
    expect(result.messages.map((m) => m.sentAt.slice(11, 16))).toEqual(['09:00', '09:01', '09:02', '09:03'])
    expect(result.hit).toBe(1)
  })

  it('turns attachments into a placeholder, never their file', () => {
    const messages = chat(3)
    messages[0] = { ...messages[0]!, text: null, hasAttachment: true }
    const convo = convoOf([...messages, ...reactedTo(messages[1]!)])
    expect(convo.messages[0]).toEqual({ senderId: 'alex', text: '', sentAt: '2026-01-01T10:00:00.000Z', media: 'attachment' })
  })

  it('leaves out messages that look like a phone number or email, but keeps the hit', () => {
    const messages = chat(5)
    messages[0] = { ...messages[0]!, text: 'call me 416 555 0199' }
    messages[3] = { ...messages[3]!, text: 'sam@example.com' }
    const convo = convoOf([...messages, ...reactedTo(messages[2]!)])
    expect(convo.messages.map((m) => m.text)).toEqual(['m1', 'm2', 'm4'])
    expect(convo.hit).toBe(1)
  })

  it('shortens long messages like quotes', () => {
    const messages = chat(3)
    messages[0] = { ...messages[0]!, text: 'b'.repeat(400) }
    const convo = convoOf([...messages, ...reactedTo(messages[1]!)])
    expect(convo.messages[0]!.text).toBe('b'.repeat(280) + '…')
  })
})

describe('around', () => {
  it('returns everything when it fits', () => {
    expect(around([1, 2, 3], 1)).toEqual({ messages: [1, 2, 3], hit: 1 })
  })
})
