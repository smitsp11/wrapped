import { describe, expect, it } from 'vitest'
import { checkHistory } from '../../src/app/history'
import { fullYear, yearSoFar } from '../../src/app/period'

const year = fullYear(2026)
const now = new Date(2026, 9, 27)
const DAY = 24 * 60 * 60 * 1000

describe('checkHistory', () => {
  it('is empty with no messages at all', () => expect(checkHistory(null, year, now)).toEqual({ kind: 'empty' }))
  it('is empty when the newest message is before the period', () => {
    expect(checkHistory({ earliest: new Date(2024, 0, 1), latest: new Date(2025, 5, 1) }, year, now)).toEqual({ kind: 'empty' })
  })
  it('is empty when history starts after the period ends', () => {
    expect(checkHistory({ earliest: new Date(2027, 0, 5), latest: new Date(2027, 0, 12) }, year, now)).toEqual({ kind: 'empty' })
  })
  it('is fine when history starts before the period (or within 2 weeks of it)', () => {
    const span = { earliest: new Date(2019, 0, 3), latest: new Date(2026, 9, 27) }
    expect(checkHistory(span, year, now)).toEqual({ kind: 'ok', since: span.earliest })
    const close = { earliest: new Date(2026, 0, 10), latest: new Date(2026, 9, 27) }
    expect(checkHistory(close, year, now).kind).toBe('ok')
  })
  it('is ok when history starts exactly 2 weeks into the period', () => {
    const span = { earliest: new Date(year.from.getTime() + 14 * DAY), latest: new Date(2026, 9, 27) }
    expect(checkHistory(span, year, now).kind).toBe('ok')
  })
  it('is not empty when the newest message is exactly at the period start', () => {
    const span = { earliest: new Date(2019, 0, 1), latest: year.from }
    expect(checkHistory(span, year, new Date(2026, 0, 5)).kind).not.toBe('empty')
  })
  it('is thin when history starts more than 2 weeks into the period', () => {
    const span = { earliest: new Date(2026, 9, 6), latest: new Date(2026, 9, 27) }
    expect(checkHistory(span, year, now)).toEqual({ kind: 'thin', since: span.earliest })
  })
  it('is stale when history stops long before today', () => {
    const span = { earliest: new Date(2019, 0, 1), latest: new Date(2026, 1, 10) }
    expect(checkHistory(span, yearSoFar(2026, now), now)).toEqual({ kind: 'stale', until: span.latest })
  })
  it('is not stale when the newest message is a few days old', () => {
    const span = { earliest: new Date(2019, 0, 1), latest: new Date(2026, 9, 24) }
    expect(checkHistory(span, yearSoFar(2026, now), now).kind).toBe('ok')
  })
})
