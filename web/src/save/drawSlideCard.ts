import { HAND, fitText, fontFor, splitTitle } from '../maker/canvasText'
import {
  AWARD_PAPER, FOOTER, HEIGHT, INK, MUTED, ORANGE, PAPER, PINK, RED, WIDTH,
  drawFooter, drawGrain, loadFonts, paperCard, rotated, tape, wrapLines,
} from '../maker/canvasPaper'
import { drawGroupCard, drawYouCard } from '../maker/youCard'
import type { AwardCard, HitsCard, PageContent, SlideCard, WordsCard } from './slideCards'

/**
 * Draws a saved slide as a 1080×1920 story image, in the same scrapbook style as the slide: the slide's heading and
 * content on paper, and the site in the footer. Drawn on a canvas rather than copied from the page, so the fonts come
 * out right on iOS Safari.
 */

const LEFT = 84
const RIGHT = WIDTH - 84
/** content stays above the footer's dashed rule (at 1800) */
const BOTTOM = 1740

/** Every piece of text on the card, so the fonts are loaded for all of it. */
function textOf(card: PageContent): string {
  switch (card.kind) {
    case 'hits':
      return card.quotes.flatMap((q) => [q.text, q.who, q.reactions, q.when]).join(' ') + ' Greatest hits “”·'
    case 'words':
      return [card.heading, ...card.words.flatMap((w) => [w.word, w.count]), ...card.emoji, ...card.signatures.flatMap((s) => [s.says, s.word]), 'Top words & phrases emoji “”'].join(' ')
    case 'award':
      return [card.title, card.year, card.winner, card.label, 'CERTIFIED and the award for… goes to ★'].join(' ')
  }
}

export async function drawSlideCard(canvas: HTMLCanvasElement, card: SlideCard): Promise<void> {
  // The summary page's cards are the share cards themselves.
  if (card.kind === 'you') return drawYouCard(canvas, card.card)
  if (card.kind === 'group') return drawGroupCard(canvas, card.card)
  await loadFonts(`${textOf(card)} ${card.kicker} ${FOOTER}`)
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  ctx.textAlign = 'left'
  ctx.fillStyle = card.kind === 'award' ? AWARD_PAPER : PAPER
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  drawKicker(ctx, card.kicker)
  if (card.kind === 'hits') drawHits(ctx, card)
  else if (card.kind === 'words') drawWords(ctx, card)
  else drawAward(ctx, card)
  drawFooter(ctx)
  drawGrain(ctx)
}

/** "POKER NIGHT · WRAPPED 2026", small and spaced out at the top. */
function drawKicker(ctx: CanvasRenderingContext2D, kicker: string): void {
  ctx.save()
  if ('letterSpacing' in ctx) ctx.letterSpacing = '5px'
  ctx.fillStyle = MUTED
  ctx.textBaseline = 'alphabetic'
  const fitted = fitText(ctx, kicker.toUpperCase(), 500, 30, RIGHT - LEFT, 22)
  ctx.fillText(fitted.text, LEFT, 150)
  ctx.restore()
}

/** The slide's heading in heavy type, in up to two lines; returns where its last line sits. */
function drawHeading(ctx: CanvasRenderingContext2D, text: string, top: number): number {
  let px = 136
  ctx.font = fontFor(800, px)
  while (px > 80 && wrapLines(ctx, text, RIGHT - LEFT).length > 2) {
    px -= 8
    ctx.font = fontFor(800, px)
  }
  const lines = wrapLines(ctx, text, RIGHT - LEFT).slice(0, 2)
  ctx.fillStyle = INK
  ctx.textBaseline = 'alphabetic'
  let y = top
  lines.forEach((line, i) => {
    y = top + i * px * 0.95
    const fitted = fitText(ctx, line, 800, px, RIGHT - LEFT, px)
    ctx.fillText(fitted.text, LEFT - 4, y)
  })
  return y
}

// ---------- Greatest hits ----------

