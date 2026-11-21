/**
 * A realistic, busy, made-up year of "Poker Night" for the public demo (makeFakeDb's `realistic`).
 *
 * Its numbers and shape follow a real, busy group chat, measured as aggregates only: about 23,000 messages in the
 * year, six people who text (one third, a quarter, a quarter, a seventh, and two who barely do), a late-morning to
 * late-evening day, a spring-summer peak, a 70-day streak and a 12-day silence, replies in minutes, about one message in
 * twelve reacted to (mostly hearts), one photo in forty, and one emoji far ahead of the rest.
 * Everything you can read is invented: the people, the chat's name and every message (templates and made-up lines).
 *
 * Pure: it returns the messages and reactions, and makeFakeDb writes them. A seeded PRNG keeps it the same every run.
 */
import type { ReactionType } from '../src/types'

/**
 * The people besides fake "me": four from FAKE_PEOPLE, two more here. Who they are in the chat is in PERSONAS.
 * Devon is in the group but never texts, like the quiet members of a real group.
 */
export const EXTRA_PEOPLE = {
  casey: { handle: '+14165550107', name: 'Casey Morgan' },
  devon: { handle: '+14165550108', name: 'Devon Brooks' },
} as const

export type Who = 'me' | 'riley' | 'sam' | 'alex' | 'jordan' | 'casey'
/** The 1:1 chats, so the group's words are compared with something (its vocabulary is what's special to it). */
export const DM_FRIENDS = ['riley', 'sam', 'alex', 'jordan', 'casey'] as const

export type Media = 'photo' | 'video' | 'file'
/** One message: in the group, or in the 1:1 chat with `dm`. A reaction points at an earlier event by its index. */
export type ChatEvent = {
  dm?: (typeof DM_FRIENDS)[number]
  from: Who
  at: Date
  text?: string
  media?: Media
  react?: { to: number; type: ReactionType; emoji?: string }
}

/* ---------------------------------------------------------------- randomness */

/** mulberry32: tiny, fast and good enough for made-up chat. */
function prng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Rng {
  private readonly next: () => number
  constructor(seed: number) {
    this.next = prng(seed)
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)]!
  }
  normal(): number {
    const u = Math.max(this.next(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next())
  }
  /** A positive number whose median is `median`; `sigma` sets how long the tail is. */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal())
  }
  /** A key, with odds in proportion to its weight. */
  weighted<K extends string>(weights: Partial<Record<K, number>>): K {
    const entries = Object.entries(weights) as [K, number][]
    let r = this.next() * entries.reduce((sum, [, w]) => sum + w, 0)
    for (const [key, w] of entries) if ((r -= w) < 0) return key
    return entries[entries.length - 1]![0]
  }
}

/* ---------------------------------------------------------------- the year's shape */

const YEAR = 2026
const DAYS = 365
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

/** Messages per month, January first. A quiet start, a May peak, a long busy summer, a quieter fall. */
const MONTH_TOTALS = [330, 1080, 830, 1500, 4300, 3100, 3700, 3850, 1650, 1200, 1200, 900]
/** How likely a day in each month is to have any message. */
const ACTIVE_ODDS = [0.6, 0.82, 0.8, 0.85, 0.95, 0.92, 0.92, 0.92, 0.84, 0.82, 0.82, 0.78]
/** Weekdays are busier than weekends. Sunday first. */
const WEEKDAY_FACTOR = [0.62, 1.0, 1.06, 0.98, 1.07, 1.05, 0.69]
/** When a run of messages starts, by hour (6 AM to 11 PM): it builds through the morning and stays up all evening. */
const HOUR_WEIGHTS = [
  0, 0, 0, 0, 0, 0, 55, 300, 900, 900, 1300, 1584, 1325, 1512, 2044, 2246, 1988, 1939, 1955, 2054, 2092, 1658, 1850, 1025,
]

/** Day numbers count from Jan 1 (0). Jan 1, 2026 is a Thursday. */
const dayOf = (month: number, date: number) => Math.round((Date.UTC(YEAR, month, date) - Date.UTC(YEAR, 0, 1)) / (24 * HOUR))
const dateOf = (day: number, ms = 0) => new Date(Date.UTC(YEAR, 0, 1 + day) + ms)
const weekday = (day: number) => dateOf(day).getUTCDay()
const monthOf = (day: number) => dateOf(day).getUTCMonth()

