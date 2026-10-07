import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import type { WeekPlan, WeekPlanSet, ProgramExercise, MuscleSubgroup, MovementPattern } from '../../types'
import { resolveManualCopySource, type PlannedWeekRecord } from './weekSources'
import {
  fetchRunProgramExercises,
  createWeekOnlyProgramExercise,
  fetchSwapSourceSlot,
} from '../programs/runProgramExercises'
import { resolveSwapSlot, resolveSwapCarry, resolveReorderCarry, resolveAddSlot } from './weekEdits'

// ─── DB Types ──────────────────────────────────────────────────────────────────

export type DbWeekPlanSet = {
  id: string
  week_plan_id: string
  user_id: string
  program_exercise_id: string
  set_number: number
  target_rir: number | null
  is_dropset: boolean
  // Absent until migration 004/006 has been applied.
  parent_week_plan_set_id?: string | null
  stage_index?: number
  is_warmup?: boolean
  // Absent until migration 027 has been applied (chunk 8's own fields,
  // same "may not exist yet" fallback convention as the others above).
  // program_set_id: the run copy's v2_program_sets row this came from —
  // carried forward verbatim on every week-to-week copy so a later chunk's
  // workout screen can still look up design fields (rest override, stage
  // rest) through it. stage_kind/rep_min/rep_max/is_amrap mirror the
  // program's own rep-target/stage-kind columns. target_weight/tags are
  // never read or written by this file's copy logic beyond carrying
  // target_weight through (tags are never copied — not read here at all).
  program_set_id?: string | null
  stage_kind?: 'dropset' | 'rest_pause' | 'myo_reps' | 'cluster' | null
  target_weight?: number | null
  rep_min?: number | null
  rep_max?: number | null
  is_amrap?: boolean
}

// Chunk 7 (TASKS.md "Each planned session owns its exercise list") — the
// joined shape needed to render a v2_week_plan_exercises row as a
// ProgramExercise, same fields sessionService.ts's own DbExercise /
// programService.ts's DbExerciseJoin independently carry (this codebase's
// existing convention: each service duplicates the lean row shape it needs
// rather than importing another feature's DB type).
type DbExerciseJoin = {
  id: string
  user_id: string
  name: string
  muscle_group: string | null
  is_archived: boolean
  created_at: string
  muscle_subgroup: MuscleSubgroup[] | null
  movement_pattern: MovementPattern | null
  status: string
  source_library_id: string | null
  lost_at: string | null
}

type DbProgramExerciseJoin = {
  id: string
  workout_day_id: string
  user_id: string
  exercise_id: string
  position: number
  weight_unit?: string | null // absent until migration 006 has been applied
  superset_block_id?: string | null // absent until migration 027 has been applied
  // Chunk 16 — same "column may not exist yet" fallback as superset_block_id
  // above. Read here (not only in runProgramExercises.ts) because a week's
  // own exercise list comes through THIS join (v2_week_plan_exercises ->
  // v2_program_exercises), same reasoning supersetBlockId's own comment below
  // already gives for why the block id is read from the joined row here.
  rest_seconds?: number | null
  rest_after_seconds?: number | null
  exercises: DbExerciseJoin | null
}

// v2_week_plan_exercises (027/029). The embed rule (DECISIONS 38): this
// table has TWO FKs to v2_program_exercises (program_exercise_id,
// carry_program_exercise_id), so the nested embed below must be hinted —
// see fetchWeekPlans' select for the exact hint string. v2_program_exercises
// is present (not optional) on every read this file does, since every select
// below asks for it; carry_* stay plain nullable columns, never embedded
// (nothing writes a non-null carry_* before chunk 9).
export type DbWeekPlanExercise = {
  id: string
  week_plan_id: string
  user_id: string
  program_exercise_id: string
  position: number
  carry_program_exercise_id: string | null
  carry_position: number | null
  created_at: string
  v2_program_exercises: DbProgramExerciseJoin
}

type DbWeekPlan = {
  id: string
  user_id: string
  mesocycle_id: string
  workout_day_id: string
  week_number: number
  is_deload: boolean
  notes: string | null
  created_at: string
  v2_week_plan_sets: DbWeekPlanSet[]
  v2_week_plan_exercises: DbWeekPlanExercise[]
}

// The same embed string is repeated as an inline literal at every
// v2_week_plans select below, rather than hoisted to a shared `const` —
// scripts/check-embeds.mjs's scan only recognises a quoted literal passed
// straight to .select(), so hoisting it would make every one of these
// embeds invisible to that check. v2_week_plan_sets(*) stays a sibling
// embed, never nested into v2_program_exercises itself (TASKS.md/DECISIONS
// 38: prefer v2_week_plan_exercises(…) as the junction from v2_week_plans to
// v2_program_exercises now that there are two); the nested
// v2_program_exercises embed is hinted by FK name (two FKs on
// v2_week_plan_exercises — program_exercise_id, carry_program_exercise_id —
// so an un-hinted embed there would be PGRST201-ambiguous).

// ─── Mappers ──────────────────────────────────────────────────────────────────

