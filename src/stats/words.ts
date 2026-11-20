import type { Message } from '../types'
import { bump, byCountThenKey, contentMessages } from './conversation'
import { GLUE_WORDS, LAUGHTER, STOPWORDS } from './stopwords'

export type WordStats = {
  /** single words and 2-3 word phrases ("super calm"), most distinctive first */
  topWords: { word: string; count: number }[]
  topEmoji: { emoji: string; count: number }[]
  /** a word or a phrase */
  signatureWordByPerson: Record<string, string>
  /** only the length is kept, never the text; counted in code points, links not counted */
  longestMessage: { senderId: string; length: number } | null
}

export const TOP_LIMIT = 10
export const MIN_TOP_COUNT = 5
const MAX_PHRASE_WORDS = 3
const PHRASE_WEIGHT = 2
export const MIN_SIGNATURE_COUNT = 5
/** how strongly distinctiveness leans toward a word's overall frequency */
const PRIOR_WEIGHT = 1000

const LINK = /\b(?:https?:\/\/|www\.)\S+/gi
// links typed without http or www ("insta.com/x", "uoft.ca") and emails
const BARE_LINK = /\b[\w-]+(?:\.[\w-]+)*\.(?:com|ca|org|net|io|ai|app|co|gg|ly|me|tv|dev|edu|gov|uk|us)\b\S*/gi
const EMAIL = /\S+@\S+/g
// a letter written 3+ times in a row, as in "heyyy" or "sooo"
const STRETCHED = /(\p{L})\1\1/u
const STRETCHED_RUN = /(\p{L})\1{2,}/gu
const MIN_WORD_LENGTH = 3
// Phrases never run across a sentence break.
const CLAUSE_BREAK = /[.!?,;:\n]+/
// Languages written without spaces (Chinese, Japanese, Thai) stay one token in v1.
const WORD = /[\p{L}\p{M}\p{N}']+/gu
// \uFE0F catches keycaps and emoji-style symbols; plain symbols like (c) and (tm) are not emoji.
const EMOJI = /\p{Emoji_Presentation}|\uFE0F/u
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })

/** Lowercase text without links or emails, with straight apostrophes (iPhone text uses curly ones). */
function clean(text: string): string {
  const cleaned = text.replace(LINK, ' ').replace(EMAIL, ' ').replace(BARE_LINK, ' ')
  return cleaned.normalize('NFC').replace(/[\u2018\u2019\u02BC]/g, "'").toLowerCase()
}

function words(text: string): string[] {
  return (text.match(WORD) ?? []).map((w) => w.replace(/^'+|'+$/g, ''))
}

