import type { Wrap } from '../../../src/types'

export type CoverAward = { title: string; name: string }
export type CoverLines = {
  /** the handwritten line at the top, e.g. "our 2026, wrapped" */
  hand: string
  title: string
  /** the number in the ink stamp, and the word under it */
  count: string
  countLabel: string
  awards: CoverAward[]
}

/** The text on the cover. Pure, so it's unit-tested; drawCover only paints it. */
export function coverLines(wrap: Wrap): CoverLines {
  const year = wrap.period.from.slice(0, 4)
  const name = (id: string) => (Object.hasOwn(wrap.people, id) ? wrap.people[id]! : 'Someone')
  return {
    hand: wrap.mode === 'group' ? `our ${year}, wrapped` : `my ${year}, in texts`,
    title: wrap.title,
    count: wrap.volume.total.toLocaleString('en-US'),
    countLabel: wrap.volume.total === 1 ? 'message' : 'messages',
    awards: wrap.awards.slice(0, 2).map((a) => ({ title: a.title, name: name(a.personId) })),
  }
}

/**
 * Splits a title into two lines at the space nearest its middle ("Road Trip Crew" → "Road Trip", "Crew").
 * It only splits where both lines keep a letter or number, so an emoji never sits on a line by itself
 * ("Poker 🃏" stays on one line and is shrunk to fit). A title with no such space stays on one line.
 */
export function splitTitle(title: string): string[] {
  const hasWord = (text: string) => /[\p{L}\p{N}]/u.test(text)
  const middle = title.length / 2
  let best = -1
  for (let i = 0; i < title.length; i++) {
    if (title[i] !== ' ' || !hasWord(title.slice(0, i)) || !hasWord(title.slice(i + 1))) continue
    if (best === -1 || Math.abs(i - middle) < Math.abs(best - middle)) best = i
  }
  if (best === -1) return [title.trim()]
  return [title.slice(0, best).trim(), title.slice(best + 1).trim()].filter(Boolean)
}

// The design is 432×540 (C-Cover); the PNG is drawn 2.5× bigger so it stays sharp in Messages.
const S = 2.5
const WIDTH = 432 * S
const HEIGHT = 540 * S
const MIN_PX = 24
const TITLE_MIN_PX = 64

const PAPER = '#F6EEDF'
const INK = '#2B2118'
const MUTED = '#5C4A3A'
const TAPE = 'rgba(255, 214, 102, 0.75)'
const SHADOW = 'rgba(43, 33, 24, 0.15)'
const AWARD_INKS = ['#C2410C', '#1D4ED8']

export const BODY = '"Bricolage Grotesque", system-ui, -apple-system, sans-serif'
export const HAND = 'Caveat, "Bricolage Grotesque", system-ui, cursive'

export const fontFor = (weight: number, px: number, family = BODY) => `${weight} ${px}px ${family}`

/** Cuts text by grapheme (so emoji aren't split), falling back to code points. */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment)
  }
  return Array.from(text)
}

/**
 * Sets the font on ctx, shrinking from `size` down to `minPx` until the text fits maxWidth.
 * If it still doesn't fit at minPx, cuts it with an ellipsis. Returns the text to draw and the size used.
 */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  size: number,
  maxWidth: number,
  minPx = MIN_PX,
  family = BODY,
): { text: string; px: number } {
  for (let px = size; px > minPx; px -= 4) {
    ctx.font = fontFor(weight, px, family)
    if (ctx.measureText(text).width <= maxWidth) return { text, px }
  }
  ctx.font = fontFor(weight, minPx, family)
  if (ctx.measureText(text).width <= maxWidth) return { text, px: minPx }
  const chars = graphemes(text)
  while (chars.length > 0 && ctx.measureText(chars.join('') + '…').width > maxWidth) chars.pop()
  return { text: chars.join('') + '…', px: minPx }
}

/**
 * Waits until the cover's fonts are loaded for this text, so the canvas draws with them.
 * If they can't load, the canvas uses the system font instead.
 */
async function loadFonts(lines: CoverLines): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const text = [lines.hand, lines.title, lines.count, lines.countLabel, ...lines.awards.flatMap((a) => [a.title, a.name])].join(' ')
  const faces = ['500 20px "Bricolage Grotesque"', '800 20px "Bricolage Grotesque"', '700 20px Caveat']
  try {
    await Promise.all(faces.map((face) => document.fonts.load(face, text)))
  } catch {
    // Drawn with system-ui instead.
  }
}

/** Runs `draw` with the canvas turned by `degrees` around (x, y), then turns it back. */
function rotated(ctx: CanvasRenderingContext2D, degrees: number, x: number, y: number, draw: () => void): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.translate(-x, -y)
  draw()
  ctx.restore()
}

