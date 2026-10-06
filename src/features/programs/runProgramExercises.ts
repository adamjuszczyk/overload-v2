import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import type { ProgramExercise, MuscleSubgroup, MovementPattern } from '../../types'

// Chunk 9 (TASKS.md "Edit a week's exercises" — "One read path") — the only
// code in src/ or api/ that reads `v2_program_exercises` for a run's
// CURRENT exercise list (the "program tab's list" rule below). Enforced by
// `scripts/check-program-exercise-reads.mjs`, which scans src/ and api/ for
// a direct `.from('v2_program_exercises')` chained to `.select(` and for an
// embedded `v2_program_exercises(` fragment inside some other table's
// select, and fails on either outside this file's own allowed-exceptions
// list (see that script's header for every exception and its reason).
//
// Two rules exist (TASKS.md's own words); only the first lives here:
//   - "the program tab's list excludes week_only and removed_at rows" —
//     fetchRunProgramExercises, below. This is a run's (or a saved
//     program's — see "Every caller" below) OWN v2_program_exercises rows,
//     read fresh, filtered to the slots that are genuinely part of the
//     program today.
//   - "a week's list comes through v2_week_plan_exercises (which may point
//     at week-only slots)" — this rule is NOT implemented here. It was
//     already correct before this chunk (chunk 7's own work): a week's
//     exercises are read by joining v2_week_plan_exercises to
//     v2_program_exercises by plain foreign key
//     (weekPlanService.ts's fetchWeekPlans/createWeekPlan/
//     fetchAllWeekPlansForMeso/fetchWeekPlanById/copyOneWorkoutFromHistory,
//     each embedding the program-exercise join by FK name). A week-only
//     slot is a perfectly ordinary v2_program_exercises row (real id, real
//     exercise_id) — the FK join needs no special-casing to resolve it
//     correctly; week_only/removed_at only matter when deciding whether a
//     slot belongs in a FRESH read of "the program" (this file's own job),
//     never when resolving what a week's OWN v2_week_plan_exercises row
//     already points at. Restructuring that heavily-tested,
//     performance-sensitive fetch path into two round trips just to move
//     its embed string into this file would add real regression risk (it is
//     exactly what feeds GymSession/SessionPreview/PlanPage — see this
//     chunk's render-parity proof) for no behavioural change, so
//     weekPlanService.ts is one of the read-path check's allowed
//     exceptions, not a second implementation of this rule.
//
// Every caller of "the program tab's list" rule goes through
// fetchRunProgramExercises, directly or by construction:
//   - the planner (ProgramBuilderPage/WorkoutDayEditorPage, via
//     programService.ts's fetchProgramExercises/useProgramExercises) —
//     saved programs never set week_only/removed_at (027's own column
//     comments: "run copies only"), so the filter is a no-op for them; a
//     saved program's rows "never carry the run-only flags" (TASKS.md).
//   - the Plan screen's Program tab — WorkoutDayEditorPage is the exact
//     same shared editor the planner uses (ProgramTab.tsx's own header
//     comment), so it goes through the same hook/function.
//   - GymSession.tsx/SessionPreview.tsx's own `fallbackProgramExercises`
//     (useProgramExercises again) — used only when no week plan exists yet
//     for this session; once one does, weekPlan.exercises (the week's list
//     rule above) takes over, unaffected by this file.
//   - offlineCache.ts/useAutoFinishSession.ts take `programExercises`/
//     `weekPlan` as plain parameters from the callers above — correct by
//     construction once GymSession's own two sources are, no code of their
//     own to change.
//
// Not a read at all, so not this check's concern, but kept in this file
// because they share the same run-only-flags knowledge:
//   - createWeekOnlyProgramExercise / fetchSwapSourceSlot — the writes a
//     week-level swap/add needs (weekPlanService.ts calls these).
//   - removeRunProgramExercise — the one place that knows a run copy's
//     removal must be soft (`removed_at`, "run copies only" — 027's column
//     comment: "planned weeks keep their rows; hard delete would cascade
//     into planned sets of every week of the run") while a saved program's
//     removal stays a hard delete, exactly as programService.ts's
//     deleteProgramExercise already did before this chunk. Unreachable from
//     any UI today (the program tab is read-only for volume on a
//     week-dependent run, and every run is week-dependent until chunk 11),
//     but the function is correct now and unit-tested, so chunk 11's stable
//     program tab needs no new removal logic of its own.

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
  exercises: DbExerciseJoin | null
}

