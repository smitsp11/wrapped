import path from 'node:path'
import Database from 'better-sqlite3'
import { toAppleNs } from '../src/extract/appleTime'
import { makeAttributedBody } from './attributedBody'

/** Fake people. The handles use reserved 555-01xx numbers and example.com. */
export const FAKE_PEOPLE = {
  alex: { handle: '+14165550101', name: 'Alex Chen' },
  sam: { handle: '+14165550102', name: 'Sam Rivera' },
  jordan: { handle: 'jordan@example.com', name: 'Jordan Lee' },
  riley: { handle: '+14165550104', name: 'Riley Park' },
} as const

/** The phone number and email the fake "me" sends from (on my own messages, like Messages records them). */
export const FAKE_ME = { phone: '+14165550100', email: 'me@example.com' } as const

type Friend = keyof typeof FAKE_PEOPLE
type Sender = Friend | 'me'

/**
 * Book Club, one group that Messages keeps as three chat rows, plus a different group with the same name.
 * Every message is at 18:00 UTC on its day (day 0 is Monday 2026-01-05).
 * - main (iMessage; Alex, Sam, Jordan): one message a day, days 0-9 and 20-29
 * - sms (SMS; Alex, Sam): days 10-19, the gap in main
 * - linked (Alex by email only, so no member in common; Apple's original_group_id points at main): day 30, from me
 * - stranger (Riley and two people not in the others): days 0-4. Same name, other people: a separate group.
 * Merged, Book Club is 31 messages on 31 days in a row; main alone has an 11-day gap and a 10-day streak.
 */
export type SplitGroups = { mainChatId: number; smsChatId: number; linkedChatId: number; strangerChatId: number }

export type FakeDb = { path: string; groupChatId: number; dmChatId: number; split?: SplitGroups }

/** The subset of Apple's real schema that MessagesDb reads, with the same names. */
const SCHEMA = `
  CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, service TEXT);
  CREATE TABLE chat (
    ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT, style INTEGER, chat_identifier TEXT, service_name TEXT, display_name TEXT,
    group_id TEXT, original_group_id TEXT
  );
  CREATE TABLE message (
    ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, text TEXT, attributedBody BLOB,
    handle_id INTEGER DEFAULT 0, date INTEGER, is_from_me INTEGER DEFAULT 0, item_type INTEGER DEFAULT 0,
    cache_has_attachments INTEGER DEFAULT 0, associated_message_guid TEXT,
    associated_message_type INTEGER DEFAULT 0, associated_message_emoji TEXT,
    destination_caller_id TEXT, account TEXT
  );
  CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER, message_date INTEGER DEFAULT 0, PRIMARY KEY (chat_id, message_id));
  CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER, UNIQUE (chat_id, handle_id));
  CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT, filename TEXT, uti TEXT, mime_type TEXT, transfer_name TEXT);
  CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER, UNIQUE (message_id, attachment_id));
`

const LOVE = 2000
const LAUGH = 2003
const REMOVE_LAUGH = 3003
const GROUP_STYLE = 43
const DM_STYLE = 45

/** Riley's notes, one every ten days, 45 minutes into the evening. Each starts with "dealer says", so "dealer" is Riley's signature word. */
const RILEY_NOTES = [
  "dealer says: who's hosting friday",
  "dealer says: the buy-in is snacks",
  "dealer says: bringing the chips",
  "dealer says: found a new deck",
  "dealer says: that bad beat was classic",
  "dealer says: rematch next week?",
]

/** An attachment's type as Messages records it: a MIME type (sometimes empty) and a UTI. */
type FakeAttachment = { mime: string; uti: string }
const PHOTO: FakeAttachment = { mime: 'image/heic', uti: 'public.heic' }
const VIDEO: FakeAttachment = { mime: '', uti: 'com.apple.quicktime-movie' }

type AddOptions = { text?: string; body?: Buffer; attachment?: FakeAttachment; itemType?: number; reactTo?: string; reactType?: number }

/**
 * `splitGroups` adds Book Club (see SplitGroups) after everything else, so the default database never changes.
 * `hitConversations` adds a short conversation around each greatest hit, for "what was the convo?" (fakeWrap and the demo use it).
 */
