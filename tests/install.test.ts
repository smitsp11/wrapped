import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { STARTUP_LINE, canAutoResume, installerAddedToPath, startupFiles } from '../src/app/shellStartup'
import { installedVersion, runUpdate } from '../src/app/update'

const SCRIPT = path.resolve('site/install.sh')
let dir: string
let server: http.Server
/** Stands in for https://github.com/smitsp11/wrapped/releases/download/v<version> (WRAPPED_DOWNLOAD). */
let download: string
let corrupt = false
let missingTarball = false
let badSum = false

const files: Record<string, Buffer> = {}

/** Puts a fake program on the server: it prints "fake wrapped <version>", or just the version for --version. */
function publish(version: string) {
  for (const arch of ['arm64', 'x64']) {
    const name = `wrapped-darwin-${arch}`
    const build = path.join(dir, 'build')
    fs.mkdirSync(build, { recursive: true })
    const program = `#!/bin/sh\nif [ "\${1:-}" = --version ]; then echo ${version}; else echo fake wrapped ${version}; fi\n`
    fs.writeFileSync(path.join(build, name), program, { mode: 0o755 })
    execFileSync('tar', ['-czf', path.join(dir, `${name}.tar.gz`), '-C', build, name])
    const tarball = fs.readFileSync(path.join(dir, `${name}.tar.gz`))
    files[`/files/${name}.tar.gz`] = tarball
    files[`/files/${name}.tar.gz.sha256`] =Buffer.from(`${createHash('sha256').update(tarball).digest('hex')}  ${name}.tar.gz\n`)
  }
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-test-'))
  publish('1.0.0')
  server = http.createServer((req, res) => {
    // Like GitHub: the release download URL redirects to where the file really lives.
    // Like the website: "/" answers curl with the installer (wrapped update runs curl -fsSL <site> | sh).
    if (req.url === '/') return void res.writeHead(200).end(fs.readFileSync(SCRIPT))
    if (req.url?.startsWith('/download/')) {
      return void res.writeHead(302, { location: req.url.replace('/download/', '/files/') }).end()
    }
    let body = files[req.url ?? '']
    if (!body) return void res.writeHead(404).end()
    if (missingTarball && req.url?.endsWith('.tar.gz')) return void res.writeHead(404).end()
    if (badSum && req.url?.endsWith('.sha256')) body = Buffer.from('abc  file\n')
    if (corrupt && req.url?.endsWith('.tar.gz')) body = Buffer.concat([body, Buffer.from('x')])
    res.writeHead(200).end(body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  download = `http://127.0.0.1:${(server.address() as { port: number }).port}/download`
})
afterEach(() => {
  publish('1.0.0')
  corrupt = false
  missingTarball = false
  badSum = false
})
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  fs.rmSync(dir, { recursive: true, force: true })
})

// HOME and ZDOTDIR are always temp dirs so the script can never touch the real shell settings.
// Async spawn (not spawnSync): the HTTP server lives in this process and must keep serving.
function run(home: string, extra: { shell?: string; env?: Record<string, string>; unset?: string[]; stdin?: Buffer; args?: string[] } = {}) {
  return new Promise<{ status: number | null; stderr: string; stdout: string }>((resolve) => {
    const env: Record<string, string | undefined> = {
      ...process.env, HOME: home, ZDOTDIR: home, SHELL: extra.shell ?? '/bin/zsh', WRAPPED_DOWNLOAD: download, WRAPPED_NO_RUN: '1', ...extra.env,
    }
    for (const name of extra.unset ?? []) delete env[name]
    const child = spawn('sh', extra.args ?? [SCRIPT], { env })
    let stderr = ''
    let stdout = ''
    child.stderr.on('data', (d) => (stderr += d))
    child.stdout.on('data', (d) => (stdout += d))
    child.on('close', (status) => resolve({ status, stderr, stdout }))
    child.stdin.end(extra.stdin)
  })
}
const install = (home: string, extra = {}) => run(home, extra)
const newHome = () => fs.mkdtempSync(path.join(dir, 'home-'))
const binOf = (home: string) => path.join(home, '.imessage-wrapped', 'bin', 'wrapped')
const MARK = 'added by iMessage Wrapped'
/** What installers before auto-resume added. */
const OLD_LINE = 'export PATH="$HOME/.imessage-wrapped/bin:$PATH" # added by iMessage Wrapped'

