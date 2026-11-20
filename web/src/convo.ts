import type { ConvoMessage, Hit } from '../../src/stats/greatestHits'
import type { Wrap } from '../../src/types'
import { firstName } from '../../src/wrap/names'
import { escapeHtml } from './slides'

/**
 * "What was the convo?": tapping a greatest hit opens the conversation it was sent in, as a chat screenshot taped to
 * the page. The hit is lifted out of the thread (bigger, raised, its reactions floating above it) while the rest stays
 * visible behind it, dimmed. A tap settles it so the whole thread reads and scrolls.
 */

const MEDIA_LABELS: Record<NonNullable<ConvoMessage['media']>, string> = {
  photo: '📷 Photo',
  video: '🎥 Video',
  attachment: '📎 Attachment',
}
/** A gap this long between two messages gets the time written between them, like a chat app does. */
const TIME_GAP_MS = 60 * 60_000
/** How long the thread shows on its own before the hit lifts out. */
const LIFT_DELAY_MS = 450
/** A swipe down at least this far closes the conversation. */
const SWIPE_CLOSE_PX = 90

function personFirstName(wrap: Wrap, id: string): string {
  return Object.hasOwn(wrap.people, id) ? firstName(wrap.people[id]!) : 'Someone'
}

/** "Mon, Jan 12, 6:30 PM", in the viewer's time zone. */
function dayAndTime(sentAt: string): string {
  return new Date(sentAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function timeOnly(sentAt: string): string {
  return new Date(sentAt).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "😂 ×4 ❤️ ×1 +2": laughs, hearts, then any other reactions. Empty when nobody reacted. */
export function reactionSummary(m: ConvoMessage): string {
  const laughs = m.laughs ?? 0
  const hearts = m.hearts ?? 0
  const rest = Math.max(0, (m.reactions ?? 0) - laughs - hearts)
  const parts = [laughs > 0 ? `😂 ×${laughs}` : '', hearts > 0 ? `❤️ ×${hearts}` : '', rest > 0 ? `+${rest}` : '']
  return parts.filter(Boolean).join(' ')
}

/** The dialog's markup. Pure (no DOM), so it's unit-tested. */
export function convoHtml(wrap: Wrap, hit: Hit): string {
  const convo = hit.conversation
  if (!convo) return ''
  const items: string[] = []
  convo.messages.forEach((m, i) => {
    const previous = convo.messages[i - 1]
    const gap = previous ? Date.parse(m.sentAt) - Date.parse(previous.sentAt) : 0
    if (gap >= TIME_GAP_MS) items.push(`<li class="when">${escapeHtml(timeOnly(m.sentAt))}</li>`)
    // A name over the first message of each run, like a group chat.
    const runStarts = !previous || previous.senderId !== m.senderId || gap >= TIME_GAP_MS
    const side = m.senderId === 'me' ? 'mine' : 'theirs'
    const isHit = i === convo.hit
    const reactions = reactionSummary(m)
    const body = m.media
      ? `<p class="bubble media">${MEDIA_LABELS[m.media]}</p>`
      : `<p class="bubble">${escapeHtml(m.text)}</p>`
    items.push(
      `<li class="msg ${side}${isHit ? ' hit' : ''}"${isHit ? ' data-hit' : ''}>` +
        (runStarts ? `<span class="who">${escapeHtml(personFirstName(wrap, m.senderId))}</span>` : '') +
        `<div class="bubble-wrap">${body}${reactions ? `<span class="tapback">${escapeHtml(reactions)}</span>` : ''}</div></li>`,
    )
  })
  const first = convo.messages[0]!
  return `<div class="convo-sheet">
      <div class="convo-top">
        <button type="button" class="convo-back" data-convo-close>← back to the wrap</button>
      </div>
      <h2 class="convo-title" id="convo-title">what was the convo?</h2>
      <div class="shot">
        <header class="shot-top">
          <b>${escapeHtml(wrap.title)}</b>
          <time datetime="${escapeHtml(first.sentAt)}">${escapeHtml(dayAndTime(first.sentAt))}</time>
        </header>
        <ol class="thread" tabindex="0" aria-label="Messages">${items.join('')}</ol>
      </div>
      <p class="convo-hint" aria-hidden="true"><span class="when-lifted">tap to read the whole thread</span><span class="when-settled">tap the quote to lift it again</span></p>
    </div>`
}

let open: { close: () => void } | null = null

export function isConvoOpen(): boolean {
  return open !== null
}

/** Closes the dialog if it's open, and puts focus back on what opened it. */
export function closeConvo(): void {
  open?.close()
}

/**
 * Opens the conversation for `hit` over the slides. `app` is made inert while it's open, so focus and taps stay in the
 * dialog; `opener` gets focus back when it closes. Escape is handled with the story's other keys, in main.ts.
 */
export function openConvo(wrap: Wrap, hit: Hit, app: HTMLElement, opener: HTMLElement): void {
  closeConvo()
  const dialog = document.createElement('div')
  dialog.className = 'convo'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'convo-title')
  dialog.dataset.testid = 'convo'
  dialog.innerHTML = convoHtml(wrap, hit)
  document.body.append(dialog)
  app.inert = true

  const thread = dialog.querySelector<HTMLElement>('.thread')!
  const lifted = dialog.querySelector<HTMLElement>('[data-hit]')!
  // The thread shows first, already scrolled so the hit sits in the middle.
  thread.scrollTop = lifted.offsetTop - (thread.clientHeight - lifted.offsetHeight) / 2
  const lift = () => (dialog.dataset.state = 'lifted')
  const settle = () => (dialog.dataset.state = 'settled')
  // With reduced motion it's lifted straight away, and the CSS turns off the lift's transition.
  let timer = 0
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) lift()
  else timer = window.setTimeout(lift, LIFT_DELAY_MS)

  // Back (or a tap outside the page, on a wide screen) closes; any other tap settles the hit, or lifts it again.
  // Taps stop here, so the story underneath never sees them and never flips the page.
  // Swiping the page down closes it, like a sheet; it follows the finger and springs back if the swipe is short.
  // In the settled thread a drag scrolls the thread instead (see touch-action in styles.css).
  const sheet = dialog.querySelector<HTMLElement>('.convo-sheet')!
  let swipe: { x: number; y: number } | null = null
  let swiped = false
  sheet.addEventListener('pointerdown', (event) => {
    swipe = { x: event.clientX, y: event.clientY }
  })
  sheet.addEventListener('pointermove', (event) => {
    if (!swipe) return
    const down = Math.max(0, event.clientY - swipe.y)
    sheet.style.transition = 'none'
    sheet.style.transform = down > 0 ? `translateY(${down}px)` : ''
  })
  const endSwipe = (event: PointerEvent) => {
    if (!swipe) return
    const down = event.clientY - swipe.y
    const across = Math.abs(event.clientX - swipe.x)
    swipe = null
    sheet.style.transition = ''
    sheet.style.transform = ''
    if (event.type === 'pointerup' && down >= SWIPE_CLOSE_PX && down > across * 2) {
      swiped = true
      window.setTimeout(close) // after the click that may follow this pointerup, which is then ignored
    }
  }
  sheet.addEventListener('pointerup', endSwipe)
  sheet.addEventListener('pointercancel', endSwipe)

  dialog.addEventListener('click', (event) => {
    event.stopPropagation()
    if (swiped) return
    const target = event.target as Element
    if (target.closest('[data-convo-close]') || !target.closest('.convo-sheet')) close()
    else if (dialog.dataset.state === 'lifted') settle()
    else if (target.closest('[data-hit]')) lift()
  })

  function close(): void {
    window.clearTimeout(timer)
    dialog.remove()
    app.inert = false
    open = null
    opener.focus()
  }
  open = { close }
  dialog.querySelector<HTMLElement>('[data-convo-close]')!.focus()
}
