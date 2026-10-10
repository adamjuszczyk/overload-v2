// An in-memory stand-in for the slice of Supabase the manual COPY path
// touches (chunk 27's "copying ignores stored values" proofs): v2_week_plans
// reads in the three select shapes weekPlanService.ts uses on that path
// (the empty-slot discovery, the per-slot history, and the full source-plan
// read), plus recording every write so a test can assert the exact payloads
// copyOnePlanForward sent. Reads of any other table throw, so a test can't
// pass by silently reading nothing (Checks that lied #11 / #33).
//
// Rows are given in the shape PostgREST returns (snake_case, children
// nested), including the carry_* columns, because the point of those tests
// is that a row WITH stored carry values still copies as its own content.

export interface FakeCall {
  table: string
  method: string
  args: unknown[]
}

export interface FakeProgramExerciseRow {
  id: string
  workout_day_id: string
  user_id: string
  exercise_id: string
  position: number
  weight_unit: null
  exercises: null
}

export interface FakeWeekPlanExerciseRow {
  id: string
  week_plan_id: string
  user_id: string
  program_exercise_id: string
  position: number
  carry_program_exercise_id: string | null
  carry_position: number | null
  created_at: string
  v2_program_exercises: FakeProgramExerciseRow
}

export interface FakeWeekPlanSetRow {
  id: string
  week_plan_id: string
  user_id: string
  program_exercise_id: string
  set_number: number
  target_rir: number | null
  is_dropset: boolean
  parent_week_plan_set_id: string | null
  stage_index: number
}

export interface FakeWeekPlanRow {
  id: string
  user_id: string
  mesocycle_id: string
  workout_day_id: string
  week_number: number
  is_deload: boolean
  notes: null
  created_at: string
  sequence_position: number | null
  v2_week_plan_sets: FakeWeekPlanSetRow[]
  v2_week_plan_exercises: FakeWeekPlanExerciseRow[]
}

export function fakeProgramExercise(id: string, exerciseId: string, position = 0): FakeProgramExerciseRow {
  return { id, workout_day_id: 'wd-1', user_id: 'user-1', exercise_id: exerciseId, position, weight_unit: null, exercises: null }
}

export function fakeWeekPlanExercise(
  weekPlanId: string,
  programExerciseId: string,
  position: number,
  carry: { programExerciseId?: string | null; position?: number | null } = {},
): FakeWeekPlanExerciseRow {
  return {
    id: `wpe-${weekPlanId}-${programExerciseId}`,
    week_plan_id: weekPlanId,
    user_id: 'user-1',
    program_exercise_id: programExerciseId,
    position,
    carry_program_exercise_id: carry.programExerciseId ?? null,
    carry_position: carry.position ?? null,
    created_at: '2026-01-01T00:00:00Z',
    v2_program_exercises: fakeProgramExercise(programExerciseId, `ex-of-${programExerciseId}`, position),
  }
}

export function fakeWeekPlanSet(
  weekPlanId: string,
  id: string,
  programExerciseId: string,
  overrides: Partial<FakeWeekPlanSetRow> = {},
): FakeWeekPlanSetRow {
  return {
    id,
    week_plan_id: weekPlanId,
    user_id: 'user-1',
    program_exercise_id: programExerciseId,
    set_number: 1,
    target_rir: 2,
    is_dropset: false,
    parent_week_plan_set_id: null,
    stage_index: 0,
    ...overrides,
  }
}

export function fakeWeekPlan(
  id: string,
  weekNumber: number,
  children: { sets?: FakeWeekPlanSetRow[]; exercises?: FakeWeekPlanExerciseRow[] } = {},
  overrides: Partial<FakeWeekPlanRow> = {},
): FakeWeekPlanRow {
  return {
    id,
    user_id: 'user-1',
    mesocycle_id: 'meso-1',
    workout_day_id: 'wd-1',
    week_number: weekNumber,
    is_deload: false,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    sequence_position: null,
    v2_week_plan_sets: children.sets ?? [],
    v2_week_plan_exercises: children.exercises ?? [],
    ...overrides,
  }
}