const QUOTE_X = 110
const QUOTE_WIDTH = WIDTH - QUOTE_X * 2
const QUOTE_PAD = 52
const QUOTE_GAP = 70
const MAX_QUOTE_LINES = 6
const MIN_QUOTE_PX = 36
const QUOTE_TILTS = [-1.5, 1.2, -0.6]
/** a short quote's card is narrower than the page, but not narrower than this */
const MIN_QUOTE_WIDTH = 620

/** `width` fits the card to its quote. `cut` when the quote was too long for MAX_QUOTE_LINES and ends in an ellipsis. */
type QuoteLayout = { lines: string[]; captions: string[][]; width: number; height: number; cut: boolean }

/**
 * Each quote's lines and caption at `px`, and the card's height. The caption is the name and reactions with the date
 * beside them, or under them when both don't fit on one line.
 */
function layoutQuote(ctx: CanvasRenderingContext2D, quote: HitsCard['quotes'][number], px: number): QuoteLayout {
  const inner = QUOTE_WIDTH - QUOTE_PAD * 2
  ctx.font = fontFor(800, px)
  let lines = wrapLines(ctx, `“${quote.text}”`, inner)
  const cut = lines.length > MAX_QUOTE_LINES
  if (cut) {
    // The last line loses words until it fits with "…”" on the end.
    lines = lines.slice(0, MAX_QUOTE_LINES)
    let last = lines[MAX_QUOTE_LINES - 1]!
    while (last.includes(' ') && ctx.measureText(`${last}…”`).width > inner) last = last.slice(0, last.lastIndexOf(' '))
    lines[MAX_QUOTE_LINES - 1] = `${last}…”`
  }
  const widest = Math.max(...lines.map((line) => ctx.measureText(line).width))
  const capPx = captionPx(px)
  ctx.font = fontFor(700, capPx, HAND)
  const who = `${quote.who} · ${quote.reactions}`
  const captionWidth = ctx.measureText(who).width + 60 + ctx.measureText(quote.when).width
  const together = captionWidth <= inner
  const captions = together ? [[who, quote.when]] : [[who], [quote.when]]
  const width = Math.min(QUOTE_WIDTH, Math.max(MIN_QUOTE_WIDTH, Math.max(widest, together ? captionWidth : 0) + QUOTE_PAD * 2))
  const height = QUOTE_PAD * 0.8 + lines.length * px * 1.18 + 20 + captions.length * capPx * 1.15 + QUOTE_PAD * 0.6
  return { lines, captions, width, height, cut }
}

const captionPx = (px: number) => Math.min(52, Math.max(34, Math.round(px * 0.72)))

function drawHits(ctx: CanvasRenderingContext2D, card: HitsCard): void {
  drawHeading(ctx, 'Greatest hits', 330)

  // The biggest type at which every quote fits, whole, between the heading and the footer. Short quotes get big type.
  const top = 450
  let px = card.quotes.length > 1 ? 96 : 120
  let layouts: QuoteLayout[] = []
  const total = () => layouts.reduce((sum, l) => sum + l.height, 0) + QUOTE_GAP * (layouts.length - 1)
  for (; px > MIN_QUOTE_PX; px -= 4) {
    layouts = card.quotes.map((q) => layoutQuote(ctx, q, px))
    if (total() <= BOTTOM - top && !layouts.some((l) => l.cut)) break
  }
  if (px <= MIN_QUOTE_PX) {
    px = MIN_QUOTE_PX
    layouts = card.quotes.map((q) => layoutQuote(ctx, q, px))
  }

  // Any room left over goes a little more below the quotes than above them. The cards sit left, right, left.
  let y = top + Math.max(0, (BOTTOM - top - total()) * 0.4)
  layouts.forEach((layout, i) => {
    const tilt = QUOTE_TILTS[i % QUOTE_TILTS.length]!
    const x = i % 2 ? WIDTH - QUOTE_X - layout.width : QUOTE_X
    rotated(ctx, tilt, x + layout.width / 2, y + layout.height / 2, () => {
      paperCard(ctx, x, y, layout.width, layout.height)
      const left = x + QUOTE_PAD
      const inner = layout.width - QUOTE_PAD * 2
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = INK
      let baseline = y + QUOTE_PAD * 0.8 + px * 0.92
      for (const line of layout.lines) {
        const fitted = fitText(ctx, line, 800, px, inner, px)
        ctx.fillText(fitted.text, left, baseline)
        baseline += px * 1.18
      }
      const capPx = captionPx(px)
      baseline += 20 - px * 0.18 + capPx * 0.2
      ctx.fillStyle = MUTED
      for (const row of layout.captions) {
        const whoFit = fitText(ctx, row[0]!, 700, capPx, inner, 28, HAND)
        ctx.fillText(whoFit.text, left, baseline)
        if (row[1]) {
          ctx.font = fontFor(700, Math.round(capPx * 0.86), HAND)
          ctx.textAlign = 'right'
          ctx.fillText(row[1], left + inner, baseline)
          ctx.textAlign = 'left'
        }
        baseline += capPx * 1.15
      }
    })
    // Tape over the top edge: the first and third a little left of the middle, the second near the left.
    const tapeX = i % 2 ? x + layout.width * 0.2 : x + layout.width * 0.42
    tape(ctx, tapeX, y + 2, 190, i % 2 ? 5 : -6)
    y += layout.height + QUOTE_GAP
  })
}

