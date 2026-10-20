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

// Chunk 54a — the RIR picker writes a range: `target_rir` and `target_rir_max` together (042). A key is written only when named.
describe('updateSet — a RIR range (chunk 54a, migration 042)', () => {
  it('a range writes both ends in one update: { target_rir: 1, target_rir_max: 2 }', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { targetRir: 1, targetRirMax: 2 })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ target_rir: 1, target_rir_max: 2 })
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('a number writes the high end null (not an absent key), so a range it replaces does not keep its old end', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { targetRir: 2, targetRirMax: null })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ target_rir: 2, target_rir_max: null })
  })

  it('NONE clears both', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { targetRir: null, targetRirMax: null })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({ target_rir: null, target_rir_max: null })
  })

  it('a change that names neither end leaves both columns out of the update', async () => {
    const chain = makeChain()
    fromMock.mockReturnValue(chain)

    await updateSet('head-1', { targetWeight: 80 })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect('target_rir' in payload).toBe(false)
    expect('target_rir_max' in payload).toBe(false)
  })
})

// Chunk 54a — "+ ADD SET" (SPEC Defaults 8): a Normal set with the previous set's rep target and no weight or RIR. addSet writes what the
// caller names, every column of the new set, so the set is never what a column default happens to be.
describe('addSet — a Normal set with the caller\'s defaults (chunk 54a)', () => {
  const insertChain = () => {
    const chain: Record<string, unknown> = {
      insert: vi.fn(() => chain),
      select: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve({ data: { id: 'new', week_plan_id: 'wp-1', user_id: 'u', program_exercise_id: 'pe-1', set_number: 4, target_rir: null, is_dropset: false }, error: null })),
    }
    return chain
  }
  const NORMAL = { isWarmup: false, stageKind: null, repMin: 8, repMax: 10, isAmrap: false, targetWeight: null, targetRir: null, targetRirMax: null } as const

  it('inserts the week plan row, the exercise, the number and the defaults: the rep target, and null weight and RIR', async () => {
    const { addSet } = await import('./weekPlanService')
    const chain = insertChain()
    fromMock.mockReturnValue(chain)

    await addSet('u', 'wp-1', 'pe-1', 4, NORMAL)

    expect(fromMock).toHaveBeenCalledWith('v2_week_plan_sets')
    expect((chain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
      week_plan_id: 'wp-1',
      user_id: 'u',
      program_exercise_id: 'pe-1',
      set_number: 4,
      is_dropset: false,
      is_warmup: false,
      stage_kind: null,
      rep_min: 8,
      rep_max: 10,
      is_amrap: false,
      target_weight: null,
      target_rir: null,
    })
  })

  it('an AMRAP target is written as the flag with no numbers, and a set with no target to follow writes none', async () => {
    const { addSet } = await import('./weekPlanService')
    const amrap = insertChain()
    fromMock.mockReturnValue(amrap)
    await addSet('u', 'wp-1', 'pe-1', 2, { ...NORMAL, repMin: null, repMax: null, isAmrap: true })
    expect((amrap.insert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ rep_min: null, rep_max: null, is_amrap: true })

    const none = insertChain()
    fromMock.mockReturnValue(none)
    await addSet('u', 'wp-1', 'pe-1', 1, { ...NORMAL, repMin: null, repMax: null })
    expect((none.insert as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ rep_min: null, rep_max: null, is_amrap: false })
  })

  it('writes no target_rir_max: a new set has no range, and the column\'s own default is null (the write needs no migration 042)', async () => {
    const { addSet } = await import('./weekPlanService')
    const chain = insertChain()
    fromMock.mockReturnValue(chain)

    await addSet('u', 'wp-1', 'pe-1', 4, NORMAL)

    expect('target_rir_max' in ((chain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as object)).toBe(false)
  })

  it('throws what the insert answered, and returns the mapped set on success', async () => {
    const { addSet } = await import('./weekPlanService')
    const ok = insertChain()
    fromMock.mockReturnValue(ok)
    await expect(addSet('u', 'wp-1', 'pe-1', 4, NORMAL)).resolves.toMatchObject({ id: 'new', setNumber: 4 })

    const failing: Record<string, unknown> = {
      insert: vi.fn(() => failing),
      select: vi.fn(() => failing),
      single: vi.fn(() => Promise.resolve({ data: null, error: { message: 'refused' } })),
    }
    fromMock.mockReturnValue(failing)
    await expect(addSet('u', 'wp-1', 'pe-1', 4, NORMAL)).rejects.toMatchObject({ message: 'refused' })
  })
})

