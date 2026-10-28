// A stateful in-memory stand-in for the slice of Supabase a deload mark and unmark touch
// (chunk 48's "the screen marks with the Settings rules" proofs): the v2_week_plans reads in
// the three select shapes weekPlanService.ts uses on that path (the full read the page makes,
// the one-row core read and the per-slot history), the writes (the snapshot-and-flag update,
// the delete of a week's sets, the inserts of the calculated or restored sets, the flag-only
// update) applied to the rows so a later read sees them, and every write recorded so a test
// can assert the exact payloads. A read of any other table, or of a select shape it doesn't
// know, throws, so a test can't pass by silently reading nothing (Checks that lied #11 / #33).
//
// It enforces the one database rule this path can break: migration 042's check on
// v2_week_plan_sets (`target_rir_max is null or (target_rir is not null and target_rir_max >=
// target_rir)`), answered like PostgREST does (code 23514), so a RIR range the app writes that
// the database would refuse fails the test the way it would fail the user.

export interface FakeCall {
  table: string
  method: string
  args: unknown[]
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

export interface FakeExerciseSlot {
  week_plan_id: string
  program_exercise_id: string
  exercise_id: string
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

export function createFakeDeloadDb(initial: { plans: FakePlanRow[]; sets: FakeSetRow[]; exercises: FakeExerciseSlot[] }) {
  const state = {
    plans: JSON.parse(JSON.stringify(initial.plans)) as FakePlanRow[],
    sets: JSON.parse(JSON.stringify(initial.sets)) as FakeSetRow[],
  }
  const writes: FakeCall[] = []
  let insertCounter = 0

  const setsOf = (planId: string) => state.sets.filter((s) => s.week_plan_id === planId).map((s) => ({ ...s }))
  const slotsOf = (planId: string) =>
    initial.exercises
      .filter((e) => e.week_plan_id === planId)
      .map((e) => ({ program_exercise_id: e.program_exercise_id, v2_program_exercises: { exercise_id: e.exercise_id } }))

  function planShape(plan: FakePlanRow, select: string): unknown {
    // The page's own read (fetchWeekPlans / fetchAllWeekPlansForMeso, and markWeekDeload's): the row, its sets, no exercise cards.
    if (select.startsWith('*, v2_week_plan_sets(*)')) {
      return { ...plan, v2_week_plan_sets: setsOf(plan.id), v2_week_plan_exercises: [] }
    }
    // fetchDeloadWeekPlanCore: the one row a mark or unmark works on.
    if (select.startsWith('mesocycle_id, workout_day_id, week_number, sequence_position, deload_restore')) {
      return {
        mesocycle_id: plan.mesocycle_id, workout_day_id: plan.workout_day_id, week_number: plan.week_number,
        sequence_position: plan.sequence_position, deload_restore: plan.deload_restore,
        v2_week_plan_sets: setsOf(plan.id), v2_week_plan_exercises: slotsOf(plan.id),
      }
    }
    // fetchDeloadOccurrenceHistory: one slot's earlier weeks.
    if (select.startsWith('week_number, is_deload, v2_week_plan_sets(*)')) {
      return { week_number: plan.week_number, is_deload: plan.is_deload, v2_week_plan_sets: setsOf(plan.id), v2_week_plan_exercises: slotsOf(plan.id) }
    }
    throw new Error(`fakeDeloadDb: unexpected v2_week_plans select: ${select}`)
  }

  function from(table: string) {
    const q: {
      select: string
      eq: [string, unknown][]
      is: [string, unknown][]
      lt: [string, number][]
      op: 'read' | 'insert' | 'update' | 'delete'
      payload: unknown
    } = { select: '', eq: [], is: [], lt: [], op: 'read', payload: undefined }

    const matches = (row: object) => {
      const r = row as Record<string, unknown>
      return (
        q.eq.every(([col, val]) => r[col] === val) &&
        q.is.every(([col, val]) => (r[col] ?? null) === val) &&
        q.lt.every(([col, val]) => (r[col] as number) < val)
      )
    }

    function run(single: boolean): { data: unknown; error: unknown } {
      if (q.op === 'read') {
        if (table === 'v2_sessions' || table === 'v2_set_logs') return { data: [], error: null } // nothing was ever started
        if (table !== 'v2_week_plans') throw new Error(`fakeDeloadDb: unexpected read of ${table}`)
        const rows = state.plans.filter(matches).map((p) => planShape(p, q.select))
        if (!single) return { data: rows, error: null }
        return rows.length > 0 ? { data: rows[0], error: null } : { data: null, error: new Error('no rows') }
      }
      if (table === 'v2_week_plans' && q.op === 'update') {
        for (const plan of state.plans.filter(matches)) Object.assign(plan, q.payload)
        return { data: null, error: null }
      }
      if (table === 'v2_week_plan_sets' && q.op === 'delete') {
        state.sets = state.sets.filter((s) => !matches(s))
        return { data: null, error: null }
      }
      if (table === 'v2_week_plan_sets' && q.op === 'insert') {
        const p = q.payload as Partial<FakeSetRow>
        insertCounter += 1
        const row = fakeSet(p.week_plan_id as string, `new-${insertCounter}`, p.set_number as number, p)
        // migration 042: v2_week_plan_sets_target_rir_max_check
        if (!(row.target_rir_max === null || (row.target_rir !== null && row.target_rir_max >= row.target_rir))) {
          return { data: null, error: { code: '23514', message: 'new row for relation "v2_week_plan_sets" violates check constraint "v2_week_plan_sets_target_rir_max_check"' } }
        }
        state.sets.push(row)
        return { data: { id: row.id }, error: null }
      }
      throw new Error(`fakeDeloadDb: unexpected ${q.op} on ${table}`)
    }

    const chain: Record<string, unknown> = {}
    chain.select = (s?: string) => {
      if (q.op === 'read') q.select = s ?? '*'
      return chain
    }
    chain.eq = (col: string, val: unknown) => (q.eq.push([col, val]), chain)
    chain.is = (col: string, val: unknown) => (q.is.push([col, val]), chain)
    chain.lt = (col: string, val: number) => (q.lt.push([col, val]), chain)
    chain.insert = (payload: unknown) => (writes.push({ table, method: 'insert', args: [payload] }), (q.op = 'insert'), (q.payload = payload), chain)
    chain.update = (payload: unknown) => (writes.push({ table, method: 'update', args: [payload] }), (q.op = 'update'), (q.payload = payload), chain)
    chain.delete = () => (writes.push({ table, method: 'delete', args: [] }), (q.op = 'delete'), chain)
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
    writes.push({ table: 'rpc', method: name, args: [args] })
    return Promise.resolve({ data: 0, error: null })
  }

  return { client: { from, rpc }, state, writes }
}
