import { describe, expect, it } from 'vitest'
import { ContactBook } from '../../src/extract/contactBook'
import { chatTitle, firstName, personLookup, shortNames, type PersonName } from '../../src/wrap/names'
import type { Chat } from '../../src/types'

const chat = (partial: Partial<Chat>): Chat => ({ id: 1, name: '', isGroup: true, memberIds: [], messageCount: 0, ...partial })
/** A person whose short name comes from splitting the full name, like a handle without a contact. */
const split = (full: string): PersonName => ({ full, short: firstName(full) })
const names: Record<string, string> = { '+14165550101': 'Alex Chen', '+14165550102': 'Sam Rivera', 'j@example.com': 'Jordan Lee' }
const nameFor = (h: string) => split(names[h] ?? '+1 ••• ••• 0199')

describe('firstName', () => {
  it('takes the first word of a contact name', () => expect(firstName('Alex Chen')).toBe('Alex'))
  it('leaves masked numbers and emails whole', () => {
    expect(firstName('+1 ••• ••• 0199')).toBe('+1 ••• ••• 0199')
    expect(firstName('a•••@example.com')).toBe('a•••@example.com')
  })
  it('trims first, and returns blank input unchanged', () => {
    expect(firstName('  +1 416')).toBe('+1 416')
    expect(firstName('')).toBe('')
  })
})

describe('personLookup', () => {
  const contacts = new ContactBook([
    { first: 'Mary Anne', last: 'Smith', nickname: null, org: null, handle: '+14165550101' },
    { first: null, last: null, nickname: null, org: 'Pizza Pizza', handle: '+14165550102' },
    { first: 'Robert', last: 'Smith', nickname: 'Bob', org: null, handle: '+14165550103' },
  ])
  const personFor = personLookup(contacts)

  it('takes the short name from Contacts', () => {
    expect(personFor('+14165550101')).toEqual({ full: 'Mary Anne Smith', short: 'Mary Anne' })
    expect(personFor('+14165550102')).toEqual({ full: 'Pizza Pizza', short: 'Pizza Pizza' })
    expect(personFor('+14165550103')).toEqual({ full: 'Robert Smith', short: 'Bob' })
  })
  it('masks a handle without a contact, for both names', () => {
    const p = personFor('+14165550199')
    expect(p.full).toContain('•')
    expect(p.short).toBe(p.full)
  })
})

describe('shortNames', () => {
  it('adds a last initial only when different people share a first name', () => {
    expect(shortNames(['Alex Chen', 'Alex Kim', 'Sam Rivera'].map(split))).toEqual(['Alex C.', 'Alex K.', 'Sam'])
  })
  it('leaves identical or single-word names alone', () => {
    expect(shortNames(['Mom', 'Mom'].map(split))).toEqual(['Mom', 'Mom'])
    expect(shortNames(['Alex Chen', 'Alex Chen'].map(split))).toEqual(['Alex', 'Alex'])
  })
  it('keeps masked handles whole', () => {
    expect(shortNames(['+1 ••• ••• 0199', 'Sam Rivera'].map(split))).toEqual(['+1 ••• ••• 0199', 'Sam'])
  })
  it('keeps two-word first names and business names whole', () => {
    const people = [
      { full: 'Mary Anne Smith', short: 'Mary Anne' },
      { full: 'Pizza Pizza', short: 'Pizza Pizza' },
    ]
    expect(shortNames(people)).toEqual(['Mary Anne', 'Pizza Pizza'])
  })
  it('tells apart people who share a short name, even a nickname', () => {
    const people = [
      { full: 'Mary Anne Smith', short: 'Mary Anne' },
      { full: 'Mary Anne Lee', short: 'Mary Anne' },
      { full: 'Robert Smith', short: 'Bob' },
      { full: 'Bob Jones', short: 'Bob' },
    ]
    expect(shortNames(people)).toEqual(['Mary Anne S.', 'Mary Anne L.', 'Bob S.', 'Bob J.'])
  })
})

describe('chatTitle', () => {
  it('uses the chat name when there is one', () => expect(chatTitle(chat({ name: 'Pasta Gang' }), nameFor)).toBe('Pasta Gang'))
  it('names unnamed chats after members by first name, like Messages', () => {
    expect(chatTitle(chat({ memberIds: ['+14165550101', '+14165550102', 'j@example.com'] }), nameFor)).toBe('Alex, Sam, Jordan')
  })
  it('shows at most 3 names, then a count', () => {
    const memberIds = ['+14165550101', '+14165550102', 'j@example.com', '+14165550199']
    expect(chatTitle(chat({ memberIds }), nameFor)).toBe('Alex, Sam, Jordan +1')
  })
  it('tells apart members who share a first name', () => {
    const n: Record<string, string> = { a: 'Alex Chen', b: 'Alex Kim', c: 'Sam Rivera' }
    expect(chatTitle(chat({ memberIds: ['a', 'b', 'c'] }), (h) => split(n[h]!))).toBe('Alex C., Alex K., Sam')
  })
  it('uses short names from Contacts', () => {
    const n: Record<string, PersonName> = { a: { full: 'Pizza Pizza', short: 'Pizza Pizza' }, b: { full: 'Mary Anne Smith', short: 'Mary Anne' } }
    expect(chatTitle(chat({ memberIds: ['a', 'b'] }), (h) => n[h]!)).toBe('Pizza Pizza, Mary Anne')
  })
  it('never returns an empty title', () => {
    expect(chatTitle(chat({ isGroup: true }), nameFor)).toBe('Group chat')
    expect(chatTitle(chat({ isGroup: false }), nameFor)).toBe('A chat')
    expect(chatTitle(chat({ isGroup: true, memberIds: ['x'] }), () => split('  '))).toBe('Group chat')
  })
})
