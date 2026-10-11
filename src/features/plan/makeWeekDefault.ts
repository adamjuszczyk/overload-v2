import type { WeekPlan } from '../../types'

// Chunk 32 (TASKS-1.1 "Stable: Make this week the new default"; SPEC Weeks and copying
// [P1.1]): the pure half of the action. Supabase-free and React-free, so every rule
// below is tested directly; MakeWeekDefault.tsx draws the action and makeDefaultService.ts
// makes the call.
//
// Two things live here:
//   1. Whether a week can be made the default at all (canMakeWeekDefault), the client's
//      form of the function's own refusals.
//   2. The RPC's answer, parsed (parseMakeDefaultResult).
//
// There is no "apply this change to planned weeks ahead" offer after it: weeks that are
// already planned keep exactly what they have. (The offer, with the old default → new
// default mapping it needed, was written and then taken out of this chunk after review; it
// is recoverable from commit 933f2a1 for a later revision.)

// ─── 1. Can this week be made the default ─────────────────────────────────────

// A session can be the source of its workout's default when it is neither deload nor
// empty. This is v2_make_week_default's own test (migration 040: `usable = not is_deload
// and not is_empty`), kept in step with it: a session is empty when no planned set sits
// under any of its exercise rows (a set of a row the session no longer lists doesn't
// count — the function joins sets to the session's own exercise rows).
//   - deload: "Deload sessions are excluded: their workouts keep the current default";
//   - empty: the function skips it the way v2_plan_week skips an empty copy source
//     (DECISIONS 99, provisional), so one emptied session can't wipe its workout's default.
export function isDefaultSource(plan: Pick<WeekPlan, 'isDeload' | 'sets' | 'exercises'>): boolean {
  if (plan.isDeload) return false
  const rows = new Set(plan.exercises.map((e) => e.id))
  return plan.sets.some((s) => rows.has(s.programExerciseId))
}

// "It isn't offered on a week that's all deload" — and, as the function refuses it,
// not on a week whose sessions are all deload or empty either (and not on a week with
// no session planned yet). One session that can be a source is enough: the others keep
// their workouts' current default.
export function canMakeWeekDefault(plans: WeekPlan[]): boolean {
  return plans.some(isDefaultSource)
}

// ─── 2. The function's answer, parsed ─────────────────────────────────────────

export interface MakeDefaultResult {
  mesocycleId: string
  weekNumber: number
  // Workouts whose default was not touched: every session of theirs this week is deload
  // ('deload') or deload/empty mixed ('empty').
  skipped: { workoutDayId: string; reason: 'deload' | 'empty' }[]
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

// The function's jsonb (migration 040's header documents the shape), as camelCase values.
// Only what the action says is read: which workouts kept their default. Read leniently:
// the default has been written by the time this runs, so an answer that can't be read must
// not look like a failed call; it reads as "no workout was left alone".
export function parseMakeDefaultResult(json: unknown): MakeDefaultResult {
  const root = isObject(json) ? json : {}
  const skipped: MakeDefaultResult['skipped'] = []
  for (const raw of Array.isArray(root.skipped) ? root.skipped : []) {
    if (!isObject(raw) || !str(raw.workout_day_id)) continue
    skipped.push({ workoutDayId: str(raw.workout_day_id), reason: raw.reason === 'deload' ? 'deload' : 'empty' })
  }
  return { mesocycleId: str(root.mesocycle_id), weekNumber: num(root.week_number), skipped }
}
