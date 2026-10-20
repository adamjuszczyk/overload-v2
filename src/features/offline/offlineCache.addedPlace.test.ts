import { describe, it, expect, vi } from 'vitest'
import type { ProgramExercise, WorkoutDay } from '../../types'

// Chunk 46 (TASKS-1.2: the column is read "in its mappers (`toSetLog`, the Dexie `set_logs` cache)"; DECISIONS 174): the
// offline cache's copy of a log carries `v2_set_logs.added_place` as `addedPlace`. A place is kept, null stays null, and a
// row from a database before 044 (no such column) is cached as null, so a reader of the cache never meets `undefined` from it.

const logRows: Array<Record<string, unknown>> = [
  { id: 'l1', session_id: 'done1', exercise_id: 'ex.bench', week_plan_set_id: null, set_number: 4, weight: 50, reps: 10, rir: 2, note: null, is_dropset: false, parent_set_id: null, is_skipped: false, logged_at: '2026-10-12T18:01:00Z', rest_seconds: null, stage_index: 0, is_warmup: false, set_seconds: null, entered_unit: null, form_rating: null, stage_kind: null, added_place: 3 },
  { id: 'l2', session_id: 'done1', exercise_id: 'ex.bench', week_plan_set_id: 'wps.1', set_number: 1, weight: 50, reps: 10, rir: 2, note: null, is_dropset: false, parent_set_id: null, is_skipped: false, logged_at: '2026-10-12T18:02:00Z', rest_seconds: null, stage_index: 0, is_warmup: false, set_seconds: null, entered_unit: null, form_rating: null, stage_kind: null, added_place: null },
  // a row read before 044 is applied: the key is not there at all
  { id: 'l3', session_id: 'done1', exercise_id: 'ex.bench', week_plan_set_id: null, set_number: 5, weight: 50, reps: 10, rir: 2, note: null, is_dropset: false, parent_set_id: null, is_skipped: false, logged_at: '2026-10-12T18:03:00Z', rest_seconds: null, stage_index: 0, is_warmup: false, set_seconds: null, entered_unit: null, form_rating: null, stage_kind: null },
]
const sessionRows = [{ id: 'done1', user_id: 'u1', date: '2026-10-05', status: 'completed', mesocycle_id: 'm1', week_plan_id: 'wp0', workout_day_id: 'wd1', note: null, started_at: null, completed_at: null }]

// A thenable stand-in for supabase-js's builder: every method returns it, and awaiting it gives the table's rows. `from` takes
// its arguments spread (RULES.md: the table scan reads every file).
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => {
      const rows = args[0] === 'v2_set_logs' ? logRows : args[0] === 'v2_sessions' ? sessionRows : []
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'neq', 'in', 'order']) chain[method] = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve)
      return chain
    },
  },
}))

const cached: Array<Record<string, unknown>> = []
vi.mock('../../lib/db', () => ({
  db: {
    workout_days: { put: async () => {} },
    week_plans: { put: async () => {} },
    sessions: { put: async () => {} },
    exercises: { put: async () => {} },
    set_logs: { put: async (row: Record<string, unknown>) => void cached.push(row) },
  },
}))

const { primeOfflineCache } = await import('./offlineCache')

describe('primeOfflineCache caches each log with its added place (DECISIONS 174)', () => {
  it('a place is kept, null stays null, a row without the column is cached as null', async () => {
    const workoutDay = { id: 'wd1', programId: 'p1', name: 'Upper A', position: 0 } as unknown as WorkoutDay
    const programExercises = [{ id: 'pe1', workoutDayId: 'wd1', userId: 'u1', exerciseId: 'ex.bench', position: 0, weightUnit: null }] as ProgramExercise[]
    await primeOfflineCache({ userId: 'u1', sessionId: 's1', workoutDay, weekPlan: null, programExercises })
    expect(cached.map((r) => [r.id, r.addedPlace])).toEqual([
      ['l1', 3],
      ['l2', null],
      ['l3', null],
    ])
    expect(cached.every((r) => 'addedPlace' in r)).toBe(true)
  })
})
