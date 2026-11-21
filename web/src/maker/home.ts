import { updateLine } from '../../../src/app/copy'
import { escapeHtml } from '../slides'
import { api, describeError, type Built, type GroupRow, type State } from './api'

/** Dismissing the update notice lasts until the page is reloaded. */
let updateDismissed = false

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`

/** A few first names: "Alex, Sam, Jordan +2". */
function members(names: string[]): string {
  const shown = names.slice(0, 3).join(', ')
  return names.length > 3 ? `${shown} +${names.length - 3}` : shown
}

function matches(group: GroupRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || [group.title, ...group.memberNames].some((text) => text.toLowerCase().includes(q))
}

/** "What should we wrap?": My year, then every group chat (busiest first) with a search box. One wrap at a time. */
export function renderHome(app: HTMLElement, state: State): void {
  let query = ''
  /** the wrap being made right now; every Wrap it button waits while it runs */
  let making: string | null = null
  let status = ''

  const watch = (wrapId: string) => (location.hash = `#/wrap/${wrapId}`)
  /** `name` labels the buttons for screen readers ("Wrap Chat 1", "Remake Chat 1"); `wrapVerb` is null when the text says it. */
  const action = (wrapId: string, made: boolean, makeLabel: string, data: string, name: string, wrapVerb: string | null) => {
    const disabled = making ? ' disabled' : ''
    const id = escapeHtml(wrapId)
    // A wrap already made can be watched, or remade with the latest messages (and this version of the app): a quiet link.
    if (made) {
      return `<span class="made-actions"><button class="made" data-watch="${id}">Made ✓ · Watch</button>` +
        `<button class="link remake" data-make="${id}" ${data} aria-label="Remake ${escapeHtml(name)}"${disabled}>${making === wrapId ? 'remaking…' : 'remake'}</button></span>`
    }
    const label = wrapVerb ? ` aria-label="${wrapVerb} ${escapeHtml(name)}"` : ''
    return `<button class="button" data-make="${id}" ${data}${label}${disabled}>${making === wrapId ? 'Making…' : makeLabel}</button>`
  }

  app.innerHTML = `
    <section class="panel home">
      <div data-update></div>
      <p class="kicker">iMessage Wrapped · ${escapeHtml(state.period.label)}</p>
      <h2>What should we wrap?</h2>
      <div class="year-card" data-solo></div>
      <h3>Group chats</h3>
      ${
        state.groups.length === 0
          ? `<p>No group chats with messages in ${escapeHtml(state.period.label)}.</p>`
          : `<input class="search" type="search" placeholder="Search your group chats" aria-label="Search your group chats" data-search />`
      }
      <ul class="chats" data-rows></ul>
      <p class="status" role="status" data-status></p>
    </section>`

  const slot = (name: string) => app.querySelector<HTMLElement>(`[data-${name}]`)!

  const drawUpdate = () => {
    const update = updateDismissed ? null : state.update
    slot('update').innerHTML = update
      ? `<p class="update-note">${escapeHtml(updateLine(update))} <button class="link" data-dismiss aria-label="Dismiss the update notice">✕</button></p>`
      : ''
  }

  const draw = () => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.make : undefined
    slot('solo').innerHTML = `
      <div><span class="big">✨ My year</span><span>You and your top 5 people, in one story</span></div>
      ${action(state.solo.wrapId, state.solo.made, 'Make my year', 'data-kind="solo"', 'my year', null)}`
    const shown = state.groups.filter((g) => matches(g, query))
    slot('rows').innerHTML =
      shown.length === 0 && state.groups.length > 0
        ? `<li class="none">No group chats match "${escapeHtml(query.trim())}".</li>`
        : shown
            .map(
              (g) => `
          <li class="chat-row${g.made ? ' is-made' : ''}" data-testid="chat-row">
            <span class="who"><span class="title">${escapeHtml(g.title)}</span><span class="members">${escapeHtml(members(g.memberNames))}</span></span>
            <span class="count">${plural(g.messages, 'message')}</span>
            ${action(g.wrapId, g.made, 'Wrap it', `data-chat="${g.id}"`, g.title, 'Wrap')}
          </li>`,
            )
            .join('')
    slot('status').textContent = status
    if (focused) app.querySelector<HTMLElement>(`[data-make="${CSS.escape(focused)}"]`)?.focus()
  }

  const make = async (button: HTMLElement) => {
    if (making) return
    const wrapId = button.dataset.make!
    const chatId = Number(button.dataset.chat)
    const body = button.dataset.kind === 'solo' ? { kind: 'solo' } : { kind: 'groups', chatIds: [chatId] }
    making = wrapId
    status = ''
    draw()
    try {
      const built = await api<Built>('/api/build', body)
      if (built.ids[0]) return watch(built.ids[0])
      status = built.failed.map((f) => `${f.title}: ${f.message}`).join(' ') || 'Nothing was made.'
    } catch (err) {
      status = describeError(err)
    }
    making = null
    draw()
  }

  app.oninput = (event) => {
    const box = event.target as HTMLInputElement
    if (box.dataset.search === undefined) return
    query = box.value
    draw()
  }
  app.onclick = (event) => {
    const target = event.target as Element
    const makeButton = target.closest<HTMLElement>('[data-make]')
    const watchButton = target.closest<HTMLElement>('[data-watch]')
    if (makeButton) void make(makeButton)
    else if (watchButton) watch(watchButton.dataset.watch!)
    else if (target.closest('[data-dismiss]')) {
      updateDismissed = true
      drawUpdate()
    }
  }
  drawUpdate()
  draw()
}
