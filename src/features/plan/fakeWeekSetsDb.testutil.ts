// A stateful in-memory stand-in for the slice of Supabase Plan's set rows touch (chunk 54a's "every writer, end to end" proofs): the
// v2_week_plans read in the one select shape weekPlanService.ts uses for a week's plans (the row with its sets and its exercise cards),
// and the three writes a set row makes (insert of a new set or stage, update of named columns, delete) APPLIED to the rows, so the page
// refetches what a user would see; every write recorded, in order, so a test can assert the exact requests. A read of any other table, or
// in any other shape, throws, so a test can't pass by silently reading nothing (Checks that lied #11 / #33).
//
// It enforces what the database enforces on v2_week_plan_sets, answered like PostgREST does (code 23514 for a check, 23503 for a key), so a
// write the app makes that the database would refuse fails the test the way it would fail the user (RULES: a stateful stand-in models the
// checks and the cascade, with a control that can refuse):
//   - v2_week_plan_sets_stage_row_check        parent_week_plan_set_id is null or stage_kind is null          (027)
//   - stage_kind in (dropset, rest_pause, myo_reps, cluster)                                                   (027)
//   - target_weight >= 0, rep_min > 0                                                                          (027)
//   - v2_week_plan_sets_rep_max_check          rep_max is null or (rep_min is not null and rep_max >= rep_min)  (027)
//   - v2_week_plan_sets_amrap_check            not is_amrap or (rep_min is null and rep_max is null)           (027)
//   - v2_week_plan_sets_target_rir_max_check   target_rir_max is null or (target_rir is not null and target_rir_max >= target_rir)  (042)
//   - parent_week_plan_set_id references an existing set, and removing a set removes its stages (on delete cascade, 004)
// and a refusal a test asks for: `db.refuse = (write) => 'message' | null` is asked before each write to v2_week_plan_sets and answers it with
// that message (code 42501, as a row-level-security refusal does), leaving the rows as they were. A write is applied whole or not at all.

export interface FakeCall {
  table: string
  method: 'insert' | 'update' | 'delete' | 'select' | 'rpc'
  args: unknown[]
  /** The `.eq(column, value)` filters the write carried, e.g. [['id', 'set-1']]. */
  eq?: [string, unknown][]
}

export interface FakeSetRow {
  id: string
  week_plan_id: string
  user_id: string
  program_exercise_id: string
  set_number: number
  target_rir: number | null
  target_rir_max: number | null
  is_dropset: boolean
  parent_week_plan_set_id: string | null
  stage_index: number
  is_warmup: boolean
  program_set_id: string | null
  stage_kind: string | null
  target_weight: number | null
  rep_min: number | null
  rep_max: number | null
  is_amrap: boolean
  tags: string[] | null
}

export interface FakePlanRow {
  id: string
  user_id: string
  mesocycle_id: string
  workout_day_id: string
  week_number: number
  is_deload: boolean
  notes: null
  created_at: string
  sequence_position: number | null
  deload_restore: unknown
}

/** One exercise card of a plan: the exercise row (name, muscle) the page draws it with. */
export interface FakeExerciseCard {
  week_plan_id: string
  program_exercise_id: string
  position: number
  exercise_id: string
  name: string
  muscle_group: string
  weight_unit?: 'kg' | 'lbs' | null
  superset_block_id?: string | null
}

export function fakePlan(id: string, weekNumber: number, overrides: Partial<FakePlanRow> = {}): FakePlanRow {
  return {
    id, user_id: 'user-1', mesocycle_id: 'meso-1', workout_day_id: 'wd-1', week_number: weekNumber,
    is_deload: false, notes: null, created_at: '2026-01-01T00:00:00Z', sequence_position: null, deload_restore: null,
    ...overrides,
  }
}

export function fakeSet(weekPlanId: string, id: string, setNumber: number, overrides: Partial<FakeSetRow> = {}): FakeSetRow {
  return {
    id, week_plan_id: weekPlanId, user_id: 'user-1', program_exercise_id: 'pe-a', set_number: setNumber,
    target_rir: null, target_rir_max: null, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0,
    is_warmup: false, program_set_id: null, stage_kind: null, target_weight: null, rep_min: null, rep_max: null,
    is_amrap: false, tags: null,
    ...overrides,
  }
}

/** A stage row under `parentId`: it shares its head's number, `is_dropset` true, no kind of its own. */
export function fakeStage(weekPlanId: string, id: string, parentId: string, setNumber: number, stageIndex: number, overrides: Partial<FakeSetRow> = {}): FakeSetRow {
  return fakeSet(weekPlanId, id, setNumber, { is_dropset: true, parent_week_plan_set_id: parentId, stage_index: stageIndex, ...overrides })
}

