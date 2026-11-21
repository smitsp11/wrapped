import { fontFor } from './canvasText'

/**
 * The scrapbook pieces shared by every 1080×1920 image we draw on a canvas (the personal share card, and the saved
 * slides): the palette, tape, white cards, the paper grain and the footer with the site.
 */

export const WIDTH = 1080
export const HEIGHT = 1920

export const PAPER = '#F6EEDF'
export const AWARD_PAPER = '#FDE2E4'
export const INK = '#2B2118'
export const MUTED = '#5C4A3A'
export const ORANGE = '#C2410C'
export const BLUE = '#1D4ED8'
export const RED = '#BE123C'
export const PINK = '#FDE2E4'
export const CARD = '#FFFFFF'
export const TAPE = 'rgba(255, 214, 102, 0.75)'
export const SHADOW = 'rgba(43, 33, 24, 0.15)'
export const FOOTER = 'wrapped.smitpatel.xyz'

/** Waits until our fonts are loaded for this text, so the canvas draws with them. If they can't load, it uses the system font. */
export async function loadFonts(text: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const faces = ['500 20px "Bricolage Grotesque"', '800 20px "Bricolage Grotesque"', '700 20px Caveat']
  try {
    await Promise.all(faces.map((face) => document.fonts.load(face, text)))
  } catch {
    // Drawn with system-ui instead.
  }
}

/** Runs `draw` with the canvas turned by `degrees` around (x, y), then turns it back. */
export function rotated(ctx: CanvasRenderingContext2D, degrees: number, x: number, y: number, draw: () => void): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.translate(-x, -y)
  draw()
  ctx.restore()
}

/** A strip of tape centred on (cx, cy). */
export function tape(ctx: CanvasRenderingContext2D, cx: number, cy: number, width: number, degrees: number): void {
  rotated(ctx, degrees, cx, cy, () => {
    ctx.fillStyle = TAPE
    ctx.fillRect(cx - width / 2, cy - 22, width, 44)
  })
}

/** A white card with a soft shadow under it. */
export function paperCard(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill = CARD): void {
  ctx.fillStyle = SHADOW
  ctx.fillRect(x + 3, y + 6, width, height)
  ctx.fillStyle = fill
  ctx.fillRect(x, y, width, height)
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

/** A dashed rule and the site, so anyone who sees the image knows where to make one. */
export function drawFooter(ctx: CanvasRenderingContext2D): void {
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

/** A light paper grain over everything: tiny dots from a fixed seed, so every image looks the same. */
export function drawGrain(ctx: CanvasRenderingContext2D): void {
  let seed = 2026
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  ctx.fillStyle = 'rgba(43, 33, 24, 0.05)'
  for (let i = 0; i < 14000; i++) ctx.fillRect(random() * WIDTH, random() * HEIGHT, 2, 2)
}
