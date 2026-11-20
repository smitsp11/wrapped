import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copyDatabase } from './copyDb'
import type { OpenSqlite, SqliteDb } from './sqlite'

export type ContactEntry = {
  first: string | null
  last: string | null
  nickname: string | null
  org: string | null
  /** a phone number or email address */
  handle: string
}

const CONTACTS_SQL = `
  SELECT r.ZFIRSTNAME AS first, r.ZLASTNAME AS last, r.ZNICKNAME AS nickname, r.ZORGANIZATION AS org,
    p.ZFULLNUMBER AS handle
  FROM ZABCDPHONENUMBER p JOIN ZABCDRECORD r ON r.Z_PK = p.ZOWNER
  WHERE p.ZFULLNUMBER IS NOT NULL
  UNION ALL
  SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZNICKNAME, r.ZORGANIZATION, e.ZADDRESS
  FROM ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON r.Z_PK = e.ZOWNER
  WHERE e.ZADDRESS IS NOT NULL`

/**
 * Phones → last 10 digits (so +1, formatting and extensions don't matter); emails → lowercase.
 * Matching is on the last 10 digits, so numbers saved in some countries' local formats
 * won't match and fall back to the masked handle. Returns '' when there is no usable key.
 */
export function normalizeHandle(handle: string): string {
  if (handle.includes('@')) return handle.trim().toLowerCase()
  const number = handle.split(/(ext\.?|x|,|;)/i)[0] ?? ''
  const digits = number.replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

function displayName(entry: ContactEntry): string | null {
  const full = [entry.first, entry.last].filter(Boolean).join(' ').trim()
  return full || entry.nickname?.trim() || entry.org?.trim() || null
}

/** For chat titles and member lists: the nickname, else the first name ("Mary Anne"), else the display name (a business: "Pizza Pizza"). */
function shortName(entry: ContactEntry): string | null {
  return entry.nickname?.trim() || entry.first?.trim() || displayName(entry)
}

/** Maps Messages handles to names from the macOS Contacts databases. First match wins: the local database, then synced sources in name order. */
export class ContactBook {
  private readonly names = new Map<string, { full: string; short: string; isPerson: boolean }>()

  constructor(
    entries: ContactEntry[],
    /** how many Contacts sources could not be read (a count only) */
    readonly skippedSources: number = 0,
  ) {
    for (const entry of entries) {
      const key = normalizeHandle(entry.handle)
      const full = displayName(entry)
      const short = shortName(entry)
      const isPerson = Boolean(entry.first?.trim() || entry.last?.trim() || entry.nickname?.trim())
      if (key && full && short && !this.names.has(key)) this.names.set(key, { full, short, isPerson })
    }
  }

  /** Reads the local Contacts database and every synced source (iCloud, Google…). */
  static fromMac(openSqlite: OpenSqlite, home: string = os.homedir()): ContactBook {
    const root = path.join(home, 'Library', 'Application Support', 'AddressBook')
    const sourcesDir = path.join(root, 'Sources')
    const sources = fs.existsSync(sourcesDir)
      ? fs.readdirSync(sourcesDir).sort().map((dir) => path.join(sourcesDir, dir, 'AddressBook-v22.abcddb'))
      : []
    const files = [path.join(root, 'AddressBook-v22.abcddb'), ...sources].filter((file) => fs.existsSync(file))
    const entries: ContactEntry[] = []
    let skipped = 0
    let firstError: unknown
    for (const file of files) {
      try {
        entries.push(...readContacts(file, openSqlite))
      } catch (err) {
        skipped++
        firstError ??= err
      }
    }
    if (files.length > 0 && skipped === files.length) throw firstError
    return new ContactBook(entries, skipped)
  }

  nameFor(handleId: string): string | null {
    const key = normalizeHandle(handleId)
    return key ? (this.names.get(key)?.full ?? null) : null
  }

  shortNameFor(handleId: string): string | null {
    const key = normalizeHandle(handleId)
    return key ? (this.names.get(key)?.short ?? null) : null
  }

  /** every person's full and short name (not businesses'), so a word that is just someone's name is never a top word */
  allNames(): string[] {
    return [...this.names.values()].filter((n) => n.isPerson).flatMap(({ full, short }) => [full, short])
  }

  /** number of handles (phones and emails) with a name */
  get size(): number {
    return this.names.size
  }
}

function readContacts(file: string, openSqlite: OpenSqlite): ContactEntry[] {
  const copy = copyDatabase(file)
  let db: SqliteDb | undefined
  try {
    db = openSqlite(copy.path)
    return db.all<ContactEntry>(CONTACTS_SQL)
  } finally {
    try {
      db?.close()
    } catch {
      // keep the original error (or the result), not a failure to close
    } finally {
      fs.rmSync(copy.dir, { recursive: true, force: true })
    }
  }
}
