import { describe, expect, it } from 'vitest'
import { BETA_TAG, INTRO, MISSING_DB, UPDATE_FAILED, accessSteps, historyLine, noAccess, openLines, stoppedLine, updatedLine, welcomeLines } from '../../src/app/copy'

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
    expect(welcomeLines(false)).toEqual(['Reads Messages on this Mac to make your wraps.'])
  })
  it('keeps the welcome to one neutral line, with no privacy reassurance', () => {
    const text = welcomeLines(true).join('\n').toLowerCase()
    for (const doubt of ['upload', 'only', 'private', 'leave', 'ai']) expect(text).not.toMatch(new RegExp(`\\b${doubt}\\b`))
  })
  it('says the page is open and how to reopen it or quit', () => {
    expect(openLines('http://127.0.0.1:1/?t=x')).toEqual([
      'iMessage Wrapped is open in your browser: http://127.0.0.1:1/?t=x',
      'Keep this window open. Press o to reopen the page, q to quit.',
    ])
  })
  it('says why it stopped and how to come back', () => {
    expect(stoppedLine('idle')).toContain('The page was closed')
    for (const reason of ['idle', 'closed', 'quit'] as const) expect(stoppedLine(reason)).toContain('Type  wrapped  to open it again.')
  })
  it('says what  wrapped update  did', () => {
    expect(updatedLine('0.2.0-beta.4')).toBe('Updated to 0.2.0-beta.4. Type  wrapped  to start it.')
    expect(updatedLine(null)).toBe('Updated. Type  wrapped  to start it.')
    expect(UPDATE_FAILED).toContain('nothing changed')
  })
})
