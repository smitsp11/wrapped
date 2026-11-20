import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RESUME_MAX_AGE_MS, canResume, claimResume, clearResume, resumeFile, writeResume } from '../../src/app/resume'

// A temp app folder only: never the real ~/.imessage-wrapped.
let appDir: string
beforeEach(() => (appDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-')), '.imessage-wrapped')))
afterEach(() => fs.rmSync(path.dirname(appDir), { recursive: true, force: true }))

const terminal = { TERM_PROGRAM: 'Apple_Terminal' }
const now = 1_800_000_000_000

describe('the resume marker', () => {
  it('is claimed once: the first restored window runs, the rest do not', () => {
    writeResume(appDir, terminal, now)
    expect(fs.readFileSync(resumeFile(appDir), 'utf8')).toBe(`Apple_Terminal\n${now}\n`)
    expect(fs.statSync(resumeFile(appDir)).mode & 0o777).toBe(0o600)
    expect(claimResume(appDir, terminal, now + 60_000, true)).toBe(true)
    expect(fs.existsSync(resumeFile(appDir))).toBe(false)
    expect(claimResume(appDir, terminal, now + 60_000, true)).toBe(false)
  })
  it('does nothing without a marker (every other new shell)', () => {
    expect(claimResume(appDir, terminal, now, true)).toBe(false)
  })
  it('is ignored and tidied away once it is 15 minutes old', () => {
    writeResume(appDir, terminal, now)
    expect(claimResume(appDir, terminal, now + RESUME_MAX_AGE_MS - 1, false)).toBe(false) // fresh: kept
    expect(fs.existsSync(resumeFile(appDir))).toBe(true)
    expect(claimResume(appDir, terminal, now + RESUME_MAX_AGE_MS, true)).toBe(false)
    expect(fs.existsSync(resumeFile(appDir))).toBe(false)
  })
  it('treats a marker from the future or with no time as stale', () => {
    writeResume(appDir, terminal, now)
    expect(claimResume(appDir, terminal, now - 1, true)).toBe(false)
    expect(fs.existsSync(resumeFile(appDir))).toBe(false)
    fs.writeFileSync(resumeFile(appDir), 'Apple_Terminal\n')
    expect(claimResume(appDir, terminal, now, true)).toBe(false)
    expect(fs.existsSync(resumeFile(appDir))).toBe(false)
  })
  it("is left alone by another terminal app's shells", () => {
    writeResume(appDir, terminal, now)
    expect(claimResume(appDir, { TERM_PROGRAM: 'iTerm.app' }, now + 1000, true)).toBe(false)
    expect(claimResume(appDir, {}, now + 1000, true)).toBe(false)
    expect(fs.existsSync(resumeFile(appDir))).toBe(true)
    expect(claimResume(appDir, terminal, now + 1000, true)).toBe(true)
  })
  it('is left alone by a shell that is not a terminal (an editor reading the shell settings)', () => {
    writeResume(appDir, terminal, now)
    expect(claimResume(appDir, terminal, now + 1000, false)).toBe(false)
    expect(fs.existsSync(resumeFile(appDir))).toBe(true)
  })
  it('is cleared by a run started by hand', () => {
    writeResume(appDir, terminal, now)
    clearResume(appDir)
    clearResume(appDir) // nothing there: fine
    expect(fs.existsSync(resumeFile(appDir))).toBe(false)
  })
  it('needs a terminal app it can recognise, outside tmux', () => {
    expect(canResume({ TERM_PROGRAM: 'Apple_Terminal' })).toBe(true)
    expect(canResume({ TERM_PROGRAM: 'iTerm.app' })).toBe(true)
    expect(canResume({})).toBe(false)
    expect(canResume({ TERM_PROGRAM: 'tmux' })).toBe(false)
    expect(canResume({ TERM_PROGRAM: 'Apple_Terminal', TMUX: '/tmp/tmux-501/default,1,0' })).toBe(false)
  })
})
