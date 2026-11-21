import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dmPartners, personalStats } from '../../src/stats/personal'
import type { Chat } from '../../src/types'
import { msg, react } from '../../fixtures/messages'

// Pinned to a zone with DST, so month and day boundaries are local, not UTC (vitest.config pins UTC otherwise).
let previousTz: string | undefined
beforeEach(() => {
  previousTz = process.env.TZ
  process.env.TZ = 'America/Toronto'
})
afterEach(() => {
  if (previousTz === undefined) delete process.env.TZ
  else process.env.TZ = previousTz
})

const chat = (id: number, memberIds: string[], isGroup = false): Chat => ({ id, name: '', isGroup, memberIds, messageCount: 0 })
/** 1:1 chats: 1 with priya, 2 with sam, 3 with alex, 4 another row with priya (SMS); 9 is a group with all of them */
const partners = dmPartners([
  chat(1, ['priya']), chat(2, ['sam']), chat(3, ['alex']), chat(4, ['priya']), chat(9, ['priya', 'sam', 'alex'], true),
])
/** A 1:1 message: `from` is "me" or the partner; noon Toronto time on the day */
const dm = (chatId: number, from: string, day: string, time = '12:00:00-05:00') => msg({ senderId: from, chatId, sentAt: `${day}T${time}` })
const inGroup = (from: string, day: string) => msg({ senderId: from, chatId: 9, sentAt: `${day}T12:00:00-05:00` })
/** One 1:1 message from me on each day from `from`, `count` days in a row */
const daily = (chatId: number, from: string, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(`${from}T12:00:00-05:00`)
    d.setDate(d.getDate() + i)
    return msg({ senderId: 'me', chatId, sentAt: d.toISOString() })
  })

describe('dmPartners', () => {
  it('maps 1:1 chats to the other person, and leaves groups and empty chats out', () => {
    const map = dmPartners([chat(1, ['priya']), chat(2, ['sam', 'alex']), chat(3, []), chat(9, ['priya'], true)])
    expect([...map]).toEqual([[1, 'priya']])
  })

  it('leaves out a chat with yourself, by any of your own handles, whatever the case', () => {
    const chats = [chat(1, ['priya']), chat(5, ['+14165550100']), chat(6, ['Me@Example.com'])]
    expect([...dmPartners(chats, ['+14165550100', 'me@example.com'])]).toEqual([[1, 'priya']])
    // Your notes to yourself would otherwise be the busiest 1:1 chat and the longest streak.
    const notes = daily(5, '2026-02-01', 20)
    const stats = personalStats([...notes, dm(1, 'priya', '2026-02-03')], dmPartners(chats, ['+14165550100']))
    expect(stats.topPersonByMonth[1]).toBe('priya')
    expect(stats.personStreak).toEqual({ person: 'priya', days: 1, from: '2026-02-03' })
  })
})

