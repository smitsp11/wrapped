export type Period = { year: number; from: Date; to: Date; label: string }

/** Jan 1 → the end of today, local time. */
export function yearSoFar(year: number, now: Date): Period {
  return { year, from: new Date(year, 0, 1), to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), label: `${year} so far` }
}

export function fullYear(year: number): Period {
  return { year, from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1), label: String(year) }
}

/** In January a year-so-far wrap is a few days long, so last year is offered too (first). */
export function periodChoices(now: Date): Period[] {
  const year = now.getFullYear()
  return now.getMonth() === 0 ? [fullYear(year - 1), yearSoFar(year, now)] : [yearSoFar(year, now)]
}
