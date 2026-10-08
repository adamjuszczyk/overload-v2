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
import {
  resolveDeloadBaseOccurrence,
  calculateDeloadSets,
  buildDeloadRestoreSnapshot,
  groupDeloadRestoreEntries,
  occurrenceHasWorkingLog,
  resolveLoggedWeightKg,
  type DeloadRules,
  type DeloadSourceSet,
  type DeloadCalculatedSet,
  type DeloadRestoreEntry,
  type DeloadSetLogRecord,
} from '../../lib/deloadRules'

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
  // Chunk 19 — read by toSet() below (Plan's own tags editor); never
  // referenced by copySetsWithGrouping's insert payloads, which is what
  // keeps "tags are never copied" true structurally, not just by omission
  // at the call site (weekPlanService.test.ts's own "never includes tags in
  // the payload" test pins this).
  tags?: string[] | null
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
  // Chunk 17 (SPEC "Tempo") — same fallback convention, read from the joined
  // row for the same reason restSeconds is (this is the week's own exercise
  // list).
  tempo?: string | null
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
  // Absent until migration 027 has been applied (chunk 22's own field) —
  // same fallback convention as every other "may not exist yet" column in
  // this file. jsonb; validated defensively on read (toPlan below), same
  // posture settingsService.ts/programService.ts already take for their
  // own deload_rules columns.
  deload_restore?: unknown
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
    // Chunk 19 — SPEC "Targets"/"Tags": week-plan-only weight target (kg)
    // and tags. Same "may not exist yet" fallback as the fields above.
    targetWeight: row.target_weight ?? null,
    tags: row.tags ?? null,
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
    // Chunk 17 (SPEC "Tempo") — same fallback convention.
    tempo: pe.tempo ?? null,
    // Chunk 20 (applyAhead.ts's slotIdOf) — this row's OWN carry_* columns,
    // read straight off `row` (not `pe`: carry_* lives on
    // v2_week_plan_exercises itself, never on the joined v2_program_exercises
    // row) so a later-week match can tell whether two weeks' own rows trace
    // back to the same slot without a second query. Never set by
    // runProgramExercises.ts's own toProgramExercise (the program-tab/planner
    // read) — there is no week row there to carry it from.
    carryProgramExerciseId: row.carry_program_exercise_id,
    carryPosition: row.carry_position,
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
    // Chunk 22 — same "may not exist yet" fallback as every other column
    // this file already guards; a non-array value (absent column, or a
    // genuinely null snapshot) reads as "no snapshot", same as null.
    deloadRestore: Array.isArray(row.deload_restore) ? (row.deload_restore as DeloadRestoreEntry[]) : null,
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

