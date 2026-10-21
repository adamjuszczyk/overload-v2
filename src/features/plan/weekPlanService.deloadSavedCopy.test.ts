import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DeloadRestoreEntry, DeloadRules } from '../../lib/deloadRules'

// Chunk 188f (Adam, 2026-10-20; DECISIONS 188 (a); SPEC Deload [1.2]): "Marking a session that already holds a saved copy of its plan
// leaves it as it is, with nothing recalculated or saved again". A week mark that stopped part way leaves the week half marked, and pressing
// it again reached the sessions it had already marked: their sets were the deloaded ones, so the second mark saved a copy of those over the
// plan, and UNMARK later brought the deload back. This file is the call-level proof of the guard in markSessionDeload: which tables the
// mark touches, and the exact payload of its one write. The whole sequence (a session marked on its own, a week mark cut off, the mark
// pressed again, UNMARK) is useWeekPlan.deloadHalfMarked.test.tsx, through the real hooks over a stateful database.
//
// weekPlanService.ts imports the real Supabase client at module load: mocked here as weekPlanService.deloadGuard.test.ts does, so every
// call is recorded. Reads answer like the database would for a session nothing was ever logged against (no session rows, no earlier weeks).

type Call = { table: string; method: string; args: unknown[] }
const calls: Call[] = []

let startedSessions: Array<{ id: string }> = []
let logCount = 0
let core: Record<string, unknown> = {}
let writeError: Error | null = null // what every update and delete answers (a write that fails)

function makeChain(table: string) {
  const chain: Record<string, unknown> = {}
  let op = 'select'
  const record =
    (method: string, sets?: string) =>
    (...args: unknown[]) => {
      calls.push({ table, method, args })
      if (sets) op = sets
      return chain
    }
  chain.select = record('select')
  chain.eq = record('eq')
  chain.in = record('in')
  chain.is = record('is')
  chain.lt = record('lt')
  chain.update = record('update', 'update')
  chain.delete = record('delete', 'delete')
  chain.insert = record('insert', 'insert')
  const answer = () => {
    if (op === 'update' || op === 'delete') return { data: null, error: writeError }
    if (table === 'v2_sessions') return { data: startedSessions, error: null }
    if (table === 'v2_set_logs') return { data: null, error: null, count: logCount }
    return { data: [], error: null } // the earlier weeks of this slot: none
  }
  chain.single = () => {
    if (op === 'insert') return Promise.resolve({ data: { id: `new-${calls.length}` }, error: null })
    return Promise.resolve({ data: core, error: null }) // fetchDeloadWeekPlanCore
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (table: string) => makeChain(table) },
}))

const { markSessionDeload } = await import('./weekPlanService')

const RULES: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' }, rir: { delta: 2 } }

// The session as it was planned: four sets of 100 at RIR 2 of one exercise.
function entry(setNumber: number): DeloadRestoreEntry {
  return {
    programExerciseId: 'pe-1', setNumber, stageIndex: 0, isWarmup: false, isDropset: false, stageKind: null, programSetId: null,
    repMin: 8, repMax: 10, isAmrap: false, targetWeight: 100, targetRir: 2, targetRirMax: null, tags: null,
  }
}
const COPY = [1, 2, 3, 4].map(entry)

function setRow(n: number, targetRir: number) {
  return {
    id: `set-${n}`, week_plan_id: 'wp-1', user_id: 'user-1', program_exercise_id: 'pe-1', set_number: n, target_rir: targetRir, target_rir_max: null,
    is_dropset: false, parent_week_plan_set_id: null, stage_index: 0, is_warmup: false, program_set_id: null, stage_kind: null,
    target_weight: 100, rep_min: 8, rep_max: 10, is_amrap: false, tags: null,
  }
}
// What a half-marked session reads: the deloaded sets (two at RIR 4) beside the copy of the plan it was marked from.
function wireCore(deloadRestore: unknown, sets = [setRow(1, 4), setRow(2, 4)]) {
  core = {
    mesocycle_id: 'meso-1', workout_day_id: 'wd-1', week_number: 2, sequence_position: null, deload_restore: deloadRestore,
    v2_week_plan_sets: sets,
    v2_week_plan_exercises: [{ program_exercise_id: 'pe-1', v2_program_exercises: { exercise_id: 'ex-1' } }],
  }
}

const writes = () => calls.filter((c) => ['update', 'insert', 'delete', 'upsert'].includes(c.method))
const reads = (table: string) => calls.filter((c) => c.table === table && c.method === 'select')

beforeEach(() => {
  calls.length = 0
  startedSessions = []
  logCount = 0
  core = {}
  writeError = null
})

