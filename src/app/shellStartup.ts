import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** site/install.sh ends the line it adds with this comment. Keep the two in sync. */
export const INSTALL_MARK = 'added by iMessage Wrapped'

/**
 * The one line site/install.sh keeps in the shell startup file (a test checks the installer writes exactly this).
 * It puts wrapped on PATH and, only while the resume marker exists (resume.ts), runs  wrapped --resume-check.
 * The [ -f ] test is built into the shell, so every other new shell starts without running the program.
 */
export const STARTUP_LINE =
  'export PATH="$HOME/.imessage-wrapped/bin:$PATH"; if [ -f "$HOME/.imessage-wrapped/resume" ]; then "$HOME/.imessage-wrapped/bin/wrapped" --resume-check; fi # ' +
  INSTALL_MARK

/** Every file site/install.sh may add its line to: zsh's .zshrc, or the first bash startup file that exists. */
export function startupFiles(home = os.homedir(), zdotdir = process.env.ZDOTDIR): string[] {
  return [path.join(zdotdir || home, '.zshrc'), ...['.bash_profile', '.bash_login', '.profile'].map((f) => path.join(home, f))]
}

/** The installer's marked lines across the startup files. Missing or unreadable files have none. */
function markedLines(files: string[]): string[] {
  return files.flatMap((file) => {
    try {
      return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.includes(INSTALL_MARK))
    } catch {
      return []
    }
  })
}

/** True only when the installer's line is really there. Run directly (not via the installer), nothing was added. */
export function installerAddedToPath(files = startupFiles()): boolean {
  return markedLines(files).length > 0
}

/** True when the startup file has the current line, the one that can pick up after "Quit & Reopen". An older install's line only sets PATH. */
export function canAutoResume(files = startupFiles()): boolean {
  return markedLines(files).includes(STARTUP_LINE)
}

/** True when typing  wrapped  works in this shell. Right after installing it doesn't: the shell read its startup file before the line was added. */
export function onPath(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): boolean {
  const bin = path.join(home, '.imessage-wrapped', 'bin')
  return (env.PATH ?? '').split(':').some((dir) => path.resolve(dir) === bin)
}
