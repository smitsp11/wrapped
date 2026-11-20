import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { checkAccess, terminalName } from '../../src/app/access'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-test-'))
afterEach(() => vi.restoreAllMocks())
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('checkAccess', () => {
  it('is ok for a readable file', () => {
    const file = path.join(dir, 'ok.db')
    fs.writeFileSync(file, '')
    expect(checkAccess(file)).toBe('ok')
  })
  it('is missing when there is no file', () => expect(checkAccess(path.join(dir, 'nope.db'))).toBe('missing'))
  it('is denied when the file cannot be read', () => {
    const file = path.join(dir, 'locked.db')
    fs.writeFileSync(file, '')
    fs.chmodSync(file, 0o000)
    expect(checkAccess(file)).toBe('denied')
  })
  it('is denied when opening fails with EPERM', () => {
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw Object.assign(new Error('nope'), { code: 'EPERM' })
    })
    expect(checkAccess('/x')).toBe('denied')
  })
  describe('when macOS blocks the file', () => {
    const blocked = () =>
      vi.spyOn(fs, 'openSync').mockImplementation(() => {
        throw Object.assign(new Error('blocked'), { code: 'EPERM' })
      })
    const folderStat = (code: string | null) =>
      vi.spyOn(fs, 'statSync').mockImplementation(() => {
        if (code) throw Object.assign(new Error(code), { code })
        return {} as fs.Stats
      })

    it('is missing when the Messages folder itself does not exist', () => {
      blocked()
      const stat = folderStat('ENOENT')
      expect(checkAccess('/home/Library/Messages/chat.db')).toBe('missing')
      expect(stat).toHaveBeenCalledWith('/home/Library/Messages')
    })
    it('is denied when the folder exists (chat.db may or may not be there)', () => {
      blocked()
      folderStat(null)
      expect(checkAccess('/home/Library/Messages/chat.db')).toBe('denied')
    })
    it('is denied when the folder is blocked too', () => {
      blocked()
      folderStat('EPERM')
      expect(checkAccess('/home/Library/Messages/chat.db')).toBe('denied')
    })
  })
  it('rethrows unexpected errors such as EIO', () => {
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw Object.assign(new Error('disk'), { code: 'EIO' })
    })
    expect(() => checkAccess('/x')).toThrow('disk')
  })
})

describe('terminalName', () => {
  it('names known terminal apps', () => {
    expect(terminalName({ TERM_PROGRAM: 'Apple_Terminal' })).toBe('Terminal')
    expect(terminalName({ TERM_PROGRAM: 'iTerm.app' })).toBe('iTerm')
    expect(terminalName({ TERM_PROGRAM: 'WarpTerminal' })).toBe('Warp')
    expect(terminalName({ __CFBundleIdentifier: 'com.microsoft.VSCode' })).toBe('Visual Studio Code')
  })
  it('prefers the bundle identifier', () => {
    expect(terminalName({ __CFBundleIdentifier: 'com.todesktop.230313mzl4w4u92', TERM_PROGRAM: 'vscode' })).toBe('Cursor')
    expect(terminalName({ __CFBundleIdentifier: 'com.mitchellh.ghostty' })).toBe('Ghostty')
    expect(terminalName({ __CFBundleIdentifier: 'com.googlecode.iterm2', TERM_PROGRAM: 'tmux' })).toBe('iTerm')
  })
  it('calls an unidentified vscode-like app a code editor', () => {
    expect(terminalName({ TERM_PROGRAM: 'vscode' })).toBe('your code editor')
  })
  it('falls back to a generic name', () => expect(terminalName({})).toBe('your terminal app'))
})
