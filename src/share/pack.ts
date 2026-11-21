import { BrokenLinkError, WrappedError } from '../errors'
import { type Hit, SHOWN_HITS, shortQuote } from '../stats/greatestHits'
import type { Wrap } from '../types'
import { parseWrap } from './parseWrap'

/** Characters allowed after the "#". Long enough for stats + a few quotes, short enough to paste. */
export const MAX_LINK_CHARS = 8192

export async function packWrap(wrap: Wrap): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(wrap))
  return toBase64Url(await transform(json, new CompressionStream('deflate-raw')))
}

/** Anything after the "#" is untrusted: check size and characters, then the shape of the data. */
export async function unpackWrap(packed: string): Promise<Wrap> {
  const link = packed.replace(/\s+/g, '')
  // The length cap also caps inflation: deflate expands at most ~1032:1, so at most ~8 MB comes out.
  if (link.length === 0 || link.length > MAX_LINK_CHARS || !/^[A-Za-z0-9_-]+$/.test(link)) throw new BrokenLinkError()
  let value: unknown
  try {
    const json = await transform(fromBase64Url(link), new DecompressionStream('deflate-raw'))
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))
  } catch {
    throw new BrokenLinkError()
  }
  return parseWrap(value)
}

/**
 * Only what the slide shows goes in a link: the first SHOWN_HITS quotes, each cut to what the Greatest hits slide shows
 * (shortQuote), with the conversation around it (each message there is already cut to MAX_QUOTE_LENGTH). Quotes the
 * slide never shows stay out. Expects `greatestHits` sorted most-reacted first, as `greatestHits()` returns it, and any
 * quote that mustn't be shared already taken out (withoutContactInfo), so the link's quote i is the i-th one left.
 */
export function shownHits(hits: Hit[]): Hit[] {
  return hits.slice(0, SHOWN_HITS).map((hit) => ({ ...hit, text: shortQuote(hit.text) }))
}

/**
 * Packs what the slides show (shownHits), and shrinks it until the link fits: while it's too long it removes
 * conversations (least-reacted quote first), then quotes from the end. `dropped` is the quotes removed for length.
 */
export async function fitToLimit(wrap: Wrap, limit = MAX_LINK_CHARS): Promise<{ packed: string; dropped: Hit[] }> {
  const kept = shownHits(wrap.greatestHits)
  const dropped: Hit[] = []
  for (;;) {
    const packed = await packWrap({ ...wrap, greatestHits: kept })
    if (packed.length <= limit) return { packed, dropped }
    const lastConvo = lastIndexWithConversation(kept)
    if (lastConvo >= 0) {
      kept[lastConvo] = withoutConversation(kept[lastConvo]!)
      continue
    }
    const last = kept.pop()
    if (!last) throw new WrappedError('This wrap is too big to fit in a link.')
    dropped.unshift(last)
  }
}

function withoutConversation(hit: Hit): Hit {
  const { conversation: _, ...rest } = hit
  return rest
}

function lastIndexWithConversation(hits: Hit[]): number {
  for (let i = hits.length - 1; i >= 0; i--) if (hits[i]!.conversation) return i
  return -1
}

async function transform(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const output = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(output).arrayBuffer())
}

// Uint8Array#toBase64 isn't available in Node 22 yet.
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '==='.slice((base64.length + 3) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}
