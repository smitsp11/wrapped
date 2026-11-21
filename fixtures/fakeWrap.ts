import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lastYearChange } from '../src/app/lastYear'
import { maskHandle } from '../src/format'
import { MessagesDb } from '../src/extract/messagesDb'
import { normalizeRows } from '../src/extract/normalize'
import { openNodeSqlite } from '../src/extract/sqliteNode'
import { SHOWN_HITS } from '../src/stats/greatestHits'
import { countWords } from '../src/stats/words'
import type { Wrap } from '../src/types'
import { buildWrap } from '../src/wrap/buildWrap'
import { FAKE_PEOPLE, makeFakeDb } from './makeFakeDb'
import { EXTRA_PEOPLE } from './realisticChat'

const FROM = new Date(2026, 0, 1)
const TO = new Date(2027, 0, 1)

function fakeName(handle: string): string {
  return [...Object.values(FAKE_PEOPLE), ...Object.values(EXTRA_PEOPLE)].find((p) => p.handle === handle)?.name ?? maskHandle(handle)
}

/**
 * Builds a wrap from a freshly generated fake chat.db. Used by tests and `wrapped demo`.
 * `textingStyles: false` leaves out the messages that give everyone a distinct texting style (the fake chat before them),
 * and `moreHits: false` the reactions that give the fake chat a third greatest hit (see makeFakeDb).
 * `yearRound` adds the rest of the year (see makeFakeDb): the demo uses it, so its months and month-by-month slides look
 * like a real year.
 * `realistic` builds it from the busy, made-up year instead (see realisticChat.ts; the other options don't apply): the
 * demo and the landing page use it. It keeps only the greatest hits the slides show, so the demo stays small.
 */
export function makeFakeWrap(
  mode: 'group' | 'solo' = 'group',
  { textingStyles = true, yearRound = false, moreHits = true, realistic = false } = {},
): Wrap {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapped-fake-'))
  try {
    const fake = makeFakeDb(dir, realistic ? { realistic } : { hitConversations: true, textingStyles, yearRound, moreHits })
    const db = MessagesDb.open(openNodeSqlite, fake.path)
    try {
      const chats = db.listChats().map((c) => ({ ...c, name: c.name || fakeName(c.memberIds[0] ?? '') }))
      const chatIds = mode === 'group' ? [fake.groupChatId] : undefined
      const { messages } = normalizeRows(db.messageRows({ chatIds, from: FROM, to: TO }))
      // group top words are compared with every fake chat, like the app does
      const wordBaseline = countWords(normalizeRows(db.messageRows({ from: FROM, to: TO })).messages)
      const title = mode === 'group' ? 'Poker Night' : 'Your 2026'
      // like the app: against the same dates last year, when the fake history goes back that far
      const vsLastYear = lastYearChange(db, db.messageSpan(), { from: FROM, to: TO }, chatIds)
      const ownHandles = db.ownHandles()
      const wrap = buildWrap(messages, { mode, title, from: FROM, to: TO, nameFor: fakeName, chats, wordBaseline, vsLastYear, ownHandles })
      return realistic ? { ...wrap, greatestHits: wrap.greatestHits.slice(0, SHOWN_HITS) } : wrap
    } finally {
      db.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