function toSet(row: DbWeekPlanSet): WeekPlanSet {
  return {
    id: row.id,
    weekPlanId: row.week_plan_id,
    userId: row.user_id,
    programExerciseId: row.program_exercise_id,
    setNumber: row.set_number,
    targetRir: row.target_rir,
    isDropset: row.is_dropset,
    // Same "column may not exist yet" fallback as autoFinishMinutes — safe
    // regardless of whether 004/006 have been applied when this code deploys.
    parentWeekPlanSetId: row.parent_week_plan_set_id ?? null,
    stageIndex: row.stage_index ?? 0,
    isWarmup: row.is_warmup ?? false,
    // Chunk 11 — the planned rep target (SPEC.md "Removals"), read-only here
    // (chunk 19 owns editing it). Same "may not exist yet" fallback as the
    // fields above; a row with none of the three set reads as "no target"
    // (columnsToRepTarget's own 'none' case) everywhere this is displayed.
    repMin: row.rep_min ?? null,
    repMax: row.rep_max ?? null,
    isAmrap: row.is_amrap ?? false,
    // Chunk 14 — heads only; a stage row's own value is always null (the
    // DB's own check, v2_week_plan_sets_stage_row_check). Same "may not
    // exist yet" fallback as the fields above.
    stageKind: row.stage_kind ?? null,
    // Chunk 16 — how the workout screen finds this set's own design fields
    // (rest override, stage rest) at session load — see types/index.ts's
    // own doc comment on WeekPlanSet.programSetId. Same "may not exist yet"
    // fallback; absent/undefined (every existing fixture) reads as null,
    // i.e. no per-set design fields reachable, falling through restChain.ts.
    programSetId: row.program_set_id ?? null,
  }
}

// A v2_week_plan_exercises row, as a ProgramExercise (the shape
// GymSession/SessionPreview/PlanPage already render) — position comes from
// THIS row (the week's own order), everything else from the joined
// v2_program_exercises/exercises (027/029's design: those don't get their
// own copy on the week's row, only identity + order do).
function toProgramExerciseFromWeekPlanExercise(row: DbWeekPlanExercise): ProgramExercise {
  const pe = row.v2_program_exercises
  const ex = pe.exercises
  return {
    id: pe.id,
    workoutDayId: pe.workout_day_id,
    userId: pe.user_id,
    exerciseId: pe.exercise_id,
    position: row.position,
    weightUnit: (pe.weight_unit ?? null) as ProgramExercise['weightUnit'],
    // Chunk 13 — "the workout screen reads blocks from the run copy when
    // the session loads" (SPEC "Supersets"): a week's own exercise list
    // comes through THIS join (v2_week_plan_exercises -> v2_program_exercises),
    // so the block id must be read from the joined row here, not from
    // `row` (the week_plan_exercises row itself never carries one — the
    // design field lives on the program exercise, always read live).
    supersetBlockId: pe.superset_block_id ?? null,
    // Chunk 16 — same fallback convention, read from the joined row for the
    // same reason supersetBlockId is (this is the week's own exercise list).
    restSeconds: pe.rest_seconds ?? null,
    restAfterSeconds: pe.rest_after_seconds ?? null,
    exercise: ex
      ? {
          id: ex.id,
          userId: ex.user_id,
          name: ex.name,
          muscleGroup: toMuscleGroup(ex.muscle_group),
          isArchived: ex.is_archived,
          createdAt: ex.created_at,
          muscleSubgroups: ex.muscle_subgroup,
          movementPattern: ex.movement_pattern,
          status: ex.status === 'lost' ? 'lost' : 'active',
          sourceLibraryId: ex.source_library_id,
          lostAt: ex.lost_at,
        }
      : undefined,
  }
}

function toPlan(row: DbWeekPlan): WeekPlan {
  return {
    id: row.id,
    userId: row.user_id,
    mesocycleId: row.mesocycle_id,
    workoutDayId: row.workout_day_id,
    weekNumber: row.week_number,
    isDeload: row.is_deload,
    notes: row.notes,
    sets: (row.v2_week_plan_sets ?? []).map(toSet).sort((a, b) => a.setNumber - b.setNumber),
    exercises: (row.v2_week_plan_exercises ?? [])
      .map(toProgramExerciseFromWeekPlanExercise)
      .sort((a, b) => a.position - b.position),
    createdAt: row.created_at,
  }
}

// ─── Week Plans ───────────────────────────────────────────────────────────────

export async function fetchWeekPlans(mesoId: string, weekNumber: number): Promise<WeekPlan[]> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*), v2_week_plan_exercises(*, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(*, exercises(*)))')
    .eq('mesocycle_id', mesoId)
    .eq('week_number', weekNumber)
  if (error) throw error
  return (data as DbWeekPlan[]).map(toPlan)
}

