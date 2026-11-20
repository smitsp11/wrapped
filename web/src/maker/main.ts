import { escapeHtml } from '../slides'
import { api, describeError, type State } from './api'
import { renderHome } from './home'
import { keepAlive } from './keepAlive'
import { renderWrap } from './wrap'

const app = document.querySelector<HTMLElement>('#maker')!
const closeLink = document.querySelector<HTMLButtonElement>('[data-close]')!

/** Bumped on every page change and on close. A page only draws while its number is still the current one. */
let view = 0
let closed = false

/** #/wrap/<id> shows one wrap; anything else is the home page. */
function wrapIdFromHash(): string | null {
  return /^#\/wrap\/([a-z0-9-]+)$/.exec(location.hash)?.[1] ?? null
}

async function start(): Promise<void> {
  if (closed) return
  const mine = ++view
  const isCurrent = () => mine === view
  app.onclick = app.onchange = app.oninput = null
  try {
    const state = await api<State>('/api/state')
    if (!isCurrent()) return
    const id = wrapIdFromHash()
    if (id) await renderWrap(app, state, id, isCurrent)
    else renderHome(app, state)
  } catch (err) {
    if (!isCurrent()) return
    app.innerHTML = `<section class="panel"><h2>Something went wrong</h2><p>${escapeHtml(describeError(err))}</p><p>Go back to the terminal, press q, then type <code>wrapped</code> again.</p></section>`
  }
}

/** The app has stopped: say so, and stop every page from drawing over it. */
function showClosed(): void {
  if (closed) return
  closed = true
  view++
  app.onclick = app.onchange = app.oninput = null
  closeLink.hidden = true
  app.innerHTML = `<section class="panel closed"><h2>iMessage Wrapped is closed.</h2><p>Run <code>wrapped</code> in Terminal to open it again.</p></section>`
}

closeLink.addEventListener('click', async () => {
  if (!confirm('Close iMessage Wrapped? Your wraps stay saved.')) return
  try {
    await api('/api/close', {})
  } catch {
    // Already stopped: the page says closed either way.
  }
  showClosed()
})

window.addEventListener('hashchange', () => void start())
void start()
void keepAlive(showClosed)
