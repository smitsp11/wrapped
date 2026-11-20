import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { applyReview, initialReview } from '../../web/src/maker/review'

describe('review', () => {
  const base = makeFakeWrap('group')
  const wrap = { ...base, greatestHits: [{ ...base.greatestHits[0]!, text: 'call me at 416 555 0199' }, ...base.greatestHits.slice(1)] }

  it('starts with quotes that look like contact info unticked', () => {
    const review = initialReview(wrap)
    expect(review.droppedHits.has(0)).toBe(true)
    expect(review.droppedHits.size).toBe(1)
    expect(review.droppedSignatures.size).toBe(0)
  })
  it('removes unticked quotes and signature words', () => {
    const person = Object.keys(wrap.words.signatureWordByPerson)[0]!
    const out = applyReview(wrap, { droppedHits: new Set([0]), droppedSignatures: new Set([person]) })
    expect(out.greatestHits).toEqual(wrap.greatestHits.slice(1))
    expect(Object.hasOwn(out.words.signatureWordByPerson, person)).toBe(false)
    expect(out.title).toBe(wrap.title)
  })
})
