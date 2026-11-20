import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'bun:test'

test('the compiled program reads the fake chat (counts only)', () => {
  const run = Bun.spawnSync(['./release/wrapped', '--db', '.parity/chat.db', '--check', '--year', '2026', '--now', '2026-03-10'])
  expect(run.exitCode).toBe(0)
  const out = JSON.parse(run.stdout.toString())
  expect(out.groups).toBe(1)
  expect(out.history).toBe('ok')
  expect(out.web).toBe(true)
})

test('--version prints the package version and exits 0', async () => {
  const { version } = await Bun.file('package.json').json()
  const run = Bun.spawnSync(['./release/wrapped', '--version'], { stdin: 'ignore' })
  expect(run.exitCode).toBe(0)
  expect(run.stdout.toString()).toBe(`${version}\n`)
})

test('--resume-check with no marker, or one from another terminal app, exits 0 at once and prints nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-check-'))
  try {
    const run = () => Bun.spawnSync(['./release/wrapped', '--resume-check'], { stdin: 'ignore', env: { HOME: home, TERM_PROGRAM: 'Apple_Terminal' } })
    const none = run()
    expect(none.exitCode).toBe(0)
    expect(none.stdout.toString()).toBe('')
    const marker = path.join(home, '.imessage-wrapped', 'resume')
    fs.mkdirSync(path.dirname(marker))
    fs.writeFileSync(marker, `iTerm.app\n${Date.now()}\n`)
    const other = run()
    expect(other.exitCode).toBe(0)
    expect(other.stdout.toString()).toBe('')
    expect(fs.existsSync(marker)).toBe(true) // left for iTerm's windows
    // Same app but not a terminal (stdin isn't one here): still left alone.
    fs.writeFileSync(marker, `Apple_Terminal\n${Date.now()}\n`)
    expect(run().stdout.toString()).toBe('')
    expect(fs.existsSync(marker)).toBe(true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
