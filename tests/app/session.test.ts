import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FAKE_ME, makeFakeDb, type FakeDb, type SplitGroups } from '../../fixtures/makeFakeDb'
import { WrappedError } from '../../src/errors'
import { buildSelection } from '../../src/app/build'
import { fullYear } from '../../src/app/period'
import { NO_APPLE_ACCOUNT, type AppleAccount } from '../../src/app/senderName'
import { openSession, type Session } from '../../src/app/session'
import { listWraps } from '../../src/app/store'
import { ContactBook } from '../../src/extract/contactBook'
import { openNodeSqlite } from '../../src/extract/sqliteNode'

/** never this Mac's own account or Apple Account: tests only see fake names */
const noOwner = { accountName: () => '', appleAccount: () => NO_APPLE_ACCOUNT }

let dir: string
let fake: FakeDb
let session: Session
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'))
  fake = makeFakeDb(dir)
  session = openSession({ openSqlite: openNodeSqlite, dbPath: fake.path, ...noOwner, contacts: new ContactBook([]), period: fullYear(2026), now: new Date(2026, 2, 10) })
})
afterAll(() => {
  session.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('session', () => {
  it('ranks the fake group chat and checks history', () => {
    expect(session.groups.map((g) => g.title)).toEqual(['Poker Night'])
    expect(session.history.kind).toBe('ok') // the fake chat starts Mon 2026-01-05, within 14 days of Jan 1
  })
  it('flags history that stops long before today as stale', () => {
    const late = openSession({ openSqlite: openNodeSqlite, dbPath: fake.path, ...noOwner, contacts: new ContactBook([]), period: fullYear(2026), now: new Date(2026, 9, 27) })
    try {
      expect(late.history.kind).toBe('stale')
    } finally {
      late.close()
    }
  })
  it('builds a group wrap matching the answer key', () => {
    const { wrap } = session.buildGroup(fake.groupChatId)
    expect(wrap.title).toBe('Poker Night')
    expect(wrap.volume.total).toBe(302)
    // top words are compared with every chat in the period, as in fakeWrap
    expect(wrap.words.topWords.map((w) => w.word)).toEqual(['run it back', 'poker', 'rebuy', 'chips', 'omw', 'classic', 'dealer'])
  })
  it('builds and saves picked wraps, reporting chats that fail', () => {
    const appDir = path.join(dir, 'app')
    const result = buildSelection(session, { kind: 'groups', chatIds: [fake.groupChatId, 123456] }, appDir)
    expect(result.ids).toEqual([`poker-night-${fake.groupChatId}-2026`])
    expect(result.failed).toHaveLength(1)
    expect(listWraps(appDir).map((w) => w.id)).toEqual(result.ids)
  })
  it('builds the solo wrap', () => {
    const appDir = path.join(dir, 'app-solo')
    expect(buildSelection(session, { kind: 'solo' }, appDir).ids).toEqual(['me-2026'])
  })
  it('builds a repeated chat id once', () => {
    const appDir = path.join(dir, 'app-dupe')
    const result = buildSelection(session, { kind: 'groups', chatIds: [fake.groupChatId, fake.groupChatId] }, appDir)
    expect(result.ids).toHaveLength(1)
  })
  it('titles an unknown chat generically and explains the failure', () => {
    const appDir = path.join(dir, 'app-unknown')
    const { failed } = buildSelection(session, { kind: 'groups', chatIds: [123456] }, appDir)
    expect(failed[0]?.title).toBe('A group chat')
    expect(failed[0]?.message.length).toBeGreaterThan(0)
  })
  it('says plainly when a chat has no messages in the period', () => {
    const empty = openSession({ openSqlite: openNodeSqlite, dbPath: fake.path, ...noOwner, contacts: new ContactBook([]), period: fullYear(2020), now: new Date(2020, 11, 31) })
    try {
      const { failed } = buildSelection(empty, { kind: 'groups', chatIds: [fake.groupChatId] }, path.join(dir, 'app-empty'))
      expect(failed[0]?.message).toBe('No messages in this period.')
    } finally {
      empty.close()
    }
  })
  it('refuses a direct message chat as a group', () => {
    expect(() => session.buildGroup(fake.dmChatId)).toThrow(WrappedError)
  })
  it('lets unexpected errors propagate', () => {
    const broken = { period: fullYear(2026), groups: [], buildGroup: () => { throw new Error('disk') } } as unknown as Session
    expect(() => buildSelection(broken, { kind: 'groups', chatIds: [1] }, path.join(dir, 'app-broken'))).toThrow('disk')
  })
  it('can be closed twice', () => {
    const other = openSession({ openSqlite: openNodeSqlite, dbPath: fake.path, ...noOwner, contacts: new ContactBook([]), period: fullYear(2026), now: new Date(2026, 2, 10) })
    other.close()
    expect(() => other.close()).not.toThrow()
  })
})

describe('your name for shared group wraps', () => {
  const general = new ContactBook([{ handle: FAKE_ME.phone, first: 'General', last: null, nickname: null, org: null }])
  const open = (file: string, accountName: () => string, appleAccount: () => AppleAccount = () => NO_APPLE_ACCOUNT, contacts = general) =>
    openSession({ openSqlite: openNodeSqlite, dbPath: file, contacts, period: fullYear(2026), now: new Date(2026, 2, 10), accountName, appleAccount })

  it('keeps "You" when the only names are a card and an account called "General"', () => {
    const session = open(fake.path, () => 'General')
    try {
      expect(session.senderName()).toBe('')
    } finally {
      session.close()
    }
  })
  it('takes the Apple Account’s first name, or the card marked as yours, with nobody calling you anything', () => {
    for (const session of [
      open(fake.path, () => 'General', () => ({ name: 'Riley Morgan', email: '' })),
      open(fake.path, () => 'General', undefined, new ContactBook([], 0, [{ first: 'Riley', nickname: null }])),
    ]) {
      try {
        expect(session.senderName()).toBe('Riley')
      } finally {
        session.close()
      }
    }
  })
  it('reads the Apple Account once, and only when the name is needed', () => {
    let reads = 0
    const session = open(fake.path, () => 'General', () => (reads++, NO_APPLE_ACCOUNT))
    try {
      expect(reads).toBe(0)
      session.senderName()
      session.senderName()
      expect(reads).toBe(1)
    } finally {
      session.close()
    }
  })
  it('finds the name your friends call you, before or after building a wrap', () => {
    const named = makeFakeDb(fs.mkdtempSync(path.join(dir, 'named-')), { callsMe: 'Taylor' })
    const session = open(named.path, () => 'General')
    try {
      expect(session.buildGroup(named.groupChatId).wrap.volume.total).toBe(305) // the answer key's 302 + 3 mentions
      expect(session.senderName()).toBe('Taylor')
    } finally {
      session.close()
    }
  })
})

describe('a group Messages keeps as several chat rows', () => {
  let split: SplitGroups
  let merged: Session
  beforeAll(() => {
    const fakeSplit = makeFakeDb(fs.mkdtempSync(path.join(dir, 'split-')), { splitGroups: true })
    split = fakeSplit.split!
    merged = openSession({ openSqlite: openNodeSqlite, dbPath: fakeSplit.path, ...noOwner, contacts: new ContactBook([]), period: fullYear(2026), now: new Date(2026, 2, 10) })
  })
  afterAll(() => merged.close())

  it('is one row on the home page with every row counted; a same-named group of other people stays apart', () => {
    const { mainChatId, smsChatId, linkedChatId, strangerChatId } = split
    expect(merged.groups.map((g) => [g.title, g.chatIds])[0]).toEqual(['Poker Night', [fake.groupChatId]])
    expect(merged.groups.filter((g) => g.title === 'Book Club').map((g) => [g.chatIds, g.messages])).toEqual([
      [[mainChatId, smsChatId, linkedChatId], 31],
      [[strangerChatId], 5],
    ])
  })
  it('wraps every row: the total, streak and silence span them all', () => {
    for (const chatId of [split.mainChatId, split.smsChatId]) {
      const { wrap } = merged.buildGroup(chatId)
      expect(wrap.title).toBe('Book Club')
      expect(wrap.volume.total).toBe(31)
      expect(wrap.timing.longestStreakDays).toBe(31) // main alone: 10
      expect(wrap.timing.longestSilenceDays).toBe(1) // main alone: 11
    }
    expect(merged.buildGroup(split.strangerChatId).wrap.volume.total).toBe(5)
  })
  it('saves one wrap named by all its rows, whichever row is picked', () => {
    const appDir = path.join(dir, 'app-split')
    const { mainChatId, smsChatId, linkedChatId } = split
    const result = buildSelection(merged, { kind: 'groups', chatIds: [mainChatId, smsChatId] }, appDir)
    expect(result.ids).toEqual([`book-club-${mainChatId}-${smsChatId}-${linkedChatId}-2026`])
  })
  it('counts the group once among your top chats', () => {
    const { wrap } = merged.buildSolo()
    expect(wrap.topChats.slice(1)).toEqual([
      { name: 'Book Club', messages: 31 },
      { name: '+1 ••• ••• 0101', messages: 10 }, // the DM with Alex, masked without Contacts
      { name: 'Book Club', messages: 5 },
    ])
  })
  it('finds the busiest day and the months across every row', () => {
    const { wrap } = merged.buildGroup(split.smsChatId)
    expect(wrap.timing.busiestDay).toEqual({ date: '2026-01-05', messages: 1 }) // one a day: the earliest wins
    expect(wrap.timing.byMonth.slice(0, 3)).toEqual([27, 4, 0])
  })
})

describe('a year round, with history from last year', () => {
  let yearRound: FakeDb
  let year: Session
  beforeAll(() => {
    yearRound = makeFakeDb(fs.mkdtempSync(path.join(dir, 'year-')), { hitConversations: true, yearRound: true })
    year = openSession({ openSqlite: openNodeSqlite, dbPath: yearRound.path, ...noOwner, contacts: new ContactBook([]), period: fullYear(2026), now: new Date(2026, 11, 31) })
  })
  afterAll(() => year.close())

  it('compares each wrap with the same dates last year', () => {
    expect(year.buildGroup(yearRound.groupChatId).wrap.vsLastYear).toEqual({ year: 2025, percent: 21 })
    expect(year.buildSolo().wrap.vsLastYear).toEqual({ year: 2025, percent: 64 })
  })
  it('has no comparison when history starts this year', () => {
    expect('vsLastYear' in session.buildGroup(fake.groupChatId).wrap).toBe(false)
    expect('vsLastYear' in session.buildSolo().wrap).toBe(false)
  })
  it('finds your person each month and the longest streak with one person, by 1:1 chat', () => {
    const { wrap } = year.buildSolo()
    const months = wrap.topPersonByMonth!.map((id) => (id === null ? null : wrap.people[id]))
    expect(months).toEqual([
      '+1 ••• ••• 0101', '+1 ••• ••• 0101', '+1 ••• ••• 0101', '+1 ••• ••• 0102', '+1 ••• ••• 0102', 'j•••@example.com',
      'j•••@example.com', 'j•••@example.com', '+1 ••• ••• 0104', '+1 ••• ••• 0104', '+1 ••• ••• 0101', '+1 ••• ••• 0101',
    ])
    expect(wrap.personStreak).toMatchObject({ days: 62, from: '2026-04-01' })
    expect(wrap.people[wrap.personStreak!.personId]).toBe('+1 ••• ••• 0102')
  })
})
