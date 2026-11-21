import { describe, expect, it } from 'vitest'
import { BrokenLinkError, NewerVersionError, WrappedError } from '../../src/errors'
import { MAX_LINK_CHARS, fitToLimit, packWrap, shownHits, unpackWrap } from '../../src/share/pack'
import { MAX_CONVO_MESSAGES, MAX_QUOTE_LENGTH, SHOWN_HITS, SHOWN_QUOTE_LENGTH, shortQuote } from '../../src/stats/greatestHits'
import type { Wrap } from '../../src/types'
import { makeFakeWrap } from '../../fixtures/fakeWrap'

/** Pseudo-random letters, so the text doesn't compress away. */
function noise(seed: number, length: number): string {
  let x = seed
  let out = ''
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) % 2147483648
    out += String.fromCharCode(97 + (x % 26))
  }
  return out
}

async function deflateToBase64Url(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const deflated = new Uint8Array(await new Response(stream).arrayBuffer())
  return btoa(String.fromCharCode(...deflated)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('share links', () => {
  const wrap = makeFakeWrap('group')

  it('round-trips a wrap', async () => {
    const packed = await packWrap(wrap)
    expect(packed).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(await unpackWrap(packed)).toEqual(wrap)
  })

  it(`packs only the ${SHOWN_HITS} quotes the slide shows, each cut to what the slide shows`, async () => {
    const hits = Array.from({ length: 6 }, (_, i) => ({
      senderId: 'p1', text: `quote ${i} ${'and so on '.repeat(20)}`.trim(), sentAt: '2026-01-01T00:00:00.000Z', reactions: 10 - i, laughs: 0,
    }))
    const { packed, dropped } = await fitToLimit({ ...wrap, greatestHits: hits })
    expect(dropped).toEqual([])
    const kept = (await unpackWrap(packed)).greatestHits
    expect(kept.map((h) => h.reactions)).toEqual([10, 9, 8])
    for (const [i, hit] of kept.entries()) {
      expect(hit.text).toBe(shortQuote(hits[i]!.text))
      expect(Array.from(hit.text).length).toBeLessThanOrEqual(SHOWN_QUOTE_LENGTH)
      expect(hit.text.endsWith('…')).toBe(true)
    }
    expect(shownHits(hits)).toEqual(kept)
  })

  it('drops the least-reacted shown quotes until the link fits', async () => {
    const hits = Array.from({ length: 10 }, (_, i) => ({
      senderId: 'p1', text: noise(i + 1, 120), sentAt: '2026-01-01T00:00:00.000Z', reactions: 10 - i, laughs: 0,
    }))
    const empty = (await packWrap({ ...wrap, greatestHits: [] })).length
    const { packed, dropped } = await fitToLimit({ ...wrap, greatestHits: hits }, empty + 150)
    expect(dropped.length).toBeGreaterThan(0)
    const kept = (await unpackWrap(packed)).greatestHits
    expect([...kept, ...dropped]).toEqual(shownHits(hits))
  })

  it('carries the conversation around each shown quote, each message at most 280 characters', async () => {
    expect(wrap.greatestHits.every((h) => h.conversation !== undefined)).toBe(true)
    const inLink = await unpackWrap((await fitToLimit(wrap)).packed)
    expect(inLink).toEqual({ ...wrap, greatestHits: shownHits(wrap.greatestHits) })
    expect(inLink.greatestHits.every((h) => h.conversation !== undefined)).toBe(true)
    const long = { ...wrap.greatestHits[0]!.conversation!.messages[0]!, text: 'x'.repeat(MAX_QUOTE_LENGTH) + '…' }
    for (const hit of inLink.greatestHits) {
      for (const m of hit.conversation!.messages) expect(Array.from(m.text).length).toBeLessThanOrEqual(Array.from(long.text).length)
    }
  })

  it('plays a link made before conversations existed', async () => {
    const old = { ...wrap, greatestHits: wrap.greatestHits.map(({ conversation: _, ...hit }) => hit) }
    expect(await unpackWrap(await packWrap(old))).toEqual(old)
  })

  describe('with conversations', () => {
    const convo = (seed: number) => ({
      messages: Array.from({ length: MAX_CONVO_MESSAGES }, (_, i) => ({
        senderId: i % 2 ? 'me' : 'p1', text: noise(seed * 100 + i, 40), sentAt: '2026-01-01T00:00:00.000Z',
      })),
      hit: 17,
    })
    const hits = Array.from({ length: 5 }, (_, i) => ({
      senderId: 'p1', text: noise(i + 1, 40), sentAt: '2026-01-01T00:00:00.000Z', reactions: 10 - i, laughs: 0, conversation: convo(i + 1),
    }))
    const withConvo = async (packed: string) => (await unpackWrap(packed)).greatestHits.map((h) => h.conversation !== undefined)

    it(`keeps the ${SHOWN_HITS} quotes the slide shows, each with its conversation`, async () => {
      const { packed, dropped } = await fitToLimit({ ...wrap, greatestHits: hits })
      expect(dropped).toEqual([])
      expect(await withConvo(packed)).toEqual([true, true, true])
    })

    it('drops conversations from the least-reacted quote first, before any quote', async () => {
      const { conversation: _, ...third } = hits[2]!
      const twoConvos = (await packWrap({ ...wrap, greatestHits: [hits[0]!, hits[1]!, third] })).length
      const { packed, dropped } = await fitToLimit({ ...wrap, greatestHits: hits }, twoConvos)
      expect(dropped).toEqual([])
      expect(await withConvo(packed)).toEqual([true, true, false])
      const tight = await fitToLimit({ ...wrap, greatestHits: hits }, (await packWrap({ ...wrap, greatestHits: [] })).length + 400)
      expect((await unpackWrap(tight.packed)).greatestHits.every((h) => h.conversation === undefined)).toBe(true)
    })
  })

  it('fails clearly when even no quotes is too big', async () => {
    await expect(fitToLimit(wrap, 10)).rejects.toThrow(WrappedError)
  })

  it.each(['group', 'solo'] as const)('round-trips the %s fake wrap, even with a newline in the link', async (mode) => {
    const original = makeFakeWrap(mode)
    const packed = await packWrap(original)
    const middle = Math.floor(packed.length / 2)
    expect(await unpackWrap(`${packed.slice(0, middle)}\n${packed.slice(middle)}`)).toEqual(original)
  })

  describe('untrusted links', () => {
    const packAny = (value: unknown) => packWrap(value as Wrap)

    it('rejects an otherwise valid wrap that is longer than the cap', async () => {
      const tooLong = await packWrap({ ...wrap, title: noise(1, 14000) })
      expect(tooLong.length).toBeGreaterThan(MAX_LINK_CHARS)
      await expect(unpackWrap(tooLong)).rejects.toThrow(BrokenLinkError)
    })

    it('rejects bytes that are not valid UTF-8, even inside an otherwise valid wrap', async () => {
      const marker = 'ZZ'
      const bytes = new TextEncoder().encode(JSON.stringify({ ...wrap, title: marker }))
      const at = bytes.indexOf(marker.charCodeAt(0))
      bytes[at] = 0xff // lone 0xFF can never be UTF-8
      await expect(unpackWrap(await deflateToBase64Url(bytes))).rejects.toThrow(BrokenLinkError)
    })

    it('rejects a truncated link', async () => {
      await expect(unpackWrap((await packWrap(wrap)).slice(0, -20))).rejects.toThrow(BrokenLinkError)
    })

    it.each([
      ['invalid characters', async () => '<script>alert(1)</script>'],
      ['an empty link', async () => ''],
      ['valid characters that are not deflate', async () => 'a'.repeat(MAX_LINK_CHARS + 1)],
      ['JSON null', () => packAny(null)],
      ['JSON without the wrap fields', () => packAny({ version: 1 })],
    ])('rejects %s', async (_label, makeLink) => {
      await expect(unpackWrap(await makeLink())).rejects.toThrow(BrokenLinkError)
    })

    it('says so when the wrap is from a newer version', async () => {
      await expect(unpackWrap(await packAny({ version: 2 }))).rejects.toThrow(NewerVersionError)
    })
  })
})
