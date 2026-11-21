import fs from 'node:fs'
import path from 'node:path'
import { buildSelection, groupWrapId, soloWrapId, type Selection } from './build'
import type { ConvoMedia } from './convoMedia'
import type { Count } from './count'
import type { Presence } from './presence'
import type { Session } from './session'
import { listWraps, loadWrap } from './store'
import type { Update } from './update'

export type ServerDeps = {
  token: string
  port: number
  site: string
  session: Session
  appDir: string
  webDir: string
  openMessages(link: string): Promise<void>
  /** counts the open pages, to quit after the last one closes */
  presence: Presence
  /** the page's "Close iMessage Wrapped" link */
  onClose(): void
  /** a newer published version, once the background check has found one */
  update(): Update | null
  /** the real photos in the preview's conversations (see convoMedia.ts) */
  media: ConvoMedia
  /** adds one to an anonymous daily tally on the website; never waits (see count.ts) */
  count: Count
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

const MAX_LINK = 16 * 1024
const json = (body: unknown, status = 200) => Response.json(body, { status })
const empty = (status: number) => new Response(null, { status })

function parseSelection(body: unknown): Selection | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (b.kind === 'solo') return { kind: 'solo' }
  if (b.kind === 'groups' && Array.isArray(b.chatIds) && b.chatIds.length > 0 && b.chatIds.every((id) => Number.isInteger(id) && id > 0)) {
    return { kind: 'groups', chatIds: b.chatIds as number[] }
  }
  return null
}

/** Only this machine, only this run: the host must be ours (DNS rebinding) and API calls must carry the run's token. */
export async function handle(req: Request, deps: ServerDeps): Promise<Response> {
  const url = new URL(req.url)
  if (url.host !== `127.0.0.1:${deps.port}` && url.host !== `localhost:${deps.port}`) return empty(403)
  if (!url.pathname.startsWith('/api/')) return serveFile(url.pathname, deps.webDir)
  if (req.headers.get('x-wrapped-token') !== deps.token) return empty(403)

  if (req.method === 'GET' && url.pathname === '/api/state') return json(describe(deps))
  if (req.method === 'GET' && url.pathname === '/api/session') return openPage(req, deps.presence)
  if (req.method === 'POST' && url.pathname === '/api/build') {
    const selection = parseSelection(await req.json().catch(() => null))
    if (!selection) return empty(400)
    const result = buildSelection(deps.session, selection, deps.appDir)
    for (const _ of result.ids) deps.count(selection.kind === 'solo' ? 'wrap_made_solo' : 'wrap_made_group')
    return json(result)
  }
  if (req.method === 'GET' && url.pathname === '/api/wraps') {
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)
    try {
      return json({ wraps: ids.map((id) => ({ id, wrap: loadWrap(deps.appDir, id) })) })
    } catch {
      return empty(404)
    }
  }
  // The maker's preview only: which conversation messages have a photo on this Mac, then each photo by its opaque id.
  if (req.method === 'GET' && url.pathname === '/api/convo-media') {
    const items = deps.media.list(url.searchParams.get('wrap') ?? '')
    return items ? json({ items }) : empty(404)
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/media/')) return deps.media.serve(url.pathname.slice('/api/media/'.length))
  if (req.method === 'POST' && url.pathname === '/api/open-messages') {
    const body = (await req.json().catch(() => null)) as { link?: unknown } | null
    if (typeof body?.link !== 'string' || body.link.length > MAX_LINK || !body.link.startsWith(`${deps.site}/#`)) return empty(400)
    await deps.openMessages(body.link)
    deps.count('send')
    return empty(204)
  }
  if (req.method === 'POST' && url.pathname === '/api/close') {
    deps.onClose()
    return empty(204)
  }
  return empty(404)
}

/** What the home page lists: My year and the group chats, each marked when a saved wrap already exists. */
function describe(deps: ServerDeps) {
  const { period, groups } = deps.session
  const saved = new Set(listWraps(deps.appDir).map((w) => w.id))
  const solo = soloWrapId(period.year)
  return {
    site: deps.site,
    period: { label: period.label, year: period.year },
    solo: { wrapId: solo, made: saved.has(solo) },
    groups: groups.map((g) => {
      const wrapId = groupWrapId(g.title, g.chatIds, period.year)
      return { ...g, wrapId, made: saved.has(wrapId) }
    }),
    // Always the name worked out on this Mac and checked against your chats (senderName.ts): a name saved by an older version's name field is ignored.
    senderName: deps.session.senderName(),
    update: deps.update(),
  }
}

/**
 * The page keeps this request open for as long as it's showing, and the app quits a minute after the last
 * one closes. An open request rather than a heartbeat: browsers slow a hidden tab's timers down to about
 * once a minute, so a heartbeat could lapse while you're over in Messages. A closed tab ends the request at once.
 */
function openPage(req: Request, presence: Presence): Response {
  let ping: ReturnType<typeof setInterval> | undefined
  let open = true
  const close = () => {
    if (!open) return
    open = false
    clearInterval(ping)
    presence.pageClosed()
  }
  presence.pageOpened()
  req.signal.addEventListener('abort', close)
  const byte = new TextEncoder().encode('.')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(byte)
      // A byte every 5 s, so the connection never counts as idle (Bun drops idle ones after 10 s).
      ping = setInterval(() => {
        try {
          controller.enqueue(byte)
        } catch {
          close()
        }
      }, 5_000)
    },
    cancel: close,
  })
  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}

function serveFile(pathname: string, webDir: string): Response {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return empty(400)
  }
  const relative = pathname === '/' ? 'maker.html' : decoded.replace(/^\/+/, '')
  const file = path.resolve(webDir, relative)
  if (!file.startsWith(path.resolve(webDir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return empty(404)
  return new Response(fs.readFileSync(file), { headers: { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' } })
}
