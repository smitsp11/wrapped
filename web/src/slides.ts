import { formatMinutes } from '../../src/format'
import { SHOWN_HITS } from '../../src/stats/greatestHits'
import { caption } from './captions'
import { OTHERS_ID } from '../../src/types'
import type { Wrap } from '../../src/types'

export type Slide = { id: string; html: string }
type Row = { name: string; value: number }

const MAX_BARS = 6
const MAX_SIGNATURES = 6
/** A top word longer than this doesn't fit beside the emoji note on the maker's 300px preview. */
const LONG_WORD_CHARS = 7
/** the smallest bar stays visible */
const MIN_BAR_PERCENT = 2
/**
 * a median over a handful of conversations says little, so people who joined fewer than this many conversations
 * someone else started don't make the fastest-repliers list
 */
const MIN_REPLIES_FOR_FASTEST = 5
/** the id buildWrap gives the solo "Everyone else" bucket */

export function escapeHtml(text: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return text.replace(/[&<>"']/g, (c) => entities[c]!)
}

/** Own-property check: an id like "toString" must not find something on Object.prototype. */
function personName(wrap: Wrap, id: string): string {
  return Object.hasOwn(wrap.people, id) ? wrap.people[id]! : 'Someone'
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`
}

function hourLabel(hour: number): string {
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Jan 1 → Nov 19". `to` is the day after the last one (the period is [from, to)). */
export function periodLabel(period: { from: string; to: string }): string {
  const last = new Date(`${period.to}T00:00:00Z`)
  last.setUTCDate(last.getUTCDate() - 1)
  const day = (date: Date) => `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`
  return `${day(new Date(`${period.from}T00:00:00Z`))} → ${day(last)}`
}

/**
 * When a quote was sent, e.g. "Jan 12, 8:00 PM", in the viewer's own time zone, so it can be found in Messages.
 * No year: a wrap covers one year.
 */
export function sentLabel(sentAt: string): string {
  return new Date(sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Characters in the longest word, so CSS can size a name or award title to fit its longest word on one line. */
export function longestWord(text: string): number {
  return Math.max(1, ...text.split(/\s+/).map((word) => [...word].length))
}

/** A handwritten aside under a heading, or nothing. */
function aside(text: string | null): string {
  return text ? `<p class="aside">${escapeHtml(text)}</p>` : ''
}

/** The footer hint on the intro and award pages. */
const HINT =
  '<p class="hint"><span class="touch">tap to flip the page →</span><span class="pointer">click or press → to flip the page</span></p>'

/** `scale` "largest": the biggest value gets the full bar. "smallest": the smallest does (lower is better). */
function bars(
  rows: Row[],
  format: (value: number) => string = (n) => n.toLocaleString('en-US'),
  scale: 'largest' | 'smallest' = 'largest',
): string {
  const shown = rows.slice(0, MAX_BARS)
  const largest = Math.max(...shown.map((r) => r.value), 1)
  const smallest = Math.min(...shown.map((r) => r.value))
  const width = (value: number) => {
    const raw = scale === 'largest' ? (value / largest) * 100 : value <= 0 ? 100 : (smallest / value) * 100
    return Math.min(100, Math.max(MIN_BAR_PERCENT, raw))
  }
  const items = shown.map(
    (r, i) =>
      `<li><span class="rank">${i + 1}</span><span class="name">${escapeHtml(r.name)}</span>` +
      `<span class="bar" style="--w:${Math.round(width(r.value))}%"></span>` +
      `<span class="value">${escapeHtml(format(r.value))}</span></li>`,
  )
  return `<ol class="bars">${items.join('')}</ol>`
}

/** Turns a wrap into story slides. Pure (no DOM), so it's unit-tested. */
export function buildSlides(wrap: Wrap): Slide[] {
  const isGroup = wrap.mode === 'group'
  const ranked = (record: Record<string, number>, order: 'desc' | 'asc' = 'desc', skip: string[] = []): Row[] =>
    Object.entries(record)
      .filter(([id]) => id !== OTHERS_ID && !skip.includes(id))
      .map(([id, value]) => ({ name: personName(wrap, id), value }))
      .sort((a, b) => (order === 'desc' ? b.value - a.value : a.value - b.value))
  const slides: Slide[] = []
  const year = escapeHtml(wrap.period.from.slice(0, 4))

  // --len lets the CSS shrink a long number ("1,234,567") so it stays inside the photo.
  const total = wrap.volume.total.toLocaleString('en-US')
  // A group wrap is a letter to the group; a solo wrap is titled like "Your 2026".
  const greeting = isGroup ? `dear ${escapeHtml(wrap.title)},` : escapeHtml(wrap.title)
  slides.push({
    id: 'intro',
    html: `<p class="kicker">${isGroup ? 'Group Chat Wrapped' : 'Your Texts Wrapped'} · ${year}</p>
      <h1 class="hand-title">${greeting}</h1>
      <div class="stage">
        <div class="polaroid taped">
          <div class="photo"><p class="big" style="--len:${total.length}">${total}</p><p>messages</p></div>
          <p class="hand">${escapeHtml(periodLabel(wrap.period))}</p>
        </div>
        <p class="lede">${isGroup ? "That's a lot of talking. Here's what you all did with it." : "That's a lot of texting. Here's where it went."}</p>
      </div>
      ${HINT}`,
  })

  // Solo: you are in every chat, so "who you text the most" leaves you out.
  const volumeRows = ranked(wrap.volume.byPerson, 'desc', isGroup ? [] : ['me'])
  if (volumeRows.length > 0) {
    const total = Math.max(wrap.volume.total, 1)
    const share = (n: number) => Math.round((n / total) * 1000) / 10
    const shares = volumeRows.map((r) => share(r.value))
    const note =
      shares.length > 1 ? caption({ slide: 'volume', topShare: shares[0]!, secondShare: shares[1]! }) : null
    // A group shows each person's share of the chat; solo shows counts, since your own messages aren't listed.
    const format = isGroup ? (n: number) => `${share(n)}%` : undefined
    slides.push({
      id: 'volume',
      html: `<h2>${isGroup ? 'Who talked the most' : 'Who you text the most'}</h2>${aside(note)}
        <div class="stage">${bars(volumeRows, format)}</div>`,
    })
  }

  if (wrap.topChats.length > 0) {
    const rows = wrap.topChats.map((c) => ({ name: c.name, value: c.messages }))
    slides.push({ id: 'top-chats', html: `<h2>Your top chats</h2><div class="stage">${bars(rows)}</div>` })
  }

  const top = Math.max(...wrap.timing.byHour)
  const peak = Math.max(top, 1)
  const peakHour = wrap.timing.byHour.indexOf(top)
  slides.push({
    id: 'hours',
    html: `<h2>Peak hour</h2>${aside(caption({ slide: 'hours', peakHour, peakCount: top }))}
      <div class="stage">
        <div class="note taped">
          <p class="big">${hourLabel(peakHour)}</p>
          <div class="hours" aria-hidden="true">${wrap.timing.byHour
            .map((n, hour) => {
              const mark = hour === peakHour && top > 0 ? ' class="peak"' : ''
              return `<span${mark} style="--h:${Math.max(0, Math.round((n / peak) * 100))}%"></span>`
            })
            .join('')}</div>
          <p class="axis hand" aria-hidden="true"><span>midnight</span><span>noon</span><span>11 PM</span></p>
        </div>
      </div>`,
  })

  // Across all your chats the longest silence is ~0, so only a group chat shows it, and only when it's real.
  const silenceDays = wrap.timing.longestSilenceDays
  const silence = isGroup && silenceDays >= 2 ? `<p class="lede">Longest silence: ${plural(silenceDays, 'day')}.</p>` : ''
  const streakDays = wrap.timing.longestStreakDays
  slides.push({
    id: 'streak',
    html: `<h2>Longest streak</h2>${aside(caption({ slide: 'streak', days: streakDays }))}
      <div class="stage">
        <div class="calendar">
          <p class="rings" aria-hidden="true"><span></span><span></span></p>
          <p class="big">${plural(streakDays, 'day')}</p>
          <p class="hand">in a row with at least one message.</p>
        </div>
        ${silence}
      </div>`,
  })

  const { repliesByPerson } = wrap.replies
  const experienced = Object.fromEntries(
    Object.entries(wrap.replies.medianReplyMinutesByPerson).filter(
      ([id]) => Object.hasOwn(repliesByPerson, id) && repliesByPerson[id]! >= MIN_REPLIES_FOR_FASTEST,
    ),
  )
  const replies = ranked(experienced, 'asc')
  if (replies.length > 0) {
    // Each person's median time to join a conversation someone else started (timed from its first message), so one slow
    // night doesn't count against them. The aside calls it "average", the everyday word, and says it's about jumping in.
    slides.push({
      id: 'replies',
      html: `<h2>Fastest repliers</h2>${aside('(average time to jump in)')}<div class="stage">${bars(replies, formatMinutes, 'smallest')}</div>`,
    })
  }

  const starts = ranked(wrap.starters.startsByPerson)
  if (starts.length > 0) {
    slides.push({ id: 'starters', html: `<h2>Who starts the conversation</h2><div class="stage">${bars(starts)}</div>` })
  }

  const given = ranked(wrap.reactions.givenByPerson)
  if (given.length > 0) {
    slides.push({ id: 'reactions', html: `<h2>Biggest reactors</h2><div class="stage">${bars(given)}</div>` })
  }

  const words = wordsSlide(wrap)
  if (words) slides.push(words)

  const hits = hitsSlide(wrap)
  if (hits) slides.push(hits)

  for (const award of wrap.awards) {
    const winner = personName(wrap, award.personId)
    slides.push({
      id: `award-${award.id}`,
      html: `<p class="hand-title">and the award for…</p>
        <div class="stage">
          <div class="stamp"><span>CERTIFIED</span><h2 style="--len:${longestWord(award.title)}">${escapeHtml(award.title)}</h2><span>${year}</span></div>
          <p class="hand">goes to</p>
          <p class="big winner" style="--len:${longestWord(winner)}">${escapeHtml(winner)}</p>
          <p class="chip">${escapeHtml(award.label)}</p>
        </div>
        ${HINT}`,
    })
  }

  // Friends who watch a wrap are who make the next one, so the outro has one clear ask, plus Watch again.
  // "/" is the landing page on whatever site is showing the wrap.
  slides.push({
    id: 'outro',
    html: `<h2 class="huge">That's a wrap</h2><p class="aside">see you next year</p>
      <div class="stage">
        <div class="note taped cta">
          <p class="made">Made with iMessage Wrapped.</p>
          <p class="hand">make one for your group chat</p>
          <a class="button" href="/">Make yours</a>
        </div>
        <a class="link" href="#" data-restart>Watch again</a>
      </div>`,
  })
  return slides
}

function wordsSlide(wrap: Wrap): Slide | null {
  const { topWords, topEmoji, signatureWordByPerson } = wrap.words
  if (topWords.length === 0 && topEmoji.length === 0) return null
  const emoji = topEmoji.slice(0, 5).map((e) => escapeHtml(e.emoji)).join(' ')
  // The five most distinctive words or phrases (see wordStats), shown most-used first so the counts read top to bottom.
  const shownWords = topWords.slice(0, 5).sort((a, b) => b.count - a.count)
  // On a narrow page a long word needs the whole width, so the emoji note moves under the list (see .word-notes.long).
  const long = shownWords.some((w) => longestWord(w.word) > LONG_WORD_CHARS)
  const wordItems = shownWords
    .map((w) => `<li><span class="word">${escapeHtml(w.word)}</span> <small>${w.count.toLocaleString('en-US')}</small></li>`)
    .join('')
  const sent = (id: string) => (Object.hasOwn(wrap.volume.byPerson, id) ? wrap.volume.byPerson[id]! : 0)
  // Over the cap, keep the people who sent the most messages (the sort is stable, so ties keep their order).
  const signature = Object.entries(signatureWordByPerson)
    .sort(([a], [b]) => sent(b) - sent(a))
    .slice(0, MAX_SIGNATURES)
    .map(([id, word]) => {
      // A shared group wrap may name the sender instead of "You" (see withSenderName).
      const name = personName(wrap, id)
      const who = id === 'me' && name === 'You' ? 'You say' : `${escapeHtml(name)} says`
      return `<li>${who} <b>“${escapeHtml(word)}”</b></li>`
    })
    .join('')
  return {
    id: 'words',
    html: `<h2>${wrap.mode === 'group' ? "The group's vocabulary" : 'Your vocabulary'}</h2>
      <div class="stage">
        <div class="word-notes${long ? ' long' : ''}">
          ${wordItems ? `<div class="note lined"><p class="label">Top words &amp; phrases</p><ol class="words">${wordItems}</ol></div>` : ''}
          ${emoji ? `<div class="note sticky taped"><p class="label">Top emoji</p><p class="emoji">${emoji}</p></div>` : ''}
        </div>
        ${signature ? `<ul class="signature">${signature}</ul>` : ''}
      </div>`,
  }
}

function hitsSlide(wrap: Wrap): Slide | null {
  if (wrap.greatestHits.length === 0) return null
  const quotes = wrap.greatestHits.slice(0, SHOWN_HITS).map((h, i) => {
    const who = escapeHtml(personName(wrap, h.senderId))
    // A group wrap's quote opens the conversation around it (see convo.ts). Solo wraps never carry one.
    const convo = wrap.mode === 'group' && h.conversation !== undefined
    const time = escapeHtml(sentLabel(h.sentAt))
    return (
      `<figure${convo ? ` data-convo="${i}"` : ''}><blockquote>“${escapeHtml(h.text)}”</blockquote>` +
      `<figcaption><span>${who} · ${plural(h.reactions, 'reaction')}</span>` +
      `<time datetime="${escapeHtml(h.sentAt)}">${time}</time></figcaption>` +
      (convo
        ? `<button type="button" class="see-convo" aria-label="see the convo: ${who}, ${time}" aria-haspopup="dialog">see the convo →</button>`
        : '') +
      `</figure>`
    )
  })
  // Two or three quotes get a smaller type size so they fit.
  const size = quotes.length > 1 ? 'compact' : 'single'
  return {
    id: 'hits',
    html: `<h2>Greatest hits</h2><p class="aside">ranked by reactions</p>
      <div class="stage"><div class="quotes ${size}">${quotes.join('')}</div></div>`,
  }
}
