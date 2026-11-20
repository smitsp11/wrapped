import { describe, expect, it } from 'vitest'
import { countWords, emojis, phrases, tokenize, wordStats } from '../../src/stats/words'
import { STOPWORDS } from '../../src/stats/stopwords'
import { msg, react } from '../../fixtures/messages'

const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 10, i)).toISOString()
const many = (senderId: string, text: string, n: number, start = 0) =>
  Array.from({ length: n }, (_, i) => msg({ senderId, sentAt: at(start + i), text }))
const words = (list: { word: string }[]) => list.map((w) => w.word)

describe('tokenize', () => {
  it('lowercases, drops short words, stopwords, numbers and links', () => {
    expect(tokenize('The POKER is at https://x.com/abc 2026 7pm tonight!')).toEqual(['poker'])
  })

  it('drops links typed without http or www, and emails', () => {
    expect(tokenize('look www.example.com, rebuy.example.com/x and sam@example.com')).toEqual([])
  })

  it('drops texting filler and slang', () => {
    expect(tokenize('bro shi gotta acc tho lol lmao ngl idk lowkey deadass finna wit bruh literally')).toEqual([])
  })

  it('drops laughter and stretched filler in any length', () => {
    expect(tokenize('hahaha HAHAHAHA lmaooooo lolol hehe brooo yesss shiii nooo')).toEqual([])
    expect(tokenize('rebuyyy')).toEqual(['rebuyyy'])
  })

  it('treats curly apostrophes like straight ones, drops contractions and keeps possessives as the name', () => {
    expect(tokenize('doesn’t won’t I’m')).toEqual([])
    expect(tokenize('dealer’s choice')).toEqual(['dealer', 'choice'])
  })

  it('keeps words with combining marks whole', () => {
    expect(tokenize('नमस्ते दोस्त')).toEqual([
      'नमस्ते',
      'दोस्त',
    ])
    expect(tokenize('café')).toEqual(['café'])
  })

  it('has only lowercase stopwords, so every entry can match', () => {
    for (const word of STOPWORDS) expect(word).toBe(word.toLowerCase())
  })
})

it('finds emoji graphemes', () => {
  expect(emojis('bet 🃏 ok 👍🏽')).toEqual(['🃏', '👍🏽'])
})

it('counts flags and keycaps as emoji but not plain symbols', () => {
  expect(emojis('go \u{1F1E8}\u{1F1E6} 1️⃣')).toEqual(['\u{1F1E8}\u{1F1E6}', '1️⃣'])
  expect(emojis('brand™ © 2026')).toEqual([])
})

describe('phrases', () => {
  it('finds 2- and 3-word phrases in order, and can be made of stopwords', () => {
    expect(phrases('super calm tonight')).toEqual(['super calm'])
    expect(phrases('run it back')).toEqual(['run it back'])
  })

  it('never starts or ends a phrase with glue', () => {
    expect(phrases('i think in the end we are going to win')).toEqual([])
    expect(phrases('bro what idk tho')).toEqual([])
  })

  it('skips laughter, one word over and over, numbers and links', () => {
    expect(phrases('lol lol lmao hahaha omw omw')).toEqual([])
    expect(phrases('poker 2026 https://x.com/a chips')).toEqual([])
  })

  it('never runs across a sentence break', () => {
    expect(phrases('poker. chips, river')).toEqual([])
  })
})

