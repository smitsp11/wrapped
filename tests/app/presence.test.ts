import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOSE_AFTER_MS, presence } from '../../src/app/presence'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('presence (quit after the last page closes)', () => {
  it('quits about a minute after the last page closes', () => {
    const onIdle = vi.fn()
    const pages = presence(onIdle)
    pages.pageOpened()
    pages.pageClosed()
    vi.advanceTimersByTime(CLOSE_AFTER_MS - 1)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledTimes(1)
    expect(CLOSE_AFTER_MS).toBe(60_000)
  })
  it('keeps running while any page is open, and for a reload', () => {
    const onIdle = vi.fn()
    const pages = presence(onIdle, 1000)
    pages.pageOpened()
    pages.pageOpened() // a second tab (o in the terminal)
    pages.pageClosed()
    vi.advanceTimersByTime(5000)
    expect(onIdle).not.toHaveBeenCalled()
    pages.pageClosed()
    vi.advanceTimersByTime(500)
    pages.pageOpened() // the reload came back in time
    vi.advanceTimersByTime(5000)
    expect(onIdle).not.toHaveBeenCalled()
  })
  it('does not count down before the first page opens', () => {
    const onIdle = vi.fn()
    presence(onIdle, 1000)
    vi.advanceTimersByTime(10_000)
    expect(onIdle).not.toHaveBeenCalled()
  })
  it('stop cancels a countdown', () => {
    const onIdle = vi.fn()
    const pages = presence(onIdle, 1000)
    pages.pageOpened()
    pages.pageClosed()
    pages.stop()
    vi.advanceTimersByTime(5000)
    expect(onIdle).not.toHaveBeenCalled()
  })
})
