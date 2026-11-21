import { describe, expect, it } from 'vitest'
import { msg, react } from '../../fixtures/messages'
import { NEW_CONVERSATION_GAP } from '../../src/stats/conversation'
import { MIN_TEXTS, textingStats, wordCount } from '../../src/stats/texting'
import type { Message } from '../../src/types'

const T0 = Date.parse('2026-01-01T08:00:00Z')
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()
const MIN = 60_000

/** One message a minute from `start`, in order: [sender, text] pairs. */
function script(lines: [string, string | null][], start = 0, chatId = 1): Message[] {
  return lines.map(([senderId, text], i) => msg({ senderId, text, chatId, sentAt: at(start + i * MIN) }))
}

/** `n` turns of `perTurn` texts from `who`, each turn answered by one "ok" from `other`. */
function turns(who: string, n: number, perTurn: number, text: string, other = 'zz'): [string, string][] {
  const lines: [string, string][] = []
  for (let t = 0; t < n; t++) {
    for (let i = 0; i < perTurn; i++) lines.push([who, text])
    lines.push([other, 'ok'])
  }
  return lines
}

describe('wordCount', () => {
  it('counts tokens with a letter or digit, so punctuation and emoji alone are not words', () => {
    expect(wordCount('k.')).toBe(1)
    expect(wordCount('omw')).toBe(1)
    expect(wordCount('😂')).toBe(0)
    expect(wordCount('lol 😂 ok')).toBe(2)
    expect(wordCount('  hey   there\nfriend ')).toBe(3)
    expect(wordCount("doors at 8 — don't be late")).toBe(6)
    expect(wordCount('')).toBe(0)
  })
})

describe('textingStats', () => {
  it('measures median words and texts per turn for everyone with enough texts', () => {
    const messages = script([...turns('alex', 20, 3, 'yo'), ...turns('sam', 20, 1, 'one two three four five')])
    const stats = textingStats(messages)
    expect(stats.medianWordsByPerson.alex).toBe(1)
    expect(stats.textsPerTurnByPerson.alex).toBe(3)
    expect(stats.medianWordsByPerson.sam).toBe(5)
    expect(stats.textsPerTurnByPerson.sam).toBe(1)
  })

  it(`skips anyone with fewer than ${MIN_TEXTS} texts, and measures someone with exactly ${MIN_TEXTS}`, () => {
    const short = textingStats(script(turns('alex', MIN_TEXTS - 1, 1, 'hi')))
    expect(short.medianWordsByPerson).not.toHaveProperty('alex')
    expect(short.textsPerTurnByPerson).not.toHaveProperty('alex')
    const enough = textingStats(script(turns('alex', MIN_TEXTS, 1, 'hi')))
    expect(enough.medianWordsByPerson).toHaveProperty('alex', 1)
    // "zz" sent 20 "ok"s too, so is measured as well
    expect(Object.keys(enough.medianWordsByPerson).sort()).toEqual(['alex', 'zz'])
  })

  it('counts photos toward a turn but not as texts, and ignores a photo placeholder', () => {
    const lines = turns('alex', MIN_TEXTS, 1, 'look at this')
    const messages = script(lines).flatMap((m, i) =>
      // after each of alex's texts, two photos in the same turn (one with the attachment placeholder as its text)
      m.senderId === 'alex'
        ? [m, msg({ senderId: 'alex', text: null, hasAttachment: true, sentAt: at(i * MIN + 10_000) }),
           msg({ senderId: 'alex', text: '￼', hasAttachment: true, sentAt: at(i * MIN + 20_000) })]
        : [m],
    )
    const stats = textingStats(messages)
    expect(stats.textsPerTurnByPerson.alex).toBe(3) // 60 messages in 20 turns
    expect(stats.medianWordsByPerson.alex).toBe(3) // only the 20 texts are measured
  })

  it('does not let a photo-only sender in: photos are not texts', () => {
    const photos = Array.from({ length: 30 }, (_, i) => msg({ senderId: 'alex', text: null, hasAttachment: true, sentAt: at(i * MIN) }))
    expect(textingStats(photos)).toEqual({ medianWordsByPerson: {}, textsPerTurnByPerson: {} })
  })

  it('does not let a reaction break a run of texts', () => {
    const lines = turns('alex', MIN_TEXTS, 2, 'yo')
    const messages = script(lines)
    // sam reacts between alex's two texts in every turn
    const withReactions = messages.flatMap((m, i) =>
      m.senderId === 'alex' && messages[i + 1]?.senderId === 'alex' ? [m, react('sam', m, 'laugh', at(i * MIN + 30_000))] : [m],
    )
    expect(textingStats(withReactions).textsPerTurnByPerson.alex).toBe(2)
  })

  it('ends a turn at a new conversation (after NEW_CONVERSATION_GAP of quiet), even if the same person speaks next', () => {
    // alex texts 20 times, each in its own conversation: 20 turns of 1, not one turn of 20
    const messages = Array.from({ length: MIN_TEXTS }, (_, i) => msg({ senderId: 'alex', text: 'anyone?', sentAt: at(i * NEW_CONVERSATION_GAP) }))
    expect(textingStats(messages).textsPerTurnByPerson.alex).toBe(1)
    // the same 20 texts a minute apart are one turn of 20
    const burst = Array.from({ length: MIN_TEXTS }, (_, i) => msg({ senderId: 'alex', text: 'anyone?', sentAt: at(i * MIN) }))
    expect(textingStats(burst).textsPerTurnByPerson.alex).toBe(20)
  })

  it('keeps chats apart: a text in another chat does not end a turn here', () => {
    const here = script(turns('alex', MIN_TEXTS, 2, 'yo'), 0, 1)
    const elsewhere = here.map((m, i) => msg({ senderId: 'riley', text: 'hey', chatId: 2, sentAt: at(i * MIN + 30_000) }))
    expect(textingStats([...here, ...elsewhere]).textsPerTurnByPerson.alex).toBe(2)
  })

  it('takes the middle of an even count of texts, and rounds texts per turn to one decimal', () => {
    // 10 one-word and 10 four-word texts: the median is 2.5
    const lines: [string, string][] = [...turns('alex', 10, 1, 'yo'), ...turns('alex', 10, 1, 'one two three four')]
    expect(textingStats(script(lines)).medianWordsByPerson.alex).toBe(2.5)
    // 21 texts in 9 turns (5, then eight of 2) is 2.333…, kept as 2.3
    const uneven: [string, string][] = [...turns('alex', 1, 5, 'yo'), ...turns('alex', 8, 2, 'yo')]
    expect(textingStats(script(uneven)).textsPerTurnByPerson.alex).toBe(2.3)
  })
})
