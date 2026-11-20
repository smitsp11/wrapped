import { execFile } from 'node:child_process'

/** A new message with the link typed in; the user picks the chat and presses send. Never sends by itself. */
export function openNewMessage(link: string): Promise<void> {
  return new Promise((resolve) => {
    execFile('open', [`sms:&body=${encodeURIComponent(link)}`], (err) => {
      if (!err) return resolve()
      execFile('open', ['-a', 'Messages'], () => resolve())
    })
  })
}
