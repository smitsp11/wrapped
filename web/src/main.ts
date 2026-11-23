import { NewerVersionError } from '../../src/errors'
import { unpackWrap } from '../../src/share/pack'
import { parseWrap } from '../../src/share/parseWrap'
import type { Wrap } from '../../src/types'
import { PRODUCTION_HOST, countOpen, pageKind, pageView, startAnalytics } from './analytics'
import { closeConvo, isConvoOpen, openConvo, type LocalPreview } from './convo'
import { SAVE_CONTROL, mountSaveControl } from './save/saveControl'
import { slideCardFor } from './save/slideCards'
import { buildSlides, escapeHtml, longestWord } from './slides'
import { fitMonthNames } from './yearSlides'

const app = document.querySelector<HTMLElement>('#app')!

class DemoLoadError extends Error {}

/** "#demo" loads the fake demo; any other "#..." is a packed wrap. The # part is never sent to a server. */
async function loadWrap(): Promise<Wrap | null> {
  // A link pasted with a space or line break in it arrives as %20 or %0A: decoded, unpackWrap drops the whitespace.
  let hash = location.hash.slice(1)
  try {
    hash = decodeURIComponent(hash)
  } catch {
    // not valid percent-encoding: unpackWrap says the link is broken
  }
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

/** Cancels a press-and-hold still waiting to open a conversation (set while a wrap plays). */
let cancelPendingHold: () => void = () => undefined

/** Leaves story mode: no taps or keys until a wrap is playing again. */
function stopPlaying(): void {
  cancelPendingHold()
  closeConvo()
  document.onclick = null
  document.onkeydown = null
  document.onpointerdown = null
  document.onpointermove = null
  document.onpointerup = null
  document.onpointercancel = null
  document.oncontextmenu = null
  window.onresize = null
}

/** How long a press on a greatest hit lasts before it opens the conversation, and how far it may drift. */
const HOLD_MS = 450
const HOLD_SLOP_PX = 10
/**
 * The right edge of the page, as a share of its width: a tap there always turns the page, even on a greatest hit, and a
 * press there never opens its conversation. "see the convo →" sits to the left of it (styles.css).
 */
export const NEXT_STRIP = 0.24

/** The scrapbook pieces beside the landing copy. Made-up numbers from the demo chat, and decorative only. */
const LANDING_COLLAGE = `
  <div class="collage" aria-hidden="true">
    <div class="polaroid taped"><div class="photo"><p class="big" style="--len:6">22,938</p><p>messages</p></div><p class="hand">Poker Night</p></div>
    <ol class="bars">
      <li><span class="rank">1</span><span class="name">Riley</span><span class="bar" style="--w:100%"></span><span class="value">35.3%</span></li>
      <li><span class="rank">2</span><span class="name">You</span><span class="bar" style="--w:76%"></span><span class="value">26.7%</span></li>
    </ol>
    <div class="stamp"><span>CERTIFIED</span><strong style="--len:${longestWord('Main Character')}">Main Character</strong><span>2026</span></div>
    <p class="hand caption">(a made-up demo chat)</p>
  </div>`

/**
 * On the demo only: the way back to the landing page, where the install line is. A ✕ beside the progress bar, like
 * closing a story, and a "Try it yourself →" pill at the bottom on every page it fits under (fitDemoExit). Links, so
 * taps don't turn the page.
 */
const DEMO_EXIT =
  `<a class="demo-close" href="/" aria-label="Close the demo">✕</a>` +
  `<a class="demo-exit" href="/" data-demo-exit>Try it yourself →</a>`

/** What a phone visitor sends themselves, to open later on their Mac. */
const SITE_URL = `https://${PRODUCTION_HOST}`

/** Room kept between the pill and the page's writing. */
const DEMO_EXIT_GAP_PX = 1

/** Where `el` is laid out inside `root`, from offsets: the cards' tilts and settle animations don't move it. */
function layoutBox(el: HTMLElement, root: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  let left = 0
  let top = 0
  for (let at: HTMLElement | null = el; at && at !== root; at = at.offsetParent as HTMLElement | null) {
    left += at.offsetLeft
    top += at.offsetTop
  }
  return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight }
}

/**
 * The demo's "Try it yourself →" shows on every page it covers nothing of, at any phone height. On a page too full for
 * it, it hides and the ✕ by the progress bar is the way out.
 */
function fitDemoExit(): void {
  const pill = app.querySelector<HTMLElement>('[data-demo-exit]')
  const slide = app.querySelector<HTMLElement>('[data-testid=slide]')
  if (!pill || !slide) return
  pill.classList.remove('no-room')
  // #app isn't animated, and the slide fills it, so the pill's place on the page is measured from #app.
  const page = app.getBoundingClientRect()
  const r = pill.getBoundingClientRect()
  const gap = DEMO_EXIT_GAP_PX
  const box = { left: r.left - page.left - gap, top: r.top - page.top - gap, right: r.right - page.left + gap, bottom: r.bottom - page.top + gap }
  const covers = [...slide.querySelectorAll<HTMLElement>('*')].some((el) => {
    if (el.children.length > 0 || !el.offsetParent || el.offsetWidth === 0 || el.offsetHeight === 0) return false
    const at = layoutBox(el, slide)
    return at.bottom > box.top && at.top < box.bottom && at.right > box.left && at.left < box.right
  })
  pill.classList.toggle('no-room', covers)
}

