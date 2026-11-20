import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { handle, type ServerDeps } from '../../src/app/server'
import type { Session } from '../../src/app/session'
import { saveWrap } from '../../src/app/store'

let dir: string
let deps: ServerDeps
const ORIGIN = 'http://127.0.0.1:4321'

const fakeSession: Session = {
  period: { year: 2026, from: new Date(2026, 0, 1), to: new Date(2026, 9, 28), label: '2026 so far' },
  groups: [{ id: 7, title: 'Pasta Gang', messages: 302, memberNames: ['Alex', 'Sam'] }],
  history: { kind: 'ok', since: new Date(2019, 0, 1) },
  buildGroup: () => ({ wrap: makeFakeWrap('group'), undecodable: 0 }),
  buildSolo: () => ({ wrap: makeFakeWrap('solo'), undecodable: 0 }),
  close: () => undefined,
}

function api(pathname: string, init: RequestInit = {}, token = 'tok'): Request {
  return new Request(ORIGIN + pathname, { ...init, headers: { 'x-wrapped-token': token, 'content-type': 'application/json' } })
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-test-'))
  const webDir = path.join(dir, 'web')
  fs.mkdirSync(webDir)
  fs.writeFileSync(path.join(webDir, 'maker.html'), '<h1>maker</h1>')
  deps = {
    token: 'tok', port: 4321, site: 'https://wrapped.smitpatel.xyz', mode: 'pick', ids: [],
    session: fakeSession, appDir: path.join(dir, 'app'), webDir,
    openMessages: vi.fn(async () => undefined), onDone: vi.fn(),
  }
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('local server', () => {
  it('rejects API calls without the token', async () => {
    expect((await handle(api('/api/state', {}, 'wrong'), deps)).status).toBe(403)
  })
  it('rejects requests for another host (DNS rebinding)', async () => {
    const req = new Request('http://evil.example:4321/api/state', { headers: { 'x-wrapped-token': 'tok' } })
    expect((await handle(req, deps)).status).toBe(403)
  })
  it('describes the session', async () => {
    const body = await (await handle(api('/api/state'), deps)).json()
    expect(body).toEqual({ mode: 'pick', site: 'https://wrapped.smitpatel.xyz', period: { label: '2026 so far', year: 2026 }, groups: fakeSession.groups, ids: [] })
  })
  it('builds picked wraps and serves them back', async () => {
    const built = await (await handle(api('/api/build', { method: 'POST', body: JSON.stringify({ kind: 'groups', chatIds: [7] }) }), deps)).json()
    expect(built.ids).toEqual(['pasta-gang-7-2026'])
    const got = await (await handle(api('/api/wraps?ids=pasta-gang-7-2026'), deps)).json()
    expect(got.wraps[0].wrap.title).toBe('Pasta Gang')
  })
  it('rejects a malformed build request', async () => {
    const res = await handle(api('/api/build', { method: 'POST', body: JSON.stringify({ kind: 'groups', chatIds: ['x'] }) }), deps)
    expect(res.status).toBe(400)
  })
  it('404s an unknown wrap id', async () => {
    expect((await handle(api('/api/wraps?ids=nope-2026'), deps)).status).toBe(404)
  })
  it('opens Messages with the link and finishes', async () => {
    const link = 'https://wrapped.smitpatel.xyz/#abc'
    expect((await handle(api('/api/open-messages', { method: 'POST', body: JSON.stringify({ link }) }), deps)).status).toBe(204)
    expect(deps.openMessages).toHaveBeenCalledWith(link)
    expect((await handle(api('/api/done', { method: 'POST' }), deps)).status).toBe(204)
    expect(deps.onDone).toHaveBeenCalled()
  })
  it('only opens links to our own site', async () => {
    const res = await handle(api('/api/open-messages', { method: 'POST', body: JSON.stringify({ link: 'https://evil.example/' }) }), deps)
    expect(res.status).toBe(400)
  })
  it('refuses an oversized link', async () => {
    const link = 'https://wrapped.smitpatel.xyz/#' + 'a'.repeat(16 * 1024)
    expect((await handle(api('/api/open-messages', { method: 'POST', body: JSON.stringify({ link }) }), deps)).status).toBe(400)
    expect(deps.openMessages).not.toHaveBeenCalled()
  })
  it('serves the maker page at / and refuses paths outside the web folder', async () => {
    expect(await (await handle(new Request(ORIGIN + '/?t=tok'), deps)).text()).toBe('<h1>maker</h1>')
    expect((await handle(new Request(ORIGIN + '/../../etc/passwd'), deps)).status).toBe(404)
    fs.mkdirSync(path.join(dir, 'web-evil'))
    fs.writeFileSync(path.join(dir, 'web-evil', 'x.txt'), 'secret')
    for (const p of ['/..%2f..%2fetc%2fpasswd', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/%2e%2e%2fweb-evil%2fx.txt']) {
      expect((await handle(new Request(ORIGIN + p), deps)).status, p).toBe(404)
    }
  })
  it('builds nothing when started without a session (saved wraps only)', async () => {
    const res = await handle(api('/api/build', { method: 'POST', body: JSON.stringify({ kind: 'solo' }) }), { ...deps, session: null })
    expect(res.status).toBe(409)
  })
})
