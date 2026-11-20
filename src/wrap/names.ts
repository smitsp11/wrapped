import type { ContactBook } from '../extract/contactBook'
import { maskHandle } from '../format'
import type { Chat } from '../types'

export function nameLookup(contacts: ContactBook): (handle: string) => string {
  return (handle) => contacts.nameFor(handle) ?? maskHandle(handle)
}

/** A person's full name (shown in wraps) and the short name used in chat titles and member lists. */
export type PersonName = { full: string; short: string }

/** The short name comes from Contacts; a handle without a contact falls back to splitting its (masked) name. */
export function personLookup(contacts: ContactBook): (handle: string) => PersonName {
  const nameFor = nameLookup(contacts)
  return (handle) => {
    const full = nameFor(handle)
    return { full, short: contacts.shortNameFor(handle) ?? firstName(full) }
  }
}

/** "Alex Chen" → "Alex". Masked numbers and emails (they contain •) stay whole. Blank input comes back as is. */
export function firstName(name: string): string {
  const n = name.trim()
  if (n.includes('•') || n.startsWith('+')) return n
  return n.split(/\s+/)[0] || name
}

/** Short names, but "Alex C." / "Alex K." when different people share one. */
export function shortNames(people: PersonName[]): string[] {
  const fullNamesByShort = new Map<string, Set<string>>()
  for (const { full, short } of people) {
    fullNamesByShort.set(short, (fullNamesByShort.get(short) ?? new Set()).add(full.trim()))
  }
  return people.map(({ full, short }) => {
    const words = full.trim().split(/\s+/)
    const clash = (fullNamesByShort.get(short)?.size ?? 0) > 1
    // short === full: a masked handle or a business name, which has no last name to add.
    return clash && short !== full.trim() && words.length > 1 ? `${short} ${words[words.length - 1]![0]}.` : short
  })
}

/** Unnamed chats are named after their members' short names, like Messages does. */
export function chatTitle(chat: Chat, personFor: (handle: string) => PersonName): string {
  if (chat.name) return chat.name
  const names = shortNames(chat.memberIds.map(personFor)).filter((n) => n.trim())
  if (names.length === 0) return chat.isGroup ? 'Group chat' : 'A chat'
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')
}