/** The longest quiet stretch: nothing from Jan 9 to Jan 20, so 12 days of silence. */
const SILENCE = { from: dayOf(0, 9), to: dayOf(0, 20) }
/** The longest streak: May 4 → Jul 12, 70 days in a row, with a quiet day either side. */
const STREAK = { from: dayOf(4, 4), to: dayOf(6, 12) }
/** The busiest day, a Thursday in May. */
const BUSIEST = { day: dayOf(4, 21), messages: 640 }
/** No other day gets near the busiest. */
const MAX_OTHER_DAY = 470

/* ---------------------------------------------------------------- the people */

type Persona = {
  /** odds of being the next to speak when the turn passes */
  turnWeight: number
  /** odds of sending another text in the same turn */
  stay: number
  /** typical minutes before they join a conversation someone else started */
  joinMinutes: number
  /** odds that their next run of texts follows on from their own last one (a double text) */
  doubleText: number
  /** share of their messages that are a photo or other attachment */
  media: number
  /** how likely others are to react to one of their messages, and to laugh when they do */
  reacted: number
  laughs: number
  /** odds that a reaction anyone gives comes from them */
  reacts: number
}

/**
 * Riley talks the most, in bursts, and reacts to everything (Spray n Pray, Main Character, Hype Man).
 * You start most conversations, answer in minutes and double text (Starter, Double Texter).
 * Sam sends one joke and stops; the chat laughs (One and Done, Comedian).
 * Alex texts one word at a time, late, and late at night (Nonchalant, The Ghost, Night Owl).
 * Jordan shows up a few times a year with paragraphs (Paragraph Texter, The Lurker). Casey barely texts at all.
 */
const PERSONAS: Record<Who, Persona> = {
  riley: { turnWeight: 9.5, stay: 0.74, joinMinutes: 15, doubleText: 0.12, media: 0.016, reacted: 0.05, laughs: 0.1, reacts: 0.58 },
  me: { turnWeight: 15, stay: 0.33, joinMinutes: 4, doubleText: 0.42, media: 0.039, reacted: 0.12, laughs: 0.08, reacts: 0.11 },
  sam: { turnWeight: 41, stay: 0, joinMinutes: 24, doubleText: 0.0, media: 0.017, reacted: 0.1, laughs: 0.5, reacts: 0.19 },
  alex: { turnWeight: 8.5, stay: 0.28, joinMinutes: 45, doubleText: 0.1, media: 0.036, reacted: 0.07, laughs: 0.1, reacts: 0.11 },
  jordan: { turnWeight: 22, stay: 0.25, joinMinutes: 120, doubleText: 0, media: 0, reacted: 0.12, laughs: 0.05, reacts: 0.005 },
  casey: { turnWeight: 3.5, stay: 0.2, joinMinutes: 30, doubleText: 0, media: 0, reacted: 0.12, laughs: 0.05, reacts: 0.005 },
}
const REGULARS = ['riley', 'me', 'sam', 'alex'] as const
/** Who sends the first message of the day. */
const STARTER_ODDS: Partial<Record<Who, number>> = { me: 0.5, riley: 0.14, sam: 0.17, alex: 0.19 }

/* ---------------------------------------------------------------- the words */

