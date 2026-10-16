// Chunk 45 (TASKS-1.2 "How a CHANGE THE PROGRAM save lands, as a pure function"; SPEC.md [1.2] Programs and runs →
// "Changing a running program: CHANGE THE PROGRAM" (what it edits, week-dependent vs stable, weekdays, "How a save
// lands" (Defaults 1), "Weekdays storage"); Supersets [1.2] (Defaults 5); Defaults 2 and 3).
//
// ONE module turns an edit of the run's copy into the exact rows to write: on the run copy, and on every session
// that has not started from the current week on. The screens (chunks 51a and 51b) edit a local draft; SAVE hands the
// draft here; the op list that comes back goes to migration 043's `v2_apply_ops` (chunk 47) as one request, so a save
// lands or fails as a whole. The SQL holds no planning logic: every rule below is a named branch of this file.
//
//   - planProgramChange ..... the draft + the run + its sessions in, `{ ops, summary }` out
//   - draftFromRunCopy ...... the draft a screen starts from (the run as it is: nothing changed, no ops)
//   - planRowStatus ......... a plan row's status from its sessions' statuses (a shared G14 row)
//   - changeStartWeek ....... "Week N" of the rule box
//   - ruleBoxText, daysCardText, validateDays, dayTakenText .. the texts and the day toggle's refusal
//
// Pure: no Supabase, no React, no clock, no random ids. Everything it needs comes in: the user id every inserted row
// carries, the time a soft removal (and an inserted row's `created_at`) is stamped with, and a function that makes the
// client-generated ids (043's executor takes full rows with their own ids, so a row can be referenced by the rows after
// it in the same list).
//
// ─── What a session is here ──────────────────────────────────────────────────────────────────────────────────────
// A "session" is a planned session: one `v2_week_plans` row (a workout in a week; on a sequence run in a cycle slot)
// with its exercise rows and its set rows, and a status:
//   - done ............. completed or skipped. Never in an op: "Done sessions keep their plan".
//   - in_progress ...... "'Not done' means not started: a session in progress is left exactly as it is": never in an op.
//   - not_started ...... every rule below lands here, from the current week on, a week planned forward included.
// A plan row that two weekdays share (G14: one workout on Tuesday and Thursday) is one session with one status, and
// it is done as soon as any of its sessions is (#77: the shared plan locks for every day sharing it): planRowStatus.
// Weeks before the current one are never touched (SPEC: "from the current week (cycle) on").
//
// ─── How each rule lands ─────────────────────────────────────────────────────────────────────────────────────────
// (SPEC's words in quotes; each is a test with a break proof.)
//   Added exercise      "appended where it was placed, in every not-done session of that workout. Week-dependent: no
//                       sets. Stable: the default's sets." A new run-copy row (and, stable, its program sets), and in
//                       each session a `v2_week_plan_exercises` row at the placed position with, stable, a copy of the
//                       default's sets, each linked to its program set (`program_set_id`).
//   Removed exercise    "removed with its planned sets from every not-done session": the run-copy row gets `removed_at`
//                       (a soft removal, as everywhere on a run copy: a hard delete would cascade into planned sets);
//                       each session's sets (stages first, the head last) and its exercise row are deleted.
//   Swapped exercise    "the new exercise takes the old one's sets (count, kinds, stages, rep targets); weights, RIR and
//                       cues are cleared": a new run-copy row at the old position (it keeps the old row's superset
//                       block; rest, tempo and unit are the draft's, null for a swap, as 1.1's swap had it) and the
//                       old row gets `removed_at`; each session's exercise row and set rows are pointed at the new
//                       row, with `target_weight`, `target_rir`, `target_rir_max` and `tags` set to null.
//   Reordered           "the new order applies to every not-done session": positions on the run copy and on each
//                       session; a superset moves as one block (the draft's order is validated: a block's members
//                       are neighbours).
//   Stable default sets "applied to a not-done session's sets only where that session still matches the old default.
//                       A set changed for that week only ("THIS WEEK ONLY") is left as it is. Weights, RIR and cues
//                       on sets that stay are kept." See "Matching" below.
//   Run-wide fields     rest, tempo, unit, superset rests, superset grouping, the warmup routine, workout names, and a
//                       set's own rest: "one value, every not-done session" because sessions read them live from the
//                       run copy; so only the run copy is written, and no session row is.
//   Weekdays            `v2_run_schedules` rows (runSchedule.ts) and the run copy's `v2_programs.schedule`; nothing on
//                       any session ("this week's not-done sessions keep their days"); a sequence run has no weekdays.
//
// ─── Matching (the stable default's sets) ────────────────────────────────────────────────────────────────────────
// A session's head set is the counterpart of one of the OLD default's head sets when it names it (`program_set_id` is
// the id of that program set) or, with no link of its own exercise (null, or another exercise's: 1.1's swapped-in
// rows), when it sits at the same position among the exercise's heads (set-number order, warmups included: the
// ordinal "THIS WEEK ONLY" counts, weekPlanning.ts `thisWeekOnly`). It MATCHES when its whole shape still equals the
// counterpart's: kind (warmup, working, or staged with its stage kind resolved, a null kind reading as a dropset:
// DECISIONS 105's lesson, one part), rep target, and its stages (their indices and rep targets). A matched set takes
// the change; a set that differs from the old default (changed that week only) or has no counterpart is left exactly
// as it is. A default set that is added lands in a session only where the session still has the default's count.
//
// Two answers of Adam's (2026-10-15) shape what a save writes beyond the sessions' own rows:
//   - DECISIONS 142: a not-started session marked as a deload week keeps its pre-deload sets in
//     `v2_week_plans.deload_restore`, and UNMARK writes them back whole. The save applies the same landing rules to that
//     saved copy (section 15), so UNMARK restores the plan with the change in it. The op is an update of that one column
//     of that one table (043 may write nothing else of `v2_week_plans`, and no insert or delete);
//   - DECISIONS 143: what a week-dependent run's NEXT week gets. It is copied from the workout's last planned occurrence
//     (weekPlanning.ts `chooseAutoCopySource`), which may be a done or an in-progress session that no save touches. So
//     the copy takes its exercise list and order from the run copy, which the save did change (weekPlanning.ts
//     `autoCopy`): a removed exercise is left out, an added one arrives with no sets, a kept one brings its sets from
//     that occurrence and a swapped one brings the old exercise's. The run copy already says the first three. The last
//     needs the new row to say which row it replaced: a swap's new row names the old one in
//     `replaces_program_exercise_id`.
//
// Not decided here, on purpose (SPEC is silent; asked in chunk 45's report): which exercise rows a session may hold that
// the run copy doesn't list (weeks planned in 1.1 can hold a week-only row): they are never touched and keep their
// place after the rows this save orders.

import type {
  DayOfWeek,
  PlanningType,
  ProgramExercise,
  ProgramSet,
  ProgramSupersetBlock,
  RunSchedule,
  ScheduleType,
  WarmupRoutineItem,
  WeekPlanSet,
  WeeklySchedule,
  WeightUnit,
  WorkoutDay,
} from '../../types'
import type { DeloadRestoreEntry } from '../../lib/deloadRules'
import {
  columnsToRepTarget,
  formatRepTarget,
  normaliseTempo,
  resolveStageKind,
  type StageKind,
} from '../../lib/plannerVocabulary.js'
import { cascadeDeleteOrder, groupByParent } from '../gym/setGroupLogic'
import { WEEKDAYS, fullSchedule, sameSchedule, scheduleChangeRows } from './runSchedule'

// ═══ 1. The op list (migration 043's shape, defined here and consumed by chunk 47) ═══════════════════════════════
//
// `v2_apply_ops(p_ops jsonb)` takes `[{ "op": "insert", "table", "row" }, { "op": "update", "table", "id", "patch" },
// { "op": "delete", "table", "id" }]` on a fixed list of tables, in one transaction, and executes them in order. An
// insert is a full row with its own id (`user_id` is overwritten by the caller's id on the server; it is carried
// anyway); an update or delete names a row by `id`, scoped to the caller on the server, and raises when the row isn't
// found; a patch never names `id` or `user_id`. Column names are the database's (snake_case), typed per table here
// so a misspelt one is a compile error: the executor builds a row with `jsonb_populate_record`, which would drop a
// key it doesn't know without a word.

export type ProgramExerciseColumns = {
  workout_day_id: string
  exercise_id: string
  position: number
  weight_unit: WeightUnit | null
  superset_block_id: string | null
  rest_seconds: number | null
  rest_after_seconds: number | null
  tempo: string | null
  week_only: boolean
  removed_at: string | null
  // The row a swap replaced (DECISIONS 143: a week-dependent week copied after the save gives the new exercise the old one's
  // sets). Null on every row that isn't a swap's new row. Nullable column on `v2_program_exercises`, FK to itself, on delete set null.
  replaces_program_exercise_id: string | null
}
export type ProgramSetColumns = {
  program_exercise_id: string
  position: number
  is_warmup: boolean
  stage_kind: StageKind | null
  stage_rest_seconds: number | null
  parent_program_set_id: string | null
  stage_index: number
  rep_min: number | null
  rep_max: number | null
  is_amrap: boolean
  rest_seconds: number | null
  removed_at: string | null
}
export type SupersetBlockColumns = {
  workout_day_id: string
  rest_within_round_seconds: number | null
  rest_after_round_seconds: number | null
}
export type WarmupItemColumns = { workout_day_id: string; position: number; body: string }
export type WorkoutDayColumns = { name: string }
export type ProgramColumns = { schedule: WeeklySchedule }
export type RunScheduleColumns = { mesocycle_id: string; from_week: number; schedule: WeeklySchedule }
// A saved pre-deload set as `v2_week_plans.deload_restore` holds it (lib/deloadRules.ts `DeloadRestoreEntry`: no ids, grouped
// by exercise row and set number, a head has stage index 0). `targetRirMax`, the RIR range's high end, is on every copy saved
// since chunk 48 and missing on an older one, where it reads as null: a rewrite keeps the key on every entry that has it and
// gives the entries it makes the key too.
export type SavedPlanSet = DeloadRestoreEntry
// The ONE column of `v2_week_plans` an op may write, and only as an update (DECISIONS 142, Adam 2026-10-15): "043's
// executor may write v2_week_plans for that one column only, as an update only: no insert or delete on v2_week_plans, no
// other column. A patch touching any other v2_week_plans column is rejected like a protected column."
export type WeekPlanColumns = { deload_restore: SavedPlanSet[] | null }
export type WeekPlanExerciseColumns = { week_plan_id: string; program_exercise_id: string; position: number }
export type WeekPlanSetColumns = {
  week_plan_id: string
  program_exercise_id: string
  set_number: number
  target_rir: number | null
  target_rir_max: number | null
  is_dropset: boolean
  parent_week_plan_set_id: string | null
  stage_index: number
  is_warmup: boolean
  program_set_id: string | null
  stage_kind: StageKind | null
  target_weight: number | null
  rep_min: number | null
  rep_max: number | null
  is_amrap: boolean
  tags: string[] | null
}
// The two tables this module never writes but 043 lets the executor write (REVIEW's decisions, a workout's set
// changes): chunks 56 and 61 type their own rows.
type OtherColumns = Record<string, unknown>

