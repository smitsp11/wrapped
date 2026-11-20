import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { WrappedError } from '../errors'
import { handle, type ServerDeps } from './server'

/** The built web pages: embedded at `dist/` inside the compiled program (bun --asset web/dist), or web/dist when run from source. */
export function findWebDir(): string {
  const candidates = [path.join(import.meta.dir, 'dist'), path.resolve(import.meta.dir, '..', '..', 'web', 'dist')]
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'maker.html')))
  if (!found) {
    const fromSource = process.execPath.endsWith('/bun')
    throw new WrappedError(
      'This copy of iMessage Wrapped is missing its pages. Reinstall it with:  curl -fsSL wrapped.smitpatel.xyz | sh' +
        (fromSource ? '\n(from source: run  npm run web:build  first)' : ''),
    )
  }
  return found
}

type Options = Omit<ServerDeps, 'token' | 'port' | 'webDir' | 'onDone'>

/** Serves on 127.0.0.1 only, opens the browser, and resolves when the page says it's done. */
export async function serveUntilDone(options: Options, route: string): Promise<void> {
  const token = crypto.randomUUID().replaceAll('-', '')
  const webDir = findWebDir()
  let finish = () => undefined as void
  const done = new Promise<void>((resolve) => (finish = resolve))
  let port = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    development: false,
    error: () => new Response(null, { status: 500 }),
    fetch: (req) => handle(req, { ...options, token, port, webDir, onDone: finish }),
  })
  port = server.port ?? 0
  const url = `http://127.0.0.1:${port}/?t=${token}${route}`
  execFile('open', [url], (err) => {
    if (err) console.log(`Open this link in your browser:\n${url}`)
  })
  try {
    await done
  } finally {
    await server.stop()
  }
}
