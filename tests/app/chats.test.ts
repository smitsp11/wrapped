import { describe, expect, it } from 'vitest'
import { mergeGroupChats, oneChatPerGroup, rankGroupChats } from '../../src/app/chats'
import type { DbChat } from '../../src/extract/messagesDb'
import type { Chat, Message } from '../../src/types'
import type { PersonName } from '../../src/wrap/names'

const ALEX = '+14165550101'
const SAM = '+14165550102'
const chat = (id: number, isGroup: boolean, name = '', memberIds: string[] = [ALEX, SAM]): Chat => ({
  id, name, isGroup, memberIds, messageCount: 0,
})
/** A group chat row with Apple's ids; by default its own fresh group, as Messages makes them. */
const row = (id: number, name: string, memberIds: string[], extra: Partial<DbChat> = {}): DbChat => ({
  id, name, isGroup: true, memberIds, messageCount: 0, groupId: `G${id}`, originalGroupId: `G${id}`, ...extra,
})
const ids = (chats: (Chat | DbChat)[]) => mergeGroupChats(chats).map((g) => g.chatIds)
const nameFor = (h: string): PersonName => (h === ALEX || h === 'alex@example.com' ? { full: 'Alex Chen', short: 'Alex' } : { full: 'Sam Rivera', short: 'Sam' })

describe('mergeGroupChats', () => {
  it('joins one group split over rows: same name, mostly the same members', () => {
    const [group] = mergeGroupChats([
      row(762, 'Gamers', ['a', 'b'], { messageCount: 50 }),
      row(73, 'Gamers', ['a', 'b', 'c'], { messageCount: 40 }),
      row(842, 'Gamers', ['a', 'b'], { messageCount: 2 }),
    ])
    expect(group).toEqual({ id: 73, chatIds: [73, 762, 842], name: 'Gamers', isGroup: true, memberIds: ['a', 'b', 'c'], messageCount: 92 })
  })
  it('keeps apart groups that share a name but not their people', () => {
    expect(ids([row(1, 'Family', ['mom', 'dad']), row(2, 'Family', ['aunt', 'uncle', 'cousin'])])).toEqual([[1], [2]])
    expect(ids([row(1, 'Roommates', ['a', 'b', 'c', 'd']), row(2, 'Roommates', ['a', 'e', 'f', 'g'])])).toEqual([[1], [2]])
  })
  it('joins at half the members in common, not below', () => {
    expect(ids([row(1, 'G', ['a', 'b', 'c']), row(2, 'G', ['a', 'b', 'd'])])).toEqual([[1, 2]]) // 2 of 4
    expect(ids([row(1, 'G', ['a', 'b', 'c']), row(2, 'G', ['a', 'd', 'e'])])).toEqual([[1], [2]]) // 1 of 5
  })
  it("never joins named groups you've left, which list no members", () => {
    expect(ids([row(1, 'Family', []), row(2, 'Family', [])])).toEqual([[1], [2]])
  })
  it("trusts Apple's ids, even when the members are listed under other handles", () => {
    expect(ids([row(1, 'Gamers', ['+1']), row(2, 'Gamers', ['x@example.com'], { originalGroupId: 'G1' })])).toEqual([[1, 2]])
    expect(ids([row(1, 'A', ['a']), row(2, 'A', ['b'], { originalGroupId: 'OLD' }), row(3, 'A', ['c'], { originalGroupId: 'OLD' })])).toEqual([[1], [2, 3]])
    expect(ids([row(1, '', ['a']), row(2, 'Named later', ['a'], { groupId: 'G1' })])).toEqual([[1, 2]])
  })
  it('joins rows linked through a third', () => {
    expect(ids([row(1, 'G', ['a', 'b']), row(2, 'G', ['a', 'b', 'c']), row(3, 'G', ['z'], { originalGroupId: 'G2' })])).toEqual([[1, 2, 3]])
  })
  it('joins unnamed groups only when their members are exactly the same', () => {
    expect(ids([row(1, '', ['a', 'b']), row(2, '', ['b', 'a'])])).toEqual([[1, 2]])
    expect(ids([row(1, '', ['a', 'b']), row(2, '', ['a', 'b', 'c'])])).toEqual([[1], [2]])
    expect(ids([row(1, '', ['a', 'b']), row(2, 'Trip', ['a', 'b'])])).toEqual([[1], [2]])
    expect(ids([row(1, '', []), row(2, '', [])])).toEqual([[1], [2]])
  })
  it('names a group after its busiest named row, and drops chats that are not groups', () => {
    const chats = [row(1, '', ['a'], { messageCount: 99 }), row(2, 'Old name', ['a'], { groupId: 'G1', messageCount: 5 }), row(3, 'New name', ['a'], { groupId: 'G1', messageCount: 9 })]
    expect(mergeGroupChats([...chats, chat(4, false)]).map((g) => g.name)).toEqual(['New name'])
  })
  it('works without Apple ids (older databases)', () => {
    expect(ids([chat(1, true, 'G'), chat(2, true, 'G'), chat(3, true, 'H')])).toEqual([[1, 2], [3]])
  })
})

