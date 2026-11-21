import { describe, expect, it } from 'vitest'
import { MINUTE } from '../../src/stats/conversation'
import {
  MAX_CONVO_MESSAGES, MAX_HIT_LENGTH, SHOWN_QUOTE_LENGTH, around, greatestHits, shortQuote, type Convo,
} from '../../src/stats/greatestHits'
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

it('breaks ties in one chat by age, older first (laughs count as reactions, nothing more)', () => {
  const old = msg({ senderId: 'alex', sentAt: '2026-01-01T10:00:00Z', text: 'old' })
  const newer = msg({ senderId: 'alex', sentAt: '2026-01-02T10:00:00Z', text: 'newer' })
  const funny = msg({ senderId: 'alex', sentAt: '2026-01-03T10:00:00Z', text: 'funny' })
  const hits = greatestHits([
    newer, old, funny,
    react('sam', old, 'love', at), react('riley', old, 'love', at),
    react('sam', newer, 'love', at), react('riley', newer, 'love', at),
    react('sam', funny, 'laugh', at), react('riley', funny, 'laugh', at),
  ])
  expect(hits.map((h) => h.text)).toEqual(['old', 'newer', 'funny'])
})

describe('ranking by the share of the chat that reacted', () => {
  // Chat 1 is you and 2 friends; chat 2 is you and 9 others.
  const small = ['amy', 'ben']
  const big = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']
  const chatSizes = new Map([[1, 3], [2, 10]])
  const mine = (text: string, chatId: number, day: number) =>
    msg({ senderId: 'me', chatId, sentAt: `2026-02-0${day}T10:00:00Z`, text })
  const reactedBy = (m: Message, who: string[]) => who.map((p) => react(p, m, 'love', at))

  it('puts 2 of 2 friends above 5 of 9 people', () => {
    const smallHit = mine('small chat, everyone reacted', 1, 2)
    const bigHit = mine('big chat, five reacted', 2, 1)
    const hits = greatestHits([smallHit, bigHit, ...reactedBy(smallHit, small), ...reactedBy(bigHit, big.slice(0, 5))], { chatSizes })
    expect(hits.map((h) => [h.text, h.reactions])).toEqual([
      ['small chat, everyone reacted', 2],
      ['big chat, five reacted', 5],
    ])
  })

  it('breaks an equal share on raw reactions, then the earlier message', () => {
    // 1 of 2 others = 0.5 can't be a hit (under 2 reactions), so: 2 of 4 (chat 3), 3 of 6 (chat 4), and another 2 of 4.
    const sizes = new Map([[3, 5], [4, 7]])
    const two = mine('two of four', 3, 2)
    const twoLater = mine('two of four, later', 3, 3)
    const three = mine('three of six', 4, 4)
    const hits = greatestHits(
      [two, twoLater, three, ...reactedBy(two, ['a', 'b']), ...reactedBy(twoLater, ['a', 'b']), ...reactedBy(three, ['c', 'd', 'e'])],
      { chatSizes: sizes },
    )
    expect(hits.map((h) => h.text)).toEqual(['three of six', 'two of four', 'two of four, later'])
  })

  it('counts the people seen in a chat when its size is not given', () => {
    // Chat 5: me, amy, ben, cat (4 people, 3 others). Chat 6: me, dan, eve (2 others).
    const quiet = msg({ senderId: 'cat', chatId: 5, sentAt: '2026-02-01T09:00:00Z', text: 'hey' })
    const inFour = mine('2 of 3', 5, 1)
    const inThree = mine('2 of 2', 6, 2)
    const hits = greatestHits([quiet, inFour, inThree, ...reactedBy(inFour, ['amy', 'ben']), ...reactedBy(inThree, ['dan', 'eve'])])
    expect(hits.map((h) => h.text)).toEqual(['2 of 2', '2 of 3'])
  })

  it('keeps only one sender when asked, ranking everyone else out', () => {
    const theirs = msg({ senderId: 'amy', chatId: 1, sentAt: '2026-02-01T10:00:00Z', text: 'amy wins' })
    const ours = [1, 2, 3].map((d) => mine(`mine ${d}`, 1, d + 1))
    const hits = greatestHits(
      [theirs, ...ours, ...reactedBy(theirs, ['me', 'ben']), ...ours.flatMap((m) => reactedBy(m, small))],
      { from: 'me', chatSizes, limit: 3 },
    )
    expect(hits.map((h) => h.text)).toEqual(['mine 1', 'mine 2', 'mine 3'])
  })
})

