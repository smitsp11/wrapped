import { pickAwards } from '../awards/rules'
import { EmptyPeriodError } from '../errors'
import { maskHandle } from '../format'
import { byCountThenKey, contentMessages, increment } from '../stats/conversation'
import { greatestHits, type Convo, type Hit } from '../stats/greatestHits'
import { dmPartners, personalStats } from '../stats/personal'
import { reactionStats } from '../stats/reactions'
import { replyStats } from '../stats/replies'
import { starterStats } from '../stats/starters'
import { textingStats } from '../stats/texting'
import { timingStats } from '../stats/timing'
import { volumeStats } from '../stats/volume'
import { type WordCounts, wordStats } from '../stats/words'
import { OTHERS_ID } from '../types'
import type { Chat, Message, Wrap } from '../types'

export type BuildOptions = {
  mode: 'group' | 'solo'
  title: string
  from: Date
  to: Date
  /** display name for a raw handle (only called for handles, never for "me") */
  nameFor: (handle: string) => string
  /** solo mode: chats with display names, for the top-chats slide */
  chats?: Chat[]
  /** group mode: countWords over every chat in the period, so top words are what's special to this chat */
  wordBaseline?: WordCounts
  /** names never shown as top or signature words (everyone in Contacts, and you), besides the people in the wrap */
  hiddenNames?: readonly string[]
  /**
   * For the maker's local preview: called with each hit's index in the wrap and the messages behind its conversation
   * (the same order as `conversation.messages`), so the app can find the photos. The wrap is the same either way.
   */
  onConversation?: (hit: number, shown: Message[]) => void
  /** the message total against the same dates a year earlier, already worked out (see lastYear.ts); left out when unknown */
  vsLastYear?: Wrap['vsLastYear']
  /** solo mode: the numbers and emails you send from (MessagesDb.ownHandles), so a chat with yourself is never your person */
  ownHandles?: readonly string[]
}

const TOP_CHATS = 5
/** Solo: your greatest hits come only from this many of your busiest group chats. */
const HIT_GROUP_CHATS = 5
const SOLO_TOP_PEOPLE = 5
/** stands in for "everyone outside your top contacts" until ids are assigned; cannot collide with a real handle */
const OTHERS_HANDLE = '\0others'

export function buildWrap(all: Message[], options: BuildOptions): Wrap {
  const inPeriod = all.filter((m) => m.sentAt >= options.from && m.sentAt < options.to)
  if (contentMessages(inPeriod).length === 0) throw new EmptyPeriodError(options.title)

  // A name that is just the handle (no contact found) is masked, so no phone number or email leaves this function.
  const display = (handle: string) => {
    const name = options.nameFor(handle)
    return name === handle ? maskHandle(handle) : name
  }

  // Phone numbers and emails never leave this function: people become "me", "p1", "p2"…
  // Solo wraps keep only your top contacts; everyone else is one person.
  const solo = options.mode === 'solo'
  // Grouping several people as one means reactions and replies between two of them aren't counted in solo stats;
  // that only affects "Everyone else", who never wins awards.
  const kept = solo ? topContacts(inPeriod) : null
  const grouped = kept ? inPeriod.map((m) => (m.senderId === 'me' || kept.has(m.senderId) ? m : { ...m, senderId: OTHERS_HANDLE })) : inPeriod
  const ids = assignPersonIds(grouped)
  const messages = grouped.map((m) => ({ ...m, senderId: ids.get(m.senderId)! }))
  const people: Record<string, string> = {}
  for (const [handle, id] of ids) people[id] = handle === 'me' ? 'You' : handle === OTHERS_HANDLE ? 'Everyone else' : display(handle)

  // Solo: may add people from outside your top contacts, so it comes before anything reads `people`.
  const yours = solo ? personal(inPeriod, dmPartners(options.chats ?? [], options.ownHandles), ids, people, display) : {}

  const volume = volumeStats(messages)
  const timing = timingStats(messages)
  const replies = replyStats(messages)
  const starters = starterStats(messages)
  const reactions = reactionStats(messages)

  // Solo: hits are your own messages, but everyone's reactions count, so rank over all messages with one id per person.
  // Both kinds carry the conversation around each hit.
  const hits = solo
    ? soloHits(inPeriod, ids, display, options.chats ?? [], options.onConversation)
    : greatestHits(messages, { withConversations: true, onConversation: options.onConversation })
  // "Everyone else" is a sum of many people, so it never competes for awards.
  const awards = pickAwards({ volume, timing, replies, starters, reactions }, options.mode, solo ? [OTHERS_ID] : [])

  return {
    version: 1,
    mode: options.mode,
    title: options.title,
    period: { from: localDate(options.from), to: localDate(options.to) },
    people,
    volume,
    timing,
    replies,
    starters,
    reactions,
    // Solo mode shows your own vocabulary, not words from everyone you texted.
    words: wordStats(solo ? messages.filter((m) => m.senderId === 'me') : messages, {
      baseline: solo ? undefined : options.wordBaseline,
      names: [...Object.values(people), ...(options.hiddenNames ?? [])],
    }),
    greatestHits: hits,
    awards,
    topChats: solo ? topChats(messages, options.chats ?? []) : [],
    // Group only: the solo share card has no room for it, and your style across every chat says less.
    ...(solo ? {} : { texting: textingStats(messages) }),
    ...yours,
    ...(options.vsLastYear ? { vsLastYear: options.vsLastYear } : {}),
  }
}