export function makeFakeDb(dir: string, { splitGroups = false, hitConversations = false } = {}): FakeDb {
  const dbPath = path.join(dir, 'chat.db')
  const db = new Database(dbPath)
  try {
    db.pragma('journal_mode = WAL') // Messages uses WAL
    db.exec(SCHEMA)

    const insertHandle = db.prepare('INSERT INTO handle (id, service) VALUES (?, ?)')
    const handleIds = {} as Record<Friend, number>
    for (const key of Object.keys(FAKE_PEOPLE) as Friend[]) {
      handleIds[key] = Number(insertHandle.run(FAKE_PEOPLE[key].handle, 'iMessage').lastInsertRowid)
    }

    const insertChat = db.prepare(`INSERT INTO chat (guid, style, chat_identifier, service_name, display_name, group_id, original_group_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    const insertMember = db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)')
    /** Like Messages, a new group's original_group_id is its own group_id unless `originalGroupId` says otherwise. */
    function addChat(style: number, identifier: string, name: string, members: number[], service = 'iMessage', originalGroupId?: string): number {
      const groupId = `FAKE-GROUP-${identifier}`
      const guid = `${service};${style === GROUP_STYLE ? '+' : '-'};${identifier}`
      const id = Number(insertChat.run(guid, style, identifier, service, name, groupId, originalGroupId ?? groupId).lastInsertRowid)
      for (const member of members) insertMember.run(id, member)
      return id
    }
    const groupChatId = addChat(GROUP_STYLE, 'chat100000000000000001', 'Poker Night', Object.values(handleIds))
    const dmChatId = addChat(DM_STYLE, FAKE_PEOPLE.alex.handle, '', [handleIds.alex])

    const insertMessage = db.prepare(`
      INSERT INTO message (guid, text, attributedBody, handle_id, date, is_from_me, cache_has_attachments, item_type,
        associated_message_guid, associated_message_type, destination_caller_id, account)
      VALUES (@guid, @text, @body, @handleId, @date, @fromMe, @attachment, @itemType, @assocGuid, @assocType, @callerId, @account)`)
    const insertJoin = db.prepare('INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?, ?, ?)')
    const insertAttachment = db.prepare('INSERT INTO attachment (guid, filename, uti, mime_type, transfer_name) VALUES (?, ?, ?, ?, ?)')
    const insertAttachmentJoin = db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)')

    let counter = 0
    function add(chatId: number, sender: Sender, sentAt: Date, opts: AddOptions = {}): string {
      const guid = `FAKE-${String(++counter).padStart(5, '0')}`
      const fromMe = sender === 'me'
      // Like Messages: my own group messages have handle_id 0; in a DM they carry the other person's handle.
      const handleId = fromMe ? (chatId === dmChatId ? handleIds.alex : 0) : handleIds[sender]
      const date = toAppleNs(sentAt)
      const { lastInsertRowid } = insertMessage.run({
        guid,
        text: opts.text ?? null,
        body: opts.body ?? null,
        handleId,
        date,
        fromMe: fromMe ? 1 : 0,
        attachment: opts.attachment ? 1 : 0,
        itemType: opts.itemType ?? 0,
        assocGuid: opts.reactTo ? `p:0/${opts.reactTo}` : null,
        assocType: opts.reactType ?? 0,
        callerId: fromMe ? FAKE_ME.phone : null,
        account: fromMe ? `E:${FAKE_ME.email}` : null,
      })
      insertJoin.run(chatId, lastInsertRowid, date)
      if (opts.attachment) {
        const { mime, uti } = opts.attachment
        const file = `~/Library/Messages/Attachments/fake/${guid}`
        const attachmentId = insertAttachment.run(`AT-${guid}`, file, uti, mime, guid).lastInsertRowid
        insertAttachmentJoin.run(lastInsertRowid, attachmentId)
      }
      return guid
    }

    /** Day 0 is Monday 2026-01-05; times are UTC. */
    function at(day: number, time: string): Date {
      const [hours = 0, minutes = 0] = time.split(':').map(Number)
      return new Date(Date.UTC(2026, 0, 5 + day, hours, minutes))
    }

    db.transaction(() => {
      for (let d = 0; d < 60; d++) {
        // a system event (group rename), not a message
        if (d === 0) add(groupChatId, 'riley', at(d, '19:00'), { itemType: 2 })
        const opener = add(groupChatId, 'alex', at(d, '20:00'), { text: 'poker tonight?' })
        add(groupChatId, 'sam', at(d, '20:03'), { reactTo: opener, reactType: LAUGH })
        add(groupChatId, 'sam', at(d, '20:04'), { text: 'bet, bringing poker chips 🃏' })
        if (d % 12 === 0) add(groupChatId, 'sam', at(d, '20:05'), { text: 'omw, dealer' })
        if (d === 10) add(groupChatId, 'sam', at(d, '20:06'), { text: '\uFFFC', attachment: VIDEO })
        const omw = add(groupChatId, 'me', at(d, '20:14'), { text: 'omw' })
        if (d === 7) for (const who of ['me', 'jordan', 'riley'] as const) add(groupChatId, who, at(d, '20:20'), { reactTo: opener, reactType: LAUGH })
        if (d === 20) for (const who of ['alex', 'sam', 'jordan'] as const) add(groupChatId, who, at(d, '20:30'), { reactTo: omw, reactType: LOVE })
        if (d % 3 === 0) add(groupChatId, 'me', at(d, '20:40'), { text: 'who has the cards and chips. run it back' })
        if (d % 10 === 0) add(groupChatId, 'riley', at(d, '20:45'), { text: RILEY_NOTES[d / 10]! })
        if (d === 30) {
          add(groupChatId, 'riley', at(d, '20:50'), { reactTo: opener, reactType: LAUGH })
          add(groupChatId, 'riley', at(d, '20:51'), { reactTo: opener, reactType: REMOVE_LAUGH })
        }
        if (d === 45) add(groupChatId, 'alex', at(d, '20:50'), { body: Buffer.from([1, 2, 3]) })
        const sorry = add(groupChatId, 'jordan', at(d + 1, '01:14'), { body: makeAttributedBody('sorry sorry, all in. rebuy?') })
        if (d % 2 === 0) add(groupChatId, 'alex', at(d + 1, '01:15'), { text: 'lol classic jordan rebuy, run it back' })
        if (d % 2 === 0) add(groupChatId, 'me', at(d + 1, '01:30'), { reactTo: sorry, reactType: LOVE })
      }
      if (hitConversations) {
        // Each greatest hit sits in a short conversation (the loop above adds the rest of it).
        // Day 7: Jordan retires from the game, so Alex's "poker tonight?" at 20:00 gets the laughs.
        add(groupChatId, 'alex', at(7, '18:30'), { text: 'you good? you left in a hurry last night' })
        add(groupChatId, 'jordan', at(7, '18:32'), { text: "ok I'm officially retiring. selling everything" })
        add(groupChatId, 'jordan', at(7, '18:33'), { text: '\uFFFC', attachment: PHOTO })
        add(groupChatId, 'sam', at(7, '18:35'), { text: 'is that a ziploc of pennies' })
        const retiring = add(groupChatId, 'riley', at(7, '18:36'), { text: 'third retirement this month' })
        add(groupChatId, 'alex', at(7, '18:37'), { reactTo: retiring, reactType: LAUGH })
        add(groupChatId, 'jordan', at(7, '18:38'), { text: "it's different this time. I've grown" })
        add(groupChatId, 'sam', at(7, '18:41'), { text: 'proud of you honestly' })
        add(groupChatId, 'jordan', at(7, '18:52'), { text: "thank you. it's been a journey" })
        add(groupChatId, 'jordan', at(7, '20:09'), { text: '...what time' })
        add(groupChatId, 'riley', at(7, '20:10'), { text: "aaand we're back" })
        add(groupChatId, 'jordan', at(7, '20:16'), { text: 'unretiring. one night only' })
        // Day 20: everyone gives up on you, then your "omw" at 20:14 gets the hearts.
        add(groupChatId, 'jordan', at(20, '20:06'), { text: 'are we four or five this time' })
        add(groupChatId, 'riley', at(20, '20:08'), { text: 'four. someone has been "busy" for three weeks' })
        add(groupChatId, 'alex', at(20, '20:09'), { text: 'they said maybe. maybe means no' })
        add(groupChatId, 'sam', at(20, '20:11'), { text: 'rip to a real one' })
        add(groupChatId, 'jordan', at(20, '20:15'), { text: 'WAIT' })
        add(groupChatId, 'riley', at(20, '20:15'), { text: 'pulling up a fifth chair' })
        const returns = add(groupChatId, 'alex', at(20, '20:16'), { text: 'the prodigal texter returns' })
        add(groupChatId, 'sam', at(20, '20:17'), { reactTo: returns, reactType: LAUGH })
      }
      for (let i = 0; i < 10; i++) {
        add(dmChatId, i % 2 === 0 ? 'alex' : 'me', new Date(Date.UTC(2026, 1, 1, 12, 2 * i)), { text: `dm message ${i}` })
      }
    })()

    if (!splitGroups) return { path: dbPath, groupChatId, dmChatId }
    const extra = (handle: string) => Number(insertHandle.run(handle, 'iMessage').lastInsertRowid)
    const [stranger1, stranger2, alexEmail] = [extra('+14165550105'), extra('+14165550106'), extra('alex@example.com')]
    const { alex, sam, jordan, riley } = handleIds
    const split: SplitGroups = {
      mainChatId: addChat(GROUP_STYLE, 'chat200000000000000001', 'Book Club', [alex, sam, jordan]),
      smsChatId: addChat(GROUP_STYLE, 'chat200000000000000002', 'Book Club', [alex, sam], 'SMS'),
      linkedChatId: addChat(GROUP_STYLE, 'chat200000000000000003', 'Book Club', [alexEmail], 'iMessage', 'FAKE-GROUP-chat200000000000000001'),
      strangerChatId: addChat(GROUP_STYLE, 'chat200000000000000004', 'Book Club', [riley, stranger1, stranger2]),
    }
    db.transaction(() => {
      for (let d = 0; d < 30; d++) {
        const chatId = d >= 10 && d < 20 ? split.smsChatId : split.mainChatId
        add(chatId, d % 2 === 0 ? 'alex' : 'sam', at(d, '18:00'), { text: `chapter ${d + 1} done` })
      }
      add(split.linkedChatId, 'me', at(30, '18:00'), { text: 'finished the book' })
      for (let d = 0; d < 5; d++) add(split.strangerChatId, d % 2 === 0 ? 'riley' : 'me', at(d, '18:00'), { text: 'which book again' })
    })()
    return { path: dbPath, groupChatId, dmChatId, split }
  } finally {
    db.close()
  }
}
