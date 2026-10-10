import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chunk 22, review fix round 2 (DECISIONS 67 option a) — tests only. The
// previous round's executor tests (weekPlanService.deloadExerciseMapping.
// test.ts) proved the exercise-ID routing is correct, but every fixture
// there happened to give the base occurrence and the marked week's own
// sets the SAME business values (counts, reps, rir, weight) — so they
// could not tell "calculated from the base" apart from "calculated from
// the marked week's own current sets" at the level that actually matters:
// SPEC's own core rule, "pre-calculated from the last normal week: its
// planned sets, and the weights actually logged in it". This file adds
// that proof, plus the matching proofs for the fallback path, the base
// walk-back, the logged-weight scoping, the rules argument, and the
// per-session independence of markWeekDeload's own loop — each with
// fixtures whose correct and wrong answers are numerically distinct, not
// coincidentally equal.
//
// Every value asserted below is the REAL calculateDeloadSets' own output
// (verified beforehand against the actual function, never hand-computed —
// see this chunk's own report for the compute script).

type Call = { table: string; method: string; args: unknown[] }
const calls: Call[] = []
const insertedSets: Record<string, unknown>[] = []
const updatedWeekPlanIds: string[] = []
const deletedWeekPlanIds: string[] = []
let insertCounter = 0

interface ChainState {
  eqFilters: Record<string, unknown>
  ltFilters: Record<string, unknown>
  inFilters: Record<string, unknown>
  usedSingle: boolean
  usedUpdate: boolean
  insertPayload: Record<string, unknown> | undefined
}

// A chain that captures its OWN accumulated filters/verbs, so the resolver
// can answer by what was actually asked (which week plan, which mesocycle/
// workout day, which set ids) instead of assuming a fixed call order —
// needed once a test drives more than one markSessionDeload invocation
// (markWeekDeload) or more than one candidate history week.
function makeChain(table: string, resolve: (state: ChainState) => { data?: unknown; error: unknown; count?: number }) {
  const state: ChainState = { eqFilters: {}, ltFilters: {}, inFilters: {}, usedSingle: false, usedUpdate: false, insertPayload: undefined }
  const chain: Record<string, unknown> = {}
  chain.select = (...args: unknown[]) => {
    calls.push({ table, method: 'select', args })
    return chain
  }
  chain.eq = (col: string, val: unknown) => {
    calls.push({ table, method: 'eq', args: [col, val] })
    state.eqFilters[col] = val
    return chain
  }
  chain.lt = (col: string, val: unknown) => {
    calls.push({ table, method: 'lt', args: [col, val] })
    state.ltFilters[col] = val
    return chain
  }
  chain.in = (col: string, val: unknown) => {
    calls.push({ table, method: 'in', args: [col, val] })
    state.inFilters[col] = val
    return chain
  }
  // Chunk 25 — `.is(col, null)` is the slot-identity null-check
  // (fetchDeloadOccurrenceHistory/fetchDeloadWeekPlanCore's own
  // sequence_position filter); every fixture in this file is a weekday
  // run, so recording it into the SAME eqFilters bucket as `.eq` is
  // sufficient — none of this file's own resolvers key off it.
  chain.is = (col: string, val: unknown) => {
    calls.push({ table, method: 'is', args: [col, val] })
    state.eqFilters[col] = val
    return chain
  }
  chain.update = (payload: unknown) => {
    calls.push({ table, method: 'update', args: [payload] })
    state.usedUpdate = true
    return chain
  }
  chain.delete = () => {
    calls.push({ table, method: 'delete', args: [] })
    return chain
  }
  chain.insert = (payload: unknown) => {
    calls.push({ table, method: 'insert', args: [payload] })
    state.insertPayload = payload as Record<string, unknown>
    return chain
  }
  chain.single = () => {
    state.usedSingle = true
    return Promise.resolve(resolve(state))
  }
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resolve(state)).then(res, rej)
  return chain
}

interface WorldSet {
  id: string
  programExerciseId: string
  setNumber: number
  targetRir: number
  repMin?: number | null
  repMax?: number | null
  targetWeight?: number | null
}
interface WorldExerciseSlot {
  programExerciseId: string
  exerciseId: string
}
interface WorldWeekPlan {
  id: string
  mesocycleId: string
  workoutDayId: string
  weekNumber: number
  isDeload?: boolean
  // Chunk 25 review fix 3 — optional, defaults to null/undefined (every
  // existing fixture in this file omits it, a weekday row, unaffected).
  // Lets a new test give a repeated workout's two slots DISTINCT history
  // rows, closing the one gap this file's own original header named
  // ("every fixture in this file is a weekday run... none of this file's
  // own resolvers key off it").
  sequencePosition?: number | null
  sets: WorldSet[]
  exercises: WorldExerciseSlot[]
}
interface WorldLog {
  weekPlanSetId: string
  weight: number | null
  isSkipped?: boolean
}

