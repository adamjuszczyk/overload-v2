import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakePostgrest, type Tables } from './fakePostgrest.testutil'

// Chunk 74 (1.2.1 item 8a; SPEC Screens → Programs · YOUR PROGRAMS: delete a saved program, Objects stored → Changed `v2_programs.deleted_at`,
// New database functions → `v2_delete_saved_program`, Facts to verify 1). The service half of deleting a saved program:
//
//   - `deleteSavedProgram` sends exactly the RPC (`v2_delete_saved_program`, one parameter) and writes through no table; the database's refusal
//     reaches the caller as the error object itself, `code` and all (PostgREST 12 answers `OL001`–`OL003` with 400 and `P0002` with 500: the
//     screen reads `error.code`, never a status).
//   - `fetchSavedPrograms` asks for `deleted_at` is null in the query AND maps through `isListedSavedProgram`; each is proven apart (a chain that
//     ignores filters shows the predicate, the call arguments show the filter, and the PostgREST stand-in shows the two together).
//   - `fetchPrograms` stays unfiltered (the planner reads a program by its id, CHANGE THE PROGRAM reads a deleted program's name) and carries
//     `deletedAt`, which only a named column list that holds `deleted_at` can deliver: the stand-in returns just the columns a select names.
//
// The fixture tells the three kinds of row apart: a saved program that is still there, a saved program that was deleted, and a run's copy.

const fromMock = vi.fn()
const rpcMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}))
vi.mock('../../lib/muscleGroup', () => ({ toMuscleGroup: (v: unknown) => v }))

const { fetchPrograms, fetchProgram, fetchSavedPrograms, createProgram, deleteSavedProgram, isListedSavedProgram } = await import('./programService')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

const DELETED_AT = '2026-10-30T20:15:00+00:00'

function row(over: Record<string, unknown> & { id: string }): Record<string, unknown> {
  return {
    user_id: 'user-1',
    name: over.id,
    schedule: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    kind: 'saved',
    planning_type: 'stable',
    schedule_type: 'weekday',
    deleted_at: null,
    ...over,
  }
}

// What the table holds: two saved programs of which one was deleted, and the copy a running program owns.
const LIVE = row({ id: 'saved-live', name: 'Push Pull Legs' })
const GONE = row({ id: 'saved-deleted', name: 'Old Block', deleted_at: DELETED_AT })
const COPY = row({ id: 'run-copy', name: 'Push Pull Legs', kind: 'run' })
const TABLES = (): Tables => ({ v2_programs: [LIVE, GONE, COPY].map((r) => ({ ...r })) })

/** The stand-in as the code under test sees `supabase.from`. (`from` is read as a value and called through a cast, never called with a variable: verify-rls-tables.test.mjs refuses that spelling, RULES.) `insert` is added for createProgram, which inserts and selects the row back. */
const standIn = (fake: ReturnType<typeof fakePostgrest>) => (table: string) => {
  const builder = (fake.client.from as unknown as (t: string) => Record<string, unknown>)(table)
  builder.insert = () => builder
  return builder
}

/** A chain that records its calls and answers with the rows it is given WHATEVER it was asked: a filter in the query can't be what removes a row here. */
function recordingChain(rows: unknown[]) {
  const result = { data: rows, error: null }
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve({ data: rows[0], error: null })),
    insert: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

describe('deleteSavedProgram — exactly the RPC (W)', () => {
  // a table that would answer if it were asked: a delete written through it must fail an assertion here, not a TypeError
  beforeEach(() => {
    fromMock.mockReturnValue(recordingChain([]))
  })

  it('sends rpc("v2_delete_saved_program", { p_program_id }) once, and writes through no table', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })

    await deleteSavedProgram('prog-7')

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('v2_delete_saved_program', { p_program_id: 'prog-7' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('takes the id it is given, whichever (two programs, two calls, each with its own id)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })

    await deleteSavedProgram('prog-a')
    await deleteSavedProgram('prog-b')

    expect(rpcMock.mock.calls).toEqual([
      ['v2_delete_saved_program', { p_program_id: 'prog-a' }],
      ['v2_delete_saved_program', { p_program_id: 'prog-b' }],
    ])
  })

  it('resolves to nothing: the function returns void', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })
    await expect(deleteSavedProgram('prog-7')).resolves.toBeUndefined()
  })

  it.each([
    ['OL001', 'Overload is being updated. Writes are refused until maintenance is off.'],
    ['OL002', 'a program with a running program cannot be deleted: finish it first'],
    ['P0002', 'program not found: 00000000-0000-0000-0000-000000000000'],
  ])('%s: the database\'s refusal is thrown as the very object it came as, code and message intact (the screen reads error.code, never the status)', async (code, message) => {
    const error = { code, message, details: null, hint: null }
    rpcMock.mockResolvedValue({ data: null, error })

    await expect(deleteSavedProgram('prog-7')).rejects.toBe(error)
  })

  it('a request that fails outright (the phone is offline) rejects with that error', async () => {
    rpcMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(deleteSavedProgram('prog-7')).rejects.toThrow('Failed to fetch')
  })
})

