import { describe, expect, it } from 'vitest'
import { fullYear, periodChoices, yearSoFar } from '../../src/app/period'

describe('period', () => {
  it('runs from Jan 1 to the end of today', () => {
    const p = yearSoFar(2026, new Date(2026, 9, 27, 15, 30))
    expect(p.from).toEqual(new Date(2026, 0, 1))
    expect(p.to).toEqual(new Date(2026, 9, 28))
    expect(p.label).toBe('2026 so far')
  })
  it('a full year ends on the next Jan 1', () => {
    expect(fullYear(2026).to).toEqual(new Date(2027, 0, 1))
    expect(fullYear(2026).label).toBe('2026')
  })
  it('offers only this year outside January', () => {
    expect(periodChoices(new Date(2026, 9, 27)).map((p) => p.label)).toEqual(['2026 so far'])
  })
  it('offers last year first in January', () => {
    expect(periodChoices(new Date(2027, 0, 12)).map((p) => p.label)).toEqual(['2026', '2027 so far'])
  })
})
