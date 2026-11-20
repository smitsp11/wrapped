import { describe, expect, it } from 'vitest'
import { groupOptions, SEE_ALL } from '../../src/app/terminalPicker'
import type { RankedChat } from '../../src/app/chats'

const groups: RankedChat[] = Array.from({ length: 7 }, (_, i) => ({
  id: i + 1, title: `Chat ${i + 1}`, messages: 1000 - i, memberNames: ['Alex', 'Sam'],
}))

describe('groupOptions', () => {
  it('shows the top 5 and a "see all" row', () => {
    const options = groupOptions(groups, false)
    expect(options.map((o) => o.value)).toEqual([1, 2, 3, 4, 5, SEE_ALL])
    expect(options[0]).toEqual({ value: 1, label: 'Chat 1', hint: '1,000 msgs · 3 people' })
    expect(options[5]!.label).toBe('↓ See all 7 group chats')
  })
  it('shows everything once expanded', () => {
    expect(groupOptions(groups, true).map((o) => o.value)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
