import { describe, expect, it, vi } from 'vitest'
import { updateLine } from '../../src/app/copy'
import { checkForUpdate, compareVersions } from '../../src/app/update'

const SITE = 'https://wrapped.example'
const answering = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('compareVersions', () => {
  it('orders prereleases before their release', () => {
    const order = ['0.1.9', '0.2.0-alpha', '0.2.0-beta.3', '0.2.0-beta.4', '0.2.0-beta.10', '0.2.0-rc.1', '0.2.0', '0.2.1', '0.10.0', '1.0.0']
    for (let i = 0; i < order.length - 1; i++) {
      expect(compareVersions(order[i]!, order[i + 1]!), `${order[i]} < ${order[i + 1]}`).toBeLessThan(0)
      expect(compareVersions(order[i + 1]!, order[i]!)).toBeGreaterThan(0)
    }
  })
  it('treats equal versions as equal', () => {
    expect(compareVersions('0.2.0-beta.3', '0.2.0-beta.3')).toBe(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })
  it('compares numbers before words, and a shorter prerelease first', () => {
    expect(compareVersions('1.0.0-1', '1.0.0-beta')).toBeLessThan(0)
    expect(compareVersions('1.0.0-beta', '1.0.0-beta.1')).toBeLessThan(0)
  })
  it('never calls an unreadable version newer', () => {
    expect(compareVersions('banana', '0.2.0')).toBe(0)
    expect(compareVersions('0.3.0', 'v0.2')).toBe(0)
  })
})

describe('checkForUpdate', () => {
  it('reports a newer published version', async () => {
    const get = answering({ version: '0.2.0-beta.4' })
    expect(await checkForUpdate(SITE, '0.2.0-beta.3', {}, get)).toEqual({ current: '0.2.0-beta.3', latest: '0.2.0-beta.4' })
    expect(get).toHaveBeenCalledWith(`${SITE}/version.json`, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
  it('says nothing when up to date or ahead', async () => {
    expect(await checkForUpdate(SITE, '0.2.0-beta.4', {}, answering({ version: '0.2.0-beta.4' }))).toBeNull()
    expect(await checkForUpdate(SITE, '0.3.0', {}, answering({ version: '0.2.0' }))).toBeNull()
  })
  it('is silent on any failure', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await checkForUpdate(SITE, '0.1.0', {}, offline)).toBeNull()
    expect(await checkForUpdate(SITE, '0.1.0', {}, answering({ version: '9.9.9' }, 404))).toBeNull()
    expect(await checkForUpdate(SITE, '0.1.0', {}, answering({ nope: 1 }))).toBeNull()
    const notJson = vi.fn(async () => new Response('<html>')) as unknown as typeof fetch
    expect(await checkForUpdate(SITE, '0.1.0', {}, notJson)).toBeNull()
  })
  it('gives up after 1.5 seconds', async () => {
    const hang = vi.fn(
      (_url: string, init: RequestInit) => new Promise<Response>((_, fail) => init.signal!.addEventListener('abort', () => fail(init.signal!.reason))),
    ) as unknown as typeof fetch
    const started = Date.now()
    expect(await checkForUpdate(SITE, '0.1.0', {}, hang)).toBeNull()
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400)
    expect(Date.now() - started).toBeLessThan(3000)
  })
  it('is skipped with WRAPPED_NO_UPDATE_CHECK=1', async () => {
    const get = answering({ version: '9.9.9' })
    expect(await checkForUpdate(SITE, '0.1.0', { WRAPPED_NO_UPDATE_CHECK: '1' }, get)).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })
  it('words the notice like the terminal and page show it', () => {
    expect(updateLine({ current: '0.2.0-beta.3', latest: '0.2.0-beta.4' })).toBe('Update available: 0.2.0-beta.3 → 0.2.0-beta.4. Run: wrapped update')
  })
})
