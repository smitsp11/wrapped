import { BETA_TAG } from '../../src/app/copy'
import { NewerVersionError } from '../../src/errors'
import { unpackWrap } from '../../src/share/pack'
import { parseWrap } from '../../src/share/parseWrap'
import type { Wrap } from '../../src/types'
import { countOpen, pageKind, pageView, startAnalytics } from './analytics'
import { closeConvo, isConvoOpen, openConvo, type LocalPreview } from './convo'
import { SAVE_CONTROL, mountSaveControl } from './save/saveControl'
import { slideCardFor } from './save/slideCards'
import { buildSlides, escapeHtml, longestWord } from './slides'

const app = document.querySelector<HTMLElement>('#app')!

class DemoLoadError extends Error {}

/** "#demo" loads the fake demo; any other "#..." is a packed wrap. The # part is never sent to a server. */
async function loadWrap(): Promise<Wrap | null> {
  const hash = location.hash.slice(1)
  if (!hash) return null
  if (hash === 'demo') return loadDemo()
  return unpackWrap(hash)
}

async function loadDemo(): Promise<Wrap> {
  try {
    const response = await fetch(import.meta.env.BASE_URL + 'demo.json')
    if (!response.ok) throw new DemoLoadError()
    // A fetched file is untrusted too: check its shape like a link's.
    return parseWrap(await response.json())
  } catch {
    throw new DemoLoadError()
  }
}

/** Leaves story mode: no taps or keys until a wrap is playing again. */
function stopPlaying(): void {
  closeConvo()
  document.onclick = null
  document.onkeydown = null
  document.onpointerdown = null
  document.onpointermove = null
  document.onpointerup = null
  document.onpointercancel = null
  document.oncontextmenu = null
}

/** How long a press on a greatest hit lasts before it opens the conversation, and how far it may drift. */
const HOLD_MS = 450
const HOLD_SLOP_PX = 10

/** The scrapbook pieces beside the landing copy. Made-up numbers from the demo chat, and decorative only. */
const LANDING_COLLAGE = `
  <div class="collage" aria-hidden="true">
    <div class="polaroid taped"><div class="photo"><p class="big" style="--len:3">533</p><p>messages</p></div><p class="hand">Poker Night</p></div>
    <ol class="bars">
      <li><span class="rank">1</span><span class="name">Alex</span><span class="bar" style="--w:100%"></span><span class="value">27.8%</span></li>
      <li><span class="rank">2</span><span class="name">You</span><span class="bar" style="--w:86%"></span><span class="value">23.8%</span></li>
    </ol>
    <div class="stamp"><span>CERTIFIED</span><strong style="--len:${longestWord('Main Character')}">Main Character</strong><span>2026</span></div>
    <p class="hand caption">(a made-up demo chat)</p>
  </div>`

function showLanding(): void {
  stopPlaying()
  const command = `curl -fsSL ${location.host} | sh`
  app.innerHTML = `
    <section class="slide landing">
      <div class="landing-grid">
        <p class="kicker"><span class="beta" data-beta-tag>${BETA_TAG}</span></p>
        <h1>iMessage Wrapped <span class="hand">for your group chats</span></h1>
        <p class="lede"><span class="hook">the year's almost over. who did you actually text the most?</span>
          <span class="trust">Watch it on any phone.</span></p>
        ${LANDING_COLLAGE}
        <div class="note taped install">
          <p>Open <b>Terminal</b> and paste:</p>
          <pre class="command"><code>${escapeHtml(command)}</code></pre>
          <button class="button" data-copy-command>Copy</button>
        </div>
        <a class="link demo-link" href="#demo">See a demo →</a>
        <p class="small">Needs a Mac with Messages. <a href="/install.sh">Read the install script</a>.</p>
      </div>
    </section>`
  const button = app.querySelector<HTMLButtonElement>('[data-copy-command]')!
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command)
      button.textContent = 'Copied'
    } catch {
      button.textContent = 'Select the line and copy it'
    }
  })
}

function showError(title: string, message: string): void {
  stopPlaying()
  app.innerHTML = `
    <section class="slide notice">
      <p class="hand-title">oops,</p>
      <h2>${escapeHtml(title)}</h2>
      <p class="lede">${escapeHtml(message)}</p>
      <a class="button" href="#">Home</a>
    </section>`
}

/**
 * The maker's preview of this very link, on your own Mac: its parent (the maker, same origin) offers your photos.
 * Anywhere else there's nothing: the page isn't framed, or another site framed it (reading its window throws).
 */
function localPreview(): LocalPreview | undefined {
  try {
    const local = window.parent !== window ? window.parent.wrappedLocalPreview : undefined
    return local?.packed === location.hash.slice(1) ? local : undefined
  } catch {
    return undefined
  }
}