/**
 * Solo: your person each month and your longest streak with one person (see personalStats). Either may be someone
 * outside your top contacts (big for a month, then gone), so they get the next free id and a name in `people`.
 */
function personal(
  inPeriod: Message[],
  partners: Map<number, string>,
  ids: Map<string, string>,
  people: Record<string, string>,
  display: (handle: string) => string,
): Pick<Wrap, 'topPersonByMonth' | 'topPersonCountByMonth' | 'personStreak'> {
  const { topPersonByMonth, topPersonCountByMonth, personStreak } = personalStats(inPeriod, partners)
  const extra = new Map<string, string>()
  let next = [...ids.values()].filter((id) => /^p\d+$/.test(id)).length + 1
  const idFor = (handle: string) => {
    const known = ids.get(handle) ?? extra.get(handle)
    if (known) return known
    const id = `p${next++}`
    extra.set(handle, id)
    people[id] = display(handle)
    return id
  }
  const months = topPersonByMonth.map((handle) => (handle === null ? null : idFor(handle)))
  return {
    ...(months.some((id) => id !== null) ? { topPersonByMonth: months, topPersonCountByMonth } : {}),
    ...(personStreak ? { personStreak: { personId: idFor(personStreak.person), days: personStreak.days, from: personStreak.from } } : {}),
  }
}

/**
 * Your own most-reacted messages, each with the conversation it was sent in. They come only from your
 * HIT_GROUP_CHATS busiest group chats this year (ranked like the Top chats slide, so a 1:1 chat or a quiet group never
 * gives one). Ranking gives everyone their own id, so in a conversation your top people get their id in the wrap
 * (`wrapIds`) and anyone else a new one, named in the conversation's own `people`. Its `title` is the chat's name,
 * since a solo wrap's title is "Your 2026".
 */
