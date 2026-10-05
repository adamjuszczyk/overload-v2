// Chunk 8 (TASKS.md "Weeks plan themselves, from the right source" /
// SPEC.md "Weeks and copying") — the pure decision this chunk's migration,
// `v2_plan_week`, is kept identical to (see that function's own header
// comment in supabase/migrations/031_planner_p1_plan_week.sql, and this
// chunk's report for the scratch test that runs both on one fixture). No
// Supabase here: every caller (the SQL function server-side; the manual
// copy actions in weekPlanService.ts client-side) gathers the small bit of
// history this module needs and hands it in.
//
// What this module does NOT decide: how to copy the sets of one chosen
// source into a new week. A week-to-week copy (every case below except a
// fresh "from program" one) is a straight old-id → new-id remap — weight,
// RIR, rep targets and everything else ride along for free because the
// source row already has them (weekPlanService.ts's copySetsWithGrouping /
// copyExercisesForward do this client-side; v2_plan_week does the SQL
// equivalent). A fresh "from program" copy (stable; week 1 of either type)
// has no weight/RIR of its own to carry — v2_program_sets has no such
// columns, "week plan only, never in the program" — so mapping the last
// planned week's weight/RIR onto the newly copied sets is a second, later
// step with no TS equivalent at all: no client caller ever performs that
// specific copy (the manual COPY WEEK/COPY THIS WORKOUT actions only ever
// copy week-to-week — see weekPlanService.ts's copyOneWorkoutFromHistory —
// since a real stable program can't even be created before chunk 11). That
// mapping rule is written down once, in the migration's own comment.

export type PlanningType = 'stable' | 'week_dependent'
export type WeekStartSetting = 'copy' | 'empty'

// One planned occurrence of ONE workout, as far as source selection cares.
// Callers pass only this workout's own history — a different workout in
// the same week can have a different answer (SPEC: "A week that's partly
// deload still copies its normal sessions; its deload sessions copy from
// the last normal occurrence").
export interface PlannedWeekRecord {
  weekNumber: number
  isDeload: boolean
}

export type VolumeSource =
  | { kind: 'program' } // the run's own copy (v2_program_exercises + v2_program_sets), read fresh
  | { kind: 'week'; weekNumber: number } // that workout's own planned week, copied forward
  | { kind: 'empty' } // nothing to copy — the row still gets created, with no content

export type WeightRirSource =
  | { kind: 'week'; weekNumber: number }
  | { kind: 'none' } // no earlier planned week exists (or none that isn't deload) — no target

export interface WeekSourceDecision {
  volume: VolumeSource
  weightRir: WeightRirSource
}

// The one search every decision below is built from: among `priorWeeks`
// (already-planned occurrences of ONE workout, any order, any subset of
// week numbers), the most recent one strictly before `beforeWeek` that
// isn't itself a deload session (SPEC: "Deload sessions are never a copy
// source"). Only deload is excluded here — an occurrence that was itself
// planned *empty* (no deload flag, just nothing in it) still counts as the
// most recent one, so it becomes the next week's literal source too; SPEC
// names exactly one exclusion for this search (deload), not "empty", and
// this chunk's report calls this consequence out explicitly as a judgement
// call rather than inventing a second exclusion SPEC never states.
export function findLastNonDeloadWeek(
  priorWeeks: PlannedWeekRecord[],
  beforeWeek: number,
): number | null {
  let best: number | null = null
  for (const w of priorWeeks) {
    if (w.weekNumber < beforeWeek && !w.isDeload) {
      if (best === null || w.weekNumber > best) best = w.weekNumber
    }
  }
  return best
}

// Automatic planning's decision — v2_plan_week mirrors this exactly for
// every workout of the week it is asked to plan.
export function resolveWeekSources(input: {
  planningType: PlanningType
  weekNumber: number
  weekStart: WeekStartSetting
  priorWeeks: PlannedWeekRecord[]
}): WeekSourceDecision {
  const { planningType, weekNumber, weekStart, priorWeeks } = input
  const lastNonDeload = findLastNonDeloadWeek(priorWeeks, weekNumber)
  const weightRir: WeightRirSource =
    lastNonDeload === null ? { kind: 'none' } : { kind: 'week', weekNumber: lastNonDeload }

  let volume: VolumeSource
  if (weekNumber === 1 || planningType === 'stable') {
    // SPEC: "stable → the run's copy, always" / "week-dependent → ...
    // week 1 from the run copy".
    volume = { kind: 'program' }
  } else if (weekStart === 'empty') {
    // SPEC: "a setting lets weeks start empty instead" — governs the
    // AUTOMATIC fill only; the manual copy actions below don't consult it.
    volume = { kind: 'empty' }
  } else if (lastNonDeload !== null) {
    volume = { kind: 'week', weekNumber: lastNonDeload }
  } else {
    // week_start = 'copy' but there is nothing non-deload to copy yet
    // (e.g. this workout's only prior occurrence(s) were all deload, or it
    // has never been planned at all) — SPEC names exactly two sources for
    // a week-dependent week beyond week 1 ("the last planned [non-deload]
    // week", or empty); with neither available, empty is what's left.
    volume = { kind: 'empty' }
  }

  return { volume, weightRir }
}

// "Copy last week" / "Copy this workout" (manual actions, SPEC: "'Copy
// last week' stays as a manual action") — the SAME backward, deload
// skipping search as the automatic function's volume source, independent
// of week_start (that setting only governs what happens automatically) and
// of planning type (no real stable program exists before chunk 11, so the
// manual actions make no distinction here — see this chunk's report for
// why that reading was chosen over an alternative). 'none' is the "missing
// source" case the brief calls for: the caller no-ops (nothing to copy).
export function resolveManualCopySource(
  priorWeeks: PlannedWeekRecord[],
  beforeWeek: number,
): { kind: 'week'; weekNumber: number } | { kind: 'none' } {
  const found = findLastNonDeloadWeek(priorWeeks, beforeWeek)
  return found === null ? { kind: 'none' } : { kind: 'week', weekNumber: found }
}