describe('top words', () => {
  it('leaves out filler even when it is the most common thing said', () => {
    const messages = [...many('alex', 'bro gotta go tho', 50), ...many('sam', 'bro the rebuy', 10, 60), ...many('alex', 'rebuy', 5, 80)]
    expect(wordStats(messages).topWords).toEqual([{ word: 'rebuy', count: 15 }])
  })

  it('without a baseline, ranks by count', () => {
    const messages = [...many('alex', 'pizza', 30), ...many('sam', 'pizza ramen', 5, 40), ...many('alex', 'ramen', 5, 50)]
    expect(wordStats(messages).topWords).toEqual([
      { word: 'pizza', count: 35 },
      { word: 'ramen', count: 10 },
    ])
  })

  it('with a baseline, ranks the words this chat uses far more than your other chats first', () => {
    const chat = [...many('alex', 'pizza', 30), ...many('sam', 'pizza ramen', 5, 40), ...many('alex', 'ramen', 5, 50)]
    const otherChats = many('jordan', 'pizza', 500, 100)
    const stats = wordStats(chat, { baseline: countWords([...chat, ...otherChats]) })
    expect(stats.topWords).toEqual([{ word: 'ramen', count: 10 }])
  })

  it('treats a baseline with nothing beyond this chat like no baseline', () => {
    const chat = [...many('alex', 'pizza', 30), ...many('sam', 'pizza ramen', 5, 40), ...many('alex', 'ramen', 5, 50)]
    expect(wordStats(chat, { baseline: countWords(chat) }).topWords).toEqual(wordStats(chat).topWords)
  })

  it('needs 5 uses', () => {
    const base = [...many('alex', 'rebuy', 3), ...many('sam', 'rebuy', 1, 10)]
    expect(wordStats(base).topWords).toEqual([])
    expect(wordStats([...base, msg({ senderId: 'sam', sentAt: at(20), text: 'rebuy' })]).topWords).toEqual([{ word: 'rebuy', count: 5 }])
  })

  it('in a group, needs at least two people to use a word, so one person’s typo never wins', () => {
    const messages = [...many('alex', 'pokre', 40), ...many('alex', 'rebuy', 5, 50), ...many('sam', 'rebuy', 5, 60)]
    expect(words(wordStats(messages).topWords)).toEqual(['rebuy'])
  })

  it('folds plurals into the singular', () => {
    const messages = [...many('alex', 'rebuys', 4), ...many('sam', 'rebuy', 3, 10)]
    expect(wordStats(messages).topWords).toEqual([{ word: 'rebuy', count: 7 }])
  })

  it('drops misspellings of a much more common word', () => {
    const messages = [...many('alex', 'poker', 20), ...many('sam', 'poker pokre', 5, 30), ...many('alex', 'pokre', 1, 40)]
    expect(words(wordStats(messages).topWords)).toEqual(['poker'])
  })

  it('never shows the names of the people in it', () => {
    const messages = [...many('alex', 'classic jordan', 10), ...many('sam', 'jordan classic', 10, 20)]
    expect(words(wordStats(messages, { names: ['Jordan Lee'] }).topWords)).toEqual(['classic'])
  })

  it('ranks a catchphrase made of filler above common words, and drops the words inside it', () => {
    const chat = [...many('alex', 'super calm', 20), ...many('sam', 'super calm', 20, 30), ...many('sam', 'pizza', 20, 60)]
    const otherChats = [...many('jordan', 'pizza', 300, 100), ...many('jordan', 'super', 50, 400), ...many('jordan', 'super calm', 2, 500)]
    expect(wordStats(chat, { baseline: countWords([...chat, ...otherChats]) }).topWords).toEqual([{ word: 'super calm', count: 40 }])
  })

  it('shows a phrase and a word inside it when the word is mostly said on its own', () => {
    const messages = [...many('alex', 'river card', 5), ...many('sam', 'river card', 5, 10), ...many('alex', 'river', 30, 20)]
    // "card" is only ever said in "river card", so it isn't shown again; "river" mostly is said alone
    expect(words(wordStats(messages).topWords)).toEqual(['river', 'river card'])
  })

  it('shows one piece of a longer phrase, not every piece', () => {
    const messages = [...many('alex', 'stupid ideas club', 10), ...many('sam', 'stupid ideas club', 10, 20)]
    const shown = words(wordStats(messages, { baseline: countWords([...messages, ...many('jordan', 'pizza', 50, 100)]) }).topWords)
    expect(shown.filter((w) => w.includes(' '))).toHaveLength(1)
  })

  it('needs 5 uses by two people for a phrase, and never shows one with a name in it', () => {
    const base = [...many('alex', 'river card', 4), msg({ senderId: 'alex', sentAt: at(9), text: 'river card' }), msg({ senderId: 'sam', sentAt: at(10), text: 'deck' })]
    expect(words(wordStats(base).topWords)).toEqual([])
    const shared = [...many('alex', 'river card', 4), msg({ senderId: 'sam', sentAt: at(9), text: 'river card' })]
    expect(words(wordStats(shared).topWords)).toEqual(['river card'])
    expect(words(wordStats(shared, { names: ['River Song'] }).topWords)).toEqual(['card'])
  })

  it('without a baseline, ranks by count, a phrase counting double, and only with a real word in it', () => {
    const mine = [...many('me', 'super calm', 30), ...many('me', 'poker face', 10, 40), ...many('me', 'gym', 15, 60)]
    expect(wordStats(mine).topWords).toEqual([
      { word: 'poker face', count: 10 },
      { word: 'gym', count: 15 },
    ])
  })

  it('caps top words at 10 with alphabetical tie-break', () => {
    const list = Array.from({ length: 12 }, (_, i) => `w${String.fromCharCode(97 + i)}x`)
    const messages = [...list].reverse().flatMap((w, i) => many('alex', w, 5, i * 5))
    expect(words(wordStats(messages).topWords)).toEqual(list.slice(0, 10))
  })
})