/** Everyday lines, in the group and the 1:1 chats alike, so none of them is special to the group. */
const SHORT = [
  'lol', 'LMAO', 'wait', 'nah', 'yeah', 'true', 'same', 'ok', 'omw', 'real', 'no way', 'fr', 'huh', 'oh no', 'hahaha',
  'why', 'facts', 'ok ok', 'yes', 'nope', 'stop', 'valid', 'W', 'L', 'say less', 'crazy', 'no shot', 'ya', 'agreed',
  'noted', 'bruh', 'sheesh', 'ugh', 'wild', 'yesss', 'nooo', 'ok fine', 'hold on', 'not me', 'good point', 'pass',
]
const MEDIUM = [
  'what time are we thinking', "i'm literally on the bus", "who's driving", 'can someone send the address',
  "ok that's actually so funny", 'i just woke up', 'this is so real', 'be there in 10', 'no because why is that true',
  'did anyone see that', 'my phone is at 4%', 'i have a midterm tomorrow', 'send the pic', "that's crazy actually",
  'wait what happened', "i'm not reading all that", "ok who's free saturday", 'running 5 min late',
  'can we get food after', "who's down for food", "i'll be there at 8", 'this weather is insane', "i'm starving rn",
  "ok i'm leaving now", 'that was so long ago', "you're not serious", 'nobody asked but ok', 'ok but hear me out',
  "that's lowkey fair", "i'm gonna need context", 'need everyone to calm down', 'ok fine you win', 'how is it already november',
  'who took my charger', 'the bus just left without me', 'i need a nap immediately', 'grabbing coffee first',
  'did you guys eat yet', 'that game last night was insane', 'my landlord texted me again', 'whose jacket is this',
  'this is the funniest thing', 'i was today years old', 'it is way too early', 'the group chat never sleeps',
  "i'm outside", 'ok where are you', 'parking is a nightmare here', 'tell me why that worked',
]
const LONG = [
  "ok i'm actually leaving now, save me a seat please", 'wait did anyone else get the email about the thing on friday',
  'i swear every time we plan something someone cancels last minute',
  'can we please pick a time that works for more than two people',
  "i literally just got home and now you're telling me there's food", "i'm gonna be honest i forgot that was today",
  'no because the way that worked out is actually unbelievable', 'remind me to never take the late bus again in my life',
  'ok everyone vote, saturday or sunday, majority wins and no complaining', 'i need someone to explain what i just walked into',
  'that is the most unhinged thing anyone has said in this chat all week',
  "my sister borrowed my car so i'm going to be a little late",
]

/** The group's own words: a poker night's running jokes. Each person leans on a few. */
const POKER: Record<Who, string[]> = {
  riley: [
    'run it back', 'RUN IT BACK', 'run it back friday', 'we run it back tonight', 'no we have to run it back',
    'say it with me. run it back', 'run it back immediately', 'chips are on me', 'deal me in', 'the river owes me',
    'fold? never', 'bring cash', 'i fold to nobody', 'pot is getting huge', "who's dealing", 'snack tax', 'statistically i am due',
  ],
  me: [
    "who's dealing", "who's dealing tonight", "ok who's dealing this time", 'rebuy?', 'i need a rebuy',
    'one more rebuy and i stop', 'snack tax is due', 'poker friday yes or no', '8pm at mine', 'bring the chips',
    'doors at 8, bring a chair', 'should have folded', 'run it back', 'fold', 'who has the good deck',
  ],
  sam: [
    'skill issue', 'massive skill issue', "that's a bad beat", 'bad beat of the year', "i'm framing that bad beat",
    'the river hates me specifically', 'pocket aces and i still lost', 'not a skill issue, a deck issue',
    'pay the snack tax', 'this is a skill issue and i say that with love', 'bad beat', 'statistically a skill issue', 'fold',
  ],
  alex: ['fold', 'fold', 'fold', 'fold', 'fold.', 'deal', 'check', 'rebuy', 'snack tax', 'fold fr', 'skill issue', 'run it back', 'chips'],
  jordan: ['run it back', 'bad beat'],
  casey: ['run it back', 'snack tax', "who's dealing", 'bad beat'],
}
/** Alex's whole replies, a word or an emoji at a time. */
const ALEX_WORDS = ['bet', 'k', 'real', 'same', 'lol', 'yeah', 'nah', 'true', 'ok', 'fr', '💀', '💀', '👍', 'in']
/** Jordan's paragraphs are built from these. */
const JORDAN_CLAUSES = [
  "ok i've been reading every message in silence and i have to say something",
  'statistically speaking the river is not personally out to get any of you',
  'i say this with love but the way this group plays pocket aces is a crime',
  'i ran the numbers on last month and riley is somehow up forty dollars in snacks alone',
  'nobody in this chat has ever folded a bad hand on purpose and it shows',
  'the snack tax is the only functioning institution in this friend group',
  'statistically one of you should have won by now and yet here we are',
  'i will be at the next one and i will be bringing a spreadsheet',
  "i read back three hundred messages to find out who's dealing and i still don't know",
  'for the record i was right about the bad beat and the screenshots prove it',
  'i am choosing to believe this chat is a support group and not a poker group',
  'anyway that is all i had to say, carry on, i will be back next quarter',
]
const EMOJI_ODDS = { '💀': 62, '😭': 14, '🃏': 10, '🔥': 6, '🫡': 4, '🙏': 4 }

