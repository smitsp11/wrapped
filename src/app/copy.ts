import type { HistoryCheck } from './history'

/** The first line in the terminal; clack draws it as a label, so it keeps a space on each side. */
export const INTRO = ' iMessage Wrapped (beta) '
/** The small tag next to the title on the landing page. */
export const BETA_TAG = 'Beta'
/** The last thing the terminal says, and the Done panel's heading in the browser. */
export const DONE = 'All done ✓'

export const WELCOME_TITLE = 'iMessage Wrapped'
/** `addedToPath`: the installer's line is in a shell startup file (see shellStartup.ts). Never claim it otherwise. */
export function welcomeLines(addedToPath: boolean): string[] {
  return [
    'Your year in texts, made on your Mac.',
    '• Reads your Messages and Contacts, on this Mac only',
    '• You see everything before you share anything',
    ...(addedToPath
      ? ['• Added  wrapped  to your shell\'s startup file so you can type it next time (look for the line marked "added by iMessage Wrapped" to undo)']
      : []),
  ]
}

export function accessSteps(terminal: string, inTmux = false): string[] {
  return [
    'macOS keeps Messages private. We just opened the page:',
    '  System Settings → Privacy & Security → Full Disk Access',
    '',
    `  1. Turn on ${terminal}`,
    '     Not in the list? Click +, then pick it from Applications (Terminal is in Applications → Utilities)',
    "     macOS may ask for your Mac's password or Touch ID",
    ...(inTmux ? ['  Also quit tmux: run  tmux kill-server'] : []),
    '  2. Click "Quit & Reopen" when macOS asks',
    '  3. Open a new Terminal window, type  wrapped  and press Enter',
  ]
}

export const MISSING_DB =
  "Messages isn't set up on this Mac. Sign in to Messages, turn on Messages in iCloud (Messages → Settings → iMessage), wait for it to sync, then open a new Terminal window and type  wrapped  again."

/** Shown when Messages can't be read and we didn't just walk through accessSteps (e.g. the --check run). */
export function noAccess(terminal: string): string {
  return `macOS keeps Messages private. Open System Settings → Privacy & Security → Full Disk Access and turn on ${terminal}. Click "Quit & Reopen" when macOS asks, then open a new Terminal window and type  wrapped  again.`
}

const monthYear = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

export function historyLine(check: Exclude<HistoryCheck, { kind: 'empty' }>): string {
  if (check.kind === 'ok') return `Your messages go back to ${monthYear(check.since)}`
  if (check.kind === 'stale') {
    return `The newest message on this Mac is from ${monthYear(check.until)}. This Mac may have stopped syncing: turn on Messages in iCloud (Messages → Settings → iMessage), or click Sync Now there, and wait for it to catch up.`
  }
  return `Your messages only go back to ${monthYear(check.since)}. If you just set up this Mac, Messages may still be syncing from iCloud, or "Keep messages" (Messages → Settings → General) may be set to 30 days or 1 year.`
}

export const NO_MESSAGES_THIS_PERIOD = 'No messages found for this period on this Mac.'