export interface OpColumns {
  v2_program_exercises: ProgramExerciseColumns
  v2_program_sets: ProgramSetColumns
  v2_program_superset_blocks: SupersetBlockColumns
  v2_workout_warmup_items: WarmupItemColumns
  v2_workout_days: WorkoutDayColumns
  v2_programs: ProgramColumns
  v2_run_schedules: RunScheduleColumns
  v2_week_plans: WeekPlanColumns
  v2_week_plan_exercises: WeekPlanExerciseColumns
  v2_week_plan_sets: WeekPlanSetColumns
  v2_week_review_decisions: OtherColumns
  v2_session_set_changes: OtherColumns
}
export type OpTable = keyof OpColumns
// 043: "an insert into v2_programs raises" (and v2_workout_days): those two take no inserts. `v2_week_plans` takes an update
// of `deload_restore` and nothing else: no insert, no delete (DECISIONS 142).
export type InsertableTable = Exclude<OpTable, 'v2_programs' | 'v2_workout_days' | 'v2_week_plans'>
export type DeletableTable = Exclude<OpTable, 'v2_week_plans'>

// An insert row names every NOT NULL column: `jsonb_populate_record` fills a column the row leaves out with NULL, not with
// its default. Four of the tables have `created_at timestamptz not null default now()` (a patch never names it), so the
// rows for those carry it, stamped with the save's `now`. (An executor that inserts only the columns a row names takes
// the same rows; the scratch run on a replayed database showed both readings accept them.)
type WithCreatedAt<C> = C & { created_at: string }
export interface InsertColumns
  extends Omit<OpColumns, 'v2_program_sets' | 'v2_program_superset_blocks' | 'v2_run_schedules' | 'v2_week_plan_exercises'> {
  v2_program_sets: WithCreatedAt<ProgramSetColumns>
  v2_program_superset_blocks: WithCreatedAt<SupersetBlockColumns>
  v2_run_schedules: WithCreatedAt<RunScheduleColumns>
  v2_week_plan_exercises: WithCreatedAt<WeekPlanExerciseColumns>
}

export type InsertOp = {
  [T in InsertableTable]: { op: 'insert'; table: T; row: { id: string; user_id: string } & InsertColumns[T] }
}[InsertableTable]
export type UpdateOp = {
  [T in OpTable]: { op: 'update'; table: T; id: string; patch: Partial<OpColumns[T]> }
}[OpTable]
export type DeleteOp = { [T in DeletableTable]: { op: 'delete'; table: T; id: string } }[DeletableTable]
export type Op = InsertOp | UpdateOp | DeleteOp

// ═══ 2. What goes in ═════════════════════════════════════════════════════════════════════════════════════════════

export type RunChangeStatus = 'done' | 'in_progress' | 'not_started'

// A session's exercise row. The app's `WeekPlan.exercises` is a list of `ProgramExercise` and drops the id of the
// `v2_week_plan_exercises` row it came from; an op names that row by its own id, so the caller passes both (chunk
// 51a reads the id from the raw row, `DbWeekPlanExercise.id`).
export interface ChangeSessionExercise {
  weekPlanExerciseId: string
  programExerciseId: string
  position: number
}

// A planned set as the rules read it. A `WeekPlanSet` fits as it is.
export type ChangeSessionSet = Pick<
  WeekPlanSet,
  | 'id'
  | 'programExerciseId'
  | 'setNumber'
  | 'parentWeekPlanSetId'
  | 'stageIndex'
  | 'isWarmup'
  | 'stageKind'
  | 'programSetId'
  | 'repMin'
  | 'repMax'
  | 'isAmrap'
>

export interface ChangeSession {
  id: string // the week plan row (`v2_week_plans.id`)
  workoutDayId: string
  weekNumber: number // the cycle number on a sequence run
  sequencePosition?: number | null
  status: RunChangeStatus
  exercises: readonly ChangeSessionExercise[] // this session's own list
  sets: readonly ChangeSessionSet[]
  // The session's saved pre-deload plan (`v2_week_plans.deload_restore`): there when it was marked deload with rules on, null
  // or absent otherwise. UNMARK deletes the session's sets and writes this copy back whole, so a save that changes the session
  // changes the copy the same way (DECISIONS 142). A `WeekPlan.deloadRestore` fits as it is.
  deloadRestore?: readonly SavedPlanSet[] | null
}

export type RunCopyExerciseRow = Pick<
  ProgramExercise,
  | 'id'
  | 'workoutDayId'
  | 'exerciseId'
  | 'position'
  | 'weightUnit'
  | 'supersetBlockId'
  | 'restSeconds'
  | 'restAfterSeconds'
  | 'tempo'
> & { weekOnly?: boolean; removedAt?: string | null }
export type RunCopySetRow = Pick<
  ProgramSet,
  | 'id'
  | 'programExerciseId'
  | 'position'
  | 'isWarmup'
  | 'stageKind'
  | 'stageRestSeconds'
  | 'parentProgramSetId'
  | 'stageIndex'
  | 'repMin'
  | 'repMax'
  | 'isAmrap'
  | 'restSeconds'
  | 'removedAt'
>
export type RunCopyRoutineItem = Pick<WarmupRoutineItem, 'id' | 'workoutDayId' | 'position' | 'body'>

// The run's own copy as it is now (every row of it: the live ones are the program, a `week_only` or `removed_at` row
// is not part of it).
export interface ProgramChangeRunCopy {
  programId: string // the run copy's `v2_programs` row
  mesocycleId: string
  schedule: WeeklySchedule // `v2_programs.schedule`
  workouts: ReadonlyArray<Pick<WorkoutDay, 'id' | 'name' | 'position'>>
  exercises: readonly RunCopyExerciseRow[]
  sets: readonly RunCopySetRow[] // the default's sets (v2_program_sets)
  blocks: readonly ProgramSupersetBlock[]
  routine: readonly RunCopyRoutineItem[]
}

// ─── The draft ───────────────────────────────────────────────────────────────────────────────────────────────────
// What the screen edits: the run copy as it will be after SAVE, with enough provenance for the rules that need it (a
// swap is not "remove one, add one": the new exercise takes the old one's sets). The module compares it with the run
// copy and writes the difference; a draft equal to the run copy writes nothing.

// A stage of a staged default set: its rep target. `id` is the stage's program set (null = new). A stage keeps its
// stored index; a new one goes after the last.
export interface DraftStage {
  id: string | null
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
}
// A head of the default: kind, rep target, rest after, and the rest between its stages. `id` is its program set (null
// = new). `stageKind` is the kind a staged head has (null reads as a dropset); a head with no stages is not staged.
export interface DraftSet {
  id: string | null
  isWarmup: boolean
  stageKind: StageKind | null
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  restSeconds: number | null
  stageRestSeconds: number | null
  stages: readonly DraftStage[]
}
interface DraftExerciseFields {
  supersetBlockId: string | null // an existing block's id, or the key of a block in `ProgramEdit.blocks`
  restSeconds: number | null
  restAfterSeconds: number | null
  tempo: string | null
  weightUnit: WeightUnit | null
  // Stable runs only: the default's sets for this exercise, in order. A week-dependent run "holds no sets": ignored.
  // Missing on an added exercise = no default sets; missing on a swapped one = the old exercise's sets, as they are.
  sets?: readonly DraftSet[]
}
export type DraftExercise =
  | ({ kind: 'kept'; id: string } & DraftExerciseFields) // a row of the run copy
  | ({ kind: 'swapped'; replaces: string; exerciseId: string } & DraftExerciseFields) // the new exercise in the row it replaces
  | ({ kind: 'added'; exerciseId: string } & DraftExerciseFields)
export interface DraftRoutineItem {
  id: string | null // null = a new item
  body: string
}
export interface DraftWorkout {
  id: string
  name: string
  exercises: readonly DraftExercise[] // in order; a run-copy exercise that is not listed is removed
  routine: readonly DraftRoutineItem[] // in order
}
export interface DraftBlock {
  id: string // an existing block's id, or a key of the draft's own for a new one
  restWithinRoundSeconds: number | null
  restAfterRoundSeconds: number | null
}
export interface ProgramEdit {
  workouts: readonly DraftWorkout[] // every workout of the run, once (a workout is never added or removed here)
  blocks: readonly DraftBlock[]
  schedule: WeeklySchedule // the weekdays after the edit (weekday runs)
}

export interface ProgramChangeInput {
  userId: string // carried on every inserted row
  now: string // an ISO timestamp: the `removed_at` of a soft removal, the `created_at` of an inserted row that has one
  newId: () => string // the client-generated ids of inserted rows (draws in a fixed order)
  planningType: PlanningType
  scheduleType: ScheduleType
  currentWeek: number // the run's current week (cycle): a whole number from 1
  runCopy: ProgramChangeRunCopy
  scheduleRows: ReadonlyArray<Pick<RunSchedule, 'id' | 'fromWeek' | 'schedule'>> // `v2_run_schedules` of the run
  sessions: readonly ChangeSession[] // every plan row of the run from the current week on
  edit: ProgramEdit
}

// ═══ 3. What comes out ═══════════════════════════════════════════════════════════════════════════════════════════

export interface SessionRef {
  weekPlanId: string
  weekNumber: number
  workoutDayId: string
  sequencePosition: number | null
}

export interface ProgramChangeSummary {
  // "Week N" of the rule box: the week of the first session that hasn't started (changeStartWeek).
  startWeek: number
  // The week the new days start (currentWeek + 1), when a weekday run's days change; null otherwise.
  scheduleStartWeek: number | null
  // Sessions that get at least one op, in the order their ops come.
  changedSessions: SessionRef[]
  // Sessions of the workouts this save changed the exercises or default sets of that it leaves exactly as they are
  // because they are done or in progress.
  keptSessions: Array<SessionRef & { status: 'done' | 'in_progress' }>
  // Default-set changes a not-started session did not take because its set differs from the old default (changed
  // for that week only), is missing, or the session's count is no longer the default's.
  setsLeftAlone: number
}

export interface ProgramChangePlan {
  ops: Op[]
  summary: ProgramChangeSummary
}

// ═══ 4. Statuses and the week the changes start ══════════════════════════════════════════════════════════════════

// A plan row's status from the statuses of its sessions (`v2_sessions.status`; none yet = not started). One plan row
// can have several sessions (G14: one workout on two weekdays shares it), and the row is done as soon as one of them is
// done (#77: "a shared G14 row locks for every weekday sharing it"), in progress when one is (and none done), and
// not started otherwise: a `planned` session (moved here, not started) and no session at all included.
export function planRowStatus(sessionStatuses: ReadonlyArray<'planned' | 'in_progress' | 'completed' | 'skipped'>): RunChangeStatus {
  if (sessionStatuses.some((s) => s === 'completed' || s === 'skipped')) return 'done'
  if (sessionStatuses.some((s) => s === 'in_progress')) return 'in_progress'
  return 'not_started'
}

function assertCurrentWeek(name: string, currentWeek: number): void {
  if (!Number.isInteger(currentWeek) || currentWeek < 1) {
    throw new RangeError(`${name}: the current week must be a whole number from 1 (got ${currentWeek})`)
  }
}