describe('oneChatPerGroup', () => {
  const message = (id: number, chatId: number) => ({ id, chatId }) as Message
  it("labels every row's messages with the group's id, keeps a message in two rows once and leaves other chats alone", () => {
    const groups = mergeGroupChats([row(5, 'G', ['a']), row(9, 'G', ['a'])])
    const result = oneChatPerGroup([message(1, 5), message(2, 9), message(2, 5), message(3, 7)], groups)
    expect(result.map((m) => [m.id, m.chatId])).toEqual([[1, 5], [2, 5], [3, 7]])
  })
})

describe('rankGroupChats', () => {
  it('keeps group chats with messages this year, busiest first', () => {
    const chats = [chat(1, true, 'Quiet'), chat(2, true, 'Busy'), chat(3, false, 'A DM'), chat(4, true, 'Dead')]
    const counts = new Map([[1, 5], [2, 50], [3, 999]])
    expect(rankGroupChats(mergeGroupChats(chats), counts, nameFor).map((c) => [c.id, c.title, c.messages])).toEqual([
      [2, 'Busy', 50],
      [1, 'Quiet', 5],
    ])
  })
  it('lists a split group once, with every row counted and each person once', () => {
    const chats = [row(3, 'Gamers', [ALEX, SAM]), row(8, 'Gamers', [ALEX, SAM, 'alex@example.com']), row(4, 'Other', [SAM])]
    const ranked = rankGroupChats(mergeGroupChats(chats), new Map([[3, 10], [8, 20], [4, 25]]), nameFor)
    expect(ranked.map((c) => [c.id, c.chatIds, c.title, c.messages])).toEqual([
      [3, [3, 8], 'Gamers', 30],
      [4, [4], 'Other', 25],
    ])
    expect(ranked[0]!.memberNames).toEqual(['Alex', 'Sam'])
  })
  it('breaks ties by chat id and lists members by first name', () => {
    const chats = [chat(9, true, 'B'), chat(3, true, 'A')]
    const ranked = rankGroupChats(mergeGroupChats(chats), new Map([[9, 7], [3, 7]]), nameFor)
    expect(ranked.map((c) => c.id)).toEqual([3, 9])
    expect(ranked[0]!.memberNames).toEqual(['Alex', 'Sam'])
  })
  it('titles an unnamed group from member first names', () => {
    expect(rankGroupChats(mergeGroupChats([chat(1, true)]), new Map([[1, 3]]), nameFor)[0]!.title).toBe('Alex, Sam')
  })
  it('keeps a masked handle whole in memberNames', () => {
    const masked = (h: string): PersonName => (h === ALEX ? nameFor(h) : { full: '+1 ••• ••• 0199', short: '+1 ••• ••• 0199' })
    expect(rankGroupChats(mergeGroupChats([chat(1, true, 'G')]), new Map([[1, 3]]), masked)[0]!.memberNames).toEqual(['Alex', '+1 ••• ••• 0199'])
  })
})
