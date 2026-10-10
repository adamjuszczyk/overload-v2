import type { AnalysisInput } from '../features/coach/analysisInput'
import type { WeekAnalysisInput } from '../features/coach/weekAnalysisInput'
import type { QaContext } from '../features/coach/qaContext'
import type { MesoAnalysisPromptPayload } from '../features/coach/coachMesoPrompt'
import type { DeloadRules, DeloadRestoreEntry } from '../lib/deloadRules'

// ─── Enums ────────────────────────────────────────────────────────────────────

export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps'
  | 'forearms' | 'quads' | 'hamstrings' | 'glutes' | 'calves'
  | 'core' | 'other'

// Also reused as-is (not a second copy) for WeekAnalysisSessionRoster.
// dayOfWeek / WeekAnalysisOccurrence.dayOfWeek below (2026-08-31 fix,
// CONTEXT.md — Weekly Analysis v2 fabrication finding #1: a real generated
// weekly analysis misattributed a Saturday session as "Friday" when the
// payload gave only an ISO date string and left weekday derivation to the
// model). Same "feed pre-computed data, don't make the model derive it"
// principle this app already applies to weekNumber/isDeload/phase, and the
// exact same `format(date, 'EEEE').toLowerCase() as DayOfWeek` scheduler.ts
// already uses for program.schedule lookups.
export type DayOfWeek =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday'
  | 'friday' | 'saturday' | 'sunday'

export type SessionStatus = 'planned' | 'in_progress' | 'completed' | 'skipped'
export type MesocycleStatus = 'active' | 'completed'
export type WeightUnit = 'kg' | 'lbs'

// v2_programs.kind (migration 027/028, chunk 6) — 'saved' is the reusable
// template; 'run' is a run's own copy, created by v2_start_run and never
// shown in a program list (programService.ts's fetchSavedPrograms filters
// to 'saved' at the query; fetchPrograms stays unfiltered — PlanPage and
// the planner (PlannerPage.tsx, chunk 11) both look a program up by a
// meso's/route's own id, which is a 'run' program for an active run's copy).
export type ProgramKind = 'saved' | 'run'

// v2_programs.planning_type (migration 027, chunk 8 — SPEC.md "Weeks and
// copying") — decides a new week's volume source (weekSources.ts):
// 'stable' always re-derives it from the run's own copy; 'week_dependent'
// (the column default) copies the last planned non-deload week beyond
// week 1. No saved-program UI sets this yet — every program is
// 'week_dependent' until chunk 11's planner can create a stable one.
export type PlanningType = 'stable' | 'week_dependent'

// v2_programs.schedule_type (migration 027; the planner's own schedule-type
// picker arrives in chunk 25 — SPEC.md "Scheduling → Sequence"). 'weekday'
// (the column default): program.schedule, one workout per weekday, as
// today. 'sequence': an ordered cycle of workout and rest slots
// (v2_program_sequence_items), not tied to a weekday — "the cycle replaces
// the week everywhere the week is used" (week plan, copying, week-dependent
// volume, deload shortcut, labels — WeekPlan.weekNumber is the cycle index
// for one of these). Same type referenceByExercise.ts already defines
// locally (chunk 23, built ahead of this chunk) — not re-exported from
// there; the two are structurally identical string-literal unions, so a
// Program.scheduleType value is assignable to that module's own parameter
// with no cast.
export type ScheduleType = 'weekday' | 'sequence'

// ─── Exercise ─────────────────────────────────────────────────────────────────

// The two stored values (exercises.status, migration 019, not null default
// 'active') — every real row is one or the other, never both, never neither
// (EXERCISE-LIBRARY-TASKS.md §2.3/§7.1).
export type ExerciseStatus = 'active' | 'lost'

// All three real-world states, including 'gone' — a hard-deleted row has no
// row left to carry a status, so 'gone' is a value the *type* layer can name
// (a delete-preview result, e.g.) that the *column* never holds
// (EXERCISE-LIBRARY-TASKS.md §0.3/§7.1).
export type ExerciseLifecycle = ExerciseStatus | 'gone'

export interface Exercise {
  id: string
  userId: string
  name: string
  muscleGroup: MuscleGroup
  isArchived: boolean
  createdAt: string
  // exercises.muscle_subgroup / .movement_pattern (migration 013), surfaced
  // here so the editing UI (EXERCISE-LIBRARY-TASKS.md §8 step 5) can read an
  // exercise's current tags the same way it reads muscleGroup — same null =
  // untagged convention ExerciseTags below already uses.
  muscleSubgroups: MuscleSubgroup[] | null
  movementPattern: MovementPattern | null
  // exercises.status / .source_library_id / .lost_at (migration 019,
  // EXERCISE-LIBRARY-TASKS.md §7.2/§8 step 7) — the Lost Exercises lifecycle
  // and library provenance. sourceLibraryId is null for a hand-created
  // exercise; lostAt is null exactly when status is 'active'.
  status: ExerciseStatus
  sourceLibraryId: string | null
  lostAt: string | null
}

// ─── Exercise Library ─────────────────────────────────────────────────────────
// v2_exercise_libraries / v2_exercise_library_items (migration 019,
// EXERCISE-LIBRARY-TASKS.md §2.1/§2.2). Global, curated catalogs — no
// userId, read-only to the app. A library previews its items and can be
// downloaded; downloading copies each item into the user's own `exercises`
// (§8 step 6).

export interface ExerciseLibrary {
  id: string
  slug: string
  name: string
  description: string | null
  isListed: boolean
  position: number
}

export interface ExerciseLibraryItem {
  id: string
  libraryId: string
  name: string
  muscleGroup: MuscleGroup
  muscleSubgroup: MuscleSubgroup[] | null
  movementPattern: MovementPattern | null
  position: number
}

// ─── Reassignment ─────────────────────────────────────────────────────────────
// reassign_exercise_history() (migration 021, EXERCISE-LIBRARY-TASKS.md §5/§7.2)
// merges a lost exercise's entire history onto an active target. Preview is a
// client-side read for the confirmation copy (§6.1) — it is re-derived by the
// RPC at merge time, so a number shown here can never be the number actually
// acted on; only the RPC's own returned counts are authoritative.

