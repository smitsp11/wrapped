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

/** A temp HOME and TMPDIR, so a run never sees this Mac's own data, and no network. */
function sandbox(): { env: Record<string, string>; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binary-'))
  fs.mkdirSync(path.join(dir, 'home'))
  fs.mkdirSync(path.join(dir, 'tmp'))
  return { dir, env: { HOME: path.join(dir, 'home'), TMPDIR: path.join(dir, 'tmp'), PATH: process.env.PATH!, WRAPPED_NO_UPDATE_CHECK: '1', WRAPPED_NO_COUNT: '1' } }
}

test('--help and -h print the usage, -v the version', async () => {
  const { version } = await Bun.file('package.json').json()
  for (const flag of ['--help', '-h']) {
    const run = Bun.spawnSync(['./release/wrapped', flag], { stdin: 'ignore' })
    expect(run.exitCode).toBe(0)
    expect(run.stdout.toString()).toContain('wrapped update')
  }
  const v = Bun.spawnSync(['./release/wrapped', '-v'], { stdin: 'ignore' })
  expect(v.stdout.toString()).toBe(`${version}\n`)
})

test('an unknown flag gets one plain line, not a stack trace', () => {
  const run = Bun.spawnSync(['./release/wrapped', '--nope'], { stdin: 'ignore' })
  expect(run.exitCode).toBe(1)
  const out = run.stdout.toString() + run.stderr.toString()
  expect(out).toContain("wrapped doesn't understand --nope. Try  wrapped --help.")
  expect(out).not.toMatch(/TypeError|ERR_PARSE_ARGS|at /)
})

test('an empty or damaged --db says so plainly, with no stray spinner line', () => {
  const { env, dir } = sandbox()
  try {
    // Consent given already, so the run goes straight to reading.
    fs.mkdirSync(path.join(env.HOME!, '.imessage-wrapped'))
    fs.writeFileSync(path.join(env.HOME!, '.imessage-wrapped', 'consent'), '1')
    const empty = path.join(dir, 'chat.db')
    fs.writeFileSync(empty, '')
    for (const args of [['--check'], ['--year', '2025']]) {
      const run = Bun.spawnSync(['./release/wrapped', '--db', empty, ...args], { stdin: 'ignore', env })
      const out = run.stdout.toString() + run.stderr.toString()
      expect(run.exitCode, args.join(' ')).toBe(1)
      expect(out).toContain("That file isn't a Messages database Wrapped can read.")
      expect(out).not.toContain('Unexpected error')
      expect(out).not.toContain('no such table')
      expect(out).not.toContain('Canceled')
    }
    expect(fs.readdirSync(env.TMPDIR!)).toEqual([]) // and no copy left behind
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the first run with no keyboard says to run it in Terminal instead of stopping silently', () => {
  const { env, dir } = sandbox()
  try {
    const run = Bun.spawnSync(['./release/wrapped', '--db', '.parity/chat.db', '--year', '2026'], { stdin: 'ignore', env })
    expect(run.exitCode).toBe(1)
    expect(run.stdout.toString()).toContain('Run  wrapped  in Terminal to continue.')
    expect(fs.existsSync(path.join(env.HOME!, '.imessage-wrapped', 'consent'))).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
