import { describe, expect, it, vi } from 'vitest'
import { counter, countingOff } from '../../src/app/count'

const SITE = 'https://wrapped.example'

describe('counter', () => {
  it('posts only the event name to <site>/api/c, with a timeout', async () => {
    const post = vi.fn(async () => new Response(null, { status: 204 }))
    counter(SITE, {}, post)('send')
    expect(post).toHaveBeenCalledTimes(1)
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${SITE}/api/c`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ event: 'send' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it('does nothing with WRAPPED_NO_COUNT=1 or WRAPPED_NO_UPDATE_CHECK=1', () => {
    for (const env of [{ WRAPPED_NO_COUNT: '1' }, { WRAPPED_NO_UPDATE_CHECK: '1' }]) {
      const post = vi.fn(async () => new Response(null, { status: 204 }))
      counter(SITE, env, post)('wrap_made_group')
      expect(post).not.toHaveBeenCalled()
      expect(countingOff(env)).toBe(true)
    }
    expect(countingOff({ WRAPPED_NO_COUNT: '0' })).toBe(false)
  })
  it('never waits for the answer', () => {
    const post = vi.fn(() => new Promise<Response>(() => undefined)) // never answers
    const started = Date.now()
    expect(counter(SITE, {}, post)('wrap_made_solo')).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(50)
  })
  it('swallows failures, thrown or rejected', async () => {
    const rejected = vi.fn(async () => Promise.reject(new Error('offline')))
    const thrown = vi.fn(() => {
      throw new Error('bad url')
    })
    expect(() => counter(SITE, {}, rejected)('send')).not.toThrow()
    expect(() => counter(SITE, {}, thrown)('send')).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0)) // an unhandled rejection would fail the run
  })
})