// Chunk 54a — one set type change: planSetRows.ts decides the list, this applies it in order and stops at the first refusal.
describe('applySetTypeOps — the writes of one set type change, in order, stopping at the first failure (chunk 54a)', () => {
  type Call = { table: string; op: string; payload?: unknown; eq?: unknown[] }
  function recorder(failOn?: (call: Call) => boolean) {
    const calls: Call[] = []
    fromMock.mockImplementation((table: string) => {
      const call: Call = { table, op: 'read', eq: [] }
      const chain: Record<string, unknown> = {
        update: (payload: unknown) => ((call.op = 'update'), (call.payload = payload), chain),
        delete: () => ((call.op = 'delete'), chain),
        insert: (payload: unknown) => ((call.op = 'insert'), (call.payload = payload), chain),
        select: () => chain,
        eq: (col: string, val: unknown) => (call.eq?.push([col, val]), chain),
        single: () => {
          calls.push(call)
          return Promise.resolve({ data: { id: 'new', week_plan_id: 'wp-1', user_id: 'u', program_exercise_id: 'pe-1', set_number: 3, is_dropset: true, stage_index: 1 }, error: null })
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          calls.push(call)
          return Promise.resolve({ error: failOn?.(call) ? { message: 'refused' } : null }).then(resolve, reject)
        },
      }
      return chain
    })
    return calls
  }

  it('Warmup on a staged head: the stage rows are deleted first (highest first), then the head is switched, one request each, in that order', async () => {
    const { applySetTypeOps } = await import('./weekPlanService')
    const calls = recorder()

    await applySetTypeOps('u', [
      { kind: 'removeStage', id: 'stage2' },
      { kind: 'removeStage', id: 'stage1' },
      { kind: 'updateHead', id: 'head', changes: { isWarmup: true, stageKind: null } },
    ])

    expect(calls.map((c) => [c.table, c.op, c.eq, c.payload])).toEqual([
      ['v2_week_plan_sets', 'delete', [['id', 'stage2']], undefined],
      ['v2_week_plan_sets', 'delete', [['id', 'stage1']], undefined],
      ['v2_week_plan_sets', 'update', [['id', 'head']], { is_warmup: true, stage_kind: null }],
    ])
  })

  it('a staged kind on a plain set: the head\'s kind is written, then each stage row is inserted under it with its number and index', async () => {
    const { applySetTypeOps } = await import('./weekPlanService')
    const calls = recorder()

    await applySetTypeOps('u', [
      { kind: 'updateHead', id: 'head', changes: { stageKind: 'dropset' } },
      { kind: 'addStage', weekPlanId: 'wp-1', programExerciseId: 'pe-1', parentId: 'head', setNumber: 3, stageIndex: 1 },
      { kind: 'addStage', weekPlanId: 'wp-1', programExerciseId: 'pe-1', parentId: 'head', setNumber: 3, stageIndex: 2 },
    ])

    expect(calls.map((c) => [c.op, c.payload])).toEqual([
      ['update', { stage_kind: 'dropset' }],
      ['insert', { week_plan_id: 'wp-1', user_id: 'u', program_exercise_id: 'pe-1', set_number: 3, target_rir: null, is_dropset: true, parent_week_plan_set_id: 'head', stage_index: 1 }],
      ['insert', { week_plan_id: 'wp-1', user_id: 'u', program_exercise_id: 'pe-1', set_number: 3, target_rir: null, is_dropset: true, parent_week_plan_set_id: 'head', stage_index: 2 }],
    ])
  })

  it('stops at the first refusal: nothing after it is sent, and the refusal is thrown', async () => {
    const { applySetTypeOps } = await import('./weekPlanService')
    const calls = recorder((call) => call.op === 'delete' && (call.eq as unknown[][])[0][1] === 'stage2')

    await expect(
      applySetTypeOps('u', [
        { kind: 'removeStage', id: 'stage2' },
        { kind: 'removeStage', id: 'stage1' },
        { kind: 'updateHead', id: 'head', changes: { isWarmup: true } },
      ]),
    ).rejects.toMatchObject({ message: 'refused' })

    expect(calls).toHaveLength(1)
  })

  it('an empty list sends nothing', async () => {
    const { applySetTypeOps } = await import('./weekPlanService')
    const calls = recorder()
    await applySetTypeOps('u', [])
    expect(calls).toHaveLength(0)
    expect(fromMock).not.toHaveBeenCalled()
  })
})
