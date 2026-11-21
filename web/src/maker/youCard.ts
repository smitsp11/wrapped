import { formatMinutes } from '../../../src/format'
import type { Wrap } from '../../../src/types'
import { firstName } from '../../../src/wrap/names'
import { type Personality, personalityFor } from '../../../src/wrap/personality'
import { HAND, fitText, fontFor, splitTitle } from './canvasText'
import {
  FOOTER, HEIGHT, INK, MUTED, ORANGE, PAPER, PINK, RED, WIDTH,
  drawFooter, drawGrain, loadFonts, paperCard, rotated, tape, wrapLines,
} from './canvasPaper'

export { HEIGHT, WIDTH, wrapLines }

/**
 * The personal share card, "my 2026 in texts": your personality and your own numbers, nothing else.
 * The one name it holds is the first name of the person you texted most days in a row (see `streak`); it never holds
 * a full name, a phone number or email, a chat title, a quote or a word you texted.
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
  /**
   * Your longest streak: the most days in a row texting one person 1:1, and their first name (`with`). When the wrap
   * has no such streak (an older link, or under MIN_STREAK_DAYS) or only a masked number for them, the most days in a
   * row with any message, and no name.
   */
  streak?: { days: number; with?: string }
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

  const withName = solo.personStreak && Object.hasOwn(solo.people, solo.personStreak.personId)
    ? firstName(solo.people[solo.personStreak.personId]!)
    : ''
  // A masked number ("+1 ••• ••• 0101") isn't a name to put on a card you post.
  if (solo.personStreak && solo.personStreak.days >= MIN_STREAK_DAYS && withName && !withName.includes('•')) {
    card.streak = { days: solo.personStreak.days, with: withName }
  } else if (solo.timing.longestStreakDays >= MIN_STREAK_DAYS) {
    card.streak = { days: solo.timing.longestStreakDays }
  }

  const emoji = solo.words.topEmoji[0]?.emoji
  if (emoji) card.topEmoji = emoji
  return card
}

export type CardStat = { value: string; label: string }

/**
 * The group summary card, the last page of a group wrap: the chat's name, its total, its top word and a few award
 * winners, drawn like the personal card. Its data comes from groupCardFrom (web/src/summary.ts).
 */
export type GroupCard = {
  year: string
  /** the chat's name */
  title: string
  /** "Jan 1 → Nov 21" */
  period: string
  messages: number
  /** the top word or phrase, as on the vocabulary page */
  topWord?: string
  topEmoji?: string
  /** up to three, e.g. { title: 'Main Character', winner: 'Alex Chen' } */
  awards: { title: string; winner: string }[]
}

/** The group card's taped notes: the total, then the top word when there is one. */
export function groupCardStats(card: GroupCard): CardStat[] {
  const stats: CardStat[] = [{ value: card.messages.toLocaleString('en-US'), label: card.messages === 1 ? 'message' : 'messages' }]
  if (card.topWord) stats.push({ value: `“${card.topWord}”`, label: 'top word' })
  return stats
}

/** "★ Main Character · Alex Chen" */
export function groupAwardChip(award: GroupCard['awards'][number]): string {
  return `${award.title} · ${award.winner}`
}

/** The taped notes, in order: texts sent, peak hour, average reply, streak (whichever the card has). */
export function cardStats(card: YouCard): CardStat[] {
  const stats: CardStat[] = [{ value: card.textsSent.toLocaleString('en-US'), label: card.textsSent === 1 ? 'text sent' : 'texts sent' }]
  if (card.peakHour) stats.push({ value: card.peakHour, label: 'peak hour' })
  if (card.typicalReply) stats.push({ value: card.typicalReply, label: 'average reply' })
  if (card.streak) {
    const days = card.streak.days.toLocaleString('en-US')
    stats.push({ value: `${days} days`, label: card.streak.with ? `streak w ${card.streak.with}` : 'longest streak' })
  }
  return stats
}

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

const NOTE_INKS = ['#C2410C', '#1D4ED8', '#15803D', '#7E22CE']
/** Waits until the card's fonts are loaded for its text, so the canvas draws with them. */
function loadCardFonts(card: YouCard): Promise<void> {
  const stats = cardStats(card).flatMap((s) => [s.value, s.label])
  return loadFonts([`my ${card.year} in texts`, card.personality.name, card.personality.line, ...stats, ...card.awards, FOOTER].join(' '))
}

/**
 * Draws the 1080×1920 share card: cream paper, "my 2026 in texts" in handwriting, a postage stamp with your top emoji,
 * a taped polaroid with your personality, a CERTIFIED stamp, taped stat notes, award chips and the site in the footer.
 */
