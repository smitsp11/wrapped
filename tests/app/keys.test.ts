import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { catchKeyboardErrors, isKeyboardError, keyAction, listenForKeys, NO_KEYBOARD, type KeyInput } from '../../src/app/keys'

function fakeTerminal(isTTY = true) {
  const events = new EventEmitter()
  const input = {
    isTTY,
    raw: false,
    paused: true,
    setRawMode(raw: boolean) {
      this.raw = raw
    },
    setEncoding: () => undefined,
    resume() {
      this.paused = false
    },
    pause() {
      this.paused = true
    },
    on: (event: 'data', listener: (chunk: string) => void) => events.on(event, listener),
    off: (event: 'data', listener: (chunk: string) => void) => events.off(event, listener),
    type: (text: string) => events.emit('data', text),
  }
  return input satisfies KeyInput
}

describe('keyAction', () => {
  it('o opens the page again, q / Ctrl-C / Ctrl-D quit, anything else is ignored', () => {
    expect(keyAction('o')).toBe('open')
    expect(keyAction('O')).toBe('open')
    expect(keyAction('q')).toBe('quit')
    expect(keyAction('Q')).toBe('quit')
    expect(keyAction('\u0003')).toBe('quit')
    expect(keyAction('\u0004')).toBe('quit')
    for (const key of ['x', ' ', '\r', '\u001b']) expect(keyAction(key)).toBeNull()
  })
})

describe('listenForKeys', () => {
  it('reads single keys in raw mode and reports o and q', () => {
    const terminal = fakeTerminal()
    const onAction = vi.fn()
    const stop = listenForKeys(terminal, onAction)
    expect(terminal.raw).toBe(true)
    expect(terminal.paused).toBe(false)
    terminal.type('x')
    terminal.type('o')
    terminal.type('\u0003')
    expect(onAction.mock.calls).toEqual([['open'], ['quit']])
    stop()
    expect(terminal.raw).toBe(false)
    expect(terminal.paused).toBe(true)
    terminal.type('q')
    expect(onAction).toHaveBeenCalledTimes(2)
  })
  it('does nothing when the input is not a terminal', () => {
    const terminal = fakeTerminal(false)
    const onAction = vi.fn()
    listenForKeys(terminal, onAction)()
    terminal.type('q')
    expect(terminal.raw).toBe(false)
    expect(onAction).not.toHaveBeenCalled()
  })
})

describe('a keyboard that cannot be read', () => {
  const kqueue = new Error('EINVAL: invalid argument, kqueue')

  it('recognises the /dev/tty read failure and nothing else', () => {
    expect(isKeyboardError(kqueue)).toBe(true)
    expect(isKeyboardError(new Error('disk full'))).toBe(false)
    expect(isKeyboardError('kqueue')).toBe(false)
    expect(NO_KEYBOARD).toBe('Open a new Terminal window and type: wrapped')
  })
  it('turns the error event (stdin, or an uncaught one from the prompts) into one plain line', () => {
    const stdin = new EventEmitter()
    const proc = new EventEmitter()
    const onKeyboard = vi.fn()
    const onOther = vi.fn()
    catchKeyboardErrors(stdin, proc, onKeyboard, onOther)
    stdin.emit('error', kqueue)
    proc.emit('uncaughtException', kqueue)
    expect(onKeyboard).toHaveBeenCalledTimes(2)
    const other = new Error('disk full')
    proc.emit('uncaughtException', other)
    expect(onOther).toHaveBeenCalledWith(other)
  })
  it('reports a terminal that refuses raw mode instead of throwing', () => {
    const terminal = fakeTerminal()
    terminal.setRawMode = () => {
      throw kqueue
    }
    const onBroken = vi.fn()
    expect(() => listenForKeys(terminal, vi.fn(), onBroken)()).not.toThrow()
    expect(onBroken).toHaveBeenCalledTimes(1)
  })
})
