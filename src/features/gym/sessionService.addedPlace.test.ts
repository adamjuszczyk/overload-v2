import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chunk 46 (TASKS-1.2: "It reads the column in its mappers (`toSetLog`, the Dexie `set_logs` cache), being the first chunk
// that reads it"; DECISIONS 174): `v2_set_logs.added_place` (migration 044) reaches `SetLog.addedPlace` through `toSetLog`,
// the one mapper the session's reads go through (here `fetchSession`, the read the workout screen draws from). A number is
// kept, null stays null, and a row without the column (a database before 044, every row the select returns there) reads as
// null, never as `undefined`. Nothing here writes the column: LOG's payload is chunk 58a's.

const sessionRow = (logs: Array<Record<string, unknown>>) => ({
  id: 's1',
  user_id: 'u1',
  mesocycle_id: 'm1',
  week_plan_id: 'wp1',
  workout_day_id: 'wd1',
  date: '2026-10-12',
  status: 'in_progress',
  note: null,
  started_at: '2026-10-12T18:00:00Z',
  completed_at: null,
  created_at: '2026-10-12T18:00:00Z',
  moved_to_date: null,
  v2_set_logs: logs,
})

const logRow = (id: string, loggedAt: string, extra: Record<string, unknown>) => ({
  id,
  user_id: 'u1',
  session_id: 's1',
  exercise_id: 'ex.bench',
  week_plan_set_id: null,
  set_number: 4,
  weight: 50,
  reps: 10,
  rir: 2,
  note: null,
  is_dropset: false,
  parent_set_id: null,
  is_skipped: false,
  logged_at: loggedAt,
  rest_seconds: null,
  stage_index: 0,
  is_warmup: false,
  set_seconds: null,
  entered_unit: null,
  form_rating: null,
  stage_kind: null,
  ...extra,
})

let row: ReturnType<typeof sessionRow> = sessionRow([])
// supabase-js's builder for fetchSession: select(…).eq('id', …).single(); `from` takes its arguments spread (RULES.md).
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => {
      void args
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: row, error: null }),
      }
      return chain
    },
  },
}))

const { fetchSession } = await import('./sessionService')

beforeEach(() => {
  row = sessionRow([])
})

describe('toSetLog reads v2_set_logs.added_place into SetLog.addedPlace (DECISIONS 174)', () => {
  it('a place is kept, null stays null, and a row without the column reads null (absent is null, never undefined)', async () => {
    const without = logRow('l3', '2026-10-12T18:03:00Z', {})
    delete (without as Record<string, unknown>).added_place
    row = sessionRow([
      logRow('l1', '2026-10-12T18:01:00Z', { added_place: 2 }),
      logRow('l2', '2026-10-12T18:02:00Z', { added_place: null, week_plan_set_id: 'wps.1', set_number: 1 }),
      without,
    ])
    const session = await fetchSession('s1')
    const places = session.setLogs!.map((l) => [l.id, l.addedPlace])
    expect(places).toEqual([
      ['l1', 2],
      ['l2', null],
      ['l3', null],
    ])
    // `toBe(null)`, not `toBeFalsy()`: an absent key must come out as null, the value every reader is promised
    for (const log of session.setLogs!) expect(log.addedPlace === null || typeof log.addedPlace === 'number', log.id).toBe(true)
    expect('addedPlace' in session.setLogs![2]).toBe(true)
  })
})
