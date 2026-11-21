import { describe, expect, it } from 'vitest'
import { BrokenLinkError, NewerVersionError } from '../../src/errors'
import { parseWrap } from '../../src/share/parseWrap'
import { makeFakeWrap } from '../../fixtures/fakeWrap'

/** A deep copy that tests can break in one place. */
function copyOf(): any {
  return JSON.parse(JSON.stringify(makeFakeWrap('group')))
}

describe('parseWrap', () => {
  it('accepts both fake wraps unchanged', () => {
    for (const mode of ['group', 'solo'] as const) {
      const wrap = makeFakeWrap(mode)
      expect(parseWrap(JSON.parse(JSON.stringify(wrap)))).toEqual(wrap)
    }
  })

  it('accepts a link from before texting styles, which has no texting field', () => {
    const wrap = copyOf()
    delete wrap.texting
    expect(parseWrap(wrap).texting).toBeUndefined()
  })

  it('refuses texting stats that are not per-person numbers', () => {
    const bad = [
      (w: any) => (w.texting = 'yes'),
      (w: any) => (w.texting = { medianWordsByPerson: { p1: 2 } }),
      (w: any) => (w.texting.medianWordsByPerson.p1 = '2'),
      (w: any) => (w.texting.textsPerTurnByPerson = JSON.parse('{"toString": 1}')),
      (w: any) => (w.texting.textsPerTurnByPerson.p1 = null),
    ]
    for (const breakIt of bad) {
      const wrap = copyOf()
      breakIt(wrap)
      expect(() => parseWrap(wrap)).toThrow(BrokenLinkError)
    }
  })

  it('refuses a markup-looking award id', () => {
    const wrap = copyOf()
    wrap.awards[0].id = '"><img src=x onerror=alert(1)>'
    expect(() => parseWrap(wrap)).toThrow(BrokenLinkError)
  })

  it('refuses numbers that are strings', () => {
    const wrap = copyOf()
    wrap.greatestHits = [{ senderId: 'p1', text: 'hi', sentAt: '2026-01-01T00:00:00.000Z', reactions: '3', laughs: 0 }]
    expect(() => parseWrap(wrap)).toThrow(BrokenLinkError)
  })

  it('refuses prototype-looking people keys', () => {
    const wrap = copyOf()
    wrap.people = JSON.parse('{"toString":"x"}')
    expect(() => parseWrap(wrap)).toThrow(BrokenLinkError)
  })

  it('refuses a wrong-length hour chart and a bad date', () => {
    const shortHours = copyOf()
    shortHours.timing.byHour.pop()
    expect(() => parseWrap(shortHours)).toThrow(BrokenLinkError)
    const badDate = copyOf()
    badDate.period.from = 'yesterday'
    expect(() => parseWrap(badDate)).toThrow(BrokenLinkError)
  })

  it('refuses non-objects and unknown versions with the right error', () => {
    expect(() => parseWrap(null)).toThrow(BrokenLinkError)
    expect(() => parseWrap({ version: 2 })).toThrow(NewerVersionError)
    expect(() => parseWrap({ version: 0 })).toThrow(BrokenLinkError)
    expect(() => parseWrap({ version: 'two' })).toThrow(BrokenLinkError)
  })

  it('accepts a hit without a conversation, as in links made before conversations existed', () => {
    const wrap = copyOf()
    for (const hit of wrap.greatestHits) delete hit.conversation
    expect(parseWrap(wrap).greatestHits.every((h) => h.conversation === undefined)).toBe(true)
  })

  it("accepts My year's chat title and the names of senders who aren't among the wrap's people", () => {
    const wrap = copyOf()
    wrap.greatestHits[0].conversation = { ...wrap.greatestHits[0].conversation, title: 'Ski Trip', people: { p9: 'Dana' } }
    expect(parseWrap(wrap).greatestHits[0]!.conversation).toMatchObject({ title: 'Ski Trip', people: { p9: 'Dana' } })
  })

  it('accepts the newer stats, and a link made before them', () => {
    const solo = makeFakeWrap('solo', { yearRound: true })
    expect(solo.topPersonByMonth && solo.personStreak && solo.vsLastYear && solo.timing.busiestDay).toBeTruthy()
    expect(parseWrap(JSON.parse(JSON.stringify(solo)))).toEqual(solo)
    const { topPersonByMonth: _m, personStreak: _s, vsLastYear: _v, ...older } = JSON.parse(JSON.stringify(solo))
    delete older.timing.busiestDay
    expect(() => parseWrap(older)).not.toThrow()
  })

  it.each([
    ['a busiest day that is not a date', (w: any) => (w.timing.busiestDay = { date: 'Mar 14', messages: 3 })],
    ['a busiest day count that is a string', (w: any) => (w.timing.busiestDay = { date: '2026-03-14', messages: '3' })],
    ['11 months of people', (w: any) => (w.topPersonByMonth = Array(11).fill(null))],
    ['a month person that is not a person id', (w: any) => (w.topPersonByMonth = [...Array(11).fill(null), 'toString'])],
    ['a streak with a handle for a person', (w: any) => (w.personStreak = { personId: '+14165550101', days: 3, from: '2026-01-01' })],
    ['a streak without a start date', (w: any) => (w.personStreak = { personId: 'p1', days: 3 })],
    ['a last-year percent that is a string', (w: any) => (w.vsLastYear = { year: 2025, percent: '18' })],
    ['a last-year year that is not a whole number', (w: any) => (w.vsLastYear = { year: 2025.5, percent: 18 })],
  ])('refuses %s', (_label, breakIt) => {
    const wrap = copyOf()
    breakIt(wrap)
    expect(() => parseWrap(wrap)).toThrow(BrokenLinkError)
  })

  it.each([
    ['not an object', (c: any) => 'hello'],
    ['a hit index past the end', (c: any) => ({ ...c, hit: c.messages.length })],
    ['a fractional hit index', (c: any) => ({ ...c, hit: 0.5 })],
    ['a sender that is not a person id', (c: any) => ({ ...c, messages: [{ ...c.messages[0], senderId: '+14165550101' }] })],
    ['an unknown media kind', (c: any) => ({ ...c, messages: [{ ...c.messages[0], media: 'javascript:' }] })],
    ['a reaction count that is a string', (c: any) => ({ ...c, messages: [{ ...c.messages[0], laughs: '2' }] })],
    ['text that is missing', (c: any) => ({ ...c, messages: [{ senderId: 'p1', sentAt: c.messages[0].sentAt }] })],
    ['a chat title that is not text', (c: any) => ({ ...c, title: 7 })],
    ['people keyed by a phone number', (c: any) => ({ ...c, people: { '+14165550101': 'Alex' } })],
    ['a person whose name is not text', (c: any) => ({ ...c, people: { p9: 9 } })],
    ['people that are a list', (c: any) => ({ ...c, people: ['Alex'] })],
  ])('refuses a conversation with %s', (_label, breakIt) => {
    const wrap = copyOf()
    wrap.greatestHits[0].conversation = breakIt(wrap.greatestHits[0].conversation)
    expect(() => parseWrap(wrap)).toThrow(BrokenLinkError)
  })
})
