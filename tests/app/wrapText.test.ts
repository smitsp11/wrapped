import { describe, expect, it } from 'vitest'
import { accessSteps, noAccess } from '../../src/app/copy'
import { wrapText } from '../../src/app/wrapText'

describe('wrapText', () => {
  it('breaks between words, never inside one, within the width', () => {
    for (const width of [36, 56, 76]) {
      const text = noAccess('Terminal')
      const lines = wrapText(text, width)
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(width)
      const words = (t: string) => t.split(/ +/)
      expect(words(lines.join(' '))).toEqual(words(text)) // every word whole, nothing lost
    }
  })
  it('keeps the double spaces around a command', () => {
    expect(wrapText('then type  wrapped  again.', 80)).toEqual(['then type  wrapped  again.'])
    expect(wrapText(accessSteps('Warp', { resume: false })[1]!, 56).join('\n')).toContain('type  wrapped  again.')
  })
  it('leaves the text alone when the width is unknown', () => {
    expect(wrapText('a b\nc', undefined)).toEqual(['a b', 'c'])
  })
  it('gives a word longer than the line (a link) a line of its own', () => {
    expect(wrapText('open http://127.0.0.1:5173/?t=abcdefghijklmnop now', 12)).toEqual(['open', 'http://127.0.0.1:5173/?t=abcdefghijklmnop', 'now'])
  })
})
