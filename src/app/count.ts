/**
 * Anonymous daily tallies: when a wrap is made or sent, the app asks the website (site/api/c.ts) to add one to
 * that day's count. The request carries only the event's name: no names, ids, message text or links.
 * WRAPPED_NO_COUNT=1 turns it off, and so does WRAPPED_NO_UPDATE_CHECK=1 (no requests to the website at all).
 * Fire and forget: it never waits, gives up after a few seconds, and any failure is ignored.
 */

export type AppEvent = 'wrap_made_group' | 'wrap_made_solo' | 'send'
export type Count = (event: AppEvent) => void
type Post = (url: string, init: RequestInit) => Promise<Response>

const COUNT_TIMEOUT_MS = 3000

/** True when the person turned counting off (see above). */
export function countingOff(env: NodeJS.ProcessEnv): boolean {
  return env.WRAPPED_NO_COUNT === '1' || env.WRAPPED_NO_UPDATE_CHECK === '1'
}

/** `site` and `post` are the website and fetch; tests pass their own, so no test reaches the network. */
export function counter(site: string, env: NodeJS.ProcessEnv = process.env, post: Post = (url, init) => fetch(url, init)): Count {
  if (countingOff(env)) return () => undefined
  return (event) => {
    try {
      post(`${site}/api/c`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event }),
        signal: AbortSignal.timeout(COUNT_TIMEOUT_MS),
      }).catch(() => undefined)
    } catch {
      // counting never gets in the way
    }
  }
}
