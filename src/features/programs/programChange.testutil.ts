// Shared by programChange's tests and runSchedule's (chunk 45): not a test file (Vitest's include is *.test.ts) and
// imported by nothing in the app.
//
// The fixtures are DATABASE ROWS (snake_case, the tables migrations 001-042 make), so that the same world can be
//   - mapped to what a screen would pass in (`runCopyOf`, `sessionsOf`: the shapes chunks 51a / 51b read), and
//   - handed an op list to execute (`applyOpsToDb`), which refuses what the real database refuses: a row that isn't
//     there, a foreign key with nothing behind it, a unique index (the warmup routine's (workout, position), a
//     session's (plan, exercise), a run's (meso, from week)), and every CHECK the writes here can break.
// Checks that lied #11: a test that only compares op lists passes while the list is something the database rejects.
// This executor stands in for migration 043's `v2_apply_ops` (chunk 47) as TASKS-1.2 describes it (insert: a full row
// with its own id, `user_id` forced to the caller's; update and delete: by id, scoped to the caller, raising when
// the row isn't found; a patch never names `id` or `user_id`; the table must be one of the list). Chunk 45's own
// scratch run (reported, not committed) applies the same lists to a real Postgres to show this stand-in tells the
// truth for them.

import type { PlanningType, RunSchedule, ScheduleType, WeeklySchedule } from '../../types'
import type { StageKind } from '../../lib/plannerVocabulary.js'
import {
  type SavedPlanSet,
  type ChangeSession,
  type ChangeSessionSet,
  type DraftExercise,
  type DraftSet,
  type DraftWorkout,
  type DeleteOp,
  type InsertOp,
  type InsertableTable,
  type Op,
  type OpTable,
  type UpdateOp,
  type ProgramChangeInput,
  type ProgramChangePlan,
  type ProgramChangeRunCopy,
  type ProgramEdit,
  type RunChangeStatus,
  planProgramChange,
} from './programChange'

// ─── Rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const USER = 'u-test'
export const NOW = '2026-10-15T12:00:00.000Z'

