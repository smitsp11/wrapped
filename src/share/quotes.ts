import { looksLikeContactInfo } from '../cliHelpers'
import type { Wrap } from '../types'

/**
 * The quotes that go into the link, as indexes into the saved wrap's `greatestHits`: every quote except those that look
 * like a phone number or email. The local app uses it to tell which saved quote the link's Greatest hits slide shows.
 */
export function linkHitIndices(wrap: Wrap): number[] {
  return wrap.greatestHits.flatMap((hit, i) => (looksLikeContactInfo(hit.text) ? [] : [i]))
}

/** The wrap as it goes into the link: quotes that look like a phone number or email are left out. Everything else stays. */
export function withoutContactInfo(wrap: Wrap): Wrap {
  return { ...wrap, greatestHits: linkHitIndices(wrap).map((i) => wrap.greatestHits[i]!) }
}
