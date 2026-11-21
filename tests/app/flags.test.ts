import { describe, expect, it } from 'vitest'
import { WrappedError } from '../../src/errors'
import { USAGE, parseFlags } from '../../src/app/flags'

describe('parseFlags', () => {
  it('reads --help and -h, --version and -v', () => {
    expect(parseFlags(['--help']).help).toBe(true)
    expect(parseFlags(['-h']).help).toBe(true)
    expect(parseFlags(['--version']).version).toBe(true)
    expect(parseFlags(['-v']).version).toBe(true)
    expect(parseFlags([])).toMatchObject({ help: false, version: false, update: false, yearGiven: false })
  })

  it('turns an unknown option into one plain line that says how to get help', () => {
    for (const [args, says] of [
      [['--nope'], "wrapped doesn't understand --nope. Try  wrapped --help."],
      [['-x'], "wrapped doesn't understand -x. Try  wrapped --help."],
      [['--db'], "wrapped doesn't understand --db. Try  wrapped --help."], // no value
    ] as const) {
      const run = () => parseFlags([...args])
      expect(run).toThrow(WrappedError)
      expect(run).toThrow(says)
    }
    expect(() => parseFlags(['make'])).toThrow('The only command is  wrapped update. Try  wrapped --help.')
  })

  it('reads update, --year and the test-only flags', () => {
    expect(parseFlags(['update']).update).toBe(true)
    expect(parseFlags(['--year', '2025'])).toMatchObject({ year: 2025, yearGiven: true })
    expect(parseFlags(['--db', '/tmp/x.db', '--check']).db).toBe('/tmp/x.db')
    expect(() => parseFlags(['--now', 'soon'])).toThrow('--now must be a date like 2026-03-10.')
  })

  it('shows the commands people use, not the test-only flags', () => {
    expect(USAGE).toContain('wrapped update')
    expect(USAGE).toContain('--year')
    expect(USAGE).toContain('-v')
    for (const hidden of ['--db', '--check', '--now', '--resume-check']) expect(USAGE).not.toContain(hidden)
  })
})