export interface ReassignPreview {
  setCount: number
  sessionCount: number
  firstDate: string | null
  lastDate: string | null
  // Workout days where source and target already share a program-exercise
  // row — the §5.3 step 2b merge case ("the day will list one exercise
  // where it lists two now"), not every day the source merely appears in.
  affectedWorkoutDays: string[]
  // Sessions logging both exercises already — the swap-exercise collision
  // (§5.3 step 3), the single most likely reassignment this app will see.
  overlappingSessionCount: number
  // Coach analyses whose frozen content/input_snapshot names the source
  // exercise — they keep describing it under its old identity forever (§5.3
  // step 4). Best-effort count, not a live join.
  frozenAnalysisCount: number
}

// The RPC's returned row (§5.1) — what actually happened, as opposed to
// ReassignPreview's beforehand estimate.
export interface ReassignResult {
  setLogsMoved: number
  programExercisesMoved: number
  programExercisesMerged: number
  planSetsMoved: number
  sourceDeleted: boolean
}

// ─── Program ──────────────────────────────────────────────────────────────────

export type WeeklySchedule = Record<DayOfWeek, string | null>

// Layer 1: program stores exercises only — identity, ordering, unit
// preference. Chunk 12 (SPEC.md "Removals" — "Suggested reps per program
// exercise are replaced by per-set rep targets"): the old suggested-reps
// column (and this field) is gone — the UI that read/wrote it was already
// removed in chunk 11 (PlanPage's "· N REPS", ExerciseHeader's reps line,
// WorkoutDayEditorPage's stepper). Rep targets now live per set: ProgramSet
// (below) in the program, WeekPlanSet (Layer 2) for the week's own override.
export interface ProgramExercise {
  id: string
  workoutDayId: string
  userId: string
  exerciseId: string
  exercise?: Exercise        // joined when loading the full day
  position: number           // 0-based
  weightUnit: WeightUnit | null  // null = inherit v2_user_settings.weightUnit (v3 §2.4)
  // v2_program_exercises.superset_block_id (migration 027; read/written
  // starting chunk 13 — SPEC.md "Supersets" / TASKS.md data model: "exercises
  // pointing at the same block form one superset"). Design field: regrouped
  // in the program tab for both planning types, from the next session on
  // (SupersetBlock.tsx reads it on the run copy when a session loads). A
  // week-only slot created by a swap keeps the replaced slot's block
  // (weekEdits.ts's resolveSwapSlot); one created by an add never has one
  // (resolveAddSlot). Optional, same "may not exist yet" convention as
  // Program.kind?/WorkoutDay.sourceWorkoutDayId? above — absent/undefined
  // reads exactly like null (not in a superset) everywhere this is read.
  supersetBlockId?: string | null
  // v2_program_exercises.rest_seconds / rest_after_seconds (migration 027;
  // read/written starting chunk 16 — SPEC.md "Rest": levels 2–3 of the
  // chain). Design fields: edited in the planner and the program tab (run
  // copy only, applying from the next session on). Optional, same "may not
  // exist yet" convention as supersetBlockId above — absent/undefined reads
  // as null (no exercise-level rest/rest-after) everywhere this is read,
  // which is every existing fixture/test predating this chunk.
  restSeconds?: number | null
  restAfterSeconds?: number | null
  // v2_program_exercises.tempo (migration 027; read/written starting chunk
  // 17 — SPEC.md "Tempo": "Per exercise, in the program. Shown next to the
  // exercise during the workout. Not tracked."). Design field: editable in
  // the planner and the program tab (run copy only), applying from the next
  // session on, same posture as restSeconds/restAfterSeconds above. Already
  // normalised text (plannerVocabulary.ts's normaliseTempo, chunk 2 — e.g.
  // "3-1-1-0", "X" allowed) or null ("no tempo"). Optional, same "may not
  // exist yet" convention as restSeconds above — absent/undefined reads as
  // null (no tempo) everywhere this is read, which is every existing
  // fixture/test predating this chunk, including GymSession.d30.test.tsx's
  // own frozen fixture.
  tempo?: string | null
}

// ─── Program superset block (v2_program_superset_blocks, chunk 13's table;
// its own rest fields read/written starting chunk 16 — SPEC.md "Rest" /
// "Supersets": "Both overridable per superset") ────────────────────────────
// Exercises sharing one ProgramExercise.supersetBlockId form one superset;
// null rest fields = SPEC's own defaults (no timer within a round; the
// chain of the exercise that ends a round).
export interface ProgramSupersetBlock {
  id: string
  restWithinRoundSeconds: number | null
  restAfterRoundSeconds: number | null
}

// ─── Warmup routine item (v2_workout_warmup_items, migration 027 — chunk 18:
// SPEC.md "Warmup routine": "Per workout, in the program: a checklist shown
// at the top of the session. Items are ticked off; nothing else is
// logged.") ──────────────────────────────────────────────────────────────
// Design field: editable in the planner and the program tab (run copy),
// never gated by volumeReadOnly, same posture ProgramSupersetBlock/
// ProgramExercise.restSeconds/tempo above already take. Read-only on the
// workout screen (WarmupRoutineChecklist.tsx), which renders these in
// `position` order with a session-local tick — the tick itself is never
// part of this type; it lives only in warmupRoutineStore.ts's own
// localStorage, keyed by session id, never sent to Supabase.
export interface WarmupRoutineItem {
  id: string
  userId: string
  workoutDayId: string
  position: number       // 0-based, dense and unique within one workout day
  body: string           // free text, non-blank (v2_workout_warmup_items' own CHECK)
}

// ─── Sequence item (v2_program_sequence_items, chunk 25 — SPEC.md
// "Scheduling → Sequence") ───────────────────────────────────────────────────
// The ordered cycle of a `scheduleType: 'sequence'` program: one row per
// slot, in `position` order. A null workoutDayId is a rest day — nothing to
// plan there (v2_plan_week skips it, same treatment an unassigned weekday
// already gets). The same workout may occupy more than one slot (SPEC, G8:
// "A, B, A, rest") — position, not workoutDayId, is this row's own identity
// (v2_program_sequence_items' unique index is (program_id, position)).
// v2_copy_program (028) already copies these rows into a run's own copy,
// remapping workoutDayId through the copy's own workout-day map.
export interface SequenceItem {
  id: string
  userId: string
  programId: string
  position: number          // 0-based, dense and unique within one program
  workoutDayId: string | null // null = rest day
}

