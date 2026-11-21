import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { terminalName } from '../app/access'
import { MissingDatabaseError, NoFullDiskAccessError, errorCode } from '../errors'
import type { Chat, HistorySpan } from '../types'
import { appleMsToDate, toAppleNs } from './appleTime'
import { copyDatabase } from './copyDb'
import type { MessageRow } from './normalize'
import type { OpenSqlite, SqliteDb } from './sqlite'

export const DEFAULT_CHAT_DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db')

const GROUP_STYLE = 43
const MEMBER_SEPARATOR = '\u001f'

/** Older databases may lack group_id or original_group_id, so each is read only when the column exists. */
const chatsSql = (columns: Set<string>) => `
  SELECT c.ROWID AS id, COALESCE(c.display_name, '') AS name, c.style AS style,
    ${columns.has('group_id') ? "COALESCE(c.group_id, '')" : "''"} AS groupId,
    ${columns.has('original_group_id') ? "COALESCE(c.original_group_id, '')" : "''"} AS originalGroupId,
    (SELECT COUNT(*) FROM chat_message_join j WHERE j.chat_id = c.ROWID) AS messageCount,
    (SELECT GROUP_CONCAT(h.id, char(31)) FROM chat_handle_join chj
       JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID) AS members
  FROM chat c
  ORDER BY messageCount DESC, c.ROWID`

type ChatRow = { id: number; name: string; style: number; groupId: string; originalGroupId: string; messageCount: number; members: string | null }

/**
 * A chat row plus Apple's ids for the group it belongs to ('' when missing). Messages can keep one group
 * as several rows; rows that share these ids are the same group (see mergeGroupChats).
 */
export type DbChat = Chat & { groupId: string; originalGroupId: string }

/**
 * The type of a message's first attachment, for "📷 Photo" / "🎥 Video": its MIME type ("image/heic"), or its UTI
 * ("public.jpeg") when that's empty. Only the type is read, never the file or its name. NULL when the database has no
 * attachment tables (the message still counts as an attachment).
 */
function attachmentTypeSql(columns: Set<string>, hasJoin: boolean): string {
  if (!hasJoin || !columns.has('mime_type') || !columns.has('uti')) return 'NULL'
  return `CASE WHEN m.cache_has_attachments = 1 THEN (
      SELECT COALESCE(NULLIF(a.mime_type, ''), a.uti) FROM message_attachment_join ma
      JOIN attachment a ON a.ROWID = ma.attachment_id
      WHERE ma.message_id = m.ROWID ORDER BY a.ROWID LIMIT 1) END`
}

/**
 * The first attachment of the message with this guid: where Messages keeps the file and its type. Only the local app's
 * preview asks for it, for the photos in a conversation; the name never leaves this Mac. NULL when the database has
 * no attachment tables.
 */
function attachmentFileSql(columns: Set<string>, hasJoin: boolean): string | null {
  if (!hasJoin || !columns.has('filename') || !columns.has('mime_type') || !columns.has('uti')) return null
  return `SELECT a.filename AS filename, COALESCE(NULLIF(a.mime_type, ''), a.uti) AS type
    FROM message m JOIN message_attachment_join ma ON ma.message_id = m.ROWID
    JOIN attachment a ON a.ROWID = ma.attachment_id
    WHERE m.guid = ? ORDER BY a.ROWID LIMIT 1`
}

/** A message's first attachment: its path as Messages wrote it (often starting with "~/"), and its MIME type or UTI. */
export type AttachmentFile = { filename: string; type: string | null }

export type RowQuery = { chatIds?: number[]; from: Date; to: Date }

/** Read-only access to a copy of the Messages database. */
export class MessagesDb {
  private constructor(
    private readonly db: SqliteDb,
    private readonly tempDir: string,
    private readonly hasEmoji: boolean,
    private readonly chatsQuery: string,
    private readonly attachmentTypeQuery: string,
    private readonly attachmentFileQuery: string | null,
  ) {}

  static open(openSqlite: OpenSqlite, sourcePath: string = DEFAULT_CHAT_DB): MessagesDb {
    let copy: { path: string; dir: string }
    try {
      copy = copyDatabase(sourcePath)
    } catch (err) {
      const code = errorCode(err)
      if (code === 'ENOENT') throw new MissingDatabaseError(sourcePath)
      if (code === 'EPERM' || code === 'EACCES') throw new NoFullDiskAccessError(terminalName())
      throw err
    }
    let db: SqliteDb | undefined
    try {
      db = openSqlite(copy.path)
      // Older macOS has no associated_message_emoji (it came with emoji tapbacks).
      const columns = db.all<{ name: string }>('PRAGMA table_info(message)')
      const hasEmoji = columns.some((c) => c.name === 'associated_message_emoji')
      const chatsQuery = chatsSql(new Set(db.all<{ name: string }>('PRAGMA table_info(chat)').map((c) => c.name)))
      db.all(`${chatsQuery} LIMIT 0`) // fails here, not later, if this isn't a Messages database
      const attachmentColumns = new Set(db.all<{ name: string }>('PRAGMA table_info(attachment)').map((c) => c.name))
      const hasJoin = db.all('PRAGMA table_info(message_attachment_join)').length > 0
      return new MessagesDb(
        db, copy.dir, hasEmoji, chatsQuery, attachmentTypeSql(attachmentColumns, hasJoin), attachmentFileSql(attachmentColumns, hasJoin),
      )
    } catch (err) {
      try {
        db?.close()
      } catch {
        // keep the original error, not a failure to close
      } finally {
        fs.rmSync(copy.dir, { recursive: true, force: true })
      }
      throw err
    }
  }