export interface DbProgram {
  id: string
  user_id: string
  name: string
  kind: 'saved' | 'run'
  schedule_type: ScheduleType
  planning_type: PlanningType
  schedule: Record<string, string | null>
}
export interface DbWorkoutDay {
  id: string
  user_id: string
  program_id: string
  name: string
  position: number
}
export interface DbProgramExercise {
  id: string
  user_id: string
  workout_day_id: string
  exercise_id: string
  position: number
  weight_unit: 'kg' | 'lbs' | null
  superset_block_id: string | null
  rest_seconds: number | null
  rest_after_seconds: number | null
  tempo: string | null
  week_only: boolean
  removed_at: string | null
  replaces_program_exercise_id: string | null
}
export interface DbProgramSet {
  id: string
  user_id: string
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
export interface DbBlock {
  id: string
  user_id: string
  workout_day_id: string
  rest_within_round_seconds: number | null
  rest_after_round_seconds: number | null
}
export interface DbWarmupItem {
  id: string
  user_id: string
  workout_day_id: string
  position: number
  body: string
}
export interface DbRunSchedule {
  id: string
  user_id: string
  mesocycle_id: string
  from_week: number
  schedule: Record<string, string | null>
}
export interface DbWeekPlan {
  id: string
  user_id: string
  mesocycle_id: string
  workout_day_id: string
  week_number: number
  is_deload: boolean
  sequence_position: number | null
  // The saved pre-deload plan (migration 027): there while the session is marked deload with rules on.
  deload_restore?: SavedPlanSet[] | null
}
export interface DbWeekPlanExercise {
  id: string
  user_id: string
  week_plan_id: string
  program_exercise_id: string
  position: number
}
export interface DbWeekPlanSet {
  id: string
  user_id: string
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

export interface Db {
  v2_programs: DbProgram[]
  v2_workout_days: DbWorkoutDay[]
  v2_mesocycles: Array<{ id: string; user_id: string; program_id: string }>
  v2_program_exercises: DbProgramExercise[]
  v2_program_sets: DbProgramSet[]
  v2_program_superset_blocks: DbBlock[]
  v2_workout_warmup_items: DbWarmupItem[]
  v2_run_schedules: DbRunSchedule[]
  v2_week_plans: DbWeekPlan[]
  v2_week_plan_exercises: DbWeekPlanExercise[]
  v2_week_plan_sets: DbWeekPlanSet[]
}
type TableName = keyof Db

export const emptyDb = (): Db => ({
  v2_programs: [],
  v2_workout_days: [],
  v2_mesocycles: [],
  v2_program_exercises: [],
  v2_program_sets: [],
  v2_program_superset_blocks: [],
  v2_workout_warmup_items: [],
  v2_run_schedules: [],
  v2_week_plans: [],
  v2_week_plan_exercises: [],
  v2_week_plan_sets: [],
})

export const cloneDb = (db: Db): Db => JSON.parse(JSON.stringify(db)) as Db

// Ids for the rows a save inserts: 'n1', 'n2', … in the order they are drawn.
export function idGen(prefix = 'n'): () => string {
  let n = 0
  return () => `${prefix}${++n}`
}

// ─── The executor: migration 043's `v2_apply_ops`, with the constraints the tables carry ─────────────────────────

const OP_TABLES: ReadonlySet<string> = new Set<OpTable>([
  'v2_program_exercises',
  'v2_program_sets',
  'v2_program_superset_blocks',
  'v2_workout_warmup_items',
  'v2_workout_days',
  'v2_programs',
  'v2_run_schedules',
  'v2_week_plans',
  'v2_week_plan_exercises',
  'v2_week_plan_sets',
  'v2_week_review_decisions',
  'v2_session_set_changes',
])

// Every column a patch may name, per table (never `id` or `user_id`).
const PATCH_COLUMNS: Record<string, readonly string[]> = {
  v2_programs: ['schedule'],
  v2_workout_days: ['name', 'position'],
  v2_program_exercises: [
    'workout_day_id', 'exercise_id', 'position', 'weight_unit', 'superset_block_id', 'rest_seconds', 'rest_after_seconds',
    'tempo', 'week_only', 'removed_at', 'replaces_program_exercise_id',
  ],
  v2_program_sets: [
    'program_exercise_id', 'position', 'is_warmup', 'stage_kind', 'stage_rest_seconds', 'parent_program_set_id',
    'stage_index', 'rep_min', 'rep_max', 'is_amrap', 'rest_seconds', 'removed_at',
  ],
  v2_program_superset_blocks: ['workout_day_id', 'rest_within_round_seconds', 'rest_after_round_seconds'],
  v2_workout_warmup_items: ['workout_day_id', 'position', 'body'],
  v2_run_schedules: ['mesocycle_id', 'from_week', 'schedule'],
  // 043 lets an op write ONE column of `v2_week_plans`, as an update only (DECISIONS 142): any other column is refused
  // like `id` and `user_id`, and the table takes no insert and no delete.
  v2_week_plans: ['deload_restore'],
  v2_week_plan_exercises: ['week_plan_id', 'program_exercise_id', 'position'],
  v2_week_plan_sets: [
    'week_plan_id', 'program_exercise_id', 'set_number', 'target_rir', 'target_rir_max', 'is_dropset',
    'parent_week_plan_set_id', 'stage_index', 'is_warmup', 'program_set_id', 'stage_kind', 'target_weight', 'rep_min',
    'rep_max', 'is_amrap', 'tags',
  ],
}
// Every column an insert row must carry (an insert is a full row): `jsonb_populate_record` fills a column the row leaves
// out with NULL, never with its default, so every NOT NULL column has to be named; `created_at` is NOT NULL (default
// now()) on four of these tables. (Found by the scratch run on a replayed database: the executor emulation refused the
// first version of these rows with `null value in column "created_at" … violates not-null constraint`.)
const INSERT_COLUMNS: Record<string, readonly string[]> = {
  v2_program_exercises: ['id', 'user_id', ...PATCH_COLUMNS.v2_program_exercises],
  v2_program_sets: ['id', 'user_id', ...PATCH_COLUMNS.v2_program_sets, 'created_at'],
  v2_program_superset_blocks: ['id', 'user_id', ...PATCH_COLUMNS.v2_program_superset_blocks, 'created_at'],
  v2_workout_warmup_items: ['id', 'user_id', ...PATCH_COLUMNS.v2_workout_warmup_items],
  v2_run_schedules: ['id', 'user_id', ...PATCH_COLUMNS.v2_run_schedules, 'created_at'],
  v2_week_plan_exercises: ['id', 'user_id', ...PATCH_COLUMNS.v2_week_plan_exercises, 'created_at'],
  v2_week_plan_sets: ['id', 'user_id', ...PATCH_COLUMNS.v2_week_plan_sets],
}
const STAGE_KINDS = ['dropset', 'rest_pause', 'myo_reps', 'cluster']

export class OpsError extends Error {}

function fail(message: string): never {
  throw new OpsError(message)
}

function exists(db: Db, table: TableName, id: unknown): boolean {
  return id !== null && (db[table] as Array<{ id: string }>).some((r) => r.id === id)
}

function fk(db: Db, table: TableName, id: unknown, from: string, nullable = false): void {
  if (id === null || id === undefined) {
    if (nullable) return
    fail(`null value in ${from} violates not-null`)
  }
  if (!exists(db, table, id)) fail(`foreign key violation: ${from} ${String(id)} is not in ${table}`)
}

// The CHECKs, foreign keys and unique indexes of one row, as the tables define them. `db` already holds the row.
function checkRow(db: Db, table: string, row: Record<string, unknown>): void {
  const n = (c: string) => row[c] as number | null
  const geq = (c: string, min: number) => {
    if (n(c) !== null && (n(c) as number) < min) fail(`check violation: ${table}.${c} >= ${min}`)
  }
  switch (table) {
    case 'v2_program_exercises': {
      fk(db, 'v2_workout_days', row.workout_day_id, 'workout_day_id')
      fk(db, 'v2_program_superset_blocks', row.superset_block_id, 'superset_block_id', true)
      // 043's column: the row a swap replaced (a foreign key to this table itself; null on every other row)
      fk(db, 'v2_program_exercises', row.replaces_program_exercise_id, 'replaces_program_exercise_id', true)
      geq('rest_seconds', 0)
      geq('rest_after_seconds', 0)
      if (row.weight_unit !== null && row.weight_unit !== 'kg' && row.weight_unit !== 'lbs') fail('check violation: weight_unit')
      if (typeof row.tempo === 'string' && row.tempo.length > 20) fail('check violation: tempo length')
      break
    }
    case 'v2_program_sets': {
      fk(db, 'v2_program_exercises', row.program_exercise_id, 'program_exercise_id')
      fk(db, 'v2_program_sets', row.parent_program_set_id, 'parent_program_set_id', true)
      if ((n('position') as number) <= 0) fail('check violation: position > 0')
      if (n('rep_min') !== null && (n('rep_min') as number) <= 0) fail('check violation: rep_min > 0')
      if (row.stage_kind !== null && !STAGE_KINDS.includes(row.stage_kind as string)) fail('check violation: stage_kind')
      geq('stage_rest_seconds', 0)
      geq('rest_seconds', 0)
      if (n('rep_max') !== null && !(n('rep_min') !== null && (n('rep_max') as number) >= (n('rep_min') as number))) fail('check violation: v2_program_sets_rep_max_check')
      if (row.is_amrap && (n('rep_min') !== null || n('rep_max') !== null)) fail('check violation: v2_program_sets_amrap_check')
      const staged = row.parent_program_set_id !== null
      if (staged !== ((n('stage_index') as number) > 0)) fail('check violation: v2_program_sets_stage_index_check')
      if (staged && (row.stage_kind !== null || row.stage_rest_seconds !== null || row.is_warmup)) fail('check violation: v2_program_sets_stage_row_check')
      if (row.is_warmup && (row.stage_kind !== null || staged)) fail('check violation: v2_program_sets_warmup_check')
      break
    }
    case 'v2_program_superset_blocks': {
      fk(db, 'v2_workout_days', row.workout_day_id, 'workout_day_id')
      geq('rest_within_round_seconds', 0)
      geq('rest_after_round_seconds', 0)
      break
    }
    case 'v2_workout_warmup_items': {
      fk(db, 'v2_workout_days', row.workout_day_id, 'workout_day_id')
      if ((n('position') as number) < 0) fail('check violation: position >= 0')
      if (typeof row.body !== 'string' || row.body.trim().length === 0) fail('check violation: body is not blank')
      const clash = db.v2_workout_warmup_items.filter((r) => r.workout_day_id === row.workout_day_id && r.position === row.position)
      if (clash.length > 1) fail('duplicate key value violates unique constraint "v2_workout_warmup_items_pos_uk"')
      break
    }
    case 'v2_run_schedules': {
      fk(db, 'v2_mesocycles', row.mesocycle_id, 'mesocycle_id')
      if ((n('from_week') as number) < 1) fail('check violation: from_week >= 1')
      const clash = db.v2_run_schedules.filter((r) => r.mesocycle_id === row.mesocycle_id && r.from_week === row.from_week)
      if (clash.length > 1) fail('duplicate key value violates unique constraint "v2_run_schedules_week_uk"')
      if (typeof row.schedule !== 'object' || row.schedule === null) fail('null value in schedule violates not-null')
      break
    }
    case 'v2_week_plan_exercises': {
      fk(db, 'v2_week_plans', row.week_plan_id, 'week_plan_id')
      fk(db, 'v2_program_exercises', row.program_exercise_id, 'program_exercise_id')
      if ((n('position') as number) < 0) fail('check violation: position >= 0')
      const clash = db.v2_week_plan_exercises.filter((r) => r.week_plan_id === row.week_plan_id && r.program_exercise_id === row.program_exercise_id)
      if (clash.length > 1) fail('duplicate key value violates unique constraint "v2_week_plan_exercises_plan_ex_uk"')
      break
    }
    case 'v2_week_plan_sets': {
      fk(db, 'v2_week_plans', row.week_plan_id, 'week_plan_id')
      fk(db, 'v2_program_exercises', row.program_exercise_id, 'program_exercise_id')
      fk(db, 'v2_program_sets', row.program_set_id, 'program_set_id', true)
      fk(db, 'v2_week_plan_sets', row.parent_week_plan_set_id, 'parent_week_plan_set_id', true)
      if (row.stage_kind !== null && !STAGE_KINDS.includes(row.stage_kind as string)) fail('check violation: stage_kind')
      if (row.parent_week_plan_set_id !== null && row.stage_kind !== null) fail('check violation: v2_week_plan_sets_stage_row_check')
      geq('target_weight', 0)
      if (n('rep_min') !== null && (n('rep_min') as number) <= 0) fail('check violation: rep_min > 0')
      if (n('rep_max') !== null && !(n('rep_min') !== null && (n('rep_max') as number) >= (n('rep_min') as number))) fail('check violation: v2_week_plan_sets_rep_max_check')
      if (row.is_amrap && (n('rep_min') !== null || n('rep_max') !== null)) fail('check violation: v2_week_plan_sets_amrap_check')
      if (n('target_rir_max') !== null && !(n('target_rir') !== null && (n('target_rir_max') as number) >= (n('target_rir') as number))) fail('check violation: v2_week_plan_sets_target_rir_max_check')
      break
    }
    default:
      break
  }
}

// Rows that point at a row about to go, as the tables' foreign keys have them (checked against a replayed database in the
// scratch run): `on delete cascade` takes the rows with it (a stage goes with its head; a program exercise takes its
// default sets and every session row and set that names it), `on delete set null` clears the link (a planned set's link to
// a program set, an exercise's superset block).
function deleteRow(db: Db, table: TableName, id: string): void {
  const rows = db[table] as Array<{ id: string }>
  const at = rows.findIndex((r) => r.id === id)
  if (at < 0) return // a cascade that already took it
  rows.splice(at, 1)
  if (table === 'v2_week_plan_sets') {
    for (const child of db.v2_week_plan_sets.filter((r) => r.parent_week_plan_set_id === id)) deleteRow(db, 'v2_week_plan_sets', child.id)
  } else if (table === 'v2_program_sets') {
    for (const child of db.v2_program_sets.filter((r) => r.parent_program_set_id === id)) deleteRow(db, 'v2_program_sets', child.id)
    for (const w of db.v2_week_plan_sets) if (w.program_set_id === id) w.program_set_id = null
  } else if (table === 'v2_program_exercises') {
    // `replaces_program_exercise_id` is `on delete set null` (043): the row that replaced this one stays, and no longer says so
    for (const e of db.v2_program_exercises) if (e.replaces_program_exercise_id === id) e.replaces_program_exercise_id = null
    for (const s of db.v2_program_sets.filter((r) => r.program_exercise_id === id)) deleteRow(db, 'v2_program_sets', s.id)
    for (const r of db.v2_week_plan_exercises.filter((x) => x.program_exercise_id === id)) deleteRow(db, 'v2_week_plan_exercises', r.id)
    for (const r of db.v2_week_plan_sets.filter((x) => x.program_exercise_id === id)) deleteRow(db, 'v2_week_plan_sets', r.id)
  } else if (table === 'v2_program_superset_blocks') {
    for (const e of db.v2_program_exercises) if (e.superset_block_id === id) e.superset_block_id = null
  }
}

// A plain INSERT outside an op list (the app's own write functions insert set rows one by one): the row goes in, and the
// foreign keys, checks and unique indexes are the table's (an OpsError otherwise).
export function checkInserted(db: Db, table: TableName, row: object): void {
  ;(db[table] as unknown[]).push(row)
  checkRow(db, table, row as Record<string, unknown>)
}

// `v2_apply_ops(p_ops)`: the ops in order, all or none (the input db is left as it was and a copy is returned).
export function applyOpsToDb(input: Db, ops: readonly Op[], userId: string = USER): Db {
  const db = cloneDb(input)
  ops.forEach((op, i) => {
    const at = `op ${i + 1} (${op.op} ${op.table})`
    try {
      if (!OP_TABLES.has(op.table)) fail('table not allowed')
      if (op.op === 'insert') {
        if (!(op.table in INSERT_COLUMNS)) fail('insert not allowed')
        const row = op.row as unknown as Record<string, unknown>
        for (const c of INSERT_COLUMNS[op.table]) if (!(c in row)) fail(`the row has no ${c}`)
        for (const c of Object.keys(row)) if (!INSERT_COLUMNS[op.table].includes(c)) fail(`the row names an unknown column ${c}`)
        if (typeof row.id !== 'string' || row.id.length === 0) fail('an insert needs its own id')
        if (exists(db, op.table as TableName, row.id)) fail(`duplicate key value violates unique constraint "${op.table}_pkey"`)
        const stored = { ...row, user_id: userId }
        ;(db[op.table as TableName] as unknown[]).push(stored)
        checkRow(db, op.table, stored)
      } else if (op.op === 'update') {
        const patch = op.patch as Record<string, unknown>
        if (Object.keys(patch).length === 0) fail('patch is empty') // 043 refuses a patch with nothing in it (planProgramChange never writes one)
        for (const c of Object.keys(patch)) {
          if (c === 'id' || c === 'user_id') fail('patch sets a protected column')
          if (op.table === 'v2_week_plans' && c !== 'deload_restore') fail('patch sets a protected column')
          if (!PATCH_COLUMNS[op.table]?.includes(c)) fail(`the patch names an unknown column ${c}`)
        }
        const row = (db[op.table as TableName] as unknown as Array<Record<string, unknown>>).find((r) => r.id === op.id && r.user_id === userId)
        if (!row) fail(`row not found: ${op.table}/${op.id}`)
        Object.assign(row, patch)
        checkRow(db, op.table, row)
      } else {
        if ((op.table as string) === 'v2_week_plans') fail('delete not allowed')
        const row = (db[op.table as TableName] as unknown as Array<Record<string, unknown>>).find((r) => r.id === op.id && r.user_id === userId)
        if (!row) fail(`row not found: ${op.table}/${op.id}`)
        deleteRow(db, op.table as TableName, op.id)
      }
    } catch (e) {
      if (e instanceof OpsError) throw new OpsError(`${at}: ${e.message}`)
      throw e
    }
  })
  return db
}

// ─── What a screen would pass in, from the rows ────────────────────────────────────────────────────────────────────

export function runCopyOf(db: Db, programId: string, mesocycleId: string): ProgramChangeRunCopy {
  const program = db.v2_programs.find((p) => p.id === programId)!
  const workouts = db.v2_workout_days.filter((w) => w.program_id === programId)
  const ids = new Set(workouts.map((w) => w.id))
  const exercises = db.v2_program_exercises.filter((e) => ids.has(e.workout_day_id))
  const exerciseIds = new Set(exercises.map((e) => e.id))
  return {
    programId,
    mesocycleId,
    schedule: fullDays(program.schedule),
    workouts: workouts.map((w) => ({ id: w.id, name: w.name, position: w.position })),
    exercises: exercises.map((e) => ({
      id: e.id,
      workoutDayId: e.workout_day_id,
      exerciseId: e.exercise_id,
      position: e.position,
      weightUnit: e.weight_unit,
      supersetBlockId: e.superset_block_id,
      restSeconds: e.rest_seconds,
      restAfterSeconds: e.rest_after_seconds,
      tempo: e.tempo,
      weekOnly: e.week_only,
      removedAt: e.removed_at,
    })),
    sets: db.v2_program_sets
      .filter((s) => exerciseIds.has(s.program_exercise_id))
      .map((s) => ({
        id: s.id,
        programExerciseId: s.program_exercise_id,
        position: s.position,
        isWarmup: s.is_warmup,
        stageKind: s.stage_kind,
        stageRestSeconds: s.stage_rest_seconds,
        parentProgramSetId: s.parent_program_set_id,
        stageIndex: s.stage_index,
        repMin: s.rep_min,
        repMax: s.rep_max,
        isAmrap: s.is_amrap,
        restSeconds: s.rest_seconds,
        removedAt: s.removed_at,
      })),
    blocks: db.v2_program_superset_blocks
      .filter((b) => ids.has(b.workout_day_id))
      .map((b) => ({ id: b.id, restWithinRoundSeconds: b.rest_within_round_seconds, restAfterRoundSeconds: b.rest_after_round_seconds })),
    routine: db.v2_workout_warmup_items
      .filter((r) => ids.has(r.workout_day_id))
      .map((r) => ({ id: r.id, workoutDayId: r.workout_day_id, position: r.position, body: r.body })),
  }
}

export function fullDays(schedule: Record<string, string | null>): WeeklySchedule {
  const out = {} as WeeklySchedule
  for (const d of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const) out[d] = schedule[d] ?? null
  return out
}

export function scheduleRowsOf(db: Db, mesocycleId: string): RunSchedule[] {
  return db.v2_run_schedules
    .filter((r) => r.mesocycle_id === mesocycleId)
    .map((r) => ({ id: r.id, userId: r.user_id, mesocycleId: r.mesocycle_id, fromWeek: r.from_week, schedule: fullDays(r.schedule), createdAt: '' }))
}

// The plan rows of a run from `fromWeek` on, each with its status (`statuses` by plan id; not started when absent).
export function sessionsOf(db: Db, mesocycleId: string, statuses: Record<string, RunChangeStatus> = {}, fromWeek = 1): ChangeSession[] {
  return db.v2_week_plans
    .filter((p) => p.mesocycle_id === mesocycleId && p.week_number >= fromWeek)
    .map((p) => ({
      id: p.id,
      workoutDayId: p.workout_day_id,
      weekNumber: p.week_number,
      sequencePosition: p.sequence_position,
      status: statuses[p.id] ?? 'not_started',
      deloadRestore: p.deload_restore ?? null,
      exercises: db.v2_week_plan_exercises
        .filter((e) => e.week_plan_id === p.id)
        .map((e) => ({ weekPlanExerciseId: e.id, programExerciseId: e.program_exercise_id, position: e.position })),
      sets: db.v2_week_plan_sets
        .filter((s) => s.week_plan_id === p.id)
        .map(
          (s): ChangeSessionSet => ({
            id: s.id,
            programExerciseId: s.program_exercise_id,
            setNumber: s.set_number,
            parentWeekPlanSetId: s.parent_week_plan_set_id,
            stageIndex: s.stage_index,
            isWarmup: s.is_warmup,
            stageKind: s.stage_kind,
            programSetId: s.program_set_id,
            repMin: s.rep_min,
            repMax: s.rep_max,
            isAmrap: s.is_amrap,
          }),
        ),
    }))
}

// ─── Building a world ──────────────────────────────────────────────────────────────────────────────────────────────

export interface World {
  db: Db
  programId: string
  mesocycleId: string
  planningType: PlanningType
  scheduleType: ScheduleType
  currentWeek: number
}

export function newWorld(over: Partial<Pick<World, 'planningType' | 'scheduleType' | 'currentWeek'>> = {}): World {
  const db = emptyDb()
  db.v2_programs.push({
    id: 'prog',
    user_id: USER,
    name: 'STG Full Body run',
    kind: 'run',
    schedule_type: over.scheduleType ?? 'weekday',
    planning_type: over.planningType ?? 'stable',
    schedule: {},
  })
  db.v2_mesocycles.push({ id: 'meso', user_id: USER, program_id: 'prog' })
  return { db, programId: 'prog', mesocycleId: 'meso', planningType: over.planningType ?? 'stable', scheduleType: over.scheduleType ?? 'weekday', currentWeek: over.currentWeek ?? 2 }
}

export function addWorkout(w: World, id: string, name: string, position: number): void {
  w.db.v2_workout_days.push({ id, user_id: USER, program_id: w.programId, name, position })
}

export function setDays(w: World, days: Record<string, string>): void {
  w.db.v2_programs[0].schedule = { ...days }
}

// A run-copy exercise with its default sets. `sets` is a list of rep targets ('8-10', '12', 'amrap') or, for a set with
// more in it, an object. Positions are the app's: exercises 0-based, sets 1-based.
export interface SetSpec {
  reps?: string // '8-10', '12', 'amrap', '' (none)
  warmup?: boolean
  kind?: StageKind | null
  stages?: string[] // each stage's rep target
  rest?: number | null
  stageRest?: number | null
}

export function repCols(reps: string | undefined): { rep_min: number | null; rep_max: number | null; is_amrap: boolean } {
  if (reps === undefined || reps === '') return { rep_min: null, rep_max: null, is_amrap: false }
  if (reps === 'amrap') return { rep_min: null, rep_max: null, is_amrap: true }
  const [a, b] = reps.split('-').map(Number)
  return { rep_min: a, rep_max: b ?? a, is_amrap: false }
}

export function addExercise(
  w: World,
  id: string,
  workoutId: string,
  exerciseId: string,
  position: number,
  sets: SetSpec[] = [],
  over: Partial<DbProgramExercise> = {},
): void {
  w.db.v2_program_exercises.push({
    id,
    user_id: USER,
    workout_day_id: workoutId,
    exercise_id: exerciseId,
    position,
    weight_unit: null,
    superset_block_id: null,
    rest_seconds: null,
    rest_after_seconds: null,
    tempo: null,
    week_only: false,
    removed_at: null,
    replaces_program_exercise_id: null,
    ...over,
  })
  sets.forEach((spec, i) => {
    const head = `${id}-s${i + 1}`
    w.db.v2_program_sets.push({
      id: head,
      user_id: USER,
      program_exercise_id: id,
      position: i + 1,
      is_warmup: spec.warmup ?? false,
      stage_kind: spec.kind ?? null,
      stage_rest_seconds: spec.stageRest ?? null,
      parent_program_set_id: null,
      stage_index: 0,
      ...repCols(spec.reps),
      rest_seconds: spec.rest ?? null,
      removed_at: null,
    })
    ;(spec.stages ?? []).forEach((reps, j) => {
      w.db.v2_program_sets.push({
        id: `${head}-t${j + 1}`,
        user_id: USER,
        program_exercise_id: id,
        position: i + 1,
        is_warmup: false,
        stage_kind: null,
        stage_rest_seconds: null,
        parent_program_set_id: head,
        stage_index: j + 1,
        ...repCols(reps),
        rest_seconds: null,
        removed_at: null,
      })
    })
  })
}

export function addBlock(w: World, id: string, workoutId: string, within: number | null, after: number | null): void {
  w.db.v2_program_superset_blocks.push({ id, user_id: USER, workout_day_id: workoutId, rest_within_round_seconds: within, rest_after_round_seconds: after })
}

export function addRoutine(w: World, workoutId: string, bodies: string[], positions?: number[]): void {
  bodies.forEach((body, i) => {
    w.db.v2_workout_warmup_items.push({ id: `${workoutId}-r${i + 1}`, user_id: USER, workout_day_id: workoutId, position: positions ? positions[i] : i, body })
  })
}

// One planned session (a `v2_week_plans` row) planned from the run copy the way `v2_plan_week`'s program branch plans a
// stable week (set_number := the program set's position, `program_set_id` := the program set, no weight, no RIR) or,
// for a week-dependent run, as week 1 does. `exercises` limits it to some of the workout's live exercises.
export function planSession(
  w: World,
  planId: string,
  workoutId: string,
  weekNumber: number,
  opts: { sequencePosition?: number | null; isDeload?: boolean; weights?: number } = {},
): void {
  w.db.v2_week_plans.push({
    id: planId,
    user_id: USER,
    mesocycle_id: w.mesocycleId,
    workout_day_id: workoutId,
    week_number: weekNumber,
    is_deload: opts.isDeload ?? false,
    sequence_position: opts.sequencePosition ?? null,
  })
  const live = w.db.v2_program_exercises.filter((e) => e.workout_day_id === workoutId && !e.week_only && !e.removed_at).sort((a, b) => a.position - b.position)
  for (const e of live) {
    w.db.v2_week_plan_exercises.push({ id: `${planId}-x-${e.id}`, user_id: USER, week_plan_id: planId, program_exercise_id: e.id, position: e.position })
    const sets = w.db.v2_program_sets.filter((s) => s.program_exercise_id === e.id && !s.removed_at)
    const heads = sets.filter((s) => s.parent_program_set_id === null).sort((a, b) => a.position - b.position)
    for (const h of heads) {
      const headId = `${planId}-${h.id}`
      w.db.v2_week_plan_sets.push({
        id: headId,
        user_id: USER,
        week_plan_id: planId,
        program_exercise_id: e.id,
        set_number: h.position,
        // the numbers a user types: every set carries a weight and a RIR, so a test can see them survive (or not)
        target_rir: 2,
        target_rir_max: null,
        is_dropset: false,
        parent_week_plan_set_id: null,
        stage_index: 0,
        is_warmup: h.is_warmup,
        program_set_id: h.id,
        stage_kind: h.stage_kind,
        target_weight: opts.weights ?? 60,
        rep_min: h.rep_min,
        rep_max: h.rep_max,
        is_amrap: h.is_amrap,
        tags: ['push here'],
      })
      for (const st of sets.filter((x) => x.parent_program_set_id === h.id).sort((a, b) => a.stage_index - b.stage_index)) {
        w.db.v2_week_plan_sets.push({
          id: `${planId}-${st.id}`,
          user_id: USER,
          week_plan_id: planId,
          program_exercise_id: e.id,
          set_number: st.position,
          target_rir: 1,
          target_rir_max: null,
          is_dropset: true,
          parent_week_plan_set_id: headId,
          stage_index: st.stage_index,
          is_warmup: false,
          program_set_id: st.id,
          stage_kind: null,
          target_weight: (opts.weights ?? 60) - 10,
          rep_min: st.rep_min,
          rep_max: st.rep_max,
          is_amrap: st.is_amrap,
          tags: null,
        })
      }
    }
  }
}

// A session's set rows by the program set they came from, to change one the way a user does in Plan ("this week only").
export function weekSetOf(w: World, planId: string, programSetId: string): DbWeekPlanSet {
  return w.db.v2_week_plan_sets.find((s) => s.week_plan_id === planId && s.program_set_id === programSetId)!
}

// ─── Running the planner on a world ───────────────────────────────────────────────────────────────────────────────

export interface RunOptions {
  statuses?: Record<string, RunChangeStatus>
  currentWeek?: number
  newId?: () => string
  fromWeek?: number // plan rows with a smaller week are not passed (the screen passes the current week on)
}

export function inputOf(w: World, edit: ProgramEdit, opts: RunOptions = {}): ProgramChangeInput {
  const currentWeek = opts.currentWeek ?? w.currentWeek
  return {
    userId: USER,
    now: NOW,
    newId: opts.newId ?? idGen(),
    planningType: w.planningType,
    scheduleType: w.scheduleType,
    currentWeek,
    runCopy: runCopyOf(w.db, w.programId, w.mesocycleId),
    scheduleRows: scheduleRowsOf(w.db, w.mesocycleId),
    sessions: sessionsOf(w.db, w.mesocycleId, opts.statuses ?? {}, opts.fromWeek ?? currentWeek),
    edit,
  }
}

export function planOf(w: World, edit: ProgramEdit, opts: RunOptions = {}): ProgramChangePlan {
  return planProgramChange(inputOf(w, edit, opts))
}

// ─── Reading an op list ─────────────────────────────────────────────────────────────────────────────────────────

export function inserts<T extends InsertableTable>(ops: readonly Op[], table: T): Array<Extract<InsertOp, { table: T }>>
export function inserts(ops: readonly Op[]): InsertOp[]
export function inserts(ops: readonly Op[], table?: OpTable): InsertOp[] {
  return ops.filter((o): o is InsertOp => o.op === 'insert' && (!table || o.table === table))
}
export function updates<T extends OpTable>(ops: readonly Op[], table: T): Array<Extract<UpdateOp, { table: T }>>
export function updates(ops: readonly Op[]): UpdateOp[]
export function updates(ops: readonly Op[], table?: OpTable): UpdateOp[] {
  return ops.filter((o): o is UpdateOp => o.op === 'update' && (!table || o.table === table))
}
export function deletes<T extends OpTable>(ops: readonly Op[], table: T): Array<Extract<DeleteOp, { table: T }>>
export function deletes(ops: readonly Op[]): DeleteOp[]
export function deletes(ops: readonly Op[], table?: OpTable): DeleteOp[] {
  return ops.filter((o): o is DeleteOp => o.op === 'delete' && (!table || o.table === table))
}

// The ops that name a row of a plan (a session): its exercise rows and set rows (by the ids in `db` and in the inserts).
export function opsOnSession(db: Db, ops: readonly Op[], planId: string): Op[] {
  const exRows = new Set(db.v2_week_plan_exercises.filter((e) => e.week_plan_id === planId).map((e) => e.id))
  const setRows = new Set(db.v2_week_plan_sets.filter((s) => s.week_plan_id === planId).map((s) => s.id))
  return ops.filter((o) => {
    if (o.table === 'v2_week_plan_exercises') return o.op === 'insert' ? (o.row as { week_plan_id: string }).week_plan_id === planId : exRows.has(o.id)
    if (o.table === 'v2_week_plan_sets') return o.op === 'insert' ? (o.row as { week_plan_id: string }).week_plan_id === planId : setRows.has(o.id)
    return false
  })
}

export const sessionTables: ReadonlySet<string> = new Set(['v2_week_plan_exercises', 'v2_week_plan_sets'])
export const onlyRunCopy = (ops: readonly Op[]) => ops.filter((o) => !sessionTables.has(o.table))
export const onlySessions = (ops: readonly Op[]) => ops.filter((o) => sessionTables.has(o.table))

// Deep-freeze an input so a function that changes what it was given throws.
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  }
  return value
}