// ---------- Vocabulary ----------

const ROW = 96
const CHIP_HEIGHT = 92
const CHIP_GAP = 22
const CHIP_ROW_GAP = 30

const CHIP_PAD = 28
const SAYS_PX = 38
const SAID_PX = 56

type Chip = { says: string; word: string; wordWidth: number; width: number; x: number; y: number }

/** Lays the signature chips out in rows, each row centred on the page; returns them and the height they take. */
function layoutChips(ctx: CanvasRenderingContext2D, signatures: WordsCard['signatures']): { chips: Chip[]; height: number } {
  const rows: Chip[][] = [[]]
  let x = LEFT
  let y = 0
  for (const s of signatures) {
    ctx.font = fontFor(500, SAYS_PX)
    const saysWidth = ctx.measureText(`${s.says} `).width
    ctx.font = fontFor(700, SAID_PX, HAND)
    const wordWidth = ctx.measureText(`“${s.word}”`).width
    const width = Math.min(RIGHT - LEFT, saysWidth + wordWidth + CHIP_PAD * 2)
    if (x > LEFT && x + width > RIGHT) {
      x = LEFT
      y += CHIP_HEIGHT + CHIP_ROW_GAP
      rows.push([])
    }
    rows.at(-1)!.push({ ...s, wordWidth, width, x, y })
    x += width + CHIP_GAP
  }
  for (const row of rows) {
    const used = row.reduce((sum, chip) => sum + chip.width, 0) + CHIP_GAP * (row.length - 1)
    const shift = (RIGHT - LEFT - used) / 2
    for (const chip of row) chip.x += shift
  }
  const chips = rows.flat()
  return { chips, height: chips.length ? y + CHIP_HEIGHT : 0 }
}

function drawWords(ctx: CanvasRenderingContext2D, card: WordsCard): void {
  const headingBottom = drawHeading(ctx, card.heading, 300)

  const hasWords = card.words.length > 0
  const hasEmoji = card.emoji.length > 0
  // The notebook page on the left, the emoji sticky note beside it, like the slide; either one alone gets more room.
  const noteWidth = hasEmoji ? 270 : 0
  const bookWidth = hasWords ? RIGHT - LEFT - (hasEmoji ? noteWidth + 40 : 0) : 0
  const bookHeight = hasWords ? 130 + card.words.length * ROW + 30 : 0
  const emojiCols = hasWords ? 2 : Math.min(card.emoji.length, 5)
  const noteHeight = hasEmoji ? 120 + Math.ceil(card.emoji.length / emojiCols) * 110 + 20 : 0
  const { chips, height: chipsHeight } = layoutChips(ctx, card.signatures)
  const notesHeight = Math.max(bookHeight, noteHeight + 30)
  const total = notesHeight + (chipsHeight ? 80 + chipsHeight : 0)

  const top = headingBottom + 90
  let y = top + Math.max(0, (BOTTOM - top - total) / 2)

  if (hasWords) drawNotebook(ctx, card.words, LEFT, y, bookWidth, bookHeight)
  if (hasEmoji) {
    const width = hasWords ? noteWidth : Math.min(RIGHT - LEFT, emojiCols * 120 + 80)
    const x = hasWords ? RIGHT - noteWidth : (WIDTH - width) / 2
    drawEmojiNote(ctx, card.emoji, x, y + (hasWords ? 30 : 0), width, noteHeight, emojiCols)
  }
  y += notesHeight + 80
  chips.forEach((chip, i) => drawChip(ctx, chip, chip.x, y + chip.y, i))
}

