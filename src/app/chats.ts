import type { Chat } from '../types'
import { chatTitle, shortNames, type PersonName } from '../wrap/names'

export type RankedChat = { id: number; title: string; messages: number; memberNames: string[] }

/** Group chats with messages in the period, busiest first (ties: older chat first). */
export function rankGroupChats(chats: Chat[], counts: Map<number, number>, personFor: (handle: string) => PersonName): RankedChat[] {
  return chats
    .filter((c) => c.isGroup && (counts.get(c.id) ?? 0) > 0)
    .map((c) => ({
      id: c.id,
      title: chatTitle(c, personFor),
      messages: counts.get(c.id) ?? 0,
      memberNames: shortNames(c.memberIds.map(personFor)),
    }))
    .sort((a, b) => b.messages - a.messages || a.id - b.id)
}
