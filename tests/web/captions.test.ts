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
    expect(caption({ slide: 'hours', peakHour: 23, peakCount: 9 })).toBe('(go to sleep 😭)')
    expect(caption({ slide: 'hours', peakHour: 0, peakCount: 9 })).toBe('(go to sleep 😭)')
    expect(caption({ slide: 'hours', peakHour: 3, peakCount: 9 })).toBe('(go to sleep 😭)')
    expect(caption({ slide: 'hours', peakHour: 4, peakCount: 9 })).toBe('(go to sleep 😭)')
  })
  it('notices an early-morning peak', () => {
    expect(caption({ slide: 'hours', peakHour: 5, peakCount: 9 })).toBe('(early birds fr)')
    expect(caption({ slide: 'hours', peakHour: 7, peakCount: 9 })).toBe('(early birds fr)')
  })
  it('says nothing for a daytime or evening peak', () => {
    expect(caption({ slide: 'hours', peakHour: 8, peakCount: 9 })).toBeNull()
    expect(caption({ slide: 'hours', peakHour: 21, peakCount: 9 })).toBeNull()
    expect(caption({ slide: 'hours', peakHour: 22, peakCount: 9 })).toBeNull()
  })
  it('says nothing when no hour has any messages', () => {
    expect(caption({ slide: 'hours', peakHour: 0, peakCount: 0 })).toBeNull()
  })
})

const you = { name: 'You', you: true }
const riley = { name: 'Riley', you: false }

describe('caption: peak month', () => {
  it("names the busiest month as your yap era, or the chat's", () => {
    expect(caption({ slide: 'months', month: 'May', peakCount: 633, group: false })).toBe('May was your yap era')
    expect(caption({ slide: 'months', month: 'September', peakCount: 1, group: true })).toBe("September was the chat's yap era")
  })
  it('says nothing for a year with no messages', () => {
    expect(caption({ slide: 'months', month: 'January', peakCount: 0, group: true })).toBeNull()
  })
})

describe('caption: your person, month by month', () => {
  it('calls three or more months in a row with one person their era', () => {
    expect(caption({ slide: 'month-people', run: { from: 'Jun', to: 'Aug', months: 3, name: 'Riley' } })).toBe('Jun–Aug was the Riley era')
    expect(caption({ slide: 'month-people', run: { from: 'Jan', to: 'Dec', months: 12, name: 'Sam' } })).toBe('Jan–Dec was the Sam era')
  })
  it('says nothing for a run of two months or less, or nobody', () => {
    expect(caption({ slide: 'month-people', run: { from: 'Jun', to: 'Jul', months: 2, name: 'Riley' } })).toBeNull()
    expect(caption({ slide: 'month-people', run: null })).toBeNull()
  })
})

describe('caption: longest streak', () => {
  it('tells you to move in together past 100 days, worded for one person or a group', () => {
    expect(caption({ slide: 'streak', days: 101, group: false })).toBe('at this point just move in together')
    expect(caption({ slide: 'streak', days: 365, group: true })).toBe('at this point just move in together, all of you')
  })
  it('says nothing at 100 days or fewer', () => {
    expect(caption({ slide: 'streak', days: 100, group: false })).toBeNull()
    expect(caption({ slide: 'streak', days: 62, group: true })).toBeNull()
  })
})

describe('caption: fastest repliers', () => {
  it('notices a typical reply under a minute, by first name or as you', () => {
    expect(caption({ slide: 'replies', minutes: 0.68, who: riley })).toBe('Riley does not have a life')
    expect(caption({ slide: 'replies', minutes: 0.1, who: you })).toBe('you do not have a life')
  })
  it('says nothing at a minute or more', () => {
    expect(caption({ slide: 'replies', minutes: 1, who: riley })).toBeNull()
    expect(caption({ slide: 'replies', minutes: 4.5, who: you })).toBeNull()
  })
})

describe('caption: texting styles', () => {
  it('calls out the Paragraph Texter, or you', () => {
    expect(caption({ slide: 'texting-styles', essayist: { name: 'Jordan', you: false } })).toBe('Jordan writes essays, the rest of you text')
    expect(caption({ slide: 'texting-styles', essayist: you })).toBe('you write essays, the rest of them text')
  })
  it('says nothing without one', () => {
    expect(caption({ slide: 'texting-styles', essayist: null })).toBeNull()
  })
})