// ─── Program Set (v2_program_sets, chunk 11 — SPEC.md "Objects stored:
// Program", "sets") ─────────────────────────────────────────────────────────
// The program's own volume: every week's for a `stable` program, week 1's
// for a `week_dependent` one. Mirrors WeekPlanSet's stage shape
// (parentProgramSetId/stageIndex) but carries no weight/RIR (SPEC
// "Targets": weight is week-plan-only; RIR is week-plan-only) — only the rep
// target, which the program DOES own.
export interface ProgramSet {
  id: string
  userId: string
  programExerciseId: string
  position: number       // order within the exercise; a stage shares its head's position
  isWarmup: boolean
  // Heads only — null on every row chunk 11 ever creates (stages are chunk 14).
  stageKind: 'dropset' | 'rest_pause' | 'myo_reps' | 'cluster' | null
  stageRestSeconds: number | null
  parentProgramSetId: string | null
  stageIndex: number      // 0 = head, 1.. = stage order
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  restSeconds: number | null  // rest after this set — design field, chunk 13+
  createdAt: string
}

export interface WorkoutDay {
  id: string
  programId: string
  userId: string
  name: string
  position: number
  exercises: ProgramExercise[]
  // v2_workout_days.source_workout_day_id (migration 027/028) — on a run's
  // copy, the saved program's workout it came from; null on a saved
  // program's own workouts (never a copy of anything). Optional, not
  // required: frozen Coach code (weekResolution.ts) builds placeholder
  // WorkoutDay values that predate this field and must keep compiling
  // unchanged (CONTEXT.md — no Coach change).
  sourceWorkoutDayId?: string | null
}

export interface Program {
  id: string
  userId: string
  name: string
  schedule: WeeklySchedule   // { monday: workoutDayId | null, ... }
  workoutDays: WorkoutDay[]
  createdAt: string
  updatedAt: string
  // Optional for the same reason as WorkoutDay.sourceWorkoutDayId above —
  // frozen Coach code builds placeholder Program values that predate it.
  kind?: ProgramKind
  // Optional for the same reason — absent on a placeholder, and on any
  // real row read before migration 027. Undefined is treated as
  // 'week_dependent' (the column default) wherever this is read.
  planningType?: PlanningType
  // Chunk 25 — same "may not exist yet" optional convention as planningType
  // above; undefined reads as 'weekday' (the column default) everywhere
  // this is checked.
  scheduleType?: ScheduleType
  // v2_programs.deload_rules (migration 027; read/written starting chunk 22
  // — SPEC.md "Deload rules": "global default in settings, override per
  // program"). Null/undefined = "use my default" (the global
  // v2_user_settings.deload_rules below); a (validated) DeloadRules object
  // = this program's own override, same shape either way
  // (deloadRules.ts's validateDeloadRules). A design field — editable in
  // the planner's step 3 and the program tab for both planning types
  // (StepVolume.tsx), carried forward by v2_copy_program (027/028) into
  // every run's own copy. Optional for the same "may not exist yet"
  // reason as planningType above.
  deloadRules?: DeloadRules | null
}

// ─── Mesocycle ────────────────────────────────────────────────────────────────

export interface Mesocycle {
  id: string
  userId: string
  name: string
  programId: string
  program?: Program
  status: MesocycleStatus
  startDate: string          // ISO date
  endDate: string | null     // set when status → 'completed'
  createdAt: string
  // v2_mesocycles.source_program_id (migration 027/028) — the saved program
  // this run started from (v2_start_run sets it; null for a run that
  // predates chunk 6 and hasn't gone through the transition — not expected
  // once 028 is live, every existing run gets one then). Optional for the
  // same reason as WorkoutDay.sourceWorkoutDayId above — frozen Coach code
  // (weekResolution.ts) builds placeholder Mesocycle values that predate it.
  sourceProgramId?: string | null
}

// ─── Weekly Plan (Layer 2) ────────────────────────────────────────────────────

// One WeekPlan per workout day per week of a meso.
// The bridge between the program template and the actual session.
export interface WeekPlan {
  id: string
  userId: string
  mesocycleId: string
  workoutDayId: string
  workoutDay?: WorkoutDay    // joined for gym UI
  weekNumber: number         // 1-based within the meso
  isDeload: boolean
  notes: string | null
  sets: WeekPlanSet[]        // all planned sets for all exercises in this session
  // v2_week_plan_exercises (migration 027/029, chunk 7 — "Each planned
  // session owns its exercise list"). This week's own exercise list, in
  // this week's own order (position on the v2_week_plan_exercises row, not
  // the underlying program exercise's). Until chunk 9, every write path
  // that edits either list keeps the other in step (weekPlanService.ts /
  // programService.ts), so this always mirrors workoutDay.exercises
  // exactly — nothing yet reads this as capable of diverging from it.
  exercises: ProgramExercise[]
  createdAt: string
  // v2_week_plans.deload_restore (migration 027; read/written starting
  // chunk 22 — SPEC.md "Deload": "unmarking a session whose sets the rules
  // calculated restores what was planned before it was marked"). Null =
  // no snapshot (this session was never marked with rules on, or has
  // since been restored); a (validated) array = the exact pre-mark sets
  // (deloadRules.ts's DeloadRestoreEntry — id-free, regrouped by
  // (programExerciseId, setNumber, stageIndex) at restore time). Optional,
  // same "may not exist yet" convention as isDeload's own siblings above —
  // every hand-built WeekPlan literal across the existing plan test suite
  // predates this column.
  deloadRestore?: DeloadRestoreEntry[] | null
  // v2_week_plans.sequence_position (migration 027; chunk 25 is the first
  // to read/write it — SPEC "Sequence": "A workout may appear more than
  // once in a sequence"). Null for a weekday run's row, exactly as today;
  // for a sequence run, this planned session's own slot — the position of
  // the v2_program_sequence_items row it was planned from, R16's own slot
  // identity (the same workout_day_id can occupy two different slots in
  // one cycle, each tracked by its own sequence_position). Optional, same
  // "may not exist yet" convention as the field above — every hand-built
  // WeekPlan literal across the existing (weekday-only) test suite
  // predates this column and is unaffected by its absence (reads as null,
  // i.e. "weekday row", wherever this is checked).
  sequencePosition?: number | null
}