/** The meaningful single words of a message. */
export function tokenize(text: string): string[] {
  return words(clean(text))
    .map((w) => (STOPWORDS.has(w) ? w : w.replace(/'s$/, ''))) // "dealer's" → "dealer"
    .filter(isMeaningful)
}

/**
 * The 2- and 3-word phrases of a message, in order, never across a sentence break. Stopwords may be in
 * a phrase ("super calm"), but it can't start or end with glue ("i think", "in the", "going to"),
 * and laughter or one word said over and over ("lol lol") isn't a phrase.
 */
export function phrases(text: string): string[] {
  const result: string[] = []
  for (const clause of clean(text).split(CLAUSE_BREAK)) {
    const list = words(clause)
    for (let n = 2; n <= MAX_PHRASE_WORDS; n++) {
      for (let i = 0; i + n <= list.length; i++) {
        const phrase = list.slice(i, i + n)
        if (isPhrase(phrase)) result.push(phrase.join(' '))
      }
    }
  }
  return result
}

function isPhrase(phrase: string[]): boolean {
  const edge = (w: string) => w.length >= MIN_WORD_LENGTH && !GLUE_WORDS.has(w)
  return (
    edge(phrase[0]!) &&
    edge(phrase[phrase.length - 1]!) &&
    phrase.every((w) => /^\p{L}/u.test(w) && !LAUGHTER.test(w)) &&
    new Set(phrase).size > 1
  )
}

/** Single words and phrases: everything that can be a top word or a signature word. */
function terms(text: string): string[] {
  return [...tokenize(text), ...phrases(text)]
}

const isPhraseKey = (term: string) => term.includes(' ')

/**
 * A phrase is said far less often than a single word, and both distinctiveness and counts grow with how
 * often something is said, so a phrase's score counts double: a real catchphrase ("super calm") can then beat a word.
 */
const weight = (term: string) => (isPhraseKey(term) ? PHRASE_WEIGHT : 1)

/** Drops short words, numbers ("2026", "7pm"), laughter and stopwords, including stretched ones ("yesss"). */
function isMeaningful(word: string): boolean {
  if (word.length < MIN_WORD_LENGTH || !/^\p{L}/u.test(word) || LAUGHTER.test(word) || STOPWORDS.has(word)) return false
  if (!STRETCHED.test(word)) return true
  const once = word.replace(STRETCHED_RUN, '$1')
  const twice = word.replace(STRETCHED_RUN, '$1$1')
  return once.length >= MIN_WORD_LENGTH && !LAUGHTER.test(once) && !STOPWORDS.has(once) && !STOPWORDS.has(twice)
}

export function emojis(text: string): string[] {
  if (!EMOJI.test(text)) return []
  return [...graphemes.segment(text)].map((s) => s.segment).filter((g) => EMOJI.test(g))
}

export type WordCounts = Map<string, number>

export type WordOptions = {
  /**
   * Word counts (from countWords) for every chat in the same period, these messages included.
   * With it, top words are the ones this chat uses far more than your other chats, not just the most common.
   */
  baseline?: WordCounts
  /** the names of the people in the wrap ("Alex Chen"); their parts are never top or signature words */
  names?: readonly string[]
}

/** Every meaningful word and phrase in these messages, counted. Used as the baseline for a group wrap. */
export function countWords(messages: Message[]): WordCounts {
  const counts: WordCounts = new Map()
  for (const m of contentMessages(messages)) if (m.text) for (const term of terms(m.text)) bump(counts, term)
  return counts
}

export function wordStats(messages: Message[], { baseline, names = [] }: WordOptions = {}): WordStats {
  const hidden = new Set(names.flatMap((name) => tokenize(name)))
  const isName = (word: string) => hidden.has(word) || hidden.has(word.replace(/s$/, ''))
  const rawTotals: WordCounts = new Map()
  const emojiTotals = new Map<string, number>()
  const rawByPerson = new Map<string, WordCounts>()
  let longestMessage: WordStats['longestMessage'] = null

  for (const m of contentMessages(messages)) {
    if (!m.text) continue
    const personWords = rawByPerson.get(m.senderId) ?? new Map<string, number>()
    for (const term of terms(m.text)) {
      if (term.split(' ').some(isName)) continue
      bump(rawTotals, term)
      bump(personWords, term)
    }
    rawByPerson.set(m.senderId, personWords)
    for (const emoji of emojis(m.text)) bump(emojiTotals, emoji)

    const length = [...m.text.replace(LINK, ' ').trim()].length
    if (length === 0) continue
    if (!longestMessage || length > longestMessage.length) longestMessage = { senderId: m.senderId, length }
  }

  const merge = mergeVariants(rawTotals)
  const totals = merge(rawTotals)
  const byPerson = new Map([...rawByPerson].map(([person, words]) => [person, merge(words)]))
  const special = specialToThisChat(totals, baseline ? merge(baseline) : undefined)
  return {
    topWords: topWords(totals, byPerson, special),
    topEmoji: top(emojiTotals).map(([emoji, count]) => ({ emoji, count })),
    signatureWordByPerson: signatureWords(byPerson, totals, special),
    longestMessage,
  }
}

/**
 * Returns a function that folds plurals into their singular ("rebuys" → "rebuy") and drops misspellings
 * of a stopword or of a much more common word ("pokre", "definately"), decided from these counts.
 */
function mergeVariants(totals: WordCounts): (counts: WordCounts) => WordCounts {
  const canonical = new Map<string, string | null>()
  for (const [word, count] of totals) {
    if (isPhraseKey(word)) continue
    const singular = word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : ''
    if (singular.length >= MIN_WORD_LENGTH && totals.has(singular)) canonical.set(word, singular)
    else if (count >= MIN_TOP_COUNT && isMisspelling(word, count, totals)) canonical.set(word, null)
  }
  return (counts) => {
    const merged: WordCounts = new Map()
    for (const [word, count] of counts) {
      const into = canonical.has(word) ? canonical.get(word) : word
      if (into) merged.set(into, (merged.get(into) ?? 0) + count)
    }
    return merged
  }
}

/**
 * A letter missing, extra or swapped ("definatly", "pokre") from a stopword or from a word used 3x as often.
 * Only words of 5+ letters: shorter ones are too often a real word one letter from another ("ball", "call").
 * A wrong letter isn't counted as a slip for the same reason ("betting", "getting").
 */
function isMisspelling(word: string, count: number, totals: WordCounts): boolean {
  if (word.length < MIN_SLIP_LENGTH) return false
  return slips(word).some(
    (other) => other.length >= MIN_SLIP_LENGTH && (STOPWORDS.has(other) || (totals.get(other) ?? 0) >= 3 * count),
  )
}

const MIN_SLIP_LENGTH = 5
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'

/** Every spelling one missing, extra or swapped letter away. */
function slips(word: string): string[] {
  const result: string[] = []
  for (let i = 0; i <= word.length; i++) {
    const before = word.slice(0, i)
    const after = word.slice(i)
    if (after) result.push(before + after.slice(1))
    if (after.length > 1 && after[0] !== after[1]) result.push(before + after[1] + after[0] + after.slice(2))
    for (const letter of LETTERS) result.push(before + letter + after)
  }
  return result
}

/**
 * Scores how much more this chat uses each word than the rest of the baseline (positive = more).
 * Null without a baseline, or when the baseline has nothing beyond this chat.
 */
function specialToThisChat(totals: WordCounts, baseline?: WordCounts): ((word: string) => number) | null {
  const elsewhere: WordCounts = new Map()
  for (const [word, count] of baseline ?? []) {
    const rest = count - (totals.get(word) ?? 0)
    if (rest > 0) elsewhere.set(word, rest)
  }
  return elsewhere.size > 0 ? distinctiveness(totals, elsewhere) : null
}

/**
 * The words and phrases that make this chat this chat: used at least MIN_TOP_COUNT times, by at least two
 * people when more than one person wrote. Ranked by how much more this chat uses them than your other
 * chats; with nothing to compare with, by count, and then a phrase needs a word that isn't a stopword.
 * Either way a phrase's score counts double (see weight).
 */
function topWords(
  totals: WordCounts,
  byPerson: Map<string, WordCounts>,
  special: ((word: string) => number) | null,
): WordStats['topWords'] {
  const writers = [...byPerson.values()].filter((words) => words.size > 0)
  const usedBy = (word: string) => writers.filter((words) => words.has(word)).length
  const candidates = [...totals.keys()].filter(
    (term) =>
      totals.get(term)! >= MIN_TOP_COUNT &&
      (writers.length < 2 || usedBy(term) >= 2) &&
      (special || !isPhraseKey(term) || term.split(' ').some((w) => !STOPWORDS.has(w))),
  )
  const score = (term: string) => (special ? special(term) : totals.get(term)!) * weight(term)
  const ranked = candidates
    .filter((term) => score(term) > 0)
    .sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1))
  const picked: string[] = []
  for (const term of ranked) {
    if (picked.length === TOP_LIMIT) break
    if (!picked.some((other) => sameTerm(term, other, totals))) picked.push(term)
  }
  return picked.map((word) => ({ word, count: totals.get(word)! }))
}

/**
 * True when showing both would say one thing twice: one term sits inside the other ("calm" in "super calm")
 * and the longer accounts for at least half of the shorter one's uses, or two phrases are pieces of one
 * longer phrase ("stupid ideas" and "ideas hackathon").
 */
function sameTerm(a: string, b: string, totals: WordCounts): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (` ${long} `.includes(` ${short} `)) return totals.get(long)! * 2 >= totals.get(short)!
  return overlaps(a.split(' '), b.split(' ')) || overlaps(b.split(' '), a.split(' '))
}

