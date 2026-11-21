import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeFakeDb, type FakeDb } from '../../fixtures/makeFakeDb'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { buildSelection } from '../../src/app/build'
import { createConvoMedia, loadConvoPhotos } from '../../src/app/convoMedia'
import { fullYear } from '../../src/app/period'
import { openSession, type Session } from '../../src/app/session'
import { loadWrap } from '../../src/app/store'
import { ContactBook } from '../../src/extract/contactBook'
import { openNodeSqlite } from '../../src/extract/sqliteNode'
import { fitToLimit, MAX_LINK_CHARS, unpackWrap } from '../../src/share/pack'
import { withoutContactInfo } from '../../src/share/quotes'
import { withSenderName } from '../../src/share/senderName'
import type { Wrap } from '../../src/types'

/**
 * The maker's local photos never reach a link. These are the group links the maker made from the fake chat at 97bf9f8,
 * the commit before photos existed (same pipeline as web/src/maker/wrap.ts). They must stay the same, byte for byte.
 * My year's links changed on purpose since: they carry the conversation around each quote, like a group's.
 */
const BEFORE_PHOTOS = {
  fakeGroup: { length: 2138, sha256: '111841f8ff602416d93dd062853eb389781c19e7f16be2c70136e97a09270199' },
  sessionGroup: { length: 2142, sha256: '31a4577ddd4318522b8cc566804eef3cb4173e30c82a63d753d9ded4ef6aa4a8' },
}

/**
 * Texting styles came later and add one optional field (`texting`). Without it, and on the fake chat as it was then
 * (`textingStyles: false`), the link must still be the same bytes: so texting styles changed nothing else either.
 * The same goes for the busiest day, month by month (and its counts), the streak with one person and last year, added after that.
 */
function beforeTextingStyles(wrap: Wrap): Wrap {
  const { texting: _, topPersonByMonth: _months, topPersonCountByMonth: _counts, personStreak: _streak, vsLastYear: _last, ...rest } = wrap
  const { busiestDay: _day, ...timing } = wrap.timing
  return { ...rest, timing }
}

/** The pinned length and hash are of the link less the newer stats; `packed` is the whole link, for the leak check. */
async function makerLink(wrap: Wrap): Promise<{ length: number; sha256: string; packed: string }> {
  const make = async (w: Wrap) => (await fitToLimit(withSenderName(withoutContactInfo(w), 'Taylor'))).packed
  const pinned = await make(beforeTextingStyles(wrap))
  return { length: pinned.length, sha256: createHash('sha256').update(pinned).digest('hex'), packed: await make(wrap) }
}

let dir: string
let fake: FakeDb
let session: Session
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-unchanged-'))
  fake = makeFakeDb(dir, { hitConversations: true })
  session = openSession({ openSqlite: openNodeSqlite, dbPath: fake.path, contacts: new ContactBook([]), period: fullYear(2026), now: new Date(2026, 2, 10) })
})
afterAll(() => {
  session.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('packed links are unchanged by local photos', () => {
  it('the fake group wrap packs to the same bytes as before', async () => {
    expect(await makerLink(makeFakeWrap('group', { textingStyles: false, moreHits: false }))).toMatchObject(BEFORE_PHOTOS.fakeGroup)
  })

  it('a wrap the app builds, photos found and listed, packs to the same bytes as before and holds none of them', async () => {
    const appDir = path.join(dir, 'app')
    const [id] = buildSelection(session, { kind: 'groups', chatIds: [fake.groupChatId] }, appDir).ids
    const photos = loadConvoPhotos(appDir, id!)
    expect(photos.length).toBeGreaterThan(0) // the photo really was found and kept, beside the wrap
    const home = path.join(dir, 'home')
    const root = path.join(home, 'Library', 'Messages', 'Attachments')
    fs.mkdirSync(path.join(root, 'fake'), { recursive: true })
    for (const p of photos) fs.writeFileSync(path.join(root, 'fake', p.guid), 'x')
    const media = createConvoMedia({ appDir, attachmentFile: (g) => session.attachmentFile(g), root, home })
    const items = media.list(id!)!
    expect(items.length).toBeGreaterThan(0)

    const link = await makerLink(loadWrap(appDir, id!))
    expect(link).toMatchObject(BEFORE_PHOTOS.sessionGroup)
    const inside = JSON.stringify(await unpackWrap(link.packed))
    for (const leak of [...photos.map((p) => p.guid), ...items.map((i) => i.id), 'Attachments', 'AT-FAKE', '~/', 'convo-photos']) {
      expect(inside).not.toContain(leak)
    }
    media.close()
  })

  it("My year's link carries each shown quote's conversation, fits the cap, and holds no photo", async () => {
    const appDir = path.join(dir, 'app-solo')
    const [id] = buildSelection(session, { kind: 'solo' }, appDir).ids
    const wrap = loadWrap(appDir, id!)
    const link = await makerLink(wrap)
    expect(link.length).toBeLessThanOrEqual(MAX_LINK_CHARS)
    const inLink = await unpackWrap(link.packed)
    expect(inLink).toEqual(wrap)
    const convo = inLink.greatestHits[0]!.conversation!
    expect(convo.title).toBe('Poker Night')
    expect(convo.messages[convo.hit]).toMatchObject({ senderId: 'me', text: wrap.greatestHits[0]!.text })
    const inside = JSON.stringify(inLink)
    for (const leak of ['Attachments', 'AT-FAKE', '~/', 'FAKE-']) expect(inside).not.toContain(leak)
  })
})
