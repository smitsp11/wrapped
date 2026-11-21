import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import type { Wrap } from '../../src/types'
import { buildSlides } from '../../web/src/slides'
import { monthPeopleSlide, monthsSlide, personStreakSlide, shownMonths } from '../../web/src/yearSlides'

const yearSoFar = { from: '2026-01-01', to: '2026-11-22' } // Jan 1 → Nov 21
const slideHtml = (wrap: Wrap, id: string) => buildSlides(wrap).find((s) => s.id === id)?.html
const months = (n: number, ids: (string | null)[]) => [...ids, ...Array(12 - ids.length).fill(null)].slice(0, n)

describe('shownMonths', () => {
  it('stops at the month of the last day: the year so far, or the whole year', () => {
    expect(shownMonths(yearSoFar)).toEqual({ first: 0, last: 10 })
    expect(shownMonths({ from: '2026-01-01', to: '2027-01-01' })).toEqual({ first: 0, last: 11 })
    expect(shownMonths({ from: '2026-01-01', to: '2026-02-01' })).toEqual({ first: 0, last: 0 }) // Jan 31 is the last day
    expect(shownMonths({ from: '2026-01-01', to: '2026-01-02' })).toEqual({ first: 0, last: 0 })
  })
})

describe('the months slide', () => {
  it('draws one bar per month up to this one, the busiest in orange, the earlier month winning a tie', () => {
    const wrap = makeFakeWrap('group')
    wrap.period = yearSoFar
    wrap.timing.byMonth = [5, 9, 9, 0, 1, 2, 3, 4, 5, 6, 7, 99] // December hasn't happened: never shown, never the peak
    const html = monthsSlide(wrap).html
    expect(html.match(/<span[^>]*--h:/g)).toHaveLength(11)
    expect(html.match(/class="peak"/g)).toHaveLength(1)
    expect(html).toContain('<span class="peak" style="--h:100%"></span>')
    expect(html.indexOf('class="peak"')).toBe(html.indexOf('--h:100%') - 'class="peak" style="'.length) // February's bar
    expect(html).toContain('<p class="big">Feb</p>')
    expect(html).toContain('<span>J</span><span>F</span><span>M</span>')
    expect(html).not.toContain('<span>D</span>')
    expect(html).toContain('--n:11')
  })

  it('shows the busiest day as a calendar page with its count, weekday and a "what happened?"', () => {
    const wrap = makeFakeWrap('group')
    wrap.timing.busiestDay = { date: '2026-03-14', messages: 1203 }
    const html = monthsSlide(wrap).html
    expect(html).toContain('<p class="day-page"><span>Mar</span> <b>14</b></p>')
    expect(html).toContain('<b>1,203 messages</b> <small>a Saturday</small><span class="what hand">what happened on Mar 14?</span>')
    wrap.timing.busiestDay = { date: '2026-03-15', messages: 1 }
    expect(monthsSlide(wrap).html).toContain('<b>1 message</b> <small>a Sunday</small>')
  })

  it('still shows the months for a link made before the busiest day and last year existed', () => {
    const wrap = makeFakeWrap('group')
    delete wrap.timing.busiestDay
    delete wrap.vsLastYear
    const html = slideHtml(wrap, 'months')!
    expect(html).toContain('class="hours months"')
    expect(html).not.toContain('busiest')
  })

  it("calls the busiest month the chat's yap era, or yours, by its full name", () => {
    const wrap = makeFakeWrap('group')
    wrap.timing.byMonth = [5, 9, 9, 0, 1, 2, 3, 4, 50, 6, 7, 8]
    expect(monthsSlide(wrap).html).toContain('<h2>Peak month</h2><p class="aside">September was the chat&#39;s yap era</p>')
    const solo = makeFakeWrap('solo')
    solo.timing.byMonth = [5, 9, 9, 0, 70, 2, 3, 4, 50, 6, 7, 8]
    expect(monthsSlide(solo).html).toContain('<p class="aside">May was your yap era</p>')
  })

  it('has no caption for a year with no messages, and never compares with last year even when the wrap knows it', () => {
    const wrap = makeFakeWrap('group')
    wrap.vsLastYear = { year: 2025, percent: 18 }
    const html = monthsSlide(wrap).html
    expect(html).not.toContain('2025')
    expect(html).not.toContain('18%')
    wrap.timing.byMonth = new Array(12).fill(0)
    expect(monthsSlide(wrap).html).not.toContain('class="aside"')
  })
})

