import { cancel, confirm, intro, isCancel, log, outro, select, spinner } from '@clack/prompts'
import { execFile } from 'node:child_process'
import { parseArgs } from 'node:util'
import { version } from '../../package.json'
import { parseYear } from '../cliHelpers'
import { MissingDatabaseError, WrappedError } from '../errors'
import { ContactBook } from '../extract/contactBook'
import { DEFAULT_CHAT_DB } from '../extract/messagesDb'
import { openBunSqlite } from '../extract/sqliteBun'
import { checkAccess, FULL_DISK_ACCESS_URL, terminalName } from './access'
import { Cancelled, onExit } from './cleanup'
import { createConvoMedia } from './convoMedia'
import { counter, countingOff } from './count'
import * as copy from './copy'
import { catchKeyboardErrors, listenForKeys, NO_KEYBOARD } from './keys'
import { openNewMessage } from './messagesApp'
import { fullYear, periodChoices, yearSoFar, type Period } from './period'
import { findWebDir, openBrowser, startServer } from './serve'
import { loadContactBook, openSession, type Session } from './session'
import { clearResume, claimResume, canResume, writeResume } from './resume'
import { canAutoResume, installerAddedToPath, onPath } from './shellStartup'
import { APP_DIR, hasConsented, saveConsent } from './store'
import { checkForUpdate, installedVersion, runUpdate, type Update } from './update'
import { wrapText } from './wrapText'

const SITE = (process.env.WRAPPED_SITE ?? 'https://wrapped.smitpatel.xyz').replace(/\/+$/, '')

export type Flags = {
  update: boolean
  version: boolean
  db: string
  check: boolean
  resumeCheck: boolean
  year: number
  yearGiven: boolean
  now: Date
}

/** Long enough to read the access line before System Settings covers the terminal. */
const SETTINGS_DELAY_MS = 1500

function parseFlags(): Flags {
  const { values, positionals } = parseArgs({
    options: {
      version: { type: 'boolean' },
      db: { type: 'string' },
      check: { type: 'boolean' },
      'resume-check': { type: 'boolean' },
      year: { type: 'string' },
      now: { type: 'string' },
    },
    allowPositionals: true,
  })
  const command = positionals[0]
  if (positionals.length > 1 || (command !== undefined && command !== 'update')) throw new WrappedError('The only command is  wrapped update.')
  return {
    update: command === 'update',
    version: values.version ?? false,
    db: values.db ?? DEFAULT_CHAT_DB,
    check: values.check ?? false,
    resumeCheck: values['resume-check'] ?? false,
    year: parseYear(values.year),
    yearGiven: values.year !== undefined,
    now: parseNow(values.now),
  }
}

/** Hidden flag for the smoke test: pretend today is this day (YYYY-MM-DD, local). */
function parseNow(text: string | undefined): Date {
  if (text === undefined) return new Date()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
  if (!match || !date || date.getMonth() !== Number(match[2]) - 1) throw new WrappedError('--now must be a date like 2026-03-10.')
  return date
}

/** Stops by throwing, so every `finally` (closing the database copy) runs before the program exits. */
function stop(message = 'No problem. Nothing was made.'): never {
  throw new Cancelled(message)
}

/**
 * Text for clack's lines, wrapped at this terminal's width so no word is split. clack draws a 3-column gutter
 * before each line; `joiner` indents the lines after the first where clack doesn't (outro, cancel).
 */
function fit(text: string, joiner = '\n'): string {
  const columns = process.stdout.columns
  return wrapText(text, columns ? columns - 4 : undefined).join(joiner)
}

/** First run only: what it does, the startup-file line if the installer added one, and Continue?. Later runs skip all of it. */
async function askConsent(): Promise<void> {
  if (hasConsented(APP_DIR)) return
  log.info(fit(copy.welcomeLines(installerAddedToPath(), !countingOff(process.env)).join('\n')))
  const yes = await confirm({ message: 'Continue?' })
  if (isCancel(yes) || !yes) stop()
  saveConsent(APP_DIR)
}

