/**
 * Breaks text into lines of at most `width` characters, at spaces only. clack's log lines don't wrap, and the
 * terminal's own wrapping splits words in the middle, so long lines are wrapped here at the terminal's real width.
 * Unknown width: the text stays as it is. A word longer than a line (a link) keeps a line of its own.
 * Double spaces inside a line (around a command, like  wrapped ) are kept.
 */
export function wrapText(text: string, width: number | undefined): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let rest = paragraph
    while (width && rest.length > width) {
      let cut = rest.lastIndexOf(' ', width)
      if (cut <= 0) cut = rest.indexOf(' ', width)
      if (cut <= 0) break
      lines.push(rest.slice(0, cut).trimEnd())
      rest = rest.slice(cut).trimStart()
    }
    lines.push(rest)
  }
  return lines
}
