import { isCancel, multiselect, select } from '@clack/prompts'
import type { Selection } from './build'
import { TOP_GROUPS, type RankedChat } from './chats'

/** The row that expands the list. Chat ids are positive, so -1 can't collide. */
export const SEE_ALL = -1

export type GroupOption = { value: number; label: string; hint?: string }

export function groupOptions(groups: RankedChat[], showAll: boolean): GroupOption[] {
  const shown = showAll ? groups : groups.slice(0, TOP_GROUPS)
  const options: GroupOption[] = shown.map((g) => ({
    value: g.id,
    label: g.title,
    hint: `${g.messages.toLocaleString('en-US')} msgs · ${g.memberNames.length + 1} people`,
  }))
  if (shown.length < groups.length) options.push({ value: SEE_ALL, label: `↓ See all ${groups.length} group chats` })
  return options
}

/** Picker A. Returns null if the user cancels (Ctrl-C or Esc). */
export async function pickInTerminal(groups: RankedChat[]): Promise<Selection | null> {
  const kind = await select({
    message: 'What do you want to see?',
    options: [
      { value: 'solo', label: '✨ My year', hint: 'you + your top 5 people' },
      { value: 'groups', label: '👥 Group chats', hint: groups.length > 0 ? 'make wraps for your groups' : 'none this year', disabled: groups.length === 0 },
    ],
  })
  if (isCancel(kind)) return null
  if (kind === 'solo') return { kind: 'solo' }

  let showAll = false
  let picked: number[] = []
  for (;;) {
    const answer = await multiselect({
      message: 'Pick group chats (space = select, enter = done)',
      options: groupOptions(groups, showAll),
      initialValues: picked,
      required: true,
    })
    if (isCancel(answer)) return null
    picked = answer.filter((id) => id !== SEE_ALL)
    if (answer.includes(SEE_ALL)) {
      showAll = true
      continue
    }
    return { kind: 'groups', chatIds: picked }
  }
}