// ─── Editing a draft the way a screen does ─────────────────────────────────────────────────────────────────────────

export function editWorkout(edit: ProgramEdit, workoutId: string, fn: (w: DraftWorkout) => DraftWorkout): ProgramEdit {
  return { ...edit, workouts: edit.workouts.map((w) => (w.id === workoutId ? fn(w) : w)) }
}

export function editExercises(edit: ProgramEdit, workoutId: string, fn: (list: readonly DraftExercise[]) => readonly DraftExercise[]): ProgramEdit {
  return editWorkout(edit, workoutId, (w) => ({ ...w, exercises: fn(w.exercises) }))
}

const idOf = (e: DraftExercise) => (e.kind === 'kept' ? e.id : e.kind === 'swapped' ? e.replaces : null)

export const removeExerciseFrom = (edit: ProgramEdit, workoutId: string, id: string) =>
  editExercises(edit, workoutId, (list) => list.filter((e) => idOf(e) !== id))

// Change fields of one exercise entry (kept, swapped or added; found by the row id it is or replaces).
export const patchExercise = (edit: ProgramEdit, workoutId: string, id: string, patch: Partial<DraftExercise>) =>
  editExercises(edit, workoutId, (list) => list.map((e) => (idOf(e) === id ? ({ ...e, ...patch } as DraftExercise) : e)))

