import { describe, it, expect, vi, beforeEach } from 'vitest'

// checkReassignBlockers (P3/P4, §5.2) touches two independent stores — the
// local Dexie sync queue and a live Supabase query — so each is mocked on
// its own module, same reasoning as exerciseService.test.ts's fromMock:
// this is the first test in the suite to also touch ../../lib/db.
const fromMock = vi.fn()
const rpcMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}))

const syncQueueCountMock = vi.fn()
const workoutDaysToArrayMock = vi.fn()
const workoutDaysUpdateMock = vi.fn()
const exercisesDeleteMock = vi.fn()
const setLogsDeleteMock = vi.fn()
vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: { count: (...args: unknown[]) => syncQueueCountMock(...args) },
    exercises: { delete: (...args: unknown[]) => exercisesDeleteMock(...args) },
    // where('exerciseId').equals(id).delete() — the one chained Dexie call here.
    set_logs: { where: () => ({ equals: () => ({ delete: (...a: unknown[]) => setLogsDeleteMock(...a) }) }) },
    workout_days: {
      toArray: (...args: unknown[]) => workoutDaysToArrayMock(...args),
      update: (...args: unknown[]) => workoutDaysUpdateMock(...args),
    },
  },
}))

const { checkReassignBlockers, reassignExerciseHistory, ReassignBlockedError, reprimeAfterReassign } = await import('./reassignService')

// A thenable stand-in for supabase-js's query builder, matching
// exerciseService.test.ts's makeChain — `.select(..., {count, head:true})`
// resolves without a trailing `.single()`.
function makeChain(result: { count?: number | null; error?: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
  syncQueueCountMock.mockReset()
  workoutDaysToArrayMock.mockReset()
  workoutDaysUpdateMock.mockReset()
  exercisesDeleteMock.mockReset()
  setLogsDeleteMock.mockReset()
})

const RPC_ROW = {
  set_logs_moved: 2,
  program_exercises_moved: 0,
  program_exercises_merged: 1,
  plan_sets_moved: 0,
  source_deleted: true,
}

// The state the sheet is in when a target has just been picked and the
// selection-time check came back clear: an empty sync queue, no live session.
function clearAtSelection() {
  syncQueueCountMock.mockResolvedValueOnce(0)
  fromMock.mockReturnValueOnce(makeChain({ count: 0, error: null }))
}

describe('checkReassignBlockers — P3/P4 (§5.2)', () => {
  it('both clear: empty sync queue, no session in progress', async () => {
    syncQueueCountMock.mockResolvedValue(0)
    const sessionsChain = makeChain({ count: 0, error: null })
    fromMock.mockReturnValue(sessionsChain)

    const result = await checkReassignBlockers()

    expect(result).toEqual({ hasUnsyncedSets: false, hasSessionInProgress: false })
    expect(fromMock).toHaveBeenCalledWith('v2_sessions')
    expect(sessionsChain.eq).toHaveBeenCalledWith('status', 'in_progress')
  })

  it('P3 — a non-empty sync queue blocks independently of session state', async () => {
    syncQueueCountMock.mockResolvedValue(2)
    fromMock.mockReturnValue(makeChain({ count: 0, error: null }))

    const result = await checkReassignBlockers()

    expect(result.hasUnsyncedSets).toBe(true)
    expect(result.hasSessionInProgress).toBe(false)
  })

  it('P4 — a session in progress blocks independently of sync queue state', async () => {
    syncQueueCountMock.mockResolvedValue(0)
    fromMock.mockReturnValue(makeChain({ count: 1, error: null }))

    const result = await checkReassignBlockers()

    expect(result.hasUnsyncedSets).toBe(false)
    expect(result.hasSessionInProgress).toBe(true)
  })

  it('both block at once', async () => {
    syncQueueCountMock.mockResolvedValue(5)
    fromMock.mockReturnValue(makeChain({ count: 3, error: null }))

    const result = await checkReassignBlockers()

    expect(result).toEqual({ hasUnsyncedSets: true, hasSessionInProgress: true })
  })

  it('propagates a query error rather than silently reading as clear', async () => {
    syncQueueCountMock.mockResolvedValue(0)
    fromMock.mockReturnValue(makeChain({ count: null, error: new Error('boom') }))

    await expect(checkReassignBlockers()).rejects.toThrow('boom')
  })
})