function toProgramExercise(row: DbProgramExerciseJoin): ProgramExercise {
  const ex = row.exercises
  return {
    id: row.id,
    workoutDayId: row.workout_day_id,
    userId: row.user_id,
    exerciseId: row.exercise_id,
    position: row.position,
    weightUnit: (row.weight_unit ?? null) as ProgramExercise['weightUnit'],
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

// ─── The program tab's list ─────────────────────────────────────────────────
// A run's (or a saved program's) own current exercise list for one workout
// day, in program order, excluding any week-only slot (a swap/add's
// week-specific replacement, hidden from the program tab — TASKS.md) and
// any removed exercise (removed_at is not null — a soft removal from a run
// copy; "planned weeks keep their rows" regardless, 027's column comment).
// Both columns default to the "ordinary row" state (false / null), so this
// filter is unconditionally safe to apply to a saved program's rows too —
// nothing before chunk 11 can ever set either one there.
export async function fetchRunProgramExercises(workoutDayId: string): Promise<ProgramExercise[]> {
  const { data, error } = await supabase
    .from('v2_program_exercises')
    .select('*, exercises(*)')
    .eq('workout_day_id', workoutDayId)
    .eq('week_only', false)
    .is('removed_at', null)
    .order('position', { ascending: true })
  if (error) throw error
  return (data as DbProgramExerciseJoin[]).map(toProgramExercise)
}

// ─── Week-only slot creation (swap / add) ──────────────────────────────────

export interface NewWeekOnlySlot {
  workoutDayId: string
  exerciseId: string
  position: number
  // A swap's replacement keeps the replaced slot's superset block (SPEC
  // "Supersets"); an added exercise has none (SPEC "Supersets": "an
  // exercise added in a week is not in a superset") — weekEdits.ts's
  // resolveSwapSlot/resolveAddSlot decide which, this just writes it.
  supersetBlockId: string | null
}

// Always week_only = true (027: "a slot created by a week edit"), always a
// fresh weight_unit (null — inherit; a different exercise identity doesn't
// inherit the replaced slot's own unit preference). Returned mapped (not the
// raw row) so the caller can use it exactly like any other ProgramExercise —
// e.g. to read its own `.id` when pointing a week_plan_exercises row at it.
export async function createWeekOnlyProgramExercise(
  userId: string,
  slot: NewWeekOnlySlot,
): Promise<ProgramExercise> {
  const { data, error } = await supabase
    .from('v2_program_exercises')
    .insert({
      user_id: userId,
      workout_day_id: slot.workoutDayId,
      exercise_id: slot.exerciseId,
      position: slot.position,
      weight_unit: null,
      superset_block_id: slot.supersetBlockId,
      week_only: true,
    })
    .select('*, exercises(*)')
    .single()
  if (error) throw error
  return toProgramExercise(data as DbProgramExerciseJoin)
}

export interface SwapSourceSlot {
  workoutDayId: string
  position: number
  supersetBlockId: string | null
}

// Just enough of the slot being REPLACED to build its replacement's own row
// (weekEdits.ts's resolveSwapSlot) — never the replaced exercise's own
// identity or target fields, which the replacement does not inherit.
export async function fetchSwapSourceSlot(programExerciseId: string): Promise<SwapSourceSlot> {
  const { data, error } = await supabase
    .from('v2_program_exercises')
    .select('workout_day_id, position, superset_block_id')
    .eq('id', programExerciseId)
    .single()
  if (error) throw error
  const row = data as { workout_day_id: string; position: number; superset_block_id: string | null }
  return { workoutDayId: row.workout_day_id, position: row.position, supersetBlockId: row.superset_block_id }
}

// ─── Run-copy removal — soft on a run, hard on a saved program ─────────────
// programService.ts's deleteProgramExercise (the planner's own delete, and
// — once chunk 11 builds a stable program tab — that tab's own delete too)
// delegates here. A saved program's row is hard-deleted, exactly as before
// this chunk (cascades to v2_week_plan_exercises/v2_week_plan_sets of any
// week that already planned it — unchanged, existing behaviour). A run
// copy's row is instead soft-removed (removed_at = now()): "planned weeks
// keep their rows (hard delete would cascade into planned sets of every
// week of the run)" — 027's own column comment.
export async function removeRunProgramExercise(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('v2_program_exercises')
    .select('workout_day:v2_workout_days(program:v2_programs(kind))')
    .eq('id', id)
    .single()
  if (error) throw error
  const row = data as unknown as { workout_day: { program: { kind: string } | null } | null }
  const kind = row.workout_day?.program?.kind

  if (kind === 'run') {
    const { error: softError } = await supabase
      .from('v2_program_exercises')
      .update({ removed_at: new Date().toISOString() })
      .eq('id', id)
    if (softError) throw softError
    return
  }

  const { error: hardError } = await supabase.from('v2_program_exercises').delete().eq('id', id)
  if (hardError) throw hardError
}
