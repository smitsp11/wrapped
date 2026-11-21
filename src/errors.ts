import { MISSING_DB, NOT_A_MESSAGES_DB, noAccess } from './app/copy'

/** Errors with a message meant for the person running the CLI. */
export class WrappedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

// The wording for these two lives in copy.ts with the rest of the app's wording.
export class MissingDatabaseError extends WrappedError {
  /** the path that wasn't there; kept off the message (DEBUG=1 prints it) */
  readonly dbPath: string
  constructor(dbPath: string) {
    super(MISSING_DB)
    this.dbPath = dbPath
  }
}

/** The file opened, but it isn't a Messages database: empty, damaged, or something else. */
export class NotAMessagesDatabaseError extends WrappedError {
  /** the path; kept off the message (DEBUG=1 prints the error) */
  readonly dbPath: string
  constructor(dbPath: string, cause?: unknown) {
    super(NOT_A_MESSAGES_DB)
    this.dbPath = dbPath
    this.cause = cause
  }
}

export class NoFullDiskAccessError extends WrappedError {
  /** terminal: the app that needs Full Disk Access, from terminalName() */
  constructor(terminal: string) {
    super(noAccess(terminal))
  }
}

export class ChatNotFoundError extends WrappedError {
  constructor(query: string, suggestions: string[]) {
    super(
      [
        `No single chat matches "${query}". Closest matches:`,
        ...suggestions.map((s) => `  ${s}`),
        'Run it again with the chat id from the first column.',
      ].join('\n'),
    )
  }
}

export class EmptyPeriodError extends WrappedError {
  constructor(title: string) {
    super(`"${title}" has no messages in that period. Try a different --year.`)
  }
}

export class BrokenLinkError extends WrappedError {
  constructor() {
    super('This link is broken or incomplete. Ask for it again.')
  }
}

export class NewerVersionError extends WrappedError {
  constructor() {
    super('This wrap was made by a newer version of iMessage Wrapped.')
  }
}

export function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) return String(err.code)
  return undefined
}
