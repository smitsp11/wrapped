import { parseArgs } from 'node:util'
import { parseYear } from '../cliHelpers'
import { WrappedError } from '../errors'
import { DEFAULT_CHAT_DB } from '../extract/messagesDb'

export type Flags = {
  help: boolean
  update: boolean
  version: boolean
  db: string
  check: boolean
  resumeCheck: boolean
  year: number
  yearGiven: boolean
  now: Date
}

/** What  wrapped --help  prints. The test-only flags (--db, --check, --now, --resume-check) stay out of it. */
export const USAGE = [
  'Usage:',
  '  wrapped                  make new wraps, or reopen saved ones',
  '  wrapped --year 2025      a full past year instead of this year so far',
  '  wrapped update           install the newest version',
  '  wrapped --version, -v    print the installed version',
  '  wrapped --help, -h       show this',
].join('\n')

const TRY_HELP = 'Try  wrapped --help.'

/** The command line, checked. Anything it doesn't know is a plain WrappedError that says how to get help. */
export function parseFlags(args: string[] = process.argv.slice(2)): Flags {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(args)
  } catch (err) {
    // node:util names the option in quotes: "Unknown option '--foo'", "Option '--db <value>' argument missing".
    const option = err instanceof Error ? /'(-[^' ]+)/.exec(err.message)?.[1] : undefined
    throw new WrappedError(`${option ? `wrapped doesn't understand ${option}.` : "That isn't something wrapped understands."} ${TRY_HELP}`)
  }
  const { values, positionals } = parsed
  const command = positionals[0]
  if (positionals.length > 1 || (command !== undefined && command !== 'update')) throw new WrappedError(`The only command is  wrapped update. ${TRY_HELP}`)
  return {
    help: values.help ?? false,
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

function parse(args: string[]) {
  return parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      db: { type: 'string' },
      check: { type: 'boolean' },
      'resume-check': { type: 'boolean' },
      year: { type: 'string' },
      now: { type: 'string' },
    },
    allowPositionals: true,
  })
}

/** Hidden flag for the smoke test: pretend today is this day (YYYY-MM-DD, local). */
function parseNow(text: string | undefined): Date {
  if (text === undefined) return new Date()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
  if (!match || !date || date.getMonth() !== Number(match[2]) - 1) throw new WrappedError('--now must be a date like 2026-03-10.')
  return date
}
