import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { OWNER_FILE, copyDatabase, removeCopy } from '../../src/extract/copyDb'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copydb-test-'))
const source = path.join(tmp, 'chat.db')
fs.writeFileSync(source, 'not really sqlite')
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** Runs fixtures/signalDuringRead.ts, sends `signal` once it has made its copy, and says how it ended. */
function signalDuringRead(signal: NodeJS.Signals): Promise<{ code: number | null; out: string; dir: string }> {
  const childTmp = fs.mkdtempSync(path.join(tmp, 'child-'))
  const child = spawn(process.execPath, ['--import', 'tsx', 'fixtures/signalDuringRead.ts', source, '5000'], {
    env: { ...process.env, TMPDIR: childTmp },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  let out = ''
  return new Promise((resolve) => {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const first = !out
      out += chunk
      if (first) setTimeout(() => child.kill(signal), 300) // during the synchronous "read"
    })
    child.on('close', (code) => resolve({ code, out, dir: out.split('\n')[0]!.trim() }))
  })
}

describe('copyDatabase', () => {
  it('copies into its own temp folder, marked with this process, and removeCopy deletes it', () => {
    const copy = copyDatabase(source)
    expect(path.basename(copy.dir)).toMatch(/^wrapped-[A-Za-z0-9]{6}$/)
    expect(fs.readFileSync(copy.path, 'utf8')).toBe('not really sqlite')
    expect(fs.readFileSync(path.join(copy.dir, OWNER_FILE), 'utf8')).toBe(String(process.pid))
    removeCopy(copy.dir)
    expect(fs.existsSync(copy.dir)).toBe(false)
    removeCopy(copy.dir) // twice is fine
  })

  it.each([['SIGTERM', 143], ['SIGHUP', 129], ['SIGINT', 130]] as const)(
    'a %s during the read waits for it, then removes the copy and stops before anything opens',
    async (signal, exitCode) => {
      const { code, out, dir } = await signalDuringRead(signal)
      expect(dir).toContain('wrapped-')
      expect(code).toBe(exitCode)
      expect(out).not.toContain('opened')
      expect(fs.existsSync(dir)).toBe(false)
    },
    20_000,
  )
})
