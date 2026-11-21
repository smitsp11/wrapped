import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SITE_CSP } from '../../src/csp'

type Header = { key: string; value: string }
const config = JSON.parse(fs.readFileSync('site/vercel.json', 'utf8')) as { headers: { source: string; headers: Header[] }[] }

describe('the website (site/vercel.json, copied to deploy/ by release.sh)', () => {
  it('sends the security headers on every route', () => {
    const all = config.headers.find((h) => h.source === '/(.*)')!
    expect(Object.fromEntries(all.headers.map((h) => [h.key, h.value]))).toEqual({
      'Content-Security-Policy': SITE_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    })
    expect(SITE_CSP).toContain("frame-ancestors 'none'")
    expect(SITE_CSP).toContain("script-src 'self';")
  })

  it('has no inline script in its pages, so the policy needs no unsafe-inline for scripts', () => {
    for (const page of ['web/index.html', 'web/maker.html']) {
      const html = fs.readFileSync(page, 'utf8')
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      expect(scripts.length, page).toBeGreaterThan(0)
      for (const [, attrs, body] of scripts) {
        expect(attrs, page).toMatch(/\bsrc=/)
        expect(body!.trim(), page).toBe('')
      }
      expect(html, page).not.toMatch(/\son[a-z]+=/i) // no inline event handlers either
    }
  })

  it("tells phones the viewer's numbers aren't phone numbers, emails or addresses", () => {
    expect(fs.readFileSync('web/index.html', 'utf8')).toContain('<meta name="format-detection" content="telephone=no,email=no,address=no" />')
  })
})
