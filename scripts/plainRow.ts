import { FAKE_PEOPLE } from '../fixtures/makeFakeDb'
import type { ContactBook } from '../src/extract/contactBook'
import type { MessageRow } from '../src/extract/normalize'

/** better-sqlite3 returns Buffers and Bun returns Uint8Arrays for BLOBs; compare them as plain number arrays. */
export function plainRow(row: MessageRow): Omit<MessageRow, 'body'> & { body: number[] | null } {
  return { ...row, body: row.body ? Array.from(row.body) : null }
}

/** Every message the fake chat has, whatever the year. */
export const ALL_TIME = { from: new Date(2001, 0, 1), to: new Date(2100, 0, 1) }

/** Each fake person's full and short name, as the contact book reads them (null without a contact). */
export function contactNames(book: ContactBook): Record<string, { full: string | null; short: string | null }> {
  return Object.fromEntries(
    Object.values(FAKE_PEOPLE).map((p) => [p.handle, { full: book.nameFor(p.handle), short: book.shortNameFor(p.handle) }]),
  )
}
