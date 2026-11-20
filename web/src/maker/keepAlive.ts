import { headers } from './api'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Holds /api/session open while this page is showing; the app quits a minute after the last page lets go.
 * When the request ends, the app has stopped (q in the terminal, the Close link, or it quit by itself),
 * unless a retry a second later gets through again, e.g. after the Mac slept. Then it calls `onClosed`.
 */
export async function keepAlive(onClosed: () => void): Promise<void> {
  let failures = 0
  while (failures < 2) {
    try {
      const res = await fetch('/api/session', { headers, cache: 'no-store' })
      if (!res.ok || !res.body) throw new Error(`The app answered ${res.status}.`)
      failures = 0
      const reader = res.body.getReader()
      while (!(await reader.read()).done) {
        // The app sends a byte every few seconds; nothing to do with it.
      }
    } catch {
      // The app is gone, or the connection dropped. Counted below.
    }
    failures++
    await wait(1000)
  }
  onClosed()
}