// "Week N" in the rule box: SPEC says "the week of the next session that isn't done", and "'not done' means not
// started". So it is the week of the first session from the current week on that hasn't started: that is where the
// changes start landing. With none (everything from here on is done or in progress), the week after the last one
// there is: the next week to be planned copies the changed run copy. The summary's `startWeek`.
export function changeStartWeek(sessions: ReadonlyArray<Pick<ChangeSession, 'weekNumber' | 'status'>>, currentWeek: number): number {
  assertCurrentWeek('changeStartWeek', currentWeek)
  let first: number | null = null
  let last = currentWeek
  for (const s of sessions) {
    if (s.weekNumber < currentWeek) continue
    if (s.weekNumber > last) last = s.weekNumber
    if (s.status === 'not_started' && (first === null || s.weekNumber < first)) first = s.weekNumber
  }
  return first ?? last + 1
}

// ═══ 5. The texts and the day toggle ═════════════════════════════════════════════════════════════════════════════
// SPEC, Programs and runs: the rule box says "Changes start in week N. Sets are planned in each week, in Plan." (week-
// dependent) or "Changes start in week N. Every week from then on copies this." (stable), and under it "which done
// session keeps its plan, and that the saved program doesn't change" (board PL1: "Monday's Push 1 is done, so it keeps
// its plan. Your saved program, Push Pull Legs, doesn't change."). The wording for a sequence run ("the cycle replaces
// the week everywhere"), for several kept sessions and for a session in progress is not on a board: display choices
// under D31, provisional.

const DAY_NAMES: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}
const DAY_SHORT: Record<DayOfWeek, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
}

// A session the sentence names: its workout, the weekday it is on (a weekday run: the day its session was for; none
// on a sequence run), and why it keeps its plan.
export interface KeptSession {
  workoutName: string
  weekday?: DayOfWeek | null
  status: 'done' | 'in_progress'
}

function nameKept(s: KeptSession): string {
  return s.weekday ? `${DAY_NAMES[s.weekday]}'s ${s.workoutName}` : s.workoutName
}
function andList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export interface RuleBoxText {
  headline: string
  detail: string
}

export function ruleBoxText(input: {
  planningType: PlanningType
  scheduleType: ScheduleType
  startWeek: number
  programName: string // the saved program's name: "Your saved program, [name], doesn't change."
  kept: readonly KeptSession[]
}): RuleBoxText {
  const unit = input.scheduleType === 'sequence' ? 'cycle' : 'week'
  const headline =
    input.planningType === 'stable'
      ? `Changes start in ${unit} ${input.startWeek}. Every ${unit} from then on copies this.`
      : `Changes start in ${unit} ${input.startWeek}. Sets are planned in each ${unit}, in Plan.`

  const sentences: string[] = []
  const done = input.kept.filter((k) => k.status === 'done')
  const inProgress = input.kept.filter((k) => k.status === 'in_progress')
  if (done.length > 0) {
    sentences.push(
      done.length === 1
        ? `${nameKept(done[0])} is done, so it keeps its plan.`
        : `${andList(done.map(nameKept))} are done, so they keep their plans.`,
    )
  }
  if (inProgress.length > 0) {
    sentences.push(
      inProgress.length === 1
        ? `${nameKept(inProgress[0])} is in progress, so it stays as it is.`
        : `${andList(inProgress.map(nameKept))} are in progress, so they stay as they are.`,
    )
  }
  sentences.push(`Your saved program, ${input.programName}, doesn't change.`)
  return { headline, detail: sentences.join(' ') }
}

// The days a workout is on, in week order, from a weekday map.
export function daysOfWorkout(schedule: Partial<WeeklySchedule>, workoutId: string): DayOfWeek[] {
  return WEEKDAYS.filter((day) => schedule[day] === workoutId)
}

// The DAYS card's line under the toggles (board PL1: "Was Tuesday. New days start in week 3. This week Pull 1 stays
// on Tuesday; MOVE THIS SESSION in Plan moves just this week."). `oldDays` are the days in force this week, `newDays`
// the draft's. Nothing when they are the same. A workout with no day before has no "Was" and no "stays on".
export function daysCardText(input: {
  workoutName: string
  oldDays: readonly DayOfWeek[]
  newDays: readonly DayOfWeek[]
  startWeek: number // currentWeek + 1
}): string | null {
  const same = input.oldDays.length === input.newDays.length && input.oldDays.every((d) => input.newDays.includes(d))
  if (same) return null
  const was = andList(input.oldDays.map((d) => DAY_NAMES[d]))
  const parts: string[] = []
  if (input.oldDays.length > 0) parts.push(`Was ${was}.`)
  parts.push(`New days start in week ${input.startWeek}.`)
  if (input.oldDays.length > 0) {
    parts.push(`This week ${input.workoutName} stays on ${was}; MOVE THIS SESSION in Plan moves just this week.`)
  } else {
    parts.push('MOVE THIS SESSION in Plan moves just this week.')
  }
  return parts.join(' ')
}

// SPEC, Defaults 2: "a day another workout already uses can't be picked: the toggle is disabled and the card says whose
// day it is ('Thu is Push 2's day')".
export function dayTakenText(day: DayOfWeek, workoutName: string): string {
  return `${DAY_SHORT[day]} is ${workoutName}'s day`
}

export type DaysValidation =
  | { ok: true; schedule: WeeklySchedule }
  | { ok: false; reason: 'taken'; day: DayOfWeek; takenBy: string } // another workout is on that day: its id
  | { ok: false; reason: 'no_days' } // "a workout needs at least one day"

// The weekday map after putting `workoutId` on exactly `days`, or why it can't be (SPEC, Defaults 2): a day another
// workout is on is refused (the first such day in week order is named), and so is no day at all. Days the workout
// leaves go empty; every other workout keeps its days. A day the workout is already on is its own, not taken.
export function validateDays(input: {
  schedule: Partial<WeeklySchedule> // the weekday map before this change
  workoutId: string
  days: readonly DayOfWeek[]
}): DaysValidation {
  const { schedule, workoutId, days } = input
  if (days.length === 0) return { ok: false, reason: 'no_days' }
  const wanted = new Set(days)
  for (const day of WEEKDAYS) {
    if (!wanted.has(day)) continue
    const holder = schedule[day] ?? null
    if (holder !== null && holder !== workoutId) return { ok: false, reason: 'taken', day, takenBy: holder }
  }
  const next = fullSchedule(schedule)
  for (const day of WEEKDAYS) {
    if (next[day] === workoutId) next[day] = null
    if (wanted.has(day)) next[day] = workoutId
  }
  return { ok: true, schedule: next }
}

// ═══ 6. Shapes: what a set is, as far as the rules compare it ════════════════════════════════════════════════════
// The comparison weekPlanning.ts's `thisWeekOnly` makes (chunk 42), written once more for heads one at a time (a
// test runs both on the same fixtures, so they can't drift): kind, rep target, and the stages' indices and rep
// targets. Weight, RIR and cues never count: the default holds none.

interface ShapeStage {
  stageIndex: number
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
}
interface HeadShape {
  isWarmup: boolean
  stageKind: StageKind | null
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  stages: readonly ShapeStage[]
}

type RepFields = { repMin?: number | null; repMax?: number | null; isAmrap?: boolean }

// A rep target as its row shows it: 8 to 8 is "8", a half-filled pair is none.
function repsKey(s: RepFields): string {
  return formatRepTarget(columnsToRepTarget({ repMin: s.repMin ?? null, repMax: s.repMax ?? null, isAmrap: s.isAmrap ?? false }))
}

// DECISIONS 105: a head's kind is ONE part, resolved: warmup, working, or staged with the stage kind (a null kind on a
// head that has stages reads as a dropset). A stage kind on a head with no stages shows nowhere, so it isn't a kind.
function kindKey(h: Pick<HeadShape, 'isWarmup' | 'stageKind' | 'stages'>): string {
  if (h.isWarmup) return 'warmup'
  if (h.stages.length > 0) return `staged:${resolveStageKind(h.stageKind)}`
  return 'working'
}

function shapeKey(h: HeadShape): string {
  return [kindKey(h), repsKey(h), ...h.stages.map((st) => `${st.stageIndex}:${repsKey(st)}`)].join('|')
}

// The stage kind a head is stored with: the resolved kind when it has stages, else none (a warmup is never staged).
function effectiveStageKind(h: Pick<HeadShape, 'isWarmup' | 'stageKind' | 'stages'>): StageKind | null {
  return !h.isWarmup && h.stages.length > 0 ? resolveStageKind(h.stageKind) : null
}

// The three rep-target columns of a rep target as the row shows it.
function repColumns(s: RepFields): { rep_min: number | null; rep_max: number | null; is_amrap: boolean } {
  const t = columnsToRepTarget({ repMin: s.repMin ?? null, repMax: s.repMax ?? null, isAmrap: s.isAmrap ?? false })
  switch (t.type) {
    case 'number':
      return { rep_min: t.value, rep_max: t.value, is_amrap: false }
    case 'range':
      return { rep_min: t.min, rep_max: t.max, is_amrap: false }
    case 'amrap':
      return { rep_min: null, rep_max: null, is_amrap: true }
    case 'none':
      return { rep_min: null, rep_max: null, is_amrap: false }
  }
}

interface OldHead extends HeadShape {
  id: string
  position: number
  row: RunCopySetRow
  stageRows: RunCopySetRow[] // live stage rows in stage order
}

// One exercise's live default: heads in position order, each with its live stages in stage order. (A set the default
// dropped, `removedAt`, is not part of it; a stage whose head isn't live is ignored.)
function oldHeadsOf(sets: readonly RunCopySetRow[]): OldHead[] {
  const live = sets.filter((s) => !s.removedAt)
  return groupByParent(
    live,
    (s) => s.id,
    (s) => s.parentProgramSetId,
    (s) => s.stageIndex,
  )
    .sort((a, b) => a.head.position - b.head.position)
    .map((g) => ({
      id: g.head.id,
      position: g.head.position,
      row: g.head,
      stageRows: g.stages,
      isWarmup: g.head.isWarmup,
      stageKind: g.head.stageKind,
      repMin: g.head.repMin,
      repMax: g.head.repMax,
      isAmrap: g.head.isAmrap,
      stages: g.stages.map((s) => ({ stageIndex: s.stageIndex, repMin: s.repMin, repMax: s.repMax, isAmrap: s.isAmrap })),
    }))
}

interface SessionHead extends HeadShape {
  row: ChangeSessionSet
  stageRows: ChangeSessionSet[] // in stage order
}

// One exercise's planned sets in a session as heads in set-number order (warmups included: the ordinal "THIS WEEK ONLY"
// counts) with their stages.
function sessionHeadsOf(sets: readonly ChangeSessionSet[], exerciseId: string): SessionHead[] {
  return groupByParent(
    sets.filter((s) => s.programExerciseId === exerciseId),
    (s) => s.id,
    (s) => s.parentWeekPlanSetId,
    (s) => s.stageIndex,
  )
    .sort((a, b) => a.head.setNumber - b.head.setNumber)
    .map((g) => ({
      row: g.head,
      stageRows: g.stages,
      isWarmup: g.head.isWarmup,
      stageKind: g.head.stageKind ?? null,
      repMin: g.head.repMin ?? null,
      repMax: g.head.repMax ?? null,
      isAmrap: g.head.isAmrap ?? false,
      stages: g.stages.map((s) => ({
        stageIndex: s.stageIndex ?? 0,
        repMin: s.repMin ?? null,
        repMax: s.repMax ?? null,
        isAmrap: s.isAmrap ?? false,
      })),
    }))
}