export async function createWeekPlan(
  userId: string,
  mesoId: string,
  workoutDayId: string,
  weekNumber: number,
): Promise<WeekPlan> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .insert({
      user_id: userId,
      mesocycle_id: mesoId,
      workout_day_id: workoutDayId,
      week_number: weekNumber,
      is_deload: false,
    })
    .select('*, v2_week_plan_sets(*), v2_week_plan_exercises(*, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(*, exercises(*)))')
    .single()
  if (error) throw error
  const plan = data as DbWeekPlan
  // Chunk 7 — a brand-new week plan row ("ADD SET" lazily creating one,
  // useAddSet/useWeekPlan.ts) starts with the workout's CURRENT program
  // exercises, in program order — the one path that reads straight off
  // v2_program_exercises rather than copying another week's own list
  // forward (copyOnePlanForward below), since there is no other week to
  // copy from here. Same shape migration 029's backfill writes for every
  // pre-existing row, so an old row and a brand new one end up identical.
  await writeWeekPlanExercisesFromProgram(userId, plan.id, workoutDayId)
  return toPlan(plan)
}

// Shared by createWeekPlan above (a fresh plan, no previous week to copy)
// and nowhere else — copyOnePlanForward's own fresh-insert branch instead
// copies the PREVIOUS week's own v2_week_plan_exercises forward
// (copyExercisesForward, below copySetsWithGrouping), not the program's
// current state, since "copy" means "copy that specific source", not
// "reset to the program". Plain insert (not upsert): a week plan row this
// function has just created cannot already have any v2_week_plan_exercises
// rows, so a real collision here would be a genuine bug, not a benign race.
//
// Chunk 9 — reads through fetchRunProgramExercises (runProgramExercises.ts)
// rather than v2_program_exercises directly, so this fresh-from-program read
// excludes week_only/removed_at rows exactly like migration 032's own
// 'program' branch does for the automatic case (v2_plan_week) — the one
// other place a week's volume is ever built straight from the program
// instead of copied from a previous week.
async function writeWeekPlanExercisesFromProgram(
  userId: string,
  weekPlanId: string,
  workoutDayId: string,
): Promise<void> {
  const rows = await fetchRunProgramExercises(workoutDayId)
  if (rows.length === 0) return

  const { error: insertError } = await supabase.from('v2_week_plan_exercises').insert(
    rows.map((pe) => ({
      week_plan_id: weekPlanId,
      user_id: userId,
      program_exercise_id: pe.id,
      position: pe.position,
    })),
  )
  if (insertError) throw insertError
}

export async function setDeload(weekPlanId: string, isDeload: boolean): Promise<void> {
  const { error } = await supabase
    .from('v2_week_plans')
    .update({ is_deload: isDeload })
    .eq('id', weekPlanId)
  if (error) throw error
}

// ─── Sets ─────────────────────────────────────────────────────────────────────

export async function addSet(
  userId: string,
  weekPlanId: string,
  programExerciseId: string,
  setNumber: number,
): Promise<WeekPlanSet> {
  const { data, error } = await supabase
    .from('v2_week_plan_sets')
    .insert({
      week_plan_id: weekPlanId,
      user_id: userId,
      program_exercise_id: programExerciseId,
      set_number: setNumber,
      target_rir: null,
      is_dropset: false,
    })
    .select()
    .single()
  if (error) throw error
  return toSet(data as DbWeekPlanSet)
}

// Phase 3.1's real stage-authoring interaction (TASKS.md §4 item 10):
// PlanPage.tsx's ADD STAGE is tied to a specific existing set, so the parent
// id is given directly here — same reasoning as GymSession.tsx's ADD STAGE
// (see setGroupLogic.ts). This retires the nearest-preceding-non-dropset
// inference updateSet() used to need for this: there is no more "toggle
// this set into a dropset" interaction to infer a parent for. Stages share
// their head's set_number by convention (TASKS.md §2.1); stageIndex is the
// caller's count of that head's existing stages + 1.
export async function addStage(
  userId: string,
  weekPlanId: string,
  programExerciseId: string,
  parentId: string,
  setNumber: number,
  stageIndex: number,
): Promise<WeekPlanSet> {
  const { data, error } = await supabase
    .from('v2_week_plan_sets')
    .insert({
      week_plan_id: weekPlanId,
      user_id: userId,
      program_exercise_id: programExerciseId,
      set_number: setNumber,
      target_rir: null,
      is_dropset: true,
      parent_week_plan_set_id: parentId,
      stage_index: stageIndex,
    })
    .select()
    .single()
  if (error) throw error
  return toSet(data as DbWeekPlanSet)
}

export async function updateSet(
  id: string,
  changes: {
    targetRir?: number | null
    stageKind?: 'dropset' | 'rest_pause' | 'myo_reps' | 'cluster' | null
    isWarmup?: boolean
  },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if ('targetRir' in changes) patch.target_rir = changes.targetRir
  // Chunk 14 — the week plan's own stage-kind picker (PlanPage.tsx), a
  // head-only field (the DB's own check — v2_week_plan_sets_stage_row_check
  // — refuses it on a stage row; this UI never targets one).
  if ('stageKind' in changes) patch.stage_kind = changes.stageKind
  // Chunk 15 (SPEC "Warmup sets") — the week plan's own WARMUP toggle
  // (PlanPage.tsx), head-only by the same posture: PlanPage never offers
  // it on a stage row or once a head already has stages.
  if ('isWarmup' in changes) patch.is_warmup = changes.isWarmup

  const { error } = await supabase.from('v2_week_plan_sets').update(patch).eq('id', id)
  if (error) throw error
}

