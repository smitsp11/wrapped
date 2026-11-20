import type { Wrap } from '../types'

/**
 * Your texting personality on the share card: one archetype picked from your own numbers in a solo wrap.
 * Rules only, no AI. The rules are checked in order and the first one that holds wins; The Yapper is the default.
 * Every rule reads stats the wrap already has for "me", and never anyone else's name or words.
 */
export type PersonalityId =
  | 'night-shift'
  | 'speed-demon'
  | 'starter'
  | 'double-texter'
  | 'hype-machine'
  | 'essayist'
  | 'group-chat-glue'
  | 'yapper'

export type Personality = { id: PersonalityId; name: string; line: string }

const ME = 'me'

/** The Night Shift: at least this share of your messages were sent between 12 and 5 AM. */
export const NIGHT_SHIFT_MIN_SHARE = 0.2
/**
 * Speed Demon: you typically (median) join a conversation someone else started in under this many minutes…
 * Timed from the conversation's first message, so even quick people rarely manage under a minute; 5 is fast.
 */
export const SPEED_DEMON_MAX_MINUTES = 5
/** …over at least this many conversations joined, so a few quick ones don't count (the same bar as The Ghost). */
export const SPEED_DEMON_MIN_REPLIES = 10
/** The Starter: you started at least this share of all the conversations in the wrap… */
export const STARTER_MIN_SHARE = 0.5
/** …and at least this many of them. */
export const STARTER_MIN_STARTS = 10
/** Double Texter: at least this share of your messages were double texts… */
export const DOUBLE_TEXTER_MIN_RATE = 0.05
/** …and at least this many of them. */
export const DOUBLE_TEXTER_MIN_COUNT = 10
/** Hype Machine: you gave at least this many reactions per message you sent… */
export const HYPE_MIN_REACTIONS_PER_MESSAGE = 0.25
/** …and at least this many reactions. */
export const HYPE_MIN_REACTIONS = 20
/** The Essayist: your longest message has at least this many characters (the wrap keeps only its length). */
export const ESSAYIST_MIN_CHARS = 1000
/** Group Chat Glue: the wrap has this many top chats (its maximum)… */
export const GLUE_MIN_CHATS = 5
/** …and the busiest one has under this share of all messages, so your texting is spread across them. */
export const GLUE_MAX_TOP_CHAT_SHARE = 0.35

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  'night-shift': { id: 'night-shift', name: 'The Night Shift', line: 'Does their best texting after midnight.' },
  'speed-demon': { id: 'speed-demon', name: 'Speed Demon', line: 'Replies before you can lock your phone.' },
  starter: { id: 'starter', name: 'The Starter', line: 'Always the one who texts first.' },
  'double-texter': { id: 'double-texter', name: 'Double Texter', line: 'One message is never enough.' },
  'hype-machine': { id: 'hype-machine', name: 'Hype Machine', line: 'Never leaves a text without a reaction.' },
  essayist: { id: 'essayist', name: 'The Essayist', line: 'Why send a text when you can send a paragraph?' },
  'group-chat-glue': { id: 'group-chat-glue', name: 'Group Chat Glue', line: 'Keeps every chat alive.' },
  yapper: { id: 'yapper', name: 'The Yapper', line: 'Simply has a lot to say.' },
}

/** A count from a stats record, 0 when missing (own properties only, so "toString" finds nothing). */
function countOf(record: Record<string, number>, id: string): number {
  return Object.hasOwn(record, id) ? record[id]! : 0
}

function sum(record: Record<string, number>): number {
  return Object.values(record).reduce((total, n) => total + n, 0)
}

/** The rules in priority order: the rarer, more specific ones first. */
const RULES: { id: PersonalityId; holds: (wrap: Wrap) => boolean }[] = [
  {
    id: 'night-shift',
    holds: (w) => countOf(w.timing.lateNightShareByPerson, ME) >= NIGHT_SHIFT_MIN_SHARE,
  },
  {
    id: 'speed-demon',
    holds: (w) =>
      countOf(w.replies.repliesByPerson, ME) >= SPEED_DEMON_MIN_REPLIES &&
      countOf(w.replies.medianReplyMinutesByPerson, ME) < SPEED_DEMON_MAX_MINUTES,
  },
  {
    id: 'starter',
    holds: (w) => {
      const mine = countOf(w.starters.startsByPerson, ME)
      return mine >= STARTER_MIN_STARTS && mine / sum(w.starters.startsByPerson) >= STARTER_MIN_SHARE
    },
  },
  {
    id: 'double-texter',
    holds: (w) => {
      const doubles = countOf(w.starters.doubleTextsByPerson, ME)
      const sent = countOf(w.volume.byPerson, ME)
      return doubles >= DOUBLE_TEXTER_MIN_COUNT && doubles / Math.max(sent, 1) >= DOUBLE_TEXTER_MIN_RATE
    },
  },
  {
    id: 'hype-machine',
    holds: (w) => {
      const given = countOf(w.reactions.givenByPerson, ME)
      const sent = countOf(w.volume.byPerson, ME)
      return given >= HYPE_MIN_REACTIONS && given / Math.max(sent, 1) >= HYPE_MIN_REACTIONS_PER_MESSAGE
    },
  },
  {
    id: 'essayist',
    holds: (w) => w.words.longestMessage?.senderId === ME && w.words.longestMessage.length >= ESSAYIST_MIN_CHARS,
  },
  {
    id: 'group-chat-glue',
    holds: (w) => {
      if (w.topChats.length < GLUE_MIN_CHATS || w.volume.total === 0) return false
      const busiest = Math.max(...w.topChats.map((c) => c.messages))
      return busiest / w.volume.total < GLUE_MAX_TOP_CHAT_SHARE
    },
  },
]

/** Your personality from a solo wrap: the first rule that holds, or The Yapper. */
export function personalityFor(solo: Wrap): Personality {
  const rule = RULES.find((r) => r.holds(solo))
  return PERSONALITIES[rule?.id ?? 'yapper']
}
