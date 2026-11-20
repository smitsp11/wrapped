import fs from 'node:fs'
import path from 'node:path'
import { errorCode } from '../errors'

export type Access = 'ok' | 'missing' | 'denied'

/** Opens the exact System Settings page; the user flips the switch (no program can grant this itself). */
export const FULL_DISK_ACCESS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'

export function checkAccess(file: string): Access {
  try {
    fs.closeSync(fs.openSync(file, 'r'))
    return 'ok'
  } catch (err) {
    const code = errorCode(err)
    if (code === 'ENOENT') return 'missing'
    if (code === 'EPERM' || code === 'EACCES') return folderIsMissing(path.dirname(file)) ? 'missing' : 'denied'
    throw err
  }
}

/**
 * Without Full Disk Access, macOS can answer EPERM for a path inside ~/Library/Messages even when chat.db
 * isn't there, so a Mac that never set up Messages can look the same as a blocked one.
 * We can tell them apart only when the Messages folder itself is gone (ENOENT): then there is surely no
 * database. If the folder exists but chat.db doesn't, we can't know until access is granted, so we say
 * 'denied' and the missing-database message comes after the person turns on access.
 */
function folderIsMissing(folder: string): boolean {
  try {
    fs.statSync(folder)
    return false
  } catch (err) {
    return errorCode(err) === 'ENOENT'
  }
}

const BUNDLE_IDS: Record<string, string> = {
  'com.apple.Terminal': 'Terminal',
  'com.googlecode.iterm2': 'iTerm',
  'dev.warp.Warp-Stable': 'Warp',
  'com.microsoft.VSCode': 'Visual Studio Code',
  'com.todesktop.230313mzl4w4u92': 'Cursor',
  'com.mitchellh.ghostty': 'Ghostty',
}

// 'vscode' is also reported by Cursor, Windsurf and VSCodium, so it can't name one app.
const TERM_PROGRAMS: Record<string, string> = {
  Apple_Terminal: 'Terminal',
  'iTerm.app': 'iTerm',
  WarpTerminal: 'Warp',
  vscode: 'your code editor',
  ghostty: 'Ghostty',
}

/** Full Disk Access is granted to the terminal app, so the steps must name the right one. */
export function terminalName(env: Record<string, string | undefined> = process.env): string {
  return BUNDLE_IDS[env.__CFBundleIdentifier ?? ''] ?? TERM_PROGRAMS[env.TERM_PROGRAM ?? ''] ?? 'your terminal app'
}
