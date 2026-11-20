/** `?t=` on first load, then sessionStorage so a reload still works. */
function readToken(): string {
  const fromUrl = new URLSearchParams(location.search).get('t')
  try {
    if (fromUrl) sessionStorage.setItem('wrapped-t', fromUrl)
    return fromUrl ?? sessionStorage.getItem('wrapped-t') ?? ''
  } catch {
    return fromUrl ?? ''
  }
}
const token = readToken()
// Keep the token out of the address bar (history, screenshots, shared links).
history.replaceState(null, '', location.pathname + location.hash)

/** A group chat on the home page. `wrapId` is the saved wrap it makes; `made` when that wrap already exists. */
export type GroupRow = { id: number; title: string; messages: number; memberNames: string[]; wrapId: string; made: boolean }
export type State = {
  site: string
  period: { label: string; year: number }
  solo: { wrapId: string; made: boolean }
  groups: GroupRow[]
  /** what to call "You" in shared group wraps, from your own contact card; '' keeps "You" */
  senderName: string
  update: { current: string; latest: string } | null
}
export type Built = { ids: string[]; failed: { title: string; message: string }[] }

/** Every call carries this run's token; the local server refuses anything without it. */
export const headers = { 'x-wrapped-token': token, 'content-type': 'application/json' }

export async function api<T>(pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(pathname, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`The app answered ${res.status}.`)
  return (res.status === 204 ? undefined : await res.json()) as T
}

export function describeError(err: unknown): string {
  if (err instanceof TypeError) return "The app isn't running any more."
  return err instanceof Error ? err.message : String(err)
}
