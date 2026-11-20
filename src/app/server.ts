import fs from 'node:fs'
import path from 'node:path'
import { buildSelection, type Selection } from './build'
import type { Session } from './session'
import { loadWrap } from './store'

export type ServerDeps = {
  token: string
  port: number
  site: string
  /** "pick": picker B first. "wraps": straight to the Your wraps page with `ids`. */
  mode: 'pick' | 'wraps'
  ids: string[]
  /** null when showing saved wraps without opening the Messages database */
  session: Session | null
  appDir: string
  webDir: string
  openMessages(link: string): Promise<void>
  onDone(): void
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

  if (req.method === 'GET' && url.pathname === '/api/state') {
    const s = deps.session
    return json({
      mode: deps.mode, site: deps.site, ids: deps.ids,
      period: s ? { label: s.period.label, year: s.period.year } : null,
      groups: s ? s.groups : [],
    })
  }
  if (req.method === 'POST' && url.pathname === '/api/build') {
    if (!deps.session) return empty(409)
    const selection = parseSelection(await req.json().catch(() => null))
    if (!selection) return empty(400)
    return json(buildSelection(deps.session, selection, deps.appDir))
  }
  if (req.method === 'GET' && url.pathname === '/api/wraps') {
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean)
    try {
      return json({ wraps: ids.map((id) => ({ id, wrap: loadWrap(deps.appDir, id) })) })
    } catch {
      return empty(404)
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/open-messages') {
    const body = (await req.json().catch(() => null)) as { link?: unknown } | null
    if (typeof body?.link !== 'string' || body.link.length > MAX_LINK || !body.link.startsWith(`${deps.site}/#`)) return empty(400)
    await deps.openMessages(body.link)
    return empty(204)
  }
  if (req.method === 'POST' && url.pathname === '/api/done') {
    deps.onDone()
    return empty(204)
  }
  return empty(404)
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
