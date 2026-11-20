import { cancel, confirm, intro, isCancel, log, note, outro, select, spinner } from '@clack/prompts'
import { execFile } from 'node:child_process'
import { parseArgs } from 'node:util'
import { version } from '../../package.json'
import { parseYear } from '../cliHelpers'
import { MissingDatabaseError, WrappedError } from '../errors'
import { ContactBook } from '../extract/contactBook'
import { DEFAULT_CHAT_DB } from '../extract/messagesDb'
import { openBunSqlite } from '../extract/sqliteBun'
import { checkAccess, FULL_DISK_ACCESS_URL, terminalName } from './access'
import { buildSelection, type BuildResult } from './build'
import { Cancelled, onExit } from './cleanup'
import * as copy from './copy'
import { openNewMessage } from './messagesApp'
import { fullYear, periodChoices, yearSoFar, type Period } from './period'
import { savedWrapsOption } from './savedWraps'
import { findWebDir, serveUntilDone } from './serve'
import { loadContactBook, openSession, type Session } from './session'
import { APP_DIR, hasConsented, listWraps, saveConsent } from './store'
import { pickInTerminal } from './terminalPicker'

const SITE = (process.env.WRAPPED_SITE ?? 'https://wrapped.smitpatel.xyz').replace(/\/+$/, '')

export type Flags = { version: boolean; db: string; picker: 'terminal' | 'browser'; check: boolean; year: number; yearGiven: boolean; now: Date }

function parseFlags(): Flags {
  const { values } = parseArgs({
    options: { version: { type: 'boolean' }, db: { type: 'string' }, picker: { type: 'string' }, check: { type: 'boolean' }, year: { type: 'string' }, now: { type: 'string' } },
  })
  const picker = values.picker ?? 'terminal'
  if (picker !== 'terminal' && picker !== 'browser') throw new WrappedError('--picker must be "terminal" or "browser".')
  return {
    version: values.version ?? false,
    db: values.db ?? DEFAULT_CHAT_DB,
    picker,
    check: values.check ?? false,
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

/** The closing line. clack only indents the first line, so the rest line up under it by hand. */
function done(): void {
  outro(copy.DONE_LINES.join('\n   '))
}

/** Stops by throwing, so every `finally` (closing the database copy) runs before the program exits. */
function stop(message = 'No problem. Nothing was made.'): never {
  throw new Cancelled(message)
}

async function askConsent(): Promise<void> {
  note(copy.WELCOME_LINES.join('\n'), copy.WELCOME_TITLE)
  if (hasConsented(APP_DIR)) return
  const yes = await confirm({ message: 'Continue?' })
  if (isCancel(yes) || !yes) stop()
  saveConsent(APP_DIR)
}

function ensureAccess(dbPath: string): void {
  const access = checkAccess(dbPath)
  if (access === 'missing') throw new MissingDatabaseError(dbPath)
  if (access === 'denied') {
    execFile('open', [FULL_DISK_ACCESS_URL], () => undefined)
    note(copy.accessSteps(terminalName(), Boolean(process.env.TMUX)).join('\n'), 'One switch to flip 🔑')
    throw new Cancelled('Open a new Terminal window and type  wrapped  again after you flip it.')
  }
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
  s.stop(`Messages ✓  Contacts ✓ (${contacts.size.toLocaleString('en-US')} names)`)
  if (contactsNote) log.warn(contactsNote)
  return session
}

async function confirmHistory(session: Session): Promise<void> {
  const { history } = session
  if (history.kind === 'empty') throw new WrappedError(copy.NO_MESSAGES_THIS_PERIOD)
  if (history.kind === 'ok') {
    log.success(copy.historyLine(history))
    return
  }
  // thin or stale: warn and let them decide.
  log.warn(copy.historyLine(history))
  const go = await confirm({ message: 'Keep going anyway?' })
  if (isCancel(go) || !go) stop('Okay. Open a new Terminal window and type  wrapped  when you are ready.')
}

function reportBuild(result: BuildResult): void {
  for (const f of result.failed) log.warn(`${f.title}: ${f.message}`)
  if (result.undecodable > 0) log.info(`Skipped ${result.undecodable} message(s) that couldn't be read.`)
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

  intro(copy.INTRO)
  await askConsent()
  findWebDir() // fail fast, before reading any messages
  // Saved wraps don't need Full Disk Access, so offer them before checking it.
  const savedOption = savedWrapsOption(listWraps(APP_DIR))
  if (savedOption) {
    const choice = await select({
      message: 'What now?',
      options: [{ value: 'new', label: '✨ Make new wraps' }, savedOption],
    })
    if (isCancel(choice)) stop()
    if (choice === 'saved') {
      const ids = listWraps(APP_DIR).map((w) => w.id)
      log.step('Opening your saved wraps in the browser. Keep this window open; click Done there or press Ctrl-C here when you’re finished.')
      await serveUntilDone({ site: SITE, mode: 'wraps', ids, session: null, appDir: APP_DIR, openMessages: openNewMessage }, `#/wraps?ids=${ids.join(',')}`)
      done()
      return
    }
  }
  ensureAccess(flags.db)
  const period = await choosePeriod(flags)
  const session = await load(flags.db, period, flags.now)
  const unregister = onExit(() => session.close())
  try {
    await confirmHistory(session)
    if (flags.picker === 'browser') {
      log.step('Opening the picker in your browser. Keep this window open; click Done there or press Ctrl-C here when you’re finished.')
      await serveUntilDone({ site: SITE, mode: 'pick', ids: [], session, appDir: APP_DIR, openMessages: openNewMessage }, '#/pick')
      done()
      return
    }
    const selection = await pickInTerminal(session.groups)
    if (!selection) stop()
    const s = spinner()
    s.start('Making your wraps')
    const result = buildSelection(session, selection, APP_DIR)
    s.stop(`Made ${result.ids.length} wrap${result.ids.length === 1 ? '' : 's'}`)
    reportBuild(result)
    if (result.ids.length === 0) stop('No wraps were made.')
    log.step('Opening your wraps in the browser. Keep this window open; click Done there or press Ctrl-C here when you’re finished.')
    await serveUntilDone(
      { site: SITE, mode: 'wraps', ids: result.ids, session, appDir: APP_DIR, openMessages: openNewMessage },
      `#/wraps?ids=${result.ids.join(',')}`,
    )
    done()
  } finally {
    unregister()
    session.close()
  }
}

main().catch((err: unknown) => {
  if (err instanceof Cancelled) {
    cancel(err.message)
    process.exit(0)
  }
  if (process.env.DEBUG) console.error(err)
  if (err instanceof WrappedError) cancel(err.message)
  else cancel(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
