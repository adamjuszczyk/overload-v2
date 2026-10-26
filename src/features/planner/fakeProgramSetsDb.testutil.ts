// A stateful in-memory stand-in for the slice of Supabase the stepped planner's step 3 touches (chunk 67's "every writer, end to end"
// proofs): v2_program_sets, read in the one shape plannerService.ts's `fetchProgramSets` uses (`select('*').in('program_exercise_id', ids)
// .order('position')`) and written by the five shapes the step makes (insert of one row or a list, update by id or by a list of ids, delete by id
// or by a list of ids), APPLIED to the rows, so the screen refetches what a user would see; every write recorded, in order, so a test can assert the
// exact requests. A read of any other table, or in any other shape, throws, so a test can't pass by silently reading nothing (Checks that lied
// #11 / #33). v2_week_plan_sets is held too, only so a test can prove the step never writes it ("never to a week set": an absence needs a fixture
// where the write would appear): its rows are applied without checks and every write to it is recorded like the others.
//
// It enforces what the database enforces on v2_program_sets (migration 027), answered like PostgREST does (code 23514 for a check, 23503 for a
// key), so a write the app makes that the database would refuse fails the test the way it would fail the user (RULES: a stateful stand-in models the
// checks and the cascade, with a control that can refuse):
//   - v2_program_sets_stage_row_check     a stage (parent set) has no stage kind, no stage rest and is not a warmup
//   - v2_program_sets_warmup_check        a warmup has no stage kind and no parent
//   - v2_program_sets_stage_index_check   stage_index is 0 exactly when there is no parent
//   - stage_kind in (dropset, rest_pause, myo_reps, cluster); position > 0; rep_min > 0; rest and stage rest >= 0
//   - v2_program_sets_rep_max_check and v2_program_sets_amrap_check
//   - parent_program_set_id references an existing set, and removing a set removes its stages (on delete cascade)
// There is no unique key on (program_exercise_id, position), as in the table: two sets can share a position, which is exactly what DECISIONS 213
// is about. A refusal a test asks for: `db.refuse = (write) => 'message' | null` is asked before each write to v2_program_sets and answers it with
// that message (code 42501, as a row-level-security refusal does), leaving the rows as they were. A write is applied whole or not at all.

export interface FakeCall {
  table: string
  method: 'insert' | 'update' | 'delete'
  args: unknown[]
  /** The filters the request carried: `eq` by column, `in` by column. */
  eq: [string, unknown][]
  in: [string, unknown[]][]
}

