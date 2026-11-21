import './save.css'
import { drawSlideCard } from './drawSlideCard'
import type { SlideCard } from './slideCards'

/**
 * "save ↓" on a slide that can be saved as an image (see slideCards.ts).
 * On a phone it opens the share sheet with the PNG, which offers Save Image, Messages and Instagram. On a computer it
 * downloads the PNG. A phone that can't share files (an old iOS, some in-app browsers) shows the image to press and hold.
 * Every element here has data-save, so main.ts knows a tap on it isn't a tap to flip the page.
 */

export type SaveMethod = 'share' | 'download' | 'preview'

/** How to hand over the image. Pure, so it's unit-tested. */
export function saveMethod(env: { touch: boolean; canShareFiles: boolean }): SaveMethod {
  if (!env.touch) return 'download'
  return env.canShareFiles ? 'share' : 'preview'
}

/** The control, for main.ts to put on the page beside the slide. */
export const SAVE_CONTROL =
  '<button type="button" class="save-slide" data-save aria-label="Save this page as an image">save ↓</button>'

/** How long "saved ✓" shows before the control goes back to "save ↓". */
const CONFIRM_MS = 2200
/** The image is drawn this long after the page appears, once its page turn is over, so a tap can share it at once. */
const DRAW_AHEAD_MS = 500

function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' })
    return typeof navigator.share === 'function' && navigator.canShare?.({ files: [probe] }) === true
  } catch {
    return false
  }
}

const isTouch = () => window.matchMedia('(pointer: coarse)').matches

/** Drawn images by card, so saving twice, or coming back to the page, doesn't draw it again. */
const drawn = new Map<string, Promise<Blob>>()

function pngFor(card: SlideCard): Promise<Blob> {
  const key = JSON.stringify(card)
  let png = drawn.get(key)
  if (!png) {
    png = (async () => {
      const canvas = document.createElement('canvas')
      await drawSlideCard(canvas, card)
      return new Promise<Blob>((ok, fail) =>
        canvas.toBlob((blob) => (blob ? ok(blob) : fail(new Error("Couldn't make the image."))), 'image/png'),
      )
    })()
    // A failure isn't kept, so the next tap tries again.
    png.catch(() => drawn.delete(key))
    drawn.set(key, png)
  }
  return png
}

/** Wires up the control that main.ts put in `root`. */
export function mountSaveControl(root: HTMLElement, card: SlideCard): void {
  const button = root.querySelector<HTMLButtonElement>('.save-slide')
  if (!button) return
  window.setTimeout(() => {
    if (button.isConnected) pngFor(card).catch(() => undefined)
  }, DRAW_AHEAD_MS)
  button.addEventListener('click', () => void save(button, card))
}

function show(button: HTMLButtonElement, state: 'idle' | 'busy' | 'done' | 'failed', text = 'save ↓'): void {
  button.dataset.state = state
  button.textContent = text
  if (state === 'done' || state === 'failed') {
    window.setTimeout(() => {
      if (button.dataset.state === state) show(button, 'idle')
    }, CONFIRM_MS)
  }
}

async function save(button: HTMLButtonElement, card: SlideCard): Promise<void> {
  if (button.dataset.state === 'busy') return
  // Decided before anything is awaited: the share sheet must open while the tap still counts as the user's.
  const method = saveMethod({ touch: isTouch(), canShareFiles: canShareFiles() })
  show(button, 'busy', 'saving…')
  let png: Blob
  try {
    png = await pngFor(card)
  } catch {
    show(button, 'failed', "couldn't save")
    return
  }
  if (method === 'download') {
    download(png, card.fileName)
    show(button, 'done', 'saved ✓')
    return
  }
  if (method === 'share') {
    try {
      await navigator.share({ files: [new File([png], card.fileName, { type: 'image/png' })] })
      show(button, 'done', 'done ✓')
    } catch (error) {
      show(button, 'idle')
      // Closing the share sheet is a choice, not a failure. Anything else (say, the tap no longer counts as recent)
      // falls back to the image to press and hold.
      if (!(error instanceof DOMException && error.name === 'AbortError')) showPreview(png)
    }
    return
  }
  show(button, 'idle')
  showPreview(png)
}

function download(png: Blob, fileName: string): void {
  const url = URL.createObjectURL(png)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.dataset.save = ''
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked later, not now: the download starts after this click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** The image over a dimmed page, to press and hold (or right-click) and save, with Done to close it. */
function showPreview(png: Blob): void {
  document.querySelector('.save-preview')?.remove()
  const url = URL.createObjectURL(png)
  const layer = document.createElement('div')
  layer.className = 'save-preview'
  layer.dataset.save = ''
  layer.setAttribute('role', 'dialog')
  layer.setAttribute('aria-modal', 'true')
  layer.setAttribute('aria-label', 'Save this image')
  layer.innerHTML = `
    <img src="${url}" alt="This page as an image" />
    <p class="save-preview-hint">press and hold the image to save it</p>
    <button type="button" class="button" data-save-close>Done</button>`
  const opener = document.activeElement as HTMLElement | null
  const close = () => {
    layer.remove()
    URL.revokeObjectURL(url)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('hashchange', close)
    if (opener?.isConnected) opener.focus()
  }
  // Keys belong to the image while it's open: Escape closes it, and nothing flips the page (or leaves the wrap) underneath.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
    if (event.key !== 'Tab' && event.key !== 'Enter' && event.key !== ' ') event.stopPropagation()
  }
  layer.addEventListener('click', (event) => {
    const target = event.target as Element
    if (target.closest('[data-save-close]') || target === layer) close()
  })
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('hashchange', close)
  document.body.append(layer)
  layer.querySelector<HTMLButtonElement>('[data-save-close]')!.focus()
}