// One WeekPlanSet per planned set per exercise.
// References programExerciseId to inherit exercise identity and ordering.
export interface WeekPlanSet {
  id: string
  weekPlanId: string
  userId: string
  programExerciseId: string
  programExercise?: ProgramExercise  // joined for gym UI / plan builder display
  setNumber: number          // 1-based, per exercise within this plan
  targetRir: number | null
  isDropset: boolean

  // Dropset grouping (v3 §2.1) — same relational shape as SetLog below.
  parentWeekPlanSetId: string | null
  stageIndex: number         // 0 = head (main stage), 1.. = stage order

  isWarmup: boolean          // never enters e1RM/volume/reference; no authoring UI yet (v3 §2.5)

  // v2_week_plan_sets.rep_min/rep_max/is_amrap (migration 027; read starting
  // chunk 11 — SPEC.md "Removals": suggested reps are replaced by per-set
  // rep targets, shown "in Plan and on the workout screen's rows"). Copied
  // from the source v2_program_sets row when the week is planned
  // (v2_plan_week); editing them is chunk 19's own scope (PlanPage.tsx's
  // RepTargetEditor).
  // Optional, not required: every hand-built WeekPlanSet literal across the
  // existing gym/plan test suite predates these columns (same precedent as
  // Program.kind?/WorkoutDay.sourceWorkoutDayId? above) and must keep
  // compiling unchanged. Absent/undefined reads as "no target" wherever this
  // is used — the same convention columnsToRepTarget (plannerVocabulary.ts)
  // already applies to a genuinely-null row.
  repMin?: number | null
  repMax?: number | null
  isAmrap?: boolean
  // v2_week_plan_sets.stage_kind (migration 027; read/written starting
  // chunk 14 — SPEC.md "Staged sets": "The dropset machinery generalised.
  // Stage kinds: dropset, rest-pause, myo-reps, cluster"). Heads only — a
  // stage row's own value is always null by the DB's own check
  // (v2_week_plan_sets_stage_row_check). Optional for the same reason as
  // repMin/repMax/isAmrap above: every hand-built WeekPlanSet literal
  // across the existing gym/plan test suite predates this column.
  // Absent/undefined reads as null wherever this is used — a null (or
  // legacy-absent) stage_kind on a head that has stages reads as a dropset
  // (plannerVocabulary.ts's resolveStageKind).
  stageKind?: 'dropset' | 'rest_pause' | 'myo_reps' | 'cluster' | null
  // v2_week_plan_sets.program_set_id (migration 027; read starting chunk 16
  // — SPEC.md "Rest"/TASKS.md "Planned set": "the run copy's set this came
  // from; how the workout screen finds the set's design fields (rest
  // override, stage rest)"). Optional, same "may not exist yet" convention
  // as the fields above; absent/undefined means no per-set design fields are
  // reachable for this row (falls through restChain.ts's own chain) — true
  // of every existing fixture/test predating this chunk, and of any row
  // created before 027 or outside a program-set-backed plan.
  programSetId?: string | null
  // v2_week_plan_sets.target_weight (migration 027; read/written starting
  // chunk 19 — SPEC.md "Targets": "Weight targets: per set, in the week plan
  // only. Never in the program."). Kg, same canonical-storage convention as
  // every other weight value in this app (weightUnit.ts) — display/entry
  // conversion is the caller's job (useWeightDisplay), not this type's.
  // Optional, same "may not exist yet" convention as the fields above;
  // absent/undefined reads as null (no target) everywhere this is used.
  targetWeight?: number | null
  // v2_week_plan_sets.tags (migration 027; read/written starting chunk 19 —
  // SPEC.md "Tags": "Per set, several allowed, in the week plan... Shown on
  // the set's row during the workout. Never tracked. Never copied."). Heads
  // only by convention (chunk 19's own authoring UI never writes one on a
  // stage row — stages are never independent sets); a stage row's own value
  // is simply never set, not DB-enforced the way stage_kind is. Optional,
  // same fallback convention as the fields above; absent/undefined reads as
  // "no tags" (an empty list) everywhere this is used.
  tags?: string[] | null
}

// ─── Session (Layer 3 — what actually happened) ───────────────────────────────

export interface Session {
  id: string
  userId: string
  mesocycleId: string | null
  weekPlanId: string | null  // null when no WeekPlan exists for this week
  weekPlan?: WeekPlan        // joined for gym UI
  workoutDayId: string | null
  workoutDay?: WorkoutDay    // joined for gym UI
  date: string               // ISO date — the date this session is *for*
  // Chunk 24 (SPEC "Weekday" — "Move this session to another day, this week
  // only") — v2_sessions.moved_to_date (column since migration 027, chunk
  // 1). `date` keeps meaning "the date this session is for"; this is the day
  // it was actually moved to, same week. Optional, same "may not exist yet"
  // convention every other migration-027 field on this app's types already
  // follows (WeekPlan.deloadRestore, ReferenceSession.movedToDate in
  // sessionService.ts, etc.) — every Session literal built by a test file
  // before this chunk predates the field and never sets it; absent/undefined
  // reads as "use `date`" wherever this is consulted (scheduler.ts,
  // historyService.ts), never a crash. The real mapper (sessionService.ts's
  // toSession) always sets a concrete value (the column itself is
  // guaranteed to exist — it's been live since 027 — so there this is never
  // actually undefined, only possibly null).
  movedToDate?: string | null
  status: SessionStatus
  note: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  setLogs?: SetLog[]         // populated on full session load

  // Optional, once per completed session (COACH-PERSONALIZATION-SPEC §4/§5)
  // — required keys, nullable types, same "absence is data too" reasoning as
  // SetLog.formRating above. 'none' (rated, no energy/pump) is distinct from
  // null (not rated) — TASKS §7.3.
  energyRating: EnergyRating | null
  pumpRating: PumpRating | null
}

