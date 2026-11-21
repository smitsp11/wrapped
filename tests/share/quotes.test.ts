import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { linkHitIndices, withoutContactInfo } from '../../src/share/quotes'
import { SHOWN_HITS } from '../../src/stats/greatestHits'

describe('withoutContactInfo', () => {
  const fake = makeFakeWrap('group')
  // More quotes than the slide shows, so leaving out the rest is tested too.
  const base = { ...fake, greatestHits: [...fake.greatestHits, ...fake.greatestHits.map((h, i) => ({ ...h, text: `extra ${i}` }))] }
  const wrap = { ...base, greatestHits: [{ ...base.greatestHits[0]!, text: 'call me at 416 555 0199' }, ...base.greatestHits.slice(1)] }

  it('has more quotes than the slide shows, so the tests below mean something', () => {
    expect(base.greatestHits.length).toBeGreaterThan(SHOWN_HITS + 1)
  })
  it('leaves out quotes that look like a phone number or email, and the ones the slide does not show', () => {
    const email = { ...wrap, greatestHits: [{ ...base.greatestHits[0]!, text: 'mail sam@example.com' }, ...base.greatestHits.slice(1)] }
    expect(withoutContactInfo(wrap).greatestHits).toEqual(wrap.greatestHits.slice(1, 1 + SHOWN_HITS))
    expect(withoutContactInfo(email).greatestHits).toEqual(email.greatestHits.slice(1, 1 + SHOWN_HITS))
  })
  it('keeps everything else, signature words included', () => {
    expect(withoutContactInfo(wrap)).toEqual({ ...wrap, greatestHits: wrap.greatestHits.slice(1, 1 + SHOWN_HITS) })
    expect(withoutContactInfo(base)).toEqual({ ...base, greatestHits: base.greatestHits.slice(0, SHOWN_HITS) })
    expect(Object.keys(withoutContactInfo(wrap).words.signatureWordByPerson).length).toBeGreaterThan(0)
  })
  it('names the saved quotes the link keeps, by their index in the saved wrap', () => {
    expect(linkHitIndices(wrap)).toEqual([1, 2, 3])
    expect(linkHitIndices(base)).toEqual([0, 1, 2])
  })
})
