import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WarmupRoutineItem } from '../../types'

// Chunk 18 — warmupRoutineService.ts. Same mocking precedent as
// programService.test.ts/plannerService.test.ts: the real Supabase client
// is mocked at the module boundary (supabase.ts throws without env vars),
// and a tiny query-builder chain stand-in lets each call's exact
// table/filter/payload be inspected.

const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const {
  fetchWarmupItems,
  addWarmupItem,
  updateWarmupItemBody,
  removeWarmupItem,
  reorderWarmupItems,
  moveWarmupItem,
} = await import('./warmupRoutineService')

function makeChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
})

function row(overrides: Partial<{ id: string; user_id: string; workout_day_id: string; position: number; body: string }> = {}) {
  return {
    id: 'wi-1',
    user_id: 'user-1',
    workout_day_id: 'wd-1',
    position: 0,
    body: 'Bike 5 min',
    ...overrides,
  }
}

describe('fetchWarmupItems — one fetch per workout, ordered by position', () => {
  it('queries v2_workout_warmup_items, filtered by workout_day_id, ordered ascending', async () => {
    const chain = makeChain({ data: [], error: null })
    fromMock.mockReturnValue(chain)

    await fetchWarmupItems('wd-1')

    expect(fromMock).toHaveBeenCalledWith('v2_workout_warmup_items')
    expect(chain.eq).toHaveBeenCalledWith('workout_day_id', 'wd-1')
    expect(chain.order).toHaveBeenCalledWith('position', { ascending: true })
  })

  it('maps snake_case rows to WarmupRoutineItem', async () => {
    const chain = makeChain({ data: [row({ id: 'wi-1', position: 0, body: 'Bike 5 min' })], error: null })
    fromMock.mockReturnValue(chain)

    const result = await fetchWarmupItems('wd-1')

    expect(result).toEqual([
      { id: 'wi-1', userId: 'user-1', workoutDayId: 'wd-1', position: 0, body: 'Bike 5 min' },
    ])
  })

  it('throws the Supabase error rather than swallowing it', async () => {
    const chain = makeChain({ data: null, error: { message: 'boom' } })
    fromMock.mockReturnValue(chain)

    await expect(fetchWarmupItems('wd-1')).rejects.toEqual({ message: 'boom' })
  })
})

describe('addWarmupItem — trims the body, writes position verbatim', () => {
  it('inserts user_id/workout_day_id/position/body(trimmed) and maps the row back', async () => {
    const chain = makeChain({ data: row({ id: 'wi-new', position: 2, body: 'Jumping jacks' }), error: null })
    fromMock.mockReturnValue(chain)

    const result = await addWarmupItem('user-1', 'wd-1', '  Jumping jacks  ', 2)

    expect(chain.insert).toHaveBeenCalledWith({
      user_id: 'user-1', workout_day_id: 'wd-1', position: 2, body: 'Jumping jacks',
    })
    expect(result).toEqual({ id: 'wi-new', userId: 'user-1', workoutDayId: 'wd-1', position: 2, body: 'Jumping jacks' })
  })
})

describe('updateWarmupItemBody — trims, plain update', () => {
  it('writes body (trimmed) filtered by id', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await updateWarmupItemBody('wi-1', '  New text  ')

    expect(chain.update).toHaveBeenCalledWith({ body: 'New text' })
    expect(chain.eq).toHaveBeenCalledWith('id', 'wi-1')
  })
})

describe('removeWarmupItem — deletes, then re-packs the remainder dense', () => {
  it('deletes the row, then shifts every item AFTER it down by one position', async () => {
    const deleteChain = makeChain({ data: null, error: null })
    // Post-delete state: positions 0,2,3 remain (position 1 was removed) —
    // fetchWarmupItems' own ascending order.
    const selectChain = makeChain({
      data: [
        row({ id: 'wi-0', position: 0 }),
        row({ id: 'wi-2', position: 2 }),
        row({ id: 'wi-3', position: 3 }),
      ],
      error: null,
    })
    const updateChains: ReturnType<typeof makeChain>[] = []
    fromMock.mockImplementation(() => {
      // First call is the DELETE, second is the SELECT (fetchWarmupItems),
      // every call after that is one re-pack UPDATE — routed by call order
      // since all three share the same table name.
      if (fromMock.mock.calls.length === 1) return deleteChain
      if (fromMock.mock.calls.length === 2) return selectChain
      const chain = makeChain({ data: null, error: null })
      updateChains.push(chain)
      return chain
    })

    await removeWarmupItem('wi-1', 'wd-1')

    expect(deleteChain.delete).toHaveBeenCalled()
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 'wi-1')

    // wi-0 is already at its correct dense slot (0) — no write.
    // wi-2 (currently at 2) moves to 1; wi-3 (currently at 3) moves to 2.
    expect(updateChains).toHaveLength(2)
    expect(updateChains[0].update).toHaveBeenCalledWith({ position: 1 })
    expect(updateChains[0].eq).toHaveBeenCalledWith('id', 'wi-2')
    expect(updateChains[1].update).toHaveBeenCalledWith({ position: 2 })
    expect(updateChains[1].eq).toHaveBeenCalledWith('id', 'wi-3')
  })

  it('removing the LAST item writes nothing further (every remaining row is already dense)', async () => {
    const deleteChain = makeChain({ data: null, error: null })
    const selectChain = makeChain({
      data: [row({ id: 'wi-0', position: 0 }), row({ id: 'wi-1', position: 1 })],
      error: null,
    })
    fromMock.mockImplementation(() => (fromMock.mock.calls.length === 1 ? deleteChain : selectChain))

    await removeWarmupItem('wi-2', 'wd-1')

    expect(selectChain.update).not.toHaveBeenCalled()
  })
})