  listChats(): DbChat[] {
    return this.db.all<ChatRow>(this.chatsQuery).map((r) => ({
      id: r.id,
      name: r.name,
      isGroup: r.style === GROUP_STYLE,
      memberIds: r.members ? r.members.split(MEMBER_SEPARATOR) : [],
      messageCount: r.messageCount,
      groupId: r.groupId,
      originalGroupId: r.originalGroupId,
    }))
  }

  /**
   * Real messages (item_type 0) in [from, to), oldest first.
   * A message joined to two of the chats comes back once per chat (rare; see oneChatPerGroup).
   */
  messageRows({ chatIds, from, to }: RowQuery): MessageRow[] {
    if (chatIds && chatIds.length === 0) return []
    const chatFilter = chatIds ? `AND j.chat_id IN (${chatIds.map(() => '?').join(', ')})` : ''
    const sql = `
      SELECT m.ROWID AS id, m.guid AS guid, j.chat_id AS chatId, m.is_from_me AS isFromMe, h.id AS handle,
        m.date / 1000000 AS dateMs, m.text AS text,
        CASE WHEN m.text IS NULL OR m.text = '' THEN m.attributedBody END AS body,
        m.cache_has_attachments AS hasAttachment, ${this.attachmentTypeQuery} AS attachmentType,
        m.associated_message_guid AS assocGuid,
        m.associated_message_type AS assocType, ${this.hasEmoji ? 'm.associated_message_emoji' : 'NULL'} AS assocEmoji
      FROM message m
      JOIN chat_message_join j ON j.message_id = m.ROWID
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.item_type = 0 AND m.date >= ? AND m.date < ? ${chatFilter}
      ORDER BY m.date, m.ROWID`
    return this.db.all<MessageRow>(sql, toAppleNs(from), toAppleNs(to), ...(chatIds ?? []))
  }

  /**
   * Real messages per chat in [from, to), not counting reactions. Chats with none are absent.
   * Can run a little above a wrap's message total, since rows that can't be decoded still count
   * (fine for ranking and approximate labels).
   */
  messageCountsByChat(from: Date, to: Date): Map<number, number> {
    const rows = this.db.all<{ chatId: number; count: number }>(
      `SELECT j.chat_id AS chatId, COUNT(*) AS count
       FROM message m JOIN chat_message_join j ON j.message_id = m.ROWID
       WHERE m.item_type = 0 AND COALESCE(m.associated_message_type, 0) = 0 AND m.date >= ? AND m.date < ?
       GROUP BY j.chat_id`,
      toAppleNs(from),
      toAppleNs(to),
    )
    return new Map(rows.map((r) => [r.chatId, r.count]))
  }

  /**
   * The oldest and newest real message (in a chat, with a real date), or null if there are none.
   * It can't see gaps in the middle, only the ends.
   */
  messageSpan(): HistorySpan | null {
    const [row] = this.db.all<{ first: number | null; last: number | null }>(
      `SELECT MIN(date) / 1000000 AS first, MAX(date) / 1000000 AS last FROM message
       WHERE item_type = 0 AND date > 0
         AND EXISTS (SELECT 1 FROM chat_message_join j WHERE j.message_id = message.ROWID)`,
    )
    if (!row || row.first === null || row.last === null) return null
    return { earliest: appleMsToDate(row.first), latest: appleMsToDate(row.last) }
  }

  /**
   * The phone numbers and emails you send from, most used first, for finding your own contact card.
   * Messages notes them on your sent messages, destination_caller_id ("+14165550100") and account
   * ("E:me@icloud.com", "P:+1416…"), and on each chat: the account it's signed in with (account_login) and
   * the handle you last wrote from (last_addressed_handle). The chat ones count even when no message in
   * the database has them. Older databases may lack any of these columns. Handles only, never text.
   */
  ownHandles(): string[] {
    const columnsOf = (table: string) => new Set(this.db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name))
    const message = columnsOf('message')
    const chat = columnsOf('chat')
    const sources = [
      ...['destination_caller_id', 'account'].filter((c) => message.has(c)).map((c) => ({ table: 'message', column: c, mine: 'is_from_me = 1 AND' })),
      ...['account_login', 'last_addressed_handle'].filter((c) => chat.has(c)).map((c) => ({ table: 'chat', column: c, mine: '' })),
    ]
    const counts = new Map<string, number>()
    for (const { table, column, mine } of sources) {
      const rows = this.db.all<{ handle: string; n: number }>(
        `SELECT ${column} AS handle, COUNT(*) AS n FROM ${table}
         WHERE ${mine} ${column} IS NOT NULL AND ${column} != ''
         GROUP BY ${column} ORDER BY n DESC LIMIT 5`,
      )
      for (const row of rows) {
        const handle = row.handle.replace(/^[a-z]:/i, '').trim() // "E:" / "P:" say which kind it is
        if (handle) counts.set(handle, (counts.get(handle) ?? 0) + row.n)
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([handle]) => handle)
  }

  /** The first attachment of the message with this guid, or null when it has none (or no file name). */
  attachmentFile(messageGuid: string): AttachmentFile | null {
    if (!this.attachmentFileQuery) return null
    const [row] = this.db.all<{ filename: string | null; type: string | null }>(this.attachmentFileQuery, messageGuid)
    return row?.filename ? { filename: row.filename, type: row.type } : null
  }

  close(): void {
    try {
      this.db.close()
    } finally {
      fs.rmSync(this.tempDir, { recursive: true, force: true })
    }
  }
}
