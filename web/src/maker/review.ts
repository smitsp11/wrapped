import { looksLikeContactInfo } from '../../../src/cliHelpers'
import type { Wrap } from '../../../src/types'

/** What the user unticked: quote indexes and the people whose signature word to leave out. */
export type Review = { droppedHits: Set<number>; droppedSignatures: Set<string> }

/** Quotes that look like a phone number or email start unticked. */
export function initialReview(wrap: Wrap): Review {
  const flagged = wrap.greatestHits.flatMap((hit, i) => (looksLikeContactInfo(hit.text) ? [i] : []))
  return { droppedHits: new Set(flagged), droppedSignatures: new Set() }
}

export function applyReview(wrap: Wrap, review: Review): Wrap {
  return {
    ...wrap,
    greatestHits: wrap.greatestHits.filter((_, i) => !review.droppedHits.has(i)),
    words: {
      ...wrap.words,
      signatureWordByPerson: Object.fromEntries(
        Object.entries(wrap.words.signatureWordByPerson).filter(([id]) => !review.droppedSignatures.has(id)),
      ),
    },
  }
}