describe('your person, month by month', () => {
  it('counts 1:1 messages both ways, and nothing from group chats', () => {
    const { topPersonByMonth } = personalStats(
      [
        dm(1, 'priya', '2026-01-10'), dm(1, 'me', '2026-01-10'), dm(1, 'me', '2026-01-11'),
        dm(2, 'sam', '2026-01-12'), dm(2, 'sam', '2026-01-13'),
        // Alex is the busiest in the group, which doesn't count toward anyone
        ...Array.from({ length: 10 }, () => inGroup('alex', '2026-01-14')),
        ...Array.from({ length: 10 }, () => inGroup('me', '2026-01-14')),
      ],
      partners,
    )
    expect(topPersonByMonth[0]).toBe('priya')
  })

  it('has 12 months, January first, with null for a month without 1:1 messages', () => {
    const { topPersonByMonth } = personalStats([dm(1, 'me', '2026-01-10'), dm(2, 'sam', '2026-03-10'), inGroup('alex', '2026-02-10')], partners)
    expect(topPersonByMonth).toEqual(['priya', null, 'sam', null, null, null, null, null, null, null, null, null])
  })

  it('puts a message in its local month: 11:30 PM on Jan 31 is January, 12:30 AM on Feb 1 is February', () => {
    const { topPersonByMonth } = personalStats(
      [dm(1, 'me', '2026-01-31', '23:30:00-05:00'), dm(2, 'me', '2026-02-01', '00:30:00-05:00')], // both Feb 1 in UTC
      partners,
    )
    expect(topPersonByMonth.slice(0, 2)).toEqual(['priya', 'sam'])
  })

  it('adds up all of one handle\'s 1:1 chat rows', () => {
    const { topPersonByMonth } = personalStats(
      [dm(1, 'priya', '2026-04-01'), dm(4, 'priya', '2026-04-02'), dm(2, 'sam', '2026-04-03')],
      partners,
    )
    expect(topPersonByMonth[3]).toBe('priya')
  })

  it('breaks a tie in a month by the whole year, then by handle, whatever the message order', () => {
    const messages = [
      // April: Sam 2, Priya 2. Over the year Sam has 4 and Priya 3, so Sam takes April.
      dm(2, 'sam', '2026-04-01'), dm(2, 'me', '2026-04-02'), dm(1, 'priya', '2026-04-03'), dm(1, 'me', '2026-04-04'),
      dm(2, 'sam', '2026-06-01'), dm(2, 'me', '2026-06-02'),
      // May: Alex 1 and Priya 1 and over the year Alex 1, Priya 3: Priya. Alex never wins a tie with more texts elsewhere.
      dm(3, 'alex', '2026-05-01'), dm(1, 'priya', '2026-05-02'),
    ]
    expect(personalStats(messages, partners).topPersonByMonth.slice(3, 6)).toEqual(['sam', 'priya', 'sam'])
    expect(personalStats([...messages].reverse(), partners).topPersonByMonth.slice(3, 6)).toEqual(['sam', 'priya', 'sam'])
    // A full tie (same month, same year total) goes to the smaller handle.
    const even = [dm(3, 'alex', '2026-07-01'), dm(2, 'sam', '2026-07-01')]
    expect(personalStats(even, partners).topPersonByMonth[6]).toBe('alex')
    expect(personalStats([...even].reverse(), partners).topPersonByMonth[6]).toBe('alex')
  })

  it('ignores reactions', () => {
    const target = dm(2, 'sam', '2026-08-01')
    const reactions = [1, 2, 3].map(() => react('priya', { ...target, chatId: 1 }, 'love', '2026-08-02T12:00:00Z'))
    expect(personalStats([target, ...reactions], partners).topPersonByMonth[7]).toBe('sam')
  })

  it('is all null with no 1:1 messages', () => {
    const stats = personalStats([inGroup('alex', '2026-01-10'), inGroup('me', '2026-01-10')], partners)
    expect(stats).toEqual({ topPersonByMonth: Array(12).fill(null), topPersonCountByMonth: Array(12).fill(0), personStreak: null })
  })

  it("counts each month's person's 1:1 messages, both ways, lined up with the months", () => {
    const { topPersonByMonth, topPersonCountByMonth } = personalStats(
      [dm(1, 'me', '2026-01-10'), dm(1, 'priya', '2026-01-11'), dm(1, 'priya', '2026-01-12'), dm(2, 'sam', '2026-01-12'), dm(2, 'sam', '2026-03-01')],
      partners,
    )
    expect(topPersonByMonth.slice(0, 3)).toEqual(['priya', null, 'sam'])
    expect(topPersonCountByMonth).toEqual([3, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('longest streak with one person', () => {
  it('counts days in a row with at least one 1:1 message either way, with its first day', () => {
    const stats = personalStats([...daily(2, '2026-03-30', 5), dm(2, 'sam', '2026-04-04'), ...daily(2, '2026-04-10', 3)], partners)
    expect(stats.personStreak).toEqual({ person: 'sam', days: 6, from: '2026-03-30' })
  })

  it('breaks when a day is missed, and keeps the longer run', () => {
    const stats = personalStats([...daily(2, '2026-05-01', 3), ...daily(2, '2026-05-05', 4)], partners)
    expect(stats.personStreak).toEqual({ person: 'sam', days: 4, from: '2026-05-05' })
  })

  it('is one person: talking to someone else on the missed day does not keep it going', () => {
    // Priya Mon, Sam Tue, Priya Wed: the any-message streak is 3 days; each person's is 1.
    const stats = personalStats([dm(1, 'me', '2026-06-01'), dm(2, 'me', '2026-06-02'), dm(1, 'me', '2026-06-03')], partners)
    expect(stats.personStreak).toEqual({ person: 'priya', days: 1, from: '2026-06-01' })
  })

  it('does not count group days', () => {
    const groupDays = ['2026-06-01', '2026-06-02', '2026-06-03'].map((d) => inGroup('sam', d))
    expect(personalStats([...groupDays, dm(2, 'sam', '2026-06-04')], partners).personStreak).toEqual({ person: 'sam', days: 1, from: '2026-06-04' })
  })

  it('uses local days: 11:30 PM and 12:30 AM the next night are two days in a row, across DST', () => {
    const stats = personalStats(
      [
        dm(1, 'me', '2026-03-07', '23:30:00-05:00'),
        dm(1, 'me', '2026-03-08', '23:30:00-04:00'), // DST starts Mar 8
        dm(1, 'me', '2026-03-09', '00:30:00-04:00'),
      ],
      partners,
    )
    expect(stats.personStreak).toEqual({ person: 'priya', days: 3, from: '2026-03-07' })
  })

  it('breaks a tie between people by the whole year, then by handle; a person\'s own tie goes to their earliest run', () => {
    const sam = [...daily(2, '2026-07-01', 3), dm(2, 'sam', '2026-07-01'), ...daily(2, '2026-07-10', 3)] // two 3-day runs, 7 messages
    const priya = daily(1, '2026-08-01', 3) // 3 messages
    expect(personalStats([...priya, ...sam], partners).personStreak).toEqual({ person: 'sam', days: 3, from: '2026-07-01' })
    expect(personalStats([...sam, ...priya].reverse(), partners).personStreak).toEqual({ person: 'sam', days: 3, from: '2026-07-01' })
    const alex = daily(3, '2026-09-01', 3)
    expect(personalStats([...priya, ...alex], partners).personStreak?.person).toBe('alex')
  })
})
