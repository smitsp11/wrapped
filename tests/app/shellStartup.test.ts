import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installerAddedToPath, startupFiles } from '../../src/app/shellStartup'

// A temp home only: never the real shell settings.
let home: string
beforeEach(() => (home = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-startup-test-'))))
afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

const INSTALLER_LINE = 'export PATH="$HOME/.imessage-wrapped/bin:$PATH" # added by iMessage Wrapped\n'

describe('installerAddedToPath', () => {
  it('is false when there are no startup files (run directly, not via the installer)', () => {
    expect(installerAddedToPath(startupFiles(home, undefined))).toBe(false)
  })
  it('is false when the startup files exist but have no installer line', () => {
    fs.writeFileSync(path.join(home, '.zshrc'), 'alias ll="ls -l"\n')
    fs.writeFileSync(path.join(home, '.profile'), '# mine\n')
    expect(installerAddedToPath(startupFiles(home, undefined))).toBe(false)
  })
  it('finds the line in .zshrc or a bash startup file', () => {
    fs.writeFileSync(path.join(home, '.zshrc'), `# mine\n${INSTALLER_LINE}`)
    expect(installerAddedToPath(startupFiles(home, undefined))).toBe(true)
    fs.rmSync(path.join(home, '.zshrc'))
    fs.writeFileSync(path.join(home, '.bash_login'), INSTALLER_LINE)
    expect(installerAddedToPath(startupFiles(home, undefined))).toBe(true)
  })
  it('looks in $ZDOTDIR/.zshrc when ZDOTDIR is set', () => {
    const zdot = path.join(home, 'zdot')
    fs.mkdirSync(zdot)
    fs.writeFileSync(path.join(zdot, '.zshrc'), INSTALLER_LINE)
    expect(installerAddedToPath(startupFiles(home, zdot))).toBe(true)
    expect(installerAddedToPath(startupFiles(home, undefined))).toBe(false)
  })
  it('treats an unreadable file as no line', () => {
    fs.mkdirSync(path.join(home, '.zshrc')) // a folder, so reading it fails
    expect(installerAddedToPath(startupFiles(home, undefined))).toBe(false)
  })
})