export type FakeWrite =
  | { op: 'insert'; payload: Record<string, unknown> }
  | { op: 'update'; id: string; patch: Record<string, unknown> }
  | { op: 'delete'; id: string }

const STAGE_KINDS = ['dropset', 'rest_pause', 'myo_reps', 'cluster']

function checkViolation(constraint: string, relation = 'v2_week_plan_sets') {
  return { code: '23514', message: `new row for relation "${relation}" violates check constraint "${constraint}"` }
}

/** The first check a row breaks, or null. */
function violation(row: FakeSetRow): { code: string; message: string } | null {
  if (row.parent_week_plan_set_id !== null && row.stage_kind !== null) return checkViolation('v2_week_plan_sets_stage_row_check')
  if (row.stage_kind !== null && !STAGE_KINDS.includes(row.stage_kind)) return checkViolation('v2_week_plan_sets_stage_kind_check')
  if (row.target_weight !== null && row.target_weight < 0) return checkViolation('v2_week_plan_sets_target_weight_check')
  if (row.rep_min !== null && row.rep_min <= 0) return checkViolation('v2_week_plan_sets_rep_min_check')
  if (!(row.rep_max === null || (row.rep_min !== null && row.rep_max >= row.rep_min))) return checkViolation('v2_week_plan_sets_rep_max_check')
  if (row.is_amrap && (row.rep_min !== null || row.rep_max !== null)) return checkViolation('v2_week_plan_sets_amrap_check')
  if (!(row.target_rir_max === null || (row.target_rir !== null && row.target_rir_max >= row.target_rir))) return checkViolation('v2_week_plan_sets_target_rir_max_check')
  return null
}

