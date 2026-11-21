import { describe, expect, it } from 'vitest'
import { timingStats } from '../../src/stats/timing'
import { msg, react } from '../../fixtures/messages'

it('builds the heatmaps, streak, silence and late-night share', () => {
  const t = timingStats([
    msg({ senderId: 'alex', sentAt: '2026-01-01T02:00:00Z' }), // Thursday, late night
    msg({ senderId: 'alex', sentAt: '2026-01-02T20:00:00Z' }), // Friday
    msg({ senderId: 'me', sentAt: '2026-01-03T20:30:00Z' }), // Saturday
    msg({ senderId: 'me', sentAt: '2026-01-10T21:00:00Z' }), // Saturday, a week later
  ])
  expect(t.byMonth[0]).toBe(4)
  expect(t.byWeekday).toEqual([0, 0, 0, 0, 1, 1, 2])
  expect([t.byHour[2], t.byHour[20], t.byHour[21]]).toEqual([1, 2, 1])
  expect(t.longestStreakDays).toBe(3)
  expect(t.longestSilenceDays).toBe(7)
  expect(t.lateNightShareByPerson).toEqual({ alex: 0.5, me: 0 })
})

it('handles no messages', () => {
  expect(timingStats([]).longestStreakDays).toBe(0)
})

it('uses local time, not UTC, for hours, weekdays and day boundaries', () => {
  const previous = process.env.TZ
  process.env.TZ = 'America/Toronto'
  try {
    const night = timingStats([msg({ senderId: 'alex', sentAt: '2026-01-01T03:00:00Z' })]) // Wed 10 PM
    expect(night.byHour[22]).toBe(1)
    expect(night.byWeekday[3]).toBe(1)

    // noon in Toronto on Mar 7 (EST), Mar 8 and Mar 9 (EDT, DST starts Mar 8)
    const dst = timingStats([
      msg({ senderId: 'alex', sentAt: '2026-03-07T17:00:00Z' }),
      msg({ senderId: 'alex', sentAt: '2026-03-08T16:00:00Z' }),
      msg({ senderId: 'alex', sentAt: '2026-03-09T16:00:00Z' }),
    ])
    expect(dst.longestStreakDays).toBe(3)

    // 11:30 PM and 12:30 AM local are the same UTC day but consecutive local days
    const midnight = timingStats([
      msg({ senderId: 'alex', sentAt: '2026-01-06T04:30:00Z' }),
      msg({ senderId: 'alex', sentAt: '2026-01-06T05:30:00Z' }),
    ])
    expect(midnight.longestStreakDays).toBe(2)
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

it('gives the same result for unsorted input', () => {
  const messages = [
    msg({ senderId: 'me', sentAt: '2026-01-10T21:00:00Z' }),
    msg({ senderId: 'alex', sentAt: '2026-01-01T02:00:00Z' }),
    msg({ senderId: 'me', sentAt: '2026-01-03T20:30:00Z' }),
    msg({ senderId: 'alex', sentAt: '2026-01-02T20:00:00Z' }),
  ]
  const t = timingStats(messages)
  expect(t.longestStreakDays).toBe(3)
  expect(t.longestSilenceDays).toBe(7)
})

it('counts messages from different chats toward one streak', () => {
  const t = timingStats([
    msg({ senderId: 'alex', chatId: 1, sentAt: '2026-01-01T12:00:00Z' }),
    msg({ senderId: 'sam', chatId: 2, sentAt: '2026-01-02T12:00:00Z' }),
  ])
  expect(t.longestStreakDays).toBe(2)
})

it('excludes reactions from heatmaps and late-night share', () => {
  const a = msg({ senderId: 'alex', sentAt: '2026-01-01T12:00:00Z' })
  const t = timingStats([a, react('me', a, 'love', '2026-01-01T02:00:00Z')])
  expect(t.byHour[2]).toBe(0)
  expect(t.byMonth[0]).toBe(1)
  expect(t.lateNightShareByPerson).toEqual({ alex: 0 })
})

it('handles a single message', () => {
  const t = timingStats([msg({ senderId: 'alex', sentAt: '2026-01-01T12:00:00Z' })])
  expect(t.longestStreakDays).toBe(1)
  expect(t.longestSilenceDays).toBe(0)
})

it('reports the longer run after a broken streak', () => {
  const t = timingStats([
    msg({ senderId: 'alex', sentAt: '2026-01-01T12:00:00Z' }),
    msg({ senderId: 'alex', sentAt: '2026-01-02T12:00:00Z' }),
    msg({ senderId: 'alex', sentAt: '2026-01-10T12:00:00Z' }),
    msg({ senderId: 'alex', sentAt: '2026-01-11T12:00:00Z' }),
    msg({ senderId: 'alex', sentAt: '2026-01-12T12:00:00Z' }),
  ])
  expect(t.longestStreakDays).toBe(3)
})

describe('busiest day', () => {
  it('is the local day with the most messages, with its count, not counting reactions', () => {
    const a = msg({ senderId: 'alex', sentAt: '2026-03-14T12:00:00Z' })
    const t = timingStats([
      msg({ senderId: 'alex', sentAt: '2026-03-13T12:00:00Z' }),
      a,
      msg({ senderId: 'me', chatId: 2, sentAt: '2026-03-14T13:00:00Z' }), // any chat counts
      react('me', a, 'love', '2026-03-15T12:00:00Z'),
      react('sam', a, 'laugh', '2026-03-15T12:01:00Z'),
      react('jordan', a, 'like', '2026-03-15T12:02:00Z'),
    ])
    expect(t.busiestDay).toEqual({ date: '2026-03-14', messages: 2 })
  })

  it('goes to the earliest of equally busy days, whatever the message order', () => {
    const messages = [
      msg({ senderId: 'alex', sentAt: '2026-07-01T12:00:00Z' }),
      msg({ senderId: 'alex', sentAt: '2026-02-01T12:00:00Z' }),
      msg({ senderId: 'alex', sentAt: '2026-07-01T13:00:00Z' }),
      msg({ senderId: 'alex', sentAt: '2026-02-01T13:00:00Z' }),
    ]
    expect(timingStats(messages).busiestDay).toEqual({ date: '2026-02-01', messages: 2 })
    expect(timingStats([...messages].reverse()).busiestDay).toEqual({ date: '2026-02-01', messages: 2 })
  })

  it('is left out when there are no messages', () => {
    expect(timingStats([]).busiestDay).toBeUndefined()
    expect('busiestDay' in timingStats([])).toBe(false)
  })

  it('splits days at local midnight, like the streak, and works across a DST change', () => {
    const previous = process.env.TZ
    process.env.TZ = 'America/Toronto'
    try {
      // 11:30 PM on Jan 5 and 12:30 AM on Jan 6 local: one UTC day, two local days; Jan 6 has the extra message.
      const t = timingStats([
        msg({ senderId: 'alex', sentAt: '2026-01-06T04:30:00Z' }),
        msg({ senderId: 'alex', sentAt: '2026-01-06T05:30:00Z' }),
        msg({ senderId: 'alex', sentAt: '2026-01-06T15:00:00Z' }),
      ])
      expect(t.busiestDay).toEqual({ date: '2026-01-06', messages: 2 })
      // Mar 8 (DST starts) is 23 hours long: 12:30 AM and 11:30 PM local are still one day.
      const dst = timingStats([
        msg({ senderId: 'alex', sentAt: '2026-03-08T05:30:00Z' }),
        msg({ senderId: 'alex', sentAt: '2026-03-09T03:30:00Z' }),
        msg({ senderId: 'alex', sentAt: '2026-03-09T04:30:00Z' }), // 12:30 AM Mar 9
      ])
      expect(dst.busiestDay).toEqual({ date: '2026-03-08', messages: 2 })
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })
})
