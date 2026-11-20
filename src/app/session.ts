import { WrappedError } from '../errors'
import { ContactBook } from '../extract/contactBook'
import { MessagesDb } from '../extract/messagesDb'
import { normalizeRows } from '../extract/normalize'
import type { OpenSqlite } from '../extract/sqlite'
import { countWords, type WordCounts } from '../stats/words'
import type { Wrap } from '../types'
import { buildWrap } from '../wrap/buildWrap'
import { chatTitle, nameLookup, personLookup } from '../wrap/names'
import { mergeGroupChats, oneChatPerGroup, rankGroupChats, type RankedChat } from './chats'
import { checkHistory, type HistoryCheck } from './history'
import type { Period } from './period'
import { defaultSenderName, macAccountName } from './senderName'

/** The title of the solo wrap, used when building and when reporting a failure. */
export function soloTitle(year: number): string {
  return `Your ${year}`
}

export type Built = { wrap: Wrap; undecodable: number }

/** One open database copy for the whole run: the local server builds every wrap from it. */
export type Session = {
  period: Period
  groups: RankedChat[]
  history: HistoryCheck
  /** builds the group with this chat row (any of its rows; the home page sends the group's id) */
  buildGroup(chatId: number): Built
  buildSolo(): Built
  /** your first name for shared group wraps, or '' (see senderName.ts) */
  senderName(): string
  close(): void
}

export type SessionOptions = {
  openSqlite: OpenSqlite
  dbPath: string
  contacts: ContactBook
  period: Period
  now?: Date
  /** the Mac account's full name; tests pass their own */
  accountName?: () => string
}

export function openSession({ openSqlite, dbPath, contacts, period, now = new Date(), accountName = macAccountName }: SessionOptions): Session {
  const db = MessagesDb.open(openSqlite, dbPath)
  try {
    const nameFor = nameLookup(contacts)
    const personFor = personLookup(contacts)
    const rawChats = db.listChats()
    // A group is every chat row Messages keeps it as; its messages are labelled with the group's id.
    const groupChats = mergeGroupChats(rawChats)
    const chats = [...rawChats.filter((c) => !c.isGroup), ...groupChats].map((c) => ({ ...c, name: chatTitle(c, personFor) }))
    const groups = rankGroupChats(groupChats, db.messageCountsByChat(period.from, period.to), personFor)
    const history = checkHistory(db.messageSpan(), period, now)
    const range = { from: period.from, to: period.to }
    const read = (chatIds?: number[]) => {
      const { messages, undecodable } = normalizeRows(db.messageRows({ chatIds, ...range }))
      return { messages: oneChatPerGroup(messages, groupChats), undecodable }
    }
    let closed = false
    // Worked out on the first wrap that needs them, then reused: every chat's words in the period
    // (so group top words are what's special to that chat) and the names that are never top words.
    let wordBaseline: WordCounts | undefined
    let names: string[] | undefined
    const baseline = () => (wordBaseline ??= countWords(normalizeRows(db.messageRows(range)).messages))
    const hiddenNames = () => (names ??= [...contacts.allNames(), defaultSenderName(db.ownHandles(), contacts, accountName)])
    return {
      period,
      groups,
      history,
      buildGroup(chatId) {
        const group = groupChats.find((g) => g.chatIds.includes(chatId))
        const chat = group && chats.find((c) => c.id === group.id)
        if (!group || !chat) throw new WrappedError("That group chat isn't on this Mac anymore.")
        const { messages, undecodable } = read(group.chatIds)
        const words = { wordBaseline: baseline(), hiddenNames: hiddenNames() }
        return { wrap: buildWrap(messages, { mode: 'group', title: chat.name, ...range, nameFor, ...words }), undecodable }
      },
      buildSolo() {
        const { messages, undecodable } = read()
        const options = { mode: 'solo', title: soloTitle(period.year), ...range, nameFor, chats, hiddenNames: hiddenNames() } as const
        return { wrap: buildWrap(messages, options), undecodable }
      },
      senderName() {
        return defaultSenderName(db.ownHandles(), contacts, accountName)
      },
      close() {
        if (closed) return
        closed = true
        db.close()
      },
    }
  } catch (err) {
    db.close()
    throw err
  }
}

/** Contacts are optional: without them, names are masked. Returns a one-line note when something was skipped. */
export function loadContactBook(openSqlite: OpenSqlite): { contacts: ContactBook; note: string | null } {
  try {
    const contacts = ContactBook.fromMac(openSqlite)
    const note = contacts.skippedSources > 0 ? `Skipped ${contacts.skippedSources} contact source(s) that couldn't be read.` : null
    return { contacts, note }
  } catch {
    return { contacts: new ContactBook([]), note: "Couldn't read Contacts, so names will be masked." }
  }
}
