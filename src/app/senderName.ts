import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeHandle, readDatabaseCopy, type ContactBook } from '../extract/contactBook'
import type { OpenSqlite } from '../extract/sqlite'
import type { Chat, Message } from '../types'

/** How many messages from other people must use a name before it counts as yours. */
export const MIN_MENTIONS = 3
/** Others must use your name at least this many times as often (per message) as you do. */
const SELF_USE_RATIO = 3
/** A greeted name needs this many different one-on-one chats behind it. */
const MIN_GREETERS = 2

/**
 * Words that turn up where a first name should be but aren't one: what people type into a contact card or a
 * Mac account ("General", "Mac", "Home iPhone"), and what friends call each other in a greeting ("hey man").
 */
export const NOT_NAMES = new Set([
  'general', 'me', 'my', 'mine', 'myself', 'owner', 'admin', 'administrator', 'user', 'guest', 'mac', 'macbook',
  'imac', 'iphone', 'ipad', 'phone', 'cell', 'home', 'work', 'office', 'mobile', 'main', 'personal', 'private',
  'default', 'test', 'unknown', 'apple', 'icloud', 'account', 'contact', 'number', 'new', 'old', 'info', 'support',
  'family', 'shared', 'school', 'business', 'none', 'null', 'name', 'first', 'last', 'you', 'siri',
  // what friends and family call you instead of your name
  'man', 'bro', 'bruh', 'brother', 'sis', 'sister', 'dude', 'guys', 'girl', 'girls', 'boy', 'boys', 'babe', 'baby',
  'bae', 'love', 'honey', 'sweetie', 'darling', 'dear', 'sunshine', 'king', 'queen', 'sir', 'madam', 'boss', 'chief',
  'buddy', 'bud', 'mate', 'pal', 'fam', 'team', 'all', 'everyone', 'there', 'mom', 'mum', 'mama', 'mommy', 'dad',
  'papa', 'daddy', 'son', 'grandma', 'grandpa', 'auntie', 'aunty', 'uncle', 'cuz', 'cousin', 'friend', 'gang',
])

/** Greetings that come right before the name of the person being greeted ("hey Sam", "happy birthday Sam"). */
const GREETINGS = new Set([
  'hi', 'hey', 'hello', 'hiya', 'heya', 'yo', 'sup', 'morning', 'evening', 'night', 'thanks', 'thank you', 'thx',
  'ty', 'congrats', 'congratulations', 'happy birthday', 'hbd', 'good morning', 'good night', 'good evening',
  'good afternoon', 'bye', 'welcome', 'welcome back', 'miss you', 'love you',
])

/** The Apple Account this Mac is signed in to: its full name and its email (or phone), '' when unknown. */
export type AppleAccount = { name: string; email: string }
export const NO_APPLE_ACCOUNT: AppleAccount = { name: '', email: '' }

export type SenderNameSources = {
  /** the numbers and emails you send from (MessagesDb.ownHandles) */
  ownHandles: string[]
  /** contact cards, including the one marked as yours (ContactBook.meNames) */
  contacts: ContactBook
  /** the Apple Account (readAppleAccount; tests pass their own) */
  appleAccount: () => AppleAccount
  /** the Mac account's full name (macAccountName; tests pass their own) */
  accountName: () => string
  /** every message in the period, in every chat: the evidence for a name */
  messages: readonly Message[]
  /** every chat (with the raw chat ids the messages carry): who you text, and which chats are one-on-one */
  chats: readonly Pick<Chat, 'id' | 'isGroup' | 'memberIds'>[]
}

/**
 * Your first name for shared group wraps, where "You" would read as whoever opens the link. A wrong name is
 * worse than "You", so every source has to hold up against your chats.
 *
 * Candidates, in order (nameCandidates): the first name of your Apple Account; the nickname, then the first
 * name, on the card you marked as yours in Contacts; the same on any card with a number or email you send
 * from (or your Apple Account's email); the first word of this Mac account's name. Each must look like a
 * name (looksLikeName). Then:
 * - Any candidate passes when it's the name friends greet you with in one-on-one chats ("hey Sam";
 *   greetedName), or when it isn't the name of someone you text and others call you it (isBackedByChats).
 * - A name you gave yourself (Apple Account, Me card) also passes on its own, as long as it isn't the name
 *   of someone you text and friends don't greet you by a different name. A family Mac or Apple Account
 *   (a parent's name) is the usual way it's wrong, and you usually text that parent.
 * The first that passes wins. If none does, the greeted name on its own. Else '', which keeps "You".
 */
