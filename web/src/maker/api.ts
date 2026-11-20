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

export type GroupCard = { id: number; title: string; messages: number; memberNames: string[] }
export type State = {
  mode: 'pick' | 'wraps'
  site: string
  period: { label: string; year: number } | null
  groups: GroupCard[]
  ids: string[]
}

/** Every call carries this run's token; the local server refuses anything without it. */
export async function api<T>(pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(pathname, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-wrapped-token': token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`The app answered ${res.status}.`)
  return (res.status === 204 ? undefined : await res.json()) as T
}

export function describeError(err: unknown): string {
  if (err instanceof TypeError) return "The app isn't running any more."
  return err instanceof Error ? err.message : String(err)
}
