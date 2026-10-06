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

const { updateSetLog, logSet } = await import('./sessionService')

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

// logSet's own chain: .insert(payload).select('*, exercises(*)').single().
function makeInsertChain(result: { data?: unknown; error?: unknown } = { data: {}, error: null }) {
  const chain: Record<string, unknown> = {
    insert: vi.fn(() => chain),
    select: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
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

// D30 (Adam's standing rule, chunk 9) — chunk 9 changes how the workout
// screen READS its exercises (runProgramExercises.ts), never how it LOGS a
// set: logSet takes every field as a plain parameter from its caller
// (GymSession.tsx's handleLog -> ExerciseCard.tsx), with no read of
// v2_program_exercises or any program-exercise data at all. This is the
// exact row a plain session's set (plain sets plus one existing dropset —
// the same fixture GymSession.renderParity.test.tsx/the D30 worktree
// comparison use) writes, proving that row is unaffected by this chunk.
//
// Online only: useLogSet's offline branch (useSession.ts, around its own
// db.sync_queue.add call) writes the identical field set — same names,
// same values, same `note: null` — to table: 'v2_set_logs', verified by
// inspection rather than a second Dexie-backed test here; chunk 9 touches
// neither branch.
describe('logSet — D30: the exact row written is unaffected by chunk 9 (a plain head set, then its dropset stage)', () => {
  it('a plain head set\'s insert payload has every field, byte-for-byte, no program-exercise data anywhere in it', async () => {
    const chain = makeInsertChain({
      data: { id: 'set-1', user_id: 'u1', session_id: 'session-1', exercise_id: 'ex-1', week_plan_set_id: 'wps-1', set_number: 1, weight: 100, reps: 8, rir: 2, note: null, is_dropset: false, parent_set_id: null, stage_index: 0, is_skipped: false, logged_at: '2026-01-05T10:00:00.000Z', rest_seconds: null, set_seconds: null, entered_unit: 'kg', form_rating: null },
      error: null,
    })
    fromMock.mockReturnValue(chain)

    await logSet({
      id: 'set-1',
      userId: 'u1',
      sessionId: 'session-1',
      exerciseId: 'ex-1',
      weekPlanSetId: 'wps-1',
      setNumber: 1,
      weight: 100,
      reps: 8,
      rir: 2,
      note: null,
      isDropset: false,
      parentSetId: null,
      stageIndex: 0,
      isSkipped: false,
      restSeconds: null,
      setSeconds: null,
      enteredUnit: 'kg',
      formRating: null,
    })

    expect(fromMock).toHaveBeenCalledWith('v2_set_logs')
    const payload = (chain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    const { logged_at, ...rest } = payload
    expect(typeof logged_at).toBe('string')
    expect(rest).toEqual({
      id: 'set-1',
      user_id: 'u1',
      session_id: 'session-1',
      exercise_id: 'ex-1',
      week_plan_set_id: 'wps-1',
      set_number: 1,
      weight: 100,
      reps: 8,
      rir: 2,
      note: null,
      is_dropset: false,
      parent_set_id: null,
      stage_index: 0,
      is_skipped: false,
      rest_seconds: null,
      set_seconds: null,
      entered_unit: 'kg',
      form_rating: null,
    })
    expect(chain.select).toHaveBeenCalledWith('*, exercises(*)')
  })

  it('the existing dropset\'s stage (the fixture\'s set-1-drop) carries parent_set_id/stage_index, same field set otherwise', async () => {
    const chain = makeInsertChain({
      data: { id: 'set-1-drop', user_id: 'u1', session_id: 'session-1', exercise_id: 'ex-1', week_plan_set_id: 'wps-1-drop', set_number: 1, weight: 80, reps: 10, rir: 0, note: null, is_dropset: true, parent_set_id: 'set-1', stage_index: 1, is_skipped: false, logged_at: '2026-01-05T10:00:05.000Z', rest_seconds: null, set_seconds: null, entered_unit: 'kg', form_rating: null },
      error: null,
    })
    fromMock.mockReturnValue(chain)

    await logSet({
      id: 'set-1-drop',
      userId: 'u1',
      sessionId: 'session-1',
      exerciseId: 'ex-1',
      weekPlanSetId: 'wps-1-drop',
      setNumber: 1,
      weight: 80,
      reps: 10,
      rir: 0,
      note: null,
      isDropset: true,
      parentSetId: 'set-1',
      stageIndex: 1,
      isSkipped: false,
      restSeconds: null,
      setSeconds: null,
      enteredUnit: 'kg',
      formRating: null,
    })

    const payload = (chain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload.is_dropset).toBe(true)
    expect(payload.parent_set_id).toBe('set-1')
    expect(payload.stage_index).toBe(1)
  })
})
