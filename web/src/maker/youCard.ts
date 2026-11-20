import { formatMinutes } from '../../../src/format'
import type { Wrap } from '../../../src/types'
import { type Personality, personalityFor } from '../../../src/wrap/personality'
import { HAND, fitText, fontFor, splitTitle } from './cover'

/**
 * The personal share card, "my 2026 in texts": your personality and your own numbers, nothing else.
 * It never holds anyone else's name, a chat title, a quote or a word you texted, so it's safe to post anywhere.
 * A field the wrap doesn't have is left out rather than guessed.
 */
export type YouCard = {
  /** "2026" */
  year: string
  personality: Personality
  /** messages you sent */
  textsSent: number
  /** the busiest hour across your chats, e.g. "9 PM" */
  peakHour?: string
  /** how long you typically (median) take to join a conversation someone else started, e.g. "4 min" */
  typicalReply?: string
  /** days in a row with at least one message */
  longestStreakDays?: number
  topEmoji?: string
  /** titles of the awards you won, e.g. "Double Texter" */
  awards: string[]
}

const ME = 'me'
/** A typical reply time over fewer conversations joined than this says little, so it's left off (the same bar as the slides). */
export const MIN_REPLIES_FOR_TYPICAL = 5
/** A one-day "streak" isn't worth a note. */
export const MIN_STREAK_DAYS = 2

