import type { Wrap } from '../../../src/types'
import { api, describeError, type Built, type State } from './api'
import { drawYouCard, youCardFrom } from './youCard'

/** The solo wrap the card is drawn from. Kept once loaded, so making another wrap doesn't build it again. */
let solo: Promise<Wrap> | null = null

/** Your My year wrap: loaded if it's saved, otherwise built first (the same path as Make my year). */
function soloWrap(state: State): Promise<Wrap> {
  solo ??= (async () => {
    if (!state.solo.made) {
      const built = await api<Built>('/api/build', { kind: 'solo' })
      if (!built.ids[0]) throw new Error(built.failed[0]?.message ?? "Couldn't make your year.")
    }
    const { wraps } = await api<{ wraps: { wrap: Wrap }[] }>(`/api/wraps?ids=${encodeURIComponent(state.solo.wrapId)}`)
    if (!wraps[0]) throw new Error("Couldn't load your year.")
    return wraps[0].wrap
  })()
  // A failure isn't kept, so the next try starts over.
  solo.catch(() => (solo = null))
  return solo
}

/**
 * "Now post yours": the personal share card with Save image and Copy image, then Make another. A click on the card
 * opens it larger. `focus`: move focus to the card once it's made (it replaced the button that was clicked).
 */
export function mountPost(slot: HTMLElement, state: State, isCurrent: () => boolean, focus = false): void {
  const year = state.period.year
  slot.innerHTML = `
    <section class="post">
      <h3>Now post yours</h3>
      <p>A card about your own year in texts, made for your story.</p>
      <div class="post-row">
        <div class="card-frame"><button type="button" class="card-zoom" data-zoom aria-label="Open your ${year} in texts share card larger" hidden><img class="you-card" alt="Your ${year} in texts share card" data-card /></button><p class="status" role="status" data-card-status>Making your card…</p></div>
        <div class="post-actions">
          <a class="button" data-save download="my-${year}-in-texts.png" aria-disabled="true">Save image</a>
          <button class="button secondary" data-copy-card disabled>Copy image</button>
          <p class="status" role="status" data-copy-status></p>
          <button class="link another" data-another>Make another →</button>
        </div>
      </div>
    </section>`
  const find = <T extends HTMLElement>(name: string) => slot.querySelector<T>(`[data-${name}]`)!
  const image = find<HTMLImageElement>('card')
  const save = find<HTMLAnchorElement>('save')
  const copy = find<HTMLButtonElement>('copy-card')
  const canvas = document.createElement('canvas')

  const drawn = soloWrap(state).then((wrap) => drawYouCard(canvas, youCardFrom(wrap)))
  drawn.then(
    () => {
      if (!isCurrent()) return
      const url = canvas.toDataURL('image/png')
      image.src = url
      find('zoom').hidden = false
      if (focus) find('zoom').focus()
      find('card-status').textContent = ''
      save.href = url
      save.removeAttribute('aria-disabled')
      copy.disabled = false
    },
    (err: unknown) => {
      if (isCurrent()) find('card-status').textContent = `Couldn't make your card: ${describeError(err)}`
    },
  )

  slot.addEventListener('click', (event) => {
    const target = event.target as Element
    if (target.closest('[data-another]')) location.hash = '#/'
    else if (target.closest('[data-copy-card]')) copyCard()
    else if (target.closest('[data-zoom]')) openLarger(image, find('zoom'))
  })

  const copyCard = () => {
    const say = (text: string) => (find('copy-status').textContent = text)
    // WebKit only allows the write during the click, so it starts now, with the image filled in when it's ready.
    const blob = drawn.then(
      () => new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't make the image."))), 'image/png')),
    )
    const failed = () => say("Couldn't copy the image. Use Save image instead.")
    // Some browsers never answer a clipboard write (no reply, no error); after a few seconds, say so.
    const stuck = window.setTimeout(failed, COPY_TIMEOUT_MS)
    try {
      void navigator.clipboard
        .write([new ClipboardItem({ 'image/png': blob })])
        .then(() => say('Card copied ✓ Paste it into your story or post.'), failed)
        .finally(() => window.clearTimeout(stuck))
    } catch {
      window.clearTimeout(stuck)
      failed()
    }
  }
}

/** How long to wait for the clipboard before pointing at Save image instead. */
const COPY_TIMEOUT_MS = 3000

/** The card, big, over the dimmed page. A click anywhere, or Escape, closes it and puts focus back on the thumbnail. */
function openLarger(image: HTMLImageElement, opener: HTMLElement): void {
  const box = document.createElement('div')
  box.className = 'lightbox'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', image.alt)
  box.innerHTML = '<img alt="" /><button type="button" class="button secondary" data-close-lightbox>Close</button>'
  const big = box.querySelector('img')!
  big.src = image.src
  big.alt = image.alt
  const close = () => {
    box.remove()
    document.removeEventListener('keydown', onKey)
    opener.focus()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }
  box.addEventListener('click', close)
  document.addEventListener('keydown', onKey)
  document.body.append(box)
  box.querySelector<HTMLButtonElement>('[data-close-lightbox]')!.focus()
}
