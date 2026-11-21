import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { OWNER_FILE } from '../extract/copyDb'

/** A temp folder younger than this is never swept: a run may have just made it. */
export const STALE_AFTER_MS = 10 * 60_000

/**
 * This program's own temp folders, by name (mkdtemp adds six characters), and the files each may hold. Anything else,
 * or a folder holding anything else, is never touched.
 */
const KINDS = [
  // copyDatabase: chat.db or a Contacts database, with its -wal and -shm
  { name: /^wrapped-[A-Za-z0-9]{6}$/, file: /^[^/]+\.(db|abcddb)(-wal|-shm)?$/ },
  // convoMedia: photos converted to JPEG, named by their 32-character id
  { name: /^imessage-wrapped-media-[A-Za-z0-9]{6}$/, file: /^[0-9a-f]{32}\.jpg$/ },
]

/** True while `pid` is running (or runs as someone else, which we can't signal). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export type SweepOptions = { tmp?: string; now?: number; isAlive?: (pid: number) => boolean }

/**
 * On start: deletes copies an earlier run left behind when it crashed or was killed before it could clean up. Only
 * this program's own folders in the temp folder, owned by this user, at least STALE_AFTER_MS old, holding only the
 * files it writes, and not in use: a folder whose owner file names a live process is kept. A folder without an owner
 * file (from a version before it existed) counts as left behind. Returns the folders it deleted. Never throws.
 */
export function sweepStaleTemp({ tmp = os.tmpdir(), now = Date.now(), isAlive = pidAlive }: SweepOptions = {}): string[] {
  const removed: string[] = []
  let names: string[]
  try {
    names = fs.readdirSync(tmp)
  } catch {
    return removed
  }
  for (const name of names) {
    const kind = KINDS.find((k) => k.name.test(name))
    if (!kind) continue
    const dir = path.join(tmp, name)
    try {
      const stat = fs.lstatSync(dir)
      if (!stat.isDirectory() || stat.uid !== process.getuid?.() || now - stat.mtimeMs < STALE_AFTER_MS) continue
      const entries = fs.readdirSync(dir)
      const ours = entries.every((entry) => {
        if (entry !== OWNER_FILE && !kind.file.test(entry)) return false
        return fs.lstatSync(path.join(dir, entry)).isFile()
      })
      if (!ours) continue
      if (entries.includes(OWNER_FILE)) {
        const pid = Number(fs.readFileSync(path.join(dir, OWNER_FILE), 'utf8').trim())
        if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) continue
      }
      fs.rmSync(dir, { recursive: true, force: true })
      removed.push(dir)
    } catch {
      // gone already, or not ours to read: leave it
    }
  }
  return removed
}
