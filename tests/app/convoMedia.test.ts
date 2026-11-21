import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from '../../fixtures/makeFakeDb'
import { makePng } from '../../fixtures/makePng'
import { buildSelection } from '../../src/app/build'
import {
  attachmentPath, createConvoMedia, directType, loadConvoPhotos, longestSide, MAX_MEDIA_BYTES, saveConvoPhotos, sipsToJpeg,
  type ConvoMedia, type ConvoMediaOptions,
} from '../../src/app/convoMedia'
import { fullYear } from '../../src/app/period'
import { handle, type ServerDeps } from '../../src/app/server'
import { openSession, type Session } from '../../src/app/session'
import { loadWrap, saveWrap } from '../../src/app/store'
import { ContactBook } from '../../src/extract/contactBook'
import { openNodeSqlite } from '../../src/extract/sqliteNode'
import { SHOWN_HITS } from '../../src/stats/greatestHits'

/** Everything is fake: a generated chat.db, and tiny generated PNGs in a temp "Attachments" folder. */
let dir: string
let home: string
let root: string
let appDir: string
let fake: FakeDb
let session: Session
let wrapId: string
/** the fake photo's message guid and file */
let photo: { guid: string; file: string }
const PNG = makePng(4, 3, [230, 120, 40])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const media: ConvoMedia[] = []

function newMedia(options: Partial<ConvoMediaOptions> = {}): ConvoMedia {
  const m = createConvoMedia({ appDir, attachmentFile: (guid) => session.attachmentFile(guid), root, home, ...options })
  media.push(m)
  return m
}