describe('your person, month by month', () => {
  const solo = () => {
    const wrap = makeFakeWrap('solo')
    wrap.people = { me: 'You', p1: 'Alex Chen', p2: 'Sam Rivera', p3: 'Alex Kim', p4: 'Priya Shah', others: 'Everyone else' }
    return wrap
  }

  it('is a card per month up to this one, with first names, under a subtitle', () => {
    const wrap = solo()
    wrap.period = yearSoFar
    wrap.topPersonByMonth = months(12, ['p4', 'p4', 'p2', null, 'p2', 'p4', 'p2', 'p4', 'p2', 'p4', 'p4', 'p2'])
    const html = monthPeopleSlide(wrap)!.html
    expect(html).toContain('<h2>Your person</h2><p class="aside">who you texted the most, month by month</p>\n')
    expect(html).not.toContain('era')
    expect(html.match(/<li/g)).toHaveLength(11) // no December yet
    const shown = [...html.matchAll(/<span class="month">(\w+)<\/span><span class="name"[^>]*>([^<]+)<\/span>/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(shown.slice(0, 5)).toEqual(['Jan Priya', 'Feb Priya', 'Mar Sam', 'Apr —', 'May Sam'])
  })

  it("puts each month's message count under the name, and none for an older link without counts", () => {
    const wrap = solo()
    wrap.topPersonByMonth = months(12, ['p4', 'p2', null, 'p2'])
    wrap.topPersonCountByMonth = [412, 1204, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0]
    const html = monthPeopleSlide(wrap)!.html
    expect(html).toContain('<span class="name" style="--len:5">Priya</span><span class="count">412</span></li>')
    expect(html).toContain('>Sam</span><span class="count">1,204</span></li>')
    expect(html).toContain('<li class="none" style="--i:2"><span class="month">Mar</span><span class="name">—</span></li>')
    expect(html.match(/class="count"/g)).toHaveLength(3)
    delete wrap.topPersonCountByMonth
    const older = monthPeopleSlide(wrap)!.html
    expect(older).not.toContain('class="count"')
    expect(older).toContain('<span class="name" style="--len:5">Priya</span></li>')
  })

  it('sizes a name by its length and lets a long word break only in its middle', () => {
    const wrap = solo()
    wrap.people.p1 = 'Valentinovich Okafor'
    wrap.people.p2 = 'Bartholomew Finch'
    wrap.people.p3 = 'Ana Lu'
    wrap.topPersonByMonth = months(12, ['p1', 'p2', 'p3', 'p4'])
    const html = monthPeopleSlide(wrap)!.html
    expect(html).toContain('<span class="name" style="--len:13">Valenti<wbr>novich</span>')
    expect(html).toContain('<span class="name" style="--len:11">Bartho<wbr>lomew</span>')
    expect(html).toContain('<span class="name" style="--len:3">Ana</span>')
    expect(html).toContain('<span class="name" style="--len:5">Priya</span>')
  })

  it('calls the longest run of three or more months with one person their era, next to the subtitle', () => {
    const wrap = solo()
    wrap.topPersonByMonth = months(12, ['p4', 'p4', 'p4', 'p2', null, 'p2', 'p2', 'p2', 'p2', 'p4', 'p4', 'p4'])
    const html = monthPeopleSlide(wrap)!.html
    expect(html).toContain('<p class="aside">who you texted the most, month by month</p><p class="aside era">Jun–Sep was the Sam era</p>')
    wrap.topPersonByMonth = months(12, ['p4', 'p4', 'p4', 'p2', 'p2', 'p2']) // equal runs: the earlier one
    expect(monthPeopleSlide(wrap)!.html).toContain('Jan–Mar was the Priya era')
    wrap.topPersonByMonth = months(12, ['p4', 'p4', null, 'p4', 'p2', 'p2', 'p4']) // a gap ends a run
    expect(monthPeopleSlide(wrap)!.html).not.toContain('era')
    wrap.topPersonByMonth = months(12, ['p1', 'p1', 'p1', 'p3'])
    expect(monthPeopleSlide(wrap)!.html).toContain('Jan–Mar was the Alex C. era') // the same short name as its cards
  })

  it('gives each person one ink, in the order they first appear, and an empty month a dash', () => {
    const wrap = solo()
    wrap.topPersonByMonth = months(12, ['p2', 'p4', 'p2', null])
    const html = monthPeopleSlide(wrap)!.html
    const inks = [...html.matchAll(/--who:var\((--[\w-]+)\)/g)].map((m) => m[1])
    expect(inks).toEqual(['--orange', '--blue', '--orange'])
    expect(html).toContain('<li class="none" style="--i:3"><span class="month">Apr</span><span class="name">—</span></li>')
  })

  it('tells two people with one first name apart, and escapes names', () => {
    const wrap = solo()
    wrap.people.p4 = '<b>Bo'
    wrap.topPersonByMonth = months(12, ['p1', 'p3', 'p4'])
    const html = monthPeopleSlide(wrap)!.html
    expect(html).toContain('>Alex C.<')
    expect(html).toContain('>Alex K.<')
    expect(html).toContain('&lt;b&gt;Bo<')
  })

  it('is left out of group wraps, older links, and a year without 1:1 messages so far', () => {
    expect(monthPeopleSlide(makeFakeWrap('group'))).toBeNull()
    const wrap = solo()
    delete wrap.topPersonByMonth
    expect(monthPeopleSlide(wrap)).toBeNull()
    wrap.period = { from: '2026-01-01', to: '2026-03-01' }
    wrap.topPersonByMonth = months(12, [null, null, 'p1']) // March isn't here yet
    expect(monthPeopleSlide(wrap)).toBeNull()
  })

  it('comes after the top chats in My year', () => {
    const ids = buildSlides(makeFakeWrap('solo', { yearRound: true })).map((s) => s.id)
    expect(ids.slice(0, 7)).toEqual(['intro', 'volume', 'top-chats', 'month-people', 'hours', 'months', 'streak'])
  })
})

describe('the longest streak with one person', () => {
  it('replaces My year\'s any-message streak: who, how long and when', () => {
    const wrap = makeFakeWrap('solo', { yearRound: true })
    const html = slideHtml(wrap, 'streak')!
    expect(html).toContain('<p class="big">62 days</p>')
    expect(html).toContain('in a row with <b>Sam</b>')
    expect(html).toContain('<p class="dates">Apr 1 → Jun 1</p>')
    expect(html).not.toContain('at least one message')
  })

  it('has no caption at 100 days or fewer, and no line about the any-message streak', () => {
    const wrap = makeFakeWrap('solo', { yearRound: true })
    wrap.personStreak = { personId: 'p2', days: 100, from: '2026-01-01' }
    wrap.timing.longestStreakDays = 200
    const html = personStreakSlide(wrap)!.html
    expect(html).toContain('Jan 1 → Apr 10')
    expect(html).not.toContain('class="aside"')
    expect(html).not.toContain('dedication')
    expect(html).not.toContain('texting anyone')
    expect(html).not.toContain('never missed')
  })

  it('tells you to move in together past 100 days with one person', () => {
    const wrap = makeFakeWrap('solo', { yearRound: true })
    wrap.personStreak = { personId: 'p2', days: 120, from: '2026-01-01' }
    const html = personStreakSlide(wrap)!.html
    expect(html).toContain('Jan 1 → Apr 30')
    expect(html).toContain('<h2>Longest streak</h2><p class="aside">at this point just move in together</p>')
    expect(html).not.toContain('never missed')
  })

  it('shows only the never-missed line when both it and moving in apply', () => {
    const wrap = makeFakeWrap('solo', { yearRound: true })
    wrap.period = yearSoFar
    wrap.personStreak = { personId: 'p2', days: 200, from: '2026-01-01' }
    wrap.timing.longestStreakDays = 325
    const html = personStreakSlide(wrap)!.html
    expect(html).toContain('never missed a day')
    expect(html).not.toContain('move in')
    expect(html).not.toContain('class="aside"')
  })

  it('says you never missed a day when the any-message streak covers the whole period', () => {
    const wrap = makeFakeWrap('solo', { yearRound: true })
    wrap.period = yearSoFar // 325 days, Jan 1 → Nov 21
    wrap.timing.longestStreakDays = 325
    expect(personStreakSlide(wrap)!.html).toContain('<p class="never-missed">and you never missed a day of texting</p>')
    wrap.timing.longestStreakDays = 324 // nothing sent yet on the day it was made still counts
    expect(personStreakSlide(wrap)!.html).toContain('never missed')
    wrap.timing.longestStreakDays = 323
    expect(personStreakSlide(wrap)!.html).not.toContain('never missed')
  })

  it('falls back to the any-message streak under two days, for older links, and always in a group', () => {
    const wrap = makeFakeWrap('solo', { yearRound: true })
    wrap.personStreak = { personId: 'p2', days: 1, from: '2026-01-01' }
    expect(slideHtml(wrap, 'streak')).toContain('in a row with at least one message')
    delete wrap.personStreak
    expect(slideHtml(wrap, 'streak')).toContain('in a row with at least one message')
    const group = makeFakeWrap('group', { yearRound: true })
    group.personStreak = { personId: 'p1', days: 30, from: '2026-01-01' } // never in a group wrap, but ignored if it were
    expect(slideHtml(group, 'streak')).toContain('in a row with at least one message')
  })

  it("cleans up the group streak too: no silence line, moving in past 100 days, and a note only when the chat never went quiet", () => {
    const group = makeFakeWrap('group', { yearRound: true })
    group.timing.longestStreakDays = 150
    group.timing.longestSilenceDays = 9
    const html = slideHtml(group, 'streak')!
    expect(html).toContain('<p class="aside">at this point just move in together, all of you</p>') // 150 days
    expect(html).not.toContain('silence')
    expect(html).not.toContain('class="lede"')
    expect(html).not.toContain('never-missed')
    group.period = yearSoFar
    group.timing.longestStreakDays = 325
    expect(slideHtml(group, 'streak')).toContain('<p class="never-missed">not a single quiet day</p>')
    expect(slideHtml(group, 'streak')).not.toContain('class="aside"')
  })
})
