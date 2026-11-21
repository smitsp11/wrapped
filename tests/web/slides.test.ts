import { describe, expect, it } from 'vitest'
import { buildSlides, daysSoFar, escapeHtml, perDayLabel, periodLabel, sentLabel } from '../../web/src/slides'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { withSenderName } from '../../src/share/senderName'
import { cardStats, youCardFrom } from '../../web/src/maker/youCard'

describe('buildSlides', () => {
  it('builds the group slide sequence', () => {
    expect(buildSlides(makeFakeWrap('group')).map((s) => s.id)).toEqual([
      'intro', 'volume', 'hours', 'months', 'streak', 'replies', 'starters', 'reactions', 'words', 'texting-styles', 'hits',
      'award-main-character', 'award-ghost', 'award-starter', 'award-comedian', 'award-hype',
      'award-night-owl', 'award-double-texter', 'outro', 'summary',
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

  it('leaves the silence sentence off the group streak page too', () => {
    const wrap = makeFakeWrap('group')
    wrap.timing.longestSilenceDays = 3
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

  it('shows the five top words most-used first, whatever order they were picked in', () => {
    const wrap = makeFakeWrap('group')
    const counts = { win: 213, motive: 353, parlay: 233, bro: 90, cap: 400, extra: 999 }
    wrap.words.topWords = Object.entries(counts).map(([word, count]) => ({ word, count }))
    const shown = [...slideHtml(wrap, 'words').matchAll(/<span class="word">(\w+)<\/span>/g)].map((m) => m[1])
    expect(shown).toEqual(['cap', 'motive', 'parlay', 'win', 'bro'])
  })

  it('makes each group quote with a conversation open it, with a handwritten "see the convo"', () => {
    const wrap = makeFakeWrap('group')
    wrap.greatestHits = [...wrap.greatestHits.slice(0, 2), { senderId: 'p1', text: 'no context', sentAt: '2026-02-01T00:00:00Z', reactions: 2, laughs: 0 }]
    const html = slideHtml(wrap, 'hits')
    expect(html.match(/<figure data-convo="\d">/g)).toEqual(['<figure data-convo="0">', '<figure data-convo="1">'])
    expect(html.match(/class="see-convo"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="see the convo: Alex Chen, Jan 12, 8:00 PM" aria-haspopup="dialog">see the convo →</button>')
    expect(html).toContain('<figure><blockquote>“no context”') // no conversation, nothing to open
  })

  it('shows My year\'s top three quotes, each opening its conversation, and not on a quote without one', () => {
    const wrap = makeFakeWrap('solo')
    expect(wrap.greatestHits.slice(0, 3).every((h) => h.conversation)).toBe(true)
    expect(slideHtml(wrap, 'hits').match(/<figure data-convo="\d">/g)).toEqual(['<figure data-convo="0">', '<figure data-convo="1">', '<figure data-convo="2">'])
    expect(slideHtml(wrap, 'hits').match(/<time datetime=/g)).toHaveLength(3)
    expect(slideHtml(wrap, 'hits')).toContain('see the convo')
    const old = { ...wrap, greatestHits: wrap.greatestHits.map(({ conversation: _, ...h }) => h) } // a link from before
    expect(slideHtml(old, 'hits')).not.toContain('data-convo')
  })

  it('shows about 120 characters of a long quote, cut at a word, and leaves its conversation whole', () => {
    const wrap = makeFakeWrap('solo')
    const long = 'ok so hear me out: we rent the cabin for the long weekend, everyone brings one dish, nobody is allowed to talk about work and we finally finish that puzzle'
    const hit = wrap.greatestHits[0]!
    hit.text = long
    hit.conversation!.messages[hit.conversation!.hit]!.text = long
    const quote = slideHtml(wrap, 'hits').match(/<blockquote>“(.*?)”<\/blockquote>/)![1]!
    expect(quote).toBe('ok so hear me out: we rent the cabin for the long weekend, everyone brings one dish, nobody is allowed to talk about…')
    expect(Array.from(quote).length).toBeLessThanOrEqual(120)
    expect(hit.conversation!.messages[hit.conversation!.hit]!.text).toBe(long) // what the conversation shows
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

  it('titles the replies slide with no caption and shows seconds under a minute', () => {
    const wrap = makeFakeWrap('group')
    wrap.replies.medianReplyMinutesByPerson.p2 = 0.68
    const html = slideHtml(wrap, 'replies')
    expect(html).toContain('<h2>Fastest repliers</h2><div class="stage">')
    expect(html).not.toContain('class="aside"')
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

  it('never shows "Everyone else" in ranked slides, and not you in who-texts-you', () => {
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
      'intro', 'volume', 'top-chats', 'month-people', 'hours', 'months', 'streak', 'replies', 'starters', 'reactions', 'words', 'hits',
      'award-ghost', 'award-starter', 'award-comedian', 'award-hype', 'award-night-owl', 'award-double-texter', 'outro', 'summary',
    ])
  })

  it('skips slides with nothing to show', () => {
    const wrap = makeFakeWrap('group')
    wrap.greatestHits = []
    wrap.awards = []
    wrap.replies = { medianReplyMinutesByPerson: {}, repliesByPerson: {} }
    wrap.starters.startsByPerson = {}
    wrap.reactions.givenByPerson = {}
    delete wrap.texting
    const ids = buildSlides(wrap).map((s) => s.id)
    expect(ids).toEqual(['intro', 'volume', 'hours', 'months', 'streak', 'words', 'outro', 'summary'])
  })

  it('ends with one ask to make your own, on this site, plus Watch again', () => {
    const html = slideHtml(makeFakeWrap('group'), 'outro')
    expect(html).toContain('Made with iMessage Wrapped.')
    expect(html).toContain('make one for your group chat')
    expect(html).toContain('<a class="button" href="/">Make yours</a>')
    expect(html).toContain('data-restart>Watch again</a>')
    expect(html.match(/class="button"/g)).toHaveLength(1)
    expect(html).not.toMatch(/private|upload/i)
  })

  it('hides the emoji and word lists when empty', () => {
    const wrap = makeFakeWrap('group')
    wrap.words.topEmoji = []
    const html = slideHtml(wrap, 'words')
    expect(html).not.toContain('Top emoji')
    expect(html).toContain('<p class="label">Top words &amp; phrases</p>')
  })

  it('marks the hour chart decorative, titles awards with h2 and wraps quotes in figures', () => {
    const slides = buildSlides(makeFakeWrap('group'))
    const html = (id: string) => slides.find((s) => s.id === id)!.html
    expect(html('hours')).toContain('class="hours" aria-hidden="true"')
    expect(html('award-ghost')).toContain('<h2 style="--len:5">The Ghost</h2>') // --len: its longest word, for the stamp's size
    expect(html('award-ghost')).not.toContain('<h1>')
    expect(html('hits')).toContain('<figure data-convo="0"><blockquote>')
    expect(html('hits')).toContain('<figcaption>')
    // When each quote was sent, in the viewer's time zone (UTC in these tests), without the year.
    expect(html('hits')).toContain('<time datetime="2026-01-12T20:00:00.000Z">Jan 12, 8:00 PM</time>')
    expect(html('hits')).not.toContain('<cite>')
  })
})

describe('buildSlides handwritten asides and shares', () => {
  const asidesOf = (wrap: ReturnType<typeof makeFakeWrap>) =>
    Object.fromEntries(buildSlides(wrap).flatMap((slide) => {
      const aside = slide.html.match(/<p class="aside">(.*?)<\/p>/)
      return aside ? [[slide.id, aside[1]]] : []
    }))

  it("adds \"(it's not close)\" to who-talked-the-most when #1 is far ahead, with no caption in a group", () => {
    const wrap = makeFakeWrap('group')
    wrap.volume.total = 100
    wrap.volume.byPerson = { p1: 60, p2: 20, p3: 20 }
    expect(slideHtml(wrap, 'volume')).toContain('<h2>Who talked the most</h2><p class="aside"><span class="quip">(it&#39;s not close)</span></p>')
  })

  it('has no aside at all when no quip holds and there are no words', () => {
    // The fake chat: 27.0% vs 23.3%, neither a tie nor a runaway.
    expect(slideHtml(makeFakeWrap('group'), 'volume')).not.toContain('class="aside"')
  })

  it('appends the peak-hour quip to its caption, and the streak has none', () => {
    const wrap = makeFakeWrap('group')
    wrap.timing.byHour = wrap.timing.byHour.map((_, hour) => (hour === 2 ? 50 : 1))
    wrap.timing.longestStreakDays = 120
    expect(slideHtml(wrap, 'hours')).toContain('<p class="aside">the chat&#39;s rush hour <span class="quip">(way past bedtime)</span></p>')
    expect(slideHtml(wrap, 'streak')).not.toContain('class="aside"')
    expect(slideHtml(wrap, 'streak')).not.toContain('dedication')
  })

  // Only short, natural captions; nothing that explains how a number was worked out.
  it('keeps only the short group captions', () => {
    expect(asidesOf(makeFakeWrap('group'))).toEqual({
      hours: 'the chat&#39;s rush hour',
      'texting-styles': '(500 texts or paragraphs?)',
      outro: 'see you next year',
    })
  })

  it('keeps only the short solo captions: what who-texts-you and top chats count, in a few words', () => {
    const wrap = makeFakeWrap('solo')
    expect(slideHtml(wrap, 'volume')).toContain('<h2>Who texts you the most</h2>')
    expect(asidesOf(wrap)).toEqual({
      volume: expect.stringMatching(/^texts they sent( <span class="quip">.*<\/span>)?$/),
      'top-chats': 'whole threads',
      hours: 'your texting rush hour',
      outro: 'see you next year',
    })
  })

  it('shows each person as a share of the group chat, but counts in a solo wrap', () => {
    expect(slideHtml(makeFakeWrap('group'), 'volume')).toContain('<span class="value">27%</span>')
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

describe('messages a day on the intro', () => {
  it('counts the days in the period, up to and including today', () => {
    const year = { from: '2026-01-01', to: '2027-01-01' }
    expect(daysSoFar(year, new Date(2026, 10, 20, 15))).toBe(324) // Jan 1 → Nov 20
    expect(daysSoFar(year, new Date(2026, 0, 1, 9))).toBe(1)
    expect(daysSoFar(year, new Date(2027, 5, 1))).toBe(365) // a finished period isn't stretched
    expect(daysSoFar({ from: '2026-01-01', to: '2026-11-21' }, new Date(2026, 10, 20))).toBe(324) // a year-so-far wrap
    expect(daysSoFar(year, new Date(2025, 11, 1))).toBe(1) // a clock set before the period never divides by zero
  })

  it('rounds the way a person would say it', () => {
    expect(perDayLabel(215_028, 324)).toBe("That's about 660 texts a day")
    expect(perDayLabel(1_234_567, 324)).toBe("That's about 3,800 texts a day")
    expect(perDayLabel(4_000, 324)).toBe("That's about 12 texts a day")
    expect(perDayLabel(324, 324)).toBe("That's about 1 text a day")
  })

  it('counts per week under one a day, and says nothing under one a week', () => {
    expect(perDayLabel(320, 325)).toBe("That's about 7 texts a week")
    expect(perDayLabel(20, 324)).toBeNull()
  })

  it('is the one line under the intro polaroid, in both kinds of wrap, and nothing when there are very few', () => {
    const today = new Date(2026, 10, 20, 12)
    for (const mode of ['group', 'solo'] as const) {
      const wrap = makeFakeWrap(mode)
      wrap.volume.total = 215_028
      const html = buildSlides(wrap, today)[0]!.html
      expect(html).toContain('<p class="per-day">That&#39;s about 660 texts a day</p>')
      expect(html).not.toMatch(/a lot of|Here&#39;s/)
      expect(html).not.toContain('class="lede"')
      wrap.volume.total = 3
      expect(buildSlides(wrap, today)[0]!.html).not.toContain('per-day')
    }
  })
})

describe('texting styles slide', () => {
  const ids = (wrap: ReturnType<typeof makeFakeWrap>) => buildSlides(wrap).map((s) => s.id)

  it("shows each member's name, style and mini bubbles, busiest first, with no description", () => {
    const html = slideHtml(makeFakeWrap('group'), 'texting-styles')
    expect(html).toContain('Texting styles')
    const rows = [...html.matchAll(/<li data-style="([\w-]+)"[^>]*>.*?<span class="style-who">([^<]+)<\/span><span class="style-name">([^<]+)<\/span>/g)]
    expect(rows.map((m) => [m[2], m[1], m[3]])).toEqual([
      ['Alex Chen', 'one-and-done', 'One and Done'],
      ['You', 'nonchalant', 'Nonchalant'],
      ['Sam Rivera', 'balanced', 'Perfectly Balanced'],
      ['Jordan Lee', 'paragraph-texter', 'Paragraph Texter'],
      ['Riley Park', 'spray-n-pray', 'Spray n Pray'],
    ])
    expect(html).not.toContain('3 texts in a row, every time.')
    expect(html).not.toContain('style-line')
    expect(html).not.toContain(' many')
  })

  it('draws one mini bubble per text in a typical turn (at most four), wider and taller for longer texts', () => {
    const wrap = makeFakeWrap('group')
    wrap.texting = { medianWordsByPerson: { p1: 1, p2: 20, p3: 3 }, textsPerTurnByPerson: { p1: 1, p2: 1.2, p3: 9 } }
    const html = slideHtml(wrap, 'texting-styles')
    const hints = [...html.matchAll(/<span class="mini-texts" aria-hidden="true">(.*?)<\/span>/g)].map((m) => m[1]!)
    expect(hints.map((h) => h.match(/<i /g)!.length)).toEqual([1, 1, 4])
    expect(hints[0]).toContain('--w:28%;--lines:1')
    expect(hints[1]).toContain('--w:100%;--lines:3')
  })

  it('is only in group wraps, after the vocabulary', () => {
    expect(ids(makeFakeWrap('solo'))).not.toContain('texting-styles')
    const group = ids(makeFakeWrap('group'))
    expect(group.indexOf('texting-styles')).toBe(group.indexOf('words') + 1)
  })

  it('is skipped for an old link without texting stats', () => {
    const wrap = makeFakeWrap('group')
    delete wrap.texting
    expect(ids(wrap)).not.toContain('texting-styles')
  })

  it('needs two people with a style, and someone who is not Perfectly Balanced', () => {
    const wrap = makeFakeWrap('group')
    wrap.texting = { medianWordsByPerson: { p1: 1 }, textsPerTurnByPerson: { p1: 1 } }
    expect(ids(wrap)).not.toContain('texting-styles')
    wrap.texting = { medianWordsByPerson: { p1: 5, p2: 6 }, textsPerTurnByPerson: { p1: 1.5, p2: 1.4 } }
    expect(ids(wrap)).not.toContain('texting-styles')
    wrap.texting.medianWordsByPerson.p2 = 1
    expect(ids(wrap)).toContain('texting-styles')
  })

  it('lists at most eight people, the busiest, and packs six or more tighter', () => {
    const wrap = makeFakeWrap('group')
    const people = Array.from({ length: 10 }, (_, i) => `p${i + 1}`)
    wrap.people = Object.fromEntries(people.map((id) => [id, `Person ${id}`]))
    wrap.volume.byPerson = Object.fromEntries(people.map((id, i) => [id, 100 - i]))
    wrap.texting = {
      medianWordsByPerson: Object.fromEntries(people.map((id) => [id, 1])),
      textsPerTurnByPerson: Object.fromEntries(people.map((id) => [id, 1.3])),
    }
    const html = slideHtml(wrap, 'texting-styles')
    expect(html.match(/<li /g)).toHaveLength(8)
    expect(html).toContain('Person p8<')
    expect(html).not.toContain('Person p9<')
    expect(html).toContain('class="styles many"')
  })

  it('escapes names', () => {
    const wrap = makeFakeWrap('group')
    wrap.people.p4 = '<img src=x onerror=alert(1)>'
    const html = slideHtml(wrap, 'texting-styles')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})

describe('sentLabel', () => {
  // The tests run in UTC (vitest.config.ts); the viewer's own time zone is used in a browser.
  it('gives the month, day and time, without the year', () => {
    expect(sentLabel('2026-01-12T20:00:00.000Z')).toBe('Jan 12, 8:00 PM')
    expect(sentLabel('2026-07-04T00:05:00.000Z')).toBe('Jul 4, 12:05 AM')
  })
})

describe('the summary card, the last page', () => {
  it('is your share card in My year: personality, your numbers and your awards', () => {
    const wrap = makeFakeWrap('solo')
    const slides = buildSlides(wrap)
    expect(slides.at(-1)!.id).toBe('summary')
    const html = slides.at(-1)!.html
    const card = youCardFrom(wrap)
    expect(html).toContain('<p class="hand-title">my 2026 in texts</p>')
    expect(html).toContain('my texting personality')
    expect(html).toContain(`>${escapeHtml(card.personality.name)}</p>`)
    expect(html).toContain(escapeHtml(card.personality.line))
    expect(html.match(/<li class="note taped"/g)).toHaveLength(cardStats(card).length)
    expect(html).toContain('<span class="hand" style="--len:10">texts sent</span>')
    for (const title of card.awards) expect(html).toContain(`★ ${escapeHtml(title)}</li>`)
  })

  it('shows your streak with one person, by first name, or the any-message streak without one', () => {
    const wrap = makeFakeWrap('solo')
    wrap.people.p1 = 'Marisol Vega'
    wrap.personStreak = { personId: 'p1', days: 117, from: '2026-03-01' }
    wrap.timing.longestStreakDays = 325
    const summary = () => buildSlides(wrap).at(-1)!.html
    expect(summary()).toContain('<b>117 days</b><span class="hand" style="--len:16">streak w Marisol</span>')
    expect(summary()).not.toContain('Raghunathan')
    delete wrap.personStreak
    expect(summary()).toContain('<b>325 days</b><span class="hand" style="--len:14">longest streak</span>')
  })

  it('writes "top emoji" inside the stamp, above the emoji, in My year and a group', () => {
    const solo = makeFakeWrap('solo')
    solo.words.topEmoji = [{ emoji: '😭', count: 9 }]
    for (const wrap of [solo, makeFakeWrap('group')]) {
      const html = buildSlides(wrap).at(-1)!.html
      expect(html).toMatch(/<p class="postage"><span><small class="postage-label">top emoji<\/small><span class="postage-emoji">\S+<\/span><\/span><\/p>/)
      expect(html).not.toContain('most used')
    }
  })

  it("is the group's card in a group wrap: its name, total, top word, top emoji and three award winners", () => {
    const wrap = makeFakeWrap('group')
    const html = buildSlides(wrap).at(-1)!.html
    expect(html).toContain('<p class="hand-title">our 2026 in texts</p>')
    expect(html).toContain('>Poker Night</p>')
    expect(html).toContain(`<b>${wrap.volume.total.toLocaleString('en-US')}</b><span class="hand" style="--len:8">messages</span>`)
    expect(html).toContain('<b>“poker”</b><span class="hand" style="--len:8">top word</span>')
    expect(html).toContain('<span class="postage-emoji">🃏</span>')
    expect(html.match(/<li class="chip"/g)).toHaveLength(3)
    expect(html).toContain('★ Main Character · Alex Chen</li>')
  })

  it('leaves out what a group wrap does not have, and escapes the chat name', () => {
    const wrap = makeFakeWrap('group')
    wrap.title = '<b>Poker</b>'
    wrap.words.topWords = []
    wrap.words.topEmoji = []
    wrap.awards = []
    const html = buildSlides(wrap).at(-1)!.html
    expect(html).toContain('&lt;b&gt;Poker&lt;/b&gt;')
    expect(html).not.toContain('<b>Poker')
    expect(html).not.toContain('top word')
    expect(html).not.toContain('postage')
    expect(html).not.toContain('summary-chips')
    expect(html).toContain('class="summary-notes odd"')
  })
})
