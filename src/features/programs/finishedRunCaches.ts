// What the phone refreshes when a finished program is deleted whole (chunk 75; 1.2.1 item 8b; SPEC Screens → Finished program: full delete, "On success";
// DECISIONS 249 row 22). Pure and import-free on purpose: `finishedRunCaches.static.test.ts` reads Coach's files and this one and must be able to load it
// without the app's Supabase client.
//
// The set is the UNION of History's own session delete (`useDeleteSession`) and the finish (`useCompleteSession`), because the full delete is both: it
// removes sessions, and it takes a whole program out of every list that counted it (pre-read 75-1). Every key is a prefix, so the keyed ones below it
// (a week, a workout, an exercise) are reached too. A key for the deleted program's own counts is NOT here: the confirmation is still reading it when
// the delete lands, and a refresh would ask the database about a program that is gone.

/** The program list (`useMesos`): FINISHED on PROGRAMS, History's program filter, Plan's "no program running" check. */
export const MESOS_KEY: readonly string[] = ['v2_mesos']

/**
 * `DONE_WEEK_PLANS_KEY` of `features/plan/useDoneWeekPlanIds.ts`, which every session writer refreshes by name (the key is its own prefix, not under
 * `v2_sessions`). Written out here so this file imports nothing; `finishedRunCaches.static.test.ts` reads the real constant and requires them equal.
 */
export const DONE_WEEK_PLANS_PREFIX = 'v2_doneWeekPlanIds'

/**
 * Coach's list keys that read a program's sessions, analyses or notes, and so list what the delete took (DECISIONS 249 rows 10, 13, 14, 15): the
 * notes; the session analyses and the sessions that can be analysed, with an analysis's detail; the same for weeks; the same for whole programs.
 * They are module-private in Coach's hooks (Coach is frozen: Escalation 16), so they are written out here and `finishedRunCaches.static.test.ts`
 * reads the key literals from those hooks and requires exactly these ten. Coach's memory, phases, weights and Q&A stay (rows 17 and 19: they are
 * not results of the program), so their keys are not here.
 */
export const COACH_KEYS_OF_A_DELETED_PROGRAM: readonly string[] = [
  'v2_coachNotes',
  'v2_coachAnalyzableSessions',
  'v2_coachAnalyses',
  'v2_coachAnalysisDetail',
  'v2_coachAnalyzableWeeks',
  'v2_coachWeekAnalyses',
  'v2_coachWeekAnalysisDetail',
  'v2_coachAnalyzableMesos',
  'v2_coachMesoAnalyses',
  'v2_coachMesoAnalysisDetail',
]

/** The prefixes refreshed after a successful full delete, History's session delete and the finish together, then Coach's. */
export function finishedRunInvalidations(): string[][] {
  return [
    [...MESOS_KEY],
    ['v2_history'],
    ['v2_sessions'],
    [DONE_WEEK_PLANS_PREFIX],
    ['v2_sessionTypeHistory'],
    ['v2_referenceSessions'],
    ['v2_lastDoneOrSkippedSession'],
    ['v2_exerciseProgress'],
    ['v2_mesoProgress'],
    ['v2_positionMatchedHeadline'],
    ['v2_positionMatchTable'],
    ['v2_programs'],
    ...COACH_KEYS_OF_A_DELETED_PROGRAM.map((key) => [key]),
  ]
}

/**
 * The cached reads that belong to one deleted session and are dropped outright, not refreshed (a refresh would ask for a row that is gone): its
 * History detail (as `useDeleteSession` removes it), and the workout's own read of it with its swaps.
 */
export function finishedRunRemovals(sessionIds: readonly string[]): string[][] {
  return sessionIds.flatMap((id) => [['v2_historyDetail', id], ['v2_session', id], ['v2_sessionSwaps', id]])
}