function toSetRow(s: WorldSet) {
  return {
    id: s.id,
    program_exercise_id: s.programExerciseId,
    set_number: s.setNumber,
    target_rir: s.targetRir,
    is_dropset: false,
    parent_week_plan_set_id: null,
    stage_index: 0,
    target_weight: s.targetWeight ?? null,
    rep_min: s.repMin ?? null,
    rep_max: s.repMax ?? null,
  }
}
function toExerciseRow(e: WorldExerciseSlot) {
  return { program_exercise_id: e.programExerciseId, v2_program_exercises: { exercise_id: e.exerciseId } }
}
function toCoreRow(w: WorldWeekPlan) {
  return {
    mesocycle_id: w.mesocycleId,
    workout_day_id: w.workoutDayId,
    week_number: w.weekNumber,
    sequence_position: w.sequencePosition ?? null,
    deload_restore: null,
    v2_week_plan_sets: w.sets.map(toSetRow),
    v2_week_plan_exercises: w.exercises.map(toExerciseRow),
  }
}
function toHistoryRow(w: WorldWeekPlan) {
  return {
    week_number: w.weekNumber,
    is_deload: w.isDeload ?? false,
    v2_week_plan_sets: w.sets.map(toSetRow),
    v2_week_plan_exercises: w.exercises.map(toExerciseRow),
  }
}
function toFullPlanRow(w: WorldWeekPlan) {
  return {
    id: w.id,
    user_id: 'u1',
    mesocycle_id: w.mesocycleId,
    workout_day_id: w.workoutDayId,
    week_number: w.weekNumber,
    is_deload: w.isDeload ?? false,
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    deload_restore: null,
    v2_week_plan_sets: [],
    v2_week_plan_exercises: [],
  }
}

function buildFromMock(world: { weekPlans: WorldWeekPlan[]; logs: WorldLog[] }) {
  return (table: string) => {
    if (table === 'v2_sessions') return makeChain(table, () => ({ data: [], error: null })) // nothing here ever "started"
    if (table === 'v2_set_logs') {
      return makeChain(table, (state) => {
        const ids = (state.inFilters.week_plan_set_id ?? []) as string[]
        const rows = world.logs
          .filter((l) => ids.includes(l.weekPlanSetId))
          .map((l) => ({ week_plan_set_id: l.weekPlanSetId, weight: l.weight, is_skipped: l.isSkipped ?? false, is_warmup: false, parent_set_id: null }))
        return { data: rows, error: null }
      })
    }
    if (table === 'v2_week_plans') {
      return makeChain(table, (state) => {
        if (state.usedUpdate) {
          updatedWeekPlanIds.push(state.eqFilters.id as string)
          return { data: null, error: null }
        }
        if (state.usedSingle) {
          const wp = world.weekPlans.find((w) => w.id === state.eqFilters.id)
          if (!wp) throw new Error(`world has no week plan with id ${String(state.eqFilters.id)}`)
          return { data: toCoreRow(wp), error: null }
        }
        if ('workout_day_id' in state.eqFilters) {
          const before = state.ltFilters.week_number as number
          // Chunk 25 review fix 3 — `fetchDeloadOccurrenceHistory` always
          // applies exactly one of `.is('sequence_position', null)` or
          // `.eq('sequence_position', n)` (weekPlanService.ts's own
          // unconditional ternary), both recorded into eqFilters by this
          // file's own chain.is/chain.eq above — so this key is always
          // present for a real call; `?? null` only guards a hypothetical
          // direct call that skipped it.
          const wantedSlot = (state.eqFilters.sequence_position ?? null) as number | null
          const rows = world.weekPlans.filter(
            (w) =>
              w.mesocycleId === state.eqFilters.mesocycle_id &&
              w.workoutDayId === state.eqFilters.workout_day_id &&
              w.weekNumber < before &&
              (w.sequencePosition ?? null) === wantedSlot,
          )
          return { data: rows.map(toHistoryRow), error: null }
        }
        const rows = world.weekPlans.filter((w) => w.mesocycleId === state.eqFilters.mesocycle_id && w.weekNumber === state.eqFilters.week_number)
        return { data: rows.map(toFullPlanRow), error: null }
      })
    }
    if (table === 'v2_week_plan_sets') {
      return makeChain(table, (state) => {
        if (state.insertPayload !== undefined) {
          insertedSets.push(state.insertPayload)
          insertCounter += 1
          return { data: { id: `new-${insertCounter}` }, error: null }
        }
        deletedWeekPlanIds.push(state.eqFilters.week_plan_id as string)
        return { data: null, error: null }
      })
    }
    throw new Error(`unexpected table in this test: ${table}`)
  }
}

