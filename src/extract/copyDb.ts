import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Inside each of this program's temp folders (the database copies here, convoMedia's photo folder): the process id of
 * the run that made it. A later run's sweep (src/app/tempSweep.ts) leaves a folder alone while that process is alive.
 */
export const OWNER_FILE = '.imessage-wrapped-owner'

/** Marks `dir` as this run's: see OWNER_FILE. */
export function writeOwner(dir: string): void {
  fs.writeFileSync(path.join(dir, OWNER_FILE), String(process.pid), { mode: 0o600 })
}

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
/** Copies made this run and not removed yet. */
const live = new Set<string>()
let hooked = false

/**
 * Once per run: on exit, remove every copy still here; on a signal, exit (which runs that). It's set up before the
 * first copy is made, so a signal that arrives while a copy is being read waits for the read and then cleans up,
 * instead of killing the program with the copy left behind.
 */
function removeCopiesOnExit(): void {
  if (hooked) return
  hooked = true
  process.on('exit', () => {
    for (const dir of live) fs.rmSync(dir, { recursive: true, force: true })
    live.clear()
  })
  for (const signal of SIGNALS) process.on(signal, () => process.exit(128 + os.constants.signals[signal]))
}

/** Deletes a copy made by copyDatabase. Safe to call more than once. */
export function removeCopy(dir: string): void {
  live.delete(dir)
  fs.rmSync(dir, { recursive: true, force: true })
}

/**
 * Copies a SQLite file and its -wal/-shm companions into a new temp folder,
 * so we never read (or lock) the live file. On APFS the copy is an instant clone.
 * Small race: Messages could checkpoint between cloning chat.db and its -wal. It is rare, and running again fixes it.
 * The copy is removed by removeCopy, or when the program exits or is stopped, however that happens; a crash that
 * skips even that leaves it for the next run's sweep (see OWNER_FILE).
 */
export function copyDatabase(sourcePath: string): { path: string; dir: string } {
  removeCopiesOnExit()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapped-'))
  live.add(dir)
  const target = path.join(dir, path.basename(sourcePath))
  try {
    writeOwner(dir)
    fs.copyFileSync(sourcePath, target, fs.constants.COPYFILE_FICLONE)
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(sourcePath + suffix)) {
        fs.copyFileSync(sourcePath + suffix, target + suffix, fs.constants.COPYFILE_FICLONE)
      }
    }
  } catch (err) {
    removeCopy(dir)
    throw err
  }
  return { path: target, dir }
}
