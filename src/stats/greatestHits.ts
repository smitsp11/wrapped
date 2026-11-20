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

/** The conversation a hit was sent in: up to MAX_CONVO_MESSAGES around it, oldest first. `hit` is its index in `messages`. */
export type Convo = { messages: ConvoMessage[]; hit: number }

/** `conversation` is optional: solo wraps never have one, and links made before it existed don't either. */
export type Hit = { senderId: string; text: string; sentAt: string; reactions: number; laughs: number; conversation?: Convo }

export const MIN_HIT_REACTIONS = 2
export const MAX_QUOTE_LENGTH = 280
/** The Greatest hits slide shows this many quotes, so only they carry a conversation into a link. */
export const SHOWN_HITS = 3
/** A conversation around a hit is cut to about this many messages, keeping more from before the hit than after. */
export const MAX_CONVO_MESSAGES = 30
const CONVO_BEFORE = 17

export type HitOptions = {
  limit?: number
  /** group wraps: add the conversation each hit was sent in */
  withConversations?: boolean
}

/**
 * The group already voted on what was funny: rank text messages by their reactions.
 * Each person counts once per message, and reacting to your own message doesn't count.
 * A custom emoji tapback (even a laughing one) isn't counted as a laugh in v1.
 */
export function greatestHits(messages: Message[], options: HitOptions = {}): Hit[] {
  const { limit = 10, withConversations = false } = options
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

  const top = contentMessages(messages)
    .filter((m) => m.text && count(reactors, m) >= MIN_HIT_REACTIONS)
    .sort(
      (a, b) =>
        count(reactors, b) - count(reactors, a) ||
        count(laughers, b) - count(laughers, a) ||
        a.sentAt.getTime() - b.sentAt.getTime(),
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

  return top.map((m) => {
    const hit: Hit = {
      senderId: m.senderId,
      text: quote(m.text!),
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
    return { ...hit, conversation: { messages: window.messages.map(toConvoMessage), hit: window.hit } }
  })
}

/** Long messages are cut so one can't fill the link. */
function quote(text: string): string {
  const chars = Array.from(text)
  return chars.length > MAX_QUOTE_LENGTH ? chars.slice(0, MAX_QUOTE_LENGTH).join('') + '…' : text
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
