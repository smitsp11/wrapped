import type { DbChat } from '../extract/messagesDb'
import type { Chat, Message } from '../types'
import { chatTitle, shortNames, type PersonName } from '../wrap/names'

/**
 * One group chat as you know it. Messages often keeps a group as several chat rows (members changed,
 * iMessage and SMS split, a new Mac), so a group is a set of rows: `chatIds`, oldest first.
 * `id` is the oldest row, `memberIds` everyone in any row, `messageCount` the rows' total.
 */
export type GroupChat = Chat & { chatIds: number[] }

export type RankedChat = { id: number; chatIds: number[]; title: string; messages: number; memberNames: string[] }

/** Rows with the same display name are one group when at least this share of their members are the same (Jaccard). */
const SAME_MEMBERS = 0.5

/**
 * Joins the rows that are one group, and drops non-group chats. Two rows are one group when:
 * - Apple links them: a shared group_id or original_group_id, or one's original_group_id is the other's group_id; or
 * - they have the same display name and mostly the same members (so two different "Family" chats stay apart); or
 * - neither has a name and their members are exactly the same (Messages titles both the same way anyway).
 * Members are handles (phone/email); a person on another handle in another row counts as someone else.
 */
export function mergeGroupChats(chats: (Chat & Partial<Pick<DbChat, 'groupId' | 'originalGroupId'>>)[]): GroupChat[] {
  const rows = chats.filter((c) => c.isGroup)
  const parent = rows.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)))
  const join = (a: number, b: number) => (parent[root(a)] = root(b))

  const firstWith = new Map<string, number>()
  const link = (key: string, i: number) => {
    const first = firstWith.get(key)
    if (first === undefined) firstWith.set(key, i)
    else join(i, first)
  }
  rows.forEach((c, i) => {
    for (const appleId of [c.groupId, c.originalGroupId]) if (appleId) link(`apple:${appleId}`, i)
    if (!c.name.trim() && c.memberIds.length > 0) link(`members:${[...c.memberIds].sort().join('\u001f')}`, i)
  })
  const byName = new Map<string, number[]>()
  rows.forEach((c, i) => {
    const name = c.name.trim()
    if (name) byName.set(name, [...(byName.get(name) ?? []), i])
  })
  for (const same of byName.values()) {
    for (let a = 0; a < same.length; a++) {
      for (let b = a + 1; b < same.length; b++) {
        if (overlap(rows[same[a]!]!.memberIds, rows[same[b]!]!.memberIds) >= SAME_MEMBERS) join(same[a]!, same[b]!)
      }
    }
  }

  const sets = new Map<number, Chat[]>()
  rows.forEach((c, i) => sets.set(root(i), [...(sets.get(root(i)) ?? []), c]))
  return [...sets.values()].map(toGroup).sort((a, b) => a.id - b.id)
}

/** Jaccard overlap of two member lists; 0 when both are empty (you left, so there's nothing to compare). */
function overlap(a: string[], b: string[]): number {
  const setA = new Set(a)
  const union = new Set([...a, ...b])
  const shared = [...new Set(b)].filter((m) => setA.has(m)).length
  return union.size === 0 ? 0 : shared / union.size
}

function toGroup(rows: Chat[]): GroupChat {
  const busiestFirst = [...rows].sort((a, b) => b.messageCount - a.messageCount || a.id - b.id)
  const chatIds = rows.map((c) => c.id).sort((a, b) => a - b)
  return {
    id: chatIds[0]!,
    chatIds,
    name: busiestFirst.find((c) => c.name.trim())?.name ?? '',
    isGroup: true,
    memberIds: [...new Set(busiestFirst.flatMap((c) => c.memberIds))],
    messageCount: rows.reduce((sum, c) => sum + c.messageCount, 0),
  }
}

/**
 * Messages from any row of a group, labelled with the group's id, so stats that go chat by chat
 * (conversations, replies, top chats) see one chat. A message joined to two rows of one group is kept once.
 */
export function oneChatPerGroup(messages: Message[], groups: GroupChat[]): Message[] {
  const groupOf = new Map(groups.flatMap((g) => g.chatIds.map((chatId) => [chatId, g.id] as const)))
  const seen = new Set<string>()
  const result: Message[] = []
  for (const m of messages) {
    const chatId = groupOf.get(m.chatId) ?? m.chatId
    const key = `${m.id}:${chatId}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(chatId === m.chatId ? m : { ...m, chatId })
  }
  return result
}

/** Group chats with messages in the period, busiest first (ties: older chat first). `counts` are per chat row. */
export function rankGroupChats(groups: GroupChat[], counts: Map<number, number>, personFor: (handle: string) => PersonName): RankedChat[] {
  return groups
    .map((g) => ({
      id: g.id,
      chatIds: g.chatIds,
      title: chatTitle(g, personFor),
      messages: g.chatIds.reduce((sum, chatId) => sum + (counts.get(chatId) ?? 0), 0),
      memberNames: shortNames(uniquePeople(g.memberIds.map(personFor))),
    }))
    .filter((g) => g.messages > 0)
    .sort((a, b) => b.messages - a.messages || a.id - b.id)
}

/** A person in two rows under a phone number and an email shows up once (by their full name). */
function uniquePeople(people: PersonName[]): PersonName[] {
  const byFullName = new Map<string, PersonName>()
  for (const person of people) if (!byFullName.has(person.full)) byFullName.set(person.full, person)
  return [...byFullName.values()]
}
