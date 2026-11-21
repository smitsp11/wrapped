/**
 * The quips added to some slides' handwritten asides (see slides.ts). Each one is a rule over the slide's numbers, and
 * it only shows when the rule clearly holds. They stay kind: a wrap is about real friends, so nothing here pokes fun at
 * one person. Pure, so it's unit-tested.
 */
export type CaptionFacts =
  /** Shares are percentages of all messages, for the top two people. */
  | { slide: 'volume'; topShare: number; secondShare: number }
  /** The busiest hour (0–23) and how many messages were sent in it. */
  | { slide: 'hours'; peakHour: number; peakCount: number }

/** Two shares this close (in percentage points) count as a tie. */
const NECK_AND_NECK_POINTS = 2
/** The leader is this many times the runner-up or more. */
const NOT_CLOSE_RATIO = 1.5

export function caption(facts: CaptionFacts): string | null {
  switch (facts.slide) {
    case 'volume': {
      const { topShare, secondShare } = facts
      // Checked first: two tiny shares can be 1.5× apart and still be a tie.
      if (topShare - secondShare <= NECK_AND_NECK_POINTS) return '(neck and neck)'
      if (topShare >= secondShare * NOT_CLOSE_RATIO) return "(it's not close)"
      return null
    }
    case 'hours':
      if (facts.peakCount === 0) return null
      if (facts.peakHour < 5) return '(way past bedtime)'
      if (facts.peakHour < 8) return '(early birds)'
      return null
  }
}
