import { fitToLimit } from '../../../src/share/pack'
import { withSenderName } from '../../../src/share/senderName'
import type { Wrap } from '../../../src/types'
import { escapeHtml } from '../slides'
import { api, describeError, type State } from './api'
import { coverLines, drawCover } from './cover'
import { mountPost } from './post'
import { applyReview, initialReview } from './review'

type Loaded = { id: string; wrap: Wrap }
/** The link last sent, whether it reached the clipboard, and why Messages didn't open (if it didn't). */
type Sent = { link: string; copied: boolean; error: string | null }

const COPY_IMAGE_FAILED = "Couldn't copy the image. Drag it into Messages, or right-click it and choose Copy Image."

/**
 * One wrap: the phone preview, one Send button, a one-line summary of what's in the link (Change opens the
 * tick boxes), and after sending, "Now post yours". `isCurrent` turns false once the user has moved on,
 * so a slow redraw never paints over the next page.
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
  const review = initialReview(wrap)
  const flagged = initialReview(wrap).droppedHits
  let expanded = false
  let link: string | null = null
  /** quotes the last pack had to leave out to keep the link short enough */
  let dropped: Wrap['greatestHits'] = []
  let sent: Sent | null = null
  let sending = false
  let renderId = 0
  /** "You" in the shared link becomes this name (group wraps only; '' keeps "You"). Remembered on this Mac. */
  let senderName = state.senderName
  const shared = (w: Wrap) => withSenderName(w, senderName)

  app.innerHTML = `
    <section class="panel" data-wrap="${escapeHtml(id)}">
      <a class="link back" href="#/">← All chats</a>
      <p class="kicker">${group ? 'Group chat' : 'My year'} · ${escapeHtml(state.period.label)}</p>
      <h2 tabindex="-1" data-heading>${escapeHtml(wrap.title)}</h2>
      <div class="wrap-page">
        <iframe class="phone" title="Preview of ${escapeHtml(wrap.title)}"></iframe>
        <div class="send-column">
          ${
            group
              ? `<label class="sender-name">Your name in the wrap <input data-sender-name value="${escapeHtml(senderName)}" maxlength="40" placeholder="You" autocomplete="given-name" /></label>`
              : ''
          }
          <button class="button send" data-send disabled>${group ? 'Send to group chat' : 'Send in Messages'}</button>
          <p class="sent-note" role="status" data-sent></p>
          <p class="warn" role="alert" data-error></p>
          <div class="cover-row">
            <img class="cover" data-cover alt="Cover image for ${escapeHtml(wrap.title)}" />
            <div>
              <button class="link small" data-copy-cover>Copy cover image</button>
              <p class="hint">Paste it into the message, above the link.</p>
              <p class="status" role="status" data-cover-status></p>
            </div>
          </div>
          <div class="includes" data-includes></div>
        </div>
      </div>
      <div data-post hidden></div>
    </section>`
  const slot = <T extends HTMLElement = HTMLElement>(name: string) => app.querySelector<T>(`[data-${name}]`)!
  const frame = app.querySelector<HTMLIFrameElement>('iframe.phone')!
  const sendButton = slot<HTMLButtonElement>('send')

  // Drawn off screen and shown as an image, so dragging it and right-click Copy Image work in every browser.
  const coverCanvas = document.createElement('canvas')
  let coverDrawn: Promise<void> = Promise.resolve()
  const drawCoverImage = () => {
    coverDrawn = drawCover(coverCanvas, coverLines(shared(wrap)))
    const drawn = coverDrawn
    void drawn.then(() => {
      if (isCurrent() && drawn === coverDrawn) slot<HTMLImageElement>('cover').src = coverCanvas.toDataURL('image/png')
    })
  }
  drawCoverImage()

  /** The send line under the button. */
  const drawSent = () => {
    const note = slot('sent')
    const where = group ? 'pick your group and send' : 'pick who to send it to'
    if (!sent) note.innerHTML = ''
    else if (sent.link !== link) note.innerHTML = '<span class="warn">The link changed. Send it again.</span>'
    else if (sent.error) note.innerHTML = escapeHtml(`${sent.copied ? 'Link copied, but ' : ''}Messages didn't open: ${sent.error}`)
    else if (sent.copied) note.innerHTML = `<span class="check" aria-hidden="true">✓</span> Link copied · Messages is open, ${where}`
    else note.innerHTML = escapeHtml(`Couldn't copy the link: the browser blocked the clipboard. Messages is open with the link typed in, ${where}.`)
  }

  /** The repack still running, if any: Send waits for it, so it never sends a link from before the last change. */
  let updating: Promise<void> | null = null
  const update = () => {
    const run = repack()
    updating = run
    void run.finally(() => {
      if (updating === run) updating = null
    })
    return run
  }

  /** Repacks the link after a tick or the name changes, then updates the preview, the summary line and the tick boxes. */
  const repack = async () => {
    const mine = ++renderId
    let fitted: Awaited<ReturnType<typeof fitToLimit>>
    try {
      fitted = await fitToLimit(shared(applyReview(wrap, review)))
    } catch (err) {
      if (mine !== renderId || !isCurrent()) return
      link = null
      sendButton.disabled = true
      slot('error').textContent = `${describeError(err)} This wrap can't be sent.`
      return
    }
    // A newer update started while this one was working; let it have the last word.
    if (mine !== renderId || !isCurrent()) return
    dropped = fitted.dropped
    link = `${state.site}/#${fitted.packed}`
    const preview = `/index.html#${fitted.packed}`
    if (frame.getAttribute('src') !== preview) frame.setAttribute('src', preview)
    sendButton.disabled = sending
    drawIncludes()
    drawSent()
  }

  const drawIncludes = () => {
    const focus = focusKey(app)
    slot('includes').innerHTML = includesHtml(shared(wrap), review, flagged, dropped, expanded)
    if (focus) app.querySelector<HTMLElement>(focus)?.focus()
  }

  const send = async () => {
    if (sending) return
    sending = true
    sendButton.disabled = true
    // Only waits when a change is still being packed (e.g. the name field, which updates on leaving it).
    if (updating) await updating
    if (!link) {
      sending = false
      return
    }
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
    sent = { link: outgoing, copied, error }
    sendButton.disabled = link === null
    sendButton.focus()
    drawSent()
    showPost()
  }

  const showPost = () => {
    const post = slot('post')
    if (!post.hidden) return
    post.hidden = false
    mountPost(post, state, isCurrent)
  }

  const copyCover = (button: HTMLButtonElement) => {
    const say = (text: string) => (slot('cover-status').textContent = text)
    // WebKit only allows the write during the click, so nothing is awaited before it.
    const blob = coverDrawn.then(
      () => new Promise<Blob>((ok, fail) => coverCanvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't make the image."))), 'image/png')),
    )
    let write: Promise<void>
    try {
      write = navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch {
      say(COPY_IMAGE_FAILED)
      return
    }
    button.disabled = true
    write
      .then(() => say('Cover copied ✓ Paste it with ⌘V.'))
      .catch(() => say(COPY_IMAGE_FAILED))
      .finally(() => {
        button.disabled = false
        button.focus()
      })
  }

  const renameSender = (input: HTMLInputElement) => {
    senderName = input.value.trim()
    // Saved for next time; if that fails, the name still applies to this page.
    void api('/api/sender-name', { name: senderName }).catch(() => undefined)
    drawCoverImage()
    void update()
  }

  app.onchange = (event) => {
    const box = event.target as HTMLInputElement
    if (box.dataset.senderName !== undefined) return renameSender(box)
    if (box.dataset.hit !== undefined) toggle(review.droppedHits, Number(box.dataset.hit), !box.checked)
    else if (box.dataset.sig !== undefined) toggle(review.droppedSignatures, box.dataset.sig, !box.checked)
    else return
    void update()
  }
  app.onclick = (event) => {
    const target = event.target as Element
    if (target.closest('[data-send]')) void send()
    else if (target.closest('[data-copy-cover]')) copyCover(target.closest<HTMLButtonElement>('[data-copy-cover]')!)
    else if (target.closest('[data-change]')) {
      expanded = !expanded
      drawIncludes()
      app.querySelector<HTMLElement>('[data-change]')?.focus()
    }
  }

  // My year has no group to send to first, so its share card shows straight away.
  if (!group) showPost()
  await update()
  if (isCurrent()) slot('heading').focus()
}

/** "Includes stats, first names and 3 quotes · Change", and when opened, the tick boxes for every quote and signature word. */
function includesHtml(wrap: Wrap, review: ReturnType<typeof initialReview>, flagged: Set<number>, dropped: Wrap['greatestHits'], expanded: boolean): string {
  const name = (pid: string) => (Object.hasOwn(wrap.people, pid) ? wrap.people[pid]! : 'Someone')
  const quotes = wrap.greatestHits.length - review.droppedHits.size - dropped.length
  const summary = quotes > 0 ? `Includes stats, first names and ${quotes} quote${quotes === 1 ? '' : 's'}` : 'Includes stats and first names'
  const tooLong = (hit: Wrap['greatestHits'][number]) => dropped.includes(hit)
  const line = `<p class="summary">${summary} · <button class="link" data-change aria-expanded="${expanded}">${expanded ? 'Hide' : 'Change'}</button></p>`
  if (!expanded) return line
  return `${line}
    <div class="review">
      ${wrap.greatestHits
        .map(
          (hit, i) => `
        <label${tooLong(hit) && !review.droppedHits.has(i) ? ' class="left-out"' : ''}><input type="checkbox" data-hit="${i}"${review.droppedHits.has(i) ? '' : ' checked'} />
          <span>"${escapeHtml(hit.text)}" (${escapeHtml(name(hit.senderId))})
          ${flagged.has(i) ? '<span class="warn">⚠ looks like a phone number or email</span>' : ''}
          ${tooLong(hit) && !review.droppedHits.has(i) ? '<span class="warn">left out (link too long)</span>' : ''}</span>
        </label>`,
        )
        .join('')}
      ${Object.entries(wrap.words.signatureWordByPerson)
        .map(
          ([pid, word]) => `
        <label><input type="checkbox" data-sig="${escapeHtml(pid)}"${review.droppedSignatures.has(pid) ? '' : ' checked'} />
          <span>${pid === 'me' && name(pid) === 'You' ? 'Your' : `${escapeHtml(name(pid))}'s`} word: "${escapeHtml(word)}"</span></label>`,
        )
        .join('')}
      ${dropped.length > 0 ? `<p class="warn">Left out ${dropped.length} more quote(s) so the link isn't too long.</p>` : ''}
    </div>`
}

/** The selector of the tick box that has focus, so it can be refocused after the redraw. */
function focusKey(app: HTMLElement): string | null {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || !app.contains(el)) return null
  if (el.dataset.hit !== undefined) return `input[data-hit="${CSS.escape(el.dataset.hit)}"]`
  if (el.dataset.sig !== undefined) return `input[data-sig="${CSS.escape(el.dataset.sig)}"]`
  return null
}

function toggle<T>(set: Set<T>, value: T, on: boolean): void {
  if (on) set.add(value)
  else set.delete(value)
}
