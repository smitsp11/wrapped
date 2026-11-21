import type { Convo, ConvoMessage, Hit } from '../../src/stats/greatestHits'
import type { Wrap } from '../../src/types'
import { firstName, shortNames } from '../../src/wrap/names'
import { escapeHtml } from './slides'

/**
 * "What was the convo?": tapping a greatest hit opens the conversation it was sent in, as a chat screenshot taped to
 * the page. The hit is lifted out of the thread (bigger, raised, its reactions floating above it) while the rest stays
 * visible behind it, dimmed. A tap settles it so the whole thread reads and scrolls.
 */

/**
 * The maker's preview on your own Mac only: the real photo for message `message` in the conversation behind the link's
 * quote `hit`, as an image URL once it has loaded, or null to keep "📷 Photo".
 */
export type MediaFor = (hit: number, message: number) => Promise<string> | null

/**
 * What the maker's preview adds, on your own Mac only: your photos. The maker sets it on its own window before it
 * loads the preview frame, which reads it from its parent for the link `packed` only (main.ts). The public site never
 * sets it, so a shared link shows "📷 Photo" placeholders.
 */
export type LocalPreview = { packed: string; mediaFor: MediaFor | null }

declare global {
  interface Window {
    wrappedLocalPreview?: LocalPreview
  }
}

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
/** A press that moves further than this is a drag, not a tap. */
const DRAG_SLOP_PX = 10

/** A sender's full name: a My year conversation names the senders who aren't among the wrap's people itself. */
function fullName(wrap: Wrap, convo: Convo, id: string): string {
  if (convo.people && Object.hasOwn(convo.people, id)) return convo.people[id]!
  return Object.hasOwn(wrap.people, id) ? wrap.people[id]! : 'Someone'
}

/** Each sender's first name, or "Alex C." / "Alex K." when two in the conversation share one (see shortNames). */
function senderNames(wrap: Wrap, convo: Convo): Map<string, string> {
  const ids = [...new Set(convo.messages.map((m) => m.senderId))]
  const short = shortNames(ids.map((id) => ({ full: fullName(wrap, convo, id), short: firstName(fullName(wrap, convo, id)) })))
  return new Map(ids.map((id, i) => [id, short[i]!]))
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
  const n = (count: number) => count.toLocaleString('en-US')
  const parts = [laughs > 0 ? `😂 ×${n(laughs)}` : '', hearts > 0 ? `❤️ ×${n(hearts)}` : '', rest > 0 ? `+${n(rest)}` : '']
  return parts.filter(Boolean).join(' ')
}

/**
 * The dialog's markup. Pure (no DOM), so it's unit-tested. `photos` (the maker's preview only): the messages that get a
 * photo frame, in place of "📷 Photo" or, for a text sent with a photo, above the text like Messages shows it.
 * openConvo puts the image in the frame once it loads.
 */