function line(rng: Rng, who: Who): string {
  const poker = { riley: 0.11, me: 0.09, sam: 0.12, alex: 0.32, jordan: 0, casey: 0.12 }[who]
  if (rng.chance(poker)) return rng.pick(POKER[who])
  if (who === 'alex') return rng.chance(0.75) ? rng.pick(ALEX_WORDS) : rng.pick(rng.chance(0.5) ? SHORT : MEDIUM)
  if (who === 'jordan') return paragraph(rng)
  const odds = who === 'riley' ? { short: 55, medium: 38, long: 7 } : who === 'casey' ? { short: 20, medium: 70, long: 10 } : { short: 26, medium: 56, long: 18 }
  const size = rng.weighted(odds)
  return rng.pick(size === 'short' ? SHORT : size === 'medium' ? MEDIUM : LONG)
}

function paragraph(rng: Rng): string {
  const first = rng.pick(JORDAN_CLAUSES)
  let second = rng.pick(JORDAN_CLAUSES)
  if (second === first) second = JORDAN_CLAUSES[(JORDAN_CLAUSES.indexOf(first) + 1) % JORDAN_CLAUSES.length]!
  return `${first}, and ${second}`
}

/** A text from `who`, sometimes with an emoji (one in ten texts has one, like the real chat). */
function textFor(rng: Rng, who: Who): string {
  const text = line(rng, who)
  if (!rng.chance(who === 'alex' ? 0.05 : 0.1)) return text
  const emoji = rng.weighted(EMOJI_ODDS)
  return rng.chance(0.25) ? emoji : `${text} ${emoji}`
}

/* ---------------------------------------------------------------- the three greatest hits */

type HitReactions = Partial<Record<ReactionType, Who[]>>
type Line = [who: Who, minutesIn: number, text: string, extra?: { media?: Media; hit?: HitReactions }]

/**
 * Three moments the chat reacted to, each its own conversation (nothing else that day), so "what was the convo?" shows
 * the whole thing. Times are UTC.
 */
const MOMENTS: { day: number; start: string; lines: Line[] }[] = [
  {
    day: dayOf(1, 27), // a Friday in February: the snack tax
    start: '11:20',
    lines: [
      ['me', 0, 'ok new rule for friday'],
      ['me', 0.3, 'if you lose the first hand you pay the snack tax'],
      ['riley', 1.5, 'define snack tax'],
      ['me', 2.4, 'you buy the chips. the real ones, not the store brand'],
      ['alex', 3.1, 'bet'],
      ['sam', 3.8, 'this is targeted'],
      ['riley', 4.2, 'this is so targeted'],
      ['riley', 4.4, 'sam you have never once won the first hand'],
      ['sam', 6.0, 'i will be bringing a lawyer'],
      ['me', 7.2, '\uFFFC', { media: 'photo' }],
      ['me', 7.5, 'exhibit A. four bags of off-brand pretzels'],
      ['sam', 9.1, 'i didn’t lose the first hand, i was establishing a table image',
        { hit: { laugh: ['riley', 'me', 'alex', 'casey'], love: ['jordan'] } }],
      ['alex', 9.6, '💀'],
      ['riley', 10.2, 'table image of a guy who buys off-brand pretzels'],
      ['me', 11.0, 'snack tax passes 3 to 1'],
      ['sam', 14.5, 'appealing to the supreme court'],
    ],
  },
  {
    day: dayOf(5, 6), // a Saturday in June: Jordan surfaces
    start: '13:30',
    lines: [
      ['riley', 0, 'jordan has been typing for six minutes'],
      ['sam', 0.8, 'brace yourselves'],
      ['me', 1.4, 'he lives'],
      ['jordan', 3.0,
        "ok i've been reading every message in silence for three weeks and i need everyone to know that the way you all play pocket aces is a crime against statistics"],
      ['jordan', 3.6, 'i say this with love, as someone who has also donated money to riley'],
      ['riley', 4.1, 'donations accepted every friday 8pm'],
      ['alex', 5.0, 'real'],
      ['me', 5.9, 'jordan wrote a whole essay and then logged off for another month',
        { hit: { laugh: ['riley', 'sam', 'alex', 'casey', 'jordan'] } }],
      ['jordan', 7.5, 'see you next quarter'],
      ['me', 8.0, 'legend'],
      ['riley', 8.2, 'run it back with jordan at the table??'],
      ['riley', 8.4, 'friday. no excuses'],
      ['jordan', 30.0, 'fine. bringing a spreadsheet'],
    ],
  },
  {
    day: dayOf(7, 22), // a Saturday in August: the trophy
    start: '15:10',
    lines: [
      ['riley', 0, '\uFFFC', { media: 'photo' }],
      ['riley', 0.2, 'commissioned a trophy for whoever wins the season'],
      ['riley', 0.4, 'it’s a gold spatula'],
      ['sam', 1.3, 'why a spatula'],
      ['riley', 1.9, 'it was 8 dollars'],
      ['me', 2.6, 'riley you’re 0 for 6 this season'],
      ['riley', 3.0, 'the trophy is for morale'],
      ['riley', 3.1, 'and for motivation'],
      ['riley', 3.3, 'mostly mine'],
      ['alex', 9.8, 'engrave sam’s name on it now, save time',
        { hit: { laugh: ['riley', 'me', 'casey'], love: ['sam'], emphasize: ['jordan'] } }],
      ['sam', 11.0, 'i’m framing this message'],
      ['riley', 11.6, 'betrayal'],
      ['me', 12.4, 'run it back friday, winner takes the spatula'],
    ],
  },
]

