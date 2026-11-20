import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import type { Wrap } from '../../src/types'
import { PERSONALITIES, personalityFor } from '../../src/wrap/personality'

/** A solo wrap where no rule holds: you sent 1,000 messages and nothing about them stands out. */
function plainWrap(): Wrap {
  return {
    version: 1,
    mode: 'solo',
    title: 'Your 2026',
    period: { from: '2026-01-01', to: '2027-01-01' },
    people: { me: 'You', p1: 'Alex Chen' },
    volume: { total: 2000, byPerson: { me: 1000, p1: 1000 }, attachmentsByPerson: {} },
    timing: {
      byMonth: [], byWeekday: [], byHour: [], longestStreakDays: 30, longestSilenceDays: 0,
      lateNightShareByPerson: { me: 0.05, p1: 0.5 },
    },
    replies: { medianReplyMinutesByPerson: { me: 6, p1: 0.2 }, repliesByPerson: { me: 300, p1: 300 } },
    starters: { startsByPerson: { me: 40, p1: 60 }, doubleTextsByPerson: { me: 0, p1: 400 } },
    reactions: { givenByPerson: { me: 0, p1: 900 }, receivedByPerson: {}, laughsReceivedByPerson: {}, byType: {} },
    words: { topWords: [], topEmoji: [], signatureWordByPerson: {}, longestMessage: { senderId: 'me', length: 300 } },
    greatestHits: [],
    awards: [],
    topChats: [{ name: 'Chat A', messages: 1500 }, { name: 'Chat B', messages: 500 }],
  }
}

const idFor = (change: (w: Wrap) => void) => {
  const wrap = plainWrap()
  change(wrap)
  return personalityFor(wrap).id
}

describe('personalityFor', () => {
  it('falls back to The Yapper when no rule holds, even if other people would match', () => {
    expect(personalityFor(plainWrap())).toEqual(PERSONALITIES.yapper)
  })

  it('is The Night Shift with 20% or more of your messages sent 12–5 AM', () => {
    expect(idFor((w) => (w.timing.lateNightShareByPerson.me = 0.2))).toBe('night-shift')
    expect(idFor((w) => (w.timing.lateNightShareByPerson.me = 0.19))).toBe('yapper')
  })

  it('is Speed Demon when you typically join a conversation in under 5 minutes, over 10+ conversations', () => {
    expect(idFor((w) => (w.replies.medianReplyMinutesByPerson.me = 4.99))).toBe('speed-demon')
    expect(idFor((w) => (w.replies.medianReplyMinutesByPerson.me = 5))).toBe('yapper')
    expect(
      idFor((w) => {
        w.replies.medianReplyMinutesByPerson.me = 2
        w.replies.repliesByPerson.me = 10
      }),
    ).toBe('speed-demon')
    expect(
      idFor((w) => {
        w.replies.medianReplyMinutesByPerson.me = 2
        w.replies.repliesByPerson.me = 9
      }),
    ).toBe('yapper')
  })

  it('is The Starter when you start at least half of all conversations (10+)', () => {
    expect(idFor((w) => (w.starters.startsByPerson.me = 60))).toBe('starter')
    expect(idFor((w) => (w.starters.startsByPerson.me = 59))).toBe('yapper')
    expect(idFor((w) => (w.starters.startsByPerson = { me: 9 }))).toBe('yapper')
  })

  it('is Double Texter when 5% or more of your messages are double texts (10+)', () => {
    expect(idFor((w) => (w.starters.doubleTextsByPerson.me = 50))).toBe('double-texter')
    expect(idFor((w) => (w.starters.doubleTextsByPerson.me = 49))).toBe('yapper')
    expect(
      idFor((w) => {
        w.volume.byPerson.me = 100
        w.starters.doubleTextsByPerson.me = 9
      }),
    ).toBe('yapper')
  })

  it('is Hype Machine with a reaction for every four messages you send (20+)', () => {
    expect(idFor((w) => (w.reactions.givenByPerson.me = 250))).toBe('hype-machine')
    expect(idFor((w) => (w.reactions.givenByPerson.me = 249))).toBe('yapper')
    expect(
      idFor((w) => {
        w.volume.byPerson.me = 40
        w.reactions.givenByPerson.me = 19
      }),
    ).toBe('yapper')
  })

  it('is The Essayist when your longest message is 1,000+ characters', () => {
    expect(idFor((w) => (w.words.longestMessage = { senderId: 'me', length: 1000 }))).toBe('essayist')
    expect(idFor((w) => (w.words.longestMessage = { senderId: 'me', length: 999 }))).toBe('yapper')
    expect(idFor((w) => (w.words.longestMessage = { senderId: 'p1', length: 5000 }))).toBe('yapper')
    expect(idFor((w) => (w.words.longestMessage = null))).toBe('yapper')
  })

  it('is Group Chat Glue with five top chats and none over 35% of messages', () => {
    const spread = [600, 400, 350, 300, 250].map((messages, i) => ({ name: `Chat ${i}`, messages }))
    expect(idFor((w) => (w.topChats = spread))).toBe('group-chat-glue')
    expect(idFor((w) => (w.topChats = spread.slice(0, 4)))).toBe('yapper')
    expect(idFor((w) => (w.topChats = [{ name: 'Big', messages: 700 }, ...spread.slice(1)]))).toBe('yapper')
  })

  it('picks the rule highest in the priority order when several hold', () => {
    const all = (w: Wrap) => {
      w.timing.lateNightShareByPerson.me = 0.5
      w.replies.medianReplyMinutesByPerson.me = 0.1
      w.starters.startsByPerson.me = 500
      w.starters.doubleTextsByPerson.me = 500
      w.reactions.givenByPerson.me = 900
    }
    expect(idFor(all)).toBe('night-shift')
    expect(idFor((w) => { all(w); w.timing.lateNightShareByPerson.me = 0 })).toBe('speed-demon')
    expect(idFor((w) => { all(w); w.timing.lateNightShareByPerson.me = 0; w.replies.medianReplyMinutesByPerson.me = 9 })).toBe('starter')
  })

  it('copes with a wrap that has no stats for you', () => {
    const wrap = plainWrap()
    wrap.volume.byPerson = { p1: 2000 }
    wrap.timing.lateNightShareByPerson = {}
    wrap.replies = { medianReplyMinutesByPerson: {}, repliesByPerson: {} }
    wrap.starters = { startsByPerson: {}, doubleTextsByPerson: {} }
    wrap.reactions.givenByPerson = {}
    expect(personalityFor(wrap).id).toBe('yapper')
  })

  it('gives the fake solo wrap a personality', () => {
    expect(personalityFor(makeFakeWrap('solo')).id).toBe('double-texter')
  })

  it('keeps every line to one short sentence', () => {
    for (const p of Object.values(PERSONALITIES)) {
      expect(p.line.length).toBeLessThanOrEqual(48)
      expect(p.line).toMatch(/^[A-Z][^.?!]*[.?!]$/)
    }
  })
})
