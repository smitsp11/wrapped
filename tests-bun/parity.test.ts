import { expect, test } from 'bun:test'
import fs from 'node:fs'
import { FAKE_PEOPLE } from '../fixtures/makeFakeDb'
import { copyDatabase } from '../src/extract/copyDb'
import { ContactBook } from '../src/extract/contactBook'
import { MessagesDb } from '../src/extract/messagesDb'
import { openBunSqlite } from '../src/extract/sqliteBun'
import { ALL_TIME, contactNames, plainRow } from '../scripts/plainRow'

const EXPECTED = '.parity/expected.json'
if (!fs.existsSync(EXPECTED)) throw new Error('.parity/expected.json is missing: run `npm run test:bun` (it generates it first)')
const expected = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'))

test('bun:sqlite reads chats and messages exactly like better-sqlite3', () => {
  const db = MessagesDb.open(openBunSqlite, expected.dbPath)
  try {
    expect(db.listChats()).toEqual(expected.chats)
    expect(db.messageRows(ALL_TIME).map(plainRow)).toEqual(expected.rows)
  } finally {
    db.close()
  }
})

test('bun:sqlite reads contacts exactly like better-sqlite3', () => {
  const names = contactNames(ContactBook.fromMac(openBunSqlite, expected.home))
  expect(names).toEqual(expected.contacts)
  expect(names[FAKE_PEOPLE.sam.handle]).toEqual({ full: 'Samuel Rivera', short: 'Sam' })
})

test('bun:sqlite sees rows that exist only in the -wal', () => {
  const copy = copyDatabase(expected.walPath)
  const db = openBunSqlite(copy.path)
  try {
    const rows = db.all('SELECT id, v FROM t ORDER BY id')
    expect(rows).toEqual(expected.walRows)
    expect(rows).toHaveLength(10)
  } finally {
    db.close()
    fs.rmSync(copy.dir, { recursive: true, force: true })
  }
})