export function defaultSenderName({ ownHandles, contacts, appleAccount, accountName, messages, chats }: SenderNameSources): string {
  const apple = appleAccount()
  const handles = apple.email.trim() ? [...ownHandles, apple.email.trim()] : ownHandles
  const texts = splitTexts(messages)
  const theirs = namesOfOthers(handles, contacts, chats)
  // Friends greeting you by name in one-on-one chats is the strongest evidence, and it also covers names that are
  // everyday words ("Will", "Mark"), which the mention check can't tell apart from the word itself.
  const dmChatIds = new Set(chats.filter((c) => !c.isGroup).map((c) => c.id))
  const greeted = greetedName(messages, dmChatIds)
  const isTheirs = (name: string) => theirs.has(name.toLowerCase())
  const backedByChats = (name: string) => name.toLowerCase() === greeted.toLowerCase() || (!isTheirs(name) && isBackedByChats(name, texts))
  const sources = { appleName: apple.name, contacts, ownHandles: handles, accountName }
  for (const { name, yours } of nameCandidates(sources)) {
    if (backedByChats(name) || (yours && !greeted && !isTheirs(name))) return name
  }
  return greeted
}

/**
 * The nicknames and first names (lowercase) of everyone you text. Others saying one of these could mean that
 * person, so it's no evidence that it's your name: a card with your number under a family member's name, or a
 * friend who shares your name, gives "You" rather than a guess.
 */
function namesOfOthers(ownHandles: string[], contacts: ContactBook, chats: SenderNameSources['chats']): Set<string> {
  const own = new Set(ownHandles.map(normalizeHandle))
  const names = new Set<string>()
  for (const handle of new Set(chats.flatMap((c) => c.memberIds))) {
    if (own.has(normalizeHandle(handle))) continue
    for (const name of contacts.givenNamesFor(handle)) names.add(name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase())
  }
  return names
}

/** A name that might be yours. `yours`: you gave it yourself (your Apple Account, your Me card), not a card someone made. */
export type Candidate = { name: string; yours: boolean }

type CandidateSources = Pick<SenderNameSources, 'contacts' | 'ownHandles' | 'accountName'> & { appleName: string }

/** The names that might be yours, in order (see defaultSenderName), without repeats or anything that doesn't look like a name. */
export function nameCandidates({ appleName, contacts, ownHandles, accountName }: CandidateSources): Candidate[] {
  const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? ''
  const raw = [
    { name: firstWord(appleName), yours: true },
    ...contacts.meNames().map((name) => ({ name, yours: true })),
    ...ownHandles.flatMap((handle) => contacts.givenNamesFor(handle)).map((name) => ({ name, yours: false })),
    { name: firstWord(accountName()), yours: false },
  ]
  const seen = new Set<string>()
  const candidates: Candidate[] = []
  for (const { name, yours } of raw) {
    const clean = name.normalize('NFC').trim().replace(/\s+/g, ' ')
    const key = clean.toLowerCase()
    if (!looksLikeName(clean) || seen.has(key)) continue
    seen.add(key)
    candidates.push({ name: clean, yours })
  }
  return candidates
}

/**
 * One to three words of letters (apostrophes and hyphens inside are fine: "D'Arcy", "Jean-Luc"), at least two
 * letters in all, and none of them a word from NOT_NAMES. Rules out digits, emoji, initials and "Home iPhone".
 */
