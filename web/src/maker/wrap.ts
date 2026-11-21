import { fitToLimit } from '../../../src/share/pack'
import { withSenderName } from '../../../src/share/senderName'
import { OTHERS_ID, type Wrap } from '../../../src/types'
import { escapeHtml } from '../slides'
import { api, describeError, type State } from './api'
import { loadLocalPreview } from './localPreview'
import { mountPost } from './post'
import { withoutContactInfo } from '../../../src/share/quotes'

type Loaded = { id: string; wrap: Wrap }
/** Whether the link reached the clipboard, and why Messages didn't open (if it didn't). */
type Sent = { copied: boolean; error: string | null }

/** "302 messages · 5 people" for a group; just the messages for My year, whose people are a top 5 and "Everyone else". */
function facts(wrap: Wrap): string {
  const total = wrap.volume.total
  const messages = `${total.toLocaleString('en-US')} ${total === 1 ? 'message' : 'messages'}`
  if (wrap.mode !== 'group') return messages
  const people = Object.keys(wrap.people).filter((id) => id !== OTHERS_ID).length
  return `${messages} · ${people} ${people === 1 ? 'person' : 'people'}`
}

/**
 * One wrap: the phone preview, and beside it the title and one Send button. After sending a group wrap, a small
 * "Bonus" button offers the card about your own year; My year shows that card straight away.
 * On a phone they stack: title, preview, Send. The link holds the whole
 * wrap, less any quote that looks like a phone number or email, and the preview plays that same link.
 * `isCurrent` turns false once the user has moved on, so a slow pack never paints over the next page.
 */
export async function renderWrap(app: HTMLElement, state: State, id: string, isCurrent: () => boolean): Promise<void> {
  const { wraps } = await api<{ wraps: Loaded[] }>(`/api/wraps?ids=${encodeURIComponent(id)}`)
  if (!isCurrent()) return
  const wrap = wraps[0]?.wrap
  if (!wrap) {
    app.innerHTML = '<section class="panel"><p>No wrap to show.</p><a class="link" href="#/">← All chats</a></section>'
    return
  }
  const group = wrap.mode === 'group'
  /** set once the link is packed; Send waits for it */
  let link: string | null = null
  let sending = false

  app.innerHTML = `
    <section class="panel" data-wrap="${escapeHtml(id)}">
      <a class="link back" href="#/">← All chats</a>
      <div class="wrap-page">
        <div class="wrap-head">
          <p class="kicker">${group ? 'Group chat' : 'My year'} · ${escapeHtml(state.period.label)}</p>
          <h2 tabindex="-1" data-heading>${escapeHtml(wrap.title)}</h2>
          <p class="facts">${escapeHtml(facts(wrap))}</p>
        </div>
        <iframe class="phone" title="Preview of ${escapeHtml(wrap.title)}"></iframe>
        <div class="send-column">
          <button class="button send" data-send disabled>${group ? 'Send to group chat' : 'Send in Messages'}</button>
          <p class="sent-note" role="status" data-sent></p>
          <p class="warn" role="alert" data-error></p>
          <div data-post hidden></div>
        </div>
      </div>
    </section>`
  const slot = <T extends HTMLElement = HTMLElement>(name: string) => app.querySelector<T>(`[data-${name}]`)!
  const sendButton = slot<HTMLButtonElement>('send')
  // The focus ring on the preview (see .phone.focused): this page loses focus to it, then gets it back.
  const frame = app.querySelector<HTMLIFrameElement>('iframe.phone')!
  window.onblur = () => setTimeout(() => frame.classList.toggle('focused', document.activeElement === frame))
  window.onfocus = () => frame.classList.remove('focused')

  /** The line under the button after a send. */
  const drawSent = ({ copied, error }: Sent) => {
    const note = slot('sent')
    const where = group ? 'pick your group and send' : 'pick who to send it to'
    if (error) note.innerHTML = escapeHtml(`${copied ? 'Link copied, but ' : ''}Messages didn't open: ${error}`)
    else if (copied) note.innerHTML = `<span class="check" aria-hidden="true">✓</span> Link copied · Messages is open, ${where}`
    else note.innerHTML = escapeHtml(`Couldn't copy the link: the browser blocked the clipboard. Messages is open with the link typed in, ${where}.`)
  }

  const send = async () => {
    if (sending || !link) return
    sending = true
    sendButton.disabled = true
    const outgoing = link
    // Copy first, while the click still counts as the user's: once Messages opens, the page loses focus.
    let copied = true
    try {
      await navigator.clipboard.writeText(outgoing)
    } catch {
      copied = false
    }
    let error: string | null = null
    try {
      await api('/api/open-messages', { link: outgoing })
    } catch (err) {
      error = describeError(err)
    }
    sending = false
    if (!isCurrent()) return
    sendButton.disabled = false
    sendButton.focus()
    drawSent({ copied, error })
    showPost()
  }

  const showPost = () => {
    const post = slot('post')
    if (!post.hidden) return
    post.hidden = false
    // My year is already made, so its card shows. After a group wrap, the card (which may build My year first) is a bonus
    // you ask for: nothing is built until you click.
    if (!group) {
      mountPost(post, state, isCurrent)
      return
    }
    post.innerHTML = '<button class="link bonus" data-bonus>Bonus: make a card about your own year →</button>'
    post.querySelector<HTMLButtonElement>('[data-bonus]')!.addEventListener('click', () => mountPost(post, state, isCurrent, true), { once: true })
  }

  app.onclick = (event) => {
    if ((event.target as Element).closest('[data-send]')) void send()
  }

  // My year has no group to send to first, so its share card shows straight away.
  if (!group) showPost()

  // Packed once: what's in the link never changes on this page.
  try {
    const [{ packed }, local] = await Promise.all([
      fitToLimit(withSenderName(withoutContactInfo(wrap), state.senderName)),
      loadLocalPreview(id),
    ])
    if (!isCurrent()) return
    link = `${state.site}/#${packed}`
    // Your own photos, for the preview on this Mac only: the frame reads them from here (see LocalPreview in
    // convo.ts). The link never has them.
    window.wrappedLocalPreview = { packed, ...local }
    app.querySelector('iframe.phone')!.setAttribute('src', `/index.html#${packed}`)
    sendButton.disabled = false
  } catch (err) {
    if (!isCurrent()) return
    slot('error').textContent = `${describeError(err)} This wrap can't be sent.`
  }
  slot('heading').focus()
}
