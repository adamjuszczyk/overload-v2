import { addDays, parseISO, format } from 'date-fns'
import type { Session } from '../../types'
import { effectiveDate } from './effectiveDate'

// Chunk 25 (TASKS.md "sequenceSchedule.ts" / SPEC.md "Scheduling →
// Sequence") — the pure decision behind a sequence run's Today screen,
// kept Supabase-free the same way scheduler.ts's own `schedule()` is: the
// caller (useSequenceScheduler.ts) gathers the small amount of history this
// needs and hands it in.
//
// ─── The model (SPEC, verbatim, reviewer's note 2) ─────────────────────────
// "Rest days count from the last workout done... The sequence only moves
// forward when a workout is done. Not training on a due day misses
// nothing... 'Train anyway' starts the next workout; the remaining rest
// days disappear... Skip drops a workout entirely; the sequence moves to
// the next one, which is due the same day."
//
// This resolves to one fact repeated at every call: there is no stored
// "pointer" or "remaining rests counter" anywhere — every call recomputes
// the next slot and its due date fresh from the single most recent
// done-or-skipped event (`lastEvent`, below). That is what makes each SPEC
// rule fall out for free rather than needing its own special case:
//   - "a missed due day misses nothing": nothing updates lastEvent merely
//     by a due date passing, so the same next slot and due date keep
//     being returned call after call until a NEW done/skip event exists.
//   - "Train anywayWINDOW... the remaining rest days disappear": starting
//     (and completing) the already-next workout EARLY simply becomes the
//     new lastEvent; the old due date and its now-moot remaining rests are
//     never consulted again — there was never a counter to clear.
//   - "Skip... due the same day": a skip's own date becomes the anchor,
//     with NO rest-counting applied for that one transition (see
//     resolveNextSlot's own header on why "skipped" and "completed" anchor
//     differently).
//
// ─── Slot identity (R16) ────────────────────────────────────────────────
// A slot is (sequence_position); the SAME workout can occupy two slots in
// one cycle (SPEC, G8: "A, B, A, rest"), so "the next workout after the
// last one" is found by POSITION, never by workoutDayId — resolveNextSlot
// walks the program's current ordered item list from the last slot's own
// position, wrapping at the end (cycle rollover — weekNumber, the cycle
// index, increments by one each time the walk wraps past the last item).

export interface SequenceCycleItem {
  position: number
  workoutDayId: string | null // null = rest slot
}

// The most recent DONE-OR-SKIPPED session, read from ITS OWN week plan row
// (reviewer's note 2: "read from that session's week plan sequence_position
// and week_number") — never re-derived from a date-bounded session list,
// since a sequence run has no fixed cadence to bound a lookback window by
// (the caller's own query is a single bounded read — `order by ... limit
// 1` — not this module's concern). `date` is this event's own anchor date:
// the completed session's effective date (moved_to_date when set, else
// date — effectiveDate.ts; a sequence session should never actually carry
// moved_to_date, since "Move this session" is weekday-only, SPEC, but this
// reads it the same defensive way scheduler.ts's own due-today check does)
// for a 'completed' event, or the date the Skip action itself ran for a
// 'skipped' one.
export interface SequenceLastEvent {
  weekNumber: number // the cycle index this event belongs to
  sequencePosition: number // the slot it occupied
  status: 'completed' | 'skipped'
  date: string // ISO date
}

export interface SequenceNextWorkout {
  workoutDayId: string
  weekNumber: number // the cycle index this NEXT occurrence falls in, after any rollover
  sequencePosition: number
}

