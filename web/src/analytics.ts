/**
 * What the website counts, on wrapped.smitpatel.xyz only (never on localhost or in the maker's preview on 127.0.0.1):
 *  - page views, with Vercel Web Analytics (cookieless). Before each view is sent, the address is replaced with
 *    the site and one of three paths: "/" (the landing page), "/w" (someone opened a wrap link) or "/demo".
 *    The part after the # (the wrap itself) and any ?query are never sent.
 *  - one anonymous tally when the landing page, a wrap link or the demo opens (site/api/c.ts): just the event's name.
 */

export const PRODUCTION_HOST = 'wrapped.smitpatel.xyz'

export type PageKind = 'landing' | 'wrap' | 'demo'

const PATHS: Record<PageKind, string> = { landing: '/', wrap: '/w', demo: '/demo' }
const OPEN_EVENTS: Record<PageKind, string> = { landing: 'landing_visit', wrap: 'link_open', demo: 'demo_open' }

/** "" → the landing page, "#demo" → the demo, any other "#…" → a wrap. Matches loadWrap in main.ts. */
export function pageKind(hash: string): PageKind {
  const body = hash.replace(/^#/, '')
  if (!body) return 'landing'
  return body === 'demo' ? 'demo' : 'wrap'
}

/** The event Vercel's script hands to beforeSend; `url` is the page's full address, # part included. */
export type AnalyticsEvent = { type: 'pageview' | 'event'; url: string }

/**
 * Runs on every event before Vercel's script sends it. Only page views on the real site get through, and
 * their address becomes the site plus one of three fixed paths: nothing from the original path, query or # is kept.
 */
export function beforeSend(event: AnalyticsEvent, hostname: string): AnalyticsEvent | null {
  if (hostname !== PRODUCTION_HOST || event.type !== 'pageview') return null
  let hash: string
  try {
    hash = new URL(event.url).hash
  } catch {
    return null
  }
  return { type: event.type, url: `https://${PRODUCTION_HOST}${PATHS[pageKind(hash)]}` }
}

type VaWindow = Window & { va?: (...args: unknown[]) => void; vaq?: unknown[][] }

let lastViewed: PageKind | null = null
const opened = new Set<PageKind>()

/**
 * Sets up Vercel's script (same origin, /_vercel/insights/script.js) on the real site only. It's told not to
 * track by itself; pageView() below sends each view, so a change from the landing page to the demo counts too.
 */
export function startAnalytics(win: VaWindow = window): void {
  if (win.location.hostname !== PRODUCTION_HOST) return
  // Vercel's documented queue: calls made before the script loads are replayed once it does.
  win.va = win.va ?? ((...args: unknown[]) => void (win.vaq = win.vaq ?? []).push(args))
  win.va('beforeSend', (event: AnalyticsEvent) => beforeSend(event, win.location.hostname))
  const script = win.document.createElement('script')
  script.defer = true
  script.src = '/_vercel/insights/script.js'
  script.dataset.disableAutoTrack = '1'
  win.document.head.appendChild(script)
}

/** A page view, once each time the kind of page changes (a second wrap in the same tab isn't a new view). */
export function pageView(kind: PageKind, win: VaWindow = window): void {
  if (win.location.hostname !== PRODUCTION_HOST || kind === lastViewed) return
  lastViewed = kind
  // The script ignores a pageview call without an options object.
  win.va?.('pageview', {})
}

/** The landing page, a wrap link or the demo opened: one tally of its name, at most once per kind per page load. */
export function countOpen(kind: PageKind, win: Window = window): void {
  const event = OPEN_EVENTS[kind]
  if (win.location.hostname !== PRODUCTION_HOST || opened.has(kind)) return
  opened.add(kind)
  try {
    // A plain-text body: same origin, no preflight, and nothing but the event's name.
    win.navigator.sendBeacon('/api/c', JSON.stringify({ event }))
  } catch {
    // Counting never gets in the way of the wrap.
  }
}
