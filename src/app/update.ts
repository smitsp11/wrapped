import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'

/** The running version and a newer one the website offers. */
export type Update = { current: string; latest: string }

const CHECK_TIMEOUT_MS = 1500

/** "1.2.3" or "1.2.3-beta.4": the three numbers, and the prerelease parts after the dash (empty for a release). */
function parse(version: string): { core: number[]; pre: string[] } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim())
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] }
}

/** One prerelease part against another: numbers by value, numbers before words, words alphabetically. */
function comparePart(a: string, b: string): number {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Number(a) - Number(b)
  if (aNum !== bNum) return aNum ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Semver order: negative when a is older than b, positive when newer, 0 when the same or either can't be read.
 * A prerelease comes before its release: 0.2.0-beta.3 < 0.2.0-beta.4 < 0.2.0.
 */
export function compareVersions(a: string, b: string): number {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const order = comparePart(x.pre[i]!, y.pre[i]!)
    if (order !== 0) return order
  }
  return x.pre.length - y.pre.length
}

/**
 * Asks the website for the newest version (/version.json, answered by site/api/c.ts, which also adds one to the
 * day's anonymous launch tally). Never throws and gives up after 1.5 s: offline, a slow network or an odd answer
 * all just mean no notice. WRAPPED_NO_UPDATE_CHECK=1 skips it; WRAPPED_NO_COUNT=1 asks the site not to count it.
 */
export async function checkForUpdate(site: string, current: string, env = process.env, get: typeof fetch = fetch): Promise<Update | null> {
  if (env.WRAPPED_NO_UPDATE_CHECK === '1') return null
  try {
    const url = `${site}/version.json${env.WRAPPED_NO_COUNT === '1' ? '?nocount=1' : ''}`
    const res = await get(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    if (!res.ok) return null
    const body = (await res.json()) as { version?: unknown }
    if (typeof body.version !== 'string') return null
    return compareVersions(body.version, current) > 0 ? { current, latest: body.version } : null
  } catch {
    return null
  }
}

/**
 * `wrapped update`: runs the install line again (curl -fsSL <site> | sh). The installer replaces the program
 * and keeps its one PATH line. WRAPPED_NO_RUN=1 stops it from starting the new program afterwards.
 * Resolves with the exit code: curl's if the download failed, otherwise the installer's.
 *
 * One shell does both steps, with the installer saved to a temp file in between: the compiled program runs on Bun,
 * which can't hand one child's output stream to another as its stdin.
 */
const UPDATE_SCRIPT =
  'tmp=$(mktemp) || exit 1; curl -fsSL "$1" -o "$tmp"; code=$?; [ $code -eq 0 ] && { sh "$tmp"; code=$?; }; rm -f "$tmp"; exit $code'

export async function runUpdate(site: string, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const child = spawn('/bin/sh', ['-c', UPDATE_SCRIPT, 'sh', site], { stdio: 'inherit', env: { ...env, WRAPPED_NO_RUN: '1' } })
  return new Promise<number>((resolve) => {
    child.on('error', () => resolve(1))
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

/** The version of the program the installer put in ~/.imessage-wrapped/bin, or null if it can't say. */
export function installedVersion(appDir: string): string | null {
  try {
    const out = execFileSync(path.join(appDir, 'bin', 'wrapped'), ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
    return /^\d[0-9A-Za-z.+-]*$/.test(out.trim()) ? out.trim() : null
  } catch {
    return null
  }
}