export async function removeSet(id: string): Promise<void> {
  const { error } = await supabase.from('v2_week_plan_sets').delete().eq('id', id)
  if (error) throw error
}

export async function fetchAllWeekPlansForMeso(mesoId: string): Promise<WeekPlan[]> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*), v2_week_plan_exercises(*, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(*, exercises(*)))')
    .eq('mesocycle_id', mesoId)
  if (error) throw error
  return (data as DbWeekPlan[]).map(toPlan)
}

export async function fetchWeekPlanById(id: string): Promise<WeekPlan> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*), v2_week_plan_exercises(*, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(*, exercises(*)))')
    .eq('id', id)
    .single()
  if (error) throw error
  return toPlan(data as DbWeekPlan)
}

// ─── Plan the week (automatic) ─────────────────────────────────────────────────
// Chunk 8 (TASKS.md "Weeks plan themselves, from the right source") —
// v2_plan_week (migration 031). Plan's week view and Today both call this
// unconditionally (it is atomic and idempotent — a repeat call is always
// safe and simply plans 0); see useWeekPlan.ts's usePlanWeek for the
// invalidation that follows a real plan. Returns the number of sessions
// THIS call actually planned (0 on a week that already exists).
export async function planWeek(mesoId: string, weekNumber: number): Promise<number> {
  const { data, error } = await supabase.rpc('v2_plan_week', {
    p_mesocycle_id: mesoId,
    p_week_number: weekNumber,
  })
  if (error) throw error
  return data as number
}

// ─── Copy from previous week (manual) ──────────────────────────────────────────
// SPEC "Weeks and copying": "'Copy last week' stays as a manual action" —
// under the SAME source rules as the automatic v2_plan_week (deload
// sessions are never a copy source; tags and is_deload never copied), not
// literally "week N − 1": a week that's partly deload still copies its
// normal sessions, and its deload sessions copy from the last normal
// occurrence, found independently per workout — see weekSources.ts's
// resolveManualCopySource, which both copy actions below share.

// This week's own workout_day_ids with nothing planned yet (zero of its
// own v2_week_plan_exercises) — the discovery mechanism for COPY WEEK.
// Reads the CURRENT week's own rows rather than the program's schedule:
// v2_plan_week already creates one v2_week_plans row per scheduled workout
// (possibly empty) the moment the week is opened/started, so by the time a
// manual copy can even be offered, every workout that belongs to this week
// already has a row — this just finds which ones are still empty.
async function fetchEmptyWorkoutPlanIds(
  mesoId: string,
  weekNumber: number,
): Promise<{ weekPlanId: string; workoutDayId: string }[]> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('id, workout_day_id, v2_week_plan_exercises(id)')
    .eq('mesocycle_id', mesoId)
    .eq('week_number', weekNumber)
  if (error) throw error
  const rows = (data ?? []) as { id: string; workout_day_id: string; v2_week_plan_exercises: { id: string }[] }[]
  return rows
    .filter((r) => (r.v2_week_plan_exercises ?? []).length === 0)
    .map((r) => ({ weekPlanId: r.id, workoutDayId: r.workout_day_id }))
}

// Every planned occurrence of one workout in this meso (any week number),
// for resolveManualCopySource's backward search — the client-side
// equivalent of what v2_plan_week reads straight from v2_week_plans itself.
// isEmpty (DECISIONS 42 (b)) is computed the same way the migration's SQL
// does — zero v2_week_plan_sets rows, never the exercise list (a week can
// carry exercise rows with no sets under them) — via the embed below,
// unambiguous (one FK, v2_week_plan_sets.week_plan_id → v2_week_plans.id).
async function fetchPlannedWeekHistory(mesoId: string, workoutDayId: string): Promise<PlannedWeekRecord[]> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('week_number, is_deload, v2_week_plan_sets(id)')
    .eq('mesocycle_id', mesoId)
    .eq('workout_day_id', workoutDayId)
  if (error) throw error
  const rows = (data ?? []) as { week_number: number; is_deload: boolean; v2_week_plan_sets: { id: string }[] }[]
  return rows.map((r) => ({
    weekNumber: r.week_number,
    isDeload: r.is_deload,
    isEmpty: (r.v2_week_plan_sets ?? []).length === 0,
  }))
}

