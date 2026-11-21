/**
 * Slides about the year as a calendar: messages per month with the busiest day, your person month by month, and your
 * longest streak with one person. Pure (no DOM), like slides.ts. Their stats are optional in a wrap (older links have
 * none), so each slide checks for its own.
 */
import { OTHERS_ID, type Wrap } from '../../src/types'
import { firstName, shortNames } from '../../src/wrap/names'
import { caption } from './captions'
import { MONTHS, aside, escapeHtml, neverMissedADay, neverMissedNote, personName, plural, type Slide } from './slides'

const DAY_MS = 24 * 60 * 60 * 1000
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['a Sunday', 'a Monday', 'a Tuesday', 'a Wednesday', 'a Thursday', 'a Friday', 'a Saturday']
/** Each person in the month-by-month strip gets the next of these, in the order they first appear. */
const PERSON_INKS = ['--orange', '--blue', '--green', '--purple', '--award-red', '--ink-muted']
/** A one-day "streak" with one person says nothing, so My year keeps the any-message streak instead. */
const MIN_PERSON_STREAK_DAYS = 2

const utcDate = (date: string) => new Date(`${date}T00:00:00Z`)
const dayLabel = (date: Date) => `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`

/** The months the period has reached, January first: a wrap of the year so far stops at this month. */
export function shownMonths(period: Wrap['period']): { first: number; last: number } {
  const from = utcDate(period.from)
  const lastDay = new Date(utcDate(period.to).getTime() - DAY_MS)
  const first = from.getUTCMonth()
  const last = lastDay.getUTCFullYear() === from.getUTCFullYear() ? lastDay.getUTCMonth() : 11
  return { first, last: Math.max(first, last) }
}

/** Short names for the people in a wrap: first names, or "Alex C." / "Alex K." when two share one (see shortNames). */
function shortNamesOf(wrap: Wrap): Map<string, string> {
  const ids = Object.keys(wrap.people).filter((id) => id !== 'me' && id !== OTHERS_ID)
  const names = shortNames(ids.map((id) => ({ full: personName(wrap, id), short: firstName(personName(wrap, id)) })))
  return new Map(ids.map((id, i) => [id, names[i]!]))
}

function shortName(wrap: Wrap, names: Map<string, string>, id: string): string {
  return names.get(id) ?? personName(wrap, id)
}

/**
 * Peak month: messages per month as bars, like Peak hour, up to the period's last month; the busiest one in orange
 * (ties: the earlier month), named in the aside as your "yap era". Under it the busiest day, with a "what happened on
 * May 21?". The wrap may also know the total against last year (`vsLastYear`), which the slide leaves out.
 */
export function monthsSlide(wrap: Wrap): Slide {
  const { first, last } = shownMonths(wrap.period)
  const counts = wrap.timing.byMonth.slice(first, last + 1)
  const top = Math.max(...counts)
  const peak = Math.max(top, 1)
  const peakIndex = counts.indexOf(top)
  const bars = counts
    .map((n, i) => `<span${i === peakIndex && top > 0 ? ' class="peak"' : ''} style="--h:${Math.round((n / peak) * 100)}%"></span>`)
    .join('')
  const initials = counts.map((_, i) => `<span>${MONTHS[first + i]![0]}</span>`).join('')
  const busiest = wrap.timing.busiestDay
  const day = busiest ? utcDate(busiest.date) : null
  const busiestHtml =
    busiest && day
      ? `<div class="busiest">
          <p class="day-page"><span>${MONTHS[day.getUTCMonth()]}</span> <b>${day.getUTCDate()}</b></p>
          <p><span class="hand">busiest day</span> <b>${plural(busiest.messages, 'message')}</b> <small>${WEEKDAYS[day.getUTCDay()]}</small><span class="what hand">what happened on ${dayLabel(day)}?</span></p>
        </div>`
      : ''
  const era = caption({ slide: 'months', month: FULL_MONTHS[first + peakIndex]!, peakCount: top, group: wrap.mode === 'group' })
  return {
    id: 'months',
    html: `<h2>Peak month</h2>${aside(era)}
      <div class="stage">
        <div class="note taped">
          <p class="big">${MONTHS[first + peakIndex]}</p>
          <div class="hours months" style="--n:${counts.length}" aria-hidden="true">${bars}</div>
          <p class="axis hand months-axis" style="--n:${counts.length}" aria-hidden="true">${initials}</p>
        </div>
        ${busiestHtml}
      </div>`,
  }
}

