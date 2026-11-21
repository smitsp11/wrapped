/**
 * A child process for tests/extract/copyDb.test.ts: copies a (fake) database the way the app does, prints the copy's
 * folder, then works synchronously for a while, like reading Messages, then lets signals in (as main.ts does after
 * the read) and prints "opened", standing for the page opening. Run with TMPDIR set to a test folder.
 */
import fs from 'node:fs'
import { letSignalsIn } from '../src/app/cleanup'
import { copyDatabase } from '../src/extract/copyDb'

const copy = copyDatabase(process.argv[2]!)
// Written at once: console.log to a pipe waits for the event loop, which the "read" below holds up.
fs.writeSync(1, `${copy.dir}\n`)
const until = Date.now() + Number(process.argv[3] ?? 1500)
while (Date.now() < until) {
  // synchronous, like bun:sqlite reading every message
}
await letSignalsIn()
fs.writeSync(1, 'opened\n')
