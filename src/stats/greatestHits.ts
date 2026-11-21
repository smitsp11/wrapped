import { looksLikeContactInfo } from '../cliHelpers'
import type { AttachmentKind, Message } from '../types'
import { contentMessages, conversations } from './conversation'

/** One message in the conversation around a hit. Reaction counts are left out when they are 0, to keep links short. */
export type ConvoMessage = {
  senderId: string
  /** the message; '' for a photo, video or attachment (see `media`) */
  text: string
  sentAt: string
  /** set when the message is an attachment with no text: the slide shows a placeholder, never the file */
  media?: AttachmentKind
  /** how many people reacted, laughed or hearted (each person once, never the sender) */
  reactions?: number
  laughs?: number
  hearts?: number
}

/**
 * The conversation a hit was sent in: up to MAX_CONVO_MESSAGES around it, oldest first. `hit` is its index in `messages`.
 * Solo wraps only (their hits come from many chats): `title` is the chat's name, and `people` names the senders who
 * aren't among the wrap's people.
 */
export type Convo = { messages: ConvoMessage[]; hit: number; title?: string; people?: Record<string, string> }

/** `conversation` is optional: links made before it existed have none. */
export type Hit = { senderId: string; text: string; sentAt: string; reactions: number; laughs: number; conversation?: Convo }

export const MIN_HIT_REACTIONS = 2
/** A message in a conversation is cut to this many characters, so one can't fill the link. */
export const MAX_QUOTE_LENGTH = 280
/**
 * Longer messages are never hits: a paragraph or an announcement isn't what people remember, and it would only fit
 * the slide cut down to a fraction of itself. So a hit is always whole in its conversation.
 */
export const MAX_HIT_LENGTH = 280
/** The Greatest hits slide and its saved image show about this many characters of a quote (see shortQuote). */
export const SHOWN_QUOTE_LENGTH = 120
/** The Greatest hits slide shows this many quotes, so only they carry a conversation into a link. */
export const SHOWN_HITS = 3
/** A conversation around a hit is cut to about this many messages, keeping more from before the hit than after. */
export const MAX_CONVO_MESSAGES = 30
const CONVO_BEFORE = 17

export type HitOptions = {
  limit?: number
  /** only this sender's messages can be hits (solo: "me"); everyone's reactions still count */
  from?: string
  /**
   * How many people are in each chat, you included, by chat id (solo: from each chat's members). A chat not listed
   * counts everyone seen sending or reacting in it.
   */
  chatSizes?: ReadonlyMap<number, number>
  /** group wraps: add the conversation each hit was sent in */
  withConversations?: boolean
  /**
   * Called with each hit's index, the messages its conversation shows (the same order as `conversation.messages`) and
   * the conversation itself. Nothing it sees changes the hit.
   */
  onConversation?: (hit: number, shown: Message[], conversation: Convo) => void
}

/**
 * The chat already voted on what was funny: rank text messages by the share of the chat that reacted, so 3 of 3 friends
 * beats 5 of 20. A message's score is its reactions ÷ the other people in its chat; ties go to more reactions, then the
 * earlier message. A group wrap is one chat, so there it's simply the most reactions.
 * Each person counts once per message, and reacting to your own message doesn't count. Messages longer than
 * MAX_HIT_LENGTH are skipped.
 * A custom emoji tapback (even a laughing one) isn't counted as a laugh in v1.
 */