const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (table: string) => fromMock(table) },
}))

const { markSessionDeload, markWeekDeload } = await import('./weekPlanService')

beforeEach(() => {
  calls.length = 0
  insertedSets.length = 0
  updatedWeekPlanIds.length = 0
  deletedWeekPlanIds.length = 0
  insertCounter = 0
  fromMock.mockReset()
})

const RULES_ABD = { weight: { percent: 90, rounding: 'down' as const, step: 2.5, stepUnit: 'kg' as const }, reps: { delta: -3 }, rir: { delta: 1 } }
const RULES_CD = { weight: { percent: 90, rounding: 'down' as const, step: 2.5, stepUnit: 'kg' as const }, reps: { delta: -1 }, rir: { delta: 1 } }

describe('markSessionDeload — the matched branch genuinely uses the BASE occurrence, not the marked week\'s own current sets', () => {
  it('base has 2 sets (one logged, one not) with different reps/rir/weight from the marked week\'s own 1 current set — the inserted payload is the base\'s, logged-or-planned, never the marked week\'s own', async () => {
    fromMock.mockImplementation(
      buildFromMock({
        weekPlans: [
          {
            id: 'wp-base', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
            exercises: [{ programExerciseId: 'pe-A', exerciseId: 'ex-A' }],
            sets: [
              { id: 'base-a-s1', programExerciseId: 'pe-A', setNumber: 1, targetRir: 3, repMin: 10, repMax: 15, targetWeight: 120 },
              { id: 'base-a-s2', programExerciseId: 'pe-A', setNumber: 2, targetRir: 3, repMin: 10, repMax: 15, targetWeight: 120 },
            ],
          },
          {
            id: 'wp-marked', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2,
            exercises: [{ programExerciseId: 'pe-A', exerciseId: 'ex-A' }],
            sets: [{ id: 'marked-a-s1', programExerciseId: 'pe-A', setNumber: 1, targetRir: 0, repMin: 5, repMax: 5, targetWeight: 40 }],
          },
        ],
        logs: [{ weekPlanSetId: 'base-a-s1', weight: 110 }], // set 2 has nothing logged
      }),
    )

    const outcome = await markSessionDeload('u1', 'wp-marked', RULES_ABD)
    expect(outcome).toBe('calculated')

    expect(insertedSets).toHaveLength(2) // from the base's 2 sets, not the marked week's own 1
    const bySetNumber = (n: number) => insertedSets.find((s) => s.set_number === n)!
    expect(bySetNumber(1)).toMatchObject({ program_exercise_id: 'pe-A', rep_min: 7, rep_max: 12, target_rir: 4, target_weight: 97.5 }) // logged 110
    expect(bySetNumber(2)).toMatchObject({ program_exercise_id: 'pe-A', rep_min: 7, rep_max: 12, target_rir: 4, target_weight: 107.5 }) // no log -> planned 120
  })
})