export async function drawYouCard(canvas: HTMLCanvasElement, card: YouCard): Promise<void> {
  await loadCardFonts(card)
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  drawHeading(ctx, [`my ${card.year}`, 'in texts'])
  if (card.topEmoji) drawPostage(ctx, card.topEmoji, card.year)
  drawPolaroid(ctx, 'MY TEXTING PERSONALITY', card.personality.name, card.personality.line)
  const stats = cardStats(card)
  notePositions(stats.length).forEach((at, i) => drawNote(ctx, stats[i]!, at.x, at.y, i))
  drawCertified(ctx, card.year)
  drawAwards(ctx, card.awards)
  drawFooter(ctx)
  drawGrain(ctx)
}

/** Where the group card's award chips start: under its one row of notes, one award to a row. */
const GROUP_AWARDS_TOP = 1420

/**
 * Draws the 1080×1920 group summary card, the same scrapbook as the personal one: "our 2026 in texts", the top emoji
 * on a stamp, a polaroid with the chat's name, notes with the total and top word, and the award winners as chips.
 */
export async function drawGroupCard(canvas: HTMLCanvasElement, card: GroupCard): Promise<void> {
  const stats = groupCardStats(card)
  const chips = card.awards.map(groupAwardChip)
  await loadFonts([`our ${card.year} in texts OUR GROUP CHAT`, card.title, card.period, ...stats.flatMap((s) => [s.value, s.label]), ...chips, FOOTER].join(' '))
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  drawHeading(ctx, [`our ${card.year}`, 'in texts'])
  if (card.topEmoji) drawPostage(ctx, card.topEmoji, card.year)
  drawPolaroid(ctx, 'OUR GROUP CHAT', card.title, card.period)
  notePositions(stats.length).forEach((at, i) => drawNote(ctx, stats[i]!, at.x, at.y, i))
  drawCertified(ctx, card.year)
  drawAwards(ctx, chips, GROUP_AWARDS_TOP, 3)
  drawFooter(ctx)
  drawGrain(ctx)
}

/** Two lines, like "my 2026" / "in texts", handwritten at the top left. */
function drawHeading(ctx: CanvasRenderingContext2D, lines: string[]): void {
  const left = 84
  rotated(ctx, -4, left, 260, () => {
    ctx.fillStyle = ORANGE
    ctx.textBaseline = 'alphabetic'
    lines.forEach((line, i) => {
      const fitted = fitText(ctx, line, 700, 160, 640, 80, HAND)
      ctx.fillText(fitted.text, left, 270 + i * 130)
    })
  })
}

/** A perforated postage stamp holding the top emoji under a small "TOP EMOJI", with a round postmark over its corner. */
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
    ctx.fillStyle = ORANGE
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

/** The polaroid: a small label and a big name on the dark "photo", and a line handwritten underneath. */
function drawPolaroid(ctx: CanvasRenderingContext2D, label: string, name: string, line: string): void {
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
    ctx.fillText(label, cx, y + inset + 40)

    // One line if it fits at full size; otherwise two, split at a space, both the same size.
    const full = 124
    const maxWidth = photoWidth - 80
    ctx.font = fontFor(800, full)
    const rows = ctx.measureText(name).width <= maxWidth ? [name] : splitTitle(name)
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
    while (captionPx > 40 && wrapLines(ctx, line, captionWidth).length > 2) {
      captionPx -= 4
      ctx.font = fontFor(700, captionPx, HAND)
    }
    const lines = wrapLines(ctx, line, captionWidth).slice(0, 2)
    const captionMiddle = y + inset + photoHeight + (height - inset - photoHeight) / 2
    lines.forEach((text, i) => {
      const fitted = fitText(ctx, text, 700, captionPx, captionWidth, 32, HAND)
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

/** Awards as white chips, a star then the text, in up to `maxRows` rows from `top`; any that don't fit are left off. */
function drawAwards(ctx: CanvasRenderingContext2D, awards: string[], top = 1600, maxRows = 2): void {
  const left = 80
  const right = WIDTH - 80
  const height = 68
  const gap = 18
  let x = left
  let y = top
  awards.forEach((title, i) => {
    const text = `★ ${title}`
    const fitted = fitText(ctx, text, 700, 44, right - left - 40, 30, HAND)
    const width = ctx.measureText(fitted.text).width + 40
    if (x > left && x + width > right) {
      x = left
      y += height + 16
    }
    if (y > top + (maxRows - 1) * (height + 16)) return
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


