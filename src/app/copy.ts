import type { HistoryCheck } from './history'
import type { StopReason } from './serve'
import type { Update } from './update'

/** The first line in the terminal; clack draws it as a label, so it keeps a space on each side. */
export const INTRO = ' iMessage Wrapped (beta) '
/** The small tag next to the title on the landing page. */
export const BETA_TAG = 'Beta'

/**
 * First run only. `addedToPath`: the installer's line is in a shell startup file (see shellStartup.ts). Never claim it otherwise.
 * `counting`: the anonymous tallies are on (count.ts); the note is left out when they're already off.
 */
export function welcomeLines(addedToPath: boolean, counting = true): string[] {
  return [
    'Makes your wraps from Messages on this Mac.',
    ...(counting ? [COUNT_NOTICE] : []),
    ...(addedToPath ? ['Added  wrapped  to your shell\'s startup file. To undo, delete the line marked "added by iMessage Wrapped".'] : []),
  ]
}
export const COUNT_NOTICE = 'Counts launches, wraps made and wraps sent as anonymous daily tallies. WRAPPED_NO_COUNT=1 turns it off.'

/** How to start it again. Right after installing, this shell doesn't know  wrapped  yet (see onPath), but a new window does. */
function typeWrapped(onPath: boolean): string {
  return onPath ? 'Type  wrapped' : 'In a new window, type  wrapped'
}

/** The terminal's status once the page is open. The rest happens in the browser. */
export function openLines(url: string): string[] {
  return [`iMessage Wrapped is open in your browser: ${url}`, 'Keep this window open. Press o to reopen the page, q to quit.']
}

/** The terminal's last line. */
export function stoppedLine(reason: StopReason, onPath = true): string {
  if (reason === 'idle') return `The page was closed, so iMessage Wrapped stopped. ${typeWrapped(onPath)}  to open it again.`
  return `iMessage Wrapped is closed. ${typeWrapped(onPath)}  to open it again.`
}

/** After saying no to "Keep going anyway?". */
export function laterLine(onPath = true): string {
  return `Okay. ${typeWrapped(onPath)}  when you are ready.`
}

/** The update notice, in the terminal and as a banner on the home page. */
export function updateLine(update: Update): string {
  return `Update available: ${update.current} → ${update.latest}. Run: wrapped update`
}

/** After  wrapped update. The installer swaps the program in one step, so a failure leaves the old one working. */
export function updatedLine(version: string | null): string {
  return `Updated${version ? ` to ${version}` : ''}. Type  wrapped  to start it.`
}
export const UPDATE_FAILED = "The update didn't finish, so nothing changed. Check your internet and try  wrapped update  again."

/**
 * Printed just before the Full Disk Access page opens, so it's read before System Settings covers the terminal.
 * `resume`: the marker is written and the startup line will start the app again after "Quit & Reopen" (resume.ts).
 * The last line is the hint for when the app isn't in the list.
 */
export function accessSteps(terminal: string, { resume, inTmux = false }: { resume: boolean; inTmux?: boolean }): string[] {
  const folder = terminal === 'Terminal' ? 'Applications → Utilities' : 'Applications'
  return [
    resume
      ? `Turn on ${terminal} in the window that's about to open, then click "Quit & Reopen". Wrapped picks up by itself.`
      : `Turn on ${terminal} in the window that's about to open, click "Quit & Reopen", then type  wrapped  again.`,
    ...(inTmux ? ['Also quit tmux: run  tmux kill-server'] : []),
    `(Not listed? Click + and choose ${terminal} from ${folder}.)`,
  ]
}

/** The run that started by itself after "Quit & Reopen" still can't read Messages. */
export function stillNoAccess(terminal: string): string {
  return `${terminal.charAt(0).toUpperCase()}${terminal.slice(1)} still can't read Messages.`
}

export const MISSING_DB =
  "Messages isn't set up on this Mac. Sign in to Messages, turn on Messages in iCloud (Messages → Settings → iMessage), wait for it to sync, then type  wrapped  again."

/** Shown when Messages can't be read and we didn't just walk through accessSteps (e.g. the --check run). */
export function noAccess(terminal: string): string {
  return `macOS keeps Messages private. Turn on ${terminal} in System Settings → Privacy & Security → Full Disk Access, click "Quit & Reopen", then type  wrapped  again.`
}

const monthYear = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

export function historyLine(check: Exclude<HistoryCheck, { kind: 'empty' }>): string {
  if (check.kind === 'ok') return `Your messages go back to ${monthYear(check.since)}`
  if (check.kind === 'stale') {
    return `The newest message on this Mac is from ${monthYear(check.until)}. Messages may have stopped syncing: click Sync Now in Messages → Settings → iMessage.`
  }
  return `Your messages only go back to ${monthYear(check.since)}. If you just set up this Mac, Messages may still be syncing from iCloud, or "Keep messages" (Messages → Settings → General) may be set to 30 days or 1 year.`
}

export const NO_MESSAGES_THIS_PERIOD = 'No messages found for this period on this Mac.'