// Shared by both manual copy actions below: resolves this one workout's
// source (weekSources.ts), fetches that source week's plan if one was
// found, and copies it forward via copyOnePlanForward — a no-op when there
// is nothing non-deload to copy ("missing source").
async function copyOneWorkoutFromHistory(
  userId: string,
  mesoId: string,
  weekNumber: number,
  workoutDayId: string,
  existingWeekPlanId?: string,
): Promise<void> {
  const history = await fetchPlannedWeekHistory(mesoId, workoutDayId)
  const source = resolveManualCopySource(history, weekNumber)
  if (source.kind === 'none') return

  const { data: prevPlan, error } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*), v2_week_plan_exercises(*, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(*, exercises(*)))')
    .eq('mesocycle_id', mesoId)
    .eq('week_number', source.weekNumber)
    .eq('workout_day_id', workoutDayId)
    .maybeSingle()
  if (error) throw error
  if (!prevPlan) return

  await copyOnePlanForward(userId, mesoId, weekNumber, prevPlan as DbWeekPlan, existingWeekPlanId)
}

export async function copyFromPreviousWeek(
  userId: string,
  mesoId: string,
  weekNumber: number,
): Promise<void> {
  const empties = await fetchEmptyWorkoutPlanIds(mesoId, weekNumber)
  for (const { weekPlanId, workoutDayId } of empties) {
    await copyOneWorkoutFromHistory(userId, mesoId, weekNumber, workoutDayId, weekPlanId)
  }
}

// Phase 3.7's scoped twin of copyFromPreviousWeek (TASKS.md §4 item 31 /
// SPEC §5) — same source rules, but filtered to one workoutDayId instead of
// every empty workout in the week. `existingWeekPlanId` lets the caller
// pass an already-created (possibly still-empty) week_plan row for this
// workout/week so this doesn't create a duplicate — same optional-id pattern
// useAddSet/addSet already uses.
export async function copyWorkoutFromPreviousWeek(
  userId: string,
  mesoId: string,
  weekNumber: number,
  workoutDayId: string,
  existingWeekPlanId?: string,
): Promise<void> {
  await copyOneWorkoutFromHistory(userId, mesoId, weekNumber, workoutDayId, existingWeekPlanId)
}

// Shared by both copy actions above — the two differ only in how they pick
// which previous-week plan(s) to walk (every plan in the week vs. one
// workout's plan); once a source plan is picked, copying it forward is
// identical either way. Creates the destination week_plan row unless the
// caller already has one (copyWorkoutFromPreviousWeek's existingWeekPlanId),
// then hands the set-copying itself to copySetsWithGrouping unchanged.
async function copyOnePlanForward(
  userId: string,
  mesoId: string,
  weekNumber: number,
  prevPlan: DbWeekPlan,
  existingWeekPlanId?: string,
): Promise<void> {
  const prevSets = (prevPlan.v2_week_plan_sets ?? []) as DbWeekPlanSet[]
  if (prevSets.length === 0) return

  let newWeekPlanId = existingWeekPlanId
  if (!newWeekPlanId) {
    // Chunk 8 (TASKS.md "Found in the code", fact 1) — is_deload is never
    // copied (SPEC "Weeks and copying"): the column default (false) is what
    // a freshly planned session gets, regardless of the source's own flag.
    // Before this chunk this insert wrote `is_deload: prevPlan.is_deload`,
    // so copying a deload week made the next week deload too.
    const { data: newPlan, error } = await supabase
      .from('v2_week_plans')
      .insert({
        user_id: userId,
        mesocycle_id: mesoId,
        workout_day_id: prevPlan.workout_day_id,
        week_number: weekNumber,
      })
      .select()
      .single()
    if (error) throw error
    newWeekPlanId = (newPlan as { id: string }).id
  }
  // Else: reusing an already-created plan row (v2_plan_week already created
  // it — possibly empty — when the week was opened/started; useAddSet's
  // lazy-create precedes it too). Its is_deload is already false (the
  // column default, never copied) and chunk 8 removes the old sync that
  // used to overwrite it from the source — is_deload is never copied,
  // whichever branch creates the row.

  // Chunk 7 — the destination week's own exercise list, copied forward from
  // the SOURCE week's list (prevPlan's own v2_week_plan_exercises), not
  // re-read from the program's current state: "copy" means "copy that
  // specific source", exactly like copySetsWithGrouping below copies
  // prevPlan's own sets rather than resetting to some other source. Upsert
  // (copyExercisesForward's default), not plain insert: the
  // existingWeekPlanId branch above may be reusing a row
  // createWeekPlan/writeWeekPlanExercisesFromProgram already gave a full
  // exercise list (useAddSet's lazy-create, TASKS.md §4 item 31's own
  // existingWeekPlanId precedent) — the same (week_plan_id,
  // program_exercise_id) pairs would otherwise collide on the unique key.
  const prevExercises = (prevPlan.v2_week_plan_exercises ?? []) as DbWeekPlanExercise[]
  await copyExercisesForward(userId, newWeekPlanId, prevExercises)
  // Chunk 9 — prevExercises passed through so a set that "moved with" an
  // only-this-week swap (swapWeekExercise) follows its exercise row back to
  // the original slot here too, the same fix migration 032 makes in
  // v2_plan_week's own week-to-week branch (see copySetsWithGrouping's own
  // header for the exact mapping rule).
  await copySetsWithGrouping(userId, newWeekPlanId, prevSets, undefined, prevExercises)
}

