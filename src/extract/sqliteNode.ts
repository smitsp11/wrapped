import Database from 'better-sqlite3'
import type { OpenSqlite, SqlValue } from './sqlite'

export const openNodeSqlite: OpenSqlite = (file) => {
  const db = new Database(file, { readonly: true })
  return {
    all: <T>(sql: string, ...params: SqlValue[]) => db.prepare(sql).all(...params) as T[],
    close: () => db.close(),
  }
}