describe('markSessionDeload — the fallback branch genuinely uses the exercise\'s OWN current sets, never a base week\'s', () => {
  it('an exercise with no base-week match calculates from its own 2 current sets', async () => {
    fromMock.mockImplementation(
      buildFromMock({
        weekPlans: [
          {
            id: 'wp-base', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
            exercises: [{ programExerciseId: 'pe-A', exerciseId: 'ex-A' }], // no pe-B here at all
            sets: [{ id: 'base-a-s1', programExerciseId: 'pe-A', setNumber: 1, targetRir: 9, repMin: 1, repMax: 1, targetWeight: 999 }],
          },
          {
            id: 'wp-marked', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2,
            exercises: [{ programExerciseId: 'pe-B', exerciseId: 'ex-B' }], // marked week doesn't even have pe-A
            sets: [
              { id: 'marked-b-s1', programExerciseId: 'pe-B', setNumber: 1, targetRir: 2, repMin: 6, repMax: 10, targetWeight: 55 },
              { id: 'marked-b-s2', programExerciseId: 'pe-B', setNumber: 2, targetRir: 2, repMin: 6, repMax: 10, targetWeight: 65 },
            ],
          },
        ],
        logs: [],
      }),
    )

    const outcome = await markSessionDeload('u1', 'wp-marked', RULES_ABD)
    expect(outcome).toBe('calculated')

    expect(insertedSets).toHaveLength(2)
    const bySetNumber = (n: number) => insertedSets.find((s) => s.set_number === n)!
    expect(bySetNumber(1)).toMatchObject({ program_exercise_id: 'pe-B', rep_min: 3, rep_max: 7, target_rir: 3, target_weight: 47.5 })
    expect(bySetNumber(2)).toMatchObject({ program_exercise_id: 'pe-B', rep_min: 3, rep_max: 7, target_rir: 3, target_weight: 57.5 })
    expect(insertedSets.every((s) => s.program_exercise_id === 'pe-B')).toBe(true) // pe-A (base-only) never appears
  })
})

describe('markSessionDeload — the base walk-back truly skips a week that did not happen', () => {
  it('week N-1 exists but its only log is skipped (did not happen); week N-2 happened — the payload is N-2\'s, not N-1\'s', async () => {
    fromMock.mockImplementation(
      buildFromMock({
        weekPlans: [
          {
            id: 'wp-n2', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1, // N-2, happened
            exercises: [{ programExerciseId: 'pe-A', exerciseId: 'ex-A' }],
            sets: [{ id: 'w1-s1', programExerciseId: 'pe-A', setNumber: 1, targetRir: 2, repMin: 8, repMax: 12, targetWeight: 90 }],
          },
          {
            id: 'wp-n1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2, // N-1, did NOT happen
            exercises: [{ programExerciseId: 'pe-A', exerciseId: 'ex-A' }],
            sets: [{ id: 'w2-s1', programExerciseId: 'pe-A', setNumber: 1, targetRir: 5, repMin: 20, repMax: 20, targetWeight: 999 }],
          },
          {
            id: 'wp-marked', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 3,
            exercises: [{ programExerciseId: 'pe-A', exerciseId: 'ex-A' }],
            sets: [{ id: 'marked-s1', programExerciseId: 'pe-A', setNumber: 1, targetRir: 0, repMin: 1, repMax: 1, targetWeight: 1 }],
          },
        ],
        logs: [
          { weekPlanSetId: 'w1-s1', weight: 80 }, // N-2: a real, non-skipped log -> happened
          { weekPlanSetId: 'w2-s1', weight: 999, isSkipped: true }, // N-1: only a SKIPPED log -> did not happen
        ],
      }),
    )

    const outcome = await markSessionDeload('u1', 'wp-marked', RULES_CD)
    expect(outcome).toBe('calculated')

    expect(insertedSets).toHaveLength(1)
    // N-2's own values (logged 80), never N-1's (999, rep 20, rir 5) even though N-1 exists with its own distinct data.
    expect(insertedSets[0]).toMatchObject({ program_exercise_id: 'pe-A', rep_min: 7, rep_max: 11, target_rir: 3, target_weight: 70 })
  })
})

describe('markSessionDeload — the logged weight comes from the CHOSEN base week\'s own logs, not another history week\'s', () => {
  it('two history weeks both happened (distinct logged weights) — the payload uses the MORE RECENT one\'s own log, not the older one\'s', async () => {
    fromMock.mockImplementation(
      buildFromMock({
        weekPlans: [
          {
            id: 'wp-n2', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1, // older, happened
            exercises: [{ programExerciseId: 'pe-A', exerciseId: 'ex-A' }],
            sets: [{ id: 'd-w1-s1', programExerciseId: 'pe-A', setNumber: 1, targetRir: 2, repMin: 8, repMax: 12, targetWeight: 200 }],
          },
          {
            id: 'wp-n1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2, // more recent, ALSO happened
            exercises: [{ programExerciseId: 'pe-A', exerciseId: 'ex-A' }],
            sets: [{ id: 'd-w2-s1', programExerciseId: 'pe-A', setNumber: 1, targetRir: 4, repMin: 16, repMax: 20, targetWeight: 300 }],
          },
          {
            id: 'wp-marked', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 3,
            exercises: [{ programExerciseId: 'pe-A', exerciseId: 'ex-A' }],
            sets: [{ id: 'marked-s1', programExerciseId: 'pe-A', setNumber: 1, targetRir: 0, repMin: 1, repMax: 1, targetWeight: 1 }],
          },
        ],
        logs: [
          { weekPlanSetId: 'd-w1-s1', weight: 70 },
          { weekPlanSetId: 'd-w2-s1', weight: 130 },
        ],
      }),
    )

    const outcome = await markSessionDeload('u1', 'wp-marked', RULES_CD)
    expect(outcome).toBe('calculated')

    expect(insertedSets).toHaveLength(1)
    // Week 2's (more recent) own log, 130 -> 115, never week 1's 70 -> 62.5.
    expect(insertedSets[0]).toMatchObject({ program_exercise_id: 'pe-A', rep_min: 15, rep_max: 19, target_rir: 5, target_weight: 115 })
  })
})

