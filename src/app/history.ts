import type { HistorySpan } from '../types'
import type { Period } from './period'

export type HistoryCheck =
  | { kind: 'empty' }
  | { kind: 'stale'; until: Date }
  | { kind: 'thin'; since: Date }
  | { kind: 'ok'; since: Date }

/** History that starts (or stops) this far from the period's start (or end) means part of the period is missing. */
const GRACE_MS = 14 * 24 * 60 * 60 * 1000

/**
 * New Macs, Messages still syncing from iCloud, or "Keep messages: 30 days" all show up as history that starts late.
 * A secondary Mac, or a Mac that stopped syncing Messages in iCloud, shows up as history that stops early ("stale").
 */
export function checkHistory(span: HistorySpan | null, period: Period, now: Date = new Date()): HistoryCheck {
  if (!span || span.latest < period.from || span.earliest >= period.to) return { kind: 'empty' }
  const end = Math.min(period.to.getTime(), now.getTime())
  if (span.latest.getTime() < end - GRACE_MS) return { kind: 'stale', until: span.latest }
  if (span.earliest.getTime() > period.from.getTime() + GRACE_MS) return { kind: 'thin', since: span.earliest }
  return { kind: 'ok', since: span.earliest }
}