// ─── SetLog ───────────────────────────────────────────────────────────────────

export interface SetLog {
  id: string
  userId: string
  sessionId: string
  exerciseId: string
  exercise?: Exercise

  // Links actual set back to its plan target.
  // Null for sets beyond the plan or sessions without a WeekPlan.
  weekPlanSetId: string | null

  setNumber: number          // 1-based, per exercise within this session
  weight: number | null      // null only when isSkipped = true
  reps: number | null        // null only when isSkipped = true
  rir: number | null
  note: string | null

  // Dropset grouping:
  // A planned dropset:      isDropset=true, weekPlanSetId → planned dropset row
  // A spontaneous dropset:  isDropset=true, weekPlanSetId=null, parentSetId set
  isDropset: boolean
  parentSetId: string | null
  stageIndex: number         // 0 = head (main stage), 1.. = stage order (v3 §2.1)

  isWarmup: boolean          // never enters e1RM/volume/reference; no logging UI yet (v3 §2.5)
  setSeconds: number | null  // duration of the set itself; null = not measured (v3 §2.2)
  enteredUnit: WeightUnit | null  // what the user actually typed at log time (v3 §2.4)

  isSkipped: boolean
  loggedAt: string           // ISO timestamp — source of truth for rest time
  restSeconds: number | null

  // Optional, per-set (COACH-PERSONALIZATION-SPEC §4/§5) — required key,
  // nullable type: null = not rated, never a default (§7 "absence is data
  // too"). Forces every SetLog mapper to say what it produces (v3
  // Personalization TASKS §4.1) rather than silently defaulting to null.
  formRating: FormRating | null

  // v2_set_logs.stage_kind (migration 027; read/written starting chunk 14
  // — TASKS.md "Logging": "the head's v2_set_logs.stage_kind records the
  // planned kind (as planned)"). Heads only — a stage row's own value is
  // always null by the DB's own check (v2_set_logs_stage_row_check).
  // Optional, same "may not exist yet" precedent as WeekPlanSet.stageKind
  // above: every hand-built SetLog literal across the existing gym/coach/
  // history test suite predates this column and must keep compiling
  // unchanged. Absent/undefined reads as null (a legacy or unplanned head
  // — reads as a dropset once it has stages, same resolveStageKind rule).
  stageKind?: 'dropset' | 'rest_pause' | 'myo_reps' | 'cluster' | null
}

// ─── Coach Personalization ratings (v3, phase 1) ───────────────────────────
// Vocabularies fixed by COACH-PERSONALIZATION-SPEC §4, confirmed by Adam
// before build (2026-08-25) — see COACH-PERSONALIZATION-TASKS.md §2.1/§7.11.
// A rated 'none' (energy/pump) is a real signal, not the same as an unrated
// NULL — see that doc's §7.3.

export type FormRating = 'rushed' | 'normal' | 'controlled' | 'extra_controlled'
export type EnergyRating = 'none' | 'low' | 'normal' | 'high' | 'supreme'
export type PumpRating = 'none' | 'some' | 'good' | 'extreme'

// ─── Scheduling ───────────────────────────────────────────────────────────────

// Two 'suggest' variants: plan exists vs no plan for this week yet.
//
// Chunk 24 (SPEC "Weekday" — "Move this session"/"Several sessions a day are
// listed; each opens on its own") — variant changes (Lessons: "list every
// variant change"):
//   - `rest_day` gains `next` (additive field — no existing construction of
//     this literal exists anywhere in the app, checked by grep, so this is
//     not a breaking change to any caller): the next scheduled session, for
//     the empty-state bullet ("no session today -> the next scheduled
//     session and when it's due"). null only when the program schedules no
//     day at all.
//   - NEW `planned`: a session moved here before it started — a real
//     `v2_sessions` row (status 'planned', TASKS.md's session data model:
//     "the status exists but is unused today" until this chunk), distinct
//     from `suggest_from_plan`/`suggest_no_plan` (which still mean "no row
//     exists yet" exactly as before — starting one CREATES a row; starting
//     a `planned` one UPDATES its existing row, never a second insert).
//   - NEW `due_today`: two or more sessions share today (G14's own "moving
//     onto a day that already has one leaves both... shown as a list").
//     Each entry reuses one of the four single-session shapes above/below —
//     never a fifth shape. Emitted ONLY when 2+ sessions are due; the
//     overwhelmingly common one-session day keeps returning the exact same
//     singular variant (`completed_today`/`suggest_from_plan`/
//     `suggest_no_plan`/`planned`) it always would have, unchanged shape,
//     unchanged meaning — only the selection logic feeding it now also
//     counts a moved-here session as "due today" and excludes a moved-away
//     one (scheduler.ts).
//   - `missed_sessions`: shape unchanged; the queue itself is now built from
//     a current-calendar-week-only lookback (SPEC — "only for missed days of
//     the current week"), not a 7-day cross-week one.
//   - `active_session`/`no_program`/`no_active_meso`: unchanged, including
//     the "one session in progress at a time" global short-circuit.
export type SchedulerResult =
  | { type: 'no_program' }
  | { type: 'no_active_meso' }
  | { type: 'active_session';    session: Session }
  | { type: 'completed_today';   session: Session }
  | { type: 'suggest_from_plan'; weekPlan: WeekPlan; date: string }
  | { type: 'suggest_no_plan';   workoutDay: WorkoutDay; date: string }
  | { type: 'planned';           session: Session; weekPlan: WeekPlan | null; workoutDay: WorkoutDay | null }
  | { type: 'rest_day';          next: NextScheduledSession | null }
  | { type: 'missed_sessions';   queue: MissedSession[] }
  | { type: 'due_today';         sessions: DueTodayEntry[] }

// The empty state's own "next scheduled session and when it's due" (SPEC
// "Today / workout screen" — Empty state bullet). Scans the program's own
// weekly template forward from tomorrow — it deliberately does not account
// for a future day's own session having itself been moved away (see
// scheduler.ts's own comment on this simplification).
export interface NextScheduledSession {
  date: string
  workoutDay: WorkoutDay
}

