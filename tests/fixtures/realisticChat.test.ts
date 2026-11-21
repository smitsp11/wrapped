import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { realisticChat } from '../../fixtures/realisticChat'
import { textingStyles } from '../../src/wrap/textingStyles'

// The demo's busy made-up year (`npm run demo:json`). Its numbers are pinned loosely: the point is the shape.
describe('the realistic demo chat', () => {
  const wrap = makeFakeWrap('group', { realistic: true })
  const name = (id: string) => wrap.people[id]

  it('is the same every run', () => {
    expect(realisticChat().slice(0, 50)).toEqual(realisticChat().slice(0, 50))
    expect(makeFakeWrap('group', { realistic: true })).toEqual(wrap)
  })

  it('is a busy year: about 23,000 messages, a 70-day streak, a 12-day silence, a May peak', () => {
    expect(wrap.volume.total).toBeGreaterThan(20_000)
    expect(wrap.volume.total).toBeLessThan(27_000)
    expect(wrap.timing.longestStreakDays).toBe(70)
    expect(wrap.timing.longestSilenceDays).toBe(12)
    expect(wrap.timing.byMonth.indexOf(Math.max(...wrap.timing.byMonth))).toBe(4)
    expect(wrap.timing.busiestDay?.date).toBe('2026-05-21')
  })

  it('has six people who text, two of them barely', () => {
    const share = (id: string) => wrap.volume.byPerson[id]! / wrap.volume.total
    const busiest = Object.keys(wrap.volume.byPerson).sort((a, b) => share(b) - share(a))
    expect(busiest.map(name)).toEqual(['Riley Park', 'You', 'Sam Rivera', 'Alex Chen', 'Jordan Lee', 'Casey Morgan'])
    expect(share(busiest[0]!)).toBeGreaterThan(0.3)
    expect(share(busiest[4]!)).toBeLessThan(0.01)
  })

  it('gives every award, spread around the group', () => {
    const awards = Object.fromEntries(wrap.awards.map((a) => [a.id, name(a.personId)]))
    expect(awards).toEqual({
      'main-character': 'Riley Park', ghost: 'Alex Chen', starter: 'You', comedian: 'Sam Rivera', hype: 'Riley Park',
      'night-owl': 'Alex Chen', 'double-texter': 'You', lurker: 'Jordan Lee',
    })
  })

  it('has varied texting styles', () => {
    const styles = Object.fromEntries(textingStyles(wrap).map((p) => [name(p.personId), p.style.name]))
    expect(styles).toMatchObject({
      'Riley Park': 'Spray n Pray', 'Sam Rivera': 'One and Done', 'Alex Chen': 'Nonchalant', 'Jordan Lee': 'Paragraph Texter',
    })
  })

  it('keeps three greatest hits, each with its whole made-up conversation', () => {
    expect(wrap.greatestHits).toHaveLength(3)
    for (const hit of wrap.greatestHits) {
      expect(hit.reactions).toBe(5)
      expect(hit.conversation!.messages.length).toBeGreaterThan(10)
      expect(hit.conversation!.messages.length).toBeLessThan(20)
    }
    expect(wrap.greatestHits.map((h) => name(h.senderId))).toEqual(['Sam Rivera', 'You', 'Alex Chen'])
  })

  it('has its own vocabulary', () => {
    expect(wrap.words.topWords.slice(0, 5).map((w) => w.word)).toEqual(expect.arrayContaining(['run it back', 'snack tax', 'fold']))
    expect(wrap.words.topEmoji[0]!.emoji).toBe('💀')
  })
})
