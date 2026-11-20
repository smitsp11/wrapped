import type { Wrap } from '../types'

/**
 * A shared group wrap is read by the group, where "You" would mean whoever opens it. This puts the sender's
 * name in its place. Every slide, award, bar and quote finds names through `people`, so that's the one change.
 * Solo wraps (My year) and an empty name keep "You". Returns a new wrap; the stored one is untouched.
 */
export function withSenderName(wrap: Wrap, name: string): Wrap {
  const clean = name.trim()
  if (wrap.mode !== 'group' || clean === '' || !Object.hasOwn(wrap.people, 'me')) return wrap
  return { ...wrap, people: { ...wrap.people, me: clean } }
}