/* ---------------------------------------------------------------- the generator */

/** Every message and reaction of the realistic year, oldest first within each part. Reactions come last. */
export function realisticChat(seed = 2026): ChatEvent[] {
  const rng = new Rng(seed)
  const events: ChatEvent[] = []
  const momentDays = new Set(MOMENTS.map((m) => m.day))

  const active = activeDays(rng, momentDays)
  const counts = dayCounts(rng, active, momentDays)
  // Jordan and Casey only show up on a few days each; most of those, they start the conversation.
  const quietDays = [...counts.keys()].filter((d) => d !== BUSIEST.day && counts.get(d)! >= 25)
  const visits = new Map<number, { who: Who; starts: boolean }>()
  const visit = (who: Who, n: number, starts: number) => {
    for (let i = 0; i < n; i++) {
      let day = rng.pick(quietDays)
      while (visits.has(day)) day = rng.pick(quietDays)
      visits.set(day, { who, starts: i < starts })
    }
  }
  visit('jordan', 6, 5)
  visit('casey', 6, 4)

  for (let day = 0; day < DAYS; day++) {
    const n = counts.get(day)
    if (n === undefined) continue
    // A late-night run after this day, when tomorrow has messages too (so it never ends a streak or a silence).
    const tail = active[day + 1] === true && !momentDays.has(day + 1) && rng.chance(0.3) && n >= 20 ? rng.int(8, 18) : 0
    generateDay(rng, events, day, n - tail, visits.get(day))
    if (tail > 0) lateNight(rng, events, day, tail)
  }
  const hits = new Map<ChatEvent, HitReactions>()
  for (const moment of MOMENTS) addMoment(events, hits, moment)
  events.sort((a, b) => a.at.getTime() - b.at.getTime())

  // Reactions point at messages by index, so they come once the messages are in order.
  for (const [hit, reactions] of hits) {
    const index = events.indexOf(hit)
    for (const [type, people] of Object.entries(reactions) as [ReactionType, Who[]][]) {
      people.forEach((by, i) => events.push({ from: by, at: new Date(hit.at.getTime() + (20 + 15 * i) * SECOND), react: { to: index, type } }))
    }
  }
  addReactions(rng, events)
  for (const friend of DM_FRIENDS) addDm(rng, events, friend)
  return events
}

