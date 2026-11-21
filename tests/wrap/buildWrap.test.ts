import { describe, expect, it } from 'vitest'
import { EmptyPeriodError } from '../../src/errors'
import { countWords } from '../../src/stats/words'
import { buildWrap } from '../../src/wrap/buildWrap'
import { msg, react } from '../../fixtures/messages'

const period = { from: new Date(2026, 0, 1), to: new Date(2027, 0, 1) }
const nameFor = (handle: string) => ({ '+14165550101': 'Alex Chen', '+14165550102': 'Sam Rivera' })[handle] ?? handle

describe('buildWrap', () => {
  it('replaces handles with short ids, busiest first, and keeps "me"', () => {
    const wrap = buildWrap(
      [
        msg({ senderId: '+14165550102', sentAt: '2026-03-01T10:00:00Z' }),
        msg({ senderId: '+14165550101', sentAt: '2026-03-01T10:01:00Z' }),
        msg({ senderId: '+14165550101', sentAt: '2026-03-01T10:02:00Z' }),
        msg({ senderId: 'me', sentAt: '2026-03-01T10:03:00Z' }),
        msg({ senderId: 'me', sentAt: '2025-12-31T10:03:00Z' }), // outside the period
      ],
      { mode: 'group', title: 'Test', ...period, nameFor },
    )
    expect(wrap.people).toEqual({ p1: 'Alex Chen', me: 'You', p2: 'Sam Rivera' })
    expect(wrap.volume.byPerson).toEqual({ p2: 1, p1: 2, me: 1 })
    expect(JSON.stringify(wrap)).not.toContain('+1416')
    expect(wrap.period).toEqual({ from: '2026-01-01', to: '2027-01-01' })
  })

  it('picks group top words against the baseline and never shows a name', () => {
    const say = (senderId: string, text: string, n: number) =>
      Array.from({ length: n }, (_, i) => msg({ senderId, text, sentAt: `2026-03-01T10:${String(i).padStart(2, '0')}:00Z` }))
    const chat = [...say('+14165550101', 'pizza, ramen, alex, taylor', 10), ...say('me', 'pizza, ramen, alex, taylor', 10)]
    const otherChats = say('+14165550199', 'pizza', 59).map((m) => ({ ...m, chatId: 2 }))
    const options = { mode: 'group', title: 'Test', ...period, nameFor, hiddenNames: ['Taylor Morgan'] } as const
    // Alex Chen is in the wrap and Taylor is in hiddenNames, so neither name is a top word
    expect(buildWrap(chat, options).words.topWords.map((w) => w.word)).toEqual(['pizza', 'ramen'])
    const wordBaseline = countWords([...chat, ...otherChats])
    expect(buildWrap(chat, { ...options, wordBaseline }).words.topWords.map((w) => w.word)).toEqual(['ramen'])
  })

  it('refuses an empty period', () => {
    expect(() => buildWrap([], { mode: 'group', title: 'Test', ...period, nameFor })).toThrow(EmptyPeriodError)
  })

  it('never lets a raw handle through, even when nameFor has no name', () => {
    const wrap = buildWrap(
      [msg({ senderId: '+14165550199', sentAt: '2026-03-01T10:00:00Z' }), msg({ senderId: 'me', sentAt: '2026-03-01T10:01:00Z' })],
      { mode: 'group', title: 'Test', ...period, nameFor: (h) => h },
    )
    expect(JSON.stringify(wrap)).not.toContain('4165550199')
  })

  it('reports period as local calendar dates in any timezone', () => {
    const old = process.env.TZ
    process.env.TZ = 'Europe/Paris'
    try {
      const wrap = buildWrap([msg({ senderId: 'me', sentAt: '2026-03-01T10:00:00Z' })], {
        mode: 'group', title: 'Test', from: new Date(2026, 0, 1), to: new Date(2027, 0, 1), nameFor,
      })
      expect(wrap.period.from).toBe('2026-01-01')
    } finally {
      if (old === undefined) delete process.env.TZ
      else process.env.TZ = old
    }
  })

  it('refuses a period with only reactions', () => {
    const target = msg({ senderId: 'me', sentAt: '2025-12-31T10:00:00Z' })
    expect(() =>
      buildWrap([target, react('+14165550101', target, 'love', '2026-03-01T10:00:00Z')], { mode: 'group', title: 'Test', ...period, nameFor }),
    ).toThrow(EmptyPeriodError)
  })

  it('gives a reactions-only person an id and a name', () => {
    const target = msg({ senderId: 'me', sentAt: '2026-03-01T10:00:00Z' })
    const wrap = buildWrap([target, react('+14165550101', target, 'love', '2026-03-01T10:01:00Z')], {
      mode: 'group', title: 'Test', ...period, nameFor,
    })
    expect(wrap.people).toEqual({ p1: 'Alex Chen', me: 'You' })
  })

  it('includes a message exactly at from and excludes one exactly at to', () => {
    const wrap = buildWrap(
      [msg({ senderId: 'me', sentAt: period.from.toISOString() }), msg({ senderId: 'me', sentAt: period.to.toISOString() })],
      { mode: 'group', title: 'Test', ...period, nameFor },
    )
    expect(wrap.volume.total).toBe(1)
  })

  describe('solo mode', () => {
    const handles = Array.from({ length: 7 }, (_, i) => `+1416555020${i}`)
    const messages = () => {
      const out = handles.flatMap((h, i) =>
        Array.from({ length: 60 - i * 5 }, (_, k) => msg({ senderId: h, chatId: i + 1, sentAt: `2026-03-01T10:${String(k % 60).padStart(2, '0')}:00Z`, text: `hi ${k}` })),
      )
      const mine = Array.from({ length: 60 }, (_, k) => msg({ senderId: 'me', chatId: 1, sentAt: `2026-03-02T10:${String(k).padStart(2, '0')}:00Z`, text: 'mine' }))
      const theirs = out.filter((m) => m.senderId === handles[6])[0]!
      const hit = mine[0]!
      return [...out, ...mine, react(handles[5]!, hit, 'love', '2026-03-02T11:00:00Z'), react(handles[6]!, hit, 'laugh', '2026-03-02T11:01:00Z'),
        react('me', theirs, 'love', '2026-03-02T11:02:00Z'), react(handles[0]!, theirs, 'love', '2026-03-02T11:03:00Z'),
        // the two collapsed contacts give the most reactions between them: "Everyone else" would win Hype Man
        // (one reactor per message, so none becomes a greatest hit)
        ...[1, 2, 3].map((i) => react(handles[5]!, mine[i]!, 'love', `2026-03-02T11:1${i}:00Z`)),
        ...[4, 5, 6].map((i) => react(handles[6]!, mine[i]!, 'like', `2026-03-02T11:2${i}:00Z`))]
    }
    // Your greatest hits only come from group chats, so chat 1, where your hit is, is one.
    const chatOne = [{ id: 1, name: 'Chat 1', isGroup: true, memberIds: [], messageCount: 120 }]
    const solo = buildWrap(messages(), { mode: 'solo', title: 'Test', ...period, nameFor: (h) => `Name ${h.slice(-1)}`, chats: chatOne })

    it('keeps you, five contacts and one "Everyone else"', () => {
      expect(Object.keys(solo.people).sort()).toEqual(['me', 'others', 'p1', 'p2', 'p3', 'p4', 'p5'])
      expect(solo.people.others).toBe('Everyone else')
      expect(solo.people.me).toBe('You')
    })

    it('never gives an award to "Everyone else"', () => {
      // without the exclusion, the two collapsed contacts would win Hype Man between them
      expect(solo.awards.some((a) => a.id === 'hype')).toBe(false)
      expect(solo.awards.some((a) => a.personId === 'others')).toBe(false)
      // control: the same messages with the two collapsed contacts as one person do give them Hype Man
      const merged = messages().map((m) => (m.senderId === handles[5] || m.senderId === handles[6] ? { ...m, senderId: handles[5]! } : m))
      const group = buildWrap(merged, { mode: 'group', title: 'Test', ...period, nameFor: (h) => `Name ${h.slice(-1)}` })
      const hype = group.awards.find((a) => a.id === 'hype')
      expect(hype && group.people[hype.personId]).toBe('Name 5')
    })

    it('gives a count award to the best real contact when "Everyone else" has more', () => {
      // "Everyone else" (chats 6 and 7) starts 8 conversations; Name 2 starts 5, the best of the real contacts
      const day = (d: number) => `2026-04-${String(d).padStart(2, '0')}T10:00:00Z`
      const extra = [
        ...[1, 2, 3, 4, 5, 6].map((d) => msg({ senderId: handles[6]!, chatId: 7, sentAt: day(d), text: 'again' })),
        ...[1, 2, 3, 4].map((d) => msg({ senderId: handles[1]!, chatId: 2, sentAt: day(d), text: 'again' })),
      ]
      const wrap = buildWrap([...messages(), ...extra], { mode: 'solo', title: 'Test', ...period, nameFor: (h) => `Name ${h.slice(-1)}` })
      expect(wrap.starters.startsByPerson.others).toBe(8)
      const starter = wrap.awards.find((a) => a.id === 'starter')
      expect(starter && wrap.people[starter.personId]).toBe('Name 1')
      expect(starter?.value).toBe(5)
      expect(wrap.awards.some((a) => a.personId === 'others')).toBe(false)
    })

    it('keeps only your own messages as greatest hits, counting everyone\'s reactions', () => {
      expect(solo.greatestHits.length).toBe(1)
      expect(solo.greatestHits.every((h) => h.senderId === 'me')).toBe(true)
      expect(solo.greatestHits[0]!.reactions).toBe(2)
    })
    it('ranks your hits across every chat by the share of that chat who reacted, even when friends have bigger hits', () => {
      const big = Array.from({ length: 9 }, (_, i) => `+141655503${String(i).padStart(2, '0')}`)
      const trio = ['+14165550390', '+14165550391']
      const at = (day: number) => `2026-05-${String(day).padStart(2, '0')}T10:00:00Z`
      // Twelve of your friends' messages that the whole big chat reacted to: more reactions than any of yours.
      const theirs = Array.from({ length: 12 }, (_, i) => msg({ senderId: big[i % 9]!, chatId: 10, sentAt: at(i + 1), text: `theirs ${i}` }))
      const mine = (text: string, chatId: number, day: number) => msg({ senderId: 'me', chatId, sentAt: at(day), text })
      const fiveOfNine = mine('5 of 9', 10, 20)
      const twoOfTwo = mine('2 of 2', 11, 21)
      const threeOfNine = mine('3 of 9', 10, 22)
      const twoOfNine = mine('2 of 9', 10, 23)
      const reacted = (m: ReturnType<typeof msg>, who: string[]) => who.map((h) => react(h, m, 'love', at(28)))
      const all = [
        ...theirs, fiveOfNine, twoOfTwo, threeOfNine, twoOfNine,
        ...theirs.flatMap((m) => reacted(m, [...big.filter((h) => h !== m.senderId), 'me'])),
        ...reacted(fiveOfNine, big.slice(0, 5)), ...reacted(twoOfTwo, trio), ...reacted(threeOfNine, big.slice(0, 3)), ...reacted(twoOfNine, big.slice(0, 2)),
      ]
      const chats = [
        { id: 10, name: 'Big', isGroup: true, memberIds: big, messageCount: 16 },
        { id: 11, name: 'Trio', isGroup: true, memberIds: trio, messageCount: 1 },
      ]
      const wrap = buildWrap(all, { mode: 'solo', title: 'Test', ...period, nameFor: (h) => `Name ${h.slice(-2)}`, chats })
      expect(wrap.greatestHits.map((h) => [h.text, h.reactions])).toEqual([['2 of 2', 2], ['5 of 9', 5], ['3 of 9', 3], ['2 of 9', 2]])
      expect(wrap.greatestHits.slice(0, 3).every((h) => h.conversation)).toBe(true)
    })
    it('takes your hits only from your 5 busiest group chats this year, ranked like Top chats', () => {
      const friends = ['+14165550401', '+14165550402']
      const day = (d: number, minute = 0) => `2026-06-${String(d).padStart(2, '0')}T10:${String(minute).padStart(2, '0')}:00Z`
      // Group chats 21-27, busiest first by everyone's messages (chat 27 is the quietest), and a 1:1 chat (28) busier
      // than all of them. Chat 26 has the most of *your* messages, but fewer in all than chat 25.
      const totals = new Map([[21, 40], [22, 35], [23, 30], [24, 25], [25, 20], [26, 15], [27, 10], [28, 60]])
      const filler = [...totals].flatMap(([chatId, total]) =>
        Array.from({ length: total }, (_, k) =>
          msg({ senderId: chatId === 26 || k % 2 ? 'me' : friends[0]!, chatId, sentAt: day(1 + (k % 20), Math.floor(k / 20)), text: `chat ${chatId} filler` }),
        ),
      )
      // In each chat, one of yours that both of the others reacted to; the ones in chats 26-28 are the oldest, so they
      // would win any tie.
      const hits = [...totals.keys()].map((chatId) =>
        msg({ senderId: 'me', chatId, sentAt: day(chatId >= 26 ? 22 : 25, chatId - 20), text: `hit in chat ${chatId}` }),
      )
      const reactions = hits.flatMap((m) => friends.map((f) => react(f, m, 'laugh', day(28))))
      const chats = [...totals.keys()].map((id) => ({ id, name: `Chat ${id}`, isGroup: id !== 28, memberIds: id === 28 ? [friends[0]!] : friends, messageCount: 0 }))
      const wrap = buildWrap([...filler, ...hits, ...reactions], { mode: 'solo', title: 'Test', ...period, nameFor: (h) => `Name ${h.slice(-1)}`, chats })
      expect(wrap.topChats.map((c) => c.name)).toEqual(['Chat 28', 'Chat 21', 'Chat 22', 'Chat 23', 'Chat 24'])
      expect(wrap.greatestHits.map((h) => h.text)).toEqual(['hit in chat 21', 'hit in chat 22', 'hit in chat 23', 'hit in chat 24', 'hit in chat 25'])
      expect(wrap.greatestHits.map((h) => h.conversation?.title)).toEqual(['Chat 21', 'Chat 22', 'Chat 23', 'Chat 24', 'Chat 25'])
    })

    it('gives no hits when no chat is known to be a group', () => {
      const wrap = buildWrap(messages(), { mode: 'solo', title: 'Test', ...period, nameFor: (h) => `Name ${h.slice(-1)}` })
      expect(wrap.greatestHits).toEqual([])
    })

    it("carries each quote's conversation, titled with its chat; people outside your top 5 are named in it", () => {
      const at = (minute: number) => `2026-03-03T10:0${minute}:00Z`
      const hit = msg({ senderId: 'me', chatId: 9, sentAt: at(2), text: 'count me in' })
      const all = [
        ...messages(),
        msg({ senderId: handles[6]!, chatId: 9, sentAt: at(0), text: "who's in" }),
        msg({ senderId: handles[0]!, chatId: 9, sentAt: at(1), text: 'me' }),
        hit,
        ...[5, 6, 0].map((i, k) => react(handles[i]!, hit, 'laugh', at(3 + k))),
      ]
      const chats = [{ id: 9, name: 'Ski Trip', isGroup: true, memberIds: [], messageCount: 3 }]
      const wrap = buildWrap(all, { mode: 'solo', title: 'Test', ...period, nameFor: (h) => `Name ${h.slice(-1)}`, chats })
      const convo = wrap.greatestHits.find((h) => h.text === 'count me in')!.conversation!
      expect(convo.title).toBe('Ski Trip')
      expect(wrap.people.p1).toBe('Name 0') // a top contact keeps their id in the wrap
      expect(convo.messages.map((m) => [m.senderId, m.text])).toEqual([['p6', "who's in"], ['p1', 'me'], ['me', 'count me in']])
      expect(convo.people).toEqual({ p6: 'Name 6' }) // not one of the wrap's people: named here
      expect(convo.messages[convo.hit]).toMatchObject({ senderId: 'me', laughs: 3 })
      expect(JSON.stringify(wrap)).not.toContain('+1416')
    })
  })

  it('caps top chats at 5, breaking ties by chat id', () => {
    const rows = [6, 5, 4, 3, 2, 1].map((chatId) => msg({ senderId: 'me', chatId, sentAt: '2026-03-01T10:00:00Z' }))
    const chats = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: id === 1 ? '' : `Chat ${id}`, isGroup: true, memberIds: [], messageCount: 1 }))
    const wrap = buildWrap(rows, { mode: 'solo', title: 'Test', ...period, nameFor, chats })
    expect(wrap.topChats.map((c) => c.name)).toEqual(['A chat', 'Chat 2', 'Chat 3', 'Chat 4', 'Chat 5'])
  })

  describe('your person month by month and the streak with one person', () => {
    // Six busy people in a group (chat 1), so all six are ahead of Priya, who only texts you 1:1 (chat 2), in March.
    const group = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((who, i) =>
      Array.from({ length: 10 + i }, (_, n) => msg({ senderId: `+1416555020${i}`, chatId: 1, sentAt: `2026-01-${String(n + 1).padStart(2, '0')}T12:00:00Z`, text: who })),
    )
    const priya = '+14165550299'
    const march = [1, 2, 3].flatMap((day) => [
      msg({ senderId: priya, chatId: 2, sentAt: `2026-03-0${day}T12:00:00Z` }),
      msg({ senderId: 'me', chatId: 2, sentAt: `2026-03-0${day}T12:05:00Z` }),
    ])
    const chats = [
      { id: 1, name: 'Group', isGroup: true, memberIds: group.map((m) => m.senderId), messageCount: group.length },
      { id: 2, name: '', isGroup: false, memberIds: [priya], messageCount: march.length },
    ]
    const names = (handle: string) => (handle === priya ? 'Priya Shah' : handle)
    const solo = () => buildWrap([...group, ...march], { mode: 'solo', title: 'Test', ...period, nameFor: names, chats })

    it('names someone outside your top contacts with the next id, and never their handle', () => {
      const wrap = solo()
      expect(Object.keys(wrap.people)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'me', 'others', 'p6'])
      expect(wrap.people.p6).toBe('Priya Shah')
      expect(wrap.topPersonByMonth).toEqual([null, null, 'p6', null, null, null, null, null, null, null, null, null])
      expect(wrap.personStreak).toEqual({ personId: 'p6', days: 3, from: '2026-03-01' })
      // Priya is still part of "Everyone else" in the other stats.
      expect(wrap.volume.byPerson.p6).toBeUndefined()
      expect(JSON.stringify(wrap)).not.toContain('5550299')
    })

    it('never makes you your own person: a chat with one of your own handles is skipped', () => {
      const me = '+14165550100'
      const notes = [1, 2, 3, 4, 5, 6, 7].flatMap((day) => [
        msg({ senderId: 'me', chatId: 3, sentAt: `2026-03-0${day}T13:00:00Z` }),
        msg({ senderId: me, chatId: 3, sentAt: `2026-03-0${day}T13:00:01Z` }), // Messages records the received copy too
      ])
      const withSelf = [...chats, { id: 3, name: '', isGroup: false, memberIds: [me], messageCount: notes.length }]
      const wrap = buildWrap([...group, ...march, ...notes], { mode: 'solo', title: 'Test', ...period, nameFor: names, chats: withSelf, ownHandles: [me] })
      expect(wrap.topPersonByMonth![2]).toBe('p6')
      expect(wrap.people.p6).toBe('Priya Shah')
      expect(wrap.personStreak).toMatchObject({ personId: 'p6', days: 3 })
      // Without knowing your handles, your notes would win March and the streak.
      const unaware = buildWrap([...group, ...march, ...notes], { mode: 'solo', title: 'Test', ...period, nameFor: names, chats: withSelf })
      expect(unaware.personStreak!.days).toBe(7)
    })

    it('masks a handle without a contact, like everywhere else', () => {
      const wrap = buildWrap([...group, ...march], { mode: 'solo', title: 'Test', ...period, nameFor: (h) => h, chats })
      expect(wrap.people.p6).toBe('+1 ••• ••• 0299')
      expect(JSON.stringify(wrap)).not.toContain('5550299')
    })

    it('leaves them out of a group wrap, and of a solo wrap with no 1:1 messages', () => {
      const group = buildWrap([...march], { mode: 'group', title: 'Test', ...period, nameFor: names })
      expect('topPersonByMonth' in group || 'personStreak' in group).toBe(false)
      const noDms = buildWrap(march, { mode: 'solo', title: 'Test', ...period, nameFor: names, chats: [] })
      expect('topPersonByMonth' in noDms || 'personStreak' in noDms).toBe(false)
    })

    it('carries a comparison with last year it is given, and none otherwise', () => {
      const vsLastYear = { year: 2025, percent: 18 }
      expect(buildWrap(march, { mode: 'group', title: 'Test', ...period, nameFor, vsLastYear }).vsLastYear).toEqual(vsLastYear)
      expect('vsLastYear' in buildWrap(march, { mode: 'group', title: 'Test', ...period, nameFor })).toBe(false)
    })
  })
})
