import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FAKE_ME, makeFakeDb, type FakeDb } from '../../fixtures/makeFakeDb'
import { defaultSenderName } from '../../src/app/senderName'
import { ContactBook } from '../../src/extract/contactBook'
import { MessagesDb } from '../../src/extract/messagesDb'
import { openNodeSqlite } from '../../src/extract/sqliteNode'

let dir: string
let fake: FakeDb
let db: MessagesDb
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sender-name-test-'))
  fake = makeFakeDb(dir)
  db = MessagesDb.open(openNodeSqlite, fake.path)
})
afterAll(() => {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const noAccount = () => ''

describe('own handles', () => {
  it('finds the number and email I send from, without the "E:" prefix', () => {
    expect(db.ownHandles().sort()).toEqual([FAKE_ME.email, FAKE_ME.phone].sort())
  })
  it('copes with a database that has neither column', () => {
    const bare = path.join(dir, 'bare')
    fs.mkdirSync(bare)
    const file = makeFakeDb(bare).path
    const raw = new Database(file)
    raw.exec('ALTER TABLE message DROP COLUMN destination_caller_id; ALTER TABLE message DROP COLUMN account')
    raw.close()
    const old = MessagesDb.open(openNodeSqlite, file)
    try {
      expect(old.ownHandles()).toEqual([])
    } finally {
      old.close()
    }
  })
})

describe('defaultSenderName', () => {
  it('uses my own contact card: the nickname, else the first name', () => {
    const contacts = new ContactBook([
      { handle: FAKE_ME.phone, first: 'Smitkumar', last: 'Patel', nickname: 'Smit', org: null },
    ])
    expect(defaultSenderName(db.ownHandles(), contacts, () => 'Account Name')).toBe('Smit')
    const plain = new ContactBook([{ handle: FAKE_ME.email, first: 'Taylor', last: 'Morgan', nickname: null, org: null }])
    expect(defaultSenderName(db.ownHandles(), plain, noAccount)).toBe('Taylor')
  })
  it('falls back to the first word of the Mac account name', () => {
    expect(defaultSenderName(db.ownHandles(), new ContactBook([]), () => 'Smit Patel\n')).toBe('Smit')
  })
  it('is empty (keeping "You") when nothing is known', () => {
    expect(defaultSenderName([], new ContactBook([]), noAccount)).toBe('')
  })
})
