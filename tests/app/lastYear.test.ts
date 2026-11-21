import { describe, expect, it } from 'vitest'
import { lastYearChange, MIN_LAST_YEAR_MESSAGES } from '../../src/app/lastYear'
import { yearSoFar } from '../../src/app/period'

// vitest.config pins TZ to UTC; periods are local dates either way.
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Counts per chat row for this year's window and last year's, and the windows it was asked about. */
function fakeDb(thisYear: Record<number, number>, lastYear: Record<number, number>) {
  const asked: string[] = []
  return {
    asked,
    messageCountsByChat(from: Date, to: Date) {
      asked.push(`${iso(from)}..${iso(to)}`)
      const counts = from.getFullYear() === 2026 ? thisYear : lastYear
      return new Map(Object.entries(counts).map(([id, n]) => [Number(id), n]))
    },
  }
}
const longHistory = { earliest: new Date(2019, 8, 9), latest: new Date(2026, 10, 21) }
const period = yearSoFar(2026, new Date(2026, 10, 21)) // Jan 1 → end of Nov 21

describe('lastYearChange', () => {
  it('compares the period with the same dates a year earlier, as a whole percent', () => {
    const db = fakeDb({ 1: 1180 }, { 1: 1000 })
    expect(lastYearChange(db, longHistory, period)).toEqual({ year: 2025, percent: 18 })
    expect(db.asked).toEqual(['2025-01-01..2025-11-22', '2026-01-01..2026-11-22'])
  })

  it("counts only a group's own chat rows, and goes down as well as up", () => {
    const db = fakeDb({ 1: 300, 2: 200, 3: 5000 }, { 1: 600, 2: 300, 3: 10 })
    expect(lastYearChange(db, longHistory, period, [1, 2])).toEqual({ year: 2025, percent: -44 })
    expect(lastYearChange(db, longHistory, period, [3])).toBeUndefined() // 10 messages last year: too few
  })

  it(`needs at least ${MIN_LAST_YEAR_MESSAGES} messages last year`, () => {
    expect(lastYearChange(fakeDb({ 1: 500 }, { 1: MIN_LAST_YEAR_MESSAGES - 1 }), longHistory, period)).toBeUndefined()
    expect(lastYearChange(fakeDb({ 1: 500 }, { 1: MIN_LAST_YEAR_MESSAGES }), longHistory, period)).toEqual({ year: 2025, percent: 400 })
  })

  it("says nothing when this Mac's history starts after last year's dates begin (new Mac, iCloud still syncing)", () => {
    const db = fakeDb({ 1: 900 }, { 1: 800 })
    expect(lastYearChange(db, { ...longHistory, earliest: new Date(2025, 2, 1) }, period)).toBeUndefined()
    expect(lastYearChange(db, { ...longHistory, earliest: new Date(2025, 0, 10) }, period)).toEqual({ year: 2025, percent: 13 }) // within two weeks
    expect(lastYearChange(db, null, period)).toBeUndefined()
  })

  it('is "same" at zero and keeps a whole year whole', () => {
    const db = fakeDb({ 1: 1000 }, { 1: 1000 })
    expect(lastYearChange(db, longHistory, { from: new Date(2026, 0, 1), to: new Date(2027, 0, 1) })).toEqual({ year: 2025, percent: 0 })
    expect(db.asked[0]).toBe('2025-01-01..2026-01-01')
  })
})