describe('fetchSavedPrograms — the query leaves marked rows out (W)', () => {
  it('asks for kind = saved AND deleted_at is null, newest first, from v2_programs', async () => {
    const chain = recordingChain([])
    fromMock.mockReturnValue(chain)

    await fetchSavedPrograms()

    expect(fromMock).toHaveBeenCalledWith('v2_programs')
    expect(chain.eq).toHaveBeenCalledWith('kind', 'saved')
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null)
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('names deleted_at among the columns it selects', async () => {
    const chain = recordingChain([])
    fromMock.mockReturnValue(chain)

    await fetchSavedPrograms()

    const columns = ((chain.select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string).split(',').map((c) => c.trim())
    expect(columns).toContain('deleted_at')
  })

  it('and the mapped list leaves a row with deleted_at out even when the query let it through: the saved program that is still there is the only one', async () => {
    // the chain ignores every filter and answers with all three rows, as a database that did not apply the filter would
    fromMock.mockReturnValue(recordingChain([LIVE, GONE, COPY]))

    const list = await fetchSavedPrograms()

    expect(list.map((p) => p.id)).toEqual(['saved-live'])
  })

  it('against a stand-in that filters as PostgREST does: the same fixture gives the same list, and the filter reached the table', async () => {
    const fake = fakePostgrest(TABLES())
    fromMock.mockImplementation(standIn(fake))

    const list = await fetchSavedPrograms()

    expect(list.map((p) => p.id)).toEqual(['saved-live'])
    expect(fake.to('v2_programs')[0].filters).toEqual([
      { op: 'eq', column: 'kind', value: 'saved' },
      { op: 'is', column: 'deleted_at', value: null },
    ])
  })

  it('a row that was never marked reads as not deleted (deletedAt null), however the column came back: null, or not at all', async () => {
    const withoutColumn = { ...LIVE }
    delete (withoutColumn as { deleted_at?: unknown }).deleted_at
    fromMock.mockReturnValue(recordingChain([LIVE, { ...LIVE, id: 'saved-other' }, { ...withoutColumn, id: 'saved-bare' }]))

    const list = await fetchSavedPrograms()

    expect(list.map((p) => [p.id, p.deletedAt])).toEqual([
      ['saved-live', null],
      ['saved-other', null],
      ['saved-bare', null],
    ])
  })
})

describe('fetchPrograms — stays unfiltered, and carries deletedAt (the planner reads by id; CHANGE THE PROGRAM reads a deleted program\'s name)', () => {
  it('returns all three rows, the marked one with its timestamp, the others null', async () => {
    const fake = fakePostgrest(TABLES())
    fromMock.mockImplementation(standIn(fake))

    const list = await fetchPrograms()

    expect(list.map((p) => [p.id, p.kind, p.deletedAt])).toEqual([
      ['saved-live', 'saved', null],
      ['saved-deleted', 'saved', DELETED_AT],
      ['run-copy', 'run', null],
    ])
    // ... and it asked for no filter at all
    expect(fake.to('v2_programs')[0].filters).toEqual([])
  })

  it('fetchProgram (one by id) carries deletedAt too', async () => {
    const fake = fakePostgrest(TABLES())
    fromMock.mockImplementation(standIn(fake))

    const program = await fetchProgram('saved-deleted')

    expect(program.deletedAt).toBe(DELETED_AT)
  })

  it.each([
    ['fetchPrograms', () => fetchPrograms()],
    ['fetchProgram', () => fetchProgram('saved-live')],
    ['fetchSavedPrograms', () => fetchSavedPrograms()],
    ['createProgram', () => createProgram('user-1', 'x', { scheduleType: 'weekday', planningType: 'stable' })],
  ])('%s: the named column list holds deleted_at (a stand-in returns only the columns a select names, so a list without it could not deliver it)', async (_name, call) => {
    const fake = fakePostgrest({ v2_programs: [{ ...LIVE }] })
    fromMock.mockImplementation(standIn(fake))

    await call()

    const selects = fake.to('v2_programs').map((r) => r.select)
    expect(selects.length).toBeGreaterThan(0)
    for (const select of selects) expect(select.split(',').map((c) => c.trim())).toContain('deleted_at')
  })
})

describe('isListedSavedProgram — kind saved (unset reads as saved) and not deleted', () => {
  it.each([
    ['saved', null, true],
    ['saved', undefined, true],
    ['saved', DELETED_AT, false],
    [undefined, null, true],
    [undefined, undefined, true],
    [undefined, DELETED_AT, false],
    ['run', null, false],
    ['run', undefined, false],
    ['run', DELETED_AT, false],
  ] as const)('kind %s, deletedAt %s: %s', (kind, deletedAt, listed) => {
    expect(isListedSavedProgram({ kind, deletedAt })).toBe(listed)
  })

  it('takes the Program it is given as it is (a whole Program, not only the two fields)', async () => {
    fromMock.mockReturnValue(recordingChain([LIVE, GONE, COPY]))
    const all = await fetchPrograms()
    expect(all.filter(isListedSavedProgram).map((p) => p.id)).toEqual(['saved-live'])
  })
})