// Chunk 21 (SPEC "Deload" — "'Mark this week as deload' marks every session
// in that week"; TASKS.md "Mark this week as deload... sets is_deload = true
// on every planned row of that week — the rows sharing (mesocycle_id,
// week_number)"). The whole-week counterpart to setDeload above: that one
// targets a single row by id (one session); this one has no row id at all —
// its own identity IS the (mesocycle_id, week_number) pair, matching every
// row that shares it, however many scheduled workouts that is. Used for both
// directions (mark true, unmark false — useWeekPlan.ts's useSetWeekDeload is
// the one caller, PlanPage.tsx's own week-level action). Never filters by
// workout_day_id — doing so would narrow this back to "mark only the
// selected workout," exactly the bug this function exists to not have.
export async function setWeekDeload(mesoId: string, weekNumber: number, isDeload: boolean): Promise<void> {
  const { error } = await supabase
    .from('v2_week_plans')
    .update({ is_deload: isDeload })
    .eq('mesocycle_id', mesoId)
    .eq('week_number', weekNumber)
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
    // Chunk 19 — SPEC "Targets": weight target (kg; week plan only, never
    // in the program) and the week's own rep-target override (writes only
    // THIS row's rep_min/rep_max/is_amrap, never the program set — this
    // function has no notion of a program set at all, so that's true by
    // construction, not by a guard). tags: SPEC "Tags" — several per set,
    // head rows in practice (PlanPage.tsx never offers this change on a
    // stage row), several allowed, no DB-level stage/head restriction the
    // way stage_kind has one.
    targetWeight?: number | null
    repMin?: number | null
    repMax?: number | null
    isAmrap?: boolean
    tags?: string[] | null
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
  // Chunk 19 — named individually (not as one "targets" blob) so a caller
  // that only changes one of these (e.g. the RIR stepper, unchanged above)
  // never sends the others — same "named only when present" convention
  // every key in this patch already follows.
  if ('targetWeight' in changes) patch.target_weight = changes.targetWeight
  if ('repMin' in changes) patch.rep_min = changes.repMin
  if ('repMax' in changes) patch.rep_max = changes.repMax
  if ('isAmrap' in changes) patch.is_amrap = changes.isAmrap
  if ('tags' in changes) patch.tags = changes.tags

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

// Chunk 20 — "Apply this change to planned weeks ahead", review fix: a swap
// applied ahead must repoint each matched LATER week at the SAME resulting
// row swapWeekExercise already created for the edited week — never a
// second createWeekOnlyProgramExercise insert (a fresh row per week would
// give each week its own distinct id, so a follow-up edit on the edited
// week's own id could never again find them — the executor's
// applyAhead.ts has the full reasoning). This is exactly swapWeekExercise's
// own second half (the two updates), minus the insert and the carry
// computation: an applied-ahead swap is always permanent (carry always
// null), the same way reorderWeekExercises/swapWeekExercise themselves are
// always called with onlyThisWeek: false from the executor.
export async function repointWeekExercise(
  weekPlanId: string,
  fromProgramExerciseId: string,
  toProgramExerciseId: string,
): Promise<void> {
  const { error: exError } = await supabase
    .from('v2_week_plan_exercises')
    .update({ program_exercise_id: toProgramExerciseId, carry_program_exercise_id: null })
    .eq('week_plan_id', weekPlanId)
    .eq('program_exercise_id', fromProgramExerciseId)
  if (exError) throw exError

  const { error: setsError } = await supabase
    .from('v2_week_plan_sets')
    .update({ program_exercise_id: toProgramExerciseId })
    .eq('week_plan_id', weekPlanId)
    .eq('program_exercise_id', fromProgramExerciseId)
  if (setsError) throw setsError
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

// ─── Deload rules (chunk 22) ────────────────────────────────────────────────
// SPEC.md "Deload": "with rules on, a deload session is pre-calculated from
// the last normal week". The pure decisions (which occurrence is the base,
// what the calculated sets are, the restore snapshot's own shape) all live
// in deloadRules.ts; this section is the I/O that gathers what those
// functions need and applies their output, same split as every other
// feature in this file (weekSources.ts/weekEdits.ts's own pure cores,
// copyOneWorkoutFromHistory's gather-then-copy shape above).
//
// Outcome of a mark/unmark attempt, reported back to the UI so it can show
// reviewer's note 5's one-line notice ("Already started — sets left as
// they are") when that guard fires.
export type DeloadMarkOutcome = 'flagOnly' | 'calculated' | 'alreadyStarted'
export type DeloadUnmarkOutcome = 'flagOnly' | 'restored' | 'alreadyStarted'

// ─── Gather (thin, unbranched Supabase reads — same posture this file's
// own fetchEmptyWorkoutPlanIds/fetchPlannedWeekHistory above already take:
// no logic of their own to break, so left untested directly here; the
// DECISIONS built from what they return are each pure-tested in
// deloadRules.ts) ───────────────────────────────────────────────────────────

interface DeloadWeekPlanCore {
  mesocycleId: string
  workoutDayId: string
  weekNumber: number
  deloadRestore: DeloadRestoreEntry[] | null
  sets: DbWeekPlanSet[]
}

async function fetchDeloadWeekPlanCore(weekPlanId: string): Promise<DeloadWeekPlanCore> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('mesocycle_id, workout_day_id, week_number, deload_restore, v2_week_plan_sets(*)')
    .eq('id', weekPlanId)
    .single()
  if (error) throw error
  const row = data as {
    mesocycle_id: string
    workout_day_id: string
    week_number: number
    deload_restore: unknown
    v2_week_plan_sets: DbWeekPlanSet[]
  }
  return {
    mesocycleId: row.mesocycle_id,
    workoutDayId: row.workout_day_id,
    weekNumber: row.week_number,
    deloadRestore: Array.isArray(row.deload_restore) ? (row.deload_restore as DeloadRestoreEntry[]) : null,
    sets: row.v2_week_plan_sets ?? [],
  }
}

// Every earlier planned occurrence of this one workout in this run —
// resolveDeloadBaseOccurrence's own candidate list, plus each candidate's
// full set list (needed once a base is chosen, to build the calculator's
// input) so this is one query, not a second round trip once the pure
// function picks a winner.
async function fetchDeloadOccurrenceHistory(
  mesocycleId: string,
  workoutDayId: string,
  beforeWeekNumber: number,
): Promise<{ weekNumber: number; isDeload: boolean; sets: DbWeekPlanSet[] }[]> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('week_number, is_deload, v2_week_plan_sets(*)')
    .eq('mesocycle_id', mesocycleId)
    .eq('workout_day_id', workoutDayId)
    .lt('week_number', beforeWeekNumber)
  if (error) throw error
  const rows = (data ?? []) as { week_number: number; is_deload: boolean; v2_week_plan_sets: DbWeekPlanSet[] }[]
  return rows.map((r) => ({ weekNumber: r.week_number, isDeload: r.is_deload, sets: r.v2_week_plan_sets ?? [] }))
}