/** A lined notebook card: "Top words & phrases", then each word with its count on a ruled line. */
function drawNotebook(ctx: CanvasRenderingContext2D, words: WordsCard['words'], x: number, y: number, width: number, height: number): void {
  rotated(ctx, -1, x + width / 2, y + height / 2, () => {
    paperCard(ctx, x, y, width, height)
    const pad = 40
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = ORANGE
    const label = fitText(ctx, 'Top words & phrases', 700, 60, width - pad * 2, 36, HAND)
    ctx.fillText(label.text, x + pad, y + 86)
    ctx.strokeStyle = 'rgba(29, 78, 216, 0.18)'
    ctx.lineWidth = 3
    words.forEach((w, i) => {
      const rowTop = y + 130 + i * ROW
      ctx.beginPath()
      ctx.moveTo(x, rowTop)
      ctx.lineTo(x + width, rowTop)
      ctx.stroke()
      ctx.font = fontFor(700, 52, HAND)
      const countWidth = ctx.measureText(w.count).width
      ctx.fillStyle = INK
      const word = fitText(ctx, w.word, 800, 60, width - pad * 2 - countWidth - 24, 34)
      ctx.fillText(word.text, x + pad, rowTop + ROW - 26)
      ctx.fillStyle = MUTED
      ctx.font = fontFor(700, 52, HAND)
      ctx.textAlign = 'right'
      ctx.fillText(w.count, x + width - pad, rowTop + ROW - 26)
      ctx.textAlign = 'left'
    })
    // The notebook's red margin line.
    ctx.strokeStyle = 'rgba(190, 18, 60, 0.25)'
    ctx.beginPath()
    ctx.moveTo(x + 22, y + 110)
    ctx.lineTo(x + 22, y + height)
    ctx.stroke()
  })
}

/** A pink sticky note with the top emoji, taped on at an angle. */
function drawEmojiNote(ctx: CanvasRenderingContext2D, emoji: string[], x: number, y: number, width: number, height: number, cols: number): void {
  rotated(ctx, 4, x + width / 2, y + height / 2, () => {
    paperCard(ctx, x, y, width, height, PINK)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = ORANGE
    ctx.font = fontFor(700, 56, HAND)
    ctx.fillText('Top emoji', x + width / 2, y + 84)
    ctx.textBaseline = 'middle'
    ctx.font = fontFor(500, 84)
    const cell = 120
    emoji.forEach((e, i) => {
      const row = Math.floor(i / cols)
      const inRow = Math.min(cols, emoji.length - row * cols)
      const col = i % cols
      const cx = x + width / 2 + (col - (inRow - 1) / 2) * cell
      ctx.fillText(e, cx, y + 120 + row * 110 + 55)
    })
    ctx.textAlign = 'left'
  })
  tape(ctx, x + width / 2, y + 2, 150, -4)
}

/** A white chip: "Alex Chen says" and their word, handwritten in orange. */
function drawChip(ctx: CanvasRenderingContext2D, chip: Chip, x: number, y: number, i: number): void {
  rotated(ctx, i % 2 ? 1.5 : -1.5, x + chip.width / 2, y + CHIP_HEIGHT / 2, () => {
    paperCard(ctx, x, y, chip.width, CHIP_HEIGHT)
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = INK
    // Only a chip as wide as the page shrinks: the name gives way first, down to half the chip.
    const inner = chip.width - CHIP_PAD * 2
    const says = fitText(ctx, `${chip.says} `, 500, SAYS_PX, Math.max(inner - chip.wordWidth, inner / 2), 26)
    ctx.fillText(says.text, x + CHIP_PAD, y + 60)
    const saysWidth = ctx.measureText(says.text).width
    ctx.fillStyle = ORANGE
    const word = fitText(ctx, `“${chip.word}”`, 700, SAID_PX, inner - saysWidth, 32, HAND)
    ctx.fillText(word.text, x + CHIP_PAD + saysWidth, y + 62)
  })
}