export interface FakeProgramSetRow {
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

/** A week set the program sets are linked from: opaque to the step, which must never write it. */
export interface FakeWeekSetRow {
  id: string
  program_set_id: string | null
  rep_min: number | null
  rep_max: number | null
  stage_kind: string | null
  is_warmup: boolean
}

export function fakeProgramSet(id: string, programExerciseId: string, position: number, overrides: Partial<FakeProgramSetRow> = {}): FakeProgramSetRow {
  return {
    id,
    user_id: 'user-1',
    program_exercise_id: programExerciseId,
    position,
    is_warmup: false,
    stage_kind: null,
    stage_rest_seconds: null,
    parent_program_set_id: null,
    stage_index: 0,
    rep_min: null,
    rep_max: null,
    is_amrap: false,
    rest_seconds: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** A stage row: it shares its head's position and carries no kind, rest or warmup flag of its own. */
export function fakeProgramStage(id: string, programExerciseId: string, parentId: string, position: number, stageIndex: number, overrides: Partial<FakeProgramSetRow> = {}): FakeProgramSetRow {
  return fakeProgramSet(id, programExerciseId, position, { parent_program_set_id: parentId, stage_index: stageIndex, ...overrides })
}

export type FakeWrite =
  | { op: 'insert'; payload: Record<string, unknown> }
  | { op: 'update'; id: string; patch: Record<string, unknown> }
  | { op: 'delete'; id: string }

const STAGE_KINDS = ['dropset', 'rest_pause', 'myo_reps', 'cluster']

function checkViolation(constraint: string) {
  return { code: '23514', message: `new row for relation "v2_program_sets" violates check constraint "${constraint}"` }
}

/** The first check a row breaks, or null. */
function violation(row: FakeProgramSetRow): { code: string; message: string } | null {
  const staged = row.parent_program_set_id !== null
  if (!(row.position > 0)) return checkViolation('v2_program_sets_position_check')
  if (row.stage_kind !== null && !STAGE_KINDS.includes(row.stage_kind)) return checkViolation('v2_program_sets_stage_kind_check')
  if (row.stage_rest_seconds !== null && row.stage_rest_seconds < 0) return checkViolation('v2_program_sets_stage_rest_seconds_check')
  if (row.rep_min !== null && row.rep_min <= 0) return checkViolation('v2_program_sets_rep_min_check')
  if (row.rest_seconds !== null && row.rest_seconds < 0) return checkViolation('v2_program_sets_rest_seconds_check')
  if (!(row.rep_max === null || (row.rep_min !== null && row.rep_max >= row.rep_min))) return checkViolation('v2_program_sets_rep_max_check')
  if (row.is_amrap && (row.rep_min !== null || row.rep_max !== null)) return checkViolation('v2_program_sets_amrap_check')
  if (!((!staged && row.stage_index === 0) || (staged && row.stage_index > 0))) return checkViolation('v2_program_sets_stage_index_check')
  if (staged && !(row.stage_kind === null && row.stage_rest_seconds === null && !row.is_warmup)) return checkViolation('v2_program_sets_stage_row_check')
  if (row.is_warmup && !(row.stage_kind === null && !staged)) return checkViolation('v2_program_sets_warmup_check')
  return null
}

export function createFakeProgramSetsDb(initial: { sets: FakeProgramSetRow[]; weekSets?: FakeWeekSetRow[] }) {
  const state = {
    sets: JSON.parse(JSON.stringify(initial.sets)) as FakeProgramSetRow[],
    weekSets: JSON.parse(JSON.stringify(initial.weekSets ?? [])) as FakeWeekSetRow[],
  }
  const writes: FakeCall[] = []
  let insertCounter = 0
  const db = {
    client: undefined as unknown as { from: (table: string) => unknown },
    state,
    writes,
    /** Asked before each write to v2_program_sets; a message refuses it (nothing is applied). */
    refuse: null as ((write: FakeWrite) => string | null) | null,
    /** While a test holds one, a read waits for it: the sets are read again only once the test lets it go (release it in a `finally`). */
    gate: null as Promise<void> | null,
    /** The sets of one exercise as stored (heads and stages), in position order, then stage order. */
    rowsOf(programExerciseId: string) {
      return state.sets
        .filter((s) => s.program_exercise_id === programExerciseId)
        .sort((a, b) => a.position - b.position || a.stage_index - b.stage_index)
    },
    row(id: string) {
      return state.sets.find((s) => s.id === id)
    },
    stagesOf(id: string) {
      return state.sets.filter((s) => s.parent_program_set_id === id).sort((a, b) => a.stage_index - b.stage_index)
    },
    /** Every write the step made to one table, in order, as `[method, the id or ids it named, the payload]` (an insert names none). */
    requests(table = 'v2_program_sets'): [string, string | string[] | null, unknown][] {
      return writes
        .filter((w) => w.table === table)
        .map((w) => {
          const byId = w.eq.find(([col]) => col === 'id')?.[1] as string | undefined
          const byIds = w.in.find(([col]) => col === 'id')?.[1] as string[] | undefined
          return [w.method, byId ?? byIds ?? null, w.args[0] ?? null]
        })
    },
  }

  function from(table: string) {
    const q: {
      select: string
      eq: [string, unknown][]
      in: [string, unknown[]][]
      order: [string, boolean] | null
      op: 'read' | 'insert' | 'update' | 'delete'
      payload: unknown
    } = { select: '', eq: [], in: [], order: null, op: 'read', payload: undefined }

    const matches = (row: object) => {
      const r = row as Record<string, unknown>
      return q.eq.every(([col, val]) => r[col] === val) && q.in.every(([col, vals]) => vals.includes(r[col]))
    }

    const refusal = (write: FakeWrite) => {
      const message = db.refuse?.(write) ?? null
      return message === null ? null : { data: null, error: { code: '42501', message } }
    }

    // Removing a set removes the sets under it (on delete cascade, 027).
    function removeWithStages(id: string) {
      state.sets = state.sets.filter((s) => s.id !== id && s.parent_program_set_id !== id)
    }

    function runWeekSets(): { data: unknown; error: unknown } {
      if (q.op === 'read') throw new Error('fakeProgramSetsDb: unexpected read of v2_week_plan_sets')
      if (q.op === 'insert') throw new Error('fakeProgramSetsDb: unexpected insert on v2_week_plan_sets')
      const ids = state.weekSets.filter(matches).map((s) => s.id)
      if (q.op === 'update') state.weekSets = state.weekSets.map((s) => (ids.includes(s.id) ? ({ ...s, ...(q.payload as object) } as FakeWeekSetRow) : s))
      else state.weekSets = state.weekSets.filter((s) => !ids.includes(s.id))
      return { data: null, error: null }
    }

    function run(single: boolean): { data: unknown; error: unknown } {
      if (table === 'v2_week_plan_sets') return runWeekSets()
      if (table !== 'v2_program_sets') throw new Error(`fakeProgramSetsDb: unexpected ${q.op} on ${table}`)

      if (q.op === 'read') {
        if (q.select !== '*') throw new Error(`fakeProgramSetsDb: unexpected v2_program_sets select: ${q.select}`)
        const rows = state.sets.filter(matches).map((s) => ({ ...s }))
        if (q.order) rows.sort((a, b) => (a.position - b.position) * (q.order![1] ? 1 : -1))
        return { data: rows, error: null }
      }

      if (q.op === 'insert') {
        const payloads = (Array.isArray(q.payload) ? q.payload : [q.payload]) as Partial<FakeProgramSetRow>[]
        for (const p of payloads) {
          const refused = refusal({ op: 'insert', payload: p as Record<string, unknown> })
          if (refused) return refused
        }
        const made: FakeProgramSetRow[] = []
        for (const p of payloads) {
          insertCounter += 1
          const row = fakeProgramSet((p.id as string | undefined) ?? `new-${insertCounter}`, p.program_exercise_id as string, p.position as number, p)
          if (row.parent_program_set_id !== null && !state.sets.some((s) => s.id === row.parent_program_set_id) && !made.some((m) => m.id === row.parent_program_set_id)) {
            return { data: null, error: { code: '23503', message: 'insert on "v2_program_sets" violates foreign key constraint (parent_program_set_id)' } }
          }
          const broken = violation(row)
          if (broken) return { data: null, error: broken }
          made.push(row)
        }
        state.sets.push(...made)
        if (single) return { data: { ...made[0] }, error: null }
        return { data: made.map((r) => ({ ...r })), error: null }
      }

      if (q.op === 'update') {
        const ids = state.sets.filter(matches).map((s) => s.id)
        for (const id of ids) {
          const refused = refusal({ op: 'update', id, patch: q.payload as Record<string, unknown> })
          if (refused) return refused
        }
        const next = state.sets.map((s) => (ids.includes(s.id) ? ({ ...s, ...(q.payload as object) } as FakeProgramSetRow) : s))
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
    chain.in = (col: string, vals: unknown[]) => (q.in.push([col, vals]), chain)
    chain.order = (col: string, opts?: { ascending?: boolean }) => {
      if (col !== 'position') throw new Error(`fakeProgramSetsDb: unexpected order by ${col}`)
      q.order = [col, opts?.ascending !== false]
      return chain
    }
    chain.insert = (payload: unknown) => (writes.push({ table, method: 'insert', args: [payload], eq: q.eq, in: q.in }), (q.op = 'insert'), (q.payload = payload), chain)
    chain.update = (payload: unknown) => (writes.push({ table, method: 'update', args: [payload], eq: q.eq, in: q.in }), (q.op = 'update'), (q.payload = payload), chain)
    chain.delete = () => (writes.push({ table, method: 'delete', args: [], eq: q.eq, in: q.in }), (q.op = 'delete'), chain)
    chain.single = () => Promise.resolve(run(true))
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const go = () => {
        try {
          return Promise.resolve(run(false))
        } catch (e) {
          return Promise.reject(e)
        }
      }
      // A read waits for `db.gate` when a test holds one (the moments between a write's answer and the sets being read again).
      const result = q.op === 'read' && db.gate ? db.gate.then(go) : go()
      return result.then(resolve, reject)
    }
    return chain
  }

  db.client = { from }
  return db
}