// Every set log pointing at any of `plannedSetIds` (via week_plan_set_id) —
// one combined query serving BOTH "did this occurrence happen"
// (occurrenceHasWorkingLog) and "what was actually logged against this
// exact planned set" (resolveLoggedWeightKg), across every candidate
// occurrence at once.
async function fetchDeloadSetLogs(plannedSetIds: string[]): Promise<DeloadSetLogRecord[]> {
  if (plannedSetIds.length === 0) return []
  const { data, error } = await supabase
    .from('v2_set_logs')
    .select('week_plan_set_id, weight, is_skipped, is_warmup, parent_set_id')
    .in('week_plan_set_id', plannedSetIds)
  if (error) throw error
  const rows = (data ?? []) as {
    week_plan_set_id: string | null
    weight: number | null
    is_skipped: boolean
    is_warmup: boolean
    parent_set_id: string | null
  }[]
  return rows.map((r) => ({
    weekPlanSetId: r.week_plan_set_id,
    weight: r.weight,
    isSkipped: r.is_skipped,
    isWarmup: r.is_warmup,
    parentSetId: r.parent_set_id,
  }))
}

// Reviewer's note 5 guard: "a session that has already started (any set
// log against that week plan)". Set logs link to a SESSION, not directly
// to a week plan, so this is the two-hop check: any session for this week
// plan, with any set log at all (skipped, warmup or stage all count —
// unlike occurrenceHasWorkingLog's stricter "happened" test above, this is
// "was this touched at all").
async function hasAnySetLogForWeekPlan(weekPlanId: string): Promise<boolean> {
  const { data: sessions, error } = await supabase
    .from('v2_sessions')
    .select('id')
    .eq('week_plan_id', weekPlanId)
  if (error) throw error
  const sessionIds = (sessions ?? []).map((s) => (s as { id: string }).id)
  if (sessionIds.length === 0) return false
  const { count, error: logErr } = await supabase
    .from('v2_set_logs')
    .select('id', { count: 'exact', head: true })
    .in('session_id', sessionIds)
  if (logErr) throw logErr
  return (count ?? 0) > 0
}

function toSourceSet(s: DbWeekPlanSet, loggedWeight: number | null): DeloadSourceSet {
  return {
    id: s.id,
    programExerciseId: s.program_exercise_id,
    setNumber: s.set_number,
    parentId: s.parent_week_plan_set_id ?? null,
    stageIndex: s.stage_index ?? 0,
    isWarmup: s.is_warmup ?? false,
    stageKind: s.stage_kind ?? null,
    programSetId: s.program_set_id ?? null,
    repMin: s.rep_min ?? null,
    repMax: s.rep_max ?? null,
    isAmrap: s.is_amrap ?? false,
    targetRir: s.target_rir,
    tags: s.tags ?? null,
    isDropset: s.is_dropset,
    plannedWeight: s.target_weight ?? null,
    loggedWeight,
  }
}

// ─── Write order (injectable — same seam as copySetsWithGrouping's own
// insertPlanSet above, so a test can assert exact call ORDER with a fake,
// never a real Supabase round trip) ─────────────────────────────────────────

export interface DeloadMarkWriteOps {
  // Bundles the snapshot write with the is_deload flip — ONE statement,
  // committing before anything is deleted (reviewer's note 3: "because
  // step 1 commits before anything is deleted, a failure leaves the
  // snapshot recoverable").
  writeSnapshotAndMark: (weekPlanId: string, snapshot: DeloadRestoreEntry[]) => Promise<void>
  deleteAllSets: (weekPlanId: string) => Promise<void>
  insertCalculatedSets: (userId: string, weekPlanId: string, calculated: DeloadCalculatedSet[]) => Promise<void>
}

