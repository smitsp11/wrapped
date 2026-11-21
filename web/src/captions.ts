/**
 * The quips added to some slides' handwritten asides (see slides.ts). Each one is a rule over the slide's numbers, and
 * it only shows when the rule clearly holds. They're short and lowercase, and never explain how a number was worked
 * out. Pure, so it's unit-tested. A name comes in as it should be written, with `you` set when it's the viewer's own.
 */
export type CaptionName = { name: string; you: boolean }

export type CaptionFacts =
  /** Shares are percentages of all messages, for the top two people. */
  | { slide: 'volume'; topShare: number; secondShare: number }
  /** The busiest hour (0–23) and how many messages were sent in it. */
  | { slide: 'hours'; peakHour: number; peakCount: number }
  /** The busiest month's full name and its message count; `group` says it was the chat's, not yours. */
  | { slide: 'months'; month: string; peakCount: number; group: boolean }
  /** The longest run of months with one person as your person: its first and last month ("Jun", "Aug"), how many, and who. */
  | { slide: 'month-people'; run: { from: string; to: string; months: number; name: string } | null }
  /** The longest streak in days: the chat's in a group, the one with one person in My year. */
  | { slide: 'streak'; days: number; group: boolean }
  /** The fastest replier's typical reply, in minutes, and who they are. */
  | { slide: 'replies'; minutes: number; who: CaptionName }
  /** The first Paragraph Texter on the texting styles slide, if there is one. */
  | { slide: 'texting-styles'; essayist: CaptionName | null }

/** Two shares this close (in percentage points) count as a tie. */
const NECK_AND_NECK_POINTS = 2
/** The leader is this many times the runner-up or more. */
const NOT_CLOSE_RATIO = 1.5
/** A peak hour from 11 PM through 4 AM is the middle of the night; 5 through 7 AM, early morning. */
const NIGHT_FROM_HOUR = 23
const NIGHT_UNTIL_HOUR = 5
const MORNING_UNTIL_HOUR = 8
/** One person this many months in a row is an era. */
const MIN_ERA_MONTHS = 3
/** A streak longer than this many days. */
const MOVE_IN_DAYS = 100
/** A typical reply faster than this many minutes. */
const NO_LIFE_MINUTES = 1

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
      if (facts.peakHour >= NIGHT_FROM_HOUR || facts.peakHour < NIGHT_UNTIL_HOUR) return '(go to sleep 😭)'
      if (facts.peakHour < MORNING_UNTIL_HOUR) return '(early birds fr)'
      return null
    case 'months':
      if (facts.peakCount === 0) return null
      return `${facts.month} was ${facts.group ? "the chat's" : 'your'} yap era`
    case 'month-people': {
      const { run } = facts
      if (!run || run.months < MIN_ERA_MONTHS) return null
      return `${run.from}–${run.to} was the ${run.name} era`
    }
    case 'streak':
      if (facts.days <= MOVE_IN_DAYS) return null
      return facts.group ? 'at this point just move in together, all of you' : 'at this point just move in together'
    case 'replies':
      if (facts.minutes >= NO_LIFE_MINUTES) return null
      return facts.who.you ? 'you do not have a life' : `${facts.who.name} does not have a life`
    case 'texting-styles':
      if (!facts.essayist) return null
      return facts.essayist.you ? 'you write essays, the rest of them text' : `${facts.essayist.name} writes essays, the rest of you text`
  }
}
