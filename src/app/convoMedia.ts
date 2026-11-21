import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AttachmentFile } from '../extract/messagesDb'
import { writeOwner } from '../extract/copyDb'
import { attachmentKind } from '../extract/normalize'
import { linkHitIndices } from '../share/quotes'
import type { Wrap } from '../types'
import { loadWrap, SAFE_ID } from './store'

/**
 * The maker's preview on your own Mac shows the real photos in a conversation, where a shared link shows "📷 Photo".
 * Nothing here goes into a link: the page gets an opaque id per photo, and the file is only ever read here.
 */

/** Where Messages keeps attachments. Only files inside it are served. */
export const MESSAGES_ATTACHMENTS = path.join(os.homedir(), 'Library', 'Messages', 'Attachments')
/** Bigger files keep the placeholder. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024
const SIPS = '/usr/bin/sips'
const CONVERT_TIMEOUT_MS = 30_000
const MEDIA_ID = /^[0-9a-f]{32}$/

/**
 * A photo in a saved wrap's conversation: the hit's and the message's index in the saved wrap, the message it came
 * from, and when it was sent (checked against the wrap, so a wrap saved again without its photos never shows the wrong one).
 * Saved beside the wrap, never in it.
 */
export type ConvoPhoto = { hit: number; message: number; guid: string; sentAt: string }

/** What the maker gets: `hit` is the quote's index in the link (not the saved wrap), `message` its index in the conversation. */
export type MediaItem = { hit: number; message: number; id: string }

function photosFile(appDir: string, wrapId: string): string {
  if (!SAFE_ID.test(wrapId)) throw new Error(`"${wrapId}" isn't a valid wrap id.`)
  return path.join(appDir, 'convo-photos', `${wrapId}.json`)
}

/** Saved with the wrap; a wrap without photos removes any earlier file. Readable only by you. */
export function saveConvoPhotos(appDir: string, wrapId: string, photos: ConvoPhoto[]): void {
  const file = photosFile(appDir, wrapId)
  if (photos.length === 0) {
    fs.rmSync(file, { force: true })
    return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  fs.rmSync(tmp, { force: true })
  fs.writeFileSync(tmp, JSON.stringify(photos), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

/** [] for a wrap saved before photos were kept, or a file that can't be read. */
export function loadConvoPhotos(appDir: string, wrapId: string): ConvoPhoto[] {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(photosFile(appDir, wrapId), 'utf8'))
    if (!Array.isArray(value)) return []
    return value.filter(
      (p): p is ConvoPhoto =>
        typeof p === 'object' && p !== null &&
        Number.isInteger(p.hit) && Number.isInteger(p.message) && typeof p.guid === 'string' && typeof p.sentAt === 'string',
    )
  } catch {
    return []
  }
}

/**
 * The real path of an attachment, if it's a file of at most MAX_MEDIA_BYTES inside `root` once every symlink is
 * followed. Messages writes most names as "~/Library/Messages/Attachments/…", so "~/" is `home`. Anything else is null.
 */
export function attachmentPath(filename: string, root: string, home: string): string | null {
  const expanded = filename.startsWith('~/') ? path.join(home, filename.slice(2)) : filename
  if (!path.isAbsolute(expanded)) return null
  try {
    const real = fs.realpathSync(expanded)
    if (!real.startsWith(fs.realpathSync(root) + path.sep)) return null
    const stat = fs.statSync(real)
    return stat.isFile() && stat.size <= MAX_MEDIA_BYTES ? real : null
  } catch {
    return null
  }
}

/** The formats every browser shows, from the file's first bytes (never its name). null: convert it to JPEG first. */
export function directType(head: Uint8Array): string | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b)
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  return null
}

/** Runs sips with these arguments (never through a shell) and returns what it printed. */
function sips(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(SIPS, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (out += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), CONVERT_TIMEOUT_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`sips exited with ${code}`))
    })
  })
}

/** A converted photo's longer side is shrunk to this many pixels; a smaller photo keeps its size. */
const MAX_SIDE = 1200

