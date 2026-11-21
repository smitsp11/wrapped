import { describe, expect, it, vi } from 'vitest'
import { counterKey, createHandler, EVENTS, redisConfig, type Deps, type Fetch } from '../../site/api/c'

const NOW = new Date('2026-11-21T23:30:00Z')
const UPSTASH = { UPSTASH_REDIS_REST_URL: 'https://up.example/', UPSTASH_REDIS_REST_TOKEN: 'up-token' }
const KV = { KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'kv-token' }

function setup(env: Record<string, string | undefined> = UPSTASH, redis: Fetch = vi.fn(async () => Response.json({ result: 1 }))) {
  const deps: Deps = { env, fetch: redis, now: () => NOW, version: '0.2.0' }
  return { handle: createHandler(deps), redis: redis as unknown as ReturnType<typeof vi.fn> }
}

const post = (body: string) => new Request('https://wrapped.example/api/c', { method: 'POST', body, headers: { 'content-type': 'text/plain' } })

/** The Redis commands sent, as [url, authorization, command]. */
const commands = (redis: ReturnType<typeof vi.fn>) =>
  redis.mock.calls.map(([url, init]) => [url, (init as RequestInit & { headers: Record<string, string> }).headers.authorization, JSON.parse(String((init as RequestInit).body))])

describe('POST /api/c', () => {
  it('adds one to today\'s tally (UTC) for each allowed event, and answers 204', async () => {
    for (const event of EVENTS) {
      const { handle, redis } = setup()
      const res = await handle(post(JSON.stringify({ event })))
      expect(res.status).toBe(204)
      expect(commands(redis)).toEqual([['https://up.example', 'Bearer up-token', ['INCR', `c:2026-11-21:${event}`]]])
    }
  })
  it('rejects anything not on the list, malformed or oversized, with 400 and no Redis call', async () => {
    const { handle, redis } = setup()
    const bad = ['{"event":"wrap_made"}', '{"event":"SEND"}', '{}', 'null', '"send"', 'send', '', '{"event":1}', JSON.stringify({ event: 'send', pad: 'x'.repeat(300) })]
    for (const body of bad) expect((await handle(post(body))).status, body).toBe(400)
    expect(redis).not.toHaveBeenCalled()
  })
  it('counts only the event: other fields are ignored, and no IP, user agent or other header is passed on', async () => {
    const { handle, redis } = setup()
    const req = new Request('https://wrapped.example/api/c', {
      method: 'POST',
      body: JSON.stringify({ event: 'send', name: 'Alex Chen' }),
      headers: { 'user-agent': 'Secret/1.0', 'x-forwarded-for': '203.0.113.9' },
    })
    expect((await handle(req)).status).toBe(204)
    const sent = JSON.stringify(redis.mock.calls)
    for (const secret of ['Alex', 'Secret', '203.0.113.9']) expect(sent).not.toContain(secret)
  })
  it('rejects other methods with 400', async () => {
    const { handle, redis } = setup()
    for (const method of ['PUT', 'DELETE', 'PATCH']) expect((await handle(new Request('https://wrapped.example/api/c', { method }))).status).toBe(400)
    expect(redis).not.toHaveBeenCalled()
  })
  it('answers 204 and counts nothing when Redis isn\'t set up', async () => {
    const { handle, redis } = setup({})
    expect((await handle(post('{"event":"send"}'))).status).toBe(204)
    expect(redis).not.toHaveBeenCalled()
  })
  it('still answers 204 when Redis fails, or gives up on it after a second when it hangs', async () => {
    const failing = setup(UPSTASH, vi.fn(async () => Promise.reject(new Error('down'))))
    expect((await failing.handle(post('{"event":"send"}'))).status).toBe(204)
    const hanging = setup(UPSTASH, (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))))
    const started = Date.now()
    expect((await hanging.handle(post('{"event":"send"}'))).status).toBe(204)
    expect(Date.now() - started).toBeLessThan(1500)
  })
  it('stops counting past 600 a minute on one instance, but still answers 204', async () => {
    const { handle, redis } = setup()
    for (let i = 0; i < 605; i++) expect((await handle(post('{"event":"send"}'))).status).toBe(204)
    expect(redis).toHaveBeenCalledTimes(600)
  })
})

describe('GET (the app\'s /version.json)', () => {
  it('answers the version, never cached, and counts an app_launch', async () => {
    const { handle, redis } = setup()
    const res = await handle(new Request('https://wrapped.example/version.json'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ version: '0.2.0' })
    expect(commands(redis)).toEqual([['https://up.example', 'Bearer up-token', ['INCR', 'c:2026-11-21:app_launch']]])
  })
  it('answers without counting when the app has counting off (?nocount=1)', async () => {
    const { handle, redis } = setup()
    expect(await (await handle(new Request('https://wrapped.example/version.json?nocount=1'))).json()).toEqual({ version: '0.2.0' })
    expect(redis).not.toHaveBeenCalled()
  })
  it('answers the version even when Redis is missing or failing', async () => {
    for (const { handle } of [setup({}), setup(UPSTASH, vi.fn(async () => Promise.reject(new Error('down'))))]) {
      expect(await (await handle(new Request('https://wrapped.example/version.json'))).json()).toEqual({ version: '0.2.0' })
    }
  })
})

describe('redisConfig', () => {
  it('uses UPSTASH_REDIS_REST_*, or else KV_REST_API_*, preferring UPSTASH when both are set', () => {
    expect(redisConfig(UPSTASH)).toEqual({ url: 'https://up.example', token: 'up-token' })
    expect(redisConfig(KV)).toEqual({ url: 'https://kv.example', token: 'kv-token' })
    expect(redisConfig({ ...KV, ...UPSTASH })).toEqual({ url: 'https://up.example', token: 'up-token' })
  })
  it('needs a whole pair', () => {
    expect(redisConfig({})).toBeNull()
    expect(redisConfig({ UPSTASH_REDIS_REST_URL: 'https://up.example', KV_REST_API_TOKEN: 'kv-token' })).toBeNull()
    expect(redisConfig({ UPSTASH_REDIS_REST_URL: 'https://up.example', ...KV })).toEqual({ url: 'https://kv.example', token: 'kv-token' })
  })
  it('counts through the KV_REST_API_* pair too', async () => {
    const { handle, redis } = setup(KV)
    await handle(post('{"event":"link_open"}'))
    expect(commands(redis)).toEqual([['https://kv.example', 'Bearer kv-token', ['INCR', 'c:2026-11-21:link_open']]])
  })
})

describe('counterKey', () => {
  it('uses the UTC date', () => {
    expect(counterKey('send', new Date('2026-12-31T23:59:59-05:00'))).toBe('c:2027-01-01:send')
    expect(counterKey('wrap_made_solo', new Date('2026-01-05T00:00:00Z'))).toBe('c:2026-01-05:wrap_made_solo')
  })
})