// ---------- Awards ----------

function drawAward(ctx: CanvasRenderingContext2D, card: AwardCard): void {
  rotated(ctx, -3, LEFT, 330, () => {
    ctx.fillStyle = RED
    ctx.textBaseline = 'alphabetic'
    const fitted = fitText(ctx, 'and the award for…', 700, 112, RIGHT - LEFT, 60, HAND)
    ctx.fillText(fitted.text, LEFT, 330)
  })
  drawStamp(ctx, card.title, card.year, WIDTH / 2, 790)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = INK
  ctx.font = fontFor(700, 84, HAND)
  ctx.fillText('goes to', WIDTH / 2, 1250)

  // The winner on one line if it fits big enough, otherwise two.
  const maxWidth = RIGHT - LEFT
  ctx.font = fontFor(800, 200)
  const rows = ctx.measureText(card.winner).width <= maxWidth * 1.6 ? [card.winner] : splitTitle(card.winner)
  const px = Math.min(...rows.map((row) => fitText(ctx, row, 800, 200, maxWidth, 72).px))
  rows.forEach((row, i) => {
    const fitted = fitText(ctx, row, 800, px, maxWidth, px)
    ctx.fillText(fitted.text, WIDTH / 2, 1290 + px * 0.82 + i * px * 0.95)
  })
  const nameBottom = 1290 + px * 0.82 + (rows.length - 1) * px * 0.95

  // The number behind it on a white chip.
  const label = fitText(ctx, card.label, 500, 48, maxWidth - 80, 30)
  const chipWidth = ctx.measureText(label.text).width + 80
  const chipHeight = 100
  const chipY = Math.min(BOTTOM - chipHeight, nameBottom + 80)
  const chipX = (WIDTH - chipWidth) / 2
  rotated(ctx, 1.5, WIDTH / 2, chipY + chipHeight / 2, () => {
    paperCard(ctx, chipX, chipY, chipWidth, chipHeight)
    ctx.fillStyle = INK
    ctx.textBaseline = 'middle'
    ctx.font = fontFor(500, label.px)
    ctx.fillText(label.text, WIDTH / 2, chipY + chipHeight / 2 + 2)
  })
  ctx.textAlign = 'left'
}

/** The round CERTIFIED stamp: ink with a dashed ring around it, the award's title in the middle. */
function drawStamp(ctx: CanvasRenderingContext2D, title: string, year: string, cx: number, cy: number): void {
  const r = 300
  rotated(ctx, -6, cx, cy, () => {
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 7
    ctx.setLineDash([22, 16])
    ctx.beginPath()
    ctx.arc(cx, cy, r + 30, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = AWARD_PAPER
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.save()
    if ('letterSpacing' in ctx) ctx.letterSpacing = '8px'
    ctx.font = fontFor(500, 40)
    ctx.fillText('CERTIFIED', cx + 4, cy - 190)
    ctx.fillText(year, cx + 4, cy + 192)
    ctx.restore()

    // The title as big as fits: no word broken, at most three lines inside the circle.
    const maxWidth = 440
    let px = 124
    let lines: string[] = []
    for (; px >= 56; px -= 4) {
      ctx.font = fontFor(800, px)
      lines = wrapLines(ctx, title, maxWidth)
      const widest = Math.max(...lines.map((line) => ctx.measureText(line).width))
      if (lines.length <= 3 && widest <= maxWidth) break
    }
    px = Math.max(px, 56)
    lines = lines.slice(0, 3)
    lines.forEach((line, i) => {
      const fitted = fitText(ctx, line, 800, px, maxWidth, px)
      ctx.fillText(fitted.text, cx, cy + 6 + (i - (lines.length - 1) / 2) * px * 0.98)
    })
    ctx.textAlign = 'left'
  })
}
