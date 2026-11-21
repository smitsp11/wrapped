import type { HistorySpan, Wrap } from '../types'
import { checkHistory } from './history'

/** Fewer messages than this on last year's dates and a percent says little ("+900%"), so there's no comparison. */
export const MIN_LAST_YEAR_MESSAGES = 100

/** What lastYearChange needs from the database (MessagesDb has both). */
type Counts = { messageCountsByChat(from: Date, to: Date): Map<number, number> }

/**
 * The period's messages against the same dates a year earlier (Jan 1 → today, or the whole year), in the given chat rows
 * (all chats when left out), as a whole percent. Both years are counted the same way (see messageCountsByChat), so the
 * percent is fair even where that count runs a little above the wrap's total.
 * None when last year isn't real history: this Mac's messages start after it began (a new Mac, iCloud still syncing),
 * or it has fewer than MIN_LAST_YEAR_MESSAGES.
 */
export function lastYearChange(
  db: Counts,
  span: HistorySpan | null,
  period: { from: Date; to: Date },
  chatIds?: number[],
): Wrap['vsLastYear'] {
  const yearBefore = (d: Date) => new Date(d.getFullYear() - 1, d.getMonth(), d.getDate())
  const last = { from: yearBefore(period.from), to: yearBefore(period.to) }
  const lastPeriod = { ...last, year: last.from.getFullYear(), label: '' }
  if (checkHistory(span, lastPeriod, last.to).kind !== 'ok') return undefined
  const total = ({ from, to }: { from: Date; to: Date }) => {
    const counts = db.messageCountsByChat(from, to)
    return (chatIds ?? [...counts.keys()]).reduce((sum, id) => sum + (counts.get(id) ?? 0), 0)
  }
  const before = total(last)
  if (before < MIN_LAST_YEAR_MESSAGES) return undefined
  return { year: lastPeriod.year, percent: Math.round(((total(period) - before) / before) * 100) }
}
