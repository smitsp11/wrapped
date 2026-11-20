import { looksLikeContactInfo } from '../../../src/cliHelpers'
import type { Wrap } from '../../../src/types'

/** The wrap as it goes into the link: quotes that look like a phone number or email are left out. Everything else stays. */
export function withoutContactInfo(wrap: Wrap): Wrap {
  return { ...wrap, greatestHits: wrap.greatestHits.filter((hit) => !looksLikeContactInfo(hit.text)) }
}