async function defaultWriteSnapshotAndMark(weekPlanId: string, snapshot: DeloadRestoreEntry[]): Promise<void> {
  const { error } = await supabase
    .from('v2_week_plans')
    .update({ deload_restore: snapshot, is_deload: true })
    .eq('id', weekPlanId)
  if (error) throw error
}

async function defaultDeleteAllSets(weekPlanId: string): Promise<void> {
  const { error } = await supabase.from('v2_week_plan_sets').delete().eq('week_plan_id', weekPlanId)
  if (error) throw error
}

async function defaultInsertOneSet(payload: Record<string, unknown>): Promise<{ id: string }> {
  const { data, error } = await supabase.from('v2_week_plan_sets').insert(payload).select('id').single()
  if (error) throw error
  return data as { id: string }
}

// Heads first (so each stage's new parent id is resolvable), same
// insert-order/idMap pattern as copySetsWithGrouping above. `insertOneSet`
// is this function's own injection seam (defaults to a real Supabase
// insert) — same reason copySetsWithGrouping's own insertPlanSet is
// injectable: the id-remap (a dropped head must take its stages with it;
// a KEPT head's stages must land on ITS new id, never a sibling's) is the
// part genuinely at risk of a bug, and a test can exercise it directly
// with a fake that just records payloads and mints synthetic ids.
export async function insertCalculatedPlanSets(
  userId: string,
  weekPlanId: string,
  calculated: DeloadCalculatedSet[],
  insertOneSet: (payload: Record<string, unknown>) => Promise<{ id: string }> = defaultInsertOneSet,
): Promise<void> {
  const heads = calculated.filter((s) => s.parentSourceId == null)
  const stages = calculated.filter((s) => s.parentSourceId != null)
  const idMap = new Map<string, string>()

  for (const s of heads) {
    const row = await insertOneSet({
      week_plan_id: weekPlanId,
      user_id: userId,
      program_exercise_id: s.programExerciseId,
      set_number: s.setNumber,
      target_rir: s.targetRir,
      is_dropset: s.isDropset,
      stage_index: s.stageIndex,
      is_warmup: s.isWarmup,
      program_set_id: s.programSetId,
      stage_kind: s.stageKind,
      target_weight: s.targetWeight,
      rep_min: s.repMin,
      rep_max: s.repMax,
      is_amrap: s.isAmrap,
      tags: s.tags,
    })
    idMap.set(s.sourceId, row.id)
  }

  for (const s of stages) {
    const newParentId = s.parentSourceId ? idMap.get(s.parentSourceId) : undefined
    await insertOneSet({
      week_plan_id: weekPlanId,
      user_id: userId,
      program_exercise_id: s.programExerciseId,
      set_number: s.setNumber,
      target_rir: s.targetRir,
      is_dropset: s.isDropset,
      parent_week_plan_set_id: newParentId ?? null,
      stage_index: s.stageIndex,
      is_warmup: s.isWarmup,
      program_set_id: s.programSetId,
      stage_kind: s.stageKind,
      target_weight: s.targetWeight,
      rep_min: s.repMin,
      rep_max: s.repMax,
      is_amrap: s.isAmrap,
      tags: s.tags,
    })
  }
}

const defaultMarkWriteOps: DeloadMarkWriteOps = {
  writeSnapshotAndMark: defaultWriteSnapshotAndMark,
  deleteAllSets: defaultDeleteAllSets,
  insertCalculatedSets: (userId, weekPlanId, calculated) => insertCalculatedPlanSets(userId, weekPlanId, calculated),
}

// Reviewer's note 3's ordering, as one exported, independently testable
// step: (1) snapshot + flag commits; (2) delete; (3) insert the calculated
// sets. A test supplies a fake `ops` whose three functions each record
// their own name into one shared array, then asserts that array's order —
// proving the snapshot is safely committed before anything destructive
// happens, without a real Supabase round trip.
export async function applyCalculatedDeloadMark(
  userId: string,
  weekPlanId: string,
  currentSets: DbWeekPlanSet[],
  calculated: DeloadCalculatedSet[],
  ops: DeloadMarkWriteOps = defaultMarkWriteOps,
): Promise<void> {
  const snapshot = buildDeloadRestoreSnapshot(
    currentSets.map((s) => ({
      programExerciseId: s.program_exercise_id,
      setNumber: s.set_number,
      stageIndex: s.stage_index ?? 0,
      isWarmup: s.is_warmup ?? false,
      isDropset: s.is_dropset,
      stageKind: s.stage_kind ?? null,
      programSetId: s.program_set_id ?? null,
      repMin: s.rep_min ?? null,
      repMax: s.rep_max ?? null,
      isAmrap: s.is_amrap ?? false,
      targetWeight: s.target_weight ?? null,
      targetRir: s.target_rir,
      tags: s.tags ?? null,
    })),
  )
  await ops.writeSnapshotAndMark(weekPlanId, snapshot) // (1) commits first
  await ops.deleteAllSets(weekPlanId) // (2)
  await ops.insertCalculatedSets(userId, weekPlanId, calculated) // (3)
}

