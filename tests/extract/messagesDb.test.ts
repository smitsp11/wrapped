import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MISSING_DB, NOT_A_MESSAGES_DB } from '../../src/app/copy'
import { MissingDatabaseError, NoFullDiskAccessError, NotAMessagesDatabaseError } from '../../src/errors'
import { MessagesDb } from '../../src/extract/messagesDb'
import type { OpenSqlite } from '../../src/extract/sqlite'
import { openNodeSqlite } from '../../src/extract/sqliteNode'
import { FAKE_PEOPLE, type FakeDb, makeFakeDb } from '../../fixtures/makeFakeDb'

const YEAR = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') }
let dir: string
let fake: FakeDb
let db: MessagesDb

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'messages-db-test-'))
  fake = makeFakeDb(dir)
  db = MessagesDb.open(openNodeSqlite, fake.path)
})
afterAll(() => {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('MessagesDb', () => {
  it("says plainly when the file isn't a Messages database (empty, damaged, or another database), and leaves no copy", () => {
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'not-messages-'))
    const empty = path.join(bad, 'empty.db')
    fs.writeFileSync(empty, '')
    const junk = path.join(bad, 'junk.db')
    fs.writeFileSync(junk, 'this is not sqlite at all, just some text '.repeat(40))
    const other = path.join(bad, 'other.db')
    new Database(other).exec('CREATE TABLE notes (id INTEGER)').close()
    // Copies go to a temp folder of this test's own (os.tmpdir() reads TMPDIR), so it can check none is left.
    const realTmp = process.env.TMPDIR
    const copies = path.join(bad, 'tmp')
    fs.mkdirSync(copies)
    process.env.TMPDIR = copies
    try {
      for (const file of [empty, junk, other]) {
        const open = () => MessagesDb.open(openNodeSqlite, file)
        expect(open, file).toThrow(NotAMessagesDatabaseError)
        expect(open, file).toThrow(NOT_A_MESSAGES_DB)
      }
      expect(fs.readdirSync(copies)).toEqual([])
    } finally {
      if (realTmp === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = realTmp
      fs.rmSync(bad, { recursive: true, force: true })
    }
  })

  it('lists chats, busiest first', () => {
    const chats = db.listChats()
    expect(chats.map((c) => [c.id, c.name, c.isGroup, c.messageCount])).toEqual([
      [fake.groupChatId, 'Poker Night', true, 402], // includes the rename event
      [fake.dmChatId, '', false, 10],
    ])
    expect(chats[0]?.memberIds).toHaveLength(4)
    expect(chats[0]?.memberIds).toContain(FAKE_PEOPLE.jordan.handle)
  })

  it('returns rows for one chat in a period, oldest first', () => {
    const rows = db.messageRows({ chatIds: [fake.groupChatId], ...YEAR })
    expect(rows).toHaveLength(401)
    expect(rows[0]).toMatchObject({ text: 'poker tonight?', handle: FAKE_PEOPLE.alex.handle, isFromMe: 0 })
    expect(rows.every((r, i) => i === 0 || r.dateMs >= rows[i - 1]!.dateMs)).toBe(true)
  })

  it('returns rows for every chat when no chat is given', () => {
    expect(db.messageRows(YEAR)).toHaveLength(411)
  })

  it('returns nothing for a period with no messages', () => {
    expect(db.messageRows({ from: new Date('2020-01-01'), to: new Date('2021-01-01') })).toEqual([])
  })

  it('works on a copy, never the original file', () => {
    expect(fs.readdirSync(dir)).toEqual(['chat.db'])
  })

  it('explains when there is no database', () => {
    const open = () => MessagesDb.open(openNodeSqlite, path.join(dir, 'missing', 'chat.db'))
    expect(open).toThrow(MissingDatabaseError)
    expect(open).toThrow(MISSING_DB)
  })

  it('returns no rows for an empty chat list, and every row for both chats', () => {
    expect(db.messageRows({ chatIds: [], ...YEAR })).toEqual([])
    expect(db.messageRows({ chatIds: [fake.groupChatId, fake.dmChatId], ...YEAR })).toHaveLength(411)
  })

  it('treats the period as half-open: [from, to)', () => {
    const first = new Date('2026-01-05T20:00:00Z')
    const end = new Date('2027-01-01T00:00:00Z')
    expect(db.messageRows({ chatIds: [fake.groupChatId], from: first, to: end })).toHaveLength(401)
    expect(db.messageRows({ chatIds: [fake.groupChatId], from: new Date('2026-01-01T00:00:00Z'), to: first })).toHaveLength(0)
  })

  it('counts messages per chat in a period, not counting reactions', () => {
    const counts = db.messageCountsByChat(YEAR.from, YEAR.to)
    const groupRows = db.messageRows({ chatIds: [fake.groupChatId], ...YEAR })
    expect(counts.get(fake.groupChatId)).toBe(groupRows.filter((r) => !r.assocType).length)
    expect(counts.get(fake.dmChatId)).toBe(10)
    expect(db.messageCountsByChat(new Date('2030-01-01'), new Date('2031-01-01')).size).toBe(0)
  })
  it('finds the oldest and newest real message', () => {
    const span = db.messageSpan()
    expect(span).not.toBeNull()
    const rows = db.messageRows({ from: new Date(2001, 0, 1), to: new Date(2100, 0, 1) })
    expect(span!.earliest.getTime()).toBe(Math.min(...rows.map((r) => r.dateMs)) + Date.UTC(2001, 0, 1))
    expect(span!.latest.getTime()).toBe(Math.max(...rows.map((r) => r.dateMs)) + Date.UTC(2001, 0, 1))
  })
})

describe('MessagesDb on isolated files', () => {
  function freshDir(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'messages-db-test-'))
    cleanup.push(d)
    return d
  }
  const cleanup: string[] = []
  afterAll(() => {
    for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true })
  })

  it('sees rows that are still only in the -wal file', () => {
    const d = freshDir()
    const f = makeFakeDb(d)
    const writer = new Database(f.path)
    let reader: MessagesDb | undefined
    try {
      writer.pragma('wal_autocheckpoint = 0')
      const date = (Date.UTC(2026, 5, 1) - Date.UTC(2001, 0, 1)) * 1_000_000
      const { lastInsertRowid } = writer
        .prepare('INSERT INTO message (guid, text, date, item_type) VALUES (?, ?, ?, 0)')
        .run('WAL-ONLY', 'only in the wal', date)
      writer.prepare('INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?, ?, ?)').run(f.dmChatId, lastInsertRowid, date)
      reader = MessagesDb.open(openNodeSqlite, f.path)
      expect(reader.messageRows({ chatIds: [f.dmChatId], ...YEAR }).map((r) => r.text)).toContain('only in the wal')
    } finally {
      reader?.close()
      writer.close()
    }
  })

  it("reads each attachment's type (MIME, else UTI), and does without it on databases that lack the tables", () => {
    const f = makeFakeDb(freshDir(), { hitConversations: true })
    const attachmentTypes = (reader: MessagesDb) =>
      reader.messageRows({ chatIds: [f.groupChatId], ...YEAR }).filter((r) => r.hasAttachment).map((r) => r.attachmentType)
    let reader = MessagesDb.open(openNodeSqlite, f.path)
    try {
      expect(attachmentTypes(reader)).toEqual(['image/heic', 'com.apple.quicktime-movie']) // a photo on Jan 12, a video on Jan 15
      expect(reader.messageRows({ chatIds: [f.groupChatId], ...YEAR }).filter((r) => !r.hasAttachment).every((r) => r.attachmentType === null)).toBe(true)
    } finally {
      reader.close()
    }
    const writer = new Database(f.path)
    writer.exec('DROP TABLE message_attachment_join')
    writer.close()
    reader = MessagesDb.open(openNodeSqlite, f.path)
    try {
      expect(attachmentTypes(reader)).toEqual([null, null])
    } finally {
      reader.close()
    }
  })

  it("finds a message's first attachment file by the message guid, for the maker's preview only", () => {
    const f = makeFakeDb(freshDir(), { hitConversations: true })
    let reader = MessagesDb.open(openNodeSqlite, f.path)
    let photoGuid = ''
    try {
      const rows = reader.messageRows({ chatIds: [f.groupChatId], ...YEAR })
      photoGuid = rows.find((r) => r.attachmentType === 'image/heic')!.guid
      expect(reader.attachmentFile(photoGuid)).toEqual({ filename: `~/Library/Messages/Attachments/fake/${photoGuid}`, type: 'image/heic' })
      expect(reader.attachmentFile(rows.find((r) => !r.hasAttachment)!.guid)).toBeNull()
      expect(reader.attachmentFile("nope' OR 1=1 --")).toBeNull()
    } finally {
      reader.close()
    }
    const writer = new Database(f.path)
    writer.exec('DROP TABLE message_attachment_join')
    writer.close()
    reader = MessagesDb.open(openNodeSqlite, f.path)
    try {
      expect(reader.attachmentFile(photoGuid)).toBeNull()
    } finally {
      reader.close()
    }
  })

  it("reads Apple's group ids, and does without them on databases that lack the columns", () => {
    const f = makeFakeDb(freshDir(), { splitGroups: true })
    let reader = MessagesDb.open(openNodeSqlite, f.path)
    try {
      const linked = reader.listChats().find((c) => c.id === f.split!.linkedChatId)
      expect(linked).toMatchObject({ groupId: 'FAKE-GROUP-chat200000000000000003', originalGroupId: 'FAKE-GROUP-chat200000000000000001' })
    } finally {
      reader.close()
    }
    const writer = new Database(f.path)
    writer.exec('ALTER TABLE chat DROP COLUMN group_id; ALTER TABLE chat DROP COLUMN original_group_id')
    writer.close()
    reader = MessagesDb.open(openNodeSqlite, f.path)
    try {
      expect(reader.listChats().every((c) => c.groupId === '' && c.originalGroupId === '')).toBe(true)
    } finally {
      reader.close()
    }
  })

  it('removes its temp copy on close()', () => {
    const f = makeFakeDb(freshDir())
    const spy = vi.spyOn(fs, 'mkdtempSync')
    let copyDir: string
    try {
      const opened = MessagesDb.open(openNodeSqlite, f.path)
      copyDir = spy.mock.results.map((r) => String(r.value)).find((p) => path.basename(p).startsWith('wrapped-')) ?? ''
      expect(copyDir).not.toBe('')
      expect(fs.existsSync(copyDir)).toBe(true)
      opened.close()
    } finally {
      spy.mockRestore()
    }
    expect(fs.existsSync(copyDir)).toBe(false)
  })

  it('rejects a file that is not a Messages database', () => {
    const d = freshDir()
    const file = path.join(d, 'chat.db')
    fs.writeFileSync(file, 'definitely not sqlite, just some junk bytes')
    const spy = vi.spyOn(fs, 'mkdtempSync')
    try {
      expect(() => MessagesDb.open(openNodeSqlite, file)).toThrow()
      const copies = spy.mock.results.map((r) => String(r.value)).filter((p) => path.basename(p).startsWith('wrapped-'))
      expect(copies).toHaveLength(1)
      expect(fs.existsSync(copies[0]!)).toBe(false) // the private copy is cleaned up
    } finally {
      spy.mockRestore()
    }
  })

  it.skipIf(process.getuid?.() === 0)('explains when macOS blocks access', () => {
    const d = freshDir()
    const f = makeFakeDb(d)
    fs.chmodSync(f.path, 0o000)
    try {
      expect(() => MessagesDb.open(openNodeSqlite, f.path)).toThrow(NoFullDiskAccessError)
      expect(() => MessagesDb.open(openNodeSqlite, f.path)).toThrow('click "Quit & Reopen", then type  wrapped  again')
    } finally {
      fs.chmodSync(f.path, 0o644)
    }
  })
})

describe('MessagesDb driver', () => {
  it('opens the copy through the driver it is given', () => {
    const opened: string[] = []
    let closes = 0
    const spy: OpenSqlite = (file) => {
      opened.push(file)
      const db = openNodeSqlite(file)
      return {
        all: db.all,
        close: () => {
          closes++
          db.close()
        },
      }
    }
    const reader = MessagesDb.open(spy, fake.path)
    try {
      expect(opened).toHaveLength(1)
      expect(opened[0]).not.toBe(fake.path) // it reads a temp copy, never the original
      expect(path.basename(path.dirname(opened[0]!)).startsWith('wrapped-')).toBe(true)
      expect(reader.listChats().length).toBeGreaterThan(0)
    } finally {
      reader.close()
    }
    expect(closes).toBe(1)
  })
})