export function looksLikeName(name: string): boolean {
  const words = name.split(' ')
  if (words.length > 3 || name.replace(/[^\p{L}]/gu, '').length < 2) return false
  return words.every((word) => /^\p{L}[\p{L}\p{M}'’-]*$/u.test(word) && !NOT_NAMES.has(word.toLowerCase()))
}

type Texts = { mine: string[]; others: string[] }

/** The text of every real message (not reactions), yours and everyone else's. */
function splitTexts(messages: readonly Message[]): Texts {
  const texts: Texts = { mine: [], others: [] }
  for (const m of messages) {
    if (m.text && !m.reactionType) (m.isFromMe ? texts.mine : texts.others).push(m.text.normalize('NFC'))
  }
  return texts
}

/**
 * True when at least MIN_MENTIONS messages from other people use the name as a whole word (any case), and they
 * use it at least SELF_USE_RATIO times as often as you do. People rarely text their own name, while a friend's
 * name or an everyday word ("general") comes up about as often from you as from everyone else.
 */
function isBackedByChats(name: string, { mine, others }: Texts): boolean {
  const pattern = wholeWord(name)
  const fromOthers = others.filter((text) => pattern.test(text)).length
  if (fromOthers < MIN_MENTIONS) return false
  const fromMe = mine.filter((text) => pattern.test(text)).length
  // fromMe / mine.length * SELF_USE_RATIO <= fromOthers / others.length, without dividing
  return fromMe * SELF_USE_RATIO * others.length <= fromOthers * mine.length
}

function wholeWord(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, 'iu')
}

/**
 * The capitalised name other people put right after a greeting at the start of a message in one-on-one chats
 * ("Hey Sam!", "happy birthday Sam"): in a chat with one other person, that can only be you. Only when it's
 * clearly one name: at least MIN_MENTIONS greetings from MIN_GREETERS different chats, and at least twice as
 * many as any other name. Else ''.
 */
function greetedName(messages: readonly Message[], dmChatIds: ReadonlySet<number>): string {
  const counts = new Map<string, number>()
  const chats = new Map<string, Set<number>>()
  for (const m of messages) {
    if (m.isFromMe || !m.text || m.reactionType || !dmChatIds.has(m.chatId)) continue
    const name = nameAfterGreeting(m.text)
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
    chats.set(name, (chats.get(name) ?? new Set()).add(m.chatId))
  }
  const [top, runnerUp] = [...counts].sort((a, b) => b[1] - a[1])
  if (!top || top[1] < MIN_MENTIONS || chats.get(top[0])!.size < MIN_GREETERS) return ''
  if (runnerUp && runnerUp[1] * 2 > top[1]) return ''
  return top[0]
}

/** Capitalised words that can follow a greeting but aren't a name ("Thanks Again", "Hey All"). */
const AFTER_GREETING = new Set(['again', 'so', 'too', 'lol', 'omg', 'everybody', 'for', 'and', 'just'])

/**
 * "Hey Sam, you in?" → "Sam". Only a capitalised word straight after the greeting, with nothing but spaces or a
 * comma between them, so "Hey. Will you come?" (a new sentence) isn't "Will". Names that are also everyday words
 * ("Will", "Mark", "Grace") count; nicknames like "Bro" don't.
 */
function nameAfterGreeting(text: string): string | null {
  const words = text.normalize('NFC').trim().split(/[\s,]+/, 3)
  const [a = '', b = ''] = words.map((word) => word.toLowerCase())
  const token = isGreeting(`${a} ${b}`) ? words[2] : isGreeting(a) ? words[1] : undefined
  // Punctuation or emoji after the name is fine ("Sam!!", "Sam🎂").
  const name = token?.replace(/[^\p{L}\p{M}]+$/u, '')
  if (!name || !/^\p{Lu}\p{Ll}+$/u.test(name)) return null
  const lower = name.toLowerCase()
  return NOT_NAMES.has(lower) || AFTER_GREETING.has(lower) || isGreeting(lower) ? null : name
}

/** A greeting as typed, or stretched ("heyyy" → "hey", "hii" → "hi"). */
function isGreeting(phrase: string): boolean {
  return GREETINGS.has(phrase) || GREETINGS.has(phrase.replace(/(\p{L})\1+$/u, '$1'))
}

/** The Mac account's full name ("Smit Patel"), or '' if it can't be read. */
export function macAccountName(): string {
  try {
    return execFileSync('id', ['-F'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim()
  } catch {
    return ''
  }
}

/**
 * The Apple Account this Mac is signed in to. The name comes from the account cache macOS keeps
 * (com.apple.appleaccount.informationcache: AAAccountFullName, while AAIsAccountSignedIn), else from
 * MobileMeAccounts.plist on older macOS (Accounts[0].DisplayName). The email from MobileMeAccounts.plist
 * (Accounts[0].AccountID), else from the Accounts database (the AppleAccount's user name). Never logged.
 */
export function readAppleAccount(openSqlite: OpenSqlite, home: string = os.homedir()): AppleAccount {
  const prefs = path.join(home, 'Library', 'Preferences')
  const cache = path.join(prefs, 'com.apple.appleaccount.informationcache.plist')
  const mobileMe = path.join(prefs, 'MobileMeAccounts.plist')
  const signedIn = plistValue(cache, 'AAIsAccountSignedIn') !== 'false'
  const name = (signedIn ? plistValue(cache, 'AAAccountFullName') : '') || plistValue(mobileMe, 'Accounts:0:DisplayName')
  const email = plistValue(mobileMe, 'Accounts:0:AccountID') || appleAccountUserName(openSqlite, home)
  return { name, email }
}

/** One value from a plist, as PlistBuddy prints it ("true" for a boolean), or '' when the file or key is missing. */
function plistValue(file: string, keyPath: string): string {
  if (!fs.existsSync(file)) return ''
  try {
    const out = execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${keyPath}`, file], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    })
    return out.trim()
  } catch {
    return ''
  }
}

const APPLE_ACCOUNT_SQL = `
  SELECT a.ZUSERNAME AS userName FROM ZACCOUNT a JOIN ZACCOUNTTYPE t ON t.Z_PK = a.ZACCOUNTTYPE
  WHERE t.ZIDENTIFIER = 'com.apple.account.AppleAccount' AND a.ZUSERNAME IS NOT NULL
  ORDER BY a.ZACTIVE DESC LIMIT 1`

/** The Apple Account's user name (its email, or phone number) from ~/Library/Accounts, or ''. */
function appleAccountUserName(openSqlite: OpenSqlite, home: string): string {
  const file = path.join(home, 'Library', 'Accounts', 'Accounts4.sqlite')
  if (!fs.existsSync(file)) return ''
  try {
    const [row] = readDatabaseCopy(file, openSqlite, (db) => db.all<{ userName: string }>(APPLE_ACCOUNT_SQL))
    return row?.userName.trim() ?? ''
  } catch {
    return ''
  }
}
