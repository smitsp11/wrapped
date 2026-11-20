/** How long the app waits after the last page closes before it quits. Long enough for a reload or a slow network. */
export const CLOSE_AFTER_MS = 60_000

export type Presence = { pageOpened(): void; pageClosed(): void; stop(): void }

/**
 * Counts the open pages and calls `onIdle` once no page has been open for `afterMs`.
 * Nothing is counted until the first page opens, so a browser that is slow to start doesn't end the run.
 */
export function presence(onIdle: () => void, afterMs = CLOSE_AFTER_MS): Presence {
  let open = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  return {
    pageOpened() {
      open++
      cancel()
    },
    pageClosed() {
      open = Math.max(0, open - 1)
      if (open === 0) {
        cancel()
        timer = setTimeout(onIdle, afterMs)
      }
    },
    stop: cancel,
  }
}
