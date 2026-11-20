import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { hasConsented, listWraps, loadWrap, saveConsent, saveWrap } from '../../src/app/store'

let appDir: string
beforeEach(() => (appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'))))
afterEach(() => fs.rmSync(appDir, { recursive: true, force: true }))

describe('store', () => {
  it('saves and loads a wrap by id, readable only by you', () => {
    const wrap = makeFakeWrap('group')
    saveWrap(appDir, 'poker-night-1-2026', wrap)
    expect(loadWrap(appDir, 'poker-night-1-2026')).toEqual(wrap)
    const mode = fs.statSync(path.join(appDir, 'wraps', 'poker-night-1-2026.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })
  it('tightens a looser existing file and folder, and leaves no temp files', () => {
    const dir = path.join(appDir, 'wraps')
    fs.mkdirSync(dir, { mode: 0o755 })
    fs.chmodSync(dir, 0o755)
    fs.writeFileSync(path.join(dir, 'x-2026.json'), '{}', { mode: 0o644 })
    fs.chmodSync(path.join(dir, 'x-2026.json'), 0o644)
    saveWrap(appDir, 'x-2026', makeFakeWrap('group'))
    expect(fs.statSync(path.join(dir, 'x-2026.json')).mode & 0o777).toBe(0o600)
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
    expect(fs.readdirSync(dir)).toEqual(['x-2026.json'])
  })
  it('ignores stray temp files when listing', () => {
    saveWrap(appDir, 'a-1-2026', makeFakeWrap('group'))
    fs.writeFileSync(path.join(appDir, 'wraps', 'b-2026.json.tmp'), '{}')
    expect(listWraps(appDir).map((w) => w.id)).toEqual(['a-1-2026'])
  })
  it('lists saved wraps newest first', async () => {
    saveWrap(appDir, 'a-1-2026', makeFakeWrap('group'))
    await new Promise((r) => setTimeout(r, 20))
    saveWrap(appDir, 'me-2026', makeFakeWrap('solo'))
    expect(listWraps(appDir).map((w) => w.id)).toEqual(['me-2026', 'a-1-2026'])
  })
  it('rejects ids that could escape the folder', () => {
    expect(() => loadWrap(appDir, '../secret')).toThrow()
    expect(() => saveWrap(appDir, 'a/b', makeFakeWrap())).toThrow()
  })
  it('remembers consent', () => {
    expect(hasConsented(appDir)).toBe(false)
    saveConsent(appDir)
    expect(hasConsented(appDir)).toBe(true)
  })
})
