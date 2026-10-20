import { describe, it, expect, vi, beforeEach } from 'vitest'

// programService.ts imports the real Supabase client at module load time
// (supabase.ts throws if env vars are missing) — mocked here the same way
// sessionService.test.ts's own precedent does, so fetchSavedPrograms' exact
// filter can be inspected directly rather than inferred.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))
vi.mock('../../lib/muscleGroup', () => ({ toMuscleGroup: (v: unknown) => v }))

const { fetchPrograms, fetchSavedPrograms, createProgram, updatePlanningType } = await import('./programService')

function makeChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
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

// Chunk 6, TASKS.md — "program lists show kind = 'saved' only". Two
// functions, not one filtered conditionally: fetchSavedPrograms is for
// ProgramPage's own list and its Start Mesocycle picker — the only two
// places a user picks a reusable template from; fetchPrograms stays
// unfiltered for PlanPage/the planner (PlannerPage.tsx), which look a
// program up by a known id that is a run's own copy (kind = 'run') while a
// run is active.
describe('fetchSavedPrograms — filters to kind = \'saved\' at the query', () => {
  it('calls v2_programs with .eq(\'kind\', \'saved\')', async () => {
    const chain = makeChain({ data: [], error: null })
    fromMock.mockReturnValue(chain)

    await fetchSavedPrograms()

    expect(fromMock).toHaveBeenCalledWith('v2_programs')
    expect(chain.eq).toHaveBeenCalledWith('kind', 'saved')
  })

  it('maps rows to Program the same way fetchPrograms does, with kind carried through', async () => {
    const row = {
      id: 'prog-1',
      user_id: 'user-1',
      name: 'PPL',
      schedule: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      kind: 'saved',
    }
    const chain = makeChain({ data: [row], error: null })
    fromMock.mockReturnValue(chain)

    const result = await fetchSavedPrograms()

    expect(result[0].kind).toBe('saved')
    expect(result[0].id).toBe('prog-1')
  })
})

describe('fetchPrograms — stays unfiltered (PlanPage/the planner need a run\'s own copy too)', () => {
  it('does not call .eq(\'kind\', ...) at all', async () => {
    const chain = makeChain({ data: [], error: null })
    fromMock.mockReturnValue(chain)

    await fetchPrograms()

    expect(fromMock).toHaveBeenCalledWith('v2_programs')
    expect(chain.eq).not.toHaveBeenCalled()
  })

  it('a kind = \'run\' row still maps through (not silently dropped)', async () => {
    const row = {
      id: 'run-copy-1',
      user_id: 'user-1',
      name: 'Upper/Lower',
      schedule: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      kind: 'run',
    }
    const chain = makeChain({ data: [row], error: null })
    fromMock.mockReturnValue(chain)

    const result = await fetchPrograms()

    expect(result[0].kind).toBe('run')
  })
})

// Chunk 48 (SPEC Objects stored → Program [1.2]: "The stored deload-rules override is no longer
// read or written (16b). The column stays; ... Any existing override falls back to Settings
// silently."): a program row that still carries one reads as a Program without it, through every
// read this service makes, and no read asks for the column (TASKS: "the column is simply not
// selected"). The row holds a non-empty override, so a mapper that kept reading it would show.
describe('v2_programs.deload_rules is not read (chunk 48)', () => {
  const rowWithOverride = {
    id: 'prog-1', user_id: 'user-1', name: 'STG Upper/Lower', schedule: {},
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    kind: 'saved', planning_type: 'week_dependent', schedule_type: 'weekday',
    deload_rules: { sets: { mode: 'count', value: 1, rounding: 'down' }, rir: { delta: 2 } },
  }
  const selectedColumns = (chain: Record<string, unknown>) => (chain.select as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string

  it.each([
    ['fetchPrograms', () => fetchPrograms()],
    ['fetchSavedPrograms', () => fetchSavedPrograms()],
  ])('%s: the row\'s stored override does not reach the Program', async (_name, call) => {
    fromMock.mockReturnValue(makeChain({ data: [rowWithOverride], error: null }))

    const [program] = await call()

    expect(program.id).toBe('prog-1')
    expect(program).not.toHaveProperty('deloadRules')
    expect(Object.values(program)).not.toContainEqual(rowWithOverride.deload_rules)
  })

  it('createProgram: the inserted row\'s stored override does not reach the Program either', async () => {
    fromMock.mockReturnValue(makeChain({ data: rowWithOverride, error: null }))

    const program = await createProgram('user-1', 'STG Upper/Lower', { scheduleType: 'weekday', planningType: 'stable' })

    expect(program).not.toHaveProperty('deloadRules')
  })

  it.each([
    ['fetchPrograms', () => fetchPrograms()],
    ['fetchSavedPrograms', () => fetchSavedPrograms()],
    ['createProgram', () => createProgram('user-1', 'x', { scheduleType: 'weekday', planningType: 'stable' })],
  ])('%s asks for named columns: not `*`, and not deload_rules', async (_name, call) => {
    const chain = makeChain({ data: [rowWithOverride], error: null })
    fromMock.mockReturnValue(chain)
    ;(chain.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data: rowWithOverride, error: null })

    await call()

    const columns = selectedColumns(chain)
    expect(columns).toBeTruthy()
    expect(columns.trim()).not.toBe('*')
    expect(columns).not.toContain('deload_rules')
    // ... and still every column Program is built from (nothing the app reads was dropped).
    for (const column of ['id', 'user_id', 'name', 'schedule', 'created_at', 'updated_at', 'kind', 'planning_type', 'schedule_type']) {
      expect(columns.split(',').map((c) => c.trim()), column).toContain(column)
    }
  })
})