export function greatestHits(messages: Message[], options: HitOptions = {}): Hit[] {
  const { limit = 10, withConversations = false, onConversation, from, chatSizes } = options
  const senderByGuid = new Map(contentMessages(messages).map((m) => [m.guid, m.senderId]))
  const reactors = new Map<string, Set<string>>()
  const laughers = new Map<string, Set<string>>()
  const lovers = new Map<string, Set<string>>()
  for (const r of messages) {
    if (!r.reactionType || !r.reactsToGuid) continue
    if (senderByGuid.get(r.reactsToGuid) === r.senderId) continue
    reactors.set(r.reactsToGuid, (reactors.get(r.reactsToGuid) ?? new Set()).add(r.senderId))
    if (r.reactionType === 'laugh') {
      laughers.set(r.reactsToGuid, (laughers.get(r.reactsToGuid) ?? new Set()).add(r.senderId))
    }
    if (r.reactionType === 'love') {
      lovers.set(r.reactsToGuid, (lovers.get(r.reactsToGuid) ?? new Set()).add(r.senderId))
    }
  }
  const count = (people: Map<string, Set<string>>, m: Message) => people.get(m.guid)?.size ?? 0

  const seen = new Map<number, Set<string>>()
  for (const m of messages) seen.set(m.chatId, (seen.get(m.chatId) ?? new Set()).add(m.senderId))
  const others = (chatId: number) => Math.max(1, (chatSizes?.get(chatId) ?? seen.get(chatId)?.size ?? 1) - 1)
  const score = (m: Message) => count(reactors, m) / others(m.chatId)

  const top = contentMessages(messages)
    .filter(
      (m) =>
        m.text &&
        Array.from(m.text).length <= MAX_HIT_LENGTH &&
        (from === undefined || m.senderId === from) &&
        count(reactors, m) >= MIN_HIT_REACTIONS,
    )
    .sort(
      (a, b) =>
        score(b) - score(a) || count(reactors, b) - count(reactors, a) || a.sentAt.getTime() - b.sentAt.getTime(),
    )
    .slice(0, limit)

  // Each conversation is only looked up for a hit, so the split is done once and only when asked for.
  const convoByGuid = new Map<string, Message[]>()
  if (withConversations) {
    const hitGuids = new Set(top.map((m) => m.guid))
    for (const convo of conversations(messages)) {
      for (const m of convo) if (hitGuids.has(m.guid)) convoByGuid.set(m.guid, convo)
    }
  }

  return top.map((m, index) => {
    const hit: Hit = {
      senderId: m.senderId,
      text: m.text!,
      sentAt: m.sentAt.toISOString(),
      reactions: count(reactors, m),
      laughs: count(laughers, m),
    }
    const convo = convoByGuid.get(m.guid)
    if (!convo) return hit
    // Messages that look like a phone number or email are left out. The hit itself always stays: if it looks like one,
    // the share step leaves out the whole quote, conversation and all.
    const shown = convo.filter((c) => c === m || (c.text ? !looksLikeContactInfo(c.text) : c.hasAttachment))
    const window = around(shown, shown.indexOf(m))
    const toConvoMessage = (c: Message): ConvoMessage => ({
      senderId: c.senderId,
      text: c.text ? quote(c.text) : '',
      sentAt: c.sentAt.toISOString(),
      ...(c.text ? {} : { media: c.attachmentKind ?? 'attachment' }),
      ...counted('reactions', count(reactors, c)),
      ...counted('laughs', count(laughers, c)),
      ...counted('hearts', count(lovers, c)),
    })
    const conversation = { messages: window.messages.map(toConvoMessage), hit: window.hit }
    onConversation?.(index, window.messages, conversation)
    return { ...hit, conversation }
  })
}

/** Long messages are cut so one can't fill the link. */
function quote(text: string): string {
  const chars = Array.from(text)
  return chars.length > MAX_QUOTE_LENGTH ? chars.slice(0, MAX_QUOTE_LENGTH).join('') + '…' : text
}

/**
 * A quote as the Greatest hits slide shows it: at most `max` characters, "…" included. A longer one is cut after its
 * last whole word (or mid-word, when that word is very long) and ends in "…". Counts whole code points, so an emoji is
 * never split in half. The conversation behind the quote still shows all of it.
 */
export function shortQuote(text: string, max = SHOWN_QUOTE_LENGTH): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  // One character more than fits: if it's a space, the word before it is whole.
  const head = chars.slice(0, max).join('')
  const space = head.search(/\s\S*$/)
  const cut = space >= head.length / 2 ? head.slice(0, space) : chars.slice(0, max - 1).join('')
  return cut.replace(/[\s.,;:…-]+$/u, '') + '…'
}

/** `{ [name]: n }`, or nothing when n is 0. */
function counted(name: 'reactions' | 'laughs' | 'hearts', n: number): Partial<Record<typeof name, number>> {
  return n > 0 ? { [name]: n } : {}
}

/**
 * At most MAX_CONVO_MESSAGES of `convo` around index `at`: CONVO_BEFORE before it and the rest after,
 * and when one side runs out, the other side gets the room. Returns the slice and where `at` landed in it.
 */
export function around<T>(convo: T[], at: number): { messages: T[]; hit: number } {
  const start = Math.min(Math.max(0, at - CONVO_BEFORE), Math.max(0, convo.length - MAX_CONVO_MESSAGES))
  return { messages: convo.slice(start, start + MAX_CONVO_MESSAGES), hit: at - start }
}
