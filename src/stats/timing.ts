import type { Message } from '../types'
import { DAY, contentMessages, increment } from './conversation'

export type TimingStats = {
  /** 12 counts, January first (local time); a period is at most one year */
  byMonth: number[]
  /** 7 counts, Sunday first */
  byWeekday: number[]
  /** 24 counts, midnight first */
  byHour: number[]
  longestStreakDays: number
  /**
   * The local calendar day with the most messages, and how many. Ties go to the earliest such day. Optional: links made
   * before it existed have none, and a wrap with no messages has none.
   */
  busiestDay?: { date: string; messages: number }
  /** longest gap between two messages, in whole 24-hour days (rounded down) */
  longestSilenceDays: number
  /** share of each person's messages sent between 12 and 5 AM */
  lateNightShareByPerson: Record<string, number>
}

const LATE_NIGHT_END_HOUR = 5

export function timingStats(messages: Message[]): TimingStats {
  const content = contentMessages(messages).sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
  const byMonth = new Array<number>(12).fill(0)
  const byWeekday = new Array<number>(7).fill(0)
  const byHour = new Array<number>(24).fill(0)
  const totals: Record<string, number> = {}
  const late: Record<string, number> = {}

  for (const m of content) {
    byMonth[m.sentAt.getMonth()]! += 1
    byWeekday[m.sentAt.getDay()]! += 1
    byHour[m.sentAt.getHours()]! += 1
    increment(totals, m.senderId)
    if (m.sentAt.getHours() < LATE_NIGHT_END_HOUR) increment(late, m.senderId)
  }

  const lateNightShareByPerson: Record<string, number> = {}
  for (const [person, total] of Object.entries(totals)) lateNightShareByPerson[person] = (late[person] ?? 0) / total

  return {
    byMonth,
    byWeekday,
    byHour,
    longestStreakDays: longestStreak(content),
    longestSilenceDays: longestSilence(content),
    lateNightShareByPerson,
    ...busiestDay(content),
  }
}

/** Calendar day number in local time, so "a day" matches the phone's clock. */
export function dayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY)
}

/** A dayNumber back to its calendar date, 'YYYY-MM-DD'. */
export function dayString(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10)
}

/** Messages per local day; the busiest day wins, and of equally busy days the earliest. */
function busiestDay(content: Message[]): Pick<TimingStats, 'busiestDay'> {
  const perDay = new Map<number, number>()
  for (const m of content) {
    const day = dayNumber(m.sentAt)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
  }
  let best: [day: number, messages: number] | null = null
  for (const [day, messages] of perDay) {
    if (!best || messages > best[1] || (messages === best[1] && day < best[0])) best = [day, messages]
  }
  return best ? { busiestDay: { date: dayString(best[0]), messages: best[1] } } : {}
}

function longestStreak(sorted: Message[]): number {
  const days = [...new Set(sorted.map((m) => dayNumber(m.sentAt)))]
  let longest = days.length > 0 ? 1 : 0
  let run = 1
  for (let i = 1; i < days.length; i++) {
    run = days[i] === days[i - 1]! + 1 ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  return longest
}

function longestSilence(sorted: Message[]): number {
  let longest = 0
  for (let i = 1; i < sorted.length; i++) {
    longest = Math.max(longest, sorted[i]!.sentAt.getTime() - sorted[i - 1]!.sentAt.getTime())
  }
  return Math.floor(longest / DAY)
}
