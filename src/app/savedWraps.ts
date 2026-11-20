import type { SavedWrap } from './store'

/** The "saved wraps" choice for the start menu, or null when nothing is saved. */
export function savedWrapsOption(saved: SavedWrap[]): { value: 'saved'; label: string; hint: string } | null {
  if (saved.length === 0) return null
  return {
    value: 'saved',
    label: `📂 Your saved wraps (${saved.length})`,
    hint: saved.slice(0, 3).map((w) => w.title).join(', '),
  }
}
