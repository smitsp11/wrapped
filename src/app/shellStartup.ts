import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** site/install.sh ends the PATH line it adds with this comment. Keep the two in sync. */
export const INSTALL_MARK = 'added by iMessage Wrapped'

/** Every file site/install.sh may add its PATH line to: zsh's .zshrc, or the first bash startup file that exists. */
export function startupFiles(home = os.homedir(), zdotdir = process.env.ZDOTDIR): string[] {
  return [path.join(zdotdir || home, '.zshrc'), ...['.bash_profile', '.bash_login', '.profile'].map((f) => path.join(home, f))]
}

/** True only when the installer's PATH line is really there. Run directly (not via the installer), nothing was added. */
export function installerAddedToPath(files = startupFiles()): boolean {
  return files.some((file) => {
    try {
      return fs.readFileSync(file, 'utf8').includes(INSTALL_MARK)
    } catch {
      return false // missing or unreadable: nothing of ours there
    }
  })
}