describe('signature words', () => {
  // each signature word must be said at least once by someone else
  const once = (senderId: string, text: string, i: number) => msg({ senderId, sentAt: at(200 + i), text })

  it('gives each person the word they over-use compared with everyone else', () => {
    const messages = [...many('alex', 'poker night', 5), ...many('me', 'omw', 5, 10), once('me', 'poker', 0), once('alex', 'omw', 1)]
    expect(wordStats(messages).signatureWordByPerson).toEqual({ alex: 'poker', me: 'omw' })
  })

  it('gives no signature word to someone with nobody to compare with', () => {
    const others = Array.from({ length: 50 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}x`)
    const messages = [...many('alex', 'poker', 60), ...others.map((w, i) => msg({ senderId: 'alex', sentAt: at(100 + i), text: w }))]
    expect(wordStats(messages).signatureWordByPerson).toEqual({})
  })

  it('needs 5 uses', () => {
    const base = [...many('sam', 'deck', 10), once('alex', 'deck', 0), once('sam', 'omw', 1)]
    expect(wordStats([...base, ...many('alex', 'omw', 4, 20)]).signatureWordByPerson).toEqual({ sam: 'deck' })
    expect(wordStats([...base, ...many('alex', 'omw', 5, 20)]).signatureWordByPerson).toEqual({ sam: 'deck', alex: 'omw' })
  })

  it('needs someone else to have said it, so a personal typo never wins', () => {
    const messages = [...many('alex', 'pokre', 30), ...many('alex', 'river', 5, 40), ...many('sam', 'deck', 10, 50), once('sam', 'river', 0)]
    expect(wordStats(messages).signatureWordByPerson.alex).toBe('river')
  })

  it('is never filler or slang', () => {
    const messages = [...many('alex', 'wit deadass bruh', 20), ...many('alex', 'river', 5, 30), ...many('sam', 'deck wit deadass bruh', 10, 40), once('sam', 'river', 0)]
    expect(wordStats(messages).signatureWordByPerson.alex).toBe('river')
  })

  it('prefers a word someone says a lot over one they said a few times', () => {
    const messages = [...many('alex', 'river', 40), ...many('alex', 'flop', 5, 50), ...many('sam', 'deck river', 10, 60), once('sam', 'flop', 0)]
    expect(wordStats(messages).signatureWordByPerson.alex).toBe('river')
  })

  it('can be a catchphrase', () => {
    const messages = [...many('alex', 'super calm', 20), ...many('sam', 'deck', 10, 30), once('sam', 'super calm', 0)]
    expect(wordStats(messages).signatureWordByPerson.alex).toBe('super calm')
  })

  it('gives no signature word when two people use a word equally', () => {
    const messages = [...many('alex', 'poker', 5), ...many('sam', 'poker', 5, 10)]
    expect(wordStats(messages).signatureWordByPerson).toEqual({})
  })

  it('breaks ties alphabetically', () => {
    const messages = [...many('alex', 'zebra', 5), ...many('alex', 'apple', 5, 10), ...many('sam', 'deck', 10, 20), once('sam', 'apple zebra', 0)]
    expect(wordStats(messages).signatureWordByPerson.alex).toBe('apple')
  })

  it('with a baseline, skips words this chat uses no more than your other chats', () => {
    const chat = [...many('alex', 'school', 20), ...many('alex', 'flop', 5, 30), ...many('sam', 'deck', 10, 40), once('sam', 'school flop', 0)]
    const otherChats = many('jordan', 'school', 400, 100)
    expect(wordStats(chat).signatureWordByPerson.alex).toBe('school')
    expect(wordStats(chat, { baseline: countWords([...chat, ...otherChats]) }).signatureWordByPerson.alex).toBe('flop')
  })
})

it('works for a solo wrap: one writer and no baseline, ranked by count', () => {
  const mine = [...many('me', 'bro gym', 30), ...many('me', 'midterm', 12, 40), ...many('me', 'gym', 1, 60)]
  const stats = wordStats(mine, { names: ['Taylor'] })
  expect(stats.topWords).toEqual([
    { word: 'gym', count: 31 },
    { word: 'midterm', count: 12 },
  ])
  expect(stats.signatureWordByPerson).toEqual({})
})

it('finds the top emoji and the longest message', () => {
  const messages = [
    ...many('alex', 'poker night', 5),
    msg({ senderId: 'sam', sentAt: at(21), text: '🃏🃏' }),
    msg({ senderId: 'sam', sentAt: at(22), text: 'https://x.com/abc' }),
  ]
  const stats = wordStats(messages)
  expect(stats.topEmoji).toEqual([{ emoji: '🃏', count: 2 }])
  // sam's link-only message is empty once links are removed, so alex's "poker night" (11) is the longest
  expect(stats.longestMessage).toEqual({ senderId: 'alex', length: 11 })
})

it('skips reactions and messages without text', () => {
  const messages = many('alex', 'poker', 5)
  const stats = wordStats([
    ...messages,
    react('sam', messages[0]!, 'love', at(10)),
    { ...react('sam', messages[0]!, 'laugh', at(11)), text: 'poker' },
    msg({ senderId: 'sam', sentAt: at(12), text: null }),
  ])
  expect(stats.topWords).toEqual([{ word: 'poker', count: 5 }])
  expect(stats.longestMessage).toEqual({ senderId: 'alex', length: 5 })
})

it('countWords counts every meaningful word, skipping reactions', () => {
  const target = msg({ senderId: 'alex', sentAt: at(0), text: 'poker poker bro' })
  expect(countWords([target, { ...react('sam', target, 'laugh', at(1)), text: 'poker' }])).toEqual(new Map([['poker', 2]]))
})

it('handles empty input', () => {
  expect(wordStats([])).toEqual({ topWords: [], topEmoji: [], signatureWordByPerson: {}, longestMessage: null })
})
