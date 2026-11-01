import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakePostgrest } from './fakePostgrest.testutil'

// mesoService.ts imports the real Supabase client at module load time
// (supabase.ts throws if env vars are missing, and would otherwise hit the
// network) — mocked here the same way sessionService.test.ts's own
// precedent does, so fetchMesos' exact `.select()` string can be inspected
// directly rather than inferred.
const fromMock = vi.fn()
const rpcMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args), rpc: (...args: unknown[]) => rpcMock(...args) },
}))

const mesoServiceModule = await import('./mesoService')
const { fetchMesos, fetchFinishedRunCounts, fetchFinishedRunSessionIds, deleteFinishedRun } = mesoServiceModule

// Chunk 6, TASKS.md — "keep createMeso exported only if something else uses
// it": nothing else does (grepped before removing it), so both retired
// two-step functions are gone outright, not merely unused. This is the
// direct proof "START MESOCYCLE no longer calls the two-step path" asks
// for: the path doesn't exist to be called any more.
describe('mesoService — the old two-step start path is gone (chunk 6)', () => {
  it('no longer exports createMeso', () => {
    expect('createMeso' in mesoServiceModule).toBe(false)
  })

  it('no longer exports completeAllActiveMesos', () => {
    expect('completeAllActiveMesos' in mesoServiceModule).toBe(false)
  })
})

// A chainable stand-in for supabase-js's query builder (fetchMesos' own
// `.select(...).order(...)`, which has no trailing `.single()` — the chain
// object itself is thenable, same precedent as exerciseService.test.ts's
// makeChain).
function makeChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    order: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

// Migration 027 added v2_mesocycles.source_program_id → v2_programs, a
// second foreign key next to program_id. PostgREST can no longer infer
// which relationship a bare `v2_programs(...)` embed means and answers
// PGRST201 ("more than one relationship was found"), so the `.select()`
// call below must disambiguate with the `!fkey` hint. Per PostgREST's
// documented embed syntax, `table!fkey(...)` still keys the embedded result
// by the table name (`v2_programs`), not the constraint name — so
// toMesocycle's row-reading shape (and therefore the mapped Mesocycle) is
// unchanged by the fix. createMeso (this same hint, on insert().select())
// was retired in chunk 6 — v2_start_run (runService.ts) replaces it; its
// own embed-hint coverage moved to runService.test.ts / the chunk 6 scratch
// checks (R6/R7), since the function lives in the database now, not here.
describe('fetchMesos — disambiguated v2_programs embed (027 added source_program_id)', () => {
  const ROW = {
    id: 'meso-1',
    user_id: 'user-1',
    name: 'Block 1',
    program_id: 'prog-1',
    status: 'active' as const,
    start_date: '2026-01-01',
    end_date: null,
    created_at: '2026-01-01T00:00:00Z',
    v2_programs: { id: 'prog-1', name: 'PPL' },
    source_program_id: 'saved-prog-1',
  }

  const EXPECTED_MESO = {
    id: 'meso-1',
    userId: 'user-1',
    name: 'Block 1',
    programId: 'prog-1',
    program: {
      id: 'prog-1',
      name: 'PPL',
      userId: 'user-1',
      schedule: {},
      workoutDays: [],
      createdAt: '',
      updatedAt: '',
      kind: 'run',
    },
    status: 'active',
    startDate: '2026-01-01',
    endDate: null,
    createdAt: '2026-01-01T00:00:00Z',
    sourceProgramId: 'saved-prog-1',
  }

  it('selects with the fkey-qualified embed, not the bare ambiguous one', async () => {
    const chain = makeChain({ data: [ROW], error: null })
    fromMock.mockReturnValue(chain)

    await fetchMesos()

    expect(fromMock).toHaveBeenCalledWith('v2_mesocycles')
    const selectArg = (chain.select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(selectArg).toContain('v2_programs!v2_mesocycles_program_id_fkey(')
    expect(selectArg).not.toContain('v2_programs(')
  })

  it('maps a row with v2_programs: { id, name } and source_program_id to the full Mesocycle shape (chunk 6: kind/sourceProgramId mapped)', async () => {
    const chain = makeChain({ data: [ROW], error: null })
    fromMock.mockReturnValue(chain)

    const result = await fetchMesos()

    expect(result).toEqual([EXPECTED_MESO])
  })

  it('a row with no source_program_id (pre-028 shape) maps sourceProgramId to null, not undefined', async () => {
    const { source_program_id: _drop, ...legacyRow } = ROW
    const chain = makeChain({ data: [legacyRow], error: null })
    fromMock.mockReturnValue(chain)

    const result = await fetchMesos()

    expect(result[0].sourceProgramId).toBeNull()
  })
})

// ─── Chunk 75 (1.2.1 item 8b): the full delete of a finished program — its three requests ───────────────────────────────────────────────────────────
// DELETE THIS FINISHED PROGRAM and History's program-filter delete (one confirmation, `FullDeleteConfirm`) read the counts and the program's session ids
// when it opens, and delete through `v2_delete_finished_run` when DELETE is pressed. The rows the delete removes are the database's to remove (one
// transaction, 048): what the app sends is the whole of what it does, so each request is asserted whole, with fixtures that tell the program's id from
// the others it could be given by mistake.
// A query builder that answers anything, so a request sent through `from(...)` by mistake is a request that goes through and is counted, not a crash.
const anyChain = (): unknown => {
  const chain: unknown = new Proxy(function () {}, {
    get: (_target, prop) => (prop === 'then' ? (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }) : () => chain),
    apply: () => chain,
  })
  return chain
}

