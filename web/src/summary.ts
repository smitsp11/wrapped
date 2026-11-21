/**
 * The page before the outro: a summary card to save and post. My year shows your personal share card (personality and
 * your own numbers, see maker/youCard.ts); a group wrap shows the chat's name, its total, its top word and a few award
 * winners. "save ↓" saves the same card, drawn on a canvas (see save/slideCards.ts). Pure (no DOM), like slides.ts.
 */
import type { Wrap } from '../../src/types'
import { type GroupCard, type YouCard, cardStats, groupAwardChip, groupCardStats, youCardFrom } from './maker/youCard'
import { escapeHtml, longestWord, periodLabel, personName, type Slide } from './slides'

/** The slide's id, so the save control finds its card. */
export const SUMMARY_ID = 'summary'
/** The group card shows this many award winners. */
export const SUMMARY_AWARDS = 3
/** The top word is picked from this many, most-used first, like the vocabulary page. */
const SHOWN_WORDS = 5

/** The group card's data from a group wrap. Pure, so it's unit-tested. */
export function groupCardFrom(wrap: Wrap): GroupCard {
  const topWord = wrap.words.topWords.slice(0, SHOWN_WORDS).sort((a, b) => b.count - a.count)[0]?.word
  const topEmoji = wrap.words.topEmoji[0]?.emoji
  return {
    year: wrap.period.from.slice(0, 4),
    title: wrap.title,
    period: periodLabel(wrap.period),
    messages: wrap.volume.total,
    ...(topWord ? { topWord } : {}),
    ...(topEmoji ? { topEmoji } : {}),
    awards: wrap.awards.slice(0, SUMMARY_AWARDS).map((a) => ({ title: a.title, winner: personName(wrap, a.personId) })),
  }
}

/** The data behind the summary page: your card in My year, the group's card in a group wrap. */
export function summaryCardFor(wrap: Wrap): { kind: 'you'; card: YouCard } | { kind: 'group'; card: GroupCard } {
  return wrap.mode === 'group' ? { kind: 'group', card: groupCardFrom(wrap) } : { kind: 'you', card: youCardFrom(wrap) }
}

/** The page: the card laid out like its saved image, a handwritten heading, a polaroid, taped notes and chips. */
export function summarySlide(wrap: Wrap): Slide {
  const summary = summaryCardFor(wrap)
  const isGroup = summary.kind === 'group'
  const year = escapeHtml(summary.card.year)
  const [label, name, line, stats, chips] =
    summary.kind === 'group'
      ? ['our group chat', summary.card.title, summary.card.period, groupCardStats(summary.card), summary.card.awards.map(groupAwardChip)]
      : ['my texting personality', summary.card.personality.name, summary.card.personality.line, cardStats(summary.card), summary.card.awards]
  const emoji = summary.card.topEmoji
  const notes = stats
    // --len steps a longer label's writing down so it stays on one line (see .summary-notes .hand).
    .map((s, i) => `<li class="note taped" style="--i:${i + 1}"><b>${escapeHtml(s.value)}</b><span class="hand" style="--len:${[...s.label].length}">${escapeHtml(s.label)}</span></li>`)
    .join('')
  const chipItems = chips.map((c, i) => `<li class="chip" style="--i:${i + 3}">★ ${escapeHtml(c)}</li>`).join('')
  return {
    id: SUMMARY_ID,
    html: `<p class="hand-title">${isGroup ? 'our' : 'my'} ${year} in texts</p>
      <div class="stage">
        <div class="summary-card">
          <div class="polaroid taped">
            <div class="photo"><p class="photo-label">${label}</p><p class="big" style="--len:${longestWord(name)}">${escapeHtml(name)}</p></div>
            <p class="hand">${escapeHtml(line)}</p>
          </div>
          ${emoji ? `<p class="postage"><span><small class="postage-label">top emoji</small><span class="postage-emoji">${escapeHtml(emoji)}</span></span></p>` : ''}
          <ul class="summary-notes${stats.length % 2 ? ' odd' : ''}">${notes}</ul>
          ${chipItems ? `<ul class="summary-chips">${chipItems}</ul>` : ''}
        </div>
      </div>`,
  }
}