// ═══ 7. The identity draft ═══════════════════════════════════════════════════════════════════════════════════════

function liveExercisesOf(runCopy: ProgramChangeRunCopy, workoutId: string): RunCopyExerciseRow[] {
  // Array.prototype.sort is stable: rows with equal positions keep the order they came in.
  return runCopy.exercises
    .filter((e) => e.workoutDayId === workoutId && !e.weekOnly && !e.removedAt)
    .sort((a, b) => a.position - b.position)
}

function oldHeadsOfExercise(runCopy: ProgramChangeRunCopy, exerciseRowId: string): OldHead[] {
  return oldHeadsOf(runCopy.sets.filter((s) => s.programExerciseId === exerciseRowId))
}

function draftOfOldHeads(heads: readonly OldHead[]): DraftSet[] {
  return heads.map((h) => ({
    id: h.id,
    isWarmup: h.isWarmup,
    stageKind: h.stageKind,
    repMin: h.repMin,
    repMax: h.repMax,
    isAmrap: h.isAmrap,
    restSeconds: h.row.restSeconds,
    stageRestSeconds: h.row.stageRestSeconds,
    stages: h.stageRows.map((s) => ({ id: s.id, repMin: s.repMin, repMax: s.repMax, isAmrap: s.isAmrap })),
  }))
}

// The run as it is, as a draft: nothing changed, so saving it writes nothing. A screen starts from it and edits it.
export function draftFromRunCopy(runCopy: ProgramChangeRunCopy, planningType: PlanningType): ProgramEdit {
  const workouts = [...runCopy.workouts].sort((a, b) => a.position - b.position)
  return {
    workouts: workouts.map((w) => ({
      id: w.id,
      name: w.name,
      exercises: liveExercisesOf(runCopy, w.id).map((e): DraftExercise => {
        const base = {
          kind: 'kept' as const,
          id: e.id,
          supersetBlockId: e.supersetBlockId ?? null,
          restSeconds: e.restSeconds ?? null,
          restAfterSeconds: e.restAfterSeconds ?? null,
          tempo: e.tempo ?? null,
          weightUnit: e.weightUnit ?? null,
        }
        return planningType === 'stable' ? { ...base, sets: draftOfOldHeads(oldHeadsOfExercise(runCopy, e.id)) } : base
      }),
      routine: runCopy.routine
        .filter((r) => r.workoutDayId === w.id)
        .sort((a, b) => a.position - b.position)
        .map((r) => ({ id: r.id, body: r.body })),
    })),
    blocks: runCopy.blocks.map((b) => ({
      id: b.id,
      restWithinRoundSeconds: b.restWithinRoundSeconds,
      restAfterRoundSeconds: b.restAfterRoundSeconds,
    })),
    schedule: fullSchedule(runCopy.schedule),
  }
}

// Where a list of rows ends up when some are kept (they have a position already) and some are new (`null`). The kept
// rows keep their positions when they are in increasing order and every new row comes after them (new ones go after
// the last, one after another): the usual add, remove and rename change nothing else. Otherwise (a row moved, a tie, a
// new row among the old) the list is numbered from `base` in order. So a draft that changes nothing writes nothing, and
// a list is only ever renumbered when its order says it must be.
function placeInOrder(old: ReadonlyArray<number | null>, base: number): number[] {
  let last = -Infinity
  let sawNew = false
  for (const p of old) {
    if (p === null) {
      sawNew = true
    } else if (sawNew || p <= last) {
      return old.map((_, i) => base + i)
    } else {
      last = p
    }
  }
  let next = last === -Infinity ? base : last + 1
  return old.map((p) => (p !== null ? p : next++))
}

// ═══ 8. The final default of an exercise ═════════════════════════════════════════════════════════════════════════
// The draft's sets for one exercise, resolved against the old default: which old set each came from (by id), the
// program-set id each ends up with, and the positions and stage indices it gets.

interface FinalStage extends ShapeStage {
  programSetId: string
  source: RunCopySetRow | null // the old stage row it is, null when new
}
interface FinalHead extends HeadShape {
  programSetId: string
  position: number // 1-based
  source: OldHead | null // the old head it is, null when new
  draft: DraftSet
  finalStages: FinalStage[]
}

function assertRepTarget(where: string, t: RepFields): void {
  const min = t.repMin ?? null
  const max = t.repMax ?? null
  const amrap = t.isAmrap ?? false
  if (amrap && (min !== null || max !== null)) throw new RangeError(`${where}: an AMRAP rep target carries no numbers`)
  if (min !== null && (!Number.isInteger(min) || min < 1)) throw new RangeError(`${where}: the rep target's low end must be a whole number from 1`)
  if (max !== null && (min === null || !Number.isInteger(max) || max < min)) {
    throw new RangeError(`${where}: the rep target's high end needs a low end and can't be below it`)
  }
}

function assertRest(where: string, seconds: number | null): void {
  if (seconds !== null && (!Number.isInteger(seconds) || seconds < 0)) {
    throw new RangeError(`${where}: a rest is whole seconds from 0 (got ${seconds})`)
  }
}

// `fresh` = every row is a new program set (an added or swapped exercise: its default starts as new rows); otherwise a
// set the draft names by id is the old row, and only a set it doesn't know gets a new id. Ids are drawn heads first,
// each followed by its stages.
function resolveFinalHeads(
  where: string,
  drafts: readonly DraftSet[],
  oldHeads: readonly OldHead[],
  fresh: boolean,
  newId: () => string,
): FinalHead[] {
  const byId = new Map(oldHeads.map((h) => [h.id, h]))
  const seen = new Set<string>()
  // A head keeps its position unless the draft's order says the list must be renumbered (placeInOrder); every row of a
  // fresh default is new.
  const positions = placeInOrder(
    drafts.map((d) => (fresh || d.id === null ? null : byId.get(d.id)?.position ?? null)),
    1,
  )
  return drafts.map((d, i): FinalHead => {
    const here = `${where}, set ${i + 1}`
    let source: OldHead | null = null
    if (d.id !== null) {
      source = byId.get(d.id) ?? null
      if (source === null) throw new RangeError(`${here}: set ${d.id} is not a set of this exercise's default`)
      if (seen.has(d.id)) throw new RangeError(`${here}: set ${d.id} is listed twice`)
      seen.add(d.id)
    }
    assertRepTarget(here, d)
    assertRest(here, d.restSeconds)
    assertRest(here, d.stageRestSeconds)
    if (d.isWarmup && d.stages.length > 0) throw new RangeError(`${here}: a warmup can never be staged`)

    const programSetId = fresh || source === null ? newId() : source.id
    // Stages keep the index they have; a new stage goes after the highest one.
    const oldStages = new Map((source?.stageRows ?? []).map((s) => [s.id, s]))
    let next = 0
    for (const st of d.stages) if (st.id !== null) next = Math.max(next, oldStages.get(st.id)?.stageIndex ?? 0)
    const seenStages = new Set<string>()
    const finalStages = d.stages.map((st, j): FinalStage => {
      assertRepTarget(`${here}, stage ${j + 1}`, st)
      let stageSource: RunCopySetRow | null = null
      if (st.id !== null) {
        stageSource = oldStages.get(st.id) ?? null
        if (stageSource === null) throw new RangeError(`${here}: stage ${st.id} is not a stage of this set`)
        if (seenStages.has(st.id)) throw new RangeError(`${here}: stage ${st.id} is listed twice`)
        seenStages.add(st.id)
      }
      const stageIndex = stageSource !== null ? stageSource.stageIndex : ++next
      return {
        programSetId: fresh || stageSource === null ? newId() : stageSource.id,
        source: stageSource,
        stageIndex,
        repMin: st.repMin,
        repMax: st.repMax,
        isAmrap: st.isAmrap,
      }
    })
    return {
      programSetId,
      position: positions[i],
      source,
      draft: d,
      finalStages,
      isWarmup: d.isWarmup,
      stageKind: d.stageKind,
      repMin: d.repMin,
      repMax: d.repMax,
      isAmrap: d.isAmrap,
      stages: finalStages,
    }
  })
}

// ═══ 9. Building the op list ═════════════════════════════════════════════════════════════════════════════════════

// Updates to one row become one op (the patches merge, the first place is kept); a row deleted in the same list has no
// update. Inserts keep the order they are made in. Ops come out as inserts, then updates, then deletes.
class Rows {
  readonly inserts: Op[] = []
  private readonly updates = new Map<string, UpdateOp>()
  readonly deletes: Op[] = []

  insert<T extends InsertableTable>(table: T, row: { id: string; user_id: string } & InsertColumns[T]): void {
    this.inserts.push({ op: 'insert', table, row } as Op)
  }

  update<T extends OpTable>(table: T, id: string, patch: Partial<OpColumns[T]>): void {
    if (Object.keys(patch).length === 0) return
    const key = `${table}/${id}`
    const have = this.updates.get(key)
    if (have) {
      have.patch = { ...(have.patch as object), ...(patch as object) } as typeof have.patch
    } else {
      this.updates.set(key, { op: 'update', table, id, patch } as UpdateOp)
    }
  }

  remove<T extends DeletableTable>(table: T, id: string): void {
    this.updates.delete(`${table}/${id}`)
    this.deletes.push({ op: 'delete', table, id } as Op)
  }

  get updateOps(): UpdateOp[] {
    return [...this.updates.values()]
  }

  get empty(): boolean {
    return this.inserts.length === 0 && this.updates.size === 0 && this.deletes.length === 0
  }

  ops(): Op[] {
    return [...this.inserts, ...this.updateOps, ...this.deletes]
  }
}

// ═══ 10. The save ════════════════════════════════════════════════════════════════════════════════════════════════

// One exercise of a workout after the save, against the run copy as it was.
interface PlannedEntry {
  entry: DraftExercise
  oldRow: RunCopyExerciseRow | null // kept: the row; swapped: the row it replaces; added: null
  newId: string // the row after the save (kept: the row's own id)
  exerciseId: string
  position: number // its position after the save (0-based, as the app numbers them)
  // Stable only: the default's heads before and after.
  oldHeads: OldHead[]
  finalHeads: FinalHead[]
  // Every program-set id the old row ever had (live or dropped): a session set naming one of them has a link of its own.
  ownProgramSetIds: Set<string>
}

interface WorkoutPlan {
  workoutId: string
  entries: PlannedEntry[]
  removed: RunCopyExerciseRow[] // live rows the draft doesn't list
  listChanged: boolean // an exercise was added, removed or swapped, or the order changed
  reordered: boolean // the exercises that stay (a swap's slot included) are in another order than the run copy had them in
  shapeChanged: boolean // a kept stable exercise's default sets changed in count, kind, stages or rep target
}

