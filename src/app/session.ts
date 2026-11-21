import { WrappedError } from '../errors'
import { ContactBook } from '../extract/contactBook'
import { MessagesDb, type AttachmentFile } from '../extract/messagesDb'
import { normalizeRows } from '../extract/normalize'
import type { OpenSqlite } from '../extract/sqlite'
import { contentMessages } from '../stats/conversation'
import { countWords, type WordCounts } from '../stats/words'
import type { Message, Wrap } from '../types'
import { buildWrap } from '../wrap/buildWrap'
import { chatTitle, nameLookup, personLookup } from '../wrap/names'
import { mergeGroupChats, oneChatPerGroup, rankGroupChats, type RankedChat } from './chats'
import type { ConvoPhoto } from './convoMedia'
import { checkHistory, type HistoryCheck } from './history'
import { lastYearChange } from './lastYear'
import type { Period } from './period'
import { defaultSenderName, macAccountName, readAppleAccount, type AppleAccount } from './senderName'

/** The title of the solo wrap, used when building and when reporting a failure. */
export function soloTitle(year: number): string {
  return `Your ${year}`
}

/** `photos`: the photos in the wrap's conversations, kept beside the saved wrap for the maker's preview (convoMedia.ts). */
export type Built = { wrap: Wrap; undecodable: number; photos?: ConvoPhoto[] }

/** One open database copy for the whole run: the local server builds every wrap from it. */
export type Session = {
  period: Period
  groups: RankedChat[]
  history: HistoryCheck
  /** builds the group with this chat row (any of its rows; the home page sends the group's id) */
  buildGroup(chatId: number): Built
  buildSolo(): Built
  /** your first name for shared group wraps, or '' (see senderName.ts). The first call reads every chat in the period. */
  senderName(): string
  /** the first attachment of the message with this guid, for the maker's preview (see convoMedia.ts) */
  attachmentFile(guid: string): AttachmentFile | null
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
  /** the Apple Account's name and email; tests pass their own */
  appleAccount?: () => AppleAccount
}

export function openSession(options: SessionOptions): Session {
  const { openSqlite, dbPath, contacts, period, now = new Date(), accountName = macAccountName } = options
  const appleAccount = options.appleAccount ?? (() => readAppleAccount(openSqlite))
  const db = MessagesDb.open(openSqlite, dbPath)
  try {
    const nameFor = nameLookup(contacts)
    const personFor = personLookup(contacts)
    const rawChats = db.listChats()
    // A group is every chat row Messages keeps it as; its messages are labelled with the group's id.
    const groupChats = mergeGroupChats(rawChats)
    const chats = [...rawChats.filter((c) => !c.isGroup), ...groupChats].map((c) => ({ ...c, name: chatTitle(c, personFor) }))
    const span = db.messageSpan()
    const history = checkHistory(span, period, now)
    const range = { from: period.from, to: period.to }
    const read = (chatIds?: number[]) => {
      const { messages, undecodable } = normalizeRows(db.messageRows({ chatIds, ...range }))
      return { messages: oneChatPerGroup(messages, groupChats), undecodable }
    }
    let closed = false
    // One read of every chat in the period, the first time something needs it, then reused: every chat's words
    // (so group top words are what's special to that chat) and your name, which your chats have to back up.
    // It also counts each group's messages for the home page, the way a wrap counts them (undecodable rows left out,
    // a message in two rows of a group once), so a chat's count there matches its wrap's total.
    let pass: { wordBaseline: WordCounts; senderName: string; groups: RankedChat[] } | undefined
    const periodPass = () => {
      if (pass) return pass
      const { messages } = normalizeRows(db.messageRows(range))
      const sources = { ownHandles: db.ownHandles(), contacts, appleAccount, accountName, messages, chats: rawChats }
      const senderName = defaultSenderName(sources)
      const counts = new Map<number, number>()
      for (const m of contentMessages(oneChatPerGroup(messages, groupChats))) counts.set(m.chatId, (counts.get(m.chatId) ?? 0) + 1)
      return (pass = { wordBaseline: countWords(messages), senderName, groups: rankGroupChats(groupChats, counts, personFor) })
    }
    let names: string[] | undefined
    const hiddenNames = () => (names ??= [...contacts.allNames(), periodPass().senderName])
    return {
      period,
      get groups() {
        return periodPass().groups
      },
      history,
      buildGroup(chatId) {
        const group = groupChats.find((g) => g.chatIds.includes(chatId))
        const chat = group && chats.find((c) => c.id === group.id)
        if (!group || !chat) throw new WrappedError("That group chat isn't on this Mac anymore.")
        const { messages, undecodable } = read(group.chatIds)
        const words = { wordBaseline: periodPass().wordBaseline, hiddenNames: hiddenNames() }
        const { photos, onConversation } = collectPhotos()
        const vsLastYear = lastYearChange(db, span, range, group.chatIds)
        const wrap = buildWrap(messages, { mode: 'group', title: chat.name, ...range, nameFor, ...words, onConversation, vsLastYear })
        return { wrap, undecodable, photos }
      },
      buildSolo() {
        const { messages, undecodable } = read()
        const { photos, onConversation } = collectPhotos()
        const vsLastYear = lastYearChange(db, span, range)
        const options = {
          mode: 'solo', title: soloTitle(period.year), ...range, nameFor, chats, hiddenNames: hiddenNames(), onConversation, vsLastYear,
          ownHandles: db.ownHandles(),
        } as const
        return { wrap: buildWrap(messages, options), undecodable, photos }
      },
      senderName() {
        return periodPass().senderName
      },
      attachmentFile(guid) {
        return closed ? null : db.attachmentFile(guid)
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

/** Notes each message in a conversation sent with a photo (with or without text), for the maker's preview. */
function collectPhotos(): { photos: ConvoPhoto[]; onConversation: (hit: number, shown: Message[]) => void } {
  const photos: ConvoPhoto[] = []
  const onConversation = (hit: number, shown: Message[]) =>
    shown.forEach((m, message) => {
      if (m.attachmentKind === 'photo') photos.push({ hit, message, guid: m.guid, sentAt: m.sentAt.toISOString() })
    })
  return { photos, onConversation }
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
