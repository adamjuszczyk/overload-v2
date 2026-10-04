import { describe, it, expect, vi, beforeEach } from 'vitest'

// sessionService.ts imports the real Supabase client at module load time
// (supabase.ts throws if env vars are missing, and would otherwise hit the
// network) — mocked here the same way exerciseService.test.ts's own
// precedent does, so updateSetLog's exact `.update()` payload can be
// inspected directly rather than inferred.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const { updateSetLog } = await import('./sessionService')

// A chainable stand-in for supabase-js's query builder. updateSetLog only
// ever calls `.update(patch).eq('id', id)` and awaits the result directly,
// with no trailing `.select()`/`.single()` — real supabase-js query
// builders are thenable, so making the chain object itself resolve via
// `.then` (same precedent as exerciseService.test.ts's makeChain) lets
// `await supabase.from(...).update(...).eq(...)` resolve with no further
// method needed.
function makeChain(result: { error: unknown } = { error: null }) {
  const chain: Record<string, unknown> = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
})

// Chunk 4 — "Remove the note section from logged-set editing" [P1]
// (SPEC.md). This is the lowest layer the brief names: the function that
// builds the literal object handed to Supabase's `.update()` for
// `v2_set_logs`. The critical property lives here — `note` must be absent
// as a KEY from that object, not merely unset/null, for every shape of
// `changes` a real caller (SetRow.tsx's saveEdit, via useUpdateSetLog) can
// produce. There is no separate offline-queue payload to check for this
// path — useUpdateSetLog (useSession.ts) has no offline branch; it calls
// this same function directly whether TanStack Query's own online manager
// considers the mutation paused or not (see chunk 4's own report for the
// full trace).
describe('updateSetLog — the edit path never writes `note` (chunk 4)', () => {
  it('a full-shaped edit (weight/reps/rir/formRating — SetRow.tsx saveEdit\'s own shape) has no "note" key in the .update() payload', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSetLog('log-1', { weight: 50, reps: 5, rir: 2, formRating: 'controlled' })

    expect(fromMock).toHaveBeenCalledWith('v2_set_logs')
    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect('note' in payload).toBe(false)
    // Not just "no note" — the exact payload, so a stray extra key would
    // also fail this, not just a reintroduced note.
    expect(payload).toEqual({ weight: 50, reps: 5, rir: 2, form_rating: 'controlled' })
    expect(chain.eq).toHaveBeenCalledWith('id', 'log-1')
  })

  it('an edit that clears weight/reps/rir to null still has no "note" key — null fields are not "spread from a full row"', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSetLog('log-1', { weight: null, reps: null, rir: null, formRating: null })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect('note' in payload).toBe(false)
    expect(payload).toEqual({ weight: null, reps: null, rir: null, form_rating: null })
  })

  it('an empty changes object writes an empty patch — no key, note included, is ever defaulted in', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSetLog('log-1', {})

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({})
    expect('note' in payload).toBe(false)
  })

  it('setNumber-only renumbering (ExerciseCard.tsx\'s handleDeleteHead shape) touches only set_number, never note', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSetLog('log-1', { setNumber: 3 })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ set_number: 3 })
    expect('note' in payload).toBe(false)
  })
})
