import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copyDatabase, removeCopy } from './copyDb'
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

/** A card you marked as yours in Contacts ("Make This My Card"). It may have no number or email on it. */
export type MeCard = { first: string | null; nickname: string | null }

/**
 * The Me card. Contacts marks it twice: the card's ZCONTAINERWHERECONTACTISME points at its account, and the
 * account's row has ZME pointing back at the card. Either is enough; older databases may have neither (null).
 */
function meSql(columns: Set<string>): string | null {
  const marks = [
    ...(columns.has('ZCONTAINERWHERECONTACTISME') ? ['ZCONTAINERWHERECONTACTISME IS NOT NULL'] : []),
    ...(columns.has('ZME') ? ['Z_PK IN (SELECT ZME FROM ZABCDRECORD WHERE ZME IS NOT NULL)'] : []),
  ]
  return marks.length > 0 ? `SELECT ZFIRSTNAME AS first, ZNICKNAME AS nickname FROM ZABCDRECORD WHERE ${marks.join(' OR ')}` : null
}

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

/** Words people put in brackets after a name that label the contact rather than name them ("Sam (work)"). */
const BRACKET_LABELS = new Set([
  'work', 'home', 'mobile', 'cell', 'old', 'new', 'mom', 'dad', 'school', 'uni', 'uoft', 'gym', 'office', 'personal',
  'business', 'other', 'main', 'us', 'usa', 'canada', 'india', 'uk', 'whatsapp', 'ig', 'insta', 'snap', 'friend', 'cousin',
])

/**
 * "sour patch (mia)" → "Mia", "LMNOP (theo)" → "Theo": a first name saved as a nickname with the real name in
 * brackets at the end. Only when the bracket holds one name-like word (not a label like "(work)") and the part before
 * it isn't already written like a name ("Sam Lee (work)" stays as it is). Otherwise the first name is unchanged.
 */
export function realFirstName(first: string): string {
  const match = /^(.*\S)\s*\(\s*([\p{L}][\p{L}'’-]*)\s*\)\s*$/u.exec(first.trim())
  if (!match) return first.trim()
  const [, outside, inside] = match as unknown as [string, string, string]
  const writtenLikeAName = outside.split(/\s+/).every((word) => /^\p{Lu}\p{Ll}+$/u.test(word))
  if (BRACKET_LABELS.has(inside.toLowerCase()) || writtenLikeAName) return first.trim()
  return inside.charAt(0).toUpperCase() + inside.slice(1)
}

function displayName(entry: ContactEntry): string | null {
  const first = entry.first ? realFirstName(entry.first) : entry.first
  const full = [first, entry.last].filter(Boolean).join(' ').trim()
  return full || entry.nickname?.trim() || entry.org?.trim() || null
}

/**
 * For chat titles and member lists: the real first name ("Mary Anne"), else the nickname, else the display name (a
 * business: "Pizza Pizza"). Real names first, so a private nickname from your Contacts never shows up in a wrap.
 */
function shortName(entry: ContactEntry): string | null {
  return (entry.first ? realFirstName(entry.first) : '') || entry.nickname?.trim() || displayName(entry)
}

/** Maps Messages handles to names from the macOS Contacts databases. First match wins: the local database, then synced sources in name order. */
export class ContactBook {
  private readonly names = new Map<string, { full: string; short: string; nickname: string | null; isPerson: boolean }>()
  /** every card's nickname and first name per handle, from all sources in order (for finding your own name) */
  private readonly given = new Map<string, string[]>()

  constructor(
    entries: ContactEntry[],
    /** how many Contacts sources could not be read (a count only) */
    readonly skippedSources: number = 0,
    /** the cards marked as yours, in source order */
    private readonly meCards: MeCard[] = [],
  ) {
    for (const entry of entries) {
      const key = normalizeHandle(entry.handle)
      const full = displayName(entry)
      const short = shortName(entry)
      const isPerson = Boolean(entry.first?.trim() || entry.last?.trim() || entry.nickname?.trim())
      if (key && full && short && !this.names.has(key)) this.names.set(key, { full, short, nickname: entry.nickname?.trim() || (entry.first && realFirstName(entry.first) !== entry.first.trim() ? entry.first.trim() : null), isPerson })
      const names = [entry.nickname?.trim(), entry.first?.trim()].filter((n): n is string => Boolean(n))
      if (key && names.length > 0) this.given.set(key, [...(this.given.get(key) ?? []), ...names])
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
    const me: MeCard[] = []
    let skipped = 0
    let firstError: unknown
    for (const file of files) {
      try {
        const read = readDatabaseCopy(file, openSqlite, readContacts)
        entries.push(...read.entries)
        me.push(...read.me)
      } catch (err) {
        skipped++
        firstError ??= err
      }
    }
    if (files.length > 0 && skipped === files.length) throw firstError
    return new ContactBook(entries, skipped, me)
  }

  nameFor(handleId: string): string | null {
    const key = normalizeHandle(handleId)
    return key ? (this.names.get(key)?.full ?? null) : null
  }

  shortNameFor(handleId: string): string | null {
    const key = normalizeHandle(handleId)
    return key ? (this.names.get(key)?.short ?? null) : null
  }

  /**
   * The nicknames and first names on every card with this handle, nickname first, in source order. Never a
   * last name or a business name. Used to find your own name from the numbers and emails you send from.
   */
  givenNamesFor(handleId: string): string[] {
    const key = normalizeHandle(handleId)
    return key ? (this.given.get(key) ?? []) : []
  }

  /** The nickname, then the first name, on each card marked as yours ("Make This My Card"), in source order. */
  meNames(): string[] {
    return this.meCards.flatMap((card) => [card.nickname?.trim(), card.first?.trim()].filter((n): n is string => Boolean(n)))
  }

  /** every person's full and short name (not businesses'), so a word that is just someone's name is never a top word */
  allNames(): string[] {
    // Nicknames too: they never show in a wrap, but one could still turn up as a top word.
    return [...this.names.values()].filter((n) => n.isPerson).flatMap(({ full, short, nickname }) => (nickname && nickname !== short ? [full, short, nickname] : [full, short]))
  }

  /** number of handles (phones and emails) with a name */
  get size(): number {
    return this.names.size
  }
}

function readContacts(db: SqliteDb): { entries: ContactEntry[]; me: MeCard[] } {
  const columns = new Set(db.all<{ name: string }>('PRAGMA table_info(ZABCDRECORD)').map((c) => c.name))
  const me = meSql(columns)
  return { entries: db.all<ContactEntry>(CONTACTS_SQL), me: me ? db.all<MeCard>(me) : [] }
}

/** Reads a private copy of a database (see copyDatabase), and always removes the copy. */
export function readDatabaseCopy<T>(file: string, openSqlite: OpenSqlite, read: (db: SqliteDb) => T): T {
  const copy = copyDatabase(file)
  let db: SqliteDb | undefined
  try {
    db = openSqlite(copy.path)
    return read(db)
  } finally {
    try {
      db?.close()
    } catch {
      // keep the original error (or the result), not a failure to close
    } finally {
      removeCopy(copy.dir)
    }
  }
}
