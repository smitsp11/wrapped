import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeFakeDb, type FakeDb } from '../../fixtures/makeFakeDb'
import { WrappedError } from '../../src/errors'
import { buildSelection } from '../../src/app/build'
import { fullYear } from '../../src/app/period'
import { openSession, type Session } from '../../src/app/session'
import { listWraps } from '../../src/app/store'
import { ContactBook } from '../../src/extract/contactBook'
import { openNodeSqlite } from '../../src/extract/sqliteNode'

let dir: string
let fake: FakeDb
let session: Session
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'))
  fake = makeFakeDb(dir)
  session = openSession({ openSqlite: openNodeSqlite, dbPath: fake.path, contacts: new ContactBook([]), period: fullYear(2026), now: new Date(2026, 2, 10) })
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
    const late = openSession({ openSqlite: openNodeSqlite, dbPath: fake.path, contacts: new ContactBook([]), period: fullYear(2026), now: new Date(2026, 9, 27) })
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
    const empty = openSession({ openSqlite: openNodeSqlite, dbPath: fake.path, contacts: new ContactBook([]), period: fullYear(2020), now: new Date(2020, 11, 31) })
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
    const other = openSession({ openSqlite: openNodeSqlite, dbPath: fake.path, contacts: new ContactBook([]), period: fullYear(2026), now: new Date(2026, 2, 10) })
    other.close()
    expect(() => other.close()).not.toThrow()
  })
})