export interface DeloadRestoreWriteOps {
  deleteAllSets: (weekPlanId: string) => Promise<void>
  insertRestoredSets: (userId: string, weekPlanId: string, entries: DeloadRestoreEntry[]) => Promise<void>
  // Bundles nulling deload_restore with the is_deload flip — the final
  // step, only once the restored sets are safely written (reviewer's note
  // 4: "restore... then null deload_restore, in that order").
  clearSnapshotAndUnmark: (weekPlanId: string) => Promise<void>
}

// Regroups the id-free snapshot (groupDeloadRestoreEntries — by
// (programExerciseId, setNumber, stageIndex), see deloadRules.ts's own
// header on why) and inserts heads first so each stage's new parent id is
// resolvable, same shape insertCalculatedPlanSets above takes. Same
// injectable `insertOneSet` seam, for the same reason.
export async function insertRestoredPlanSets(
  userId: string,
  weekPlanId: string,
  entries: DeloadRestoreEntry[],
  insertOneSet: (payload: Record<string, unknown>) => Promise<{ id: string }> = defaultInsertOneSet,
): Promise<void> {
  const groups = groupDeloadRestoreEntries(entries)
  for (const { head, stages } of groups) {
    const headRow = await insertOneSet({
      week_plan_id: weekPlanId,
      user_id: userId,
      program_exercise_id: head.programExerciseId,
      set_number: head.setNumber,
      target_rir: head.targetRir,
      is_dropset: head.isDropset,
      stage_index: head.stageIndex,
      is_warmup: head.isWarmup,
      program_set_id: head.programSetId,
      stage_kind: head.stageKind,
      target_weight: head.targetWeight,
      rep_min: head.repMin,
      rep_max: head.repMax,
      is_amrap: head.isAmrap,
      tags: head.tags,
    })

    for (const stage of stages) {
      await insertOneSet({
        week_plan_id: weekPlanId,
        user_id: userId,
        program_exercise_id: stage.programExerciseId,
        set_number: stage.setNumber,
        target_rir: stage.targetRir,
        is_dropset: stage.isDropset,
        parent_week_plan_set_id: headRow.id,
        stage_index: stage.stageIndex,
        is_warmup: stage.isWarmup,
        program_set_id: stage.programSetId,
        stage_kind: stage.stageKind,
        target_weight: stage.targetWeight,
        rep_min: stage.repMin,
        rep_max: stage.repMax,
        is_amrap: stage.isAmrap,
        tags: stage.tags,
      })
    }
  }
}

async function defaultClearSnapshotAndUnmark(weekPlanId: string): Promise<void> {
  const { error } = await supabase
    .from('v2_week_plans')
    .update({ deload_restore: null, is_deload: false })
    .eq('id', weekPlanId)
  if (error) throw error
}

const defaultRestoreWriteOps: DeloadRestoreWriteOps = {
  deleteAllSets: defaultDeleteAllSets,
  insertRestoredSets: (userId, weekPlanId, entries) => insertRestoredPlanSets(userId, weekPlanId, entries),
  clearSnapshotAndUnmark: defaultClearSnapshotAndUnmark,
}

// Reviewer's note 4's ordering: (1) delete the calculated sets currently
// there; (2) insert the exact pre-mark sets from the snapshot; (3) only
// THEN null deload_restore (and clear is_deload) — if step 2 fails, the
// snapshot is still there for a retry. Steps 1–2 together are "restore the
// exact pre-mark sets"; nothing about restoring reads the CURRENT
// (possibly hand-edited) sets at all, which is also why editing a
// calculated set by hand before unmarking can never change what restore
// produces — restore's only input is the snapshot.
export async function applyDeloadRestore(
  userId: string,
  weekPlanId: string,
  snapshot: DeloadRestoreEntry[],
  ops: DeloadRestoreWriteOps = defaultRestoreWriteOps,
): Promise<void> {
  await ops.deleteAllSets(weekPlanId) // (1)
  await ops.insertRestoredSets(userId, weekPlanId, snapshot) // (2)
  await ops.clearSnapshotAndUnmark(weekPlanId) // (3) — only once (2) succeeds
}

