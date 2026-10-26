import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Exercise } from '../../types'
import type { SwapRecord } from './workoutRules'

// Chunk 59 (migration 047; DECISIONS 183, 200): the swap's row, written with the record of which sets moved and read back with it.
// `__fixtures__/swap-insert-before-59.json` is the frozen "before": the insert `recordExerciseSwap` sent before this chunk (staging at
// ae25ab1), captured by running that code. The row now carries one more key, `moved_sets`, and no other differs.

const BEFORE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'swap-insert-before-59.json'), 'utf8')) as Record<string, unknown>

const inserted: Array<Record<string, unknown>> = []
let answer: { data: Record<string, unknown> | null; error: unknown } = { data: null, error: null }
let rows: Array<Record<string, unknown>> = []
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: string[]) => ({
      insert: (payload: Record<string, unknown>) => {
        inserted.push({ table: args[0], ...payload })
        return { select: () => ({ single: () => Promise.resolve(answer) }) }
      },
      select: () => ({ eq: () => Promise.resolve({ data: rows, error: null }) }),
    }),
  },
}))

const { recordExerciseSwap, fetchSessionSwaps } = await import('./sessionService')

const exercise = (id: string, name: string): Exercise => ({
  id, userId: 'user-1', name, muscleGroup: 'chest', isArchived: false, createdAt: '', muscleSubgroups: null, movementPattern: null,
  status: 'active', sourceLibraryId: null, lostAt: null,
})
const RECORD: SwapRecord = { fromKey: 'pe-1', moved: [{ from: { weekPlanSetId: 'set-2' }, place: 1 }, { from: { addedPlace: 1 }, place: 2 }] }
const rowOf = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'swap-1', session_id: 'session-1', program_exercise_id: 'pe-1', original_exercise_id: 'ex-1', original_exercise_name: 'Bench Press',
  replacement_exercise_id: 'ex-2', replacement_exercise_name: 'Incline Press', created_at: '2026-01-05T10:00:00Z', ...over,
})

beforeEach(() => {
  inserted.length = 0
  answer = { data: rowOf({ moved_sets: RECORD }), error: null }
  rows = []
})

describe('recordExerciseSwap: the row the swap saves', () => {
  const swap = (movedSets: SwapRecord = RECORD) =>
    recordExerciseSwap({ userId: 'user-1', sessionId: 'session-1', programExerciseId: 'pe-1', originalExercise: exercise('ex-1', 'Bench Press'), replacementExercise: exercise('ex-2', 'Incline Press'), movedSets })

  it('inserts what it inserted before 59, byte for byte, and the record in `moved_sets`: one more key and no other difference', async () => {
    await swap()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toEqual({ ...BEFORE, moved_sets: RECORD })
    expect(Object.keys(inserted[0]).sort()).toEqual([...Object.keys(BEFORE), 'moved_sets'].sort())
  })

  it('the record is the one it was given, never one made from anything else: a swap that moved nothing writes its record too (`moved: []`)', async () => {
    await swap({ fromKey: 'pe-1', moved: [] })
    expect(inserted[0].moved_sets).toEqual({ fromKey: 'pe-1', moved: [] })
  })

  it('returns the row as the server answered it, with its record read back', async () => {
    const saved = await swap()
    expect(saved).toMatchObject({ id: 'swap-1', programExerciseId: 'pe-1', originalExerciseName: 'Bench Press', replacementExerciseName: 'Incline Press' })
    expect(saved.movedSets).toEqual(RECORD)
  })

  it('a refusal is thrown as the server gave it, so the screen can show its message', async () => {
    const refusal = { message: 'duplicate key value violates unique constraint "v2_session_exercise_swaps_slot_uk"', code: '23505' }
    answer = { data: null, error: refusal }
    await expect(swap()).rejects.toBe(refusal)
  })
})

describe('fetchSessionSwaps: a session\'s swaps with their records', () => {
  it('reads each row\'s `moved_sets` as its record; a row from before 047 (null) and a column that holds anything else read as no record', async () => {
    rows = [
      rowOf({ id: 'a', moved_sets: RECORD }),
      rowOf({ id: 'b', moved_sets: null }),
      rowOf({ id: 'c' }), // a database that has no such column yet
      rowOf({ id: 'd', moved_sets: { fromKey: 'pe-1', moved: [{ from: { weekPlanSetId: 'set-2' }, place: 0 }] } }),
    ]
    const swaps = await fetchSessionSwaps('session-1')
    expect(swaps.map((s) => [s.id, s.movedSets ?? null])).toEqual([['a', RECORD], ['b', null], ['c', null], ['d', null]])
  })
})
