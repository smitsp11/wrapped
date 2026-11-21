import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { WrappedError } from '../errors'
import { presence } from './presence'
import { handle, type ServerDeps } from './server'

/** The built web pages: embedded at `dist/` inside the compiled program (bun --asset web/dist), or web/dist when run from source. */
export function findWebDir(): string {
  const candidates = [path.join(import.meta.dir, 'dist'), path.resolve(import.meta.dir, '..', '..', 'web', 'dist')]
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'maker.html')))
  if (!found) {
    const fromSource = process.execPath.endsWith('/bun')
    throw new WrappedError(
      'This copy of iMessage Wrapped is missing its pages. Reinstall it with:  curl -fsSL https://wrapped.smitpatel.xyz | sh' +
        (fromSource ? '\n(from source: run  npm run web:build  first)' : ''),
    )
  }
  return found
}

type Options = Omit<ServerDeps, 'token' | 'port' | 'webDir' | 'presence' | 'onClose'>

/** Why the app stopped: the last page closed a minute ago, the page's Close link, or q / Ctrl-C in the terminal. */
export type StopReason = 'idle' | 'closed' | 'quit'

export type Running = { url: string; stopped: Promise<StopReason>; stop(reason: StopReason): void }

/** Serves on 127.0.0.1 only, on a free port. `stopped` resolves once the server has shut down. */
export function startServer(options: Options): Running {
  const token = crypto.randomUUID().replaceAll('-', '')
  const webDir = findWebDir()
  let stop = (_reason: StopReason) => undefined as void
  const stopped = new Promise<StopReason>((resolve) => {
    let stopping = false
    stop = (reason) => {
      if (stopping) return
      stopping = true
      pages.stop()
      // true: also end the open page requests, so every page shows that the app is closed.
      void server.stop(true).then(() => resolve(reason))
    }
  })
  const pages = presence(() => stop('idle'))
  let port = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    development: false,
    error: () => new Response(null, { status: 500 }),
    fetch: (req) =>
      // The Close link's request gets its answer before the server goes away.
      handle(req, { ...options, token, port, webDir, presence: pages, onClose: () => setTimeout(() => stop('closed'), 100) }),
  })
  port = server.port ?? 0
  return { url: `http://127.0.0.1:${port}/?t=${token}`, stopped, stop }
}

/** Opens the page in the default browser; if that fails, prints the link to open by hand. */
export function openBrowser(url: string): void {
  execFile('open', [url], (err) => {
    if (err) console.log(`Open this link in your browser:\n${url}`)
  })
}
