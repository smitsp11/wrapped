import { describe, expect, it } from 'vitest'
import { savedWrapsOption } from '../../src/app/savedWraps'
import type { SavedWrap } from '../../src/app/store'

const wrap = (n: number): SavedWrap => ({ id: `w${n}`, title: `Chat ${n}`, mode: 'group', savedAt: new Date(2026, 0, n) })

describe('savedWrapsOption', () => {
  it('is null when nothing is saved', () => {
    expect(savedWrapsOption([])).toBeNull()
  })
  it('shows the count and the first three titles', () => {
    const option = savedWrapsOption([1, 2, 3, 4, 5].map(wrap))
    expect(option).toEqual({ value: 'saved', label: '📂 Your saved wraps (5)', hint: 'Chat 1, Chat 2, Chat 3' })
  })
})
