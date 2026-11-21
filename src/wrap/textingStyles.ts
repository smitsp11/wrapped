import type { Wrap } from '../types'

/**
 * Each group member's texting style, for the "Texting styles" slide: one label per person from two numbers the wrap keeps
 * (see src/stats/texting.ts): their median words per text, and how many texts they send per turn.
 * Rules only, no AI. They're checked in order and the first that holds wins; Perfectly Balanced is everyone in the middle.
 * People with fewer than MIN_TEXTS texts aren't measured, so they get no style.
 */
export type TextingStyleId = 'paragraph-texter' | 'spray-n-pray' | 'nonchalant' | 'one-and-done' | 'balanced'

export type TextingStyle = { id: TextingStyleId; name: string; line: string }

/** Paragraph Texter: their typical (median) text is at least this many words, a short paragraph. */
export const PARAGRAPH_TEXTER_MIN_WORDS = 15
/** Spray n Pray: they send at least this many texts per turn, on average, before anyone else speaks. */
export const SPRAY_N_PRAY_MIN_PER_TURN = 3
/** Nonchalant: their typical (median) text is at most this many words ("k.", "omw", "😂"). */
export const NONCHALANT_MAX_WORDS = 1
/** One and Done: at most this many texts per turn, so a second text in a row is rare (1 turn in 20 or fewer). */
export const ONE_AND_DONE_MAX_PER_TURN = 1.05

export type StyledPerson = { personId: string; style: TextingStyle; medianWords: number; textsPerTurn: number }

/** The style for one person's numbers. Paragraphs beat bursts (they're rarer), and bursts beat one-word texts. */
export function textingStyleFor(medianWords: number, textsPerTurn: number): TextingStyle {
  if (medianWords >= PARAGRAPH_TEXTER_MIN_WORDS) {
    return { id: 'paragraph-texter', name: 'Paragraph Texter', line: `Paragraphs only. ~${Math.round(medianWords)} words a text.` }
  }
  if (textsPerTurn >= SPRAY_N_PRAY_MIN_PER_TURN) {
    return { id: 'spray-n-pray', name: 'Spray n Pray', line: `${Math.round(textsPerTurn)} texts in a row, every time.` }
  }
  if (medianWords <= NONCHALANT_MAX_WORDS) return { id: 'nonchalant', name: 'Nonchalant', line: '“k.” is a full sentence.' }
  if (textsPerTurn <= ONE_AND_DONE_MAX_PER_TURN) {
    return { id: 'one-and-done', name: 'One and Done', line: 'Sends one text, then dips.' }
  }
  return { id: 'balanced', name: 'Perfectly Balanced', line: 'As all texts should be.' }
}

/** Everyone the wrap measured, with their style, busiest first. Old links have no texting stats, so nobody. */
export function textingStyles(wrap: Wrap): StyledPerson[] {
  if (!wrap.texting) return []
  const { medianWordsByPerson, textsPerTurnByPerson } = wrap.texting
  const sent = (id: string) => (Object.hasOwn(wrap.volume.byPerson, id) ? wrap.volume.byPerson[id]! : 0)
  return Object.keys(medianWordsByPerson)
    .filter((id) => Object.hasOwn(textsPerTurnByPerson, id))
    .sort((a, b) => sent(b) - sent(a))
    .map((personId) => {
      const medianWords = medianWordsByPerson[personId]!
      const textsPerTurn = textsPerTurnByPerson[personId]!
      return { personId, style: textingStyleFor(medianWords, textsPerTurn), medianWords, textsPerTurn }
    })
}