describe('install.sh', () => {
  it('installs wrapped and adds it to PATH exactly once', async () => {
    const home = fs.mkdtempSync(path.join(dir, 'home-'))
    expect((await install(home)).status).toBe(0)
    expect((await install(home)).status).toBe(0)
    const bin = path.join(home, '.imessage-wrapped', 'bin', 'wrapped')
    expect(execFileSync(bin, { encoding: 'utf8' })).toBe('fake wrapped 1.0.0\n')
    const rc = fs.readFileSync(path.join(home, '.zshrc'), 'utf8')
    expect(rc.match(/added by iMessage Wrapped/g)).toHaveLength(1)
    expect(rc).toBe(`\n${STARTUP_LINE}\n`) // the same line the app looks for
    expect(installerAddedToPath(startupFiles(home, home))).toBe(true) // the welcome then says so
    expect(canAutoResume(startupFiles(home, home))).toBe(true)
  })
  it('updates by running the install line again: the new program replaces the old, still one PATH line', async () => {
    const home = newHome()
    expect((await install(home)).status).toBe(0)
    publish('1.1.0')
    const again = await install(home)
    expect(again.status).toBe(0)
    expect(execFileSync(binOf(home), { encoding: 'utf8' })).toBe('fake wrapped 1.1.0\n')
    expect(fs.readFileSync(path.join(home, '.zshrc'), 'utf8').match(/added by iMessage Wrapped/g)).toHaveLength(1)
    expect(fs.readdirSync(path.join(home, '.imessage-wrapped')).filter((f) => f.startsWith('.tmp.'))).toEqual([])
    expect(again.stdout).toBe('Downloading iMessage Wrapped…\nInstalled.\n')
  })
  it('says only "Installed." when the line was added: no PATH hint', async () => {
    const home = newHome()
    const r = await install(home)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('Downloading iMessage Wrapped…\nInstalled.\n')
    expect(r.stderr).toBe('')
  })
  it('installs nothing when the checksum does not match', async () => {
    corrupt = true
    try {
      const home = fs.mkdtempSync(path.join(dir, 'home-'))
      const run = await install(home)
      expect(run.status).not.toBe(0)
      expect(run.stderr).toContain("didn't match")
      expect(fs.existsSync(path.join(home, '.imessage-wrapped', 'bin', 'wrapped'))).toBe(false)
    } finally {
      corrupt = false
    }
  })
  it('installs nothing when the download is missing', async () => {
    missingTarball = true
    try {
      const home = fs.mkdtempSync(path.join(dir, 'home-'))
      const run = await install(home)
      expect(run.status).not.toBe(0)
      expect(run.stderr).toContain('Download failed')
      expect(fs.existsSync(path.join(home, '.imessage-wrapped', 'bin', 'wrapped'))).toBe(false)
    } finally {
      missingTarball = false
    }
  })
  it('keeps the PATH line on its own line when .zshrc has no trailing newline', async () => {
    const home = fs.mkdtempSync(path.join(dir, 'home-'))
    fs.writeFileSync(path.join(home, '.zshrc'), 'alias ll="ls -l"')
    expect((await install(home)).status).toBe(0)
    const lines = fs.readFileSync(path.join(home, '.zshrc'), 'utf8').split('\n')
    expect(lines[0]).toBe('alias ll="ls -l"')
    expect(lines.filter((l) => l.includes('added by iMessage Wrapped'))).toHaveLength(1)
    expect(lines.find((l) => l.includes('added by iMessage Wrapped'))).toMatch(/^export PATH=/)
  })
  it('runs nothing when the script is cut off part-way', async () => {
    const home = newHome()
    const full = fs.readFileSync(SCRIPT)
    const run1 = await run(home, { args: [], stdin: full.subarray(0, Math.floor(full.length * 0.6)) })
    expect(run1.stderr).not.toBe('')
    expect(fs.existsSync(path.join(home, '.imessage-wrapped'))).toBe(false)
    expect(fs.readdirSync(home)).toEqual([])
  })
  it('uses the first existing bash startup file', async () => {
    const home = newHome()
    fs.writeFileSync(path.join(home, '.profile'), '# mine\n')
    expect((await install(home, { shell: '/bin/bash' })).status).toBe(0)
    expect((await install(home, { shell: '/bin/bash' })).stdout).toBe('Downloading iMessage Wrapped…\nInstalled.\n')
    expect(fs.readFileSync(path.join(home, '.profile'), 'utf8')).toContain(MARK)
    expect(fs.existsSync(path.join(home, '.bash_profile'))).toBe(false)
    expect(installerAddedToPath(startupFiles(home, home))).toBe(true)
  })
  it('creates .bash_profile for bash when none exist', async () => {
    const home = newHome()
    expect((await install(home, { shell: '/bin/bash' })).status).toBe(0)
    expect(fs.readFileSync(path.join(home, '.bash_profile'), 'utf8')).toContain(MARK)
  })
  it('writes to $ZDOTDIR/.zshrc when ZDOTDIR is set', async () => {
    const home = newHome()
    const zdot = fs.mkdtempSync(path.join(dir, 'zdot-'))
    expect((await install(home, { env: { ZDOTDIR: zdot } })).status).toBe(0)
    expect(fs.readFileSync(path.join(zdot, '.zshrc'), 'utf8')).toContain(MARK)
    expect(fs.existsSync(path.join(home, '.zshrc'))).toBe(false)
    expect(installerAddedToPath(startupFiles(home, zdot))).toBe(true)
  })
  it('edits no startup file for other shells and says what to add', async () => {
    const home = newHome()
    const r = await install(home, { shell: '/opt/homebrew/bin/fish' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Add this to your shell's PATH:")
    expect(r.stdout).toContain(`Next time run:  ${binOf(home)}`)
    expect(r.stdout).not.toContain('type:  wrapped')
    expect(fs.readdirSync(home)).toEqual(['.imessage-wrapped'])
    expect(installerAddedToPath(startupFiles(home, home))).toBe(false) // so the welcome doesn't claim it
  })
  it('still installs when the startup file is read-only', async () => {
    const home = newHome()
    const rc = path.join(home, '.zshrc')
    fs.writeFileSync(rc, '# mine\n', { mode: 0o444 })
    const r = await install(home)
    expect(r.status).toBe(0)
    expect(r.stderr).toBe(`Could not update ${rc}.\n`)
    expect(r.stdout).toContain(`Installed. Next time run:  ${binOf(home)}`)
    expect(fs.existsSync(binOf(home))).toBe(true)
  })
  it('swaps an older install\'s PATH-only line for the current one, in place, keeping one marked line', async () => {
    const home = newHome()
    const rc = path.join(home, '.zshrc')
    fs.writeFileSync(rc, `# before\n${OLD_LINE}\n# after\n`, { mode: 0o640 })
    const r = await install(home)
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('Downloading iMessage Wrapped…\nInstalled.\n')
    expect(fs.readFileSync(rc, 'utf8')).toBe(`# before\n${STARTUP_LINE}\n# after\n`)
    expect(fs.statSync(rc).mode & 0o777).toBe(0o640)
    expect((await install(home)).status).toBe(0) // and again: nothing changes
    expect(fs.readFileSync(rc, 'utf8')).toBe(`# before\n${STARTUP_LINE}\n# after\n`)
  })
  it('leaves exactly one marked line when there were several', async () => {
    const home = newHome()
    const rc = path.join(home, '.zshrc')
    fs.writeFileSync(rc, `${OLD_LINE}\nalias ll="ls -l"\n${STARTUP_LINE}\n`)
    expect((await install(home)).status).toBe(0)
    expect(fs.readFileSync(rc, 'utf8')).toBe(`${STARTUP_LINE}\nalias ll="ls -l"\n`)
  })
  it('updates the line through a symlinked startup file, keeping the symlink', async () => {
    const home = newHome()
    const real = path.join(home, 'dotfiles-zshrc')
    fs.writeFileSync(real, `${OLD_LINE}\n`)
    fs.symlinkSync(real, path.join(home, '.zshrc'))
    expect((await install(home)).status).toBe(0)
    expect(fs.lstatSync(path.join(home, '.zshrc')).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(real, 'utf8')).toBe(`${STARTUP_LINE}\n`)
  })
  it('migrates a bash startup file too', async () => {
    const home = newHome()
    fs.writeFileSync(path.join(home, '.bash_profile'), `${OLD_LINE}\n`)
    expect((await install(home, { shell: '/bin/bash' })).status).toBe(0)
    expect(fs.readFileSync(path.join(home, '.bash_profile'), 'utf8')).toBe(`${STARTUP_LINE}\n`)
  })
  it('leaves a read-only startup file with the old line as it was, and says how to run it', async () => {
    const home = newHome()
    const rc = path.join(home, '.zshrc')
    fs.writeFileSync(rc, `${OLD_LINE}\n`, { mode: 0o444 })
    const r = await install(home)
    expect(r.status).toBe(0)
    expect(r.stderr).toBe(`Could not update ${rc}.\n`)
    expect(r.stdout).toContain('Next time run:')
    expect(fs.readFileSync(rc, 'utf8')).toBe(`${OLD_LINE}\n`)
  })
  it('leaves no temp directory behind', async () => {
    const home = newHome()
    expect((await install(home)).status).toBe(0)
    expect(fs.readdirSync(path.join(home, '.imessage-wrapped')).filter((f) => f.startsWith('.tmp.'))).toEqual([])
  })
  it('rejects a checksum file that is not 64 hex characters', async () => {
    badSum = true
    const home = newHome()
    const r = await install(home)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain("didn't match")
    expect(fs.existsSync(binOf(home))).toBe(false)
  })
  it('fails cleanly when the program path is a directory', async () => {
    const home = newHome()
    fs.mkdirSync(binOf(home), { recursive: true })
    const r = await install(home)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain("Couldn't install into ~/.imessage-wrapped")
    expect(fs.statSync(binOf(home)).isDirectory()).toBe(true)
  })
})

describe('the pinned installer (what release.sh deploys)', () => {
  /** Runs scripts/pin-installer.sh, the same step release.sh uses to make deploy/install.sh. */
  function pin(version: string): string {
    const file = path.join(dir, `install-${version}.sh`)
    fs.writeFileSync(file, execFileSync('sh', ['scripts/pin-installer.sh', version]))
    return file
  }

  it('downloads exactly that GitHub release, over https only', async () => {
    // A fake curl records what it was asked for and fails, so nothing leaves this machine.
    const fakeBin = fs.mkdtempSync(path.join(dir, 'fakebin-'))
    const log = path.join(fakeBin, 'curl.log')
    fs.writeFileSync(path.join(fakeBin, 'curl'), `#!/bin/sh\necho "$@" >> "${log}"\nexit 22\n`, { mode: 0o755 })
    const home = newHome()
    const r = await install(home, { args: [pin('1.2.3')], unset: ['WRAPPED_DOWNLOAD'], env: { PATH: `${fakeBin}:${process.env.PATH}` } })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('Download failed')
    const asked = fs.readFileSync(log, 'utf8')
    expect(asked).toMatch(
      /^--proto =https --tlsv1\.2 -fsSL https:\/\/github\.com\/smitsp11\/wrapped\/releases\/download\/v1\.2\.3\/wrapped-darwin-(arm64|x64)\.tar\.gz -o /,
    )
    expect(fs.existsSync(binOf(home))).toBe(false)
  })
  it('changes only the RELEASE line', () => {
    const before = fs.readFileSync(SCRIPT, 'utf8').split('\n')
    const after = fs.readFileSync(pin('0.2.0-beta.1'), 'utf8').split('\n')
    expect(after).toHaveLength(before.length)
    const changed = after.filter((line, i) => line !== before[i])
    expect(changed).toEqual(['  RELEASE="0.2.0-beta.1"'])
  })
  it('refuses a version that is not a plain version string', () => {
    expect(() => execFileSync('sh', ['scripts/pin-installer.sh', '1.0/evil'], { stdio: 'pipe' })).toThrow()
  })
  it('the copy in the repo (no release filled in) refuses to install', async () => {
    const home = newHome()
    const r = await install(home, { unset: ['WRAPPED_DOWNLOAD'] })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain("isn't tied to a release")
    expect(fs.readdirSync(home)).toEqual([])
  })
})

describe('wrapped update', () => {
  const site = () => download.replace(/\/download$/, '')
  const envFor = (home: string) => ({ ...process.env, HOME: home, ZDOTDIR: home, SHELL: '/bin/zsh', WRAPPED_DOWNLOAD: download })

  it('reruns the install line: the new program replaces the old, still one PATH line, nothing started', async () => {
    const home = newHome()
    expect(await runUpdate(site(), envFor(home))).toBe(0)
    expect(installedVersion(path.join(home, '.imessage-wrapped'))).toBe('1.0.0')
    publish('1.1.0')
    expect(await runUpdate(site(), envFor(home))).toBe(0)
    expect(installedVersion(path.join(home, '.imessage-wrapped'))).toBe('1.1.0')
    expect(fs.readFileSync(path.join(home, '.zshrc'), 'utf8').match(/added by iMessage Wrapped/g)).toHaveLength(1)
  })
  it('fails, changing nothing, when the site cannot be reached', async () => {
    const home = newHome()
    expect(await runUpdate(`${site()}/missing`, envFor(home))).not.toBe(0)
    expect(fs.existsSync(binOf(home))).toBe(false)
    expect(installedVersion(path.join(home, '.imessage-wrapped'))).toBeNull()
  })
})

describe('the startup line, in a real shell', () => {
  /** Starts an interactive shell that reads the startup file and exits. The fake program prints "fake wrapped" when run. */
  function shell(home: string, command: string[]) {
    return new Promise<string>((resolve) => {
      const child = spawn(command[0]!, command.slice(1), { env: { PATH: '/usr/bin:/bin', HOME: home, ZDOTDIR: home, TERM: 'dumb' } })
      let out = ''
      child.stdout.on('data', (d) => (out += d))
      child.on('close', () => resolve(out))
      child.stdin.end()
    })
  }
  const marker = (home: string) => path.join(home, '.imessage-wrapped', 'resume')

  for (const [name, command, rc] of [
    ['zsh', ['/bin/zsh', '-i', '-c', 'echo "on path: $(command -v wrapped)"'], '.zshrc'],
    ['bash', ['/bin/bash', '-l', '-i', '-c', 'echo "on path: $(command -v wrapped)"'], '.bash_profile'],
  ] as const) {
    it(`${name}: puts wrapped on PATH, and starts it only while the resume marker exists`, async () => {
      const home = newHome()
      expect((await install(home, { shell: `/bin/${name}` })).status).toBe(0)
      expect(fs.readFileSync(path.join(home, rc), 'utf8')).toContain(STARTUP_LINE)
      expect(await shell(home, [...command])).toBe(`on path: ${binOf(home)}\n`)
      fs.writeFileSync(marker(home), 'Apple_Terminal\n1\n')
      expect(await shell(home, [...command])).toBe(`fake wrapped 1.0.0\non path: ${binOf(home)}\n`)
    })
  }
})
