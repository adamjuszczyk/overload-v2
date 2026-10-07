import { supabase } from '../../lib/supabase'
import type { ProgramSet, WeeklySchedule, DayOfWeek, WorkoutDay } from '../../types'
import { repTargetToColumns, columnsToRepTarget, formatRepTarget, type RepTarget } from '../../lib/plannerVocabulary.js'
import { fetchRunProgramExercises } from '../programs/runProgramExercises'
import { createWorkoutDay } from '../programs/programService'

// Chunk 11 — the stepped program planner (TASKS.md "file layout: ...
// plannerService.ts"). First user of v2_program_sets (CONTEXT rule:
// scripts/verify-rls.mjs's TABLES gains it in this same change).
//
// v2_program_exercises is read here ONLY through fetchRunProgramExercises
// (runProgramExercises.ts, chunk 9's one read path) — this file otherwise
// only ever WRITES a brand new row there (cloneProgramExerciseRow, below),
// with an explicit client-chosen id and nothing chained back to read it, so
// scripts/check-program-exercise-reads.mjs needs no new exception for this
// file.

// ─── DB type + mapper ───────────────────────────────────────────────────────

type DbProgramSet = {
  id: string
  user_id: string
  program_exercise_id: string
  position: number
  is_warmup: boolean
  stage_kind: string | null
  stage_rest_seconds: number | null
  parent_program_set_id: string | null
  stage_index: number
  rep_min: number | null
  rep_max: number | null
  is_amrap: boolean
  rest_seconds: number | null
  created_at: string
}