describe('markSessionDeload — the rules argument passed in is the one actually applied', () => {
  it('a distinctive reps delta (-7) shows up in the calculated output', async () => {
    fromMock.mockImplementation(
      buildFromMock({
        weekPlans: [
          {
            id: 'wp-base', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
            exercises: [{ programExerciseId: 'pe-A', exerciseId: 'ex-A' }],
            sets: [{ id: 'e-s1', programExerciseId: 'pe-A', setNumber: 1, targetRir: 2, repMin: 10, repMax: 10, targetWeight: 100 }],
          },
          {
            id: 'wp-marked', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2,
            exercises: [{ programExerciseId: 'pe-A', exerciseId: 'ex-A' }],
            sets: [{ id: 'marked-s1', programExerciseId: 'pe-A', setNumber: 1, targetRir: 0, repMin: 1, repMax: 1, targetWeight: 1 }],
          },
        ],
        logs: [{ weekPlanSetId: 'e-s1', weight: 90 }], // makes week 1 "happen" — without this it has no usable base at all
      }),
    )

    const outcome = await markSessionDeload('u1', 'wp-marked', { reps: { delta: -7 } })
    expect(outcome).toBe('calculated')
    expect(insertedSets).toHaveLength(1)
    expect(insertedSets[0]).toMatchObject({ rep_min: 3, rep_max: 3 }) // 10 - 7 = 3, never the default/untouched 10
  })
})

// Chunk 25 review fix 3 (DECISIONS 73 option a) — closes the one gap this
// file's own original header named ("every fixture in this file is a
// weekday run... none of this file's own resolvers key off it
// [sequence_position]"). A, B, A, rest's own repeated workout (SPEC G8):
// slot 0 and slot 2 are the SAME workout_day_id, each its own independent
// deload base history (TASKS.md "deload rules match by slot for sequence
// runs") — numerically distinct on purpose, so a slot mix-up changes the
// asserted output, not just which query ran.
describe('markSessionDeload — a repeated workout\'s two slots (A, B, A, rest) each use THEIR OWN base history, never the other slot\'s', () => {
  it('marking the SECOND A (slot 2) calculates from slot 2\'s own base, not slot 0\'s', async () => {
    fromMock.mockImplementation(
      buildFromMock({
        weekPlans: [
          {
            id: 'wp-slot0-base', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 1, sequencePosition: 0,
            exercises: [{ programExerciseId: 'pe-slot0', exerciseId: 'ex-a' }],
            sets: [{ id: 'slot0-base-s1', programExerciseId: 'pe-slot0', setNumber: 1, targetRir: 2, repMin: 10, repMax: 10, targetWeight: 100 }],
          },
          {
            id: 'wp-slot2-base', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 1, sequencePosition: 2,
            exercises: [{ programExerciseId: 'pe-slot2', exerciseId: 'ex-a' }],
            sets: [{ id: 'slot2-base-s1', programExerciseId: 'pe-slot2', setNumber: 1, targetRir: 0, repMin: 4, repMax: 4, targetWeight: 20 }],
          },
          {
            id: 'wp-marked-slot0', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 2, sequencePosition: 0,
            exercises: [{ programExerciseId: 'pe-slot0', exerciseId: 'ex-a' }],
            sets: [{ id: 'marked-slot0-s1', programExerciseId: 'pe-slot0', setNumber: 1, targetRir: 9, repMin: 1, repMax: 1, targetWeight: 1 }],
          },
          {
            id: 'wp-marked-slot2', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 2, sequencePosition: 2,
            exercises: [{ programExerciseId: 'pe-slot2', exerciseId: 'ex-a' }],
            sets: [{ id: 'marked-slot2-s1', programExerciseId: 'pe-slot2', setNumber: 1, targetRir: 9, repMin: 1, repMax: 1, targetWeight: 1 }],
          },
        ],
        // Both bases "happened" (a log each) — otherwise resolveDeloadBase
        // Occurrence would find neither usable and this would prove nothing.
        logs: [{ weekPlanSetId: 'slot0-base-s1', weight: 90 }, { weekPlanSetId: 'slot2-base-s1', weight: 18 }],
      }),
    )

    const outcome = await markSessionDeload('u1', 'wp-marked-slot2', RULES_ABD)
    expect(outcome).toBe('calculated')

    expect(insertedSets).toHaveLength(1)
    // Slot 2's own base (rir 0, reps 4/4, logged 18) — RULES_ABD (reps -3,
    // rir +1, 90% rounded down to the nearest 2.5kg): never slot 0's base
    // (rir 2, reps 10/10, logged 90), which would instead read rir 3,
    // rep_min/rep_max 7, target_weight 80.
    expect(insertedSets[0]).toMatchObject({ program_exercise_id: 'pe-slot2', rep_min: 1, rep_max: 1, target_rir: 1, target_weight: 15 })
  })
})

