import { describe, expect, it } from 'vitest'
import { buildSlides, escapeHtml, periodLabel } from '../../web/src/slides'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { withSenderName } from '../../src/share/senderName'

describe('buildSlides', () => {
  it('builds the group slide sequence', () => {
    expect(buildSlides(makeFakeWrap('group')).map((s) => s.id)).toEqual([
      'intro', 'volume', 'hours', 'streak', 'replies', 'starters', 'reactions', 'words', 'hits',
      'award-main-character', 'award-ghost', 'award-starter', 'award-comedian', 'award-hype',
      'award-night-owl', 'award-double-texter', 'outro',
    ])
  })

  it('adds top chats in solo mode', () => {
    expect(buildSlides(makeFakeWrap('solo')).map((s) => s.id)).toContain('top-chats')
  })

  it('escapes names and quotes', () => {
    const wrap = makeFakeWrap('group')
    wrap.people.p1 = '<img src=x onerror=alert(1)>'
    const html = buildSlides(wrap).map((s) => s.html).join('')
    expect(html).not.toContain('<img')
    expect(escapeHtml(`<a href="x">'`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;')
  })

  it('shows ids that are not in people as "Someone"', () => {
    const wrap = makeFakeWrap('group')
    wrap.volume.byPerson = { toString: 5 }
    wrap.awards[0]!.personId = 'toString'
    const slides = buildSlides(wrap)
    const volume = slides.find((s) => s.id === 'volume')!.html
    expect(volume).toContain('Someone')
    expect(volume).not.toContain('function')
    expect(slides.find((s) => s.id === 'award-main-character')!.html).toContain('Someone')
  })

  it('hides the silence sentence and an empty signature list in solo mode', () => {
    const wrap = makeFakeWrap('solo')
    wrap.words.signatureWordByPerson = {}
    const slides = buildSlides(wrap)
    expect(slides.find((s) => s.id === 'streak')!.html).not.toMatch(/silence/i)
    expect(slides.find((s) => s.id === 'words')!.html).not.toContain('class="signature"')
    expect(slides.find((s) => s.id === 'words')!.html).toContain('Your vocabulary')
  })

  it('keeps the silence sentence in group mode when it is at least 2 days', () => {
    const wrap = makeFakeWrap('group')
    wrap.timing.longestSilenceDays = 3
    expect(slideHtml(wrap, 'streak')).toContain('Longest silence: 3 days.')
    wrap.timing.longestSilenceDays = 1
    expect(slideHtml(wrap, 'streak')).not.toMatch(/silence/i)
  })

  it('pluralises counts', () => {
    const wrap = makeFakeWrap('group')
    wrap.timing.longestStreakDays = 1
    wrap.greatestHits = [{ senderId: 'p1', text: 'hi', sentAt: '2026-01-01T00:00:00Z', reactions: 1, laughs: 0 }]
    expect(slideHtml(wrap, 'streak')).toContain('1 day<')
    expect(slideHtml(wrap, 'hits')).toContain('1 reaction<')
    wrap.timing.longestStreakDays = 2
    wrap.greatestHits[0]!.reactions = 2
    expect(slideHtml(wrap, 'streak')).toContain('2 days<')
    expect(slideHtml(wrap, 'hits')).toContain('2 reactions<')
  })

  it('lists at most 6 signature words', () => {
    const wrap = makeFakeWrap('group')
    wrap.words.signatureWordByPerson = Object.fromEntries(Array.from({ length: 9 }, (_, n) => [`p${n}`, `word${n}`]))
    const html = slideHtml(wrap, 'words')
    expect(html).toContain('word5')
    expect(html).not.toContain('word6')
  })

  it('keeps the 6 biggest senders when capping signature words', () => {
    const wrap = makeFakeWrap('group')
    const ids = Array.from({ length: 8 }, (_, n) => `p${n}`)
    wrap.words.signatureWordByPerson = Object.fromEntries(ids.map((id, n) => [id, `word${n}`]))
    wrap.volume.byPerson = Object.fromEntries(ids.map((id, n) => [id, n === 7 ? 1000 : n === 0 ? 1 : 10]))
    const html = slideHtml(wrap, 'words')
    expect(html).toContain('word7')
    expect(html).not.toContain('word0')
  })

  it('says "You say" for your own signature word', () => {
    const wrap = makeFakeWrap('group')
    wrap.words.signatureWordByPerson = { me: 'omw', p1: 'lol' }
    const html = slideHtml(wrap, 'words')
    expect(html).toContain('You say <b>')
    expect(html).not.toContain('You says')
    expect(html).toContain('Alex Chen says <b>')
  })

  it("uses the sender's name everywhere when a shared group wrap names them", () => {
    const wrap = withSenderName(makeFakeWrap('group'), 'Smit')
    wrap.words.signatureWordByPerson = { me: 'omw' }
    const html = buildSlides(wrap).map((s) => s.html).join('')
    expect(slideHtml(wrap, 'words')).toContain('Smit says <b>')
    expect(html).not.toMatch(/\bYou say\b|>You</)
    expect(html).toContain('Smit')
  })

  it('makes the fastest replier the full bar and lists them first', () => {
    const html = slideHtml(makeFakeWrap('group'), 'replies')
    const widths = [...html.matchAll(/--w:([\d.]+)%/g)].map((m) => Number(m[1]))
    expect(html.indexOf('Sam Rivera')).toBeGreaterThan(-1)
    expect(html.indexOf('Sam Rivera')).toBeLessThan(html.indexOf('Jordan Lee'))
    // Alex starts every fake conversation, and the starter is never timed.
    expect(html).not.toContain('Alex Chen')
    expect(widths[0]).toBe(100)
    expect(widths[widths.length - 1]).toBeLessThan(100)
  })

  it('titles the replies slide as the typical time to jump in and shows seconds under a minute', () => {
    const wrap = makeFakeWrap('group')
    wrap.replies.medianReplyMinutesByPerson.p2 = 0.68
    const html = slideHtml(wrap, 'replies')
    expect(html).toContain('<h2>Fastest repliers</h2><p class="aside">(typical time to jump in)</p>')
    expect(html.match(/class="aside"/g)).toHaveLength(1)
    expect(html).toContain('41 sec')
    expect(html).not.toContain('>0 min<')
  })

  it("sizes an award winner by the name's longest word", () => {
    const wrap = makeFakeWrap('group')
    wrap.people[wrap.awards[0]!.personId] = 'Maximiliana Featherstonehaugh'
    expect(slideHtml(wrap, `award-${wrap.awards[0]!.id}`)).toContain('class="big winner" style="--len:17"')
  })

  it('leaves people who joined fewer than 5 conversations out of fastest replies', () => {
    const wrap = makeFakeWrap('group')
    wrap.replies.medianReplyMinutesByPerson.p4 = 0.5
    wrap.replies.repliesByPerson.p4 = 4
    const html = slideHtml(wrap, 'replies')
    expect(html).not.toContain('Riley Park')
    expect(html).toContain('--w:100%')
  })

  it('never shows "Everyone else" in ranked slides, and not you in who-you-text', () => {
    const wrap = makeFakeWrap('solo')
    wrap.people.others = 'Everyone else'
    wrap.volume.byPerson.others = 999
    wrap.starters.startsByPerson.others = 999
    wrap.reactions.givenByPerson.others = 999
    wrap.replies.medianReplyMinutesByPerson.others = 0.1
    wrap.replies.repliesByPerson.others = 99
    const slides = buildSlides(wrap)
    for (const id of ['volume', 'replies', 'starters', 'reactions']) {
      expect(slides.find((s) => s.id === id)!.html).not.toContain('Everyone else')
    }
    expect(slides.find((s) => s.id === 'volume')!.html).not.toContain('You')
  })

  it('escapes every text field from the wrap', () => {
    const evil = "<b x='1'>"
    const wrap = makeFakeWrap('solo')
    wrap.title = evil
    wrap.greatestHits = [{ senderId: 'p1', text: evil, sentAt: '2026-01-01T00:00:00Z', reactions: 3, laughs: 1 }]
    wrap.awards = [{ id: 'ghost', title: evil, personId: 'p1', value: 1, label: evil }]
    wrap.words.topEmoji = [{ emoji: evil, count: 1 }]
    wrap.words.topWords = [{ word: evil, count: 1 }]
    wrap.words.signatureWordByPerson = { p1: evil }
    wrap.topChats = [{ name: evil, messages: 1 }]
    const html = buildSlides(wrap).map((s) => s.html).join('')
    expect(html).not.toContain('<b ')
    expect(html).toContain('&lt;b x=&#39;1&#39;&gt;')
    for (const id of ['intro', 'top-chats', 'words', 'hits', 'award-ghost']) {
      expect(slideHtml(wrap, id)).toContain('&lt;b x=&#39;1&#39;&gt;')
    }
  })

  it('builds the solo slide sequence', () => {
    expect(buildSlides(makeFakeWrap('solo')).map((s) => s.id)).toEqual([
      'intro', 'volume', 'top-chats', 'hours', 'streak', 'replies', 'starters', 'reactions', 'words', 'hits',
      'award-ghost', 'award-starter', 'award-comedian', 'award-hype', 'award-night-owl', 'award-double-texter', 'outro',
    ])
  })

  it('skips slides with nothing to show', () => {
    const wrap = makeFakeWrap('group')
    wrap.greatestHits = []
    wrap.awards = []
    wrap.replies = { medianReplyMinutesByPerson: {}, repliesByPerson: {} }
    wrap.starters.startsByPerson = {}
    wrap.reactions.givenByPerson = {}
    const ids = buildSlides(wrap).map((s) => s.id)
    expect(ids).toEqual(['intro', 'volume', 'hours', 'streak', 'words', 'outro'])
  })

  it('ends with one ask to make your own, on this site, plus Watch again', () => {
    const html = slideHtml(makeFakeWrap('group'), 'outro')
    expect(html).toContain('Made with iMessage Wrapped.')
    expect(html).toContain('make one for your group chat')
    expect(html).toContain('<a class="button" href="/">Make yours (Mac)</a>')
    expect(html).toContain('data-restart>Watch again</a>')
    expect(html.match(/class="button"/g)).toHaveLength(1)
    expect(html).not.toMatch(/private|upload/i)
  })

  it('hides the emoji and word lists when empty', () => {
    const wrap = makeFakeWrap('group')
    wrap.words.topEmoji = []
    const html = slideHtml(wrap, 'words')
    expect(html).not.toContain('Top emoji')
    expect(html).toContain('Top words')
  })

  it('marks the hour chart decorative, titles awards with h2 and wraps quotes in figures', () => {
    const slides = buildSlides(makeFakeWrap('group'))
    const html = (id: string) => slides.find((s) => s.id === id)!.html
    expect(html('hours')).toContain('class="hours" aria-hidden="true"')
    expect(html('award-ghost')).toContain('<h2>')
    expect(html('award-ghost')).not.toContain('<h1>')
    expect(html('hits')).toContain('<figure><blockquote>')
    expect(html('hits')).toContain('<figcaption>')
    expect(html('hits')).not.toContain('<cite>')
  })
})

describe('buildSlides handwritten asides and shares', () => {
  it("adds \"(it's not close)\" to who-talked-the-most when #1 is far ahead", () => {
    const wrap = makeFakeWrap('group')
    wrap.volume.total = 100
    wrap.volume.byPerson = { p1: 60, p2: 20, p3: 20 }
    expect(slideHtml(wrap, 'volume')).toContain('<p class="aside">(it&#39;s not close)</p>')
  })

  it('adds no aside when no rule holds', () => {
    // The fake chat: 29.8% vs 26.5%, neither a tie nor a runaway.
    expect(slideHtml(makeFakeWrap('group'), 'volume')).not.toContain('class="aside"')
  })

  it('shows each person as a share of the group chat, but counts in a solo wrap', () => {
    expect(slideHtml(makeFakeWrap('group'), 'volume')).toContain('<span class="value">29.8%</span>')
    expect(slideHtml(makeFakeWrap('solo'), 'volume')).not.toContain('%</span>')
  })

  it('marks only the busiest hour as the peak', () => {
    expect(slideHtml(makeFakeWrap('group'), 'hours').match(/class="peak"/g)).toHaveLength(1)
    const quiet = makeFakeWrap('group')
    quiet.timing.byHour = new Array(24).fill(0)
    expect(slideHtml(quiet, 'hours')).not.toContain('class="peak"')
  })

  it('labels the period from its first to its last day', () => {
    expect(periodLabel({ from: '2026-01-01', to: '2027-01-01' })).toBe('Jan 1 → Dec 31')
    expect(periodLabel({ from: '2026-01-01', to: '2026-11-20' })).toBe('Jan 1 → Nov 19')
    expect(periodLabel({ from: '2024-01-01', to: '2024-03-01' })).toBe('Jan 1 → Feb 29')
  })
})

describe('buildSlides edge cases', () => {
  it('does not render a negative hour when byHour is all zero', () => {
    const wrap = makeFakeWrap('group')
    wrap.timing.byHour = new Array(24).fill(0)
    expect(slideHtml(wrap, 'hours')).not.toContain('-1')
  })

  it('keeps a visible sliver for the smallest bar', () => {
    const wrap = makeFakeWrap('group')
    wrap.volume.byPerson = { p1: 1000, p2: 1 }
    const widths = [...slideHtml(wrap, 'volume').matchAll(/--w:([\d.]+)%/g)].map((m) => Number(m[1]))
    expect(widths).toEqual([100, 2])
  })

  it('skips the volume slide when there is nobody to show', () => {
    const wrap = makeFakeWrap('solo')
    wrap.volume.byPerson = { me: 50 }
    expect(buildSlides(wrap).map((s) => s.id)).not.toContain('volume')
  })
})

function slideHtml(wrap: ReturnType<typeof makeFakeWrap>, id: string): string {
  return buildSlides(wrap).find((s) => s.id === id)!.html
}