// The gap this closes: checkReassignBlockers() used to run exactly once, in
// ReassignSheet.tsx's selectTarget(), and was never re-read before the tap on
// MERGE HISTORY. Anything that happened on this device while the sheet sat
// open — a set logged offline, a session started in another tab — left a
// stale blocked=false behind and the merge went through on it. Each test
// below drives the real check twice against changing mocked state, the way
// the sheet does: once for the selection-time snapshot, then again from
// inside reassignExerciseHistory() itself.
describe('reassignExerciseHistory — P3/P4 re-checked immediately before the RPC', () => {
  it('still fires the RPC when nothing changed between selection and confirm', async () => {
    clearAtSelection()
    const atSelection = await checkReassignBlockers()
    expect(atSelection).toEqual({ hasUnsyncedSets: false, hasSessionInProgress: false })

    syncQueueCountMock.mockResolvedValue(0)
    fromMock.mockReturnValue(makeChain({ count: 0, error: null }))
    rpcMock.mockResolvedValue({ data: [RPC_ROW], error: null })

    const result = await reassignExerciseHistory('src-1', 'tgt-1')

    expect(rpcMock).toHaveBeenCalledWith('reassign_exercise_history', { p_source: 'src-1', p_target: 'tgt-1' })
    expect(result).toEqual({
      setLogsMoved: 2,
      programExercisesMoved: 0,
      programExercisesMerged: 1,
      planSetsMoved: 0,
      sourceDeleted: true,
    })
  })

  it('P3 — a set logged offline after the target was picked blocks the merge, and the RPC is never called', async () => {
    clearAtSelection()
    expect(await checkReassignBlockers()).toEqual({ hasUnsyncedSets: false, hasSessionInProgress: false })

    // …then a set is logged offline on this same device while the sheet sits
    // open. The sheet's own `blockers` state still says clear.
    syncQueueCountMock.mockResolvedValue(1)
    fromMock.mockReturnValue(makeChain({ count: 0, error: null }))
    rpcMock.mockResolvedValue({ data: [RPC_ROW], error: null })

    await expect(reassignExerciseHistory('src-1', 'tgt-1')).rejects.toBeInstanceOf(ReassignBlockedError)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('P4 — a session started after the target was picked blocks the merge, and the RPC is never called', async () => {
    clearAtSelection()
    expect(await checkReassignBlockers()).toEqual({ hasUnsyncedSets: false, hasSessionInProgress: false })

    syncQueueCountMock.mockResolvedValue(0)
    fromMock.mockReturnValue(makeChain({ count: 1, error: null }))
    rpcMock.mockResolvedValue({ data: [RPC_ROW], error: null })

    await expect(reassignExerciseHistory('src-1', 'tgt-1')).rejects.toBeInstanceOf(ReassignBlockedError)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('the raised error carries the freshly-observed blockers, not the selection-time ones', async () => {
    clearAtSelection()
    await checkReassignBlockers()

    syncQueueCountMock.mockResolvedValue(3)
    fromMock.mockReturnValue(makeChain({ count: 2, error: null }))

    await expect(reassignExerciseHistory('src-1', 'tgt-1')).rejects.toMatchObject({
      blockers: { hasUnsyncedSets: true, hasSessionInProgress: true },
    })
  })

  it('fails closed — a re-check that errors leaves the RPC uncalled rather than reading as clear', async () => {
    syncQueueCountMock.mockResolvedValue(0)
    fromMock.mockReturnValue(makeChain({ count: null, error: new Error('offline') }))
    rpcMock.mockResolvedValue({ data: [RPC_ROW], error: null })

    await expect(reassignExerciseHistory('src-1', 'tgt-1')).rejects.toThrow('offline')
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

// §5.5 item 2 — db.workout_days' serialised ProgramExercise[] blob carries
// exercise identity in two places per slot: the slot's own exerciseId AND the
// joined `exercise` object. Re-pointing only the first leaves the offline gym
// view rendering the name of the exercise the merge just deleted, since
// ExerciseHeader.tsx reads programExercise.exercise?.name — the precise
// outcome §5.5 exists to prevent. Found by §8 step 10's adversarial review.
describe('reprimeAfterReassign — the offline workout-day blob (§5.5 item 2)', () => {
  const TARGET = {
    id: 'tgt-1', userId: 'u1', name: 'Incline Smith Press', muscleGroup: 'chest',
    isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null,
    movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
  } as never

  function slot(exerciseId: string, name: string) {
    return {
      id: 'pe-' + exerciseId, workoutDayId: 'day-1', userId: 'u1', exerciseId,
      exercise: { id: exerciseId, userId: 'u1', name, muscleGroup: 'chest', isArchived: false },
      position: 0, targetReps: null, weightUnit: null,
    }
  }

  it('re-points BOTH the slot id and its joined exercise object', async () => {
    workoutDaysToArrayMock.mockResolvedValue([{ id: 'day-1', exercises: [slot('src-1', 'Chest Press')] }])

    await reprimeAfterReassign('src-1', TARGET)

    const [dayId, changes] = workoutDaysUpdateMock.mock.calls[0]
    expect(dayId).toBe('day-1')
    expect(changes.exercises[0].exerciseId).toBe('tgt-1')
    // The half-fix this test exists to catch: id updated, join left behind.
    expect(changes.exercises[0].exercise.id).toBe('tgt-1')
    expect(changes.exercises[0].exercise.name).toBe('Incline Smith Press')
  })

  it('keeps the slot itself otherwise intact — position and pe id are unchanged', async () => {
    const original = { ...slot('src-1', 'Chest Press'), position: 3 }
    workoutDaysToArrayMock.mockResolvedValue([{ id: 'day-1', exercises: [original] }])

    await reprimeAfterReassign('src-1', TARGET)

    const changed = workoutDaysUpdateMock.mock.calls[0][1].exercises[0]
    expect(changed.id).toBe('pe-src-1')
    expect(changed.position).toBe(3)
  })

  it('on a §5.3 step 2b collision drops the source slot rather than producing two for one exercise', async () => {
    workoutDaysToArrayMock.mockResolvedValue([
      { id: 'day-1', exercises: [slot('src-1', 'Chest Press'), slot('tgt-1', 'Incline Smith Press')] },
    ])

    await reprimeAfterReassign('src-1', TARGET)

    const next = workoutDaysUpdateMock.mock.calls[0][1].exercises
    expect(next).toHaveLength(1)
    expect(next[0].exerciseId).toBe('tgt-1')
  })

  it('leaves days that never listed the source untouched', async () => {
    workoutDaysToArrayMock.mockResolvedValue([{ id: 'day-2', exercises: [slot('other-1', 'Dips')] }])

    await reprimeAfterReassign('src-1', TARGET)

    expect(workoutDaysUpdateMock).not.toHaveBeenCalled()
    // The other two caches are unconditional — the source identity is gone
    // server-side either way.
    expect(exercisesDeleteMock).toHaveBeenCalledWith('src-1')
    expect(setLogsDeleteMock).toHaveBeenCalled()
  })
})