/** Which days have any message: the silence, the streak and its quiet edges are fixed; the rest is by month. */
function activeDays(rng: Rng, momentDays: Set<number>): boolean[] {
  const active = Array.from({ length: DAYS }, (_, day) => rng.chance(ACTIVE_ODDS[monthOf(day)]!))
  for (let day = SILENCE.from; day <= SILENCE.to; day++) active[day] = false
  for (let day = STREAK.from; day <= STREAK.to; day++) active[day] = true
  active[STREAK.from - 1] = false
  active[STREAK.to + 1] = false
  for (const day of momentDays) active[day] = true
  active[0] = true
  // The silence runs from the evening before to the morning after (see generateDay).
  active[SILENCE.from - 1] = true
  active[SILENCE.to + 1] = true
  // No other run of days comes near the streak.
  let run = 0
  for (let day = 0; day < DAYS; day++) {
    const inStreak = day >= STREAK.from - 1 && day <= STREAK.to + 1
    run = active[day] ? run + 1 : 0
    if (!inStreak && run > 40 && !momentDays.has(day)) {
      active[day] = false
      run = 0
    }
  }
  return active
}

/** How many messages each active day gets: each month's total, spread unevenly (most days are small, a few are huge). */
function dayCounts(rng: Rng, active: boolean[], momentDays: Set<number>): Map<number, number> {
  const counts = new Map<number, number>()
  for (let month = 0; month < 12; month++) {
    const days = active.flatMap((on, day) => (on && monthOf(day) === month && !momentDays.has(day) ? [day] : []))
    let total = MONTH_TOTALS[month]!
    if (days.includes(BUSIEST.day)) {
      counts.set(BUSIEST.day, BUSIEST.messages)
      total -= BUSIEST.messages
      days.splice(days.indexOf(BUSIEST.day), 1)
    }
    const weights = days.map((day) => WEEKDAY_FACTOR[weekday(day)]! * Math.exp(0.95 * rng.normal()))
    const sum = weights.reduce((a, b) => a + b, 0)
    days.forEach((day, i) => counts.set(day, Math.min(MAX_OTHER_DAY, Math.max(3, Math.round((total * weights[i]!) / sum)))))
  }
  return counts
}

/** A clock time on a day, as a Date. */
function clock(day: number, hhmm: string): Date {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return dateOf(day, h * HOUR + m * MINUTE)
}

/**
 * One day of the group: `n` messages in runs at times drawn from HOUR_WEIGHTS. Each person joins a while after the
 * first message (their joinMinutes), then the turn passes around by PERSONAS' odds.
 */
function generateDay(rng: Rng, events: ChatEvent[], day: number, n: number, visitor?: { who: Who; starts: boolean }): void {
  const present: Who[] = [...REGULARS, ...(visitor ? [visitor.who] : [])]
  const starter: Who = visitor?.starts ? visitor.who : rng.weighted(STARTER_ODDS)

  // Runs of texts: a few long ones and many short ones.
  const sizes: number[] = []
  for (let left = n; left > 0; ) {
    const size = Math.min(left, Math.max(1, Math.round(rng.logNormal(11, 0.85))))
    sizes.push(size)
    left -= size
  }
  const hours = HOUR_WEIGHTS.map((w, h) => [String(h), w] as const).filter(([, w]) => w > 0)
  const starts = sizes
    .map(() => Number(rng.weighted(Object.fromEntries(hours))) * HOUR + rng.int(0, 59) * MINUTE + rng.int(0, 59) * SECOND)
    .sort((a, b) => a - b)

  const dayStart = dateOf(day).getTime()
  const first = dayStart + starts[0]!
  const joinAt = new Map<Who, number>(
    present.map((who) => [who, who === starter ? first : first + rng.logNormal(PERSONAS[who].joinMinutes, 1.1) * MINUTE]),
  )
  let t = first
  let current: Who | null = null
  const send = (who: Who) => {
    const media = rng.chance(PERSONAS[who].media)
    events.push({ from: who, at: new Date(t), ...(media ? { text: '\uFFFC', media: mediaKind(rng) } : { text: textFor(rng, who) }) })
    current = who
  }
  /** The next to speak after `from`: someone already in the conversation, or else whoever joins next. */
  const passTurn = (from: Who): Who => {
    const joined = present.filter((who) => who !== from && joinAt.get(who)! <= t)
    if (joined.length > 0) return rng.weighted<Who>(Object.fromEntries(joined.map((who) => [who, PERSONAS[who].turnWeight])))
    const next = present.filter((who) => who !== from).sort((a, b) => joinAt.get(a)! - joinAt.get(b)!)[0]!
    t = Math.max(t, joinAt.get(next)! + rng.int(5, 90) * SECOND)
    return next
  }

  sizes.forEach((size, run) => {
    t = Math.max(t + 2 * SECOND, dayStart + starts[run]!)
    for (let i = 0; i < size; i++) {
      if (current === null) send(starter)
      else if (i === 0) send(rng.chance(PERSONAS[current].doubleText) ? current : passTurn(current))
      else send(rng.chance(PERSONAS[current].stay) ? current : passTurn(current))
      t += Math.max(2, rng.logNormal(9, 1.4)) * SECOND
    }
  })
}

