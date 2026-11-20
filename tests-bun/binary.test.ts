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