// A single batched upsert, factored out so tests can substitute a fake and
// assert on exactly what copyExercisesForward tried to write — same
// injection-seam pattern as defaultInsertPlanSet/copySetsWithGrouping below.
// Upsert, not plain insert: see copyOnePlanForward's own comment above for
// why its existingWeekPlanId branch can hand this a week plan that already
// has some of these rows.
async function defaultUpsertPlanExercises(payloads: Record<string, unknown>[]): Promise<void> {
  if (payloads.length === 0) return
  const { error } = await supabase
    .from('v2_week_plan_exercises')
    .upsert(payloads, { onConflict: 'week_plan_id,program_exercise_id' })
  if (error) throw error
}

// Copies one week_plan's exercise list forward — "what copying forward
// uses" is literally what TASKS.md's data model calls
// carry_program_exercise_id/carry_position: a row with no override (every
// row before chunk 9 — nothing sets carry_* yet) just carries its own
// program_exercise_id/position forward verbatim; an "only this week"
// swap/reorder would instead carry forward the PRE-swap/reorder slot
// recorded there. The new row always starts with carry_* null (omitted from
// the payload, same as every other write in this file) — it has no
// override of its own yet, whatever its source row had.
//
// Exported (and takes an injectable upsertPlanExercises) for the same
// reason copySetsWithGrouping is: so a test can exercise the
// carry_*-fallback logic directly, without a real Supabase round-trip.
export async function copyExercisesForward(
  userId: string,
  newWeekPlanId: string,
  prevExercises: DbWeekPlanExercise[],
  upsertPlanExercises: (payloads: Record<string, unknown>[]) => Promise<void> = defaultUpsertPlanExercises,
): Promise<void> {
  const payloads = prevExercises.map((ex) => ({
    week_plan_id: newWeekPlanId,
    user_id: userId,
    program_exercise_id: ex.carry_program_exercise_id ?? ex.program_exercise_id,
    position: ex.carry_position ?? ex.position,
  }))
  await upsertPlanExercises(payloads)
}

// A single new-row insert, factored out so tests can substitute a fake and
// assert on exactly what copySetsWithGrouping tried to write — real behaviour
// (the supabase call) is unchanged, this is purely an injection seam.
async function defaultInsertPlanSet(
  payload: Record<string, unknown>,
): Promise<DbWeekPlanSet> {
  const { data, error } = await supabase
    .from('v2_week_plan_sets')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data as DbWeekPlanSet
}

