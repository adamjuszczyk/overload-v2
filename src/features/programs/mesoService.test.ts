import { describe, it, expect, vi, beforeEach } from 'vitest'

// mesoService.ts imports the real Supabase client at module load time
// (supabase.ts throws if env vars are missing, and would otherwise hit the
// network) — mocked here the same way sessionService.test.ts's own
// precedent does, so fetchMesos'/createMeso's exact `.select()` string can
// be inspected directly rather than inferred.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const { fetchMesos, createMeso } = await import('./mesoService')

// A chainable stand-in for supabase-js's query builder, combining
// exerciseService.test.ts's two precedents: the chain object itself is
// thenable (for fetchMesos's `.select(...).order(...)`, which has no
// trailing `.single()`), and `.single()` resolves directly (for createMeso's
// `.insert(...).select(...).single()`).
function makeChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    order: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
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
// PGRST201 ("more than one relationship was found"), so both `.select()`
// calls below must disambiguate with the `!fkey` hint. Per PostgREST's
// documented embed syntax, `table!fkey(...)` still keys the embedded result
// by the table name (`v2_programs`), not the constraint name — so
// toMesocycle's row-reading shape (and therefore the mapped Mesocycle) is
// unchanged by the fix.
describe('fetchMesos / createMeso — disambiguated v2_programs embed (027 added source_program_id)', () => {
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
    },
    status: 'active',
    startDate: '2026-01-01',
    endDate: null,
    createdAt: '2026-01-01T00:00:00Z',
  }

  it('fetchMesos selects with the fkey-qualified embed, not the bare ambiguous one', async () => {
    const chain = makeChain({ data: [ROW], error: null })
    fromMock.mockReturnValue(chain)

    await fetchMesos()

    expect(fromMock).toHaveBeenCalledWith('v2_mesocycles')
    const selectArg = (chain.select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(selectArg).toContain('v2_programs!v2_mesocycles_program_id_fkey(')
    expect(selectArg).not.toContain('v2_programs(')
  })

  it('fetchMesos maps a row with v2_programs: { id, name } to the same Mesocycle as before', async () => {
    const chain = makeChain({ data: [ROW], error: null })
    fromMock.mockReturnValue(chain)

    const result = await fetchMesos()

    expect(result).toEqual([EXPECTED_MESO])
  })

  it("createMeso's insert().select() uses the fkey-qualified embed, not the bare ambiguous one", async () => {
    const chain = makeChain({ data: ROW, error: null })
    fromMock.mockReturnValue(chain)

    await createMeso('user-1', 'Block 1', 'prog-1', '2026-01-01')

    expect(fromMock).toHaveBeenCalledWith('v2_mesocycles')
    const selectArg = (chain.select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(selectArg).toContain('v2_programs!v2_mesocycles_program_id_fkey(')
    expect(selectArg).not.toContain('v2_programs(')
  })

  it('createMeso maps the resolved row to the same Mesocycle shape as fetchMesos', async () => {
    const chain = makeChain({ data: ROW, error: null })
    fromMock.mockReturnValue(chain)

    const result = await createMeso('user-1', 'Block 1', 'prog-1', '2026-01-01')

    expect(result).toEqual(EXPECTED_MESO)
  })
})
