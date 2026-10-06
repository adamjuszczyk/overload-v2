import { describe, it, expect, vi, beforeEach } from 'vitest'

// weekPlanService.ts imports the real Supabase client at module load time —
// mocked here the same way sessionService.test.ts's own precedent does, so
// updateSet's exact `.update()` payload can be inspected directly.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const { updateSet } = await import('./weekPlanService')

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

// Chunk 14 — "Staged sets: all four stage kinds". The week plan's own
// stage-kind picker (PlanPage.tsx's PlanSetGroup) writes through this same
// updateSet() the RIR stepper always has — extended here with a
// `stageKind` key, same "named only when present" convention targetRir
// already uses (a patch never carries a key the caller didn't ask to
// change).
describe('updateSet — stageKind patch (chunk 14)', () => {
  it('changes with only stageKind writes exactly { stage_kind } — targetRir is untouched, not reset', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { stageKind: 'rest_pause' })

    expect(fromMock).toHaveBeenCalledWith('v2_week_plan_sets')
    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ stage_kind: 'rest_pause' })
    expect(chain.eq).toHaveBeenCalledWith('id', 'head-1')
  })

  it('clearing back to null (the DROPSET chip\'s re-tap) writes stage_kind: null, not an absent key', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { stageKind: null })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ stage_kind: null })
  })

  it('a plain targetRir change (today\'s only case before this chunk) still has no stage_kind key at all', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { targetRir: 2 })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ target_rir: 2 })
    expect('stage_kind' in payload).toBe(false)
  })
})
