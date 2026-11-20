import { slug } from '../cliHelpers'
import { EmptyPeriodError, WrappedError } from '../errors'
import { soloTitle, type Session } from './session'
import { saveWrap } from './store'

export type Selection = { kind: 'solo' } | { kind: 'groups'; chatIds: number[] }
export type BuildResult = { ids: string[]; failed: { title: string; message: string }[]; undecodable: number }

/** Builds and saves each picked wrap. One chat failing (e.g. no messages in the period) doesn't stop the others. */
export function buildSelection(session: Session, selection: Selection, appDir: string): BuildResult {
  const result: BuildResult = { ids: [], failed: [], undecodable: 0 }
  const year = session.period.year
  const jobs =
    selection.kind === 'solo'
      ? [{ id: `me-${year}`, title: soloTitle(year), build: () => session.buildSolo() }]
      : [...new Set(selection.chatIds)].map((chatId) => {
          const title = session.groups.find((g) => g.id === chatId)?.title ?? 'A group chat'
          return { id: `${slug(title)}-${chatId}-${year}`, title, build: () => session.buildGroup(chatId) }
        })
  for (const job of jobs) {
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