describe('markWeekDeload — each session in the week uses ITS OWN base, never a sibling session\'s', () => {
  it('two sessions (different workout days) with different bases: each payload and each write targets its own plan', async () => {
    fromMock.mockImplementation(
      buildFromMock({
        weekPlans: [
          {
            id: 'wp-a-base', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
            exercises: [{ programExerciseId: 'pe-A-wd1', exerciseId: 'ex-A' }],
            sets: [{ id: 'fa-s1', programExerciseId: 'pe-A-wd1', setNumber: 1, targetRir: 2, repMin: 10, repMax: 10, targetWeight: 60 }],
          },
          {
            id: 'wp-a-marked', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 3,
            exercises: [{ programExerciseId: 'pe-A-wd1', exerciseId: 'ex-A' }],
            sets: [{ id: 'marked-a-s1', programExerciseId: 'pe-A-wd1', setNumber: 1, targetRir: 0, repMin: 1, repMax: 1, targetWeight: 1 }],
          },
          {
            id: 'wp-b-base', mesocycleId: 'meso-1', workoutDayId: 'wd-2', weekNumber: 1,
            exercises: [{ programExerciseId: 'pe-A-wd2', exerciseId: 'ex-A' }],
            sets: [{ id: 'fb-s1', programExerciseId: 'pe-A-wd2', setNumber: 1, targetRir: 4, repMin: 20, repMax: 20, targetWeight: 90 }],
          },
          {
            id: 'wp-b-marked', mesocycleId: 'meso-1', workoutDayId: 'wd-2', weekNumber: 3,
            exercises: [{ programExerciseId: 'pe-A-wd2', exerciseId: 'ex-A' }],
            sets: [{ id: 'marked-b-s1', programExerciseId: 'pe-A-wd2', setNumber: 1, targetRir: 0, repMin: 1, repMax: 1, targetWeight: 1 }],
          },
        ],
        // Makes each plan's OWN base week "happen" — without these, neither
        // base would be usable at all and both would (correctly) fall back.
        logs: [
          { weekPlanSetId: 'fa-s1', weight: 50 },
          { weekPlanSetId: 'fb-s1', weight: 80 },
        ],
      }),
    )

    const result = await markWeekDeload('u1', 'meso-1', 3, { reps: { delta: -2 } })
    expect(result.anyAlreadyStarted).toBe(false)

    expect(insertedSets).toHaveLength(2)
    const forA = insertedSets.find((s) => s.program_exercise_id === 'pe-A-wd1')!
    const forB = insertedSets.find((s) => s.program_exercise_id === 'pe-A-wd2')!
    expect(forA).toMatchObject({ rep_min: 8, rep_max: 8 }) // from wd1's OWN base (10-10 -> 8)
    expect(forB).toMatchObject({ rep_min: 18, rep_max: 18 }) // from wd2's OWN base (20-20 -> 18), never wd1's

    // Each plan's own row was updated and its own sets deleted — never the
    // same id twice, never one plan's id used for the other's write.
    expect(new Set(updatedWeekPlanIds)).toEqual(new Set(['wp-a-marked', 'wp-b-marked']))
    expect(new Set(deletedWeekPlanIds)).toEqual(new Set(['wp-a-marked', 'wp-b-marked']))
  })
})
