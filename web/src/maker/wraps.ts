import { DONE } from '../../../src/app/copy'
import { fitToLimit } from '../../../src/share/pack'
import type { Wrap } from '../../../src/types'
import { escapeHtml } from '../slides'
import { coverLines, drawCover } from './cover'
import { api, describeError, type State } from './api'
import { applyReview, initialReview, type Review } from './review'

type Loaded = { id: string; wrap: Wrap }

export async function renderWraps(app: HTMLElement, state: State, ids: string[]): Promise<void> {
  const noWraps = () => {
    app.innerHTML = '<section class="panel"><p>No wraps to show.</p></section>'
  }
  if (ids.length === 0) return noWraps()
  const { wraps } = await api<{ wraps: Loaded[] }>(`/api/wraps?ids=${encodeURIComponent(ids.join(','))}`)
  if (wraps.length === 0) return noWraps()
  const reviews = new Map<string, Review>()
  let index = 0
  let renderId = 0
  let busy = false
  let finished = false
  /** Per wrap id: the link last copied or opened, to warn when ticks change it afterwards. */
  const sentLinks = new Map<string, string>()

  /** The selector of the tick box that has focus, so it can be refocused after the rewrite. */
  const focusKey = (): string | null => {
    const el = document.activeElement
    if (!(el instanceof HTMLElement) || !app.contains(el)) return null
    if (el.dataset.hit !== undefined) return `input[data-hit="${CSS.escape(el.dataset.hit)}"]`
    if (el.dataset.sig !== undefined) return `input[data-sig="${CSS.escape(el.dataset.sig)}"]`
    return null
  }

  const actions = () => {
    const isLast = index === wraps.length - 1
    return `<div class="actions">
              ${isLast ? '<button class="button" data-done>Done</button>' : `<button class="button" data-next>Next: ${escapeHtml(wraps[index + 1]!.wrap.title)} →</button>`}
            </div>`
  }

  const show = async () => {
    if (finished) return
    const mine = ++renderId
    const { id, wrap } = wraps[index]!
    const review = reviews.get(id) ?? initialReview(wrap)
    reviews.set(id, review)
    const flagged = initialReview(wrap).droppedHits
    let fitted: Awaited<ReturnType<typeof fitToLimit>>
    try {
      fitted = await fitToLimit(applyReview(wrap, review))
    } catch (err) {
      if (mine !== renderId || finished) return
      app.innerHTML = `
        <section class="panel" data-wrap="${escapeHtml(id)}">
          <h2 tabindex="-1" data-heading>${escapeHtml(wrap.title)}</h2>
          <p class="warn" role="alert">${escapeHtml(describeError(err))} This wrap can't be sent; skip it.</p>
          <p class="warn" role="alert" data-error></p>
          ${actions()}
        </section>`
      return
    }
    // A newer show() started while this one was working; let it have the last word.
    if (mine !== renderId || finished) return
    const { packed, dropped } = fitted
    const link = `${state.site}/#${packed}`
    const name = (pid: string) => (Object.hasOwn(wrap.people, pid) ? wrap.people[pid]! : 'Someone')
    const focus = focusKey()
    const tooLong = (hit: Wrap['greatestHits'][number]) => dropped.includes(hit)

    app.innerHTML = `
      <section class="panel" data-wrap="${escapeHtml(id)}">
        <p class="kicker">Your wraps · ${index + 1} of ${wraps.length}</p>
        <h2 tabindex="-1" data-heading>${escapeHtml(wrap.title)}</h2>
        <div class="wrap-page">
          <div>
            <h3>① Watch it</h3>
            <iframe class="phone" title="Preview of ${escapeHtml(wrap.title)}" src="/index.html#${escapeHtml(packed)}"></iframe>
          </div>
          <div class="review">
            <h3>② What's in the link</h3>
            <p>Stats, awards and top words, plus:</p>
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
                <span>${pid === 'me' ? 'Your' : `${escapeHtml(name(pid))}'s`} word: "${escapeHtml(word)}"</span></label>`,
              )
              .join('')}
            ${dropped.length > 0 ? `<p class="warn">Left out ${dropped.length} more quote(s) so the link isn't too long.</p>` : ''}
            <div data-send data-link="${escapeHtml(link)}"></div>
            <p class="warn" role="alert" data-error></p>
            ${actions()}
          </div>
        </div>
      </section>`
    if (focus) app.querySelector<HTMLElement>(focus)?.focus()
    mountSend(app, wrap, link, sentLinks, id)
  }

  const showError = (err: unknown) => {
    const slot = app.querySelector<HTMLElement>('[data-error]')
    if (slot) slot.textContent = describeError(err)
  }

  app.onchange = (event) => {
    const box = event.target as HTMLInputElement
    // The wrap the box was drawn for, not the one now being drawn: a tick can land during Next.
    const section = box.closest<HTMLElement>('[data-wrap]')
    const review = section?.dataset.wrap === undefined ? undefined : reviews.get(section.dataset.wrap)
    if (!review) return
    if (box.dataset.hit !== undefined) toggle(review.droppedHits, Number(box.dataset.hit), !box.checked)
    else if (box.dataset.sig !== undefined) toggle(review.droppedSignatures, box.dataset.sig, !box.checked)
    else return
    void show()
  }
  app.onclick = async (event) => {
    const target = event.target as Element
    if (busy) return
    if (target.closest('[data-next]')) {
      busy = true
      index++
      try {
        await show()
        app.querySelector<HTMLElement>('[data-heading]')?.focus()
      } finally {
        busy = false
      }
    } else if (target.closest('[data-done]')) {
      busy = true
      try {
        await api('/api/done', {})
        finished = true
        renderId++
        app.innerHTML = `<section class="panel"><h2>${escapeHtml(DONE)}</h2><p>You can close this tab.</p></section>`
      } catch (err) {
        showError(err)
      } finally {
        busy = false
      }
    }
  }
  await show()
}

function toggle<T>(set: Set<T>, value: T, on: boolean): void {
  if (on) set.add(value)
  else set.delete(value)
}

/** Runs a send action; ignores clicks while it runs and shows any failure in the status line. */
function guarded(button: HTMLButtonElement, say: (text: string) => void, action: () => Promise<string>): void {
  button.addEventListener('click', async () => {
    button.disabled = true
    try {
      say(await action())
    } catch (err) {
      say(describeError(err))
    } finally {
      button.disabled = false
      button.focus()
    }
  })
}

const COPY_IMAGE_FAILED = "Couldn't copy the image. Drag it into Messages, or right-click it and choose Copy Image."

/** ③ Send: copy the cover image, copy the link, and open a new message with the link typed in. */
function mountSend(app: HTMLElement, wrap: Wrap, link: string, sentLinks: Map<string, string>, id: string): void {
  const slot = app.querySelector<HTMLElement>('[data-send]')
  if (!slot) return
  const instruction =
    wrap.mode === 'group'
      ? `Type the group's name in "To:", paste the cover, and press send.`
      : 'Send it to anyone you like, or keep it.'
  slot.innerHTML = `
    <h3>③ Send it</h3>
    <img class="cover" alt="Cover image for ${escapeHtml(wrap.title)}" />
    <div class="actions">
      <button class="button" data-copy-cover>Copy cover image</button>
      <button class="button" data-copy-link>Copy link</button>
      <button class="button" data-open-messages>Open Messages</button>
    </div>
    <p>${escapeHtml(instruction)}</p>
    <p class="status" role="status" data-send-status></p>`
  // Drawn off screen and shown as an image, so right-click Copy Image and dragging work in every browser.
  // Drawing waits for the fonts, so it finishes a moment later.
  const canvas = document.createElement('canvas')
  const drawn = drawCover(canvas, coverLines(wrap))
  const image = slot.querySelector<HTMLImageElement>('img.cover')!
  void drawn.then(() => (image.src = canvas.toDataURL('image/png')))
  const status = slot.querySelector<HTMLElement>('[data-send-status]')!
  const say = (text: string) => {
    status.textContent = text
  }
  const button = (selector: string) => slot.querySelector<HTMLButtonElement>(selector)!
  // A link was copied or opened for the previous review; the ticks have changed it since.
  const sentBefore = sentLinks.get(id)
  if (sentBefore !== undefined && sentBefore !== link) say('The link changed. Copy it again.')

  const copyCover = button('[data-copy-cover]')
  copyCover.addEventListener('click', () => {
    // WebKit only allows the write during the click, so nothing is awaited before it.
    const blob = drawn.then(
      () =>
        new Promise<Blob>((ok, fail) =>
          canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't make the image."))), 'image/png'),
        ),
    )
    let write: Promise<void>
    try {
      write = navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch {
      say(COPY_IMAGE_FAILED)
      return
    }
    copyCover.disabled = true
    write
      .then(() => say('Cover copied ✓ Paste it with ⌘V.'))
      .catch(() => say(COPY_IMAGE_FAILED))
      .finally(() => {
        copyCover.disabled = false
        copyCover.focus()
      })
  })
  guarded(button('[data-copy-link]'), say, async () => {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      return "Couldn't copy the link. Your browser blocked clipboard access."
    }
    sentLinks.set(id, link)
    return 'Link copied ✓'
  })
  guarded(button('[data-open-messages]'), say, async () => {
    await api('/api/open-messages', { link })
    sentLinks.set(id, link)
    return 'Messages is open with the link typed in.'
  })
}
