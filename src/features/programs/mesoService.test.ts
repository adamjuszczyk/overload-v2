import { describe, it, expect, vi, beforeEach } from 'vitest'

// mesoService.ts imports the real Supabase client at module load time
// (supabase.ts throws if env vars are missing, and would otherwise hit the
// network) — mocked here the same way sessionService.test.ts's own
// precedent does, so fetchMesos' exact `.select()` string can be inspected
// directly rather than inferred.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const mesoServiceModule = await import('./mesoService')
const { fetchMesos, deleteMeso } = mesoServiceModule

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

// Chunk 66: DELETE THIS FINISHED PROGRAM (PR15) → `useDeleteMeso` → this. The request is the whole of what deleting a finished program does to
// stored rows (the weekly plan goes with the run by the database's cascade; its sessions stay, their `mesocycle_id` set null; the saved program is
// not touched), so what it names is proven here: the run's own id, and only while it is completed. The second filter is what keeps a running
// program from being deleted by an id typed into the address bar or a stale screen.
describe('deleteMeso — one request: delete from v2_mesocycles where id is the run\'s and status is completed (chunk 66)', () => {
  function makeDeleteChain(result: { error: unknown }) {
    const eqCalls: Array<[string, unknown]> = []
    const chain: Record<string, unknown> = {
      delete: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        eqCalls.push([column, value])
        return chain
      }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
    }
    return { chain, eqCalls }
  }

  it('deletes from v2_mesocycles, filtered by the id it was given and by status = completed, and by nothing else', async () => {
    const { chain, eqCalls } = makeDeleteChain({ error: null })
    fromMock.mockReturnValue(chain)

    await deleteMeso('meso-9')

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith('v2_mesocycles')
    expect(chain.delete).toHaveBeenCalledTimes(1)
    expect([...eqCalls].sort()).toEqual([['id', 'meso-9'], ['status', 'completed']])
  })

  it('rethrows the database\'s own error, so the confirm can say the real reason', async () => {
    const { chain } = makeDeleteChain({ error: { message: 'permission denied for table v2_mesocycles' } })
    fromMock.mockReturnValue(chain)

    await expect(deleteMeso('meso-9')).rejects.toEqual({ message: 'permission denied for table v2_mesocycles' })
  })
})
