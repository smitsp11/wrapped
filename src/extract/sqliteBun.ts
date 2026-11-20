import { Database, type SQLQueryBindings } from 'bun:sqlite'
import type { OpenSqlite, SqlValue } from './sqlite'

/** Used by the compiled app (src/app) and the Bun parity tests. Node and vitest use sqliteNode.ts. */
export const openBunSqlite: OpenSqlite = (file) => {
  // Not readonly: Bun can't open a WAL-mode file read-only when neither -wal nor -shm exists (a cleanly
  // closed database, like the test fixture). Callers only pass a private copy from copyDatabase
  // (MessagesDb.open and ContactBook's readContacts), SQLite only writes -wal/-shm beside that copy,
  // and nothing changes data.
  const db = new Database(file, { readwrite: true })
  return {
    all: <T>(sql: string, ...params: SqlValue[]) => db.query(sql).all(...(params as SQLQueryBindings[])) as T[],
    close: () => db.close(),
  }
}