// Copies one week_plan's sets forward via a direct old-id → new-id map,
// instead of re-inferring grouping from set_number ordering the way this
// used to work (AUDIT M5's plan-side fix, pre-Phase-3.1). That re-inference
// assumed every stage's set_number was strictly greater than its head's —
// true for legacy rows, but no longer true for Phase 3.1's ADD STAGE, which
// writes stages sharing their head's set_number (TASKS.md §2.1). It would
// silently fail to reattach any dropset authored through ADD STAGE. A direct
// map works for both: Phase 3.0's backfill + M5 fixes mean
// parent_week_plan_set_id is now correctly populated on every existing row
// (log side 8/8, plan side 7/7, independently verified — see CONTEXT.md), so
// there's no longer a reason to re-derive it here at all. Heads are inserted
// first so each stage's new parent id is already resolvable when its own row
// is created.
//
// Exported (and takes an injectable insertPlanSet) so Phase 3.7's test suite
// can exercise the reattachment logic directly without a real Supabase
// round-trip — the id-remapping is the part that's actually risky, not the
// insert call itself. Called once per week_plan by both copyFromPreviousWeek
// (in a loop, one call per workout in the week) and
// copyWorkoutFromPreviousWeek (a single call) — this function has no
// awareness of which caller it's serving, which is exactly what makes it
// safe to share: whole-week scope is just "call this per plan," never a
// different code path through here.
//
// prevExercises (chunk 9 — TASKS.md "the client-side copies... must apply
// the same mapping" as migration 032): the SOURCE week's own
// v2_week_plan_exercises rows, optional and defaulting to `[]` so every
// existing call (none of which pass it) keeps compiling and behaving
// exactly as before — an empty list builds an empty map, and a set whose
// program_exercise_id has no entry falls back to itself (identical to
// today). When a caller DOES pass the source week's exercises (every real
// week-to-week copy — copyOnePlanForward, below), each set's
// program_exercise_id is looked up through the SAME mapping
// copyExercisesForward already applies to the exercise rows themselves
// (program_exercise_id -> carry_program_exercise_id ?? program_exercise_id,
// keyed by the row's OWN current program_exercise_id — the same identity
// its sets point at), so a set that "moved with" an only-this-week swap
// (swapWeekExercise, above) follows its exercise row back to the original
// slot when copied forward, instead of carrying the week-only replacement's
// id through unmapped — exactly the bug migration 032's own header fixes
// in the SQL function this mirrors.
export async function copySetsWithGrouping(
  userId: string,
  newWeekPlanId: string,
  prevSets: DbWeekPlanSet[],
  insertPlanSet: (payload: Record<string, unknown>) => Promise<DbWeekPlanSet> = defaultInsertPlanSet,
  prevExercises: DbWeekPlanExercise[] = [],
): Promise<void> {
  const exerciseIdMap = new Map<string, string>(
    prevExercises.map((ex) => [ex.program_exercise_id, ex.carry_program_exercise_id ?? ex.program_exercise_id]),
  )
  const mapExerciseId = (id: string) => exerciseIdMap.get(id) ?? id

  const idMap = new Map<string, string>()
  const heads = prevSets.filter((s) => s.parent_week_plan_set_id == null)
  const stages = prevSets.filter((s) => s.parent_week_plan_set_id != null)

  for (const s of heads) {
    const newRow = await insertPlanSet({
      week_plan_id: newWeekPlanId,
      user_id: userId,
      program_exercise_id: mapExerciseId(s.program_exercise_id),
      set_number: s.set_number,
      target_rir: s.target_rir,
      is_dropset: s.is_dropset,
      stage_index: s.stage_index ?? 0,
      // Chunk 8 — every column 027 added, carried through verbatim (a
      // week-to-week copy needs no mapping: the source row already carries
      // its own weight/RIR target, unlike a fresh copy from the program,
      // which has none to carry — see weekSources.ts's header). tags is
      // deliberately absent: "Tags are never copied" (SPEC).
      program_set_id: s.program_set_id ?? null,
      stage_kind: s.stage_kind ?? null,
      target_weight: s.target_weight ?? null,
      rep_min: s.rep_min ?? null,
      rep_max: s.rep_max ?? null,
      is_amrap: s.is_amrap ?? false,
    })
    idMap.set(s.id, newRow.id)
  }

  for (const s of stages) {
    const newParentId = s.parent_week_plan_set_id ? idMap.get(s.parent_week_plan_set_id) : undefined
    const newRow = await insertPlanSet({
      week_plan_id: newWeekPlanId,
      user_id: userId,
      program_exercise_id: mapExerciseId(s.program_exercise_id),
      set_number: s.set_number,
      target_rir: s.target_rir,
      is_dropset: s.is_dropset,
      parent_week_plan_set_id: newParentId ?? null,
      stage_index: s.stage_index ?? 0,
      // A stage row's own stage_kind is already null by 027's own check
      // (v2_week_plan_sets_stage_row_check) — carried through the same as
      // a head's, never forced.
      program_set_id: s.program_set_id ?? null,
      stage_kind: s.stage_kind ?? null,
      target_weight: s.target_weight ?? null,
      rep_min: s.rep_min ?? null,
      rep_max: s.rep_max ?? null,
      is_amrap: s.is_amrap ?? false,
    })
    idMap.set(s.id, newRow.id)
  }
}

// ─── Week actions — swap, reorder, add, remove ─────────────────────────────
// Chunk 9 (TASKS.md "Edit a week's exercises" / SPEC.md "Weeks and
// copying"). The pure carry/slot decisions live in weekEdits.ts (unit
// tested there, directly); this file gathers what each decision needs and
// performs the writes, same split as every other action in this file.

// weekEdits.ts's resolveSwapCarry/resolveReorderCarry both need the row's
// CURRENT carry_program_exercise_id/carry_position, not just this edit's
// own before-state — an only-this-week edit must keep whatever original an
// earlier only-this-week edit of the same kind already recorded there,
// rather than recompute from this edit's own (possibly already-intermediate)
// before-state alone. Read before every swap/reorder write, never cached.
async function fetchCurrentCarry(
  weekPlanId: string,
  programExerciseId: string,
): Promise<{ carryProgramExerciseId: string | null; carryPosition: number | null }> {
  const { data, error } = await supabase
    .from('v2_week_plan_exercises')
    .select('carry_program_exercise_id, carry_position')
    .eq('week_plan_id', weekPlanId)
    .eq('program_exercise_id', programExerciseId)
    .single()
  if (error) throw error
  const row = data as { carry_program_exercise_id: string | null; carry_position: number | null }
  return { carryProgramExerciseId: row.carry_program_exercise_id, carryPosition: row.carry_position }
}

