import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { MessagesDb } from '../../src/extract/messagesDb'
import { normalizeRows } from '../../src/extract/normalize'
import { openNodeSqlite } from '../../src/extract/sqliteNode'
import type { Wrap } from '../../src/types'
import { FAKE_PEOPLE, makeFakeDb } from '../../fixtures/makeFakeDb'
import { makeFakeWrap } from '../../fixtures/fakeWrap'

const nameOf = (wrap: Wrap, id: string) => wrap.people[id]

describe('the fake "Poker Night" chat', () => {
  let wrap: Wrap
  beforeAll(() => {
    wrap = makeFakeWrap('group')
  })

  it('counts every message', () => {
    expect(wrap.volume.total).toBe(320)
    expect(Object.fromEntries(Object.entries(wrap.volume.byPerson).map(([id, n]) => [nameOf(wrap, id), n]))).toEqual({
      'Alex Chen': 93, You: 80, 'Sam Rivera': 69, 'Jordan Lee': 68, 'Riley Park': 10,
    })
  })

  it('gives the expected awards', () => {
    expect(wrap.awards.map((a) => [a.id, nameOf(wrap, a.personId), a.value])).toEqual([
      ['main-character', 'Alex Chen', 29.1],
      ['ghost', 'Jordan Lee', 314],
      ['starter', 'Alex Chen', 60],
      ['comedian', 'Alex Chen', 68.8],
      ['hype', 'Sam Rivera', 62],
      ['night-owl', 'Jordan Lee', 88.2],
      ['double-texter', 'You', 20],
    ])
  })

  it('times how fast each person joins the conversations Alex starts', () => {
    const byName = (record: Record<string, number>) =>
      Object.fromEntries(Object.entries(record).map(([id, n]) => [nameOf(wrap, id), n]))
    // Alex starts every evening, so Alex is never timed.
    expect(byName(wrap.replies.medianReplyMinutesByPerson)).toEqual({
      'Sam Rivera': 4, You: 14, 'Riley Park': 45, 'Jordan Lee': 314,
    })
    expect(byName(wrap.replies.repliesByPerson)).toEqual({
      'Sam Rivera': 60, You: 60, 'Riley Park': 7, 'Jordan Lee': 60,
    })
  })

  it('finds the streak, the greatest hits and the signature words', () => {
    expect(wrap.timing.longestStreakDays).toBe(61)
    expect(wrap.greatestHits.map((h) => [nameOf(wrap, h.senderId), h.text, h.reactions])).toEqual([
      ['Alex Chen', 'poker tonight?', 4],
      ['You', 'omw', 3],
    ])
    expect(Object.fromEntries(Object.entries(wrap.words.signatureWordByPerson).map(([id, w]) => [nameOf(wrap, id), w]))).toEqual({
      'Alex Chen': 'run it back', You: 'omw', 'Sam Rivera': 'chips', 'Jordan Lee': 'rebuy', 'Riley Park': 'dealer',
    })
    // Shared poker words and phrases only: filler ("sorry", "bet", "lol"), names ("jordan") and one person's words ("cards") stay off.
    expect(wrap.words.topWords).toEqual([
      { word: 'run it back', count: 50 },
      { word: 'poker', count: 120 },
      { word: 'rebuy', count: 90 },
      { word: 'chips', count: 81 },
      { word: 'omw', count: 65 },
      { word: 'classic', count: 31 },
      { word: 'dealer', count: 11 },
    ])
    expect(wrap.words.topEmoji[0]).toEqual({ emoji: '🃏', count: 60 })
  })

  it('reports the one message it could not decode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-chat-'))
    try {
      const db = MessagesDb.open(openNodeSqlite, makeFakeDb(dir).path)
      try {
        const { undecodable } = normalizeRows(db.messageRows({ from: new Date('2026-01-01'), to: new Date('2027-01-01') }))
        expect(undecodable).toBe(1)
      } finally {
        db.close()
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('builds a solo wrap with top chats', () => {
    const solo = makeFakeWrap('solo')
    expect(solo.volume.total).toBe(330)
    expect(solo.topChats).toEqual([{ name: 'Poker Night', messages: 320 }, { name: 'Alex Chen', messages: 10 }])
  })

  it('never contains a raw handle, in group or solo', () => {
    for (const mode of ['group', 'solo'] as const) {
      const json = JSON.stringify(makeFakeWrap(mode))
      for (const p of Object.values(FAKE_PEOPLE)) expect(json).not.toContain(p.handle)
    }
  })

  it('uses only your own words in a solo wrap', () => {
    const solo = makeFakeWrap('solo')
    const words = solo.words.topWords.map((w) => w.word)
    for (const theirs of ['rebuy', 'classic', 'dealer']) expect(words).not.toContain(theirs)
    expect(words).toEqual(['omw', 'cards and chips', 'run it back', 'message'])
    expect(solo.words.topEmoji.map((e) => e.emoji)).not.toContain('🃏')
  })
})