// ─── resolveNextSlot (reviewer's note 2, bullets 1 and 7) ──────────────────
// The slot after `lastEvent`'s own slot, skipping over rest slots (counting
// them in `restsBetween`), wrapping the item list at its end and
// incrementing the cycle index once per wrap. `lastEvent: null` (nothing
// ever done or skipped in this run) resolves to the FIRST workout-bearing
// slot of cycle 1, with no rest delay at all — there is nothing to count
// rests FROM yet (SPEC: "Rest days count from the last workout done"; with
// none done, no delay applies — a documented reading, see this chunk's
// report).
//
// Returns null only when the program's cycle has no workout-bearing slot
// at all (every item is a rest, or there are no items) — "nothing to
// schedule", scheduleSequence's own 'no_workouts' result.
export function resolveNextSlot(
  items: SequenceCycleItem[],
  lastEvent: SequenceLastEvent | null,
): { next: SequenceNextWorkout; restsBetween: number } | null {
  const sorted = [...items].sort((a, b) => a.position - b.position)
  const hasAnyWorkout = sorted.some((i) => i.workoutDayId !== null)
  if (!hasAnyWorkout) return null

  if (lastEvent === null) {
    const first = sorted.find((i) => i.workoutDayId !== null)!
    return { next: { workoutDayId: first.workoutDayId!, weekNumber: 1, sequencePosition: first.position }, restsBetween: 0 }
  }

  const startIdx = sorted.findIndex((i) => i.position === lastEvent.sequencePosition)
  if (startIdx === -1) {
    // Defensive — the last-trained slot's own position no longer exists in
    // the program's CURRENT item list (edited since: removed, or the whole
    // cycle reshaped). Scope decision (this chunk's report): treated the
    // same as "nothing trained in the current list" rather than guessing
    // where the old slot would now fall — the cycle index is kept (not
    // reset to 1), since a real cycle is still in progress, only its own
    // shape changed.
    const first = sorted.find((i) => i.workoutDayId !== null)!
    return { next: { workoutDayId: first.workoutDayId!, weekNumber: lastEvent.weekNumber, sequencePosition: first.position }, restsBetween: 0 }
  }

  let weekNumber = lastEvent.weekNumber
  let restsBetween = 0
  let cursor = startIdx
  for (let step = 0; step < sorted.length; step++) {
    cursor += 1
    if (cursor >= sorted.length) {
      cursor = 0
      weekNumber += 1 // cycle rollover — the cycle index is week_number (TASKS.md)
    }
    const item = sorted[cursor]
    if (item.workoutDayId !== null) {
      return { next: { workoutDayId: item.workoutDayId, weekNumber, sequencePosition: item.position }, restsBetween }
    }
    restsBetween += 1
  }
  // Unreachable: hasAnyWorkout guarantees the loop finds one within
  // sorted.length steps (at most back to startIdx's own slot, which is
  // itself workout-bearing — lastEvent only ever names a trained workout).
  return null
}

// ─── computeDueDate (reviewer's note 2, bullets 2 and 5) ───────────────────
// Independently testable date math, given restsBetween from the walk
// above. null = no anchor to compute from (lastEvent null) — the caller
// reads that as "due now", never a fabricated date.
export function computeDueDate(lastEvent: SequenceLastEvent | null, restsBetween: number): string | null {
  if (lastEvent === null) return null
  if (lastEvent.status === 'skipped') return lastEvent.date // "due the same day" — no rest count applied
  return format(addDays(parseISO(lastEvent.date), restsBetween + 1), 'yyyy-MM-dd')
}

export type SequenceScheduleResult =
  | { type: 'no_workouts' } // every slot is REST, or the cycle is empty — nothing to schedule
  | { type: 'active_session'; session: Session }
  | { type: 'completed_today'; session: Session }
  | { type: 'next'; next: SequenceNextWorkout; dueDate: string | null; isDue: boolean }

// The top-level composition — mirrors scheduler.ts's own `schedule()` shape
// (today first, then a gathered-data bag), reusing the SAME global
// short-circuit it documents ("one session in progress at a time, as
// today") ahead of anything sequence-specific.
export function scheduleSequence(
  today: string,
  { items, sessions, lastEvent }: { items: SequenceCycleItem[]; sessions: Session[]; lastEvent: SequenceLastEvent | null },
): SequenceScheduleResult {
  const activeSession = sessions.find((s) => s.status === 'in_progress')
  if (activeSession) return { type: 'active_session', session: activeSession }

  const completedToday = sessions.find((s) => s.status === 'completed' && effectiveDate(s) === today)
  if (completedToday) return { type: 'completed_today', session: completedToday }

  const resolved = resolveNextSlot(items, lastEvent)
  if (!resolved) return { type: 'no_workouts' }

  const dueDate = computeDueDate(lastEvent, resolved.restsBetween)
  // ISO 'yyyy-MM-dd' strings compare lexicographically exactly like dates —
  // no need to parse either side. null = no anchor at all, always due.
  const isDue = dueDate === null || dueDate <= today
  return { type: 'next', next: resolved.next, dueDate, isDue }
}
