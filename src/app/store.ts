import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WrappedError } from '../errors'
import { parseWrap } from '../share/parseWrap'
import type { Wrap } from '../types'

/** Everything the app keeps: the program, saved wraps and the consent marker. */
export const APP_DIR = path.join(os.homedir(), '.imessage-wrapped')
const CONSENT_VERSION = '1'
const SAFE_ID = /^[a-z0-9-]+$/

export type SavedWrap = { id: string; title: string; mode: Wrap['mode']; savedAt: Date }

function wrapsDir(appDir: string): string {
  return path.join(appDir, 'wraps')
}

function fileFor(appDir: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new WrappedError(`"${id}" isn't a valid wrap id.`)
  return path.join(wrapsDir(appDir), `${id}.json`)
}

/** Saved wraps hold names and quotes, so only you can read them. */
export function saveWrap(appDir: string, id: string, wrap: Wrap): void {
  const file = fileFor(appDir, id)
  fs.mkdirSync(wrapsDir(appDir), { recursive: true, mode: 0o700 })
  fs.chmodSync(wrapsDir(appDir), 0o700) // tighten a folder that already existed
  const tmp = `${file}.tmp`
  fs.rmSync(tmp, { force: true }) // a leftover temp file would keep its old mode
  fs.writeFileSync(tmp, JSON.stringify(wrap), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

export function loadWrap(appDir: string, id: string): Wrap {
  return parseWrap(JSON.parse(fs.readFileSync(fileFor(appDir, id), 'utf8')))
}

/** Newest first. Unreadable files are skipped. */
export function listWraps(appDir: string): SavedWrap[] {
  const dir = wrapsDir(appDir)
  if (!fs.existsSync(dir)) return []
  const saved: SavedWrap[] = []
  for (const name of fs.readdirSync(dir)) {
    const id = name.replace(/\.json$/, '')
    if (!name.endsWith('.json') || !SAFE_ID.test(id)) continue
    try {
      const wrap = loadWrap(appDir, id)
      saved.push({ id, title: wrap.title, mode: wrap.mode, savedAt: fs.statSync(fileFor(appDir, id)).mtime })
    } catch {
      continue
    }
  }
  return saved.sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime())
}

export function hasConsented(appDir: string): boolean {
  try {
    return fs.readFileSync(path.join(appDir, 'consent'), 'utf8').trim() === CONSENT_VERSION
  } catch {
    return false
  }
}

export function saveConsent(appDir: string): void {
  fs.mkdirSync(appDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(appDir, 'consent'), CONSENT_VERSION)
}
