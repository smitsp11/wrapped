import fs from 'node:fs'
import path from 'node:path'
import { makeAddressBook } from '../fixtures/makeAddressBook'
import { FAKE_PEOPLE, makeFakeDb } from '../fixtures/makeFakeDb'
import Database from 'better-sqlite3'
import { ContactBook } from '../src/extract/contactBook'
import { copyDatabase } from '../src/extract/copyDb'
import { MessagesDb } from '../src/extract/messagesDb'
import { openNodeSqlite } from '../src/extract/sqliteNode'
import { ALL_TIME, contactNames, plainRow } from './plainRow'

const DIR = path.resolve('.parity')
fs.rmSync(DIR, { recursive: true, force: true })
fs.mkdirSync(DIR)

const fake = makeFakeDb(DIR)
const home = path.join(DIR, 'home')
makeAddressBook(path.join(home, 'Library', 'Application Support', 'AddressBook', 'AddressBook-v22.abcddb'), [
  { first: 'Alex', last: 'Chen', phones: [FAKE_PEOPLE.alex.handle] },
  { first: 'Jordan', last: 'Lee', emails: [FAKE_PEOPLE.jordan.handle] },
  { first: 'Samuel', last: 'Rivera', nickname: 'Sam', phones: [FAKE_PEOPLE.sam.handle] },
])

/** A WAL database whose second batch lives ONLY in the -wal, copied while the writer is open (the real chat.db shape). */
function makeWalOnlyDb(): string {
  const walDir = path.join(DIR, 'wal')
  fs.mkdirSync(walDir)
  const file = path.join(walDir, 'wal.db')
  const w = new Database(path.join(DIR, 'wal-writer.db'))
  try {
    w.pragma('journal_mode = WAL')
    w.pragma('wal_autocheckpoint = 0')
    w.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    const insert = w.prepare('INSERT INTO t (v) VALUES (?)')
    for (let i = 0; i < 5; i++) insert.run(`first ${i}`)
    w.pragma('wal_checkpoint(TRUNCATE)')
    for (let i = 0; i < 5; i++) insert.run(`second ${i}`)
    const src = path.join(DIR, 'wal-writer.db')
    for (const suffix of ['', '-wal', '-shm']) fs.copyFileSync(src + suffix, file + suffix)
  } finally {
    w.close()
  }
  return file
}

function readWalRows(file: string): unknown[] {
  const copy = copyDatabase(file)
  const walDb = openNodeSqlite(copy.path)
  try {
    return walDb.all('SELECT id, v FROM t ORDER BY id')
  } finally {
    walDb.close()
    fs.rmSync(copy.dir, { recursive: true, force: true })
  }
}

const walPath = makeWalOnlyDb()

const db = MessagesDb.open(openNodeSqlite, fake.path)
try {
  const expected = {
    dbPath: fake.path,
    home,
    chats: db.listChats(),
    rows: db.messageRows(ALL_TIME).map(plainRow),
    contacts: contactNames(ContactBook.fromMac(openNodeSqlite, home)),
    walPath,
    walRows: readWalRows(walPath),
  }
  fs.writeFileSync(path.join(DIR, 'expected.json'), JSON.stringify(expected))
} finally {
  db.close()
}