/** The fake chat.db names files "~/Library/Messages/Attachments/fake/<guid>". */
const expand = (filename: string) => path.join(home, filename.slice(2))

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convo-media-test-'))
  home = path.join(dir, 'home')
  root = path.join(home, 'Library', 'Messages', 'Attachments')
  appDir = path.join(dir, 'app')
  fake = makeFakeDb(dir, { hitConversations: true })
  const db = new Database(fake.path, { readonly: true })
  const rows = db
    .prepare(`SELECT m.guid AS guid, a.filename AS filename, a.mime_type AS mime FROM attachment a
      JOIN message_attachment_join j ON j.attachment_id = a.ROWID JOIN message m ON m.ROWID = j.message_id`)
    .all() as { guid: string; filename: string; mime: string }[]
  db.close()
  for (const row of rows) {
    fs.mkdirSync(path.dirname(expand(row.filename)), { recursive: true })
    fs.writeFileSync(expand(row.filename), row.mime.startsWith('image/') ? PNG : Buffer.from('not a photo'))
  }
  const photoRow = rows.find((r) => r.mime.startsWith('image/'))!
  photo = { guid: photoRow.guid, file: expand(photoRow.filename) }
  session = openSession({ openSqlite: openNodeSqlite, dbPath: fake.path, contacts: new ContactBook([]), period: fullYear(2026), now: new Date(2026, 2, 10) })
  wrapId = buildSelection(session, { kind: 'groups', chatIds: [fake.groupChatId] }, appDir).ids[0]!
})
afterEach(() => {
  for (const m of media.splice(0)) m.close()
  fs.writeFileSync(photo.file, PNG)
})
afterAll(() => {
  session.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('photos in a conversation, at build time', () => {
  it('keeps, beside the saved wrap, which shown messages are photos, and nothing about them in the wrap', () => {
    const photos = loadConvoPhotos(appDir, wrapId)
    expect(photos).toEqual([{ hit: 0, message: expect.any(Number), guid: photo.guid, sentAt: expect.any(String) }])
    const wrap = loadWrap(appDir, wrapId)
    const convo = wrap.greatestHits[0]!.conversation!
    expect(convo.messages[photos[0]!.message]).toMatchObject({ media: 'photo', text: '', sentAt: photos[0]!.sentAt })
    const saved = fs.readFileSync(path.join(appDir, 'wraps', `${wrapId}.json`), 'utf8')
    expect(saved).not.toContain(photo.guid)
    expect(saved).not.toContain('Attachments')
    expect(fs.statSync(path.join(appDir, 'convo-photos', `${wrapId}.json`)).mode & 0o777).toBe(0o600)
  })
  it('a solo wrap, or a group rebuilt without photos, has no photo file', () => {
    saveConvoPhotos(appDir, 'other-2026', [{ hit: 0, message: 1, guid: 'x', sentAt: 'y' }])
    saveConvoPhotos(appDir, 'other-2026', [])
    expect(fs.existsSync(path.join(appDir, 'convo-photos', 'other-2026.json'))).toBe(false)
    expect(loadConvoPhotos(appDir, 'other-2026')).toEqual([])
  })
})

describe('a text sent with a photo', () => {
  it('is noted too, so the preview can show the photo above the text', () => {
    const own = path.join(dir, 'text-and-photo')
    fs.mkdirSync(own)
    const f = makeFakeDb(own, { hitConversations: true })
    const db = new Database(f.path)
    db.prepare('UPDATE message SET text = ? WHERE guid = ?').run('\uFFFClook at this', photo.guid)
    db.close()
    const s = openSession({ openSqlite: openNodeSqlite, dbPath: f.path, contacts: new ContactBook([]), period: fullYear(2026), now: new Date(2026, 2, 10) })
    try {
      const { wrap, photos } = s.buildGroup(f.groupChatId)
      expect(photos).toEqual([expect.objectContaining({ hit: 0, guid: photo.guid })])
      expect(wrap.greatestHits[0]!.conversation!.messages[photos![0]!.message]).toEqual(expect.objectContaining({ text: 'look at this' }))
      expect(wrap.greatestHits[0]!.conversation!.messages[photos![0]!.message]!.media).toBeUndefined()
    } finally {
      s.close()
    }
  })
})

describe('GET /api/convo-media and /api/media/<id>', () => {
  const ORIGIN = 'http://127.0.0.1:4321'
  const api = (pathname: string, token = 'tok') => new Request(ORIGIN + pathname, { headers: { 'x-wrapped-token': token } })
  const depsWith = (m: ConvoMedia): ServerDeps => ({
    token: 'tok', port: 4321, site: 'https://wrapped.smitpatel.xyz', session, appDir, webDir: dir,
    openMessages: vi.fn(), presence: { pageOpened: vi.fn(), pageClosed: vi.fn(), stop: vi.fn() }, onClose: vi.fn(), update: () => null, media: m, count: vi.fn(),
  })
  const list = async (m: ConvoMedia, id = wrapId) => (await (await handle(api(`/api/convo-media?wrap=${id}`), depsWith(m))).json()).items

  it('lists each photo by an opaque id, never a path, guid or attachment id', async () => {
    const m = newMedia()
    const res = await handle(api(`/api/convo-media?wrap=${wrapId}`), depsWith(m))
    expect(res.status).toBe(200)
    const text = await res.text()
    const { items } = JSON.parse(text)
    expect(items).toEqual([{ hit: 0, message: loadConvoPhotos(appDir, wrapId)[0]!.message, id: expect.stringMatching(/^[0-9a-f]{32}$/) }])
    for (const leak of [photo.guid, 'Attachments', '/', 'AT-', home]) expect(text).not.toContain(leak)
  })
  it('streams a listed PNG as it is, with no CORS headers', async () => {
    const m = newMedia()
    const [item] = await list(m)
    const res = await handle(api(`/api/media/${item.id}`), depsWith(m))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect([...res.headers.keys()].filter((h) => h.startsWith('access-control'))).toEqual([])
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true)
  })
  it('needs the token, like every other /api route', async () => {
    const m = newMedia()
    const [item] = await list(m)
    expect((await handle(api(`/api/convo-media?wrap=${wrapId}`, 'wrong'), depsWith(m))).status).toBe(403)
    expect((await handle(api(`/api/media/${item.id}`, 'wrong'), depsWith(m))).status).toBe(403)
    expect((await handle(new Request(`${ORIGIN}/api/media/${item.id}`), depsWith(m))).status).toBe(403)
  })
  it('404s ids it never handed out, ids from another run, and anything shaped like a path', async () => {
    const m = newMedia()
    const [item] = await list(m)
    const other = newMedia() // another run: same file, but it never listed it
    expect((await handle(api(`/api/media/${item.id}`), depsWith(other))).status).toBe(404)
    for (const id of ['0'.repeat(32), item.id.toUpperCase(), `${item.id}0`, '..%2F..%2Fchat.db', '../../../etc/passwd', `%2e%2e/${item.id}`, '']) {
      expect((await handle(api(`/api/media/${id}`), depsWith(m))).status, id).toBe(404)
    }
  })
  it('404s an unknown or invalid wrap id; a wrap saved before this feature lists nothing', async () => {
    const m = newMedia()
    expect((await handle(api('/api/convo-media?wrap=nope-2026'), depsWith(m))).status).toBe(404)
    expect((await handle(api('/api/convo-media?wrap=../wraps/x'), depsWith(m))).status).toBe(404)
    expect((await handle(api('/api/convo-media'), depsWith(m))).status).toBe(404)
    saveWrap(appDir, 'older-2026', loadWrap(appDir, wrapId)) // no photo file beside it
    expect(await list(m, 'older-2026')).toEqual([])
  })
  it("lists the photos in My year's conversations too", async () => {
    const m = newMedia()
    const own = path.join(dir, 'app-solo')
    const [soloId] = buildSelection(session, { kind: 'solo' }, own).ids
    const solo = loadWrap(own, soloId!)
    expect(solo.greatestHits[0]!.conversation).toBeDefined() // My year carries its conversations too
    // The fake My year quote's conversation has no photo, so give it the group's photo message at the same place.
    const group = loadWrap(appDir, wrapId)
    saveWrap(appDir, 'me-photos', { ...solo, greatestHits: [group.greatestHits[0]!] })
    saveConvoPhotos(appDir, 'me-photos', loadConvoPhotos(appDir, wrapId))
    const items = await list(m, 'me-photos')
    expect(items).toEqual([{ hit: 0, message: loadConvoPhotos(appDir, wrapId)[0]!.message, id: expect.any(String) }])
  })
  it("only lists messages in the link's shown conversations that show a photo or a text, never a video or other file", async () => {
    const m = newMedia()
    const [real] = loadConvoPhotos(appDir, wrapId)
    const wrap = loadWrap(appDir, wrapId)
    const textMessage = wrap.greatestHits[0]!.conversation!.messages.findIndex((c) => !c.media)
    const unshown = { ...wrap, greatestHits: [...Array(SHOWN_HITS)].map(() => wrap.greatestHits[1]!).concat(wrap.greatestHits[0]!) }
    saveWrap(appDir, 'tampered-2026', unshown)
    saveConvoPhotos(appDir, 'tampered-2026', [{ ...real!, hit: SHOWN_HITS }]) // a quote the slide doesn't show
    expect(await list(m, 'tampered-2026')).toEqual([])
    saveWrap(appDir, 'tampered-2026', wrap)
    saveConvoPhotos(appDir, 'tampered-2026', [
      { ...real!, message: textMessage }, // another message, sent at another time
      { ...real!, sentAt: '2026-01-01T00:00:00.000Z' }, // saved again since: no longer the same message
      { ...real!, message: 999 },
    ])
    expect(await list(m, 'tampered-2026')).toEqual([])
    // The same message as a text sent with the photo: listed (the photo shows above the text). As a video: never.
    const as = (change: object) => {
      const convo = wrap.greatestHits[0]!.conversation!
      const messages = convo.messages.map((c, i) => (i === real!.message ? { senderId: c.senderId, sentAt: c.sentAt, text: '', ...change } : c))
      return { ...wrap, greatestHits: [{ ...wrap.greatestHits[0]!, conversation: { ...convo, messages } }, ...wrap.greatestHits.slice(1)] }
    }
    saveConvoPhotos(appDir, 'tampered-2026', [real!])
    saveWrap(appDir, 'tampered-2026', as({ text: 'look at this' }))
    expect(await list(m, 'tampered-2026')).toEqual([{ hit: 0, message: real!.message, id: expect.any(String) }])
    saveWrap(appDir, 'tampered-2026', as({ media: 'video' }))
    expect(await list(m, 'tampered-2026')).toEqual([])
    saveWrap(appDir, 'tampered-2026', as({ media: 'attachment' }))
    expect(await list(m, 'tampered-2026')).toEqual([])
  })
  it("counts the link's quotes, not the saved wrap's, when a quote that looks like a phone number is left out", async () => {
    const m = newMedia()
    const wrap = loadWrap(appDir, wrapId)
    const withPhone = { ...wrap, greatestHits: [{ ...wrap.greatestHits[1]!, text: 'call 416 555 0199' }, ...wrap.greatestHits] }
    saveWrap(appDir, 'phone-2026', withPhone)
    saveConvoPhotos(appDir, 'phone-2026', loadConvoPhotos(appDir, wrapId).map((p) => ({ ...p, hit: p.hit + 1 })))
    expect(await list(m, 'phone-2026')).toEqual([expect.objectContaining({ hit: 0 })])
  })
})

describe('only files inside the Attachments folder', () => {
  const outside = () => {
    const file = path.join(dir, 'outside.png')
    fs.writeFileSync(file, PNG)
    return file
  }
  const withFilename = (filename: string) => newMedia({ attachmentFile: () => ({ filename, type: 'image/png' }) })

  it('expands "~/" and accepts a file inside', () => {
    const real = fs.realpathSync(photo.file)
    expect(attachmentPath(`~/${path.relative(home, photo.file)}`, root, home)).toBe(real)
    expect(attachmentPath(photo.file, root, home)).toBe(real)
  })
  it('refuses path traversal, relative names and the folder itself', () => {
    outside()
    expect(attachmentPath('~/Library/Messages/Attachments/../../../outside.png', root, home)).toBeNull()
    expect(attachmentPath(`${root}/fake/../../../../../outside.png`, root, home)).toBeNull()
    expect(attachmentPath('outside.png', root, home)).toBeNull()
    expect(attachmentPath('~/../outside.png', root, home)).toBeNull()
    expect(attachmentPath(root, root, home)).toBeNull()
    expect(attachmentPath(`${root}-evil/x.png`, root, home)).toBeNull()
  })
  it('follows symlinks: one pointing outside is refused, one pointing inside is fine', () => {
    const link = path.join(root, 'fake', 'escape.png')
    fs.symlinkSync(outside(), link)
    expect(attachmentPath(link, root, home)).toBeNull()
    const inside = path.join(root, 'fake', 'inside.png')
    fs.symlinkSync(photo.file, inside)
    expect(attachmentPath(inside, root, home)).toBe(fs.realpathSync(photo.file))
  })
  it('refuses a symlinked folder that leads outside', () => {
    const away = path.join(dir, 'away')
    fs.mkdirSync(away, { recursive: true })
    fs.writeFileSync(path.join(away, 'p.png'), PNG)
    fs.symlinkSync(away, path.join(root, 'linked-dir'))
    expect(attachmentPath(path.join(root, 'linked-dir', 'p.png'), root, home)).toBeNull()
  })
  it('skips files over 25 MB and missing files', () => {
    const big = path.join(root, 'fake', 'big.png')
    fs.writeFileSync(big, PNG)
    fs.truncateSync(big, MAX_MEDIA_BYTES + 1) // sparse: no real 25 MB written
    expect(attachmentPath(big, root, home)).toBeNull()
    expect(attachmentPath(path.join(root, 'fake', 'missing.png'), root, home)).toBeNull()
  })
  it('never lists a message whose attachment points outside', async () => {
    expect(withFilename('~/Library/Messages/Attachments/../../../outside.png').list(wrapId)).toEqual([])
    expect(withFilename(outside()).list(wrapId)).toEqual([])
    expect(newMedia({ attachmentFile: () => null }).list(wrapId)).toEqual([])
    // the database says it's a video: it keeps its placeholder
    expect(newMedia({ attachmentFile: () => ({ filename: photo.file, type: 'video/quicktime' }) }).list(wrapId)).toEqual([])
  })
  it('checks again when serving: a listed file that became a symlink out is a 404', async () => {
    const m = newMedia()
    const [item] = m.list(wrapId)!
    fs.rmSync(photo.file)
    fs.symlinkSync(outside(), photo.file)
    try {
      expect((await m.serve(item!.id)).status).toBe(404)
    } finally {
      fs.rmSync(photo.file)
    }
  })
})

describe('formats', () => {
  it('serves JPEG, PNG and GIF as they are, from their first bytes', () => {
    expect(directType(JPEG)).toBe('image/jpeg')
    expect(directType(PNG)).toBe('image/png')
    expect(directType(Buffer.from('GIF89a......'))).toBe('image/gif')
    expect(directType(Buffer.from('\0\0\0\x18ftypheic'))).toBeNull()
  })
  it('converts anything else (HEIC) to JPEG once, in a temp folder that close() deletes', async () => {
    const convert = vi.fn(async (_input: string, output: string) => fs.writeFileSync(output, JPEG))
    const m = newMedia({ convert })
    fs.writeFileSync(photo.file, Buffer.from('\0\0\0\x18ftypheic fake heic'))
    const [item] = m.list(wrapId)!
    const first = await m.serve(item!.id)
    expect(first.headers.get('content-type')).toBe('image/jpeg')
    expect(Buffer.from(await first.arrayBuffer()).equals(JPEG)).toBe(true)
    expect(Buffer.from(await (await m.serve(item!.id)).arrayBuffer()).equals(JPEG)).toBe(true)
    expect(convert).toHaveBeenCalledTimes(1)
    const [input, output] = convert.mock.calls[0]!
    expect(input).toBe(fs.realpathSync(photo.file))
    expect(fs.existsSync(output)).toBe(true)
    m.close()
    expect(fs.existsSync(path.dirname(output))).toBe(false)
  })
  it('falls back (415) when the conversion fails, and may try again', async () => {
    const convert = vi.fn(async () => {
      throw new Error('sips failed')
    })
    const m = newMedia({ convert })
    fs.writeFileSync(photo.file, Buffer.from('not an image at all'))
    const [item] = m.list(wrapId)!
    expect((await m.serve(item!.id)).status).toBe(415)
    expect((await m.serve(item!.id)).status).toBe(415)
    expect(convert).toHaveBeenCalledTimes(2)
  })

  const hasSips = process.platform === 'darwin' && fs.existsSync('/usr/bin/sips')
  it.skipIf(!hasSips)('turns a real HEIC into a JPEG with sips, with no shell (a name full of shell characters is just a name)', async () => {
    const png = path.join(dir, 'source.png')
    fs.writeFileSync(png, makePng(64, 48, [40, 120, 230]))
    const heic = path.join(root, 'fake', `it's a "photo"; $(touch pwned) & rm -rf x.heic`)
    execFileSync('/usr/bin/sips', ['-s', 'format', 'heic', png, '--out', heic], { stdio: 'ignore' })
    expect(directType(fs.readFileSync(heic).subarray(0, 12))).toBeNull()
    const m = newMedia({ attachmentFile: () => ({ filename: heic, type: 'image/heic' }) })
    const [item] = m.list(wrapId)!
    const res = await m.serve(item!.id)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(directType(new Uint8Array(await res.arrayBuffer()))).toBe('image/jpeg')
    expect(fs.existsSync(path.join(process.cwd(), 'pwned'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'fake', 'pwned'))).toBe(false)
  })
  it.skipIf(!hasSips)('shrinks a big photo to 1200px on its longer side, and never enlarges a small one', async () => {
    const size = (file: string) => longestSide(execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' }))
    for (const [w, h, expected] of [[64, 48, 64], [1600, 1000, 1200]] as const) {
      const png = path.join(dir, `in-${w}.png`)
      fs.writeFileSync(png, makePng(w, h, [10, 20, 30]))
      const heic = path.join(dir, `in-${w}.heic`)
      execFileSync('/usr/bin/sips', ['-s', 'format', 'heic', png, '--out', heic], { stdio: 'ignore' })
      const jpg = path.join(dir, `out-${w}.jpg`)
      await sipsToJpeg(heic, jpg)
      expect(directType(fs.readFileSync(jpg).subarray(0, 12))).toBe('image/jpeg')
      expect(size(jpg)).toBe(expected)
    }
  })
  it('reads the longer side from sips output', () => {
    expect(longestSide('/x/a.heic\n  pixelWidth: 4032\n  pixelHeight: 3024\n')).toBe(4032)
    expect(longestSide('/x/a.heic\n  pixelWidth: 900\n  pixelHeight: 1600\n')).toBe(1600)
    expect(longestSide('nothing here')).toBeNull()
  })
  it.skipIf(!hasSips)('rejects when sips cannot read the file', async () => {
    const junk = path.join(dir, 'junk.heic')
    fs.writeFileSync(junk, 'junk')
    await expect(sipsToJpeg(junk, path.join(dir, 'junk.jpg'))).rejects.toThrow()
  })
})
