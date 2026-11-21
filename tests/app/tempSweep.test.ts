import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STALE_AFTER_MS, pidAlive, sweepStaleTemp } from '../../src/app/tempSweep'
import { OWNER_FILE } from '../../src/extract/copyDb'

/** A process id that isn't running. */
const DEAD_PID = 2 ** 22 - 7

let tmp: string
let realTmp: string | undefined
beforeEach(() => {
  realTmp = process.env.TMPDIR
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'))
  process.env.TMPDIR = tmp // os.tmpdir() reads it on every call
})
afterEach(() => {
  if (realTmp === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = realTmp
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** A folder in the test's temp folder with these files, last changed `ageMs` ago. */
function folder(name: string, files: Record<string, string>, ageMs = STALE_AFTER_MS + 60_000): string {
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir)
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text)
  const when = new Date(Date.now() - ageMs)
  fs.utimesSync(dir, when, when)
  return dir
}

describe('sweepStaleTemp', () => {
  it('uses the temp folder TMPDIR names', () => {
    expect(os.tmpdir()).toBe(tmp)
    const left = folder('wrapped-aB3dE9', { 'chat.db': 'x', [OWNER_FILE]: String(DEAD_PID) })
    expect(sweepStaleTemp()).toEqual([left])
    expect(fs.existsSync(left)).toBe(false)
  })

  it("deletes copies a dead run left behind, and photo folders, but keeps a live run's and young ones", () => {
    const dead = folder('wrapped-aaaaaa', { 'chat.db': 'x', 'chat.db-wal': 'x', 'chat.db-shm': 'x', [OWNER_FILE]: String(DEAD_PID) })
    const contacts = folder('wrapped-bbbbbb', { 'AddressBook-v22.abcddb': 'x' }) // an older version: no owner file
    const photos = folder('imessage-wrapped-media-cccccc', { [`${'ab'.repeat(16)}.jpg`]: 'x', [OWNER_FILE]: String(DEAD_PID) })
    const live = folder('wrapped-dddddd', { 'chat.db': 'x', [OWNER_FILE]: String(process.pid) })
    const young = folder('wrapped-eeeeee', { 'chat.db': 'x', [OWNER_FILE]: String(DEAD_PID) }, 60_000)
    expect(sweepStaleTemp({ tmp }).sort()).toEqual([dead, contacts, photos].sort())
    for (const kept of [live, young]) expect(fs.existsSync(kept)).toBe(true)
  })

  it('never touches anything else', () => {
    const others = [
      folder('wrapped-notes-for-me', { 'chat.db': 'x' }), // not a name it makes
      folder('wrapped-ffffff', { 'chat.db': 'x', 'todo.txt': 'mine' }), // holds a file it never writes
      folder('imessage-wrapped-media-gggggg', { 'photo.png': 'x' }),
      folder('something-else', { 'chat.db': 'x' }),
      folder('wrapped-hhhhhh', {}),
    ]
    fs.mkdirSync(path.join(others[4]!, 'nested'))
    const when = new Date(Date.now() - STALE_AFTER_MS * 2)
    fs.utimesSync(others[4]!, when, when)
    // A link with the right name, pointing at a folder of ours elsewhere.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'elsewhere-'))
    fs.writeFileSync(path.join(elsewhere, 'chat.db'), 'x')
    fs.symlinkSync(elsewhere, path.join(tmp, 'wrapped-iiiiii'))
    const loose = path.join(tmp, 'wrapped-jjjjjj')
    fs.writeFileSync(loose, 'a file, not a folder')
    expect(sweepStaleTemp({ tmp, now: Date.now() + STALE_AFTER_MS * 10 })).toEqual([])
    for (const kept of [...others, elsewhere, loose]) expect(fs.existsSync(kept)).toBe(true)
  })

  it('keeps a folder whose owner is alive, whatever its age', () => {
    const dir = folder('wrapped-kkkkkk', { 'chat.db': 'x', [OWNER_FILE]: '4242' })
    expect(sweepStaleTemp({ tmp, isAlive: (pid) => pid === 4242 })).toEqual([])
    expect(sweepStaleTemp({ tmp, isAlive: () => false })).toEqual([dir])
  })

  it('tells a running process from one that has ended', () => {
    expect(pidAlive(process.pid)).toBe(true)
    expect(pidAlive(DEAD_PID)).toBe(false)
  })

  it('says nothing when the temp folder is missing', () => {
    expect(sweepStaleTemp({ tmp: path.join(tmp, 'gone') })).toEqual([])
  })
})
