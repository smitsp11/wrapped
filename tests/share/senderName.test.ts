import { describe, expect, it } from 'vitest'
import { makeFakeWrap } from '../../fixtures/fakeWrap'
import { withSenderName } from '../../src/share/senderName'

describe('withSenderName', () => {
  const group = makeFakeWrap('group')

  it('puts the name where "You" was in a group wrap', () => {
    expect(group.people.me).toBe('You')
    const named = withSenderName(group, '  Smit ')
    expect(named.people.me).toBe('Smit')
    expect({ ...named.people, me: 'You' }).toEqual(group.people) // nobody else changes
    expect(named.awards).toBe(group.awards) // awards, bars and quotes find names through people
  })
  it('leaves the stored wrap untouched', () => {
    withSenderName(group, 'Smit')
    expect(group.people.me).toBe('You')
  })
  it('keeps "You" when the name is empty', () => {
    expect(withSenderName(group, '   ')).toBe(group)
  })
  it('keeps "You" in My year', () => {
    const solo = makeFakeWrap('solo')
    expect(withSenderName(solo, 'Smit')).toBe(solo)
  })
  it('does nothing when the sender sent nothing', () => {
    const { me: _me, ...people } = group.people
    const quiet = { ...group, people }
    expect(withSenderName(quiet, 'Smit')).toBe(quiet)
  })
})
