import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import {
  NONCHALANT_MAX_WORDS,
  ONE_AND_DONE_MAX_PER_TURN,
  PARAGRAPH_TEXTER_MIN_WORDS,
  SPRAY_N_PRAY_MIN_PER_TURN,
  textingStyleFor,
  textingStyles,
} from '../../src/wrap/textingStyles'

const idFor = (words: number, perTurn: number) => textingStyleFor(words, perTurn).id

describe('textingStyleFor', () => {
  it('gives each kind of texter their style', () => {
    expect(idFor(22, 1.2)).toBe('paragraph-texter')
    expect(idFor(3, 4.5)).toBe('spray-n-pray')
    expect(idFor(1, 1.3)).toBe('nonchalant')
    expect(idFor(0, 1.3)).toBe('nonchalant') // emoji only
    expect(idFor(4, 1)).toBe('one-and-done')
    expect(idFor(5, 1.4)).toBe('balanced')
  })

  it('applies each threshold inclusively, and not a hair past it', () => {
    expect(idFor(PARAGRAPH_TEXTER_MIN_WORDS, 1.5)).toBe('paragraph-texter')
    expect(idFor(PARAGRAPH_TEXTER_MIN_WORDS - 0.5, 1.5)).toBe('balanced')
    expect(idFor(5, SPRAY_N_PRAY_MIN_PER_TURN)).toBe('spray-n-pray')
    expect(idFor(5, SPRAY_N_PRAY_MIN_PER_TURN - 0.1)).toBe('balanced')
    expect(idFor(NONCHALANT_MAX_WORDS, 1.5)).toBe('nonchalant')
    expect(idFor(NONCHALANT_MAX_WORDS + 0.5, 1.5)).toBe('balanced')
    expect(idFor(5, ONE_AND_DONE_MAX_PER_TURN)).toBe('one-and-done')
    expect(idFor(5, ONE_AND_DONE_MAX_PER_TURN + 0.05)).toBe('balanced')
  })

  it('gives one style when several fit: paragraphs, then bursts, then one-word texts, then one and done', () => {
    expect(idFor(30, 5)).toBe('paragraph-texter') // paragraphs in bursts
    expect(idFor(1, 5)).toBe('spray-n-pray') // one word at a time, many times: the classic spammer
    expect(idFor(1, 1)).toBe('nonchalant') // "k." and nothing else
  })

  it('puts the numbers in the one-liners, rounded', () => {
    expect(textingStyleFor(19.5, 1).line).toBe('Paragraphs only. ~20 words a text.')
    expect(textingStyleFor(2, 3.4).line).toBe('3 texts in a row, every time.')
    expect(textingStyleFor(2, 5.6).line).toBe('6 texts in a row, every time.')
    expect(textingStyleFor(2, 3.4).name).toBe('Spray n Pray')
  })
})

describe('textingStyles', () => {
  it('gives the fake Poker Night members five different styles, busiest first', () => {
    const wrap = makeFakeWrap('group')
    const styles = textingStyles(wrap).map((p) => [wrap.people[p.personId], p.style.name])
    expect(styles).toEqual([
      ['Alex Chen', 'One and Done'],
      ['You', 'Nonchalant'],
      ['Sam Rivera', 'Perfectly Balanced'],
      ['Jordan Lee', 'Paragraph Texter'],
      ['Riley Park', 'Spray n Pray'],
    ])
  })

  it('leaves out Riley in the fake chat without the extra texts (too few to judge)', () => {
    const wrap = makeFakeWrap('group', { textingStyles: false })
    expect(textingStyles(wrap).map((p) => p.personId)).not.toContain('p4')
  })

  it('has nobody for a wrap without texting stats: old links and solo wraps', () => {
    const group = makeFakeWrap('group')
    delete group.texting
    expect(textingStyles(group)).toEqual([])
    expect(makeFakeWrap('solo').texting).toBeUndefined()
  })

  it('skips anyone missing from either record, and sorts someone with no message count last', () => {
    const wrap = makeFakeWrap('group')
    wrap.texting = { medianWordsByPerson: { p1: 2, p2: 30, p9: 1 }, textsPerTurnByPerson: { p1: 1, p9: 1 } }
    expect(textingStyles(wrap).map((p) => p.personId)).toEqual(['p1', 'p9'])
  })
})
