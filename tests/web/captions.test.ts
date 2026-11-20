import { describe, expect, it } from 'vitest'
import { caption } from '../../web/src/captions'

describe('caption: who talked the most', () => {
  it("says it's not close when #1 has at least 1.5× #2's share", () => {
    expect(caption({ slide: 'volume', topShare: 45, secondShare: 30 })).toBe("(it's not close)")
    expect(caption({ slide: 'volume', topShare: 60, secondShare: 20 })).toBe("(it's not close)")
  })
  it('says neck and neck when the top two are within 2 points', () => {
    expect(caption({ slide: 'volume', topShare: 31, secondShare: 29 })).toBe('(neck and neck)')
    expect(caption({ slide: 'volume', topShare: 25, secondShare: 25 })).toBe('(neck and neck)')
  })
  it('prefers neck and neck when tiny shares are both 1.5× apart and within 2 points', () => {
    expect(caption({ slide: 'volume', topShare: 3, secondShare: 1.5 })).toBe('(neck and neck)')
  })
  it('says nothing in between', () => {
    expect(caption({ slide: 'volume', topShare: 29.8, secondShare: 26.5 })).toBeNull()
    expect(caption({ slide: 'volume', topShare: 44.9, secondShare: 30 })).toBeNull()
  })
})

describe('caption: peak hour', () => {
  it('notices a night-time peak', () => {
    expect(caption({ slide: 'hours', peakHour: 0, peakCount: 9 })).toBe('(way past bedtime)')
    expect(caption({ slide: 'hours', peakHour: 4, peakCount: 9 })).toBe('(way past bedtime)')
  })
  it('notices an early-morning peak', () => {
    expect(caption({ slide: 'hours', peakHour: 5, peakCount: 9 })).toBe('(early birds)')
    expect(caption({ slide: 'hours', peakHour: 7, peakCount: 9 })).toBe('(early birds)')
  })
  it('says nothing for a daytime or evening peak', () => {
    expect(caption({ slide: 'hours', peakHour: 8, peakCount: 9 })).toBeNull()
    expect(caption({ slide: 'hours', peakHour: 21, peakCount: 9 })).toBeNull()
  })
  it('says nothing when no hour has any messages', () => {
    expect(caption({ slide: 'hours', peakHour: 0, peakCount: 0 })).toBeNull()
  })
})

describe('caption: streak and replies', () => {
  it('marks a streak of 100 days or more', () => {
    expect(caption({ slide: 'streak', days: 100 })).toBe("(that's dedication)")
    expect(caption({ slide: 'streak', days: 99 })).toBeNull()
  })
  it('marks a typical reply of a minute or less', () => {
    expect(caption({ slide: 'replies', fastestMinutes: 1 })).toBe('(fast thumbs)')
    expect(caption({ slide: 'replies', fastestMinutes: 0.5 })).toBe('(fast thumbs)')
    expect(caption({ slide: 'replies', fastestMinutes: 2 })).toBeNull()
  })
})
