import { parseISO, subDays, format, differenceInCalendarDays } from 'date-fns'
import type { PhaseEntry, ResolvedPhase } from '../../types'

// Pure phase-log resolution (COACH-ANALYSIS-TASKS.md §4 step C). No end-date
// column exists by design (COACH-ANALYSIS-SPEC.md §5/§8) — every entry's end
// is implicit: the day before the next entry's startDate, or open-ended (null)
// for the most recent one. `unique (user_id, start_date)` on the table is what
// makes "the next entry's start date" unambiguous.

const ISO_DATE = 'yyyy-MM-dd'

function dayBefore(isoDate: string): string {
  return format(subDays(parseISO(isoDate), 1), ISO_DATE)
}

// Resolves every entry's implicit endDate and a durationDays. For a closed
// entry (one with a later entry after it), durationDays is its real, fixed,
// full duration — unaffected by `asOf`. For the most recent (open) entry,
// durationDays is "how long it's run so far", i.e. up to `asOf` — so `asOf`
// only ever matters for exactly one entry in the list. Kept as an explicit
// parameter rather than reading a live "today" inside this module, per this
// app's standing rule that `today` is never computed at module load.
export function resolvePhases(entries: PhaseEntry[], asOf: string): ResolvedPhase[] {
  const sorted = [...entries].sort((a, b) => a.startDate.localeCompare(b.startDate))
  return sorted.map((entry, i) => {
    const next = sorted[i + 1]
    const endDate = next ? dayBefore(next.startDate) : null
    const referenceDate = next ? next.startDate : asOf
    const durationDays = differenceInCalendarDays(parseISO(referenceDate), parseISO(entry.startDate))
    return { ...entry, endDate, durationDays }
  })
}

export interface PhaseAtResult {
  // The phase in effect on `date`, with durationDays = how long it had run
  // *by that date* (not its full/eventual duration — those differ whenever
  // `date` falls short of the phase's real or still-open end).
  current: ResolvedPhase | null
  // The immediately preceding phase, with its own real, closed, full
  // duration — SPEC §5's "cut before that ran roughly 6 weeks".
  previous: ResolvedPhase | null
}

// The phase in effect on a given date, how long it had run by then, and the
// previous phase with its own duration (COACH-ANALYSIS-SPEC.md §5's "bulk
// started 2 weeks ago, cut before that ran roughly 6 weeks"). Entries that
// start after `date` are irrelevant to what was in effect on `date` and are
// naturally ignored below.
export function phaseAt(entries: PhaseEntry[], date: string): PhaseAtResult {
  if (entries.length === 0) return { current: null, previous: null }

  // resolvePhases(entries, date) gives every entry a real, fixed endDate
  // from its actual neighbour, regardless of `date` — only the *last*
  // entry's durationDays depends on the `asOf` passed in, and that's
  // exactly the one case (an open-ended phase queried on-or-after its own
  // start) where "as of `date`" is the right semantic anyway.
  const resolved = resolvePhases(entries, date)

  let idx = -1
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i].startDate <= date) idx = i
    else break
  }
  if (idx === -1) return { current: null, previous: null }

  const currentResolved = resolved[idx]
  const current: ResolvedPhase = {
    ...currentResolved,
    // Override: resolvePhases reports the *full* duration for a closed
    // entry, but here we want "how long it had run by `date`" — which can
    // be short of the full duration when `date` falls inside an earlier,
    // now-closed window.
    durationDays: differenceInCalendarDays(parseISO(date), parseISO(currentResolved.startDate)),
  }
  const previous = idx > 0 ? resolved[idx - 1] : null

  return { current, previous }
}