describe('markSessionDeload — a session that already holds a saved copy is left as it is (DECISIONS 188 (a))', () => {
  it('rules on, nothing logged, copy held: the flag is set and that is the only write at all — no copy saved again, no set deleted or inserted', async () => {
    wireCore(COPY)
    const outcome = await markSessionDeload('user-1', 'wp-1', RULES)

    expect(outcome).toBe('flagOnly')
    // The one write, and its exact payload: the flag and no `deload_restore` key (the copy is not written, not even unchanged).
    expect(writes()).toEqual([{ table: 'v2_week_plans', method: 'update', args: [{ is_deload: true }] }])
    const eqs = calls.filter((c) => c.method === 'eq' && c.table === 'v2_week_plans')
    expect(eqs[eqs.length - 1].args).toEqual(['id', 'wp-1']) // the update names the session's own row
    // Nothing was recalculated: the earlier weeks were never gathered and no set of the session was read for a calculation beyond the one core read.
    expect(calls.some((c) => c.table === 'v2_week_plan_sets')).toBe(false)
    expect(reads('v2_week_plans')).toHaveLength(1)
    expect(String(reads('v2_week_plans')[0].args[0])).toMatch(/^mesocycle_id, workout_day_id, week_number, sequence_position, deload_restore/)
  })

  it('an EMPTY copy is a saved copy (a session that had no sets when it was marked): unmark reads it the same way, so the mark leaves it too', async () => {
    wireCore([], [])
    const outcome = await markSessionDeload('user-1', 'wp-1', RULES)

    expect(outcome).toBe('flagOnly')
    expect(writes()).toEqual([{ table: 'v2_week_plans', method: 'update', args: [{ is_deload: true }] }])
  })

  it.each([
    ['six sets in a session whose copy holds four (sets added by hand since the mark)', COPY, 6],
    ['three sets in a session whose copy is empty (sets added by hand since the mark)', [] as DeloadRestoreEntry[], 3],
  ])('what decides is the copy, not the sets: %s', async (_name, copy, setCount) => {
    wireCore(copy, Array.from({ length: setCount }, (_, i) => setRow(i + 1, 4)))
    const outcome = await markSessionDeload('user-1', 'wp-1', RULES)

    expect(outcome).toBe('flagOnly')
    expect(writes()).toEqual([{ table: 'v2_week_plans', method: 'update', args: [{ is_deload: true }] }])
  })

  it('the flag write is awaited: when it fails, the mark fails with it (the week mark stops and the hook shows the error), and nothing else was tried', async () => {
    wireCore(COPY)
    writeError = new Error('write failed')

    await expect(markSessionDeload('user-1', 'wp-1', RULES)).rejects.toThrow('write failed')
    expect(writes()).toEqual([{ table: 'v2_week_plans', method: 'update', args: [{ is_deload: true }] }])
  })

  it('a copy held with the flag off (left by an unmark a started session held back) is kept, and the flag is set', async () => {
    wireCore(COPY)
    await markSessionDeload('user-1', 'wp-1', RULES)

    const update = writes().find((c) => c.table === 'v2_week_plans')!
    expect(update.args[0]).toEqual({ is_deload: true }) // true, not a toggle of what the row held
    expect(Object.keys(update.args[0] as object)).toEqual(['is_deload'])
  })

  it('a session that has been started keeps the started guard first: "alreadyStarted" (the notice), flag only, the copy not even read', async () => {
    wireCore(COPY)
    startedSessions = [{ id: 'session-1' }]
    logCount = 3
    const outcome = await markSessionDeload('user-1', 'wp-1', RULES)

    expect(outcome).toBe('alreadyStarted')
    expect(writes()).toEqual([{ table: 'v2_week_plans', method: 'update', args: [{ is_deload: true }] }])
    expect(reads('v2_week_plans')).toHaveLength(0)
  })

  it('no copy (null, or something that is not a list) is an ordinary mark: the copy is saved once, with the flag, then the sets are replaced', async () => {
    for (const noCopy of [null, {}, 'x']) {
      calls.length = 0
      wireCore(noCopy, [1, 2, 3, 4].map((n) => setRow(n, 2)))
      const outcome = await markSessionDeload('user-1', 'wp-1', RULES)

      expect(outcome).toBe('calculated')
      const snapshotWrites = writes().filter((c) => c.table === 'v2_week_plans')
      expect(snapshotWrites).toHaveLength(1)
      const payload = snapshotWrites[0].args[0] as { is_deload: boolean; deload_restore: DeloadRestoreEntry[] }
      expect(payload.is_deload).toBe(true)
      expect(payload.deload_restore).toEqual(COPY) // the plan as it was, taken from the session's own sets
      // ... then the delete of the session's sets and the two calculated sets (four sets at RIR 2 → two at RIR 4).
      expect(writes().filter((c) => c.table === 'v2_week_plan_sets' && c.method === 'delete')).toHaveLength(1)
      const inserted = writes().filter((c) => c.table === 'v2_week_plan_sets' && c.method === 'insert').map((c) => c.args[0] as { set_number: number; target_rir: number })
      expect(inserted.map((r) => [r.set_number, r.target_rir])).toEqual([[1, 4], [2, 4]])
    }
  })

  it('rules off with a copy held is still flag only, as before: no read of sessions or logs, nothing but the flag written', async () => {
    wireCore(COPY)
    const outcome = await markSessionDeload('user-1', 'wp-1', null)

    expect(outcome).toBe('flagOnly')
    expect(writes()).toEqual([{ table: 'v2_week_plans', method: 'update', args: [{ is_deload: true }] }])
    expect(calls.some((c) => c.table === 'v2_sessions' || c.table === 'v2_set_logs')).toBe(false)
  })
})