function soloHits(
  inPeriod: Message[],
  wrapIds: Map<string, string>,
  display: (handle: string) => string,
  chats: Chat[],
  onConversation?: (hit: number, shown: Message[]) => void,
): Hit[] {
  const ids = assignPersonIds(inPeriod)
  const handleOf = new Map([...ids].map(([handle, id]) => [id, handle]))
  const shownFor = new Map<number, Message[]>()
  const groups = new Set(chats.filter((c) => c.isGroup).map((c) => c.id))
  const hitChats = new Set(
    chatsByMessages(inPeriod)
      .map(([chatId]) => chatId)
      .filter((chatId) => groups.has(chatId))
      .slice(0, HIT_GROUP_CHATS),
  )
  // Your own messages in those chats, ranked by the share of their chat who reacted (see greatestHits).
  const chatSizes = new Map(chats.filter((c) => c.memberIds.length > 0).map((c) => [c.id, c.memberIds.length + 1]))
  const ranked = greatestHits(relabel(inPeriod.filter((m) => hitChats.has(m.chatId)), ids), {
    from: 'me',
    chatSizes,
    withConversations: true,
    onConversation: (hit, shown) => shownFor.set(hit, shown),
  })
  const topIds = [...wrapIds.values()].filter((id) => /^p\d+$/.test(id)).length

  const inWrapTerms = (convo: Convo, shown: Message[]): Convo => {
    const people: Record<string, string> = {}
    const newIds = new Map<string, string>()
    const idFor = (rankedId: string) => {
      const handle = handleOf.get(rankedId)!
      const kept = wrapIds.get(handle)
      if (kept && kept !== OTHERS_ID) return kept
      let id = newIds.get(handle)
      if (!id) {
        id = `p${topIds + newIds.size + 1}`
        newIds.set(handle, id)
        people[id] = display(handle)
      }
      return id
    }
    const messages = convo.messages.map((m) => ({ ...m, senderId: idFor(m.senderId) }))
    const chatId = shown[convo.hit]!.chatId
    const title = chats.find((c) => c.id === chatId)?.name || 'A chat'
    return { messages, hit: convo.hit, title, ...(newIds.size > 0 ? { people } : {}) }
  }

  const hits: Hit[] = []
  ranked.forEach((hit, i) => {
    if (hit.senderId !== 'me') return
    const shown = shownFor.get(i)
    const index = hits.push(hit.conversation && shown ? { ...hit, conversation: inWrapTerms(hit.conversation, shown) } : hit) - 1
    if (shown) onConversation?.(index, shown)
  })
  return hits
}

function relabel(messages: Message[], ids: Map<string, string>): Message[] {
  return messages.map((m) => ({ ...m, senderId: ids.get(m.senderId)! }))
}

/** 'YYYY-MM-DD' in the local timezone. */
function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function countBySender(messages: Message[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const m of messages) increment(counts, m.senderId, m.reactionType === null ? 1 : 0)
  return counts
}

/** Solo mode: the handles of your SOLO_TOP_PEOPLE busiest contacts. */
function topContacts(messages: Message[]): Set<string> {
  const counts = countBySender(messages)
  return new Set(
    Object.keys(counts)
      .filter((handle) => handle !== 'me')
      .sort(byCountThenKey(counts))
      .slice(0, SOLO_TOP_PEOPLE),
  )
}

/** "me" stays "me"; everyone else gets p1, p2… ordered by how much they wrote (the solo "others" bucket keeps its own id). */
function assignPersonIds(messages: Message[]): Map<string, string> {
  const counts = countBySender(messages)
  const others = Object.keys(counts)
    .filter((handle) => handle !== 'me' && handle !== OTHERS_HANDLE)
    .sort(byCountThenKey(counts))
  const ids = new Map(others.map((handle, i) => [handle, `p${i + 1}`]))
  if ('me' in counts) ids.set('me', 'me')
  if (OTHERS_HANDLE in counts) ids.set(OTHERS_HANDLE, OTHERS_ID)
  return ids
}

/** Every chat id with how many messages were sent in it, busiest first; ties go to the lower chat id. */
function chatsByMessages(messages: Message[]): [chatId: number, messages: number][] {
  const counts = new Map<number, number>()
  for (const m of contentMessages(messages)) counts.set(m.chatId, (counts.get(m.chatId) ?? 0) + 1)
  return [...counts].sort(([idA, a], [idB, b]) => b - a || idA - idB)
}

function topChats(messages: Message[], chats: Chat[]): Wrap['topChats'] {
  return chatsByMessages(messages)
    .slice(0, TOP_CHATS)
    .map(([chatId, count]) => ({ name: chats.find((c) => c.id === chatId)?.name || 'A chat', messages: count }))
}