function sessionRef(s: ChangeSession): SessionRef {
  return { weekPlanId: s.id, weekNumber: s.weekNumber, workoutDayId: s.workoutDayId, sequencePosition: s.sequencePosition ?? null }
}

function workoutOrder(workouts: ReadonlyArray<{ id: string }>, id: string): number {
  const i = workouts.findIndex((w) => w.id === id)
  return i < 0 ? workouts.length : i
}

function trimmedName(where: string, text: string): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new RangeError(`${where}: can't be blank`)
  return trimmed
}

// What a kept stable exercise's default does to the sessions: a set dropped, a set added, or a kept set whose kind, rep
// target or stages changed. (Rest after, rest between stages and positions are run-wide: no session row changes.)
function entryShapeChanged(p: PlannedEntry): boolean {
  if (p.entry.kind !== 'kept') return false
  if (p.oldHeads.length !== p.finalHeads.length) return true
  return p.finalHeads.some((f, i) => f.source !== p.oldHeads[i] || shapeKey(f) !== shapeKey(p.oldHeads[i]))
}

export function planProgramChange(input: ProgramChangeInput): ProgramChangePlan {
  const { userId, now, newId, planningType, scheduleType, currentWeek, runCopy, edit } = input
  assertCurrentWeek('planProgramChange', currentWeek)
  const stable = planningType === 'stable'

  // ── The run's workouts, in order, and the draft's
  const workouts = [...runCopy.workouts].sort((a, b) => a.position - b.position)
  const draftById = new Map<string, DraftWorkout>()
  for (const dw of edit.workouts) {
    if (draftById.has(dw.id)) throw new RangeError(`the draft lists workout ${dw.id} twice`)
    draftById.set(dw.id, dw)
  }
  if (draftById.size !== workouts.length || workouts.some((w) => !draftById.has(w.id))) {
    throw new RangeError("the draft's workouts must be the run's workouts, each once: a workout is never added or removed here")
  }

  const runBlocks = new Map(runCopy.blocks.map((b) => [b.id, b]))
  const draftBlocks = new Map<string, DraftBlock>()
  for (const b of edit.blocks) {
    if (draftBlocks.has(b.id)) throw new RangeError(`the draft lists superset block ${b.id} twice`)
    assertRest(`superset block ${b.id}`, b.restWithinRoundSeconds)
    assertRest(`superset block ${b.id}`, b.restAfterRoundSeconds)
    draftBlocks.set(b.id, b)
  }

  // ── Validate every workout's list before anything is written
  const live = new Map<string, RunCopyExerciseRow[]>()
  const referencedBlocks = new Map<string, string>() // block key → the workout it is used in
  for (const w of workouts) {
    live.set(w.id, liveExercisesOf(runCopy, w.id))
    const dw = draftById.get(w.id)!
    trimmedName(`workout ${w.id}'s name`, dw.name)
    const liveIds = new Set(live.get(w.id)!.map((e) => e.id))
    const used = new Set<string>()
    const claim = (id: string, what: string) => {
      if (!liveIds.has(id)) throw new RangeError(`workout ${w.id}: ${what} ${id} is not one of its exercises`)
      if (used.has(id)) throw new RangeError(`workout ${w.id}: exercise ${id} is used twice in the draft`)
      used.add(id)
    }
    dw.exercises.forEach((e, i) => {
      const where = `workout ${w.id}, exercise ${i + 1}`
      if (e.kind === 'kept') claim(e.id, 'exercise')
      else if (e.kind === 'swapped') claim(e.replaces, 'the exercise it replaces,')
      if (e.kind !== 'kept' && e.exerciseId.length === 0) throw new RangeError(`${where}: no exercise given`)
      assertRest(where, e.restSeconds)
      assertRest(where, e.restAfterSeconds)
      if (e.tempo !== null && normaliseTempo(e.tempo) !== e.tempo) {
        throw new RangeError(`${where}: tempo "${e.tempo}" is not a tempo (4 fields, X allowed)`)
      }
      if (e.supersetBlockId !== null) {
        if (!draftBlocks.has(e.supersetBlockId)) throw new RangeError(`${where}: superset block ${e.supersetBlockId} is not in the draft`)
        const elsewhere = referencedBlocks.get(e.supersetBlockId)
        if (elsewhere !== undefined && elsewhere !== w.id) throw new RangeError(`superset block ${e.supersetBlockId} is used in two workouts`)
        referencedBlocks.set(e.supersetBlockId, w.id)
      }
    })
    // "Every reorder moves a superset as one block": a block's members are neighbours.
    const closed = new Set<string>()
    let open: string | null = null
    for (const e of dw.exercises) {
      const b = e.supersetBlockId
      if (b === open) continue
      if (open !== null) closed.add(open)
      if (b !== null && closed.has(b)) throw new RangeError(`workout ${w.id}: the members of superset block ${b} are not next to each other`)
      open = b
    }
    const routineIds = new Set(runCopy.routine.filter((r) => r.workoutDayId === w.id).map((r) => r.id))
    const usedItems = new Set<string>()
    for (const item of dw.routine) {
      trimmedName(`workout ${w.id}'s warmup item`, item.body)
      if (item.id === null) continue
      if (!routineIds.has(item.id)) throw new RangeError(`workout ${w.id}: warmup item ${item.id} is not one of its items`)
      if (usedItems.has(item.id)) throw new RangeError(`workout ${w.id}: warmup item ${item.id} is listed twice`)
      usedItems.add(item.id)
    }
  }

  const run = new Rows() // the run copy's rows

  // ── Superset blocks (inserted before the exercises that name them)
  const blockRealId = new Map<string, string>() // draft block key → the row's id
  for (const b of edit.blocks) {
    const old = runBlocks.get(b.id)
    if (old) {
      blockRealId.set(b.id, b.id)
      const patch: Partial<SupersetBlockColumns> = {}
      if (old.restWithinRoundSeconds !== b.restWithinRoundSeconds) patch.rest_within_round_seconds = b.restWithinRoundSeconds
      if (old.restAfterRoundSeconds !== b.restAfterRoundSeconds) patch.rest_after_round_seconds = b.restAfterRoundSeconds
      run.update('v2_program_superset_blocks', b.id, patch)
    } else if (referencedBlocks.has(b.id)) {
      const id = newId()
      blockRealId.set(b.id, id)
      run.insert('v2_program_superset_blocks', {
        id,
        user_id: userId,
        workout_day_id: referencedBlocks.get(b.id)!,
        rest_within_round_seconds: b.restWithinRoundSeconds,
        rest_after_round_seconds: b.restAfterRoundSeconds,
        created_at: now,
      })
    }
  }
  const blockOf = (e: DraftExercise): string | null => (e.supersetBlockId === null ? null : blockRealId.get(e.supersetBlockId) ?? null)

  // ── Each workout: its exercises, the run copy's rows and the default's sets
  const plans: WorkoutPlan[] = []
  for (const w of workouts) {
    const dw = draftById.get(w.id)!
    const liveRows = live.get(w.id)!
    const rowById = new Map(liveRows.map((e) => [e.id, e]))
    const entries: PlannedEntry[] = []
    const listed = new Set<string>()

    dw.exercises.forEach((entry, index) => {
      const where = `workout ${w.id}, exercise ${index + 1}`
      const oldRow = entry.kind === 'kept' ? rowById.get(entry.id)! : entry.kind === 'swapped' ? rowById.get(entry.replaces)! : null
      if (oldRow) listed.add(oldRow.id)
      const rowId = entry.kind === 'kept' ? entry.id : newId()
      let oldHeads: OldHead[] = []
      let finalHeads: FinalHead[] = []
      if (stable) {
        oldHeads = oldRow ? oldHeadsOfExercise(runCopy, oldRow.id) : []
        // A swapped exercise without sets of its own in the draft takes the old one's as they are; a kept one leaves its
        // default alone; an added one has none.
        const drafts = entry.sets ?? (entry.kind === 'added' ? [] : draftOfOldHeads(oldHeads))
        finalHeads = resolveFinalHeads(where, drafts, oldHeads, entry.kind !== 'kept', newId)
      }
      entries.push({
        entry,
        oldRow,
        newId: rowId,
        exerciseId: entry.kind === 'kept' ? oldRow!.exerciseId : entry.exerciseId,
        position: index, // the draft's order; the numbers are placed below
        oldHeads,
        finalHeads,
        ownProgramSetIds: new Set(oldRow ? runCopy.sets.filter((s) => s.programExerciseId === oldRow.id).map((s) => s.id) : []),
      })
    })

    const removed = liveRows.filter((e) => !listed.has(e.id))
    // Whether the draft moves an exercise: the rows that stay (a swap holds its old row's place), in the draft's order,
    // against the run copy's order of the same rows.
    const slots = entries.filter((p) => p.oldRow).map((p) => p.oldRow!.id)
    const before = liveRows.map((e) => e.id).filter((id) => listed.has(id))
    const reordered = slots.some((id, i) => id !== before[i])
    const listChanged = removed.length > 0 || entries.some((p) => p.entry.kind !== 'kept') || reordered
    plans.push({ workoutId: w.id, entries, removed, listChanged, reordered, shapeChanged: stable && entries.some(entryShapeChanged) })
    // Positions: a swapped exercise's new row takes the old row's place; the others keep theirs unless the order says the
    // list must be renumbered (placeInOrder). A list nobody changed is never touched.
    if (listChanged) {
      const at = placeInOrder(entries.map((p) => (p.oldRow ? p.oldRow.position : null)), 0)
      entries.forEach((p, i) => (p.position = at[i]))
    }

    // ── The run copy's rows for this workout
    for (const p of entries) {
      const e = p.entry
      if (e.kind === 'kept') {
        const row = p.oldRow!
        const patch: Partial<ProgramExerciseColumns> = {}
        if (listChanged && row.position !== p.position) patch.position = p.position
        if (e.weightUnit !== (row.weightUnit ?? null)) patch.weight_unit = e.weightUnit
        if (blockOf(e) !== (row.supersetBlockId ?? null)) patch.superset_block_id = blockOf(e)
        if (e.restSeconds !== (row.restSeconds ?? null)) patch.rest_seconds = e.restSeconds
        if (e.restAfterSeconds !== (row.restAfterSeconds ?? null)) patch.rest_after_seconds = e.restAfterSeconds
        if (e.tempo !== (row.tempo ?? null)) patch.tempo = e.tempo
        run.update('v2_program_exercises', row.id, patch)
        if (stable) writeDefaultSets(run, userId, now, p)
      } else {
        run.insert('v2_program_exercises', {
          id: p.newId,
          user_id: userId,
          workout_day_id: w.id,
          exercise_id: p.exerciseId,
          position: p.position,
          weight_unit: e.weightUnit,
          superset_block_id: blockOf(e),
          rest_seconds: e.restSeconds,
          rest_after_seconds: e.restAfterSeconds,
          tempo: e.tempo,
          week_only: false,
          removed_at: null,
          replaces_program_exercise_id: e.kind === 'swapped' ? p.oldRow!.id : null,
        })
        if (stable) insertDefaultSets(run, userId, now, p)
        if (e.kind === 'swapped') run.update('v2_program_exercises', p.oldRow!.id, { removed_at: now })
      }
    }
    for (const row of removed) run.update('v2_program_exercises', row.id, { removed_at: now })

    const wname = trimmedName(`workout ${w.id}'s name`, dw.name)
    if (wname !== w.name) run.update('v2_workout_days', w.id, { name: wname })
  }

  // ── The warmup routine
  const routineOps: Op[] = []
  for (const w of workouts) {
    routineOps.push(
      ...planRoutine(userId, newId, w.id, runCopy.routine.filter((r) => r.workoutDayId === w.id), draftById.get(w.id)!.routine),
    )
  }

  // ── Weekdays (a weekday run only: a sequence run has no days, "the sequence order stays fixed")
  const scheduleOps = new Rows()
  if (scheduleType === 'weekday') planSchedule(scheduleOps, input, workouts.map((w) => w.id))
  const scheduleStartWeek = scheduleOps.empty ? null : currentWeek + 1

  // ── Sessions, from the current week on
  const sessions = input.sessions
    .filter((s) => s.weekNumber >= currentWeek)
    .sort(
      (a, b) =>
        a.weekNumber - b.weekNumber ||
        workoutOrder(workouts, a.workoutDayId) - workoutOrder(workouts, b.workoutDayId) ||
        (a.sequencePosition ?? -1) - (b.sequencePosition ?? -1) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  const planByWorkout = new Map(plans.map((p) => [p.workoutId, p]))
  const sessionOps: Op[] = []
  const changedSessions: SessionRef[] = []
  const keptSessions: ProgramChangeSummary['keptSessions'] = []
  let setsLeftAlone = 0
  for (const s of sessions) {
    const plan = planByWorkout.get(s.workoutDayId)
    if (!plan || (!plan.listChanged && !plan.shapeChanged)) continue
    if (s.status !== 'not_started') {
      keptSessions.push({ ...sessionRef(s), status: s.status })
      continue
    }
    const rows = new Rows()
    setsLeftAlone += landSession(rows, { userId, now, newId, stable }, s, plan)
    // A deload session's saved pre-deload plan changes the way its sets do, so UNMARK restores the plan with the change in it.
    if (s.deloadRestore) {
      const saved = landSavedCopy({ userId, now, stable }, s, plan, s.deloadRestore)
      if (!sameSavedSets(saved, s.deloadRestore)) rows.update('v2_week_plans', s.id, { deload_restore: saved })
    }
    if (!rows.empty) {
      changedSessions.push(sessionRef(s))
      sessionOps.push(...rows.ops())
    }
  }

  const ops: Op[] = [
    ...run.inserts.filter((o) => o.table === 'v2_program_superset_blocks'),
    ...run.inserts.filter((o) => o.table === 'v2_program_exercises'),
    ...run.inserts.filter((o) => o.table === 'v2_program_sets'),
    ...run.updateOps,
    ...routineOps,
    ...sessionOps,
    ...scheduleOps.ops(),
  ]
  return {
    ops,
    summary: {
      startWeek: changeStartWeek(sessions, currentWeek),
      scheduleStartWeek,
      changedSessions,
      keptSessions,
      setsLeftAlone,
    },
  }
}

// ═══ 11. The run copy's default sets ═════════════════════════════════════════════════════════════════════════════

function headPatch(o: OldHead, f: FinalHead): Partial<ProgramSetColumns> {
  const patch: Partial<ProgramSetColumns> = {}
  if (o.position !== f.position) patch.position = f.position
  if (o.isWarmup !== f.isWarmup) patch.is_warmup = f.isWarmup
  const newKind = effectiveStageKind(f)
  if (effectiveStageKind(o) !== newKind) patch.stage_kind = newKind
  if (repsKey(o) !== repsKey(f)) Object.assign(patch, repColumns(f))
  if ((o.row.restSeconds ?? null) !== f.draft.restSeconds) patch.rest_seconds = f.draft.restSeconds
  if ((o.row.stageRestSeconds ?? null) !== f.draft.stageRestSeconds) patch.stage_rest_seconds = f.draft.stageRestSeconds
  return patch
}

function stagePatch(o: RunCopySetRow, st: FinalStage, head: FinalHead): Partial<ProgramSetColumns> {
  const patch: Partial<ProgramSetColumns> = {}
  if (o.position !== head.position) patch.position = head.position
  if (repsKey(o) !== repsKey(st)) Object.assign(patch, repColumns(st))
  return patch
}

type ProgramSetRow = { id: string; user_id: string } & InsertColumns['v2_program_sets']

function programHeadRow(userId: string, now: string, exerciseRowId: string, f: FinalHead): ProgramSetRow {
  return {
    id: f.programSetId,
    user_id: userId,
    program_exercise_id: exerciseRowId,
    position: f.position,
    is_warmup: f.isWarmup,
    stage_kind: effectiveStageKind(f),
    stage_rest_seconds: f.draft.stageRestSeconds,
    parent_program_set_id: null,
    stage_index: 0,
    ...repColumns(f),
    rest_seconds: f.draft.restSeconds,
    removed_at: null,
    created_at: now,
  }
}

function programStageRow(userId: string, now: string, exerciseRowId: string, head: FinalHead, st: FinalStage): ProgramSetRow {
  return {
    id: st.programSetId,
    user_id: userId,
    program_exercise_id: exerciseRowId,
    position: head.position,
    is_warmup: false,
    stage_kind: null,
    stage_rest_seconds: null,
    parent_program_set_id: head.programSetId,
    stage_index: st.stageIndex,
    ...repColumns(st),
    rest_seconds: null,
    removed_at: null,
    created_at: now,
  }
}

// A new exercise's default: every set a new row (heads first, each followed by its stages).
function insertDefaultSets(run: Rows, userId: string, now: string, p: PlannedEntry): void {
  for (const f of p.finalHeads) {
    run.insert('v2_program_sets', programHeadRow(userId, now, p.newId, f))
    for (const st of f.finalStages) run.insert('v2_program_sets', programStageRow(userId, now, p.newId, f, st))
  }
}

// A kept exercise's default: what changed, row by row. A set the draft drops is soft-removed with its stages ("a set
// the default drops is soft-removed, never deleted": weeks already planned keep their `program_set_id` link and with it
// the set's run-wide rest, migration 040).
function writeDefaultSets(run: Rows, userId: string, now: string, p: PlannedEntry): void {
  const kept = new Set<OldHead>()
  for (const f of p.finalHeads) {
    if (f.source === null) {
      run.insert('v2_program_sets', programHeadRow(userId, now, p.newId, f))
      for (const st of f.finalStages) run.insert('v2_program_sets', programStageRow(userId, now, p.newId, f, st))
      continue
    }
    kept.add(f.source)
    run.update('v2_program_sets', f.source.id, headPatch(f.source, f))
    const keptStages = new Set<string>()
    for (const st of f.finalStages) {
      if (st.source === null) {
        run.insert('v2_program_sets', programStageRow(userId, now, p.newId, f, st))
      } else {
        keptStages.add(st.source.id)
        run.update('v2_program_sets', st.source.id, stagePatch(st.source, st, f))
      }
    }
    for (const old of f.source.stageRows) if (!keptStages.has(old.id)) run.update('v2_program_sets', old.id, { removed_at: now })
  }
  for (const o of p.oldHeads) {
    if (kept.has(o)) continue
    run.update('v2_program_sets', o.id, { removed_at: now })
    for (const st of o.stageRows) run.update('v2_program_sets', st.id, { removed_at: now })
  }
}

// ═══ 12. The warmup routine ══════════════════════════════════════════════════════════════════════════════════════
// Run-wide, run copy only. `v2_workout_warmup_items` has a unique index on (workout_day_id, position), so a row can't
// take a position another still holds, not even for the moment between two statements. So, in this order: the items
// the draft drops are deleted; changed bodies are written; every kept item that has to move is parked above every
// position in play and then put in its place (warmupRoutineService.ts's reorder does the same in two phases); new
// items are inserted last, into positions that are free by then.

function planRoutine(
  userId: string,
  newId: () => string,
  workoutId: string,
  old: readonly RunCopyRoutineItem[],
  draft: readonly DraftRoutineItem[],
): Op[] {
  const ops: Op[] = []
  const oldById = new Map(old.map((r) => [r.id, r]))
  const keptIds = new Set(draft.filter((d) => d.id !== null).map((d) => d.id as string))
  for (const r of [...old].sort((a, b) => a.position - b.position)) {
    if (!keptIds.has(r.id)) ops.push({ op: 'delete', table: 'v2_workout_warmup_items', id: r.id })
  }

  // Positions as everywhere: kept items keep theirs unless the draft's order says the list must be renumbered.
  const at = placeInOrder(
    draft.map((d) => (d.id === null ? null : oldById.get(d.id)!.position)),
    0,
  )
  const top = Math.max(...at, ...old.map((r) => r.position)) + 1
  const moves: Array<{ id: string; position: number }> = []
  const fresh: Array<{ body: string; position: number }> = []
  draft.forEach((d, i) => {
    const body = d.body.trim()
    if (d.id === null) {
      fresh.push({ body, position: at[i] })
      return
    }
    const was = oldById.get(d.id)!
    if (was.body !== body) ops.push({ op: 'update', table: 'v2_workout_warmup_items', id: d.id, patch: { body } })
    if (was.position !== at[i]) moves.push({ id: d.id, position: at[i] })
  })
  for (const m of moves) ops.push({ op: 'update', table: 'v2_workout_warmup_items', id: m.id, patch: { position: m.position + top } })
  for (const m of moves) ops.push({ op: 'update', table: 'v2_workout_warmup_items', id: m.id, patch: { position: m.position } })
  for (const f of fresh) {
    ops.push({
      op: 'insert',
      table: 'v2_workout_warmup_items',
      row: { id: newId(), user_id: userId, workout_day_id: workoutId, position: f.position, body: f.body },
    })
  }
  return ops
}

// ═══ 13. The weekdays ════════════════════════════════════════════════════════════════════════════════════════════

function planSchedule(out: Rows, input: ProgramChangeInput, workoutIds: readonly string[]): void {
  const { runCopy, edit, userId, now, newId, currentWeek } = input
  if (sameSchedule(runCopy.schedule, edit.schedule)) return
  const ids = new Set(workoutIds)
  for (const day of WEEKDAYS) {
    const id = edit.schedule[day] ?? null
    if (id !== null && !ids.has(id)) throw new RangeError(`the draft's ${day} names workout ${id}, which the run doesn't have`)
  }
  // "A workout needs at least one day": a workout that has days and is left with none is refused (one that never had
  // any isn't asked for one).
  for (const id of workoutIds) {
    if (daysOfWorkout(runCopy.schedule, id).length > 0 && daysOfWorkout(edit.schedule, id).length === 0) {
      throw new RangeError(`workout ${id} would be left with no day: a workout needs at least one`)
    }
  }
  for (const w of scheduleChangeRows(input.scheduleRows, runCopy.schedule, edit.schedule, currentWeek)) {
    if (w.existingId !== null) {
      out.update('v2_run_schedules', w.existingId, { schedule: w.schedule })
    } else {
      out.insert('v2_run_schedules', {
        id: newId(),
        user_id: userId,
        mesocycle_id: runCopy.mesocycleId,
        from_week: w.fromWeek,
        schedule: w.schedule,
        created_at: now,
      })
    }
  }
  // The run copy holds the newest schedule, so `hasSchedule`, Coach and anything that doesn't resolve per week see it.
  out.update('v2_programs', runCopy.programId, { schedule: fullSchedule(edit.schedule) })
}

// ═══ 14. The sessions ════════════════════════════════════════════════════════════════════════════════════════════

interface LandEnv {
  userId: string
  now: string
  newId: () => string
  stable: boolean
}

type WeekSetRow = { id: string; user_id: string } & WeekPlanSetColumns

// A planned set's row, every column named. A new set has no weight, RIR or cues, whatever its source had.
function weekSetRow(
  env: LandEnv,
  weekPlanId: string,
  exerciseRowId: string,
  v: {
    id: string
    setNumber: number
    parentId: string | null
    stageIndex: number
    isWarmup: boolean
    programSetId: string | null
    stageKind: StageKind | null
    reps: RepFields
  },
): WeekSetRow {
  return {
    id: v.id,
    user_id: env.userId,
    week_plan_id: weekPlanId,
    program_exercise_id: exerciseRowId,
    set_number: v.setNumber,
    target_rir: null,
    target_rir_max: null,
    is_dropset: v.parentId !== null,
    parent_week_plan_set_id: v.parentId,
    stage_index: v.stageIndex,
    is_warmup: v.isWarmup,
    program_set_id: v.programSetId,
    stage_kind: v.stageKind,
    target_weight: null,
    ...repColumns(v.reps),
    tags: null,
  }
}

// A head and its stages as new planned sets under `setNumber`.
function insertFinalHead(out: Rows, env: LandEnv, weekPlanId: string, exerciseRowId: string, f: FinalHead, setNumber: number): void {
  const headId = env.newId()
  out.insert(
    'v2_week_plan_sets',
    weekSetRow(env, weekPlanId, exerciseRowId, {
      id: headId,
      setNumber,
      parentId: null,
      stageIndex: 0,
      isWarmup: f.isWarmup,
      programSetId: f.programSetId,
      stageKind: effectiveStageKind(f),
      reps: f,
    }),
  )
  for (const st of f.finalStages) insertFinalStage(out, env, weekPlanId, exerciseRowId, st, headId, setNumber)
}

function insertFinalStage(out: Rows, env: LandEnv, weekPlanId: string, exerciseRowId: string, st: FinalStage, headId: string, setNumber: number): void {
  out.insert(
    'v2_week_plan_sets',
    weekSetRow(env, weekPlanId, exerciseRowId, {
      id: env.newId(),
      setNumber,
      parentId: headId,
      stageIndex: st.stageIndex,
      isWarmup: false,
      programSetId: st.programSetId,
      stageKind: null,
      reps: st,
    }),
  )
}

// Every planned set of an exercise in a session, stages first (highest stage index first), the heads last: nothing is
// left pointing at a head that is gone, even if a stage's head was already missing.
function deleteExerciseSets(out: Rows, s: ChangeSession, exerciseRowId: string): void {
  const rows = s.sets.filter((x) => x.programExerciseId === exerciseRowId)
  const stages = rows.filter((x) => x.parentWeekPlanSetId != null).sort((a, b) => (b.stageIndex ?? 0) - (a.stageIndex ?? 0))
  const heads = rows.filter((x) => x.parentWeekPlanSetId == null).sort((a, b) => b.setNumber - a.setNumber)
  for (const row of [...stages, ...heads]) out.remove('v2_week_plan_sets', row.id)
}

// What one not-started session gets. Returns the number of default-set changes it did not take.
function landSession(out: Rows, env: LandEnv, s: ChangeSession, plan: WorkoutPlan): number {
  let leftAlone = 0
  const rowOfExercise = new Map(s.exercises.map((r) => [r.programExerciseId, r]))
  const current = [...s.exercises].sort((a, b) => a.position - b.position)

  // The session's list after the save. A save that moves an exercise puts the rows this session has in the draft's order
  // ("the new order applies to every not-done session"), the exercises the draft added at their places in it, and any row
  // this save doesn't know (a week planned in 1.1 can hold a week-only row) after them, in the order it had. A save that
  // doesn't reorder leaves the session's own order alone: removed rows go, a swap keeps its row's place, and an added
  // exercise goes after the row of the exercise before it in the draft (at the top when this session has none).
  interface Placed {
    weekPlanExerciseId: string
    exerciseRowId: string // the program exercise the row names after the save
    isNew: boolean
    position: number | null // before the save; null for a new row
  }
  let placed: Placed[] = []
  const removedRows = new Set(plan.removed.map((r) => r.id))
  if (plan.reordered) {
    const covered = new Set<string>()
    for (const p of plan.entries) {
      if (p.entry.kind === 'added') {
        placed.push({ weekPlanExerciseId: env.newId(), exerciseRowId: p.newId, isNew: true, position: null })
        continue
      }
      const row = rowOfExercise.get(p.oldRow!.id)
      if (!row) continue
      covered.add(row.weekPlanExerciseId)
      placed.push({ weekPlanExerciseId: row.weekPlanExerciseId, exerciseRowId: p.newId, isNew: false, position: row.position })
    }
    for (const r of current) {
      if (!covered.has(r.weekPlanExerciseId) && !removedRows.has(r.programExerciseId)) {
        placed.push({ weekPlanExerciseId: r.weekPlanExerciseId, exerciseRowId: r.programExerciseId, isNew: false, position: r.position })
      }
    }
  } else {
    const nowNamed = new Map(plan.entries.filter((p) => p.entry.kind === 'swapped').map((p) => [p.oldRow!.id, p.newId]))
    placed = current
      .filter((r) => !removedRows.has(r.programExerciseId))
      .map((r) => ({ weekPlanExerciseId: r.weekPlanExerciseId, exerciseRowId: nowNamed.get(r.programExerciseId) ?? r.programExerciseId, isNew: false, position: r.position }))
    plan.entries.forEach((p, i) => {
      if (p.entry.kind !== 'added') return
      let after = 0
      for (let j = i - 1; j >= 0; j--) {
        const at = placed.findIndex((x) => x.exerciseRowId === plan.entries[j].newId)
        if (at >= 0) {
          after = at + 1
          break
        }
      }
      placed.splice(after, 0, { weekPlanExerciseId: env.newId(), exerciseRowId: p.newId, isNew: true, position: null })
    })
  }
  // Positions: when this session's list changed at all, the rows it has are placed (placeInOrder: they keep their
  // positions unless the order says the list must be renumbered).
  const before = current.map((r) => r.weekPlanExerciseId)
  const after = placed.filter((x) => !x.isNew).map((x) => x.weekPlanExerciseId)
  const stay = new Set(after)
  const moved = before.filter((id) => stay.has(id)).some((id, i) => id !== after[i])
  const changed = moved || placed.some((x) => x.isNew) || before.length !== after.length
  const at = changed ? placeInOrder(placed.map((x) => x.position), 0) : placed.map((x) => x.position ?? 0)
  const positionOfNew = new Map<string, number>()
  placed.forEach((x, i) => {
    if (x.isNew) positionOfNew.set(x.exerciseRowId, at[i])
    else if (changed && x.position !== at[i]) out.update('v2_week_plan_exercises', x.weekPlanExerciseId, { position: at[i] })
  })

  // Removed exercises
  for (const row of plan.removed) {
    const r = rowOfExercise.get(row.id)
    if (!r) continue
    deleteExerciseSets(out, s, row.id)
    out.remove('v2_week_plan_exercises', r.weekPlanExerciseId)
  }

  // Swapped, added and kept exercises
  for (const p of plan.entries) {
    if (p.entry.kind === 'swapped') {
      const r = rowOfExercise.get(p.oldRow!.id)
      if (!r) continue
      out.update('v2_week_plan_exercises', r.weekPlanExerciseId, { program_exercise_id: p.newId })
      leftAlone += landExercise(out, env, s, p)
    } else if (p.entry.kind === 'added') {
      const row = placed.find((x) => x.isNew && x.exerciseRowId === p.newId)!
      out.insert('v2_week_plan_exercises', {
        id: row.weekPlanExerciseId,
        user_id: env.userId,
        week_plan_id: s.id,
        program_exercise_id: p.newId,
        position: positionOfNew.get(p.newId)!,
        created_at: env.now,
      })
      if (env.stable) for (const f of p.finalHeads) insertFinalHead(out, env, s.id, p.newId, f, f.position)
    } else if (env.stable && entryShapeChanged(p) && rowOfExercise.has(p.newId)) {
      leftAlone += landExercise(out, env, s, p)
    }
  }
  return leftAlone
}

// Which session head is the counterpart of each old default head (by old head, in order): a session head names it, or,
// with no link of its own exercise, sits at the same position and no other head named that set.
function pairHeads(sessionHeads: readonly SessionHead[], p: PlannedEntry): Array<SessionHead | null> {
  const byId = new Map(p.oldHeads.map((h, i) => [h.id, i]))
  const paired: Array<SessionHead | null> = p.oldHeads.map(() => null)
  const claimed = new Set<SessionHead>()
  for (const sh of sessionHeads) {
    const at = sh.row.programSetId ? byId.get(sh.row.programSetId) : undefined
    if (at !== undefined && paired[at] === null) {
      paired[at] = sh
      claimed.add(sh)
    }
  }
  sessionHeads.forEach((sh, ordinal) => {
    if (claimed.has(sh)) return
    const link = sh.row.programSetId
    if (link && p.ownProgramSetIds.has(link)) return // it names a set of its own exercise that isn't the default's now
    if (ordinal < paired.length && paired[ordinal] === null) {
      paired[ordinal] = sh
      claimed.add(sh)
    }
  })
  return paired
}

// One exercise of a session whose default sets changed, or that was swapped (stable: its sets also point at the new
// row's program sets). Returns the number of default-set changes it did not take.
function landExercise(out: Rows, env: LandEnv, s: ChangeSession, p: PlannedEntry): number {
  const swapped = p.entry.kind === 'swapped'
  const oldRowId = p.oldRow!.id
  const heads = sessionHeadsOf(s.sets, oldRowId)
  const paired = env.stable ? pairHeads(heads, p) : p.oldHeads.map(() => null)
  const finalOf = new Map<OldHead, FinalHead>()
  for (const f of p.finalHeads) if (f.source) finalOf.set(f.source, f)

  // A swap points every planned set of the exercise at the new row and clears what belonged to the old exercise: weight,
  // RIR (both ends) and cues. Counts, kinds, stages and rep targets stay as they are.
  if (swapped) {
    const rows = s.sets
      .filter((x) => x.programExerciseId === oldRowId)
      .sort((a, b) => a.setNumber - b.setNumber || (a.stageIndex ?? 0) - (b.stageIndex ?? 0))
    for (const row of rows) {
      out.update('v2_week_plan_sets', row.id, {
        program_exercise_id: p.newId,
        target_weight: null,
        target_rir: null,
        target_rir_max: null,
        tags: null,
      })
    }
    if (env.stable) {
      // Each set that stands for one of the old default's sets now names the new row's own copy of it; any other set (one
      // added for that week only) has no program set of its own exercise: no link, as G45 says.
      for (const sh of heads) {
        const k = paired.indexOf(sh)
        const fin = k >= 0 ? finalOf.get(p.oldHeads[k]) : undefined
        if ((sh.row.programSetId ?? null) !== (fin?.programSetId ?? null)) out.update('v2_week_plan_sets', sh.row.id, { program_set_id: fin?.programSetId ?? null })
        for (const st of sh.stageRows) {
          const old = k >= 0 ? p.oldHeads[k].stageRows.find((x) => x.stageIndex === st.stageIndex) : undefined
          const finStage = fin?.finalStages.find((x) => x.source === old && old !== undefined)
          if ((st.programSetId ?? null) !== (finStage?.programSetId ?? null)) {
            out.update('v2_week_plan_sets', st.id, { program_set_id: finStage?.programSetId ?? null })
          }
        }
      }
    }
  }
  if (!env.stable) return 0

  // The default's changes, set by set: only where the session's set still equals the old default's.
  let leftAlone = 0
  p.oldHeads.forEach((o, k) => {
    const fin = finalOf.get(o)
    if (fin && shapeKey(fin) === shapeKey(o)) return // this set is unchanged
    const sh = paired[k]
    if (!sh || shapeKey(sh) !== shapeKey(o)) {
      leftAlone++ // changed for that week only, or already gone: left exactly as it is
      return
    }
    if (!fin) landRemovedHead(out, sh)
    else landChangedHead(out, env, s, p, sh, fin)
  })

  // Sets the default added: only where the session still has the default's count.
  const added = p.finalHeads.filter((f) => f.source === null)
  if (added.length > 0) {
    if (heads.length === p.oldHeads.length) {
      let next = heads.reduce((max, h) => Math.max(max, h.row.setNumber), 0) + 1
      for (const f of added) insertFinalHead(out, env, s.id, p.newId, f, next++)
    } else {
      leftAlone += added.length
    }
  }
  return leftAlone
}

// A set the default dropped, in a session where it still is what it was: the set goes, stages first.
function landRemovedHead(out: Rows, sh: SessionHead): void {
  const group = { head: sh.row, stages: sh.stageRows }
  for (const row of cascadeDeleteOrder(group, (r) => r.stageIndex)) out.remove('v2_week_plan_sets', row.id)
}

// A set whose kind, rep target or stages the default changed, in a session where it still is what it was. Weight, RIR
// and cues stay: nothing here names them.
function landChangedHead(out: Rows, env: LandEnv, s: ChangeSession, p: PlannedEntry, sh: SessionHead, fin: FinalHead): void {
  const patch: Partial<WeekPlanSetColumns> = {}
  if (sh.isWarmup !== fin.isWarmup) patch.is_warmup = fin.isWarmup
  const kind = effectiveStageKind(fin)
  if (effectiveStageKind(sh) !== kind) patch.stage_kind = kind
  if (repsKey(sh) !== repsKey(fin)) Object.assign(patch, repColumns(fin))
  out.update('v2_week_plan_sets', sh.row.id, patch)

  // The stages: matched by index (the head still equals the old default, so its stages are the old default's).
  const rowByIndex = new Map(sh.stageRows.map((r) => [r.stageIndex ?? 0, r]))
  const kept = new Set<number>()
  for (const st of fin.finalStages) {
    if (st.source === null) {
      insertFinalStage(out, env, s.id, p.newId, st, sh.row.id, sh.row.setNumber)
      continue
    }
    kept.add(st.source.stageIndex)
    const row = rowByIndex.get(st.source.stageIndex)
    if (row && repsKey(row) !== repsKey(st)) out.update('v2_week_plan_sets', row.id, repColumns(st))
  }
  const gone = [...rowByIndex.entries()].filter(([index]) => !kept.has(index)).sort(([a], [b]) => b - a)
  for (const [, row] of gone) out.remove('v2_week_plan_sets', row.id)
}

// ═══ 15. A session's saved pre-deload plan ═══════════════════════════════════════════════════════════════════════
//
// DECISIONS 142 (Adam, 2026-10-15): "A CHANGE THE PROGRAM save also applies its landing rules to the saved pre-deload copy
// of a not-started deload session, so UNMARK restores the plan with the change in it."
//
// A session marked deload with rules on keeps the sets it had before in `v2_week_plans.deload_restore`, and UNMARK
// (weekPlanService.ts `applyDeloadRestore`) deletes the session's sets and inserts that copy by `program_exercise_id`.
// The copy has no ids: an entry is a set under an exercise row, a head with stage index 0 and its stages sharing its set
// number (lib/deloadRules.ts `groupDeloadRestoreEntries`). Left as it is, a save that removed or swapped an exercise
// would have UNMARK write back sets of a row the session no longer lists, and an exercise the save swapped in or added
// would come back with no sets.
//
// The copy goes through the code a session's own rows go through, so the two can't disagree: its entries become planned
// sets with ids of their own, `landSession` lands the save on them (the same removal, swap, added exercise and default-set
// matching), and the set ops it makes are applied to the entries. The one op written is an update of `deload_restore` on
// the session's `v2_week_plans` row (043 may write that one column of that table, as an update only), and only when the
// save changes the copy.
//
// What this does not do: a deload session's own rows are changed as any not-started session's are. A set the rules
// recalculated no longer equals the default, so a default-set change usually leaves the session's own row alone (counted
// in `setsLeftAlone`) while the copy, which does equal the default, takes it. A stable exercise added to a deload session
// gets the default's sets, in the session and in the copy, not a deload calculation.

const SAVED_ID = 'saved:'

type SavedWork = { id: string | null; entry: SavedPlanSet } // id null = not a planned set to land on (a stage with no head)

// Entries as planned sets (ids `saved:<index>`; a stage is the child of the head of its exercise row and set number). A
// stage with no head is never restored (groupDeloadRestoreEntries drops it): it is set aside, left as it is.
function savedAsPlannedSets(entries: readonly SavedPlanSet[]): { work: SavedWork[]; sets: ChangeSessionSet[] } {
  const key = (e: SavedPlanSet) => `${e.programExerciseId}::${e.setNumber}`
  const headOf = new Map<string, string>()
  entries.forEach((e, i) => {
    if (e.stageIndex === 0) headOf.set(key(e), `${SAVED_ID}${i}`)
  })
  const work: SavedWork[] = []
  const sets: ChangeSessionSet[] = []
  entries.forEach((entry, i) => {
    const head = headOf.get(key(entry)) ?? null
    if (entry.stageIndex !== 0 && head === null) {
      work.push({ id: null, entry })
      return
    }
    const id = `${SAVED_ID}${i}`
    work.push({ id, entry })
    sets.push({
      id,
      programExerciseId: entry.programExerciseId,
      setNumber: entry.setNumber,
      parentWeekPlanSetId: entry.stageIndex === 0 ? null : head,
      stageIndex: entry.stageIndex,
      isWarmup: entry.isWarmup,
      stageKind: entry.stageKind,
      programSetId: entry.programSetId,
      repMin: entry.repMin,
      repMax: entry.repMax,
      isAmrap: entry.isAmrap,
    })
  })
  return { work, sets }
}

// A planned set a save inserted, as an entry: no weight, no RIR (either end), no cues.
function savedFromRow(r: WeekSetRow): SavedPlanSet {
  return {
    programExerciseId: r.program_exercise_id,
    setNumber: r.set_number,
    stageIndex: r.stage_index,
    isWarmup: r.is_warmup,
    isDropset: r.is_dropset,
    stageKind: r.stage_kind,
    programSetId: r.program_set_id,
    repMin: r.rep_min,
    repMax: r.rep_max,
    isAmrap: r.is_amrap,
    targetWeight: r.target_weight,
    targetRir: r.target_rir,
    targetRirMax: r.target_rir_max,
    tags: r.tags,
  }
}

// An update `landSession` made to a planned set, applied to its entry. Only the columns it ever writes on a set are named
// (a swap's re-pointing and clearing, a set's link, kind and rep target). A swap clears the RIR range's high end with the low
// end: `targetRirMax` is set to null on an entry that carries the key, and an entry from a copy saved before chunk 48, which
// has none, stays without one (none is the same as null).
function patchSaved(entry: SavedPlanSet, patch: Partial<WeekPlanSetColumns>): SavedPlanSet {
  const next: SavedPlanSet = { ...entry }
  if ('program_exercise_id' in patch) next.programExerciseId = patch.program_exercise_id!
  if ('target_weight' in patch) next.targetWeight = patch.target_weight ?? null
  if ('target_rir' in patch) next.targetRir = patch.target_rir ?? null
  if ('target_rir_max' in patch && ('targetRirMax' in next || patch.target_rir_max != null)) next.targetRirMax = patch.target_rir_max ?? null
  if ('tags' in patch) next.tags = patch.tags ?? null
  if ('program_set_id' in patch) next.programSetId = patch.program_set_id ?? null
  if ('is_warmup' in patch) next.isWarmup = patch.is_warmup!
  if ('stage_kind' in patch) next.stageKind = patch.stage_kind ?? null
  if ('rep_min' in patch) next.repMin = patch.rep_min ?? null
  if ('rep_max' in patch) next.repMax = patch.rep_max ?? null
  if ('is_amrap' in patch) next.isAmrap = patch.is_amrap!
  return next
}

// The copy after the save: what `landSession` does to a session with these sets, done to the entries. Entries keep their
// order; the sets the save adds come after them.
function landSavedCopy(env: Omit<LandEnv, 'newId'>, s: ChangeSession, plan: WorkoutPlan, entries: readonly SavedPlanSet[]): SavedPlanSet[] {
  const { work, sets } = savedAsPlannedSets(entries)
  const byId = new Map<string, SavedWork>()
  for (const w of work) if (w.id !== null) byId.set(w.id, w)
  const gone = new Set<string>()
  let drawn = 0 // ids of rows inserted into the copy are the copy's own: the save's ids are drawn for the real rows only
  const sink = new Rows()
  landSession(sink, { ...env, newId: () => `${SAVED_ID}new${++drawn}` }, { ...s, sets }, plan)
  for (const op of sink.ops()) {
    if (op.table !== 'v2_week_plan_sets') continue
    if (op.op === 'insert') {
      const added: SavedWork = { id: op.row.id, entry: savedFromRow(op.row) }
      work.push(added)
      byId.set(op.row.id, added)
    } else if (op.op === 'update') {
      const at = byId.get(op.id)!
      at.entry = patchSaved(at.entry, op.patch)
    } else {
      gone.add(op.id)
    }
  }
  return work.filter((w) => w.id === null || !gone.has(w.id)).map((w) => w.entry)
}

// Whether two copies are the same list of entries (key order aside): a save that changes nothing in it writes nothing.
function sameSavedSets(a: readonly SavedPlanSet[], b: readonly SavedPlanSet[]): boolean {
  const key = (e: SavedPlanSet) => JSON.stringify(Object.entries(e).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
  return a.length === b.length && a.every((e, i) => key(e) === key(b[i]))
}

