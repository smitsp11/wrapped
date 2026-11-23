import { describe, expect, it } from 'vitest'
import {
  INTRO,
  MISSING_DB,
  UPDATE_FAILED,
  accessSteps,
  historyLine,
  laterLine,
  noAccess,
  openLines,
  stillNoAccess,
  stoppedLine,
  updatedLine,
  welcomeLines,
  COUNT_NOTICE,
  NEEDS_TERMINAL,
} from '../../src/app/copy'

describe('copy', () => {
  it('offers o and q only when the keyboard can be read', () => {
    expect(openLines('http://127.0.0.1:1/', true)[1]).toBe('Keep this window open. Press o to reopen the page, q to quit.')
    expect(openLines('http://127.0.0.1:1/', false)[1]).toBe('Keep this window open.')
    expect(NEEDS_TERMINAL).toBe('Run  wrapped  in Terminal to continue.')
  })
  it('says how far back history goes', () => {
    expect(historyLine({ kind: 'ok', since: new Date(2019, 0, 3) })).toBe('Your messages go back to Jan 2019')
  })
  it('warns about thin history with the date it starts', () => {
    expect(historyLine({ kind: 'thin', since: new Date(2026, 9, 6) })).toContain('Oct 2026')
  })
  it('warns when this Mac stopped syncing, with the newest date', () => {
    expect(historyLine({ kind: 'stale', until: new Date(2026, 1, 10) })).toContain('Feb 2026')
  })
  it('says why, then gives one access line, plus where to find the app when it is not listed', () => {
    expect(accessSteps('Terminal', { resume: true })).toEqual([
      'Reads your Messages on this Mac to make your wrap.',
      'Turn on Terminal in the window that\'s about to open, then click "Quit & Reopen". Wrapped picks up by itself.',
      '(Not listed? Click + and choose Terminal from Applications → Utilities.)',
    ])
  })
  it('names the terminal app, and its folder', () => {
    const text = accessSteps('iTerm', { resume: true }).join('\n')
    expect(text).toContain('Turn on iTerm in the window')
    expect(text).toContain('choose iTerm from Applications.)')
    expect(text).not.toContain('tmux')
  })
  it('says to type  wrapped  only when it will not pick up by itself', () => {
    expect(accessSteps('Warp', { resume: true }).join('\n')).not.toContain('type')
    expect(accessSteps('Warp', { resume: false })[1]).toBe('Turn on Warp in the window that\'s about to open, click "Quit & Reopen", then type  wrapped  again.')
  })
  it('adds a tmux step only inside tmux', () => {
    expect(accessSteps('iTerm', { resume: false, inTmux: true }).join('\n')).toContain('tmux kill-server')
  })
  it('says when the resumed run still has no access', () => {
    expect(stillNoAccess('Terminal')).toBe("Terminal still can't read Messages.")
    expect(stillNoAccess('your terminal app')).toBe("Your terminal app still can't read Messages.")
  })
  it('never says to open a new Terminal window', () => {
    const all = [
      ...welcomeLines(true),
      ...accessSteps('Terminal', { resume: false, inTmux: true }),
      MISSING_DB,
      noAccess('Terminal'),
      stoppedLine('quit', false),
      laterLine(false),
    ].join('\n')
    expect(all).not.toMatch(/new Terminal window/i)
  })
  it('has no backticks in any wording', () => {
    expect(welcomeLines(true).join('')).not.toContain('`')
    expect(MISSING_DB).not.toContain('`')
    expect(noAccess('iTerm')).not.toContain('`')
  })
  it('names the terminal app and the settings page when access is blocked', () => {
    const text = noAccess('iTerm')
    expect(text).toContain('Turn on iTerm')
    expect(text).toContain('System Settings → Privacy & Security → Full Disk Access')
    expect(text).toContain('click "Quit & Reopen", then type  wrapped  again')
  })
  it('points to the Keep messages setting and Sync Now', () => {
    expect(historyLine({ kind: 'thin', since: new Date(2026, 9, 6) })).toContain('"Keep messages" (Messages → Settings → General)')
    expect(historyLine({ kind: 'stale', until: new Date(2026, 1, 10) })).toContain('click Sync Now')
  })
  it('names the app in the intro line', () => {
    expect(INTRO.trim()).toBe('iMessage Wrapped')
  })
  it('mentions the startup file only when the installer added the line', () => {
    expect(welcomeLines(true).join('\n')).toContain('Added  wrapped  to your shell\'s startup file')
    expect(welcomeLines(true).join('\n')).toContain('"added by iMessage Wrapped"')
    expect(welcomeLines(false).join('\n')).not.toContain('startup file')
    expect(welcomeLines(false, false)).toEqual(['Makes your wraps from Messages on this Mac.'])
  })
  it('says once, on the first run, that it counts anonymous daily tallies and how to turn that off', () => {
    expect(welcomeLines(false)).toEqual(['Makes your wraps from Messages on this Mac.', COUNT_NOTICE])
    expect(COUNT_NOTICE).toContain('anonymous daily tallies')
    expect(COUNT_NOTICE).toContain('WRAPPED_NO_COUNT=1')
    expect(welcomeLines(true, false).join('\n')).not.toContain('tallies')
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
  it('says to use a new window only when this shell does not know  wrapped  yet (right after installing)', () => {
    expect(stoppedLine('quit', false)).toBe('iMessage Wrapped is closed. In a new window, type  wrapped  to open it again.')
    expect(laterLine(true)).toBe('Okay. Type  wrapped  when you are ready.')
    expect(laterLine(false)).toBe('Okay. In a new window, type  wrapped  when you are ready.')
  })
  it('says what  wrapped update  did', () => {
    expect(updatedLine('0.2.0-beta.4')).toBe('Updated to 0.2.0-beta.4. Type  wrapped  to start it.')
    expect(updatedLine(null)).toBe('Updated. Type  wrapped  to start it.')
    expect(UPDATE_FAILED).toContain('nothing changed')
  })
})
