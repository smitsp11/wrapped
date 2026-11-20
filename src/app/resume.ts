import fs from 'node:fs'
import path from 'node:path'

/**
 * Picking up after "Quit & Reopen". Just before System Settings opens, the app writes a one-shot marker
 * (~/.imessage-wrapped/resume: the terminal's TERM_PROGRAM, then the time). The shell startup line
 * (shellStartup.ts) runs  wrapped --resume-check  only while that file exists, and the check below lets
 * exactly one fresh shell in the same terminal app run the app again.
 */

/** Long enough to find the switch and click "Quit & Reopen"; short enough that a forgotten marker can't surprise anyone later. */
export const RESUME_MAX_AGE_MS = 15 * 60 * 1000

export function resumeFile(appDir: string): string {
  return path.join(appDir, 'resume')
}

/**
 * The restored window is recognised by its TERM_PROGRAM, so auto-resume needs one. Inside tmux it says "tmux",
 * and the restored window won't be in tmux, so there the person types  wrapped  themselves.
 */
export function canResume(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.TERM_PROGRAM) && env.TERM_PROGRAM !== 'tmux' && !env.TMUX
}

export function writeResume(appDir: string, env: NodeJS.ProcessEnv, now: number): void {
  fs.mkdirSync(appDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(resumeFile(appDir), `${env.TERM_PROGRAM ?? ''}\n${now}\n`, { mode: 0o600 })
}

export function clearResume(appDir: string): void {
  fs.rmSync(resumeFile(appDir), { force: true })
}

/**
 * For  wrapped --resume-check: true only for the one shell that should run the app again.
 * The marker must be under 15 minutes old and from the same terminal app, and the shell must be a real terminal
 * (not, say, an editor reading the shell's settings). Deleting the marker is the claim: when several restored
 * windows start at once, only the one whose delete succeeds runs. A stale or unreadable marker is tidied away;
 * one from another terminal app is left for that app's windows.
 */
export function claimResume(appDir: string, env: NodeJS.ProcessEnv, now: number, interactive: boolean): boolean {
  const file = resumeFile(appDir)
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return false // no marker: the usual case, for every new shell
  }
  const [termProgram, written] = text.split('\n')
  const age = now - Number(written)
  if (!(age >= 0 && age < RESUME_MAX_AGE_MS)) {
    clearResume(appDir)
    return false
  }
  if (!interactive || termProgram !== env.TERM_PROGRAM) return false
  try {
    fs.unlinkSync(file)
    return true
  } catch {
    return false // another window claimed it first
  }
}