/** The larger of an image's width and height, from `sips -g pixelWidth -g pixelHeight` output; null if it says neither. */
export function longestSide(sipsOutput: string): number | null {
  const sides = [...sipsOutput.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map((m) => Number(m[1]))
  return sides.length > 0 ? Math.max(...sides) : null
}

/** HEIC and the rest to a JPEG, shrunk to at most 1200px on a side (never enlarged), with macOS's own sips. */
export async function sipsToJpeg(input: string, output: string): Promise<void> {
  const side = longestSide(await sips(['-g', 'pixelWidth', '-g', 'pixelHeight', input]))
  const shrink = side !== null && side > MAX_SIDE ? ['--resampleHeightWidthMax', String(MAX_SIDE)] : []
  await sips(['-s', 'format', 'jpeg', ...shrink, input, '--out', output])
}

export type ConvoMediaOptions = {
  appDir: string
  /** a message's first attachment (Session.attachmentFile) */
  attachmentFile(guid: string): AttachmentFile | null
  /** only files inside it are served; tests use a temp folder */
  root?: string
  /** what "~/" in an attachment's name stands for; tests use a temp folder */
  home?: string
  /** writes `input` as a JPEG at `output`; tests pass a fake */
  convert?: (input: string, output: string) => Promise<void>
}

export type ConvoMedia = {
  /** The photos in the conversations the link's Greatest hits slide shows. null when there's no saved wrap with this id. */
  list(wrapId: string): MediaItem[] | null
  /** The photo for an id that `list` handed out this run, as JPEG, PNG or GIF. */
  serve(id: string): Promise<Response>
  /** Deletes the converted copies. Safe to call more than once. */
  close(): void
}

/**
 * One per run. Ids are random and live only in memory: a path or attachment id never reaches the page, and an id
 * from an earlier run (or one `list` never handed out) gets a 404.
 */
export function createConvoMedia({
  appDir, attachmentFile, root = MESSAGES_ATTACHMENTS, home = os.homedir(), convert = sipsToJpeg,
}: ConvoMediaOptions): ConvoMedia {
  const pathById = new Map<string, string>()
  const idByKey = new Map<string, string>()
  const converting = new Map<string, Promise<string>>()
  let cacheDir: string | null = null

  const idFor = (wrapId: string, file: string) => {
    const key = `${wrapId}\0${file}`
    let id = idByKey.get(key)
    if (!id) {
      id = randomBytes(16).toString('hex')
      idByKey.set(key, id)
      pathById.set(id, file)
    }
    return id
  }

  /** A JPEG copy in this run's temp folder, made once per id. */
  const converted = (id: string, file: string) => {
    let job = converting.get(id)
    if (!job) {
      if (!cacheDir) {
        cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imessage-wrapped-media-'))
        writeOwner(cacheDir) // so a later run's sweep leaves it alone while this one runs
      }
      const output = path.join(cacheDir, `${id}.jpg`)
      job = convert(file, output).then(() => {
        if (!fs.statSync(output).isFile()) throw new Error('No JPEG was written.')
        return output
      })
      job.catch(() => converting.delete(id)) // a failed conversion may be tried again
      converting.set(id, job)
    }
    return job
  }

  return {
    list(wrapId) {
      let wrap: Wrap
      try {
        wrap = loadWrap(appDir, wrapId)
      } catch {
        return null
      }
      const shown = linkHitIndices(wrap)
      const items: MediaItem[] = []
      for (const photo of loadConvoPhotos(appDir, wrapId)) {
        const hit = shown.indexOf(photo.hit)
        const message = wrap.greatestHits[photo.hit]?.conversation?.messages[photo.message]
        // "📷 Photo", or a text message sent with a photo (the photo shows above the text); never a video or other file.
        const canShow = message?.media === 'photo' || (message !== undefined && message.media === undefined && message.text !== '')
        if (hit < 0 || !canShow || message.sentAt !== photo.sentAt) continue
        const attachment = attachmentFile(photo.guid)
        if (!attachment || attachmentKind(attachment.type) !== 'photo') continue
        const file = attachmentPath(attachment.filename, root, home)
        if (file) items.push({ hit, message: photo.message, id: idFor(wrapId, file) })
      }
      return items
    },

    async serve(id) {
      const known = MEDIA_ID.test(id) ? pathById.get(id) : undefined
      // Checked again: the file may have moved, grown or become a symlink since it was listed.
      const file = known && attachmentPath(known, root, home)
      if (!file) return new Response(null, { status: 404 })
      try {
        const head = new Uint8Array(12)
        const fd = fs.openSync(file, 'r')
        try {
          fs.readSync(fd, head, 0, head.length, 0)
        } finally {
          fs.closeSync(fd)
        }
        const type = directType(head)
        const body = type ? fs.readFileSync(file) : fs.readFileSync(await converted(id, file))
        return new Response(body, {
          headers: { 'content-type': type ?? 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
        })
      } catch {
        return new Response(null, { status: 415 })
      }
    },

    close() {
      if (cacheDir) fs.rmSync(cacheDir, { recursive: true, force: true })
      cacheDir = null
      converting.clear()
    },
  }
}