function play(wrap: Wrap): void {
  closeConvo()
  const local = localPreview()
  const slides = buildSlides(wrap)
  let index = 0
  /** Which way the last move went, so going back turns the page the other way. */
  let direction: 'next' | 'back' = 'next'
  const go = (step: number) => {
    index = Math.min(slides.length - 1, Math.max(0, index + step))
    direction = step < 0 ? 'back' : 'next'
    render()
  }
  const render = () => {
    const slide = slides[index]!
    // Some pages can be saved as an image (see save/slideCards.ts).
    const card = slideCardFor(wrap, slide.id)
    app.innerHTML = `
      <div class="progress">${slides.map((_, i) => `<span class="${i <= index ? 'done' : ''}"></span>`).join('')}</div>
      <section class="slide" data-testid="slide" data-slide="${slide.id}" data-dir="${direction}">${slide.html}</section>
      ${card ? SAVE_CONTROL : ''}`
    if (card) mountSaveControl(app, card)
  }
  // A greatest hit opens its conversation from its "see the convo" link, or by pressing and holding the card, like
  // long-pressing a message. A plain tap on the card turns the page like any other tap.
  // In the maker's preview only, your own photos show in place of "📷 Photo".
  const openHit = (card: HTMLElement) => {
    const index = Number(card.dataset.convo)
    const mediaFor = local?.mediaFor
    const photoFor = mediaFor ? (message: number) => mediaFor(index, message) : undefined
    openConvo(wrap, wrap.greatestHits[index]!, app, card.querySelector<HTMLElement>('.see-convo') ?? card, photoFor)
  }
  let hold: { timer: number; x: number; y: number } | null = null
  /** Set when a hold opened a conversation, so the click that ends the hold doesn't also turn the page. */
  let held = false
  const cancelHold = () => {
    if (hold) window.clearTimeout(hold.timer)
    hold = null
  }
  document.onpointerdown = (event) => {
    held = false
    cancelHold()
    const card = (event.target as Element).closest<HTMLElement>('[data-convo]')
    if (!card || event.button !== 0 || isConvoOpen()) return
    const timer = window.setTimeout(() => {
      hold = null
      held = true
      openHit(card)
    }, HOLD_MS)
    hold = { timer, x: event.clientX, y: event.clientY }
  }
  document.onpointermove = (event) => {
    if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > HOLD_SLOP_PX) cancelHold()
  }
  document.onpointerup = cancelHold
  document.onpointercancel = cancelHold
  // A long press on a card shouldn't bring up the browser's own menu.
  document.oncontextmenu = (event) => {
    if ((event.target as Element).closest('[data-convo]')) event.preventDefault()
  }

  // Like Instagram stories: tap the left third of the card to go back, anywhere else to go forward.
  document.onclick = (event) => {
    // The dialog keeps its own taps; anything else that gets here while it's open, or right after a hold, is ignored.
    if (isConvoOpen() || held) {
      held = false
      return
    }
    const target = event.target as Element
    // "save ↓" and what it opens keep their own taps.
    if (target.closest('[data-save]')) return
    const link = target.closest('.see-convo')?.closest<HTMLElement>('[data-convo]')
    if (link) {
      openHit(link)
      return
    }
    if (target.closest('[data-restart]')) {
      event.preventDefault()
      index = 0
      direction = 'next'
      render()
      return
    }
    if (target.closest('a')) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (window.getSelection()?.toString()) return
    const card = app.getBoundingClientRect()
    go(event.clientX < card.left + card.width / 3 ? -1 : 1)
  }
  document.onkeydown = (event) => {
    // While a conversation is open, keys belong to it: Escape closes it and nothing flips the page underneath.
    if (isConvoOpen()) {
      if (event.key === 'Escape') closeConvo()
      return
    }
    if (event.key === 'ArrowRight') go(1)
    if (event.key === 'ArrowLeft') go(-1)
    if (event.key === 'Escape') location.hash = ''
    // Space and Enter on a focused link or button should still activate it.
    if ((event.key === ' ' || event.key === 'Enter') && !(event.target as Element).closest('a, button')) {
      event.preventDefault()
      go(1)
    }
  }
  render()
}

/** Only the latest call may draw: a slow load from an earlier hash must not overwrite a newer page. */
let loadId = 0

async function start(): Promise<void> {
  const token = ++loadId
  const kind = pageKind(location.hash)
  pageView(kind)
  try {
    const wrap = await loadWrap()
    if (token !== loadId) return
    if (wrap) play(wrap)
    else showLanding()
    countOpen(kind)
  } catch (error) {
    if (token !== loadId) return
    if (error instanceof NewerVersionError) showError('Newer version', `${error.message} Try refreshing the page.`)
    else if (error instanceof DemoLoadError) showError('Demo unavailable', "Couldn't load the demo. Try again.")
    else showError('This link is broken', 'It may have been cut off when it was copied. Ask for it again.')
  }
}

startAnalytics()
window.addEventListener('hashchange', () => void start())
void start()
