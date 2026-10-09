import type { SetLog } from '../../types'

// Chunk 15 (SPEC "Warmup sets" — "never counted in ... set counts").
// Extracted (not inlined in CompletedTodayScreen) so this one count is
// directly testable without rendering the whole scheduler-dependent
// screen — same "pure logic lives in testable modules" precedent as
// setGroupLogic.ts/e1rm.ts elsewhere in this app. A warmup is never
// skipped in practice (SetRow.tsx's isWarmup branch offers no SKIP
// affordance), so excluding it from both counts keeps them mutually
// exclusive and exhaustive over every non-warmup log, same as before this
// chunk.
//
// Chunk 25 — moved out of TodayPage.tsx into its own file (previously
// exported from there) so CompletedTodayScreen.tsx (also extracted this
// chunk, so SequenceTodayPage.tsx can reuse it without creating a circular
// import with TodayPage.tsx) can import it without depending on
// TodayPage.tsx at all. TodayPage.warmup.test.ts's own import path moved
// with it.
export function countCompletedSets(setLogs: SetLog[]): { total: number; skipped: number } {
  const real = setLogs.filter((l) => !l.isWarmup)
  return {
    total: real.filter((l) => !l.isSkipped).length,
    skipped: real.filter((l) => l.isSkipped).length,
  }
}