export function createFakeWeekSetsDb(initial: { plans: FakePlanRow[]; sets: FakeSetRow[]; cards: FakeExerciseCard[] }) {
  const state = {
    plans: JSON.parse(JSON.stringify(initial.plans)) as FakePlanRow[],
    sets: JSON.parse(JSON.stringify(initial.sets)) as FakeSetRow[],
  }
  const writes: FakeCall[] = []
  let insertCounter = 0
  const db = {
    client: undefined as unknown as { from: (table: string) => unknown; rpc: (name: string, args: unknown) => Promise<unknown> },
    state,
    writes,
    /** Asked before each write to v2_week_plan_sets; a message refuses it (nothing is applied). */
    refuse: null as ((write: FakeWrite) => string | null) | null,
  }

  const setsOf = (planId: string) => state.sets.filter((s) => s.week_plan_id === planId).map((s) => ({ ...s }))
  const cardsOf = (planId: string) =>
    initial.cards
      .filter((c) => c.week_plan_id === planId)
      .map((c) => ({
        id: `wpe-${planId}-${c.program_exercise_id}`,
        week_plan_id: planId,
        user_id: 'user-1',
        program_exercise_id: c.program_exercise_id,
        position: c.position,
        carry_program_exercise_id: null,
        carry_position: null,
        created_at: '2026-01-01T00:00:00Z',
        v2_program_exercises: {
          id: c.program_exercise_id,
          workout_day_id: 'wd-1',
          user_id: 'user-1',
          exercise_id: c.exercise_id,
          position: c.position,
          weight_unit: c.weight_unit ?? null,
          superset_block_id: c.superset_block_id ?? null,
          exercises: {
            id: c.exercise_id, user_id: 'user-1', name: c.name, muscle_group: c.muscle_group, is_archived: false, created_at: '',
            muscle_subgroup: null, movement_pattern: null, status: 'active', source_library_id: null, lost_at: null,
          },
        },
      }))

  function planShape(plan: FakePlanRow, select: string): unknown {
    if (select.startsWith('*, v2_week_plan_sets(*)')) {
      return { ...plan, v2_week_plan_sets: setsOf(plan.id), v2_week_plan_exercises: cardsOf(plan.id) }
    }
    throw new Error(`fakeWeekSetsDb: unexpected v2_week_plans select: ${select}`)
  }

  function from(table: string) {
    const q: {
      select: string
      eq: [string, unknown][]
      is: [string, unknown][]
      lt: [string, number][]
      op: 'read' | 'insert' | 'update' | 'delete'
      payload: Record<string, unknown> | undefined
    } = { select: '', eq: [], is: [], lt: [], op: 'read', payload: undefined }

    const matches = (row: object) => {
      const r = row as Record<string, unknown>
      return (
        q.eq.every(([col, val]) => r[col] === val) &&
        q.is.every(([col, val]) => (r[col] ?? null) === val) &&
        q.lt.every(([col, val]) => (r[col] as number) < val)
      )
    }

    const refusal = (write: FakeWrite) => {
      const message = db.refuse?.(write) ?? null
      return message === null ? null : { data: null, error: { code: '42501', message } }
    }

    // Removing a set removes the sets under it, however deep (on delete cascade).
    function removeWithStages(id: string) {
      const gone = new Set<string>([id])
      let grew = true
      while (grew) {
        grew = false
        for (const s of state.sets) {
          if (s.parent_week_plan_set_id !== null && gone.has(s.parent_week_plan_set_id) && !gone.has(s.id)) {
            gone.add(s.id)
            grew = true
          }
        }
      }
      state.sets = state.sets.filter((s) => !gone.has(s.id))
    }

    function run(single: boolean): { data: unknown; error: unknown } {
      if (q.op === 'read') {
        if (table !== 'v2_week_plans') throw new Error(`fakeWeekSetsDb: unexpected read of ${table}`)
        const rows = state.plans.filter(matches).map((p) => planShape(p, q.select))
        if (!single) return { data: rows, error: null }
        return rows.length > 0 ? { data: rows[0], error: null } : { data: null, error: new Error('no rows') }
      }
      if (table !== 'v2_week_plan_sets') throw new Error(`fakeWeekSetsDb: unexpected ${q.op} on ${table}`)

      if (q.op === 'insert') {
        const p = q.payload as Partial<FakeSetRow>
        const refused = refusal({ op: 'insert', payload: q.payload as Record<string, unknown> })
        if (refused) return refused
        insertCounter += 1
        const row = fakeSet(p.week_plan_id as string, `new-${insertCounter}`, p.set_number as number, p)
        if (!state.plans.some((plan) => plan.id === row.week_plan_id)) return { data: null, error: { code: '23503', message: 'insert on "v2_week_plan_sets" violates foreign key constraint (week_plan_id)' } }
        if (row.parent_week_plan_set_id !== null && !state.sets.some((s) => s.id === row.parent_week_plan_set_id)) {
          return { data: null, error: { code: '23503', message: 'insert on "v2_week_plan_sets" violates foreign key constraint (parent_week_plan_set_id)' } }
        }
        const broken = violation(row)
        if (broken) return { data: null, error: broken }
        state.sets.push(row)
        return { data: { ...row }, error: null }
      }

      if (q.op === 'update') {
        const ids = state.sets.filter(matches).map((s) => s.id)
        // Every named filter here is `id` (the app updates one set at a time); a write that matches no row changes nothing and is not an error.
        for (const id of ids) {
          const refused = refusal({ op: 'update', id, patch: q.payload as Record<string, unknown> })
          if (refused) return refused
        }
        const next = state.sets.map((s) => (ids.includes(s.id) ? ({ ...s, ...q.payload } as FakeSetRow) : s))
        for (const row of next) {
          if (!ids.includes(row.id)) continue
          const broken = violation(row)
          if (broken) return { data: null, error: broken }
        }
        state.sets = next
        return { data: null, error: null }
      }

      const ids = state.sets.filter(matches).map((s) => s.id)
      for (const id of ids) {
        const refused = refusal({ op: 'delete', id })
        if (refused) return refused
      }
      for (const id of ids) removeWithStages(id)
      return { data: null, error: null }
    }

    const chain: Record<string, unknown> = {}
    chain.select = (s?: string) => {
      if (q.op === 'read') q.select = s ?? '*'
      return chain
    }
    chain.eq = (col: string, val: unknown) => (q.eq.push([col, val]), chain)
    chain.is = (col: string, val: unknown) => (q.is.push([col, val]), chain)
    chain.lt = (col: string, val: number) => (q.lt.push([col, val]), chain)
    chain.insert = (payload: Record<string, unknown>) => (writes.push({ table, method: 'insert', args: [payload] }), (q.op = 'insert'), (q.payload = payload), chain)
    chain.update = (payload: Record<string, unknown>) => {
      const call: FakeCall = { table, method: 'update', args: [payload], eq: q.eq }
      writes.push(call)
      q.op = 'update'
      q.payload = payload
      return chain
    }
    chain.delete = () => {
      writes.push({ table, method: 'delete', args: [], eq: q.eq })
      q.op = 'delete'
      return chain
    }
    chain.single = () => Promise.resolve(run(true))
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      try {
        return Promise.resolve(run(false)).then(resolve, reject)
      } catch (e) {
        return Promise.reject(e).then(resolve, reject)
      }
    }
    return chain
  }

  function rpc(name: string, args: unknown) {
    writes.push({ table: 'rpc', method: 'rpc', args: [name, args] })
    return Promise.resolve({ data: 0, error: null })
  }

  db.client = { from, rpc }
  return db
}
