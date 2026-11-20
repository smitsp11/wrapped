import { describe, expect, it } from 'vitest'
import { BETA_TAG, DONE, INTRO, MISSING_DB, accessSteps, historyLine, noAccess, welcomeLines } from '../../src/app/copy'

describe('copy', () => {
  it('says how far back history goes', () => {
    expect(historyLine({ kind: 'ok', since: new Date(2019, 0, 3) })).toBe('Your messages go back to Jan 2019')
  })
  it('warns about thin history with the date it starts', () => {
    expect(historyLine({ kind: 'thin', since: new Date(2026, 9, 6) })).toContain('Oct 2026')
  })
  it('warns when this Mac stopped syncing, with the newest date', () => {
    expect(historyLine({ kind: 'stale', until: new Date(2026, 1, 10) })).toContain('Feb 2026')
  })
  it('names the terminal app in the access steps', () => {
    expect(accessSteps('iTerm').join('\n')).toContain('Turn on iTerm')
  })
  it('tells people whose app is not listed what to do', () => {
    const text = accessSteps('iTerm').join('\n')
    expect(text).toContain('Not in the list? Click +')
    expect(text).toContain('Touch ID')
    expect(text).not.toContain('tmux')
  })
  it('adds a tmux step only inside tmux', () => {
    expect(accessSteps('iTerm', true).join('\n')).toContain('tmux kill-server')
  })
  it('has no backticks in any wording', () => {
    expect(welcomeLines(true).join('')).not.toContain('`')
    expect(MISSING_DB).not.toContain('`')
    expect(noAccess('iTerm')).not.toContain('`')
  })
  it('names the terminal app and the settings page when access is blocked', () => {
    const text = noAccess('iTerm')
    expect(text).toContain('turn on iTerm')
    expect(text).toContain('System Settings → Privacy & Security → Full Disk Access')
    expect(text).toContain('open a new Terminal window and type  wrapped  again')
  })
  it('points to the Keep messages setting and Sync Now', () => {
    expect(historyLine({ kind: 'thin', since: new Date(2026, 9, 6) })).toContain('"Keep messages" (Messages → Settings → General)')
    expect(historyLine({ kind: 'stale', until: new Date(2026, 1, 10) })).toContain('click Sync Now')
  })
  it('says it is a beta in the intro line', () => {
    expect(INTRO.trim()).toBe('iMessage Wrapped (beta)')
    expect(BETA_TAG).toBe('Beta')
  })
  it('mentions the startup file only when the installer added the line', () => {
    expect(welcomeLines(true).join('\n')).toContain('Added  wrapped  to your shell\'s startup file')
    expect(welcomeLines(false).join('\n')).not.toContain('startup file')
    expect(welcomeLines(false)).toContain('• You see everything before you share anything')
  })
  it('ends with a plain done line and no feedback ask', () => {
    expect(DONE).toBe('All done ✓')
  })
})