export const swapExerciseIn = (edit: ProgramEdit, workoutId: string, id: string, exerciseId: string, over: Partial<DraftExercise> = {}) =>
  editExercises(edit, workoutId, (list) =>
    list.map((e) => {
      if (idOf(e) !== id || e.kind !== 'kept') return e
      const { kind: _kind, id: _id, ...fields } = e
      void _kind
      void _id
      // a swap starts with no rest, tempo or unit of its own and keeps the old row's superset block
      return {
        kind: 'swapped',
        replaces: id,
        exerciseId,
        ...fields,
        restSeconds: null,
        restAfterSeconds: null,
        tempo: null,
        weightUnit: null,
        ...over,
      } as DraftExercise
    }),
  )

export const addExerciseTo = (edit: ProgramEdit, workoutId: string, entry: Partial<DraftExercise> & { exerciseId: string }, at?: number) =>
  editExercises(edit, workoutId, (list) => {
    const added = {
      kind: 'added',
      supersetBlockId: null,
      restSeconds: null,
      restAfterSeconds: null,
      tempo: null,
      weightUnit: null,
      ...entry,
    } as DraftExercise
    const next = [...list]
    next.splice(at ?? next.length, 0, added)
    return next
  })

export const moveExercise = (edit: ProgramEdit, workoutId: string, from: number, to: number) =>
  editExercises(edit, workoutId, (list) => {
    const next = [...list]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    return next
  })

// The sets of one kept exercise, edited.
export const editSetsOf = (edit: ProgramEdit, workoutId: string, id: string, fn: (sets: readonly DraftSet[]) => readonly DraftSet[]) =>
  editExercises(edit, workoutId, (list) => list.map((e) => (idOf(e) === id ? ({ ...e, sets: fn(e.sets ?? []) } as DraftExercise) : e)))

export const newSet = (reps: string, over: Partial<DraftSet> = {}): DraftSet => {
  const c = repCols(reps)
  return {
    id: null,
    isWarmup: false,
    stageKind: null,
    repMin: c.rep_min,
    repMax: c.rep_max,
    isAmrap: c.is_amrap,
    restSeconds: null,
    stageRestSeconds: null,
    stages: [],
    ...over,
  }
}

export const withReps = (set: DraftSet, reps: string): DraftSet => {
  const c = repCols(reps)
  return { ...set, repMin: c.rep_min, repMax: c.rep_max, isAmrap: c.is_amrap }
}