/**
 * My year: who you texted the most 1:1 each month, as a strip of cards up to the period's last month. Each person keeps
 * one ink, so a run of months ("Apr Sam · May Sam") reads as one stretch. A month with no 1:1 messages shows a dash.
 * Under each name, small, how many messages that was; a link made before those counts existed shows just the names.
 * A long name is written smaller to fit its card (--len), then wraps (see breakable) rather than being cut. One person
 * three months running gets "Jun–Aug was the Riley era" under the subtitle (on a short page, in its place).
 */
export function monthPeopleSlide(wrap: Wrap): Slide | null {
  const months = wrap.topPersonByMonth
  if (wrap.mode !== 'solo' || !months) return null
  const { first, last } = shownMonths(wrap.period)
  const shown = months.slice(first, last + 1)
  if (shown.every((id) => id === null)) return null
  const names = shortNamesOf(wrap)
  const inks = new Map<string, string>()
  for (const id of shown) if (id !== null && !inks.has(id)) inks.set(id, PERSON_INKS[inks.size % PERSON_INKS.length]!)
  const counts = wrap.topPersonCountByMonth?.slice(first, last + 1)
  const items = shown.map((id, i) => {
    const month = `<span class="month">${MONTHS[first + i]}</span>`
    if (id === null) return `<li class="none" style="--i:${i}">${month}<span class="name">—</span></li>`
    const name = shortName(wrap, names, id)
    const count = counts?.[i] ? `<span class="count">${counts[i]!.toLocaleString('en-US')}</span>` : ''
    return `<li style="--who:var(${inks.get(id)});--i:${i}">${month}<span class="name" style="--len:${[...name].length}">${breakable(name)}</span>${count}</li>`
  })
  const run = longestRun(shown)
  const era = run
    ? caption({ slide: 'month-people', run: { from: MONTHS[first + run.start]!, to: MONTHS[first + run.end]!, months: run.end - run.start + 1, name: shortName(wrap, names, run.id) } })
    : null
  return {
    id: 'month-people',
    html: `<h2>Your person</h2>${aside('who you texted the most, month by month')}${era ? `<p class="aside era">${escapeHtml(era)}</p>` : ''}
      <div class="stage"><ol class="month-people">${items.join('')}</ol></div>`,
  }
}

/** The longest run of one person in a row (the earliest of equal runs), as indices into `months`; null if nobody. */
function longestRun(months: (string | null)[]): { id: string; start: number; end: number } | null {
  let best: { id: string; start: number; end: number } | null = null
  let start = 0
  months.forEach((id, i) => {
    if (i > 0 && id !== months[i - 1]) start = i
    if (id !== null && (!best || i - start > best.end - best.start)) best = { id, start, end: i }
  })
  return best
}

/** A word longer than this gets a break point in its middle, used only when it can't fit its card on one line. */
const SPLIT_WORD_CHARS = 7

/** The name, escaped, with a <wbr> in the middle of each long word: "Valentinovich" wraps as "Valenti / novich". */
function breakable(name: string): string {
  return name
    .split(' ')
    .map((word) => {
      const chars = [...word]
      if (chars.length <= SPLIT_WORD_CHARS) return escapeHtml(word)
      const middle = Math.ceil(chars.length / 2)
      return `${escapeHtml(chars.slice(0, middle).join(''))}<wbr>${escapeHtml(chars.slice(middle).join(''))}`
    })
    .join(' ')
}

/**
 * My year's streak: the most days in a row with a 1:1 message with one person ("62 days in a row with Sam"), and when.
 * When you texted someone every day of the period, a handwritten "you never missed a day of texting" goes under it;
 * otherwise a streak over 100 days gets "at this point just move in together" as its aside (never both).
 * Null for a group, an older link, or a streak under two days.
 */
export function personStreakSlide(wrap: Wrap): Slide | null {
  const streak = wrap.personStreak
  if (wrap.mode !== 'solo' || !streak || streak.days < MIN_PERSON_STREAK_DAYS) return null
  const name = shortName(wrap, shortNamesOf(wrap), streak.personId)
  const from = utcDate(streak.from)
  const to = new Date(from.getTime() + (streak.days - 1) * DAY_MS)
  const neverMissed = neverMissedADay(wrap)
  return {
    id: 'streak',
    html: `<h2>Longest streak</h2>${neverMissed ? '' : aside(caption({ slide: 'streak', days: streak.days, group: false }))}
      <div class="stage">
        <div class="calendar">
          <p class="rings" aria-hidden="true"><span></span><span></span></p>
          <p class="big">${plural(streak.days, 'day')}</p>
          <p class="hand">in a row with <b>${escapeHtml(name)}</b></p>
          <p class="dates">${dayLabel(from)} → ${dayLabel(to)}</p>
        </div>
        ${neverMissed ? neverMissedNote('and you never missed a day of texting') : ''}
      </div>`,
  }
}
