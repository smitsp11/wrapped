import { execFileSync } from 'node:child_process'
import type { ContactBook } from '../extract/contactBook'

/**
 * Your first name for shared group wraps, where "You" would read as whoever opens the link.
 * In order: your own contact card (found by the numbers and emails you send from; nickname, else first name),
 * then the first word of this Mac account's full name, then '' (which keeps "You").
 */
export function defaultSenderName(ownHandles: string[], contacts: ContactBook, accountName: () => string): string {
  for (const handle of ownHandles) {
    const name = contacts.shortNameFor(handle)
    if (name) return name
  }
  return accountName().trim().split(/\s+/)[0] ?? ''
}

/** The Mac account's full name ("Smit Patel"), or '' if it can't be read. */
export function macAccountName(): string {
  try {
    return execFileSync('id', ['-F'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim()
  } catch {
    return ''
  }
}