export function convoHtml(wrap: Wrap, hit: Hit, photos: ReadonlySet<number> = new Set()): string {
  const convo = hit.conversation
  if (!convo) return ''
  const items: string[] = []
  const names = senderNames(wrap, convo)
  convo.messages.forEach((m, i) => {
    const previous = convo.messages[i - 1]
    const gap = previous ? Date.parse(m.sentAt) - Date.parse(previous.sentAt) : 0
    if (gap >= TIME_GAP_MS) items.push(`<li class="when">${escapeHtml(timeOnly(m.sentAt))}</li>`)
    // A name over the first message of each run, like a group chat.
    const runStarts = !previous || previous.senderId !== m.senderId || gap >= TIME_GAP_MS
    const side = m.senderId === 'me' ? 'mine' : 'theirs'
    const isHit = i === convo.hit
    const reactions = reactionSummary(m)
    const withPhoto = photos.has(i) && (m.media === 'photo' || !m.media)
    const frame = `<div class="bubble photo${m.media ? '' : ' above'}" data-photo="${i}"><span class="photo-label">${MEDIA_LABELS.photo}</span></div>`
    const body = m.media
      ? withPhoto
        ? frame
        : `<p class="bubble media">${MEDIA_LABELS[m.media]}</p>`
      : `${withPhoto ? frame : ''}<p class="bubble">${escapeHtml(m.text)}</p>`
    items.push(
      `<li class="msg ${side}${isHit ? ' hit' : ''}"${isHit ? ' data-hit' : ''}>` +
        (runStarts ? `<span class="who">${escapeHtml(names.get(m.senderId)!)}</span>` : '') +
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
          <b>${escapeHtml(convo.title ?? wrap.title)}</b>
          <time datetime="${escapeHtml(first.sentAt)}">${escapeHtml(dayAndTime(first.sentAt))}</time>
        </header>
        <ol class="thread" tabindex="0" aria-label="Messages">${items.join('')}</ol>
      </div>
      <p class="convo-hint" aria-hidden="true"><span class="when-lifted">tap to read the whole thread</span><span class="when-settled">tap the quote to lift it again</span></p>
    </div>`
}

/**
 * Puts the photo in its frame once it has loaded. The frame keeps its size the whole time, so the thread doesn't jump.
 * If it can't be loaded or shown, the frame becomes the usual "📷 Photo", or goes away above a text.
 */
function showPhoto(frame: HTMLElement, photo: Promise<string>): void {
  const placeholder = () => {
    if (frame.classList.contains('above')) {
      frame.remove()
      return
    }
    const p = document.createElement('p')
    p.className = 'bubble media'
    p.textContent = MEDIA_LABELS.photo
    frame.replaceWith(p)
  }
  photo.then((src) => {
    const img = document.createElement('img')
    img.alt = 'Photo'
    img.loading = 'lazy'
    img.decoding = 'async'
    img.draggable = false
    img.onload = () => frame.classList.add('loaded')
    img.onerror = placeholder
    img.src = src
    frame.append(img)
  }, placeholder)
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
 * `photoFor` (the maker's preview only, see MediaFor) gives a message sent with a photo its real photo.
 */
export function openConvo(
  wrap: Wrap,
  hit: Hit,
  app: HTMLElement,
  opener: HTMLElement,
  photoFor?: (message: number) => Promise<string> | null,
): void {
  closeConvo()
  const photos = new Map<number, Promise<string>>()
  hit.conversation?.messages.forEach((m, i) => {
    const photo = m.media === 'photo' || !m.media ? photoFor?.(i) : null
    if (photo) photos.set(i, photo)
  })
  const dialog = document.createElement('div')
  dialog.className = 'convo'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'convo-title')
  dialog.dataset.testid = 'convo'
  dialog.innerHTML = convoHtml(wrap, hit, new Set(photos.keys()))
  document.body.append(dialog)
  app.inert = true
  for (const [i, photo] of photos) showPhoto(dialog.querySelector<HTMLElement>(`[data-photo="${i}"]`)!, photo)

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

  // Back, or a tap outside the chat card (the dimmed desk on a wide screen, the page around the card on a phone), closes;
  // a tap on the card settles the hit, or lifts it again. The hint under the card keeps it open, since it says to tap.
  // Taps stop here, so the story underneath never sees them and never flips the page.
  // Swiping the page down closes it, like a sheet; it follows the finger and springs back if the swipe is short.
  // In the settled thread a drag scrolls the thread instead (see touch-action in styles.css).
  const sheet = dialog.querySelector<HTMLElement>('.convo-sheet')!
  let swipe: { x: number; y: number } | null = null
  let swiped = false
  /** The last press moved (a short swipe that sprang back), so the click it ends with is no tap. */
  let dragged = false
  sheet.addEventListener('pointerdown', (event) => {
    swipe = { x: event.clientX, y: event.clientY }
    dragged = false
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
    dragged = Math.hypot(down, across) > DRAG_SLOP_PX
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
    if (swiped || dragged) return
    const target = event.target as Element
    if (target.closest('[data-convo-close]') || !target.closest('.shot, .convo-hint')) close()
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
