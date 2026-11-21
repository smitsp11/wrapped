import { SHOWN_HITS, shortQuote } from '../../../src/stats/greatestHits'
import type { Wrap } from '../../../src/types'
import type { GroupCard, YouCard } from '../maker/youCard'
import { personName, plural, sentLabel } from '../slides'
import { SUMMARY_ID, summaryCardFor } from '../summary'

/**
 * What goes on the saved image of a slide ("save ↓" on the slide). Each kind is what its slide shows, as plain text,
 * so the drawing never decides what's on it. Pure, so it's unit-tested. To make another slide saveable, add a kind
 * here, a builder to BUILDERS and a drawer in drawSlideCard.ts.
 */
export type HitsCard = {
  kind: 'hits'
  /** "Poker Night · Wrapped 2026" */
  kicker: string
  /** as on the slide: the top SHOWN_HITS, without their conversations */
  quotes: { text: string; who: string; reactions: string; when: string }[]
}

export type WordsCard = {
  kind: 'words'
  kicker: string
  /** "The group's vocabulary" or "Your vocabulary" */
  heading: string
  /** most used first; count is formatted, e.g. "1,204" */
  words: { word: string; count: string }[]
  emoji: string[]
  /** "Alex Chen says" / "You say", and their word */
  signatures: { says: string; word: string }[]
}

export type AwardCard = {
  kind: 'award'
  kicker: string
  title: string
  year: string
  winner: string
  /** the number behind it, e.g. "29.1% of all messages" */
  label: string
}

/** The last page of My year: your personal share card, drawn by drawYouCard. */
export type YouSummaryCard = { kind: 'you'; card: YouCard }
/** The last page of a group wrap: the group's summary card, drawn by drawGroupCard. */
export type GroupSummaryCard = { kind: 'group'; card: GroupCard }

/** The cards drawn as a slide: a kicker, the slide's heading and its content (see drawSlideCard). */
export type PageContent = HitsCard | WordsCard | AwardCard
export type SlideContent = PageContent | YouSummaryCard | GroupSummaryCard

export type SlideCard = SlideContent & {
  /** what the saved file is called, e.g. "poker-night-greatest-hits.png" */
  fileName: string
}

/** The same caps as the words slide (see wordsSlide in slides.ts). */
const SHOWN_WORDS = 5
const SHOWN_EMOJI = 5
const MAX_SIGNATURES = 6

function kicker(wrap: Wrap): string {
  const year = wrap.period.from.slice(0, 4)
  // A solo wrap's title is already "Your 2026", so it isn't repeated.
  return wrap.mode === 'group' ? `${wrap.title} · Wrapped ${year}` : `Texts Wrapped ${year}`
}

function hitsCard(wrap: Wrap, slideId: string): HitsCard | null {
  if (slideId !== 'hits' || wrap.greatestHits.length === 0) return null
  return {
    kind: 'hits',
    kicker: kicker(wrap),
    quotes: wrap.greatestHits.slice(0, SHOWN_HITS).map((hit) => ({
      text: shortQuote(hit.text),
      who: personName(wrap, hit.senderId),
      reactions: plural(hit.reactions, 'reaction'),
      when: sentLabel(hit.sentAt),
    })),
  }
}

function wordsCard(wrap: Wrap, slideId: string): WordsCard | null {
  const { topWords, topEmoji, signatureWordByPerson } = wrap.words
  if (slideId !== 'words' || (topWords.length === 0 && topEmoji.length === 0)) return null
  const sent = (id: string) => (Object.hasOwn(wrap.volume.byPerson, id) ? wrap.volume.byPerson[id]! : 0)
  return {
    kind: 'words',
    kicker: kicker(wrap),
    heading: wrap.mode === 'group' ? "The group's vocabulary" : 'Your vocabulary',
    words: topWords
      .slice(0, SHOWN_WORDS)
      .sort((a, b) => b.count - a.count)
      .map((w) => ({ word: w.word, count: w.count.toLocaleString('en-US') })),
    emoji: topEmoji.slice(0, SHOWN_EMOJI).map((e) => e.emoji),
    signatures: Object.entries(signatureWordByPerson)
      .sort(([a], [b]) => sent(b) - sent(a))
      .slice(0, MAX_SIGNATURES)
      .map(([id, word]) => {
        const name = personName(wrap, id)
        return { says: id === 'me' && name === 'You' ? 'You say' : `${name} says`, word }
      }),
  }
}

function awardCard(wrap: Wrap, slideId: string): AwardCard | null {
  const award = wrap.awards.find((a) => `award-${a.id}` === slideId)
  if (!award) return null
  return {
    kind: 'award',
    kicker: kicker(wrap),
    title: award.title,
    year: wrap.period.from.slice(0, 4),
    winner: personName(wrap, award.personId),
    label: award.label,
  }
}

function summaryCard(wrap: Wrap, slideId: string): YouSummaryCard | GroupSummaryCard | null {
  return slideId === SUMMARY_ID ? summaryCardFor(wrap) : null
}

const BUILDERS: ((wrap: Wrap, slideId: string) => SlideContent | null)[] = [hitsCard, wordsCard, awardCard, summaryCard]

/** The image for a slide, or null when that slide can't be saved. */
export function slideCardFor(wrap: Wrap, slideId: string): SlideCard | null {
  for (const build of BUILDERS) {
    const content = build(wrap, slideId)
    if (content) return { ...content, fileName: fileNameFor(wrap, content) }
  }
  return null
}

/** Lowercase words joined by "-", letters and numbers only: "Poker Night 🃏" → "poker-night". */
function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
}

/**
 * "poker-night-greatest-hits.png", "poker-night-main-character.png", "my-texts-vocabulary.png", and for the last page
 * "poker-night-2026-in-texts.png" or "my-2026-in-texts.png" (the maker's name for your card).
 */
function fileNameFor(wrap: Wrap, card: SlideContent): string {
  if (card.kind === 'you') return `my-${slug(card.card.year) || 'year'}-in-texts.png`
  const what =
    card.kind === 'hits' ? 'greatest hits' : card.kind === 'words' ? 'vocabulary' : card.kind === 'group' ? `${card.card.year} in texts` : card.title
  const name = [slug(wrap.mode === 'group' ? wrap.title : 'my texts'), slug(what)].filter(Boolean).join('-')
  return `${name || 'wrapped'}.png`
}
