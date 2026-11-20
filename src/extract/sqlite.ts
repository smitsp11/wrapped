/** Values bound into queries. bigint is needed for Apple's nanosecond timestamps. */
export type SqlValue = string | number | bigint | null

/** The little we need from a SQLite library, so the same readers run on better-sqlite3 (Node, tests) and bun:sqlite (the app). */
export type SqliteDb = {
  /** T is not checked: it must match the column aliases in the SELECT. */
  all<T>(sql: string, ...params: SqlValue[]): T[]
  close(): void
}

/** Opens a private copy of a database (made by copyDatabase) for reading. Never pass the live file: drivers may create -wal/-shm files beside it. */
export type OpenSqlite = (file: string) => SqliteDb