/** True when the end of phrase `a` is the start of phrase `b`. */
function overlaps(a: string[], b: string[]): boolean {
  for (let k = 1; k < Math.min(a.length, b.length); k++) {
    if (a.slice(-k).join(' ') === b.slice(0, k).join(' ')) return true
  }
  return false
}

/**
 * How much more often a word shows up in `here` than in `there`: the z-score of the log-odds ratio,
 * smoothed toward how common the word is overall (Monroe et al. 2008, "Fightin' Words").
 * Unlike a plain ratio, a word seen a handful of times can't outscore one seen hundreds of times
 * unless the gap is far bigger, so one-offs and typos don't win.
 */
function distinctiveness(here: WordCounts, there: WordCounts): (word: string) => number {
  const hereTotal = sum(here)
  const thereTotal = sum(there)
  return (word) => {
    const a = here.get(word) ?? 0
    const b = there.get(word) ?? 0
    const prior = (PRIOR_WEIGHT * (a + b)) / (hereTotal + thereTotal)
    const logOdds = (n: number, total: number) => Math.log((n + prior) / (total + PRIOR_WEIGHT - n - prior))
    const delta = logOdds(a, hereTotal) - logOdds(b, thereTotal)
    return delta / Math.sqrt(1 / (a + prior) + 1 / (b + prior))
  }
}

/**
 * A person's signature word is the one they use most out of proportion to everyone else in the chat,
 * scored like top words (person vs the rest of the chat) and used at least MIN_SIGNATURE_COUNT times.
 * Someone else must have said it too, so a personal typo never wins, and with a baseline it must be
 * special to this chat, so an everyday word someone happens to say a lot doesn't win either.
 */
function signatureWords(
  byPerson: Map<string, WordCounts>,
  totals: WordCounts,
  special: ((word: string) => number) | null,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [person, words] of byPerson) {
    const others: WordCounts = new Map()
    for (const [word, count] of totals) {
      const rest = count - (words.get(word) ?? 0)
      if (rest > 0) others.set(word, rest)
    }
    if (others.size === 0) continue
    const score = distinctiveness(words, others)
    let best: { word: string; score: number } | null = null
    for (const [word, count] of words) {
      if (count < MIN_SIGNATURE_COUNT || !others.has(word) || (special && special(word) <= 0)) continue
      const s = score(word) * weight(word)
      if (s > 0 && (!best || s > best.score || (s === best.score && word < best.word))) best = { word, score: s }
    }
    if (best) result[person] = best.word
  }
  return result
}

function sum(counts: Map<string, number>): number {
  let total = 0
  for (const n of counts.values()) total += n
  return total
}

function top(counts: Map<string, number>): [string, number][] {
  return [...counts.keys()].sort(byCountThenKey(counts)).slice(0, TOP_LIMIT).map((key) => [key, counts.get(key)!])
}