// A swap: creates a week-only program exercise for the replacement
// (runProgramExercises.ts — takes the replaced slot's superset block, never
// its weight_unit), points this week's own
// v2_week_plan_exercises row at it, and moves this week's own planned sets
// for that exercise onto it too (so the exercise card and its sets agree on
// what's actually planned this week). "Only this week" records the
// pre-swap slot in carry_program_exercise_id (weekEdits.ts's
// resolveSwapCarry) — unless this row already carries one from an earlier
// only-this-week swap, in which case that original wins and is kept (so a
// repeated only-this-week swap keeps reverting to the true original
// instead of drifting to the most recent swap's own pre-swap, already
// week-only, identity) — so copying forward reverts to it; off (the
// default), the swap is a permanent, carried-forward change, and always
// clears carry_program_exercise_id even if an earlier only-this-week swap
// left one behind.
export async function swapWeekExercise(params: {
  userId: string
  weekPlanId: string
  programExerciseId: string
  replacementExerciseId: string
  onlyThisWeek: boolean
}): Promise<ProgramExercise> {
  const { userId, weekPlanId, programExerciseId, replacementExerciseId, onlyThisWeek } = params

  const [source, currentCarry] = await Promise.all([
    fetchSwapSourceSlot(programExerciseId),
    fetchCurrentCarry(weekPlanId, programExerciseId),
  ])
  const slot = resolveSwapSlot(source, replacementExerciseId)
  const replacement = await createWeekOnlyProgramExercise(userId, slot)
  const carry = resolveSwapCarry(currentCarry, programExerciseId, onlyThisWeek)

  const { error: exError } = await supabase
    .from('v2_week_plan_exercises')
    .update({
      program_exercise_id: replacement.id,
      carry_program_exercise_id: carry.carryProgramExerciseId,
      carry_position: carry.carryPosition,
    })
    .eq('week_plan_id', weekPlanId)
    .eq('program_exercise_id', programExerciseId)
  if (exError) throw exError

  // "its planned sets move with it" (TASKS.md) — this week's own sets for
  // the replaced slot now belong to the replacement, so the exercise card
  // and its sets keep agreeing on what's planned this week (and so a later
  // copy-forward's set remap, migration 032's own fix, has a matching
  // v2_week_plan_exercises row to map through).
  const { error: setsError } = await supabase
    .from('v2_week_plan_sets')
    .update({ program_exercise_id: replacement.id })
    .eq('week_plan_id', weekPlanId)
    .eq('program_exercise_id', programExerciseId)
  if (setsError) throw setsError

  return replacement
}

// An add: a brand-new week-only slot (never in a superset — weekEdits.ts's
// resolveAddSlot), inserted into this week's own exercise list with no
// carry_* override at all — week-dependent carries it forward purely
// because the next week's copy includes whatever this week's own
// v2_week_plan_exercises row names (DECISIONS 48 (a): no tick, no schema,
// for add); stable never carries it forward, because a stable week is
// always built fresh from the program, never from the previous week.
export async function addWeekExercise(params: {
  userId: string
  weekPlanId: string
  workoutDayId: string
  exerciseId: string
  position: number
}): Promise<ProgramExercise> {
  const { userId, weekPlanId, workoutDayId, exerciseId, position } = params
  const slot = resolveAddSlot(workoutDayId, exerciseId, position)
  const created = await createWeekOnlyProgramExercise(userId, slot)

  const { error } = await supabase.from('v2_week_plan_exercises').insert({
    user_id: userId,
    week_plan_id: weekPlanId,
    program_exercise_id: created.id,
    position,
  })
  if (error) throw error
  return created
}

// A remove: drops this week's own exercise row and its planned sets (both
// heads and stages — no FK links v2_week_plan_sets to
// v2_week_plan_exercises, only the application-level (week_plan_id,
// program_exercise_id) convention 027 establishes, so both need an explicit
// delete). No carry_* to write: a row that doesn't exist in the week being
// copied forward is simply absent from the copy (DECISIONS 48 (a) — same
// reasoning as add, the other action with no "only this week" tick).
export async function removeWeekExercise(weekPlanId: string, programExerciseId: string): Promise<void> {
  const { error: setsError } = await supabase
    .from('v2_week_plan_sets')
    .delete()
    .eq('week_plan_id', weekPlanId)
    .eq('program_exercise_id', programExerciseId)
  if (setsError) throw setsError

  const { error } = await supabase
    .from('v2_week_plan_exercises')
    .delete()
    .eq('week_plan_id', weekPlanId)
    .eq('program_exercise_id', programExerciseId)
  if (error) throw error
}

// A reorder: each moved row's own position, plus (weekEdits.ts's
// resolveReorderCarry) its carry_position — "only this week" ticked keeps
// the PRE-reorder position there so copying forward reverts to the old
// order, unless this row already carries one from an earlier only-this-week
// reorder, in which case that original position wins and is kept (same
// "existing carry wins" rule swap uses, so a repeated only-this-week
// reorder keeps reverting to the true original order instead of drifting
// to the most recent reorder's own pre-reorder, already-moved, position);
// off, carry_position always clears, even overwriting a stale value an
// earlier only-this-week reorder of the same row left behind.
export async function reorderWeekExercises(
  weekPlanId: string,
  moves: { programExerciseId: string; oldPosition: number; newPosition: number }[],
  onlyThisWeek: boolean,
): Promise<void> {
  for (const m of moves) {
    const currentCarry = await fetchCurrentCarry(weekPlanId, m.programExerciseId)
    const carry = resolveReorderCarry(currentCarry, m.oldPosition, onlyThisWeek)
    const { error } = await supabase
      .from('v2_week_plan_exercises')
      .update({ position: m.newPosition, carry_position: carry.carryPosition })
      .eq('week_plan_id', weekPlanId)
      .eq('program_exercise_id', m.programExerciseId)
    if (error) throw error
  }
}
