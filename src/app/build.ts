import { slug } from '../cliHelpers'
import { EmptyPeriodError, WrappedError } from '../errors'
import { soloTitle, type Session } from './session'
import { saveWrap } from './store'

export type Selection = { kind: 'solo' } | { kind: 'groups'; chatIds: number[] }
export type BuildResult = { ids: string[]; failed: { title: string; message: string }[]; undecodable: number }

/**
 * Saved wraps are named after what they wrap, so the home page can tell which chats are already made.
 * A group names all its chat rows: a wrap saved before rows were merged (one row, too few messages)
 * no longer matches a merged group, so it shows as not made and is built again in full.
 */
export const soloWrapId = (year: number) => `me-${year}`
export const groupWrapId = (title: string, chatIds: number[], year: number) => `${slug(title)}-${chatIds.join('-')}-${year}`

/** Builds and saves each picked wrap. One chat failing (e.g. no messages in the period) doesn't stop the others. */
export function buildSelection(session: Session, selection: Selection, appDir: string): BuildResult {
  const result: BuildResult = { ids: [], failed: [], undecodable: 0 }
  const year = session.period.year
  const jobs =
    selection.kind === 'solo'
      ? [{ id: soloWrapId(year), title: soloTitle(year), build: () => session.buildSolo() }]
      : selection.chatIds.map((chatId) => {
          const group = session.groups.find((g) => g.chatIds.includes(chatId))
          const title = group?.title ?? 'A group chat'
          return { id: groupWrapId(title, group?.chatIds ?? [chatId], year), title, build: () => session.buildGroup(chatId) }
        })
  // Two ids of one group (or one id twice) make one wrap.
  for (const job of new Map(jobs.map((j) => [j.id, j])).values()) {
    try {
      const { wrap, undecodable } = job.build()
      saveWrap(appDir, job.id, wrap)
      result.ids.push(job.id)
      result.undecodable += undecodable
    } catch (err) {
      if (!(err instanceof WrappedError)) throw err
      const message = err instanceof EmptyPeriodError ? 'No messages in this period.' : err.message
      result.failed.push({ title: job.title, message })
    }
  }
  return result
}
