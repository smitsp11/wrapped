import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { withoutContactInfo } from '../../web/src/maker/quotes'

describe('withoutContactInfo', () => {
  const base = makeFakeWrap('group')
  const wrap = { ...base, greatestHits: [{ ...base.greatestHits[0]!, text: 'call me at 416 555 0199' }, ...base.greatestHits.slice(1)] }

  it('leaves out quotes that look like a phone number or email', () => {
    const email = { ...wrap, greatestHits: [{ ...base.greatestHits[0]!, text: 'mail sam@example.com' }, ...base.greatestHits.slice(1)] }
    expect(withoutContactInfo(wrap).greatestHits).toEqual(wrap.greatestHits.slice(1))
    expect(withoutContactInfo(email).greatestHits).toEqual(email.greatestHits.slice(1))
  })
  it('keeps everything else, signature words included', () => {
    expect(withoutContactInfo(wrap)).toEqual({ ...wrap, greatestHits: wrap.greatestHits.slice(1) })
    expect(withoutContactInfo(base)).toEqual(base)
    expect(Object.keys(withoutContactInfo(wrap).words.signatureWordByPerson).length).toBeGreaterThan(0)
  })
})