// One entry of a multi-session due-today list (`due_today` above) — the
// same four shapes a single due-today session can be, minus `active_session`
// (impossible here: any in-progress session anywhere short-circuits the
// whole scheduler result before this list is ever built — "one session in
// progress at a time, as today").
export type DueTodayEntry =
  | { type: 'completed_today';   session: Session }
  | { type: 'suggest_from_plan'; weekPlan: WeekPlan; date: string }
  | { type: 'suggest_no_plan';   workoutDay: WorkoutDay; date: string }
  | { type: 'planned';           session: Session; weekPlan: WeekPlan | null; workoutDay: WorkoutDay | null }

export interface MissedSession {
  date: string               // ISO date the session was originally for
  weekPlan: WeekPlan | null  // null if no WeekPlan exists for that week
  workoutDay: WorkoutDay
  existingSessionId: string | null
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface UserSettings {
  theme: 'dark' | 'light'
  accentColour: string       // CSS colour value — applied to --accent
  restTimerEnabled: boolean
  buzzOnRestComplete: boolean
  targetRestSeconds: number
  weightUnit: WeightUnit
  autoFinishMinutes: number | null  // null = auto-finish disabled
  measureSetTime: boolean    // global Start Set toggle (v3 §2.2 / SPEC §4.2)
  // v2_user_settings.week_start (migration 027, chunk 8 — SPEC.md "Weeks
  // and copying": "'copy last week' is the default; a setting lets weeks
  // start empty instead"). Governs only the AUTOMATIC fill of a
  // week-dependent run's week beyond week 1 (weekSources.ts); the manual
  // "Copy last week"/"Copy this workout" actions always try to copy,
  // regardless of this setting.
  weekStart: 'copy' | 'empty'
  // v2_user_settings.warmup_display (migration 027, chunk 15 — SPEC.md
  // "Warmup sets": "Display setting: rows (default; numbers optional) or
  // tick (tick-off only)"). Governs every warmup row on the workout screen
  // (SetRow.tsx's isWarmup branch) — read live via useSettingsStore, same
  // convention as measureSetTime.
  warmupDisplay: 'rows' | 'tick'
  // v2_user_settings.deload_rules (migration 027; read/written starting
  // chunk 22 — SPEC.md "Settings": "default deload rules"; "Deload rules":
  // "global default in settings, override per program"). Null = no rules
  // switched on (the section's own off-by-default state) — never `{}`:
  // DeloadRulesEditor.tsx writes null the moment every individual rule is
  // switched off, the same canonicalisation deloadRules.ts's own
  // validateDeloadRules applies on read.
  deloadRules: DeloadRules | null
}

// ─── Coach (Daily Session Analysis) ────────────────────────────────────────────

export type TrainingPhase = 'cut' | 'bulk' | 'maintain'

export interface PhaseEntry {
  id: string
  userId: string
  phase: TrainingPhase
  startDate: string          // ISO date
  createdAt: string
}

// Derived at read time — never stored (COACH-ANALYSIS-SPEC §5: no end-date field).
export interface ResolvedPhase extends PhaseEntry {
  endDate: string | null     // next entry's startDate − 1 day; null = current
  durationDays: number       // as of the date being resolved against
}

export type WeightEntryKind = 'daily' | 'weekly_average'

export interface WeightEntry {
  id: string
  userId: string
  entryDate: string          // ISO date. For 'weekly_average', the Monday of
                              // the week it represents (COACH-ANALYSIS-TASKS §5.2)
  weightKg: number
  kind: WeightEntryKind
  createdAt: string
}

// Computed, never stored (COACH-ANALYSIS-SPEC §8: "never destroy raw data").
export interface WeeklyWeightAverage {
  weekStart: string              // Monday, ISO date
  averageKg: number
  source: 'manual' | 'daily'     // which rule produced it (COACH-ANALYSIS-TASKS §5.3)
  dailyCount: number             // 0 when source === 'manual'
}

// ─── Coach Notes (Personalization phase 3) ─────────────────────────────────
// Raw, freeform, timestamped input — deliberately not the same thing as
// Coach Memory (COACH-PERSONALIZATION-SPEC.md §4). sessionId is set for a
// sidebar-sourced note, null for a general (Context tab) one. curatedAt is
// the phase-4 curation watermark — null means "never seen by a curation
// run" (not yet built; always null for every note through phase 3).
export interface CoachNote {
  id: string
  userId: string
  body: string
  sessionId: string | null
  curatedAt: string | null
  createdAt: string
}

export interface CoachExerciseComment {
  exerciseId: string
  exerciseName: string       // denormalised at generation time — an exercise
                              // rename/archive later must not rewrite this record
  comment: string             // prose — reasons about *why*, per SPEC §5/§8
}

export interface CoachAnalysisContent {
  exercises: CoachExerciseComment[]
  overall: string              // SPEC §5's short overall session read
}

// Row shape for v2_coach_session_analyses (migration 012).
export interface CoachSessionAnalysis {
  id: string
  userId: string
  sessionId: string
  content: CoachAnalysisContent
  inputSnapshot: AnalysisInput   // exactly what the model was shown (§5.11)
  model: string                  // response.model, e.g. 'claude-haiku-4-5-20251001'
  promptVersion: number
  inputTokens: number | null
  outputTokens: number | null
  createdAt: string
}

// ─── Coach (Weekly Analysis) ────────────────────────────────────────────────
// exercises.muscle_subgroup / .movement_pattern (migration 013). Both nullable
// — an exercise with neither is untagged and falls back to muscleGroup for
// bucketing (COACH-WEEK-ANALYSIS-SPEC.md §5).

// DB-enforced vocabulary (013's CHECK) — exactly SPEC §4's seven values.
export type MovementPattern =
  | 'horizontal_push' | 'vertical_push'
  | 'horizontal_pull' | 'vertical_pull'
  | 'hip_hinge' | 'squat' | 'isolation'

// Deliberately NOT a union type: the subgroup vocabulary is app-layer only
// (COACH-WEEK-ANALYSIS-TASKS.md §7.10), so a value the app doesn't recognise
// must degrade to "an unfamiliar bucket label", never a type error or a
// dropped occurrence.
export type MuscleSubgroup = string

export interface ExerciseTags {
  exerciseId: string
  exerciseName: string
  muscleGroup: MuscleGroup | null
  muscleSubgroups: MuscleSubgroup[] | null   // null = untagged (never [])
  movementPattern: MovementPattern | null
}

// Two values, not three: which axis a bucket lives on. Whether a
// muscle_subgroup-axis bucket used a real tag or fell back to the coarse
// muscleGroup column is carried by WeekAnalysisBucket.isFallback below, not
// by a third kind value — a bucket's kind and its fallback status would
// otherwise say the same thing twice for every subgroup-axis bucket.
export type WeekBucketKind = 'muscle_subgroup' | 'movement_pattern'

export interface WeekAnalysisBucket {
  key: string                       // e.g. 'subgroup:side_delt', 'pattern:horizontal_push'
  kind: WeekBucketKind
  label: string                     // e.g. 'side_delt'
  // true when at least one occurrence here landed via the muscleGroup
  // fallback rather than a real muscle_subgroup tag (SPEC §5). Only
  // meaningful for kind === 'muscle_subgroup' — a movement_pattern bucket
  // has no fallback path at all (no tags row means absent from this axis
  // entirely, not present-with-fallback — see §7.9).
  isFallback: boolean
  occurrenceIds: string[]
}

// Output shape (COACH-WEEK-ANALYSIS-TASKS.md §3.2) — a small, selective set
// of highlights (SPEC §5), never one per bucket. `bucketKind` includes
// 'cross' (not in WeekBucketKind) deliberately — SPEC §1's whole point is
// reading a pattern *across* buckets ("bench down, fly up"), which by
// definition doesn't live in one.
export interface CoachWeekHighlight {
  bucketKind: WeekBucketKind | 'cross'
  bucketLabel: string
  // Filtered at render time against the payload's real ids — a
  // hallucinated id is dropped from the deep links, never fails the
  // render (mirrors AnalysisDetail.tsx's existing precedent).
  exerciseIds: string[]
  headline: string
  comment: string
}

export interface CoachWeekAnalysisContent {
  highlights: CoachWeekHighlight[]
  overall: string
}

// Row shape for v2_coach_week_analyses (migration 013).
export interface CoachWeekAnalysis {
  id: string
  userId: string
  weekStart: string
  content: CoachWeekAnalysisContent
  inputSnapshot: WeekAnalysisInput   // exactly what the model was shown
  model: string                      // response.model, not the request constant
  promptVersion: number              // WEEK_PROMPT_VERSION, independent of daily's
  inputTokens: number | null
  outputTokens: number | null
  createdAt: string
}

// ─── Coach Mesocycle Analysis (MESOCYCLE-ANALYSIS-TASKS.md §6) ─────────────
// Output shape matches SPEC §4's three layers exactly: per-exercise (every
// exercise, no padding), a dual muscle/movement grouping (mechanically
// bucketed — see coachMesoPrompt.ts's buildMesoPromptPayload/weekBuckets.ts,
// the model never decides membership, only writes `comment`), and one
// block-wide summary plus advisory-only suggestions (§2's out-of-scope
// boundary — nothing here ever drafts or implies a plan change).

export interface MesoExerciseComment {
  exerciseId: string
  exerciseName: string
  comment: string
}

// Three values, unlike WeekBucketKind's two (above) — a meso-scope group
// comment must say whether it's really talking about a whole muscle group
// (the bucket fell back because nothing in it had a real subgroup tag) or a
// genuine fine-grained subgroup, which WeekAnalysisBucket.isFallback alone
// already distinguishes on the input side (coachMesoPrompt.ts maps it to
// this field, the model never infers it itself).
export type MesoGroupAxis = 'muscle_group' | 'muscle_subgroup' | 'movement_pattern'

export interface MesoGroupComment {
  axis: MesoGroupAxis
  label: string
  exerciseIds: string[]
  comment: string
}

export interface MesoSuggestion {
  area: string
  suggestion: string
}

export interface CoachMesoAnalysisContent {
  perExercise: MesoExerciseComment[]
  groups: MesoGroupComment[]
  summary: string
  suggestions: MesoSuggestion[]
}

// Row shape for v2_coach_meso_analyses (migration 026). `mesocycleId` and
// `mesoEndDate` are nullable per A6 — the row survives its mesocycle's
// deletion (`on delete set null`), and `mesoName`/`mesoStartDate` are the
// denormalised identity that keeps an orphaned row self-describing (§4.2).
export interface CoachMesoAnalysis {
  id: string
  userId: string
  mesocycleId: string | null
  mesoName: string
  mesoStartDate: string
  mesoEndDate: string | null
  content: CoachMesoAnalysisContent
  inputSnapshot: MesoAnalysisPromptPayload   // exactly what the model was shown
  model: string                              // response.model, not the request constant
  promptVersion: number                      // MESO_PROMPT_VERSION, independent of daily's/weekly's
  inputTokens: number | null
  outputTokens: number | null
  createdAt: string
}

// ─── Coach Memory (Personalization phase 4) ────────────────────────────────
// A separate, curated, standing store the daily analysis prompt reads in
// full (COACH-PERSONALIZATION-SPEC.md §4) — never the same rows as
// v2_coach_notes (TASKS §9.2): curation reads notes and writes memory, a
// note's own body is never rewritten.

export type MemoryEntrySource = 'curation' | 'manual'
export type MemoryEntryStatus = 'active' | 'expired'

// Row shape for v2_coach_memory_entries (migration 018). `source` is
// provenance, not permission — curation may update or expire any entry
// regardless of source (TASKS §2.7). The user's own delete is a hard
// delete; only curation's expire is soft (TASKS §9.4) — there is
// deliberately no "deleted" status here, only 'active'/'expired'.
export interface CoachMemoryEntry {
  id: string
  userId: string
  body: string
  source: MemoryEntrySource
  status: MemoryEntryStatus
  createdAt: string
  updatedAt: string
}

// One uncurated note as the curation call sees it (§5.3 step 3). `session`
// is present only for a sidebar-sourced note, so the model can place it in
// time — read from v2_history_session_summary, the same denormalised
// date/workoutDayName coachService.ts's AnalyzableSession already uses.
export interface CurationNoteInput {
  id: string
  body: string
  createdAt: string
  session: { date: string; workoutDayName: string | null } | null
}

// One active memory entry as the curation call sees it (§5.3 step 5).
export interface CurationMemoryInput {
  id: string
  body: string
  source: MemoryEntrySource
}

// Exactly what the model is shown — persisted verbatim as
// v2_coach_curation_runs.input_snapshot, same "what did the model actually
// see" reasoning as AnalysisInput/WeekAnalysisInput (§3.3, daily §5.11).
export interface CurationInput {
  notes: CurationNoteInput[]
  memory: CurationMemoryInput[]
}

// What the model returns — one decision per note it chose to act on (never
// one-per-note structurally; zero, one, or several notes may collapse into
// a single decision, or produce none at all). Applied by code, never by the
// model (§2.8): only ids present in `memory` above may appear in an
// `update`/`expire`, enforced by curationApply.ts's planCurationApply
// regardless of what the model returns (§5.3 step 7).
export type CurationDecision =
  | { op: 'add'; body: string; reason: string }
  | { op: 'update'; id: string; body: string; reason: string }
  | { op: 'expire'; id: string; reason: string }

// The model's response shape before it becomes a real CurationDecision — the
// structured-output schema can't express "id/body required iff op is
// update/add" as a TypeScript discriminated union, so `id`/`body` are
// required-but-nullable regardless of `op`, and a row whose fields don't
// match its own `op` (e.g. `update` with a null id) is dropped rather than
// coerced. This is genuinely what got stored/returned (see
// v2_coach_curation_runs.decisions below), so it needs its own type rather
// than force-fitting CurationDecision.
export interface CurationRawDecision {
  op: string
  id: string | null
  body: string | null
  reason: string
}

// What code actually did with the model's decisions, after id validation —
// distinct from the raw CurationDecision[] the model returned (that list is
// stored unfiltered in v2_coach_curation_runs.decisions; this is
// v2_coach_curation_runs.applied) so a run row can always answer both "what
// did the model say" and "what actually happened", independently. This is a
// refinement of TASKS §4.4's single `decisions` field on CurationResult —
// deliberate, since §4.4 itself is marked "shape settled, detail deferred"
// and §5.3 step 11's literal return value is `{ applied, rejectedIds,
// notesCurated }`, not `{ decisions, ... }`.
export interface CurationApplied {
  added: { id: string; body: string }[]
  updated: { id: string; body: string }[]
  expired: { id: string }[]
}

// The api/coach/curate-memory.ts response body (§5.3 step 11), also what
// v2_coach_curation_runs.applied plus the two summary fields represent
// together.
export interface CurationResult {
  applied: CurationApplied
  // Ids the model referenced that were not in the `memory` it was sent.
  // Dropped, never applied — same defence WeekAnalysisDetail.tsx already
  // applies to hallucinated exerciseIds.
  rejectedIds: string[]
  notesCurated: number
}

// Row shape for v2_coach_curation_runs (migration 018). The one table in
// this plan the spec doesn't name (TASKS §7.6) — provenance for a process
// that mutates a standing store instead of appending a permanent record,
// same reasoning that put input_snapshot/model/prompt_version/token counts
// on the other two AI surfaces (daily §5.11).
export interface CoachCurationRun {
  id: string
  userId: string
  inputSnapshot: CurationInput
  // Genuinely the raw, unfiltered model output (CurationRawDecision[], not
  // CurationDecision[]) — including any row toDecisions() dropped for not
  // matching its own op (e.g. an `update` with a null id). Fixed to actually
  // be unfiltered during this project's phase-4 adversarial review: it
  // previously stored the post-toDecisions *filtered* list, silently
  // contradicting this exact comment — a dropped decision left no trace
  // anywhere (not here, not in rejectedIds, since it never reached
  // planCurationApply). `applied` below is the filtered, validated record of
  // what code actually did with it.
  decisions: CurationRawDecision[]
  applied: CurationApplied
  model: string
  promptVersion: number
  inputTokens: number | null
  outputTokens: number | null
  noteCount: number
  createdAt: string
}

// ─── Q&A Sidebar (QA-SIDEBAR-SPEC.md / QA-SIDEBAR-TASKS.md) ────────────────
// §3.1's request/category types plus CoachQaExchange live here. QaContext
// and its four per-category payloads (InSessionContext/GeneralContext/
// PlanningContext/AppMechanicsContext) live in qaContext.ts instead (TASKS
// §3 — "the payload types... live next to their assembler"), the same
// reason AnalysisInput/WeekAnalysisInput live in their own feature files
// and are only imported into this one, above.

// SPEC §3's four question categories. Decided by which control in the app
// started the conversation, never inferred by the model (TASKS §7) —
// invariant for every turn of one conversation (TASKS §7.1).
export type QaCategory = 'in_session' | 'general' | 'planning' | 'app_mechanics'

// What the client POSTs to api/coach/ask.ts. Note what is deliberately NOT
// here: no history, no context, no model, no turn index — the server
// derives every one of those (TASKS §5.3, §6.2), so the client can neither
// inflate its own spend nor forge its own log.
export interface QaAskRequest {
  id: string                 // caller-minted uuid, the exchange row's own id (TASKS §5.5)
  conversationId: string     // caller-minted uuid, stable for the whole conversation
  category: QaCategory       // from the call site (TASKS §7), never model-inferred
  question: string
  sessionId: string | null   // non-null exactly when category === 'in_session'
  // The exercise card the question was asked from, when the UI knows it —
  // deterministic-from-UI, same principle as category (TASKS §4.1).
  currentExerciseId: string | null
}

// The response body — the saved row, in camelCase, built server-side
// exactly the way analyze.ts's toCoachSessionAnalysis does it (TASKS §3.1),
// so the client needs no row mapper on this path.
export interface CoachQaExchange {
  id: string
  userId: string
  conversationId: string
  turnIndex: number
  category: QaCategory
  question: string
  answer: string
  contextSnapshot: QaContext   // exactly what the model was shown (TASKS §2.1)
  sessionId: string | null
  model: string                // response.model, not the request constant
  promptVersion: number
  inputTokens: number | null
  outputTokens: number | null
  historyTurnsSent: number     // TASKS §6.2/§6.3 — the cost cap's own audit trail
  createdAt: string
}