describe('fetchFinishedRunCounts — rpc v2_finished_run_counts (read-only), one row', () => {
  beforeEach(() => fromMock.mockImplementation(() => anyChain()))
  // The seed's finished STG Full Body run, as chunk 70 read it on staging: 3 weeks | 9 sessions | 66 logged sets | 3 Coach analyses | 1 Coach note.
  const ROW = { weeks: 3, sessions: 9, logged_sets: 66, coach_analyses: 3, coach_notes: 1 }

  it('asks the function with the program\'s id as p_mesocycle_id, once, and reads nothing else', async () => {
    rpcMock.mockResolvedValue({ data: [ROW], error: null })

    await fetchFinishedRunCounts('meso-9')

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('v2_finished_run_counts', { p_mesocycle_id: 'meso-9' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('maps the five columns, each from its own (3 | 9 | 66 | 3 | 1: no two the same, so a swapped pair shows)', async () => {
    rpcMock.mockResolvedValue({ data: [ROW], error: null })

    expect(await fetchFinishedRunCounts('meso-9')).toEqual({ weeks: 3, sessions: 9, loggedSets: 66, coachAnalyses: 3, coachNotes: 1 })
    rpcMock.mockResolvedValue({ data: [{ weeks: 1, sessions: 2, logged_sets: 31, coach_analyses: 0, coach_notes: 4 }], error: null })
    expect(await fetchFinishedRunCounts('meso-9')).toEqual({ weeks: 1, sessions: 2, loggedSets: 31, coachAnalyses: 0, coachNotes: 4 })
  })

  it('a table function answers an array of rows and a single object is read the same; numbers that arrive as strings (bigint) are numbers', async () => {
    rpcMock.mockResolvedValue({ data: ROW, error: null })
    expect((await fetchFinishedRunCounts('meso-9')).sessions).toBe(9)
    rpcMock.mockResolvedValue({ data: [{ ...ROW, logged_sets: '66' }], error: null })
    expect((await fetchFinishedRunCounts('meso-9')).loggedSets).toBe(66)
  })

  it('the database\'s refusal is rethrown as it came, code and all (OL003 not finished, P0002 not found: read from error.code, never the status)', async () => {
    const refusal = { code: 'OL003', message: 'only a finished program can be deleted', details: null, hint: null }
    rpcMock.mockResolvedValue({ data: null, error: refusal })
    await expect(fetchFinishedRunCounts('meso-9')).rejects.toBe(refusal)
    const notFound = { code: 'P0002', message: 'program not found: meso-9' }
    rpcMock.mockResolvedValue({ data: null, error: notFound })
    await expect(fetchFinishedRunCounts('meso-9')).rejects.toBe(notFound)
  })

  it('no row, a column missing, or one that is not a whole number is an error: a delete is never named with "undefined sessions"', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    await expect(fetchFinishedRunCounts('meso-9')).rejects.toThrow('no counts came back')
    rpcMock.mockResolvedValue({ data: null, error: null })
    await expect(fetchFinishedRunCounts('meso-9')).rejects.toThrow('no counts came back')
    for (const column of Object.keys(ROW)) {
      const { [column]: _dropped, ...without } = ROW as Record<string, number>
      rpcMock.mockResolvedValue({ data: [without], error: null })
      await expect(fetchFinishedRunCounts('meso-9'), `${column} missing`).rejects.toThrow('missing from the answer')
    }
    for (const bad of [-1, 2.5, 'many', null, Number.NaN]) {
      rpcMock.mockResolvedValue({ data: [{ ...ROW, sessions: bad }], error: null })
      await expect(fetchFinishedRunCounts('meso-9'), `sessions ${String(bad)}`).rejects.toThrow('missing from the answer')
    }
  })
})

describe('fetchFinishedRunSessionIds — the program\'s own sessions, all of them, paged', () => {
  const sessionRow = (id: string, mesocycleId: string) => ({ id, user_id: 'user-1', mesocycle_id: mesocycleId, status: 'completed', date: '2026-07-06' })
  const world = (rows: Array<Record<string, unknown>>) => {
    const fake = fakePostgrest({ v2_sessions: rows })
    fromMock.mockImplementation((...args: unknown[]) => (fake.client.from as (t: string) => unknown)(args[0] as string))
    return fake
  }

  it('reads v2_sessions for the program: its ids, never another program\'s, and only the id column', async () => {
    const fake = world([
      sessionRow('s-b', 'meso-9'),
      sessionRow('s-other', 'meso-8'),
      sessionRow('s-a', 'meso-9'),
      sessionRow('s-none', 'meso-0'),
    ])

    expect(await fetchFinishedRunSessionIds('meso-9')).toEqual(['s-a', 's-b'])

    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0].table).toBe('v2_sessions')
    expect(fake.requests[0].select).toBe('id')
    expect(fake.requests[0].filters).toEqual([{ op: 'eq', column: 'mesocycle_id', value: 'meso-9' }])
  })

  it('pages under the server\'s row cap: 1,200 sessions all come back, in id order, and nothing is asked twice', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => sessionRow(`s-${String(i).padStart(4, '0')}`, 'meso-9'))
    rows.push(sessionRow('s-elsewhere', 'meso-8'))
    const fake = world(rows)

    const ids = await fetchFinishedRunSessionIds('meso-9')

    expect(ids).toHaveLength(1200)
    expect(new Set(ids).size).toBe(1200)
    expect(ids[0]).toBe('s-0000')
    expect(ids[1199]).toBe('s-1199')
    expect(fake.requests.map((r) => r.range)).toEqual([[0, 499], [500, 999], [1000, 1499]])
    expect(fake.requests.every((r) => r.order === 'id')).toBe(true)
  })

  it('a program with no sessions reads []; a page that is exactly full asks for the next one', async () => {
    world([])
    expect(await fetchFinishedRunSessionIds('meso-9')).toEqual([])
    const fake = world(Array.from({ length: 500 }, (_, i) => sessionRow(`s-${String(i).padStart(3, '0')}`, 'meso-9')))
    expect(await fetchFinishedRunSessionIds('meso-9')).toHaveLength(500)
    expect(fake.requests).toHaveLength(2)
  })

  it('a failed read is rethrown, not read as no sessions', async () => {
    const fake = world([sessionRow('s-a', 'meso-9')])
    fake.failWith('v2_sessions', 'JWT expired')
    await expect(fetchFinishedRunSessionIds('meso-9')).rejects.toEqual({ message: 'JWT expired' })
  })
})

describe('deleteFinishedRun — one request: rpc v2_delete_finished_run, and nothing else', () => {
  beforeEach(() => fromMock.mockImplementation(() => anyChain()))

  it('sends the function the program\'s id as p_mesocycle_id, once; no table is touched directly', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })

    await deleteFinishedRun('meso-9')

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('v2_delete_finished_run', { p_mesocycle_id: 'meso-9' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('the database\'s own refusal is rethrown as it came, so the confirmation can say the real reason', async () => {
    const refusal = { code: 'OL003', message: 'only a finished program can be deleted' }
    rpcMock.mockResolvedValue({ data: null, error: refusal })
    await expect(deleteFinishedRun('meso-9')).rejects.toBe(refusal)
  })

  it('the old delete (from v2_mesocycles where id and status) is gone from the service', () => {
    expect('deleteMeso' in mesoServiceModule).toBe(false)
  })
})
