import { describe, expect, it } from 'vitest'
import { beforeSend, pageKind, PRODUCTION_HOST } from '../../web/src/analytics'

const SITE = `https://${PRODUCTION_HOST}`

describe('pageKind', () => {
  it('tells the landing page, the demo and a wrap apart by the # part', () => {
    expect(pageKind('')).toBe('landing')
    expect(pageKind('#')).toBe('landing')
    expect(pageKind('#demo')).toBe('demo')
    expect(pageKind('#eJyrVkrLz1eyUkpKLFKqBQA')).toBe('wrap')
  })
})

describe('beforeSend', () => {
  const view = (url: string) => ({ type: 'pageview' as const, url })

  it('keeps only the site and a fixed path: no #, no query, no original path', () => {
    expect(beforeSend(view(`${SITE}/`), PRODUCTION_HOST)).toEqual(view(`${SITE}/`))
    expect(beforeSend(view(`${SITE}/?utm_source=x&name=Alex`), PRODUCTION_HOST)).toEqual(view(`${SITE}/`))
    expect(beforeSend(view(`${SITE}/#eJyrVkrLz1eyUkpKLFKqBQA`), PRODUCTION_HOST)).toEqual(view(`${SITE}/w`))
    expect(beforeSend(view(`${SITE}/home.html?x=1#demo`), PRODUCTION_HOST)).toEqual(view(`${SITE}/demo`))
  })
  it('drops everything off the real site: localhost, 127.0.0.1 (the maker preview), previews', () => {
    for (const host of ['localhost', '127.0.0.1', 'wrapped-git-main-smit.vercel.app']) {
      expect(beforeSend(view(`http://${host}/#demo`), host)).toBeNull()
    }
  })
  it('drops custom events and unreadable addresses', () => {
    expect(beforeSend({ type: 'event', url: `${SITE}/` }, PRODUCTION_HOST)).toBeNull()
    expect(beforeSend(view('not a url'), PRODUCTION_HOST)).toBeNull()
  })
})
