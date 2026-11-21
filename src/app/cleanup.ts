import os from 'node:os'

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

/** Long enough for the event loop to go round once and handle a waiting signal; too short to notice. */
const SIGNAL_WAIT_MS = 50

/**
 * Lets a signal that arrived during synchronous work (reading Messages) be handled now. The program's signal handlers
 * exit, so once this returns no such signal is pending. Not a 0 ms timer: an expired timer runs before the loop looks
 * for signals, so it would return first.
 */
export function letSignalsIn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SIGNAL_WAIT_MS))
}

/** Thrown to stop the program cleanly (the user said no or cancelled). `main` catches it after `finally` blocks have run. */
export class Cancelled extends Error {}

/**
 * Runs `cleanup` if the program is stopped (closed terminal, kill) or exits any other way.
 * `cleanup` may run more than once, so it must be safe to repeat. Returns a function that unregisters it.
 */
export function onExit(cleanup: () => void): () => void {
  const handlers = SIGNALS.map((signal) => {
    const handler = () => {
      cleanup()
      process.exit(128 + os.constants.signals[signal])
    }
    process.once(signal, handler)
    return [signal, handler] as const
  })
  process.once('exit', cleanup)
  return () => {
    process.removeListener('exit', cleanup)
    for (const [signal, handler] of handlers) process.removeListener(signal, handler)
  }
}