function hourLabel(hour: number): string {
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`
}

/** The card's data from a solo wrap: aggregates about you only. Pure, so it's unit-tested. */
export function youCardFrom(solo: Wrap): YouCard {
  const own = (record: Record<string, number>) => (Object.hasOwn(record, ME) ? record[ME]! : undefined)
  const card: YouCard = {
    year: solo.period.from.slice(0, 4),
    personality: personalityFor(solo),
    textsSent: own(solo.volume.byPerson) ?? 0,
    awards: solo.awards.filter((a) => a.personId === ME).map((a) => a.title),
  }

  const busiest = Math.max(0, ...solo.timing.byHour)
  if (busiest > 0) card.peakHour = hourLabel(solo.timing.byHour.indexOf(busiest))

  const median = own(solo.replies.medianReplyMinutesByPerson)
  if (median !== undefined && (own(solo.replies.repliesByPerson) ?? 0) >= MIN_REPLIES_FOR_TYPICAL) {
    card.typicalReply = formatMinutes(median)
  }

  if (solo.timing.longestStreakDays >= MIN_STREAK_DAYS) card.longestStreakDays = solo.timing.longestStreakDays

  const emoji = solo.words.topEmoji[0]?.emoji
  if (emoji) card.topEmoji = emoji
  return card
}

export type CardStat = { value: string; label: string }

/** The taped notes, in order: texts sent, peak hour, typical reply, streak (whichever the card has). */
export function cardStats(card: YouCard): CardStat[] {
  const stats: CardStat[] = [{ value: card.textsSent.toLocaleString('en-US'), label: 'texts sent' }]
  if (card.peakHour) stats.push({ value: card.peakHour, label: 'peak hour' })
  if (card.typicalReply) stats.push({ value: card.typicalReply, label: 'typical reply' })
  if (card.longestStreakDays) {
    const days = card.longestStreakDays.toLocaleString('en-US')
    stats.push({ value: `${days} days`, label: 'longest streak' })
  }
  return stats
}

/**
 * Splits text into lines no wider than maxWidth, at spaces, using the font already set on ctx.
 * A single word wider than maxWidth gets a line to itself.
 */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

export const WIDTH = 1080
export const HEIGHT = 1920

const NOTE_WIDTH = 440
const NOTE_HEIGHT = 190
const NOTE_GAP = 40
const NOTES_TOP = 1130

/** Top-left corners of the stat notes: two per row, and an odd one out centred on its own row. */
export function notePositions(count: number): { x: number; y: number }[] {
  const left = (WIDTH - NOTE_WIDTH * 2 - NOTE_GAP) / 2
  const positions: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 2)
    const alone = i === count - 1 && count % 2 === 1
    const x = alone ? (WIDTH - NOTE_WIDTH) / 2 : left + (i % 2) * (NOTE_WIDTH + NOTE_GAP)
    positions.push({ x, y: NOTES_TOP + row * (NOTE_HEIGHT + NOTE_GAP) })
  }
  return positions
}

const PAPER = '#F6EEDF'
const INK = '#2B2118'
const MUTED = '#5C4A3A'
const ORANGE = '#C2410C'
const RED = '#BE123C'
const PINK = '#FDE2E4'
const CARD = '#FFFFFF'
const TAPE = 'rgba(255, 214, 102, 0.75)'
const SHADOW = 'rgba(43, 33, 24, 0.15)'
const NOTE_INKS = ['#C2410C', '#1D4ED8', '#15803D', '#7E22CE']
const FOOTER = 'wrapped.smitpatel.xyz'

/** Waits until the card's fonts are loaded for this text, as drawCover does. If they can't load, it uses the system font. */
async function loadFonts(card: YouCard): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const stats = cardStats(card).flatMap((s) => [s.value, s.label])
  const text = [`my ${card.year} in texts`, card.personality.name, card.personality.line, ...stats, ...card.awards, FOOTER].join(' ')
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

/** A strip of tape centred on (cx, cy). */
function tape(ctx: CanvasRenderingContext2D, cx: number, cy: number, width: number, degrees: number): void {
  rotated(ctx, degrees, cx, cy, () => {
    ctx.fillStyle = TAPE
    ctx.fillRect(cx - width / 2, cy - 22, width, 44)
  })
}

/** A white card with a soft shadow under it. */
function paperCard(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill = CARD): void {
  ctx.fillStyle = SHADOW
  ctx.fillRect(x + 3, y + 6, width, height)
  ctx.fillStyle = fill
  ctx.fillRect(x, y, width, height)
}

/**
 * Draws the 1080×1920 share card: cream paper, "my 2026 in texts" in handwriting, a postage stamp with your top emoji,
 * a taped polaroid with your personality, a CERTIFIED stamp, taped stat notes, award chips and the site in the footer.
 */
export async function drawYouCard(canvas: HTMLCanvasElement, card: YouCard): Promise<void> {
  await loadFonts(card)
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  drawHeading(ctx, card.year)
  if (card.topEmoji) drawPostage(ctx, card.topEmoji, card.year)
  drawPolaroid(ctx, card.personality)
  const stats = cardStats(card)
  notePositions(stats.length).forEach((at, i) => drawNote(ctx, stats[i]!, at.x, at.y, i))
  drawCertified(ctx, card.year)
  drawAwards(ctx, card.awards)
  drawFooter(ctx)
  drawGrain(ctx)
}

/** "my 2026" / "in texts", handwritten in two lines at the top left. */
function drawHeading(ctx: CanvasRenderingContext2D, year: string): void {
  const left = 84
  rotated(ctx, -4, left, 260, () => {
    ctx.fillStyle = ORANGE
    ctx.textBaseline = 'alphabetic'
    ;[`my ${year}`, 'in texts'].forEach((line, i) => {
      const fitted = fitText(ctx, line, 700, 160, 640, 80, HAND)
      ctx.fillText(fitted.text, left, 270 + i * 130)
    })
  })
}

/** A perforated postage stamp holding the top emoji, with a round postmark over its corner. */
function drawPostage(ctx: CanvasRenderingContext2D, emoji: string, year: string): void {
  const x = 790
  const y = 120
  const width = 210
  const height = 250
  rotated(ctx, 6, x + width / 2, y + height / 2, () => {
    paperCard(ctx, x, y, width, height)
    // The perforations: paper-coloured bites along every edge.
    ctx.fillStyle = PAPER
    const r = 9
    for (let px = x; px <= x + width + 1; px += width / 8) {
      for (const py of [y, y + height]) {
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    for (let py = y; py <= y + height + 1; py += height / 10) {
      for (const px of [x, x + width]) {
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.fillStyle = PINK
    ctx.fillRect(x + 22, y + 22, width - 44, height - 44)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = MUTED
    ctx.font = fontFor(800, 20)
    ctx.fillText('TOP EMOJI', x + width / 2, y + 48)
    ctx.font = fontFor(500, 104)
    ctx.fillText(emoji, x + width / 2, y + height / 2 + 18)
    ctx.textAlign = 'left'
  })

  // The postmark: an ink ring with the year, and wavy cancel lines running left.
  const cx = 800
  const cy = 360
  ctx.save()
  ctx.globalAlpha = 0.6
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(cx, cy, 70, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, 58, 0, Math.PI * 2)
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = fontFor(800, 34)
  ctx.fillText(year, cx, cy)
  ctx.lineWidth = 4
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath()
    ctx.moveTo(cx - 80, cy + i * 22)
    for (let step = 1; step <= 6; step++) {
      const wx = cx - 80 - step * 26
      ctx.quadraticCurveTo(wx + 13, cy + i * 22 + (step % 2 ? -9 : 9), wx, cy + i * 22)
    }
    ctx.stroke()
  }
  ctx.textAlign = 'left'
  ctx.restore()
}

/** The polaroid: the personality name on the dark "photo", its line handwritten underneath. */
function drawPolaroid(ctx: CanvasRenderingContext2D, personality: Personality): void {
  const x = 150
  const y = 450
  const width = 780
  const height = 620
  const inset = 34
  const photoWidth = width - inset * 2
  const photoHeight = 400
  rotated(ctx, -3, x + width / 2, y + height / 2, () => {
    paperCard(ctx, x, y, width, height)
    ctx.fillStyle = INK
    ctx.fillRect(x + inset, y + inset, photoWidth, photoHeight)

    const cx = x + width / 2
    ctx.textAlign = 'center'
    ctx.fillStyle = PAPER
    ctx.textBaseline = 'top'
    ctx.font = fontFor(500, 26)
    ctx.fillText('MY TEXTING PERSONALITY', cx, y + inset + 40)

    // One line if it fits at full size; otherwise two, split at a space, both the same size.
    const full = 124
    const maxWidth = photoWidth - 80
    ctx.font = fontFor(800, full)
    const rows = ctx.measureText(personality.name).width <= maxWidth ? [personality.name] : splitTitle(personality.name)
    const px = Math.min(...rows.map((row) => fitText(ctx, row, 800, full, maxWidth, 56).px))
    const middle = y + inset + photoHeight / 2 + 24
    ctx.textBaseline = 'middle'
    rows.forEach((row, i) => {
      const fitted = fitText(ctx, row, 800, px, maxWidth, px)
      ctx.fillText(fitted.text, cx, middle + (i - (rows.length - 1) / 2) * px * 0.95)
    })

    // The line, handwritten in the bottom margin in up to two lines, left of the CERTIFIED stamp.
    // A longer line gets smaller writing until it fits in two lines.
    ctx.fillStyle = INK
    const captionWidth = photoWidth - 200
    const captionCentre = x + inset + captionWidth / 2
    let captionPx = 58
    ctx.font = fontFor(700, captionPx, HAND)
    while (captionPx > 40 && wrapLines(ctx, personality.line, captionWidth).length > 2) {
      captionPx -= 4
      ctx.font = fontFor(700, captionPx, HAND)
    }
    const lines = wrapLines(ctx, personality.line, captionWidth).slice(0, 2)
    const captionMiddle = y + inset + photoHeight + (height - inset - photoHeight) / 2
    lines.forEach((line, i) => {
      const fitted = fitText(ctx, line, 700, captionPx, captionWidth, 32, HAND)
      ctx.fillText(fitted.text, captionCentre, captionMiddle + (i - (lines.length - 1) / 2) * captionPx * 1.05)
    })
    ctx.textAlign = 'left'
  })
  tape(ctx, x + width / 2, y - 2, 220, -5)
}

/** A red rubber stamp, "CERTIFIED", over the polaroid's bottom right corner. */
function drawCertified(ctx: CanvasRenderingContext2D, year: string): void {
  const cx = 880
  const cy = 1030
  const r = 104
  rotated(ctx, 12, cx, cy, () => {
    ctx.save()
    ctx.globalAlpha = 0.88
    ctx.strokeStyle = RED
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, cy, r - 16, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = RED
    ctx.fillRect(cx - r - 14, cy - 30, (r + 14) * 2, 60)
    ctx.fillStyle = PAPER
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = fontFor(800, 44)
    ctx.fillText('CERTIFIED', cx, cy + 2)
    ctx.fillStyle = RED
    ctx.font = fontFor(800, 24)
    ctx.fillText('★ ★ ★', cx, cy - 58)
    ctx.fillText(year, cx, cy + 60)
    ctx.textAlign = 'left'
    ctx.restore()
  })
}

/** A taped white note: a big number in colour and a handwritten label. */
function drawNote(ctx: CanvasRenderingContext2D, stat: CardStat, x: number, y: number, i: number): void {
  const tilt = [-1.5, 1.2, 1, -1.2][i % 4]!
  rotated(ctx, tilt, x + NOTE_WIDTH / 2, y + NOTE_HEIGHT / 2, () => {
    paperCard(ctx, x, y, NOTE_WIDTH, NOTE_HEIGHT)
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = NOTE_INKS[i % NOTE_INKS.length]!
    const value = fitText(ctx, stat.value, 800, 96, NOTE_WIDTH - 64, 40)
    ctx.fillText(value.text, x + 32, y + 118)
    ctx.fillStyle = MUTED
    const label = fitText(ctx, stat.label, 700, 46, NOTE_WIDTH - 64, 28, HAND)
    ctx.fillText(label.text, x + 32, y + 166)
  })
  tape(ctx, x + NOTE_WIDTH / 2, y, 130, i % 2 ? 4 : -4)
}

/** Your awards as white chips, a star then the title, in up to two rows; any that don't fit are left off. */
function drawAwards(ctx: CanvasRenderingContext2D, awards: string[]): void {
  const left = 80
  const right = WIDTH - 80
  const height = 68
  const gap = 18
  let x = left
  let y = 1600
  awards.forEach((title, i) => {
    const text = `★ ${title}`
    const fitted = fitText(ctx, text, 700, 44, right - left - 40, 30, HAND)
    const width = ctx.measureText(fitted.text).width + 40
    if (x > left && x + width > right) {
      x = left
      y += height + 16
    }
    if (y > 1600 + height + 16) return
    rotated(ctx, i % 2 ? 1.5 : -1.5, x + width / 2, y + height / 2, () => {
      paperCard(ctx, x, y, width, height)
      ctx.fillStyle = i % 2 ? INK : RED
      ctx.textBaseline = 'middle'
      ctx.font = fontFor(700, fitted.px, HAND)
      ctx.fillText(fitted.text, x + 20, y + height / 2 + 2)
    })
    x += width + gap
  })
}

/** A dashed rule and the site, so anyone who sees the card knows where to make one. */
function drawFooter(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = 'rgba(43, 33, 24, 0.3)'
  ctx.lineWidth = 3
  ctx.setLineDash([14, 12])
  ctx.beginPath()
  ctx.moveTo(80, 1800)
  ctx.lineTo(WIDTH - 80, 1800)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = MUTED
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = fontFor(800, 36)
  ctx.fillText(FOOTER, WIDTH / 2, 1862)
  ctx.textAlign = 'left'
}

/** A light paper grain over everything: tiny dots from a fixed seed, so every card looks the same. */
function drawGrain(ctx: CanvasRenderingContext2D): void {
  let seed = 2026
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  ctx.fillStyle = 'rgba(43, 33, 24, 0.05)'
  for (let i = 0; i < 14000; i++) ctx.fillRect(random() * WIDTH, random() * HEIGHT, 2, 2)
}
