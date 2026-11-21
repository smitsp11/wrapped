import type { Chat, Message } from '../types'
import { byCountThenKey, contentMessages, increment } from './conversation'
import { dayNumber, dayString } from './timing'

/**
 * Solo (My year) stats about one person at a time, counted over your 1:1 chat with them: their messages and yours.
 * Group chats don't count. "Who you text the most" does count a person's group messages, but month by month that lets
 * one busy group chat take over: on a real year, a group regular who never texted 1:1 won four months in a row, every
 * one of those messages from a group. Your 1:1 chat is who you actually talked to. Otherwise it counts like that slide:
 * real messages (no reactions), and one handle is one person.
 */
export type PersonalStats = {
  /** 12 handles, January first (local time): who you exchanged the most 1:1 messages with that month; null for a month with none */
  topPersonByMonth: (string | null)[]
  /** the longest run of consecutive local days with at least one 1:1 message with one person (either way), and its first day */
  personStreak: { person: string; days: number; from: string } | null
}

/**
 * chat id → the other person, for 1:1 chats (exactly one member). Group chats have no partner, and neither does a chat
 * with yourself (its member is one of `ownHandles`, the numbers and emails you send from), so you're never your own person.
 */
export function dmPartners(chats: Chat[], ownHandles: readonly string[] = []): Map<number, string> {
  const own = new Set(ownHandles.map((h) => h.toLowerCase()))
  return new Map(
    chats
      .filter((c) => !c.isGroup && c.memberIds.length === 1 && !own.has(c.memberIds[0]!.toLowerCase()))
      .map((c) => [c.id, c.memberIds[0]!]),
  )
}

/**
 * Ties, both stats: the person you exchanged more 1:1 messages with over the whole period wins, then the smaller handle
 * (so the result never depends on message order). A person's streak is their earliest run of their longest length.
 */
export function personalStats(messages: Message[], partners: Map<number, string>): PersonalStats {
  const yearly: Record<string, number> = {}
  const monthly = Array.from({ length: 12 }, () => ({}) as Record<string, number>)
  const days = new Map<string, Set<number>>()
  for (const m of contentMessages(messages)) {
    const person = partners.get(m.chatId)
    if (person === undefined) continue
    increment(yearly, person)
    increment(monthly[m.sentAt.getMonth()]!, person)
    const set = days.get(person) ?? new Set<number>()
    set.add(dayNumber(m.sentAt))
    days.set(person, set)
  }
  const rank = byCountThenKey(yearly)

  const topPersonByMonth = monthly.map((counts) => {
    const people = Object.keys(counts)
    if (people.length === 0) return null
    return people.sort((a, b) => counts[b]! - counts[a]! || rank(a, b))[0]!
  })

  let personStreak: PersonalStats['personStreak'] = null
  for (const person of [...days.keys()].sort(rank)) {
    const run = longestRun(days.get(person)!)
    if (!personStreak || run.days > personStreak.days) personStreak = { person, days: run.days, from: dayString(run.from) }
  }
  return { topPersonByMonth, personStreak }
}

/** The longest run of consecutive day numbers; of equal runs, the earliest. `days` is non-empty. */
function longestRun(days: Set<number>): { days: number; from: number } {
  const sorted = [...days].sort((a, b) => a - b)
  let best = { days: 1, from: sorted[0]! }
  let start = sorted[0]!
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1]! + 1) start = sorted[i]!
    const length = sorted[i]! - start + 1
    if (length > best.days) best = { days: length, from: start }
  }
  return best
}
