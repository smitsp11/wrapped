import { looksLikeContactInfo } from '../cliHelpers'
import { SHOWN_HITS } from '../stats/greatestHits'
import type { Wrap } from '../types'

/**
 * The quotes that go into the link, as indexes into the saved wrap's `greatestHits`: the first SHOWN_HITS of those that
 * don't look like a phone number or email (fitToLimit packs only those). The link's quote i is the saved quote at
 * index i here; the local app uses it to match the preview's photos to their quote.
 */
export function linkHitIndices(wrap: Wrap): number[] {
  return wrap.greatestHits.flatMap((hit, i) => (looksLikeContactInfo(hit.text) ? [] : [i])).slice(0, SHOWN_HITS)
}

/**
 * The wrap as it goes into the link: quotes that look like a phone number or email are left out, and so are the quotes
 * the slide doesn't show. Everything else stays; fitToLimit then cuts each quote to what the slide shows.
 */
export function withoutContactInfo(wrap: Wrap): Wrap {
  return { ...wrap, greatestHits: linkHitIndices(wrap).map((i) => wrap.greatestHits[i]!) }
}