/**
 * True when Messages can be read. Otherwise: say what to do, then open the Full Disk Access page 1.5 s later,
 * so the line is read before System Settings covers the terminal, and return false (the run ends there).
 * Where the startup line can pick up after "Quit & Reopen", the resume marker is written just before Settings
 * opens. The resumed run never writes it again, so a switch left off can't loop.
 */
async function ensureAccess(dbPath: string, resumed: boolean): Promise<boolean> {
  const access = checkAccess(dbPath)
  if (access === 'missing') throw new MissingDatabaseError(dbPath)
  if (access === 'ok') return true
  const terminal = terminalName()
  const resume = !resumed && canResume(process.env) && canAutoResume()
  if (resumed) log.warn(copy.stillNoAccess(terminal))
  const steps = copy.accessSteps(terminal, { resume, inTmux: Boolean(process.env.TMUX) })
  log.info(fit(steps.slice(0, -1).join('\n')))
  outro(fit(steps.at(-1)!, '\n   '))
  await new Promise((resolve) => setTimeout(resolve, SETTINGS_DELAY_MS))
  if (resume) writeResume(APP_DIR, process.env, Date.now())
  await new Promise((resolve) => execFile('open', [FULL_DISK_ACCESS_URL], resolve))
  return false
}

async function choosePeriod(flags: Flags): Promise<Period> {
  if (flags.yearGiven) return flags.year === flags.now.getFullYear() ? yearSoFar(flags.year, flags.now) : fullYear(flags.year)
  const choices = periodChoices(flags.now)
  if (choices.length === 1) return choices[0]!
  const picked = await select({ message: 'Which year?', options: choices.map((p, i) => ({ value: i, label: p.label })) })
  if (isCancel(picked)) stop()
  return choices[picked]!
}

async function load(dbPath: string, period: Period, now: Date): Promise<Session> {
  const s = spinner()
  s.start('Reading your messages')
  const { contacts, note: contactsNote } = loadContactBook(openBunSqlite)
  const session = openSession({ openSqlite: openBunSqlite, dbPath, contacts, period, now })
  session.senderName() // reads every chat in the period once, here under the spinner rather than when the page opens
  s.stop(`Messages ✓  Contacts ✓ (${contacts.size.toLocaleString('en-US')} names)`)
  if (contactsNote) log.warn(fit(contactsNote))
  return session
}

async function confirmHistory(session: Session): Promise<void> {
  const { history } = session
  if (history.kind === 'empty') throw new WrappedError(copy.NO_MESSAGES_THIS_PERIOD)
  if (history.kind === 'ok') {
    log.success(fit(copy.historyLine(history)))
    return
  }
  // thin or stale: warn and let them decide.
  log.warn(fit(copy.historyLine(history)))
  const go = await confirm({ message: 'Keep going anyway?' })
  if (isCancel(go) || !go) stop(copy.laterLine(onPath()))
}

function webFound(): boolean {
  try {
    findWebDir()
    return true
  } catch {
    return false
  }
}

/** Counts only, for the smoke test and the real-data check: no names, no text. */
function printCheck(session: Session): void {
  const h = session.history
  const day = (d: Date) => d.toISOString().slice(0, 10)
  let since: string | null = null
  let until: string | null = null
  switch (h.kind) {
    case 'ok':
    case 'thin':
      since = day(h.since)
      break
    case 'stale':
      until = day(h.until)
      break
    case 'empty':
      break
  }
  console.log(JSON.stringify({ period: session.period.label, groups: session.groups.length, history: h.kind, since, until, web: webFound() }))
}

