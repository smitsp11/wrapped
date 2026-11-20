export type KeyAction = 'open' | 'quit'

/** What to do when the keyboard can't be read. */
export const NO_KEYBOARD = "Couldn't read the keyboard here. In a new window, type:  wrapped"

/**
 * Bun can't wait on a freshly opened /dev/tty on macOS (e.g. `exec wrapped < /dev/tty` from a piped script):
 * the first read fails with "EINVAL: invalid argument, kqueue". The installer avoids it with script(1).
 */
export function isKeyboardError(err: unknown): boolean {
  return err instanceof Error && /kqueue/.test(err.message)
}

type ErrorSource = { on(event: 'error', listener: (err: unknown) => void): unknown }
type Process = { on(event: 'uncaughtException', listener: (err: unknown) => void): unknown }

/**
 * A failed keyboard read surfaces as an 'error' event (on stdin, or on the readline the prompts use) that
 * nothing catches. This turns it into `onKeyboard` (one plain line) and any other uncaught error into `onOther`.
 */
export function catchKeyboardErrors(input: ErrorSource, proc: Process, onKeyboard: () => void, onOther: (err: unknown) => void): void {
  input.on('error', (err) => (isKeyboardError(err) ? onKeyboard() : onOther(err)))
  proc.on('uncaughtException', (err) => (isKeyboardError(err) ? onKeyboard() : onOther(err)))
}

/** o reopens the page; q, Ctrl-C and Ctrl-D quit. In raw mode Ctrl-C arrives as the character \u0003, not a signal. */
export function keyAction(key: string): KeyAction | null {
  switch (key.toLowerCase()) {
    case 'o':
      return 'open'
    case 'q':
    case '\u0003':
    case '\u0004':
      return 'quit'
    default:
      return null
  }
}

/** The part of process.stdin this needs, so tests can pass a fake. */
export type KeyInput = {
  isTTY?: boolean
  setRawMode?(raw: boolean): unknown
  setEncoding(encoding: 'utf8'): unknown
  resume(): unknown
  pause(): unknown
  on(event: 'data', listener: (chunk: string) => void): unknown
  off(event: 'data', listener: (chunk: string) => void): unknown
}

/**
 * Reads single key presses (no Enter needed) and reports o and q. Does nothing when the input isn't a
 * terminal. Returns a function that stops listening and puts the terminal back.
 */
export function listenForKeys(input: KeyInput, onAction: (action: KeyAction) => void, onBroken: () => void = () => undefined): () => void {
  if (!input.isTTY || !input.setRawMode) return () => undefined
  const onData = (chunk: string) => {
    for (const key of chunk) {
      const action = keyAction(key)
      if (action) onAction(action)
    }
  }
  try {
    input.setRawMode(true)
    input.setEncoding('utf8')
    input.on('data', onData)
    input.resume()
  } catch {
    onBroken()
    return () => undefined
  }
  return () => {
    input.off('data', onData)
    input.setRawMode?.(false)
    input.pause()
  }
}
