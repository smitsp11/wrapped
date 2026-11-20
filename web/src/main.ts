import { BETA_TAG } from '../../src/app/copy'
import { NewerVersionError } from '../../src/errors'
import { unpackWrap } from '../../src/share/pack'
import { parseWrap } from '../../src/share/parseWrap'
import type { Wrap } from '../../src/types'
import { buildSlides, escapeHtml } from './slides'

const app = document.querySelector<HTMLElement>('#app')!

class DemoLoadError extends Error {}

/** "#demo" loads the fake demo; any other "#..." is a packed wrap. Nothing is sent to a server. */
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
  document.onclick = null
  document.onkeydown = null
}

/** The scrapbook pieces beside the landing copy. Made-up numbers from the demo chat, and decorative only. */
const LANDING_COLLAGE = `
  <div class="collage" aria-hidden="true">
    <div class="polaroid taped"><div class="photo"><p class="big" style="--len:3">302</p><p>messages</p></div><p class="hand">Pasta Gang</p></div>
    <ol class="bars">
      <li><span class="rank">1</span><span class="name">Alex</span><span class="bar" style="--w:100%"></span><span class="value">29.8%</span></li>
      <li><span class="rank">2</span><span class="name">Sam</span><span class="bar" style="--w:74%"></span><span class="value">21.9%</span></li>
    </ol>
    <div class="stamp"><span>CERTIFIED</span><strong>Main Character</strong><span>2026</span></div>
    <p class="hand caption">(a made-up demo chat)</p>
  </div>`

function showLanding(): void {
  stopPlaying()
  const command = `curl -fsSL ${location.host} | sh`
  app.innerHTML = `
    <section class="slide landing">
      <div class="landing-grid">
        <p class="kicker">iMessage Wrapped <span class="beta" data-beta-tag>${BETA_TAG}</span></p>
        <h1>Spotify Wrapped, <span class="hand">for your group chats</span></h1>
        <p class="lede">Made on your Mac. Nothing is uploaded. Watch it on any phone.</p>
        ${LANDING_COLLAGE}
        <div class="note taped install">
          <p>Open <b>Terminal</b> on your Mac and paste:</p>
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

function play(wrap: Wrap): void {
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
    const links =
      slide.id === 'outro'
        ? `<a class="button" href="#" data-restart>Watch again</a><a class="link" href="/">Make your own</a>`
        : ''
    app.innerHTML = `
      <div class="progress">${slides.map((_, i) => `<span class="${i <= index ? 'done' : ''}"></span>`).join('')}</div>
      <section class="slide" data-testid="slide" data-slide="${slide.id}" data-dir="${direction}">${slide.html}${links}</section>`
  }
  // Like Instagram stories: tap the left third of the card to go back, anywhere else to go forward.
  document.onclick = (event) => {
    const target = event.target as Element
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
    if (event.key === 'ArrowRight') go(1)
    if (event.key === 'ArrowLeft') go(-1)
    if (event.key === 'Escape') location.hash = ''
    // Space and Enter on a focused link should still activate the link.
    if ((event.key === ' ' || event.key === 'Enter') && !(event.target as Element).closest('a')) {
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
  try {
    const wrap = await loadWrap()
    if (token !== loadId) return
    if (wrap) play(wrap)
    else showLanding()
  } catch (error) {
    if (token !== loadId) return
    if (error instanceof NewerVersionError) showError('Newer version', `${error.message} Try refreshing the page.`)
    else if (error instanceof DemoLoadError) showError('Demo unavailable', "Couldn't load the demo. Try again.")
    else showError('This link is broken', 'It may have been cut off when it was copied. Ask for it again.')
  }
}

window.addEventListener('hashchange', () => void start())
void start()
