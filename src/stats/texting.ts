import type { Message } from '../types'
import { conversations, median } from './conversation'

/**
 * How each person texts, for the group wrap's "Texting styles" slide (labels in src/wrap/textingStyles.ts).
 * Only people with at least MIN_TEXTS texts are measured; everyone else is left out of both records.
 */
export type TextingStats = {
  /** the median number of words in one of their texts (a half when the count of texts is even) */
  medianWordsByPerson: Record<string, number>
  /** messages per turn: how many they send in a row before someone else speaks, on average, to one decimal */
  textsPerTurnByPerson: Record<string, number>
}

/** A person needs at least this many texts (messages with text; photos alone and reactions don't count) to be measured. */
export const MIN_TEXTS = 20

/** A word is a run of non-space characters with at least one letter or digit in it, so "k." is a word and "😂" isn't. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length
}

/** The text of a message without the placeholder Messages puts where an attachment sits, or null if nothing's left. */
function textOf(m: Message): string | null {
  const text = m.text?.replace(/￼/g, '').trim()
  return text ? text : null
}

/**
 * Turns: a turn is a run of one person's messages in a conversation (see `conversations`) until someone else sends one.
 * Every real message counts toward a turn, photos included; reactions don't, so they never interrupt a run.
 */
export function textingStats(messages: Message[]): TextingStats {
  const words = new Map<string, number[]>()
  const sent = new Map<string, number>()
  const turns = new Map<string, number>()
  for (const conversation of conversations(messages)) {
    conversation.forEach((m, i) => {
      sent.set(m.senderId, (sent.get(m.senderId) ?? 0) + 1)
      if (conversation[i - 1]?.senderId !== m.senderId) turns.set(m.senderId, (turns.get(m.senderId) ?? 0) + 1)
      const text = textOf(m)
      if (text === null) return
      const list = words.get(m.senderId) ?? []
      list.push(wordCount(text))
      words.set(m.senderId, list)
    })
  }
  const medianWordsByPerson: Record<string, number> = {}
  const textsPerTurnByPerson: Record<string, number> = {}
  for (const [id, counts] of words) {
    if (counts.length < MIN_TEXTS) continue
    medianWordsByPerson[id] = median(counts)
    textsPerTurnByPerson[id] = Math.round((sent.get(id)! / turns.get(id)!) * 10) / 10
  }
  return { medianWordsByPerson, textsPerTurnByPerson }
}