/** After midnight, Alex and one other keep it going: Alex sends most of these (Night Owl). */
function lateNight(rng: Rng, events: ChatEvent[], day: number, n: number): void {
  const partner = rng.weighted<Who>({ riley: 0.4, sam: 0.35, me: 0.25 })
  let t = clock(day, '23:40').getTime() + Math.min(rng.logNormal(45, 0.9), 200) * MINUTE
  let who: Who = rng.chance(0.6) ? 'alex' : partner
  for (let i = 0; i < n; i++) {
    events.push({ from: who, at: new Date(t), text: textFor(rng, who) })
    who = who === 'alex' ? (rng.chance(0.3) ? 'alex' : partner) : rng.chance(0.15) ? partner : 'alex'
    t += Math.max(3, rng.logNormal(25, 1.3)) * SECOND
  }
}

function mediaKind(rng: Rng): Media {
  return rng.weighted<Media>({ photo: 90, video: 4, file: 6 })
}

/** A moment's lines; `hits` gets the message the chat reacted to, with its reactions. */
function addMoment(events: ChatEvent[], hits: Map<ChatEvent, HitReactions>, moment: (typeof MOMENTS)[number]): void {
  const start = clock(moment.day, moment.start).getTime()
  for (const [who, minutes, text, extra] of moment.lines) {
    const event: ChatEvent = { from: who, at: new Date(start + Math.round(minutes * MINUTE)), text, ...(extra?.media ? { media: extra.media } : {}) }
    events.push(event)
    if (extra?.hit) hits.set(event, extra.hit)
  }
}

/** Reactions on about one message in twelve, mostly hearts; laughs go to whoever's funny (Sam). Never more than three. */
function addReactions(rng: Rng, events: ChatEvent[]): void {
  const reacted = new Set(events.flatMap((e) => (e.react ? [e.react.to] : [])))
  const count = events.length
  for (let i = 0; i < count; i++) {
    const target = events[i]!
    if (target.react || reacted.has(i)) continue
    const persona = PERSONAS[target.from]
    if (!rng.chance(persona.reacted)) continue
    const n = rng.weighted({ 1: 92, 2: 7.3, 3: 0.7 })
    const givers = new Set<Who>()
    while (givers.size < Number(n)) {
      const by = rng.weighted(Object.fromEntries(Object.entries(PERSONAS).map(([who, p]) => [who, p.reacts])) as Record<Who, number>)
      if (by !== target.from) givers.add(by)
    }
    for (const by of givers) {
      const type = rng.chance(persona.laughs)
        ? 'laugh'
        : rng.weighted<ReactionType>({ love: 82, emoji: 7, emphasize: 4, like: 4, dislike: 2, question: 1 })
      const at = new Date(target.at.getTime() + Math.max(3, rng.logNormal(40, 1.2)) * SECOND)
      events.push({ from: by, at, react: { to: i, type, ...(type === 'emoji' ? { emoji: rng.pick(['💀', '😭', '🫡']) } : {}) } })
    }
  }
}

/** A 1:1 chat with a friend: a few everyday back-and-forths a month, no poker talk. */
function addDm(rng: Rng, events: ChatEvent[], friend: (typeof DM_FRIENDS)[number]): void {
  for (let day = rng.int(0, 6); day < DAYS; day += rng.int(4, 14)) {
    let t = clock(day, `${rng.int(9, 22)}:${rng.int(0, 59)}`).getTime()
    for (let i = 0, n = rng.int(3, 9); i < n; i++) {
      const from: Who = i % 2 === 0 ? friend : 'me'
      events.push({ dm: friend, from, at: new Date(t), text: rng.pick(rng.chance(0.4) ? SHORT : rng.chance(0.8) ? MEDIUM : LONG) })
      t += rng.int(20, 600) * SECOND
    }
  }
}
