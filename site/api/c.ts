/**
 * /api/c: anonymous daily tallies, a Vercel Function (Node.js). The whole record is one number per event per day,
 * the Redis key c:<YYYY-MM-DD>:<event> (UTC). Nothing else is kept: no IP address, no user agent, no ids.
 *
 *   POST {"event": "<one of EVENTS>"}  adds one to today's tally. 204, also when counting is off or fails.
 *   GET (/version.json is rewritten here, see vercel.json)  adds one to today's app_launch and answers
 *                                      {"version": "<the released version>"}, never cached, for the app's update check.
 *                                      ?nocount=1 (the app with WRAPPED_NO_COUNT=1) answers without counting.
 *   anything else                      400
 *
 * Redis is Upstash's REST API, through fetch. Its address and token come from UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN, or KV_REST_API_URL and KV_REST_API_TOKEN (the names some Vercel Marketplace setups use).
 * With neither pair set, nothing is counted and every answer is the same.
 */

export const EVENTS = ['wrap_made_group', 'wrap_made_solo', 'send', 'link_open', 'demo_open', 'landing_visit', 'app_launch'] as const
export type CountEvent = (typeof EVENTS)[number]

/** scripts/release.sh writes the release's version here when it copies this file into deploy/api/. */
const VERSION = '__WRAPPED_VERSION__'

/** Per running instance, at most this many tallies a minute; more are answered (204) but not counted. */
const PER_MINUTE = 600
const REDIS_TIMEOUT_MS = 1000
const MAX_BODY = 200

type Env = Record<string, string | undefined>
export type Fetch = (url: string, init: RequestInit) => Promise<Response>
export type Deps = { env: Env; fetch: Fetch; now(): Date; version: string }

/** The Upstash pair to use, UPSTASH_* first; null when neither pair is complete. */
export function redisConfig(env: Env): { url: string; token: string } | null {
  const pairs = [
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
  ]
  for (const [url, token] of pairs) if (url && token) return { url: url.replace(/\/+$/, ''), token }
  return null
}

/** c:2026-11-21:send, by the UTC date. */
export function counterKey(event: CountEvent, now: Date): string {
  return `c:${now.toISOString().slice(0, 10)}:${event}`
}

export function isEvent(value: unknown): value is CountEvent {
  return typeof value === 'string' && (EVENTS as readonly string[]).includes(value)
}

const empty = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } })

export function createHandler(deps: Deps): (request: Request) => Promise<Response> {
  let windowStart = 0
  let inWindow = 0

  /** INCR, given up on after a second; any failure just means this one isn't counted. */
  async function count(event: CountEvent): Promise<void> {
    const redis = redisConfig(deps.env)
    if (!redis) return
    const now = deps.now()
    if (now.getTime() - windowStart >= 60_000) {
      windowStart = now.getTime()
      inWindow = 0
    }
    if (++inWindow > PER_MINUTE) return
    try {
      await deps.fetch(redis.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${redis.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(['INCR', counterKey(event, now)]),
        signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      })
    } catch {
      // not counted, nothing else changes
    }
  }

  return async (request) => {
    if (request.method === 'GET') {
      if (!new URL(request.url).searchParams.has('nocount')) await count('app_launch')
      return Response.json({ version: deps.version }, { headers: { 'cache-control': 'no-store' } })
    }
    if (request.method !== 'POST') return empty(400)
    const text = await request.text().catch(() => '')
    if (text.length > MAX_BODY) return empty(400)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return empty(400)
    }
    const event = typeof body === 'object' && body !== null ? (body as { event?: unknown }).event : undefined
    if (!isEvent(event)) return empty(400)
    await count(event)
    return empty(204)
  }
}

export default {
  fetch: createHandler({ env: process.env, fetch: (url, init) => fetch(url, init), now: () => new Date(), version: VERSION }),
}