// ─── Orchestrators — the one function per direction useWeekPlan.ts's hooks
// call, gluing the gather/decide/write pieces above together. Left thin and
// untested directly (same posture copyOneWorkoutFromHistory above already
// takes for its own gather-then-copy glue): every DECISION it makes is
// pure-tested in deloadRules.ts, every destructive WRITE ORDER it relies on
// is tested above via the injectable ops, and the whole thing is proven
// end-to-end against real Postgres (this chunk's scratch-SQL verification).

// Marks one session deload. `rules` is the EFFECTIVE rules already resolved
// by the caller (program override, else the global default, else none —
// PlanPage.tsx/StepVolume.tsx compute this once, the same "screen resolves
// it, hook/executor just uses it" split this chunk's report explains) —
// this function has no notion of settings or program rows at all.
export async function markSessionDeload(
  userId: string,
  weekPlanId: string,
  rules: DeloadRules | null,
): Promise<DeloadMarkOutcome> {
  if (rules === null) {
    await setDeload(weekPlanId, true)
    return 'flagOnly'
  }

  if (await hasAnySetLogForWeekPlan(weekPlanId)) {
    await setDeload(weekPlanId, true)
    return 'alreadyStarted'
  }

  const current = await fetchDeloadWeekPlanCore(weekPlanId)
  const history = await fetchDeloadOccurrenceHistory(current.mesocycleId, current.workoutDayId, current.weekNumber)

  const historySetIds = history.flatMap((h) => h.sets.map((s) => s.id))
  const historyLogs = await fetchDeloadSetLogs(historySetIds)

  const resolution = resolveDeloadBaseOccurrence(
    history.map((h) => ({
      weekNumber: h.weekNumber,
      isDeload: h.isDeload,
      happened: occurrenceHasWorkingLog(historyLogs, h.sets.map((s) => s.id)),
    })),
    current.weekNumber,
  )

  const baseSets = resolution.kind === 'week' ? history.find((h) => h.weekNumber === resolution.weekNumber)!.sets : current.sets
  // The fallback base (the session's own current, not-yet-started sets)
  // can never have anything logged against it — hasAnySetLogForWeekPlan
  // above already guards that — so baseLogs is only ever non-empty for a
  // genuine earlier occurrence.
  const baseLogs = resolution.kind === 'week' ? historyLogs : []

  const sourceSets = baseSets.map((s) => toSourceSet(s, resolveLoggedWeightKg(baseLogs, s.id)))
  const calculated = calculateDeloadSets(sourceSets, rules)

  await applyCalculatedDeloadMark(userId, weekPlanId, current.sets, calculated)
  return 'calculated'
}

export async function unmarkSessionDeload(userId: string, weekPlanId: string): Promise<DeloadUnmarkOutcome> {
  const current = await fetchDeloadWeekPlanCore(weekPlanId)
  if (current.deloadRestore == null) {
    await setDeload(weekPlanId, false)
    return 'flagOnly'
  }

  if (await hasAnySetLogForWeekPlan(weekPlanId)) {
    await setDeload(weekPlanId, false)
    return 'alreadyStarted'
  }

  await applyDeloadRestore(userId, weekPlanId, current.deloadRestore)
  return 'restored'
}

// Week-level shortcut (chunk 21's own week action, extended): "the
// calculation and snapshot happen once for that row" (reviewer's note 6) —
// this is literally markSessionDeload/unmarkSessionDeload run once per row
// of the week, never a bulk statement once rules are on (each row can
// resolve a different base occurrence). `rules` is the SAME effective
// rules object for every row (one run, one program, one global default).
export async function markWeekDeload(
  userId: string,
  mesoId: string,
  weekNumber: number,
  rules: DeloadRules | null,
): Promise<void> {
  const plans = await fetchWeekPlans(mesoId, weekNumber)
  for (const p of plans) {
    await markSessionDeload(userId, p.id, rules)
  }
}

export async function unmarkWeekDeload(userId: string, mesoId: string, weekNumber: number): Promise<void> {
  const plans = await fetchWeekPlans(mesoId, weekNumber)
  for (const p of plans) {
    await unmarkSessionDeload(userId, p.id)
  }
}
