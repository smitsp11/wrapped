import { TOP_GROUPS } from '../../../src/app/chats'
import { escapeHtml } from '../slides'
import { api, describeError, type State } from './api'

type Built = { ids: string[]; failed: { title: string; message: string }[] }

export function renderPick(app: HTMLElement, state: State, onBuilt: (ids: string[]) => void): void {
  let showAll = false
  const picked = new Set<number>()
  let status = ''
  let busy = false

  /** The selector of the control that has focus, so it can be refocused after the rewrite. */
  const focusKey = (): string | null => {
    const el = document.activeElement
    if (!(el instanceof HTMLElement) || !app.contains(el)) return null
    if (el.dataset.chat) return `input[data-chat="${el.dataset.chat}"]`
    for (const key of ['data-make', 'data-solo']) if (el.hasAttribute(key)) return `[${key}]`
    return null
  }

  const draw = (focus: string | null = focusKey()) => {
    const shown = showAll ? state.groups : state.groups.slice(0, TOP_GROUPS)
    const n = picked.size
    app.innerHTML = `
      <section class="panel">
        <p class="kicker">iMessage Wrapped · ${escapeHtml(state.period?.label ?? '')}</p>
        <button class="card mode" data-solo${busy ? ' disabled' : ''}><span class="big">✨ My year</span><span>you + your top 5 people</span></button>
        <h2>👥 Group chats</h2>
        ${state.groups.length === 0 ? `<p>No group chats with messages in ${escapeHtml(state.period?.label ?? 'this period')}.</p>` : ''}
        <div class="grid">
          ${shown
            .map(
              (g) => `
            <label class="card chat${picked.has(g.id) ? ' on' : ''}" data-testid="chat-card">
              <input type="checkbox" data-chat="${g.id}"${picked.has(g.id) ? ' checked' : ''} />
              <span class="title">${escapeHtml(g.title)}</span>
              <span>${g.messages.toLocaleString('en-US')} msgs</span>
              <span class="members">${escapeHtml(g.memberNames.join(' · '))}</span>
            </label>`,
            )
            .join('')}
        </div>
        ${!showAll && state.groups.length > TOP_GROUPS ? `<button class="link" data-all>See all ${state.groups.length} →</button>` : ''}
        <button class="button" data-make${n === 0 || busy ? ' disabled' : ''}>Make ${n} wrap${n === 1 ? '' : 's'}</button>
        <p class="status" role="status">${escapeHtml(status)}</p>
      </section>`
    if (focus) app.querySelector<HTMLElement>(focus)?.focus()
  }

  const build = async (body: unknown, label: string) => {
    if (busy) return
    busy = true
    status = `Making ${label}…`
    draw()
    try {
      const built = await api<Built>('/api/build', body)
      if (built.ids.length > 0) return onBuilt(built.ids)
      status = built.failed.map((f) => `${f.title}: ${f.message}`).join(' ') || 'Nothing was made.'
    } catch (err) {
      status = describeError(err)
    }
    busy = false
    draw()
  }

  app.onchange = (event) => {
    const box = (event.target as Element).closest<HTMLInputElement>('input[data-chat]')
    if (!box) return
    const id = Number(box.dataset.chat)
    if (box.checked) picked.add(id)
    else picked.delete(id)
    draw()
  }
  app.onclick = (event) => {
    const target = event.target as Element
    if (target.closest('[data-all]')) {
      showAll = true
      draw(`input[data-chat="${state.groups[TOP_GROUPS]?.id}"]`)
    } else if (target.closest('[data-solo]')) {
      void build({ kind: 'solo' }, 'your year')
    } else if (target.closest('[data-make]')) {
      void build({ kind: 'groups', chatIds: [...picked] }, `${picked.size} wrap${picked.size === 1 ? '' : 's'}`)
    }
  }
  draw()
}
