import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FAKE_ME, FAKE_PEOPLE, makeFakeDb, type FakeDb } from '../../fixtures/makeFakeDb'
import { MIN_MENTIONS, NO_APPLE_ACCOUNT, defaultSenderName, looksLikeName, nameCandidates, readAppleAccount, type AppleAccount } from '../../src/app/senderName'
import { ContactBook, type ContactEntry } from '../../src/extract/contactBook'
import { MessagesDb } from '../../src/extract/messagesDb'
import { normalizeRows } from '../../src/extract/normalize'
import { openNodeSqlite } from '../../src/extract/sqliteNode'
import type { Message } from '../../src/types'

const FROM = new Date(2026, 0, 1)
const TO = new Date(2027, 0, 1)

/** Everything defaultSenderName reads from one fake database. */
type Evidence = { ownHandles: string[]; messages: Message[]; chats: ReturnType<MessagesDb['listChats']> }

let dir: string
let fake: FakeDb
let db: MessagesDb
/** the default fake chat: nobody calls me by any name */
let plain: Evidence
/** the same chat, where Alex, Sam and Jordan call me Taylor */
let taylor: Evidence

function evidence(file: string): Evidence {
  const source = MessagesDb.open(openNodeSqlite, file)
  try {
    const { messages } = normalizeRows(source.messageRows({ from: FROM, to: TO }))
    return { ownHandles: source.ownHandles(), messages, chats: source.listChats() }
  } finally {
    source.close()
  }
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sender-name-test-'))
  fake = makeFakeDb(dir)
  db = MessagesDb.open(openNodeSqlite, fake.path)
  plain = evidence(fake.path)
  const named = path.join(dir, 'named')
  fs.mkdirSync(named)
  taylor = evidence(makeFakeDb(named, { callsMe: 'Taylor' }).path)
})
afterAll(() => {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const noAccount = () => ''
const noApple = () => NO_APPLE_ACCOUNT
const apple = (name: string, email = ''): (() => AppleAccount) => () => ({ name, email })
const card = (over: Partial<ContactEntry>): ContactEntry => ({ handle: FAKE_ME.phone, first: null, last: null, nickname: null, org: null, ...over })
/** my own card (on the number I send from), plus any other cards */
const book = (mine: Partial<ContactEntry>, ...others: ContactEntry[]) => new ContactBook([card(mine), ...others])
/** no cards on my handles, just a card marked as mine (with no number or email on it) */
const meCard = (first: string | null, nickname: string | null = null, ...others: ContactEntry[]) => new ContactBook(others, 0, [{ first, nickname }])
const JORDAN: ContactEntry = { handle: FAKE_PEOPLE.jordan.handle, first: 'Jordan', last: 'Lee', nickname: null, org: null }
const name = (from: Evidence, contacts: ContactBook, accountName: () => string = noAccount, appleAccount: () => AppleAccount = noApple) =>
  defaultSenderName({ ...from, contacts, accountName, appleAccount })

describe('own handles', () => {
  it('finds the number and email I send from, without the "E:" prefix', () => {
    expect(db.ownHandles().sort()).toEqual([FAKE_ME.email, FAKE_ME.phone].sort())
  })
  it('also finds the handles chats are signed in with, even with no sent message carrying them, and skips a bare "E:"', () => {
    const chatsOnly = path.join(dir, 'chats-only')
    fs.mkdirSync(chatsOnly)
    const file = makeFakeDb(chatsOnly).path
    const raw = new Database(file)
    raw.exec(`ALTER TABLE message DROP COLUMN destination_caller_id; ALTER TABLE message DROP COLUMN account;
      ALTER TABLE chat ADD COLUMN account_login TEXT; ALTER TABLE chat ADD COLUMN last_addressed_handle TEXT;`)
    raw.prepare("UPDATE chat SET account_login = ?, last_addressed_handle = ?").run(`E:${FAKE_ME.email}`, FAKE_ME.phone)
    raw.prepare('UPDATE chat SET account_login = ? WHERE ROWID = (SELECT MIN(ROWID) FROM chat)').run('E:')
    raw.close()
    const source = MessagesDb.open(openNodeSqlite, file)
    try {
      expect(source.ownHandles().sort()).toEqual([FAKE_ME.email, FAKE_ME.phone].sort())
    } finally {
      source.close()
    }
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

describe('looksLikeName', () => {
  it('rejects generic words, wherever they are in the name', () => {
    for (const word of ['General', 'me', 'My', 'Owner', 'Admin', 'User', 'Mac', 'MacBook', 'iPhone', 'iPad', 'Home', 'Work',
      'Mobile', 'Main', 'Personal', 'Default', 'Test', 'Unknown', 'Apple', 'iCloud', 'My iPhone', 'Home Phone']) {
      expect(looksLikeName(word), word).toBe(false)
    }
  })
  it('rejects single letters, digits, emoji and anything else that is not letters', () => {
    for (const word of ['T', 'T.', '7', 'Taylor2', '416 555 0100', '😀', '😀😀', 'me@example.com', '']) {
      expect(looksLikeName(word), word).toBe(false)
    }
  })
  it('accepts names, including accents, apostrophes, hyphens and two words', () => {
    for (const word of ['Taylor', 'Dario', 'Jo', 'José', "D'Arcy", 'Jean-Luc', 'Mary Anne']) expect(looksLikeName(word), word).toBe(true)
  })
})

describe('nameCandidates', () => {
  const names = (contacts: ContactBook, accountName: () => string, appleName = '') =>
    nameCandidates({ appleName, contacts, ownHandles: plain.ownHandles, accountName }).map((c) => c.name)

  it('lists my card’s nickname, then its first name, then the Mac account’s first word, skipping generic words and repeats', () => {
    const contacts = book({ first: 'Taylor', last: 'Morgan', nickname: 'Tay' }, card({ handle: FAKE_ME.email, first: 'General', last: 'Inbox' }))
    expect(names(contacts, () => 'Morgan Taylor')).toEqual(['Tay', 'Taylor', 'Morgan'])
    expect(names(contacts, () => 'taylor morgan')).toEqual(['Tay', 'Taylor'])
  })
  it('never offers a business card’s name or a last name', () => {
    const contacts = book({ org: 'Morgan Plumbing', last: 'Morgan' })
    expect(names(contacts, noAccount)).toEqual([])
  })
  it('puts the Apple Account’s first name, then the card marked as mine, before cards on my handles and the Mac account', () => {
    const contacts = new ContactBook([card({ first: 'Riley' })], 0, [{ first: 'Sam', nickname: 'Sammy' }])
    const candidates = nameCandidates({ appleName: ' Jamie  Lee ', contacts, ownHandles: plain.ownHandles, accountName: () => 'Casey Lee' })
    expect(candidates).toEqual([
      { name: 'Jamie', yours: true },
      { name: 'Sammy', yours: true },
      { name: 'Sam', yours: true },
      { name: 'Riley', yours: false },
      { name: 'Casey', yours: false },
    ])
  })
  it('skips an Apple Account or Me card that doesn’t look like a name', () => {
    expect(names(meCard('General', 'Me'), noAccount, 'Apple User')).toEqual([])
    expect(names(meCard(null), noAccount, '😀')).toEqual([])
  })
})

describe('defaultSenderName', () => {
  it('rejects a card named "General" and falls back to the Mac account name when others call me that', () => {
    const contacts = book({ first: 'General' })
    expect(name(taylor, contacts, () => 'Taylor Morgan\n')).toBe('Taylor')
    // Alex says "jordan" every other day: the account name wins over the greeting fallback (Taylor)
    expect(name(taylor, contacts, () => 'Jordan Lee')).toBe('Jordan')
  })
  it('keeps "You" when the card says "General" and nothing else holds up', () => {
    expect(name(plain, book({ first: 'General' }), () => 'General')).toBe('')
    expect(name(plain, book({ first: 'General' }), () => 'Taylor Morgan')).toBe('') // nobody here calls me Taylor
    expect(name(plain, new ContactBook([]), () => 'Mac User')).toBe('')
  })
  it('uses my card’s nickname, else its first name, when others call me by it', () => {
    expect(name(taylor, book({ first: 'Taylor', last: 'Morgan' }))).toBe('Taylor')
    expect(name(taylor, book({ first: 'Morgan', nickname: 'Taylor' }))).toBe('Taylor')
    // the nickname nobody uses is skipped for the first name they do use
    expect(name(taylor, book({ first: 'Taylor', nickname: 'Tay' }))).toBe('Taylor')
  })
  it('rejects a plausible name nobody uses', () => {
    expect(name(taylor, book({ first: 'Morgan' }))).toBe('Taylor') // greeted in DMs, so recovered instead
    expect(name(plain, book({ first: 'Morgan' }))).toBe('')
    expect(name(plain, new ContactBook([]), () => 'Morgan Lee')).toBe('')
  })
  it('recovers the name friends greet me with in one-on-one chats when no candidate holds up', () => {
    expect(name(taylor, book({ first: 'General' }), () => 'General')).toBe('Taylor')
    expect(name(taylor, new ContactBook([]))).toBe('Taylor')
  })
  it('rejects the name of someone I text, even when others say it a lot', () => {
    // Alex says "lol classic jordan rebuy" every other day, about Jordan
    expect(name(plain, book({ first: 'Jordan' }))).toBe('Jordan') // without Jordan's card it can't tell
    const withJordan = book({ first: 'Jordan' }, JORDAN)
    expect(name(plain, withJordan)).toBe('')
  })
})

describe('names I gave myself: my Apple Account and my Me card', () => {
  it('takes them with no chat evidence at all, since nobody else typed them', () => {
    expect(name(plain, new ContactBook([]), noAccount, apple('Taylor Morgan'))).toBe('Taylor')
    expect(name(plain, meCard('Taylor'))).toBe('Taylor')
    expect(name(plain, meCard('Taylor', 'Tay'))).toBe('Tay')
  })
  it('puts the Apple Account first, then the Me card, ahead of a card on my number or the Mac account', () => {
    expect(name(plain, book({ first: 'Riley' }), () => 'Casey Lee', apple('Taylor Morgan'))).toBe('Taylor')
    const both = new ContactBook([card({ first: 'Riley' })], 0, [{ first: 'Sam', nickname: null }])
    expect(name(plain, both, () => 'Casey Lee')).toBe('Sam')
  })
  it('agrees with the name friends greet me with', () => {
    expect(name(taylor, new ContactBook([]), noAccount, apple('Taylor Morgan'))).toBe('Taylor')
    expect(name(taylor, meCard('Taylor'))).toBe('Taylor')
  })
  it('needs the usual evidence when friends greet me by a different name (a parent’s Apple Account on a family Mac)', () => {
    expect(name(taylor, new ContactBook([]), noAccount, apple('Morgan Lee'))).toBe('Taylor')
    expect(name(taylor, meCard('Morgan'))).toBe('Taylor')
  })
  it('rejects the name of someone I text', () => {
    expect(name(plain, new ContactBook([JORDAN]), noAccount, apple('Jordan Lee'))).toBe('')
    expect(name(plain, meCard('Jordan', null, JORDAN))).toBe('')
  })
  it('skips names that are not names, and moves on to the next source', () => {
    expect(name(plain, new ContactBook([]), noAccount, apple('Apple User'))).toBe('')
    expect(name(plain, meCard('General'), noAccount, apple('Mac Admin'))).toBe('')
    expect(name(taylor, meCard('General'), noAccount, apple('iCloud User'))).toBe('Taylor') // the greeting fallback
  })
  it('finds my card by the Apple Account’s email too (a card on it still needs the usual evidence)', () => {
    const riley = [...filler(20), ...mentions(3, 'is riley coming')]
    const contacts = new ContactBook([card({ handle: 'apple-id@example.com', first: 'Riley' })])
    const run = (appleAccount: () => AppleAccount) =>
      defaultSenderName({ ownHandles: [FAKE_ME.phone], contacts, accountName: noAccount, appleAccount, messages: riley, chats: CHATS })
    expect(run(apple('', 'Apple-ID@example.com'))).toBe('Riley')
    expect(run(noApple)).toBe('')
  })
})

/** Hand-made evidence for the thresholds: chat 1 is a group, chats 2-4 are one-on-one. */
const CHATS = [
  { id: 1, isGroup: true, memberIds: ['+14165550101', '+14165550102'] },
  { id: 2, isGroup: false, memberIds: ['+14165550101'] },
  { id: 3, isGroup: false, memberIds: ['+14165550102'] },
  { id: 4, isGroup: false, memberIds: ['+14165550104'] },
]
let nextId = 0
function message(chatId: number, from: 'me' | 'them', text: string): Message {
  const id = ++nextId
  return {
    id, guid: `G${id}`, chatId, senderId: from === 'me' ? 'me' : 'p1', sentAt: new Date(2026, 0, 5), text,
    isFromMe: from === 'me', reactsToGuid: null, reactionType: null, reactionEmoji: null, hasAttachment: false,
  }
}
/** `n` messages from others in the group, each mentioning the name once (plus filler) */
const mentions = (n: number, text = 'is taylor coming') => Array.from({ length: n }, () => message(1, 'them', text))
const filler = (n: number, from: 'me' | 'them' = 'them') => Array.from({ length: n }, () => message(1, from, 'see you at 8'))
const fromHand = (messages: Message[], contacts: ContactBook = new ContactBook([])) =>
  defaultSenderName({ ownHandles: [], contacts, accountName: () => 'Taylor Morgan', appleAccount: noApple, messages, chats: CHATS })

describe('the mention check', () => {
  it(`needs at least ${MIN_MENTIONS} messages from others that use the name`, () => {
    expect(fromHand([...filler(20), ...mentions(MIN_MENTIONS - 1)])).toBe('')
    expect(fromHand([...filler(20), ...mentions(MIN_MENTIONS)])).toBe('Taylor')
  })
  it('matches whole words in any case, not parts of words', () => {
    expect(fromHand([...filler(20), ...mentions(3, 'TAYLOR!! where are you')])).toBe('Taylor')
    expect(fromHand([...filler(20), ...mentions(3, "taylor's car")])).toBe('Taylor')
    expect(fromHand([...filler(20), ...mentions(5, 'taylorswift tickets')])).toBe('')
  })
  it('ignores my own messages and reactions', () => {
    expect(fromHand([...filler(20), ...Array.from({ length: 5 }, () => message(1, 'me', 'taylor here'))])).toBe('')
    const reactions = mentions(5).map((m) => ({ ...m, reactionType: 'love' as const }))
    expect(fromHand([...filler(20), ...reactions])).toBe('')
  })
  it('rejects a word I use about as often as everyone else (a friend’s name, an everyday word)', () => {
    // others: 3 of 23 messages; me: 1 of 8 (about the same rate)
    expect(fromHand([...filler(20), ...mentions(3), ...filler(7, 'me'), message(1, 'me', 'taylor said 8')])).toBe('')
    // me: 1 of 40 (others say it far more often)
    expect(fromHand([...filler(20), ...mentions(3), ...filler(39, 'me'), message(1, 'me', 'taylor said 8')])).toBe('Taylor')
  })
})

describe('the greeting fallback', () => {
  const greet = (chatId: number, text: string) => message(chatId, 'them', text)
  const noCandidates = (messages: Message[]) =>
    defaultSenderName({ ownHandles: [], contacts: new ContactBook([]), accountName: () => 'General', appleAccount: noApple, messages, chats: CHATS })

  it('takes the capitalised name after a greeting, from at least two one-on-one chats', () => {
    expect(noCandidates([greet(2, 'Hey Dario, you up?'), greet(3, 'thanks Dario!!'), greet(2, 'Happy birthday Dario 🎂')])).toBe('Dario')
    expect(noCandidates([greet(2, 'heyyy Dario'), greet(2, 'Hi Dario'), greet(2, 'Good morning Dario')])).toBe('') // one chat only
  })
  it('ignores greetings in group chats, where they could be for anyone', () => {
    expect(noCandidates([greet(1, 'Hey Dario'), greet(1, 'Hey Dario'), greet(1, 'Hey Dario'), greet(2, 'Hey Dario')])).toBe('')
  })
  it('ignores nicknames, everyday words and lowercase words after a greeting', () => {
    const messages = [2, 3, 4].flatMap((chat) => [greet(chat, 'Hey Bro'), greet(chat, 'Thanks Man'), greet(chat, 'Hi There'), greet(chat, 'hey dario')])
    expect(noCandidates(messages)).toBe('')
  })
  it('takes names that are also everyday words, which the mention check alone would reject', () => {
    const will = [greet(2, 'Hey Will!'), greet(3, 'happy birthday Will 🎂'), greet(4, 'thanks Will')]
    expect(noCandidates(will)).toBe('Will')
    // My card says Will and "will" is everywhere in my own texts, but friends greet me as Will: that's enough.
    const everyday = [...will, ...[2, 3, 4].flatMap((chat) => [message(chat, 'me', 'I will be there'), message(chat, 'them', 'will do')])]
    const mine = defaultSenderName({ ownHandles: [FAKE_ME.phone], contacts: book({ first: 'Will' }), accountName: noAccount, appleAccount: noApple, messages: everyday, chats: CHATS })
    expect(mine).toBe('Will')
  })
  it('only counts a name straight after the greeting, not the start of a new sentence', () => {
    expect(noCandidates([greet(2, 'Hey. Will you come?'), greet(3, 'Thanks! Will do'), greet(4, 'hi. Will you?')])).toBe('')
  })
  it('gives up when two names are close', () => {
    const messages = [greet(2, 'Hey Dario'), greet(3, 'Hey Dario'), greet(4, 'Hey Dario'), greet(2, 'Hey Sara'), greet(3, 'Hey Sara')]
    expect(noCandidates(messages)).toBe('')
    expect(noCandidates([...messages, greet(4, 'Hey Dario')])).toBe('Dario')
  })
})

describe('readAppleAccount', () => {
  const hasPlistBuddy = fs.existsSync('/usr/libexec/PlistBuddy')
  const plist = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${body}</dict></plist>\n`
  const fakeHome = (files: { cache?: string; mobileMe?: string; accountsUser?: string }) => {
    const home = fs.mkdtempSync(path.join(dir, 'home-'))
    const prefs = path.join(home, 'Library', 'Preferences')
    fs.mkdirSync(prefs, { recursive: true })
    if (files.cache) fs.writeFileSync(path.join(prefs, 'com.apple.appleaccount.informationcache.plist'), plist(files.cache))
    if (files.mobileMe) fs.writeFileSync(path.join(prefs, 'MobileMeAccounts.plist'), plist(files.mobileMe))
    if (files.accountsUser) {
      fs.mkdirSync(path.join(home, 'Library', 'Accounts'))
      const db = new Database(path.join(home, 'Library', 'Accounts', 'Accounts4.sqlite'))
      db.exec(`CREATE TABLE ZACCOUNTTYPE (Z_PK INTEGER PRIMARY KEY, ZIDENTIFIER TEXT);
        CREATE TABLE ZACCOUNT (Z_PK INTEGER PRIMARY KEY, ZACCOUNTTYPE INTEGER, ZUSERNAME TEXT, ZACTIVE INTEGER);
        INSERT INTO ZACCOUNTTYPE VALUES (1, 'com.apple.account.IMAP'), (2, 'com.apple.account.AppleAccount');
        INSERT INTO ZACCOUNT VALUES (1, 1, 'mail@example.com', 1);`)
      db.prepare('INSERT INTO ZACCOUNT VALUES (2, 2, ?, 1)').run(files.accountsUser)
      db.close()
    }
    return home
  }
  const signedIn = (name: string, yes = true) => `<key>AAAccountFullName</key><string>${name}</string><key>AAIsAccountSignedIn</key><${yes}/>`
  const mobileMe = (name: string, email: string) =>
    `<key>Accounts</key><array><dict><key>AccountID</key><string>${email}</string><key>DisplayName</key><string>${name}</string></dict></array>`

  it.skipIf(!hasPlistBuddy)('reads the name from the account cache and the email from the Accounts database, leaving no copies', () => {
    const spy = vi.spyOn(fs, 'mkdtempSync')
    let account: AppleAccount
    let copies: string[]
    try {
      account = readAppleAccount(openNodeSqlite, fakeHome({ cache: signedIn('Taylor Morgan'), accountsUser: 'taylor@example.com' }))
      copies = spy.mock.results.map((r) => String(r.value)).filter((p) => path.basename(p).startsWith('wrapped-'))
    } finally {
      spy.mockRestore()
    }
    expect(account).toEqual({ name: 'Taylor Morgan', email: 'taylor@example.com' })
    expect(copies).toHaveLength(1)
    for (const c of copies) expect(fs.existsSync(c)).toBe(false)
  })
  it.skipIf(!hasPlistBuddy)('falls back to MobileMeAccounts.plist (older macOS), and ignores a signed-out cache', () => {
    const home = fakeHome({ cache: signedIn('Morgan Lee', false), mobileMe: mobileMe('Taylor Morgan', 'taylor@example.com'), accountsUser: 'other@example.com' })
    expect(readAppleAccount(openNodeSqlite, home)).toEqual({ name: 'Taylor Morgan', email: 'taylor@example.com' })
  })
  it('is empty when nothing is there or nothing can be read', () => {
    expect(readAppleAccount(openNodeSqlite, fakeHome({}))).toEqual(NO_APPLE_ACCOUNT)
    const junk = fakeHome({})
    fs.writeFileSync(path.join(junk, 'Library', 'Preferences', 'com.apple.appleaccount.informationcache.plist'), 'not a plist')
    fs.mkdirSync(path.join(junk, 'Library', 'Accounts'))
    fs.writeFileSync(path.join(junk, 'Library', 'Accounts', 'Accounts4.sqlite'), 'junk bytes, not sqlite')
    expect(readAppleAccount(openNodeSqlite, junk)).toEqual(NO_APPLE_ACCOUNT)
  })
})
