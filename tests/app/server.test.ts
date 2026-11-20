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
  groups: [{ id: 7, chatIds: [7], title: 'Poker Night', messages: 302, memberNames: ['Alex', 'Sam'] }],
  history: { kind: 'ok', since: new Date(2019, 0, 1) },
  buildGroup: () => ({ wrap: makeFakeWrap('group'), undecodable: 0 }),
  buildSolo: () => ({ wrap: makeFakeWrap('solo'), undecodable: 0 }),
  senderName: () => 'Taylor',
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
    token: 'tok', port: 4321, site: 'https://wrapped.smitpatel.xyz',
    session: fakeSession, appDir: path.join(dir, 'app'), webDir,
    openMessages: vi.fn(async () => undefined),
    presence: { pageOpened: vi.fn(), pageClosed: vi.fn(), stop: vi.fn() },
    onClose: vi.fn(),
    update: () => null,
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
  it('describes the session: My year and the group chats, none made yet', async () => {
    const body = await (await handle(api('/api/state'), deps)).json()
    expect(body).toEqual({
      site: 'https://wrapped.smitpatel.xyz',
      period: { label: '2026 so far', year: 2026 },
      solo: { wrapId: 'me-2026', made: false },
      groups: [{ ...fakeSession.groups[0], wrapId: 'poker-night-7-2026', made: false }],
      senderName: 'Taylor',
      update: null,
    })
  })
  it('marks wraps saved earlier as made', async () => {
    saveWrap(deps.appDir, 'poker-night-7-2026', makeFakeWrap('group'))
    saveWrap(deps.appDir, 'me-2026', makeFakeWrap('solo'))
    const body = await (await handle(api('/api/state'), deps)).json()
    expect(body.solo.made).toBe(true)
    expect(body.groups[0].made).toBe(true)
  })
  it('names a merged group by all its chat rows, so a wrap of one row saved before merging shows as not made', async () => {
    const gamers = { id: 73, chatIds: [73, 762], title: 'Gamers', messages: 900, memberNames: ['Alex', 'Sam'] }
    saveWrap(deps.appDir, 'gamers-762-2026', makeFakeWrap('group'))
    const body = await (await handle(api('/api/state'), { ...deps, session: { ...fakeSession, groups: [gamers] } })).json()
    expect(body.groups).toEqual([{ ...gamers, wrapId: 'gamers-73-762-2026', made: false }])
  })
  it('includes a newer version once the update check finds one', async () => {
    const update = { current: '0.2.0-beta.3', latest: '0.2.0-beta.4' }
    const body = await (await handle(api('/api/state'), { ...deps, update: () => update })).json()
    expect(body.update).toEqual(update)
  })
  it('builds picked wraps and serves them back', async () => {
    const built = await (await handle(api('/api/build', { method: 'POST', body: JSON.stringify({ kind: 'groups', chatIds: [7] }) }), deps)).json()
    expect(built.ids).toEqual(['poker-night-7-2026'])
    const got = await (await handle(api('/api/wraps?ids=poker-night-7-2026'), deps)).json()
    expect(got.wraps[0].wrap.title).toBe('Poker Night')
  })
  it('rejects a malformed build request', async () => {
    const res = await handle(api('/api/build', { method: 'POST', body: JSON.stringify({ kind: 'groups', chatIds: ['x'] }) }), deps)
    expect(res.status).toBe(400)
  })
  it('404s an unknown wrap id', async () => {
    expect((await handle(api('/api/wraps?ids=nope-2026'), deps)).status).toBe(404)
  })
  it('opens Messages with the link', async () => {
    const link = 'https://wrapped.smitpatel.xyz/#abc'
    expect((await handle(api('/api/open-messages', { method: 'POST', body: JSON.stringify({ link }) }), deps)).status).toBe(204)
    expect(deps.openMessages).toHaveBeenCalledWith(link)
  })
  it('names "You" from your contact card, even over a name an older version saved, and has no way to change it', async () => {
    fs.mkdirSync(deps.appDir, { recursive: true })
    fs.writeFileSync(path.join(deps.appDir, 'sender-name'), 'Old Name')
    expect((await (await handle(api('/api/state'), deps)).json()).senderName).toBe('Taylor')
    const session = { ...fakeSession, senderName: () => '' } // no contact card: the wrap keeps "You"
    expect((await (await handle(api('/api/state'), { ...deps, session })).json()).senderName).toBe('')
    const rename = await handle(api('/api/sender-name', { method: 'POST', body: JSON.stringify({ name: 'Smit' }) }), deps)
    expect(rename.status).toBe(404)
  })
  it('closes when the page asks', async () => {
    expect((await handle(api('/api/close', { method: 'POST' }), deps)).status).toBe(204)
    expect(deps.onClose).toHaveBeenCalled()
  })
  it('counts a page as open while its session request is open', async () => {
    const page = new AbortController()
    const res = await handle(new Request(ORIGIN + '/api/session', { headers: { 'x-wrapped-token': 'tok' }, signal: page.signal }), deps)
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    expect((await reader.read()).done).toBe(false) // a first byte straight away
    expect(deps.presence.pageOpened).toHaveBeenCalledTimes(1)
    expect(deps.presence.pageClosed).not.toHaveBeenCalled()
    page.abort() // the tab closed
    page.abort()
    expect(deps.presence.pageClosed).toHaveBeenCalledTimes(1)
  })
  it('refuses a session request without the token', async () => {
    expect((await handle(api('/api/session', {}, 'wrong'), deps)).status).toBe(403)
    expect(deps.presence.pageOpened).not.toHaveBeenCalled()
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
  it('builds the solo wrap', async () => {
    const built = await (await handle(api('/api/build', { method: 'POST', body: JSON.stringify({ kind: 'solo' }) }), deps)).json()
    expect(built.ids).toEqual(['me-2026'])
  })
})
