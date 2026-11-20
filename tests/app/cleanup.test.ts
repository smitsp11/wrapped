import { describe, expect, it } from 'vitest'
import { onExit } from '../../src/app/cleanup'

describe('onExit', () => {
  it('registers an exit listener and the returned function removes it', () => {
    const before = process.listenerCount('exit')
    const sigBefore = process.listenerCount('SIGINT')
    const unregister = onExit(() => undefined)
    expect(process.listenerCount('exit')).toBe(before + 1)
    expect(process.listenerCount('SIGINT')).toBe(sigBefore + 1)
    unregister()
    expect(process.listenerCount('exit')).toBe(before)
    expect(process.listenerCount('SIGINT')).toBe(sigBefore)
  })
})