it('returns nothing for no messages', () => {
  expect(greatestHits([])).toEqual([])
})

it('skips messages longer than MAX_HIT_LENGTH, counting whole code points, and keeps one at the limit whole', () => {
  // 280 code points (281 UTF-16 units): a hit, whole. One more emoji: a paragraph, never a hit, however loved.
  const atLimit = msg({ senderId: 'alex', sentAt: '2026-01-01T10:00:00Z', text: 'a'.repeat(279) + '😂' })
  const tooLong = msg({ senderId: 'alex', sentAt: '2026-01-02T10:00:00Z', text: 'b'.repeat(279) + '😂😂' })
  const hits = greatestHits([
    atLimit, tooLong,
    react('sam', atLimit, 'love', at), react('riley', atLimit, 'love', at),
    ...['sam', 'riley', 'jordan', 'casey'].map((who) => react(who, tooLong, 'laugh', at)),
  ])
  expect(MAX_HIT_LENGTH).toBe(280)
  expect(hits.map((h) => h.text)).toEqual(['a'.repeat(279) + '😂'])
})

describe('shortQuote: what the slide shows of a quote', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

  it('leaves a quote of up to SHOWN_QUOTE_LENGTH characters alone', () => {
    expect(SHOWN_QUOTE_LENGTH).toBe(120)
    expect(shortQuote('omw')).toBe('omw')
    expect(shortQuote('x'.repeat(120))).toBe('x'.repeat(120))
  })

  it('cuts a longer one after its last whole word, with "…", in at most 120 characters', () => {
    const long = words(60) // "word0 word1 … word59", 349 characters
    const short = shortQuote(long)
    expect(Array.from(short).length).toBeLessThanOrEqual(120)
    expect(short.endsWith('…')).toBe(true)
    const kept = short.slice(0, -1)
    expect(long.startsWith(kept + ' ')).toBe(true) // ends on a whole word
    expect(Array.from(kept).length).toBeGreaterThan(100)
  })

  it('keeps the last word when the cut falls right after it, and drops a trailing comma or full stop', () => {
    expect(shortQuote('abcd efgh ijkl', 10)).toBe('abcd efgh…')
    expect(shortQuote('abcd, efgh ijkl', 6)).toBe('abcd…')
    expect(shortQuote('abcd efgh. ijkl mnop', 13)).toBe('abcd efgh…')
  })

  it('cuts mid-word only when one word is most of the quote, and never splits an emoji', () => {
    expect(shortQuote('a' + 'h'.repeat(200))).toBe('a' + 'h'.repeat(118) + '…')
    const short = shortQuote('😂'.repeat(200))
    expect(short).toBe('😂'.repeat(119) + '…')
    expect(() => encodeURIComponent(short)).not.toThrow() // throws on a lone surrogate
  })
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

  it('shows onConversation the messages behind each conversation, in its order, and the hits come out the same', () => {
    const messages = chat(100)
    messages[45] = { ...messages[45]!, text: null, hasAttachment: true, attachmentKind: 'photo' }
    const all = [...messages, ...reactedTo(messages[50]!)]
    const seen: { hit: number; shown: Message[]; conversation: Convo }[] = []
    const hits = greatestHits(all, { withConversations: true, onConversation: (hit, shown, conversation) => seen.push({ hit, shown, conversation }) })
    expect(hits).toEqual(greatestHits(all, { withConversations: true }))
    expect(seen.map((s) => s.hit)).toEqual([0])
    const convo = hits[0]!.conversation!
    expect(seen[0]!.conversation).toBe(convo)
    expect(seen[0]!.shown.map((m) => m.sentAt.toISOString())).toEqual(convo.messages.map((m) => m.sentAt))
    const photoAt = seen[0]!.shown.indexOf(messages[45]!)
    expect(convo.messages[photoAt]).toMatchObject({ media: 'photo', text: '' })
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