/** Draws the share cover: paper, tape, "our 2026, wrapped", the title, a number stamp and two award cards. */
export async function drawCover(canvas: HTMLCanvasElement, lines: CoverLines): Promise<void> {
  await loadFonts(lines)
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  const left = 30 * S

  // Tape across the top.
  rotated(ctx, -4, 180 * S, 37 * S, () => {
    ctx.fillStyle = TAPE
    ctx.fillRect(120 * S, 22 * S, 120 * S, 30 * S)
  })

  // The handwritten line.
  ctx.textBaseline = 'top'
  rotated(ctx, -3, left, 70 * S, () => {
    ctx.fillStyle = '#C2410C'
    const hand = fitText(ctx, lines.hand, 700, 30 * S, 372 * S, MIN_PX, HAND)
    ctx.fillText(hand.text, left, 52 * S)
  })

  drawTitle(ctx, lines.title, left, 96 * S)
  drawStamp(ctx, lines.count, lines.countLabel)

  // Award cards, stacked up from just above the footer; the second sits a little to the right.
  const cardHeight = 50 * S
  lines.awards.forEach((award, i) => {
    const slot = 2 - lines.awards.length + i
    const top = (354 + slot * 62) * S
    drawAwardCard(ctx, award, left + i * 24 * S, top, cardHeight, AWARD_INKS[i]!, i === 0 ? -2 : 1.5)
  })

  ctx.fillStyle = MUTED
  ctx.textBaseline = 'bottom'
  ctx.font = fontFor(500, 13 * S)
  ctx.fillText('Tap the link to watch it', left, (540 - 22) * S)
}

/**
 * The title, big. One line if it fits at full size; otherwise two lines split at a space. The second line
 * stops short of the number stamp beside it. Both lines are drawn at the same size.
 */
function drawTitle(ctx: CanvasRenderingContext2D, title: string, left: number, top: number): void {
  const full = 76 * S
  const fullWidth = 372 * S
  const besideStamp = 222 * S
  ctx.fillStyle = INK
  ctx.font = fontFor(800, full)
  const parts = splitTitle(title)
  const oneLine = parts.length === 1 || ctx.measureText(title).width <= fullWidth
  const rows = oneLine ? [title] : parts
  const widths = oneLine ? [fullWidth] : [fullWidth, besideStamp]
  const px = Math.min(...rows.map((row, i) => fitText(ctx, row, 800, full, widths[i]!, TITLE_MIN_PX).px))
  rows.forEach((row, i) => {
    const fitted = fitText(ctx, row, 800, px, widths[i]!, px)
    ctx.fillText(fitted.text, left, top + i * px * 0.9)
  })
}

/** The ink circle with the message count, turned a little. */
function drawStamp(ctx: CanvasRenderingContext2D, count: string, label: string): void {
  const r = 70 * S
  const cx = (432 - 28) * S - r
  const cy = 165 * S + r
  rotated(ctx, 8, cx, cy, () => {
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = PAPER
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const number = fitText(ctx, count, 800, 46 * S, r * 1.6)
    ctx.fillText(number.text, cx, cy - 8 * S)
    ctx.font = fontFor(500, 14 * S)
    ctx.fillText(label, cx, cy + 24 * S)
    ctx.textAlign = 'left'
  })
}

/** A white card with a 2px shadow: the award in handwriting, then the winner's name. */
function drawAwardCard(
  ctx: CanvasRenderingContext2D,
  award: CoverAward,
  x: number,
  top: number,
  height: number,
  ink: string,
  tilt: number,
): void {
  const pad = 16 * S
  const gap = 10 * S
  const maxWidth = (432 - 60 - 24) * S
  ctx.font = fontFor(700, 24 * S, HAND)
  const titleWidth = Math.min(ctx.measureText(award.title).width, maxWidth / 2)
  const name = fitText(ctx, award.name, 800, 20 * S, maxWidth - pad * 2 - titleWidth - gap)
  const nameWidth = ctx.measureText(name.text).width
  const width = pad * 2 + titleWidth + gap + nameWidth
  rotated(ctx, tilt, x + width / 2, top + height / 2, () => {
    ctx.fillStyle = SHADOW
    ctx.fillRect(x, top + 2 * S, width, height)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(x, top, width, height)
    ctx.textBaseline = 'alphabetic'
    const baseline = top + height / 2 + 8 * S
    ctx.fillStyle = ink
    const title = fitText(ctx, award.title, 700, 24 * S, titleWidth, MIN_PX, HAND)
    ctx.fillText(title.text, x + pad, baseline)
    ctx.fillStyle = INK
    ctx.font = fontFor(800, name.px)
    ctx.fillText(name.text, x + pad + titleWidth + gap, baseline)
  })
}
