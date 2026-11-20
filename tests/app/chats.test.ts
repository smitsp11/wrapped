import { describe, expect, it } from 'vitest'
import { rankGroupChats } from '../../src/app/chats'
import type { Chat } from '../../src/types'
import type { PersonName } from '../../src/wrap/names'

const chat = (id: number, isGroup: boolean, name = '', memberIds: string[] = ['+14165550101', '+14165550102']): Chat => ({
  id, name, isGroup, memberIds, messageCount: 0,
})
const nameFor = (h: string): PersonName => (h === '+14165550101' ? { full: 'Alex Chen', short: 'Alex' } : { full: 'Sam Rivera', short: 'Sam' })

describe('rankGroupChats', () => {
  it('keeps group chats with messages this year, busiest first', () => {
    const chats = [chat(1, true, 'Quiet'), chat(2, true, 'Busy'), chat(3, false, 'A DM'), chat(4, true, 'Dead')]
    const counts = new Map([[1, 5], [2, 50], [3, 999]])
    expect(rankGroupChats(chats, counts, nameFor).map((c) => [c.id, c.title, c.messages])).toEqual([
      [2, 'Busy', 50],
      [1, 'Quiet', 5],
    ])
  })
  it('breaks ties by chat id and lists members by first name', () => {
    const chats = [chat(9, true, 'B'), chat(3, true, 'A')]
    const ranked = rankGroupChats(chats, new Map([[9, 7], [3, 7]]), nameFor)
    expect(ranked.map((c) => c.id)).toEqual([3, 9])
    expect(ranked[0]!.memberNames).toEqual(['Alex', 'Sam'])
  })
  it('titles an unnamed group from member first names', () => {
    expect(rankGroupChats([chat(1, true)], new Map([[1, 3]]), nameFor)[0]!.title).toBe('Alex, Sam')
  })
  it('keeps a masked handle whole in memberNames', () => {
    const masked = (h: string): PersonName => (h === '+14165550101' ? nameFor(h) : { full: '+1 ••• ••• 0199', short: '+1 ••• ••• 0199' })
    expect(rankGroupChats([chat(1, true, 'G')], new Map([[1, 3]]), masked)[0]!.memberNames).toEqual(['Alex', '+1 ••• ••• 0199'])
  })
})