export function createFakeSupabase(weekPlans: FakeWeekPlanRow[]) {
  const writes: FakeCall[] = []
  let insertCounter = 0

  function shape(row: FakeWeekPlanRow, select: string): unknown {
    // copyFromPreviousWeek's discovery of this week's still-empty slots.
    if (select.includes('v2_week_plan_exercises(id)')) {
      return {
        id: row.id,
        workout_day_id: row.workout_day_id,
        sequence_position: row.sequence_position ?? null,
        v2_week_plan_exercises: row.v2_week_plan_exercises.map((e) => ({ id: e.id })),
      }
    }
    // fetchPlannedWeekHistory: one slot's planned weeks, for the source search.
    if (select.startsWith('week_number, is_deload, v2_week_plan_sets(id)')) {
      return {
        week_number: row.week_number,
        is_deload: row.is_deload,
        v2_week_plan_sets: row.v2_week_plan_sets.map((s) => ({ id: s.id })),
      }
    }
    // The full read (fetchWeekPlans / fetchAllWeekPlansForMeso / the copy's
    // own source-plan read): the whole row with its children.
    if (select.startsWith('*, v2_week_plan_sets(*)')) return JSON.parse(JSON.stringify(row))
    throw new Error(`fakeWeekPlanDb: unexpected v2_week_plans select: ${select}`)
  }

  function from(table: string) {
    const state: {
      select: string
      eq: [string, unknown][]
      is: [string, unknown][]
      lt: [string, number][]
      op: 'read' | 'insert' | 'upsert'
      payload: unknown
    } = { select: '', eq: [], is: [], lt: [], op: 'read', payload: undefined }

    function matching(): FakeWeekPlanRow[] {
      return weekPlans.filter((row) => {
        const r = row as unknown as Record<string, unknown>
        return (
          state.eq.every(([col, val]) => r[col] === val) &&
          state.is.every(([col, val]) => (r[col] ?? null) === val) &&
          state.lt.every(([col, val]) => (r[col] as number) < val)
        )
      })
    }

    function readMany(): { data: unknown; error: null } {
      if (table !== 'v2_week_plans') throw new Error(`fakeWeekPlanDb: unexpected read of ${table}`)
      return { data: matching().map((r) => shape(r, state.select)), error: null }
    }

    function readOne(allowNone: boolean): { data: unknown; error: unknown } {
      if (state.op === 'insert') {
        insertCounter += 1
        return { data: { ...(state.payload as Record<string, unknown>), id: `new-${insertCounter}` }, error: null }
      }
      const rows = (readMany().data as unknown[]) ?? []
      if (rows.length === 0) return allowNone ? { data: null, error: null } : { data: null, error: new Error('no rows') }
      return { data: rows[0], error: null }
    }

    const chain: Record<string, unknown> = {}
    chain.select = (s?: string) => {
      if (state.op === 'read') state.select = s ?? '*'
      return chain
    }
    chain.eq = (col: string, val: unknown) => (state.eq.push([col, val]), chain)
    chain.is = (col: string, val: unknown) => (state.is.push([col, val]), chain)
    chain.lt = (col: string, val: number) => (state.lt.push([col, val]), chain)
    chain.insert = (payload: unknown) => {
      writes.push({ table, method: 'insert', args: [payload] })
      state.op = 'insert'
      state.payload = payload
      return chain
    }
    chain.upsert = (payloads: unknown, opts?: unknown) => {
      writes.push({ table, method: 'upsert', args: [payloads, opts] })
      state.op = 'upsert'
      return chain
    }
    chain.maybeSingle = () => Promise.resolve(readOne(true))
    chain.single = () => Promise.resolve(readOne(false))
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      try {
        const result = state.op === 'read' ? readMany() : { data: null, error: null }
        return Promise.resolve(result).then(resolve, reject)
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

  return { client: { from, rpc }, writes }
}
