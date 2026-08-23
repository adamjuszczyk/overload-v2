// Derives a session's true completed_at from its own set_log rows, instead
// of wall-clock time at whatever moment the completion write happens to
// execute (post-launch fix, 2026-08-11 — see CONTEXT.md). Neither
// useCompleteSession's manual FINISH SESSION path nor
// useAutoFinishSession's automatic one previously had any relationship
// between "when completed_at gets set" and "when the user actually stopped
// training" — a session reopened after a long idle gap, or one whose
// auto-finish poll only fires once the app is next opened (useAutoFinishSession
// is a plain setInterval tied to the component staying mounted, no Page
// Visibility integration), both wrote wall-clock-at-write-time as
// completed_at, inflating duration by however long that gap happened to be.
// A live query against all 24 real production sessions confirmed this
// empirically: deriving from the newest logged set instead collapses every
// currently-inflated session's duration into the same tight, plausible
// range the never-delayed sessions already occupy.
//
// Every set_log row is an equally valid "the user was still active here"
// signal — skipped, warmup, and dropset-stage rows all count, no
// filtering. This is about when the user last did anything in this
// session, not about which sets count toward a workout's real total (that's
// the stage-exclusion rule, TASKS.md §2.1 — a different concern this
// function has nothing to do with).
export interface LoggedAtRow {
  loggedAt: string
}

// Returns null for zero eligible rows (a session completed with nothing
// logged at all — reachable: FINISH SESSION has no gate requiring anything
// be logged first) or for a list containing nothing but invalid/unparseable
// rows. Callers must not fall back to wall-clock time for that case — that
// reintroduces the exact bug this function exists to fix. Same
// "unavailable" treatment skipMissedSession rows already get (both
// started_at/completed_at null), which every existing duration display
// already renders as a dash rather than a value.
//
// A row with a missing or unparseable loggedAt is skipped, not treated as
// disqualifying (found by adversarial review): a naive "track the running
// max" loop that seeds from an unvalidated first element and only replaces
// it via `>` would get permanently stuck once that element's Date fails to
// parse — any comparison against NaN is false in both directions, so no
// later, valid, genuinely-later row could ever displace a NaN-poisoned
// "latest". Not reachable via today's real callers (v2_set_logs.logged_at
// is `timestamptz not null`; every Dexie writer sets loggedAt via
// new Date().toISOString()) but worth being a total, never-silently-wrong
// function over its declared input type rather than one that only happens
// to behave given today's callers.
export function deriveCompletedAt(logs: LoggedAtRow[]): string | null {
  let latest: LoggedAtRow | null = null
  let latestTime = -Infinity
  for (const log of logs) {
    if (!log) continue
    const time = new Date(log.loggedAt).getTime()
    if (Number.isNaN(time)) continue
    if (time > latestTime) {
      latest = log
      latestTime = time
    }
  }
  return latest?.loggedAt ?? null
}

// A session where every logged set was individually skipped is not
// meaningfully "completed" — 2026-08-22's real-bug diagnosis found exactly
// this: a session that landed as status 'completed' with all 10 of its
// v2_set_logs rows is_skipped: true, which resolveExerciseReference then
// correctly (by its own rules) treated as a legitimate LAST WEEK candidate —
// producing an analysis that read "wasn't logged last week" for exercises
// that WERE logged, just skipped. See CONTEXT.md. Fixing the semantic gap at
// the source (never writing status: 'completed' for this shape) is more
// robust than teaching every downstream consumer to special-case it.
//
// A session with ZERO logged sets is a different, pre-existing case (FINISH
// SESSION has no gate requiring anything be logged first) — `.every()` on an
// empty array is vacuously true, which would wrongly reclassify it, so this
// requires at least one row.
export interface SkippedRow {
  isSkipped: boolean
}

export function shouldClassifyAsSkipped(logs: SkippedRow[]): boolean {
  return logs.length > 0 && logs.every((log) => log.isSkipped)
}