// Chunk 11 (SPEC.md "Stepped program planner" step 3) — the planner's own
// first writer of v2_programs.planning_type.
describe('updatePlanningType', () => {
  it('updates v2_programs by id, writing exactly planning_type (+ updated_at)', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await updatePlanningType('prog-1', 'stable')

    expect(fromMock).toHaveBeenCalledWith('v2_programs')
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ planning_type: 'stable' }),
    )
    expect(chain.eq).toHaveBeenCalledWith('id', 'prog-1')
  })

  it('throws on a Supabase error rather than swallowing it', async () => {
    const chain = makeChain({ data: null, error: new Error('boom') })
    fromMock.mockReturnValue(chain)

    await expect(updatePlanningType('prog-1', 'week_dependent')).rejects.toThrow('boom')
  })
})

// Chunk 65 (SPEC Programs and runs [1.2], Creating a program (16a): "the New program sheet asks for the name, the schedule type and the
// planning type. Neither type is preselected"; TASKS-1.2 chunk 65: "`createProgram` extended to take both types in one insert"). The
// writer's own proof: the insert carries the two types the caller chose, each as its own column, and a pair that differs from the columns'
// defaults ('weekday', 'week_dependent') is what tells a payload that carries the choice from one that leaves it to the defaults.
describe('createProgram — both types in one insert (chunk 65)', () => {
  const row = {
    id: 'prog-9', user_id: 'user-1', name: 'Block', schedule: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    kind: 'saved', planning_type: 'stable', schedule_type: 'sequence',
  }
  const insertedRow = (chain: Record<string, unknown>) => (chain.insert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]

  it.each([
    ['sequence', 'stable'],
    ['weekday', 'week_dependent'],
    ['sequence', 'week_dependent'],
    ['weekday', 'stable'],
  ] as const)('%s + %s: one insert on v2_programs carries schedule_type and planning_type, the trimmed name and the empty schedule', async (scheduleType, planningType) => {
    const chain = makeChain({ data: { ...row, schedule_type: scheduleType, planning_type: planningType }, error: null })
    fromMock.mockReturnValue(chain)

    const program = await createProgram('user-1', '  Block  ', { scheduleType, planningType })

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith('v2_programs')
    expect(chain.insert).toHaveBeenCalledTimes(1)
    expect(insertedRow(chain)).toEqual({
      user_id: 'user-1',
      name: 'Block',
      schedule: { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
      schedule_type: scheduleType,
      planning_type: planningType,
    })
    // ... and the program read back carries them
    expect(program.scheduleType).toBe(scheduleType)
    expect(program.planningType).toBe(planningType)
  })

  it('refuses at run time a call that leaves a type out or names one the columns don\'t have, and writes nothing', async () => {
    const calls = [
      () => createProgram('user-1', 'Block', undefined as never),
      () => createProgram('user-1', 'Block', {} as never),
      () => createProgram('user-1', 'Block', { scheduleType: 'weekday' } as never),
      () => createProgram('user-1', 'Block', { planningType: 'stable' } as never),
      () => createProgram('user-1', 'Block', { scheduleType: 'weekdays', planningType: 'stable' } as never),
      () => createProgram('user-1', 'Block', { scheduleType: 'weekday', planningType: 'week-dependent' } as never),
    ]
    for (const call of calls) await expect(call()).rejects.toThrow('createProgram needs a schedule type and a planning type')
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('the compiler refuses it too: both types are required, with no default (proven under `tsc`: an unused expect-error fails there)', () => {
    // never executed: a call is only type-checked
    const never = false as boolean
    if (never) {
      // @ts-expect-error — the third argument is required
      void createProgram('user-1', 'Block')
      // @ts-expect-error — the planning type is required
      void createProgram('user-1', 'Block', { scheduleType: 'weekday' })
      // @ts-expect-error — the schedule type is required
      void createProgram('user-1', 'Block', { planningType: 'stable' })
    }
    expect(never).toBe(false)
  })

  it('a Supabase error is thrown with its own message, not swallowed', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { message: 'duplicate key value violates unique constraint' } }))
    await expect(createProgram('user-1', 'Block', { scheduleType: 'weekday', planningType: 'stable' })).rejects.toMatchObject({ message: 'duplicate key value violates unique constraint' })
  })
})
