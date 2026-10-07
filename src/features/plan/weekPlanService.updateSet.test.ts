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

// Chunk 19 — SPEC "Targets"/"Tags": weight target, the week's rep-target
// override, and tags, each writing only its own column(s), same "named only
// when present" convention the existing stageKind tests above already pin.
describe('updateSet — weight target, rep target, tags (chunk 19)', () => {
  it('a weight-only change writes exactly { target_weight } in kg — nothing else', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { targetWeight: 102.06 })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ target_weight: 102.06 })
  })

  it('blank clears the weight target: writes { target_weight: null }, not an absent key', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { targetWeight: null })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ target_weight: null })
  })

  it('a rep-target change writes exactly rep_min/rep_max/is_amrap — never target_rir unless the caller asks', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { repMin: 8, repMax: 12, isAmrap: false })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ rep_min: 8, rep_max: 12, is_amrap: false })
    expect('target_rir' in payload).toBe(false)
  })

  it('AMRAP\'s RIR default rides in the SAME update, when the caller includes it', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { repMin: null, repMax: null, isAmrap: true, targetRir: 0 })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ rep_min: null, rep_max: null, is_amrap: true, target_rir: 0 })
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('a tags change writes exactly { tags }', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { tags: ['push here', 'maintain strength'] })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ tags: ['push here', 'maintain strength'] })
  })

  it('removing the last tag writes { tags: null }, not an absent key', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { tags: null })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ tags: null })
  })
})