describe('reorderWarmupItems — two-phase update under the unique (workout_day_id, position) index', () => {
  it('phase 1 moves every row to position + updates.length, phase 2 lands each on its real position — in that order', async () => {
    // reorderWarmupItems awaits one .update().eq() round trip at a time, so
    // each supabase.from(...) call gets its OWN fresh chain, in call order —
    // simplest way to see exactly what each individual write contained.
    const chains: ReturnType<typeof makeChain>[] = []
    fromMock.mockImplementation(() => {
      const chain = makeChain({ data: null, error: null })
      chains.push(chain)
      return chain
    })

    const updates = [
      { id: 'wi-a', position: 1 },
      { id: 'wi-b', position: 0 },
    ]
    await reorderWarmupItems(updates)

    expect(chains).toHaveLength(4) // 2 items × 2 phases
    const calls = chains.map((c) => ({
      position: ((c.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as { position: number }).position,
      id: (c.eq as ReturnType<typeof vi.fn>).mock.calls[0][1],
    }))
    // Phase 1 (both moved to position + 2, offset = updates.length), THEN
    // phase 2 (both land on their real, final position) — input order
    // preserved within each phase, phase 1 entirely before phase 2.
    expect(calls).toEqual([
      { id: 'wi-a', position: 3 },
      { id: 'wi-b', position: 2 },
      { id: 'wi-a', position: 1 },
      { id: 'wi-b', position: 0 },
    ])
  })

  it('every phase-1 target position is OUTSIDE the final [0, n) range — never collides with an untouched row', () => {
    const updates = [
      { id: 'wi-a', position: 0 },
      { id: 'wi-b', position: 1 },
      { id: 'wi-c', position: 2 },
    ]
    const offset = updates.length
    const phase1Targets = updates.map((u) => u.position + offset)
    expect(phase1Targets).toEqual([3, 4, 5])
    expect(new Set(phase1Targets).size).toBe(phase1Targets.length) // all distinct
    for (const t of phase1Targets) expect(t).toBeGreaterThanOrEqual(updates.length) // disjoint from [0, n)
  })
})

describe('moveWarmupItem — pure, same "same reference back = no-op" convention as supersetGroups.ts\'s moveUnit', () => {
  const items: WarmupRoutineItem[] = [
    { id: 'wi-1', userId: 'user-1', workoutDayId: 'wd-1', position: 0, body: 'A' },
    { id: 'wi-2', userId: 'user-1', workoutDayId: 'wd-1', position: 1, body: 'B' },
    { id: 'wi-3', userId: 'user-1', workoutDayId: 'wd-1', position: 2, body: 'C' },
  ]

  it('moving the first item up is a no-op (returns the SAME array reference)', () => {
    expect(moveWarmupItem(items, 0, 'up')).toBe(items)
  })

  it('moving the last item down is a no-op (returns the SAME array reference)', () => {
    expect(moveWarmupItem(items, 2, 'down')).toBe(items)
  })

  it('moving the middle item up swaps it with the first (ids only — position is reindexed by the caller)', () => {
    const next = moveWarmupItem(items, 1, 'up')
    expect(next).not.toBe(items)
    expect(next.map((i) => i.id)).toEqual(['wi-2', 'wi-1', 'wi-3'])
  })

  it('moving the middle item down swaps it with the last', () => {
    const next = moveWarmupItem(items, 1, 'down')
    expect(next.map((i) => i.id)).toEqual(['wi-1', 'wi-3', 'wi-2'])
  })
})