async function main(): Promise<void> {
  const flags = parseFlags()
  if (flags.version) {
    // Inlined from package.json at build time, so the compiled program knows its own version.
    console.log(version)
    return
  }
  if (flags.check) {
    // No Contacts: the check prints counts only, so names aren't needed (and it never touches the real address book).
    const session = openSession({ openSqlite: openBunSqlite, dbPath: flags.db, contacts: new ContactBook([]), period: fullYear(flags.year), now: flags.now })
    try {
      printCheck(session)
    } finally {
      session.close()
    }
    return
  }

  if (flags.update) {
    // The installer runs with WRAPPED_NO_RUN=1, so it replaces this program without starting a second copy.
    const code = await runUpdate(SITE)
    console.log(code === 0 ? copy.updatedLine(installedVersion(APP_DIR)) : copy.UPDATE_FAILED)
    process.exit(code)
  }

  if (flags.resumeCheck) {
    // From the shell startup line, in a new shell while the resume marker exists. Almost always this returns
    // at once; for the one shell that claims the marker, the run below picks up after "Quit & Reopen".
    if (!claimResume(APP_DIR, process.env, Date.now(), Boolean(process.stdin.isTTY && process.stdout.isTTY))) return
  } else {
    clearResume(APP_DIR) // started by hand: an earlier marker is no longer needed
  }

  catchKeyboardErrors(process.stdin, process, keyboardBroken, (err) => fail(err))
  // In the background, never awaited before the page opens. Resolves to null on any failure.
  const updateCheck = checkForUpdate(SITE, version)
  intro(copy.INTRO)
  await askConsent()
  findWebDir() // fail fast, before reading any messages
  // Exit now: Bun keeps waiting on a terminal it has read keys from (Continue?).
  if (!(await ensureAccess(flags.db, flags.resumeCheck))) process.exit(0)
  const period = await choosePeriod(flags)
  const session = await load(flags.db, period, flags.now)
  const unregister = onExit(() => session.close())
  try {
    await confirmHistory(session)
    await runInBrowser(session, updateCheck)
  } finally {
    unregister()
    session.close()
  }
  // The run is over. Exit now: Bun keeps waiting on a terminal it has read keys from, even once paused.
  process.exit(0)
}

/** Opens the page and keeps the server running until the page closes, the page's Close link, or q / Ctrl-C. */
async function runInBrowser(session: Session, updateCheck: Promise<Update | null>): Promise<void> {
  let update: Update | null = null
  // Converted photos sit in a temp folder until the run ends, however it ends.
  const media = createConvoMedia({ appDir: APP_DIR, attachmentFile: (guid) => session.attachmentFile(guid) })
  const unregister = onExit(() => media.close())
  try {
    const app = startServer({ site: SITE, session, appDir: APP_DIR, openMessages: openNewMessage, update: () => update, media, count: counter(SITE) })
    openBrowser(app.url)
    const [opened, keys] = copy.openLines(app.url)
    log.success(fit(opened!))
    log.message(fit(keys!))
    void updateCheck.then((found) => {
      update = found
      if (found) log.warn(fit(copy.updateLine(found)))
    })
    const stopKeys = listenForKeys(process.stdin, (action) => (action === 'open' ? openBrowser(app.url) : app.stop('quit')), keyboardBroken)
    const reason = await app.stopped
    stopKeys()
    outro(fit(copy.stoppedLine(reason, onPath()), '\n   '))
  } finally {
    unregister()
    media.close()
  }
}

/** The keyboard can't be read: one plain line, not a stack trace. Exiting runs the cleanup (the database copy). */
function keyboardBroken(): never {
  console.log(NO_KEYBOARD)
  process.exit(1)
}

function fail(err: unknown): never {
  if (err instanceof Cancelled) {
    cancel(fit(err.message, '\n   '))
    process.exit(0)
  }
  if (process.env.DEBUG) console.error(err)
  if (err instanceof WrappedError) cancel(fit(err.message, '\n   '))
  else cancel(fit(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`, '\n   '))
  process.exit(1)
}

main().catch(fail)
