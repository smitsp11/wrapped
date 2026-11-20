/** Text helpers for the share card's canvas: fonts, fitting a line to a width, and splitting a title in two. */

/** the smallest text fitText shrinks to before it cuts the text short */
const MIN_PX = 24

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
