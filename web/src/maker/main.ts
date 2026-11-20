import { escapeHtml } from '../slides'
import { api, describeError, type State } from './api'
import { renderPick } from './pick'
import { renderWraps } from './wraps'

const app = document.querySelector<HTMLElement>('#maker')!

function idsFromHash(): string[] | null {
  if (!location.hash.startsWith('#/wraps')) return null
  return new URLSearchParams(location.hash.split('?')[1] ?? '').get('ids')?.split(',').filter(Boolean) ?? []
}

async function start(): Promise<void> {
  app.onclick = app.onchange = null
  try {
    const state = await api<State>('/api/state')
    const ids = idsFromHash() ?? (state.mode === 'wraps' ? state.ids : null)
    if (ids) await renderWraps(app, state, ids)
    else renderPick(app, state, (built) => (location.hash = `#/wraps?ids=${built.join(',')}`))
  } catch (err) {
    app.innerHTML = `<section class="panel"><h2>Something went wrong</h2><p>${escapeHtml(describeError(err))}</p><p>Go back to the terminal, press Ctrl-C, then run <code>wrapped</code> again.</p></section>`
  }
}

window.addEventListener('hashchange', () => void start())
void start()
