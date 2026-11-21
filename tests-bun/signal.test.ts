import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'bun:test'

// The real program runs on Bun, where reading Messages is synchronous (bun:sqlite). A kill or Ctrl-C during the read
// must wait for it, then remove the copy of Messages and stop before the page opens (fixtures/signalDuringRead.ts).
for (const [signal, code] of [['SIGTERM', 143], ['SIGHUP', 129], ['SIGINT', 130]] as const) {
  test(`a ${signal} during the read removes the copy and stops before anything opens`, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-'))
    try {
      const source = path.join(tmp, 'chat.db')
      fs.writeFileSync(source, 'not really sqlite')
      const child = Bun.spawn([process.execPath, 'fixtures/signalDuringRead.ts', source, '5000'], {
        env: { ...process.env, TMPDIR: tmp },
        stdout: 'pipe',
      })
      const reader = child.stdout.getReader()
      const first = new TextDecoder().decode((await reader.read()).value)
      const dir = first.split('\n')[0]!.trim()
      expect(fs.existsSync(dir)).toBe(true)
      await Bun.sleep(300)
      child.kill(signal)
      let rest = ''
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest += new TextDecoder().decode(chunk.value)
      expect(await child.exited).toBe(code)
      expect(first + rest).not.toContain('opened')
      expect(fs.existsSync(dir)).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }, 15_000)
}
