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

  it.each([
    ['not an object', (c: any) => 'hello'],
    ['a hit index past the end', (c: any) => ({ ...c, hit: c.messages.length })],
    ['a fractional hit index', (c: any) => ({ ...c, hit: 0.5 })],
    ['a sender that is not a person id', (c: any) => ({ ...c, messages: [{ ...c.messages[0], senderId: '+14165550101' }] })],
    ['an unknown media kind', (c: any) => ({ ...c, messages: [{ ...c.messages[0], media: 'javascript:' }] })],
    ['a reaction count that is a string', (c: any) => ({ ...c, messages: [{ ...c.messages[0], laughs: '2' }] })],
    ['text that is missing', (c: any) => ({ ...c, messages: [{ senderId: 'p1', sentAt: c.messages[0].sentAt }] })],
  ])('refuses a conversation with %s', (_label, breakIt) => {
    const wrap = copyOf()
    wrap.greatestHits[0].conversation = breakIt(wrap.greatestHits[0].conversation)
    expect(() => parseWrap(wrap)).toThrow(BrokenLinkError)
  })
})