function toProgramSet(row: DbProgramSet): ProgramSet {
  return {
    id: row.id,
    userId: row.user_id,
    programExerciseId: row.program_exercise_id,
    position: row.position,
    isWarmup: row.is_warmup,
    stageKind: row.stage_kind as ProgramSet['stageKind'],
    stageRestSeconds: row.stage_rest_seconds,
    parentProgramSetId: row.parent_program_set_id,
    stageIndex: row.stage_index,
    repMin: row.rep_min,
    repMax: row.rep_max,
    isAmrap: row.is_amrap,
    restSeconds: row.rest_seconds,
    createdAt: row.created_at,
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────

// Bulk fetch for every program-exercise id given, one request — the
// per-workout volume view (StepVolume.tsx) calls this once per workout with
// every one of its exercises' ids, not once per exercise.
export async function fetchProgramSets(programExerciseIds: string[]): Promise<ProgramSet[]> {
  if (programExerciseIds.length === 0) return []
  const { data, error } = await supabase
    .from('v2_program_sets')
    .select('*')
    .in('program_exercise_id', programExerciseIds)
    .order('position', { ascending: true })
  if (error) throw error
  return (data as DbProgramSet[]).map(toProgramSet)
}

// Heads only (027: "a stage shares its head's position"). Chunk 11 never
// creates a stage (chunk 14's scope — stage_kind/parent_program_set_id stay
// null on every row this file writes), but every count/display this module
// feeds stays correct once stages exist too, by going through this filter
// rather than assuming every row is a head.
export function headSets(sets: ProgramSet[]): ProgramSet[] {
  return sets.filter((s) => s.parentProgramSetId === null)
}

// Reviewer note: "keep the flag in one place so (b), blocking Start, would
// be a one-line guard." The one place: a program-exercise with zero heads.
// DECISIONS 52 (provisional a) — Save/Start never read this; only the
// step-3 per-exercise "no sets yet" flag does, today.
export function hasNoSets(sets: ProgramSet[]): boolean {
  return headSets(sets).length === 0
}

// ─── Stages (chunk 14 — SPEC.md "Staged sets") ─────────────────────────────
// Program-level staging: a head's own stage_kind (one of the four — null
// reads as a dropset, resolveStageKind, plannerVocabulary.ts) plus its
// stage rows (parent_program_set_id + stage_index), same relational shape
// 027 gives v2_week_plan_sets/v2_set_logs. Program sets carry no weight/RIR
// at all (SPEC "Targets": week-plan-only), so authoring here is only ever
// the kind and each stage's own rep target — never a weight carry-over
// concern (that is wholly a workout-screen/runtime rule, stageCarryLogic.ts).

// Chunk 15 (SPEC "Warmup sets" — "A set kind, planned in step 3"). Head-only
// by the same DB check that keeps stage_kind off a stage row
// (v2_program_sets_warmup_check: "not is_warmup or (stage_kind is null and
// parent_program_set_id is null)" — a warmup is never staged, and a stage
// never carries the warmup flag). StepVolume.tsx only ever calls this on a
// head, never offering the toggle on a stage row or ADD STAGE once a head
// is marked warmup, so this never needs to validate the combination itself.
export async function updateProgramSetIsWarmup(id: string, isWarmup: boolean): Promise<void> {
  const { error } = await supabase.from('v2_program_sets').update({ is_warmup: isWarmup }).eq('id', id)
  if (error) throw error
}

// Head-only (the DB's own check, v2_program_sets_stage_row_check, refuses
// this on a stage row); null reverts to "no kind chosen" (resolveStageKind
// then reads it as a dropset, same as a legacy/never-set row).
export async function updateProgramSetStageKind(
  id: string,
  stageKind: 'dropset' | 'rest_pause' | 'myo_reps' | 'cluster' | null,
): Promise<void> {
  const { error } = await supabase.from('v2_program_sets').update({ stage_kind: stageKind }).eq('id', id)
  if (error) throw error
}

// Chunk 16 (SPEC "Rest") — per-set rest override, any row (head or stage —
// no CHECK restricts rest_seconds to heads only, unlike stage_kind/
// stage_rest_seconds). Design field: editable for both planning types,
// never gated by volumeReadOnly (StepVolume.tsx's own rule — see that
// file's header comment).
export async function updateProgramSetRest(id: string, restSeconds: number | null): Promise<void> {
  const { error } = await supabase.from('v2_program_sets').update({ rest_seconds: restSeconds }).eq('id', id)
  if (error) throw error
}

// Head-only (the DB's own check, same as stage_kind above); null reverts to
// "the kind's own default" (plannerVocabulary.ts's DEFAULT_STAGE_REST_SECONDS
// — dropset none, others 15s), read by restChain.ts at session load.
export async function updateProgramSetStageRest(id: string, stageRestSeconds: number | null): Promise<void> {
  const { error } = await supabase.from('v2_program_sets').update({ stage_rest_seconds: stageRestSeconds }).eq('id', id)
  if (error) throw error
}

// Mirrors weekPlanService.ts's addStage: the parent id is given directly
// by the caller (StepVolume.tsx already has the head in hand), never
// inferred. A stage shares its head's position (027's own invariant,
// enforced by the caller passing it through, not re-derived here) and
// carries no kind/rest/warmup of its own (the DB's own check) — this
// function simply never sets those columns, so they take the table's
// default/null, satisfying the check by construction.
export async function addProgramSetStage(
  userId: string,
  programExerciseId: string,
  parentId: string,
  position: number,
  stageIndex: number,
): Promise<ProgramSet> {
  const { data, error } = await supabase
    .from('v2_program_sets')
    .insert({
      user_id: userId,
      program_exercise_id: programExerciseId,
      position,
      is_warmup: false,
      parent_program_set_id: parentId,
      stage_index: stageIndex,
    })
    .select()
    .single()
  if (error) throw error
  return toProgramSet(data as DbProgramSet)
}

// A single row, head or stage — the SETS stepper's own shrink path
// (setExerciseSetCount below) bulk-deletes heads directly; this is the
// one-at-a-time delete STAGE's own remove button uses. Deleting a head
// this way cascades its stages too (027: parent_program_set_id ... on
// delete cascade), same as the week-plan/log-side stage cascade.
export async function removeProgramSet(id: string): Promise<void> {
  const { error } = await supabase.from('v2_program_sets').delete().eq('id', id)
  if (error) throw error
}

// ─── Set count — step 3's one required value ───────────────────────────────
// Reconciles an exercise's own head rows to exactly `count`, in one of two
// directions, never both: short of `count` -> appends new rows; over
// `count` -> deletes the excess TRAILING rows (highest position first).
// Every RETAINED row (every position <= min(old, new) count) is left
// completely untouched, including whatever rep target it already carries —
// a per-set override "survives an unrelated count change" (review fix)
// because growing/shrinking never writes to a row it didn't just insert.
//
// Review fix — a newly APPENDED row no longer starts blank: it takes the
// rep target of the exercise's own last existing head (highest position),
// or no target when there was none to copy (first-ever sets). TASKS.md:
// "sets added by the stepper take the rep target of the exercise's last
// existing set" — so raising the count after an exercise-level "set 8–12"
// (setRepTargetForAllSets, below) keeps adding 8–12 sets, the same "stays
// quick for the plain case" SPEC asks of the stepper itself.
export async function setExerciseSetCount(
  userId: string,
  programExerciseId: string,
  currentHeads: ProgramSet[],
  count: number,
): Promise<void> {
  if (count < 0) throw new Error('setExerciseSetCount: count must be >= 0')
  const sorted = [...currentHeads].sort((a, b) => a.position - b.position)

  if (count > sorted.length) {
    const last = sorted[sorted.length - 1] ?? null
    const rows = []
    for (let position = sorted.length + 1; position <= count; position++) {
      rows.push({
        user_id: userId,
        program_exercise_id: programExerciseId,
        position,
        is_warmup: false,
        rep_min: last?.repMin ?? null,
        rep_max: last?.repMax ?? null,
        is_amrap: last?.isAmrap ?? false,
      })
    }
    const { error } = await supabase.from('v2_program_sets').insert(rows)
    if (error) throw error
  } else if (count < sorted.length) {
    const idsToRemove = sorted.slice(count).map((s) => s.id)
    const { error } = await supabase.from('v2_program_sets').delete().in('id', idsToRemove)
    if (error) throw error
  }
}

// Per-set adjustment (SPEC.md "Stepped program planner" step 3; "Targets" —
// "a number, a range, or AMRAP"). repTargetToColumns (plannerVocabulary.ts,
// chunk 2) is the one place min/max/AMRAP are derived from a RepTarget;
// re-used here rather than re-deriving so this and the week-plan's own
// display (columnsToRepTarget, the read direction) can never disagree.
export async function updateProgramSetRepTarget(id: string, target: RepTarget): Promise<void> {
  const columns = repTargetToColumns(target)
  const { error } = await supabase
    .from('v2_program_sets')
    .update({ rep_min: columns.repMin, rep_max: columns.repMax, is_amrap: columns.isAmrap })
    .eq('id', id)
  if (error) throw error
}

// Review fix — "fill all sets of an exercise at once" (SPEC.md step 3's own
// plain-case shortcut, missing from the first pass): one call, one write,
// covering every CURRENT head of the exercise — not one updateProgramSetRepTarget
// per set, which would be several round trips for what SPEC frames as a
// single action. Takes the ids directly (the caller already has the heads
// in hand to render them) rather than re-deriving them, so it never risks
// racing a concurrent read of "current heads". A caller with zero heads has
// nothing to fill — short-circuits with no Supabase call, same posture as
// fetchProgramSets' own empty-input guard.
export async function setRepTargetForAllSets(headIds: string[], target: RepTarget): Promise<void> {
  if (headIds.length === 0) return
  const columns = repTargetToColumns(target)
  const { error } = await supabase
    .from('v2_program_sets')
    .update({ rep_min: columns.repMin, rep_max: columns.repMax, is_amrap: columns.isAmrap })
    .in('id', headIds)
  if (error) throw error
}

// Pure — the exercise-level summary StepVolume.tsx shows beside the SETS
// stepper: every head's own target when they all agree, or 'mixed' when
// they don't (review fix: "a neutral 'mixed' state with existing tokens").
// Compared by formatted text (same shortcut updateProgramSetRepTarget's own
// UI uses, StepVolume.tsx's SetTargetRow.commit) — two RepTargets format
// identically iff they're the same target, since format is injective per
// type (plannerVocabulary.ts: digits / "min–max" / "AMRAP" / "none", never
// overlapping). Null (no heads at all) is the caller's own call — SPEC
// gives nothing to summarise when there's nothing to fill yet.
export function summarizeRepTargets(heads: ProgramSet[]): RepTarget | 'mixed' | null {
  if (heads.length === 0) return null
  const targets = heads.map((h) => columnsToRepTarget({ repMin: h.repMin, repMax: h.repMax, isAmrap: h.isAmrap }))
  const first = targets[0]
  const firstText = formatRepTarget(first)
  return targets.every((t) => formatRepTarget(t) === firstText) ? first : 'mixed'
}

// ─── Schedule: one weekday per workout ──────────────────────────────────────

const DAYS_ORDER: DayOfWeek[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]

// Pure. The schedule after assigning `workoutDayId` to `dow` (or clearing it
// with dow = null). TASKS.md step 2: "one weekday per workout" — clears any
// OTHER day this workout already held first, so a workout is never on two
// days after this call. The converse ("no two workouts on one weekday",
// SPEC.md "later") needs no code: the map shape (one id per day key) already
// makes it impossible to represent two workouts on the same day.
export function assignWorkoutWeekday(
  schedule: WeeklySchedule,
  workoutDayId: string,
  dow: DayOfWeek | null,
): WeeklySchedule {
  const next = { ...schedule }
  for (const d of DAYS_ORDER) {
    if (next[d] === workoutDayId) next[d] = null
  }
  if (dow) next[dow] = workoutDayId
  return next
}

// ─── G14: one workout on several weekdays ──────────────────────────────────
// TASKS.md, verbatim: "Existing programs with one workout on several
// weekdays... Opening such a program in the planner asks [to] either give
// each weekday its own workout or switch the program to a sequence; nothing
// is converted automatically." The sequence choice is chunk 25's
// (DECISIONS 44 (a)); this file only ever offers the other two.

export interface SharedWeekdayGroup {
  workoutDayId: string
  weekdays: DayOfWeek[]
}

// Pure, read-only — never mutates `schedule`. A program whose schedule was
// built entirely through assignWorkoutWeekday above can never produce a
// result here (that function's own invariant rules it out); this exists for
// every program authored before this chunk shipped.
export function detectSharedWeekdayWorkouts(schedule: WeeklySchedule): SharedWeekdayGroup[] {
  const byWorkout = new Map<string, DayOfWeek[]>()
  for (const dow of DAYS_ORDER) {
    const id = schedule[dow]
    if (!id) continue
    const days = byWorkout.get(id) ?? []
    days.push(dow)
    byWorkout.set(id, days)
  }
  return [...byWorkout.entries()]
    .filter(([, days]) => days.length >= 2)
    .map(([workoutDayId, weekdays]) => ({ workoutDayId, weekdays }))
}

// A brand-new v2_program_exercises row with an explicit, client-chosen id
// and no .select() chained back — deliberately NOT programService.ts's own
// addProgramExercise, for two reasons: (1) that function always writes a
// literal weight_unit, never null/"inherit", which would silently change the
// clone's own unit preference away from the source's; (2) its
// .insert(...).select().single() would be a direct read of
// v2_program_exercises outside runProgramExercises.ts. crypto.randomUUID()
// for a client-chosen id written straight into an insert payload is already
// this codebase's own pattern for exactly this reason (useSession.ts).
//
// Chunk 16 (SPEC "Rest") — carries restSeconds/restAfterSeconds verbatim,
// same reasoning the review fix just below (cloneWorkoutDay's own program-
// set copy) already gives for stage_kind/stage_rest_seconds: a chunk that
// makes a design field reachable (this one, for the exercise-level rest
// fields — chunk 16's first use of them) owns closing the same "deep copy
// silently drops it" gap for it, before anything can actually populate it.
// Not superset_block_id — a cloned workout day never shares a block with
// the source one (chunk 13's own scope; blocks are per-workout-day), so
// that column already correctly starts null on a clone, same as today.
//
// Chunk 17 (SPEC "Tempo") — same reasoning again, for tempo: StepExercises.tsx
// is this chunk's own first UI that can put a non-null tempo on a program
// exercise, so this split's own clone owns carrying it too, same as rest did
// for chunk 16.
async function cloneProgramExerciseRow(
  userId: string,
  workoutDayId: string,
  source: { exerciseId: string; position: number; weightUnit: string | null; restSeconds: number | null; restAfterSeconds: number | null; tempo: string | null },
): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await supabase.from('v2_program_exercises').insert({
    id,
    user_id: userId,
    workout_day_id: workoutDayId,
    exercise_id: source.exerciseId,
    position: source.position,
    weight_unit: source.weightUnit,
    rest_seconds: source.restSeconds,
    rest_after_seconds: source.restAfterSeconds,
    tempo: source.tempo,
  })
  if (error) throw error
  return id
}

// One workout's full deep copy: a fresh v2_workout_days row (same name,
// same position), then every current (week_only=false, removed_at=null —
// fetchRunProgramExercises' own filter) exercise and its own sets, copied
// verbatim. No program this prompt ever runs against (kind='saved') can
// have week_only/removed_at rows in the first place (027: "run copies
// only"), so that filter is a no-op here, same as everywhere else
// runProgramExercises.ts documents it to be for a saved program.
//
// Review fix (chunk 14): this used to copy heads only (headSets), dropping
// every column that matters for a staged set — the whole row (stage rows
// entirely) plus stage_kind/stage_rest_seconds on the head, which it never
// even selected. Harmless before chunk 14 (nothing could create a program-
// set stage yet), but chunk 14 is exactly what makes that reachable — a
// chunk that makes a gap reachable owns closing it, same reasoning as the
// chunk 3/9 precedents this repo's own history already has. Client-chosen
// ids (crypto.randomUUID(), same precedent as cloneProgramExerciseRow just
// above — a direct read-after-insert outside runProgramExercises.ts/this
// file's own fetchProgramSets would be the alternative, and still needs
// the same id map) let every stage's parent_program_set_id be remapped to
// its new head's id without reading anything back; heads are inserted and
// committed (awaited) before stages so the FK is always satisfied, the
// same two-phase order copySetsWithGrouping (weekPlanService.ts) and
// 028's v2_copy_program use for the identical self-referencing shape.
async function cloneWorkoutDay(userId: string, source: WorkoutDay): Promise<string> {
  const copy = await createWorkoutDay(userId, source.programId, source.name, source.position)
  const exercises = await fetchRunProgramExercises(source.id)

  for (const ex of exercises) {
    const newExerciseId = await cloneProgramExerciseRow(userId, copy.id, {
      exerciseId: ex.exerciseId,
      position: ex.position,
      weightUnit: ex.weightUnit,
      // Chunk 16 — ?? null covers a ProgramExercise built before this field
      // existed (every pre-chunk-16 fixture/caller), same "may not exist
      // yet" convention the type itself documents.
      restSeconds: ex.restSeconds ?? null,
      restAfterSeconds: ex.restAfterSeconds ?? null,
      // Chunk 17 — same "may not exist yet" convention.
      tempo: ex.tempo ?? null,
    })

    const sets = await fetchProgramSets([ex.id])
    const heads = headSets(sets).sort((a, b) => a.position - b.position)
    const stages = sets.filter((s) => s.parentProgramSetId !== null).sort((a, b) => a.stageIndex - b.stageIndex)

    // A stage row's own stage_kind/stage_rest_seconds/is_warmup are already
    // null/null/false by 027's own check (v2_program_sets_stage_row_check)
    // — carried through verbatim below the same way 028's v2_copy_program
    // does, never forced or special-cased per row.
    const headIdMap = new Map<string, string>()
    if (heads.length > 0) {
      const headRows = heads.map((h) => {
        const newId = crypto.randomUUID()
        headIdMap.set(h.id, newId)
        return {
          id: newId,
          user_id: userId,
          program_exercise_id: newExerciseId,
          position: h.position,
          is_warmup: h.isWarmup,
          stage_kind: h.stageKind,
          stage_rest_seconds: h.stageRestSeconds,
          rep_min: h.repMin,
          rep_max: h.repMax,
          is_amrap: h.isAmrap,
          rest_seconds: h.restSeconds,
        }
      })
      const { error } = await supabase.from('v2_program_sets').insert(headRows)
      if (error) throw error
    }

    if (stages.length > 0) {
      const stageRows = stages.map((s) => ({
        id: crypto.randomUUID(),
        user_id: userId,
        program_exercise_id: newExerciseId,
        position: s.position,
        is_warmup: s.isWarmup,
        stage_kind: s.stageKind,
        stage_rest_seconds: s.stageRestSeconds,
        // s.parentProgramSetId is non-null for every row in `stages` (the
        // filter above) and, for a well-formed exercise, always one of
        // THIS exercise's own heads — already inserted and awaited above.
        parent_program_set_id: headIdMap.get(s.parentProgramSetId!) ?? null,
        stage_index: s.stageIndex,
        rep_min: s.repMin,
        rep_max: s.repMax,
        is_amrap: s.isAmrap,
        rest_seconds: s.restSeconds,
      }))
      const { error } = await supabase.from('v2_program_sets').insert(stageRows)
      if (error) throw error
    }
  }

  return copy.id
}

// "Give each weekday its own workout" (TASKS.md G14) — runs ONLY after an
// explicit confirm (PlannerPage's own prompt), never automatically. Keeps
// the group's FIRST weekday (schedule order, i.e. DAYS_ORDER order — the
// same order detectSharedWeekdayWorkouts walks to build `weekdays`) pointing
// at the original workout; every other weekday in the group gets its own
// fresh deep copy, and the returned schedule points that weekday at the copy
// instead. Touches v2_programs/v2_workout_days/v2_program_exercises/
// v2_program_sets only — this prompt only ever runs against a saved program
// (kind='saved'), which has no v2_week_plans row to begin with, so there is
// nothing of that kind to leave untouched; it is simply never reached.
export async function splitSharedWeekdayWorkouts(
  userId: string,
  workoutDays: WorkoutDay[],
  schedule: WeeklySchedule,
  groups: SharedWeekdayGroup[],
): Promise<WeeklySchedule> {
  let next = { ...schedule }
  for (const group of groups) {
    const [, ...rest] = group.weekdays
    const source = workoutDays.find((d) => d.id === group.workoutDayId)
    if (!source) continue
    for (const dow of rest) {
      const newWorkoutId = await cloneWorkoutDay(userId, source)
      next = { ...next, [dow]: newWorkoutId }
    }
  }
  return next
}