function showLanding(): void {
  stopPlaying()
  // Always https: a bare host makes curl start over plain HTTP, which someone on the network could answer.
  const command = `curl -fsSL https://${location.host} | sh`
  // A phone can't run the install line, so on a phone (styles.css: a touch screen or a narrow page) the install card
  // gives way to "Make yours on a Mac", which sends the site to yourself for later.
  app.innerHTML = `
    <section class="slide landing">
      <div class="landing-grid">
        <h1>iMessage Wrapped <span class="hand">for your group chats</span></h1>
        <p class="lede"><span class="hook">the year's almost over. who did you actually text the most?</span>
          <span class="trust">Watch it on any phone.</span></p>
        ${LANDING_COLLAGE}
        <div class="note taped install">
          <p>Open <b>Terminal</b> and paste:</p>
          <pre class="command"><code>${escapeHtml(command)}</code></pre>
          <button class="button" data-copy-command>Copy</button>
        </div>
        <div class="note taped on-phone" data-on-phone>
          <p class="on-phone-title">Make yours on a Mac</p>
          <p class="small">Needs a Mac with Messages.</p>
          <p>Send yourself the link and open it there.</p>
          <button class="button" data-send-self>Send it to myself</button>
          <p class="small" role="status" data-send-self-status></p>
        </div>
        <a class="link demo-link" href="#demo">See a demo →</a>
        <p class="small on-computer">Needs a Mac with Messages. <a href="/install.sh">Read the install script</a>.</p>
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
  const sendSelf = app.querySelector<HTMLButtonElement>('[data-send-self]')!
  const status = app.querySelector<HTMLElement>('[data-send-self-status]')!
  sendSelf.addEventListener('click', async () => {
    // The share sheet (Messages, Mail, Notes...) where there is one; otherwise the link goes on the clipboard.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url: SITE_URL })
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return // closed the sheet: nothing to say
      }
    }
    try {
      await navigator.clipboard.writeText(SITE_URL)
      status.textContent = 'Link copied. Paste it to yourself.'
    } catch {
      status.textContent = `Send yourself ${SITE_URL}`
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
  /** Shown inside another page: the maker's preview (the public site can't be framed, see vercel.json). */
  const framed = window.top !== window
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
    // A hold started on the last page must not open its conversation over this one.
    cancelHold()
    const slide = slides[index]!
    // Some pages can be saved as an image (see save/slideCards.ts).
    const card = slideCardFor(wrap, slide.id)
    const page = `page ${index + 1} of ${slides.length}`
    app.innerHTML = `
      <div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="${slides.length}" aria-valuenow="${index + 1}" aria-valuetext="${page}" aria-label="${page}">${slides.map((_, i) => `<span class="${i <= index ? 'done' : ''}"></span>`).join('')}</div>
      <section class="slide" data-testid="slide" data-slide="${slide.id}" data-dir="${direction}">${slide.html}</section>
      ${card ? SAVE_CONTROL : ''}
      ${location.hash === '#demo' ? DEMO_EXIT : ''}`
    if (card) mountSaveControl(app, card)
    // In the maker's preview, "Make yours" would load the site inside the little phone: it opens the real site in a tab.
    if (framed) {
      const make = app.querySelector<HTMLAnchorElement>('.cta .button')
      make?.setAttribute('href', SITE_URL)
      make?.setAttribute('target', '_blank')
      make?.setAttribute('rel', 'noopener')
    }
    fitMonthNames(app)
    fitDemoExit()
    // The handwriting and display fonts can arrive after the first draw and change the widths.
    void document.fonts?.ready.then(() => {
      fitMonthNames(app)
      fitDemoExit()
    })
  }
  window.onresize = fitDemoExit
  // A greatest hit opens its conversation from its "see the convo" link, or by pressing and holding the card, like
  // long-pressing a message. A plain tap on the card turns the page like any other tap.
  // In the maker's preview only, your own photos show in place of "📷 Photo".
  const openHit = (card: HTMLElement) => {
    const index = Number(card.dataset.convo)
    const mediaFor = local?.mediaFor
    const photoFor = mediaFor ? (message: number) => mediaFor(index, message) : undefined
    openConvo(wrap, wrap.greatestHits[index]!, app, card.querySelector<HTMLElement>('.see-convo') ?? card, photoFor)
  }
  const inNextStrip = (x: number) => {
    const page = app.getBoundingClientRect()
    return x >= page.right - page.width * NEXT_STRIP
  }
  let hold: { timer: number; x: number; y: number } | null = null
  /** Set when a hold opened a conversation, so the click that ends the hold doesn't also turn the page. */
  let held = false
  function cancelHold(): void {
    if (hold) window.clearTimeout(hold.timer)
    hold = null
  }
  cancelPendingHold = cancelHold
  document.onpointerdown = (event) => {
    held = false
    cancelHold()
    const card = (event.target as Element).closest<HTMLElement>('[data-convo]')
    if (!card || event.button !== 0 || isConvoOpen() || inNextStrip(event.clientX)) return
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

  // Like Instagram stories: tap the left third of the card to go back, anywhere else to go forward. The right edge
  // (NEXT_STRIP) always goes forward, even on a greatest hit, so turning the page never opens a conversation by accident.
  document.onclick = (event) => {
    // The dialog keeps its own taps; anything else that gets here while it's open, or right after a hold, is ignored.
    if (isConvoOpen() || held) {
      held = false
      return
    }
    const target = event.target as Element
    // "save ↓" and what it opens keep their own taps.
    if (target.closest('[data-save]')) return
    // A keyboard press (detail 0) has no position, so it's never in the strip.
    if (event.detail > 0 && inNextStrip(event.clientX) && target.closest('[data-convo]')) {
      go(1)
      return
    }
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
    // Only the demo closes with Escape, back to the landing page. A shared wrap (and the maker's preview) stays put.
    if (event.key === 'Escape' && location.hash === '#demo' && !framed) location.hash = ''
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
