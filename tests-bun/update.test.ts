import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'bun:test'
import { runUpdate } from '../src/app/update'

// `wrapped update` runs on Bun in the real program, where handing one child's output to another as stdin isn't
// supported. This runs it under Bun against a local stand-in for the site.
test('wrapped update downloads the installer and runs it under Bun, and fails when the download does', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-'))
  const marker = path.join(dir, 'ran')
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === '/'
        ? new Response(`echo "$WRAPPED_NO_RUN" > '${marker}'\n`)
        : new Response('missing', { status: 404 }),
  })
  try {
    const site = `http://127.0.0.1:${server.port}`
    expect(await runUpdate(site, { PATH: process.env.PATH })).toBe(0)
    expect(fs.readFileSync(marker, 'utf8')).toBe('1\n') // the installer ran, told not to start the new program
    expect(await runUpdate(`${site}/missing`, { PATH: process.env.PATH })).not.toBe(0)
  } finally {
    server.stop(true)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
