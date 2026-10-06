import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WeeklySchedule, WorkoutDay, ProgramExercise, ProgramSet } from '../../types'

// Chunk 11 — plannerService.ts. Same mocking precedent as
// programService.test.ts: the real Supabase client is mocked at the module
// boundary (supabase.ts throws without env vars), and a tiny query-builder
// chain stand-in lets each call's exact table/filter/payload be inspected.

const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const fetchRunProgramExercisesMock = vi.fn()
vi.mock('../programs/runProgramExercises', () => ({
  fetchRunProgramExercises: (...args: unknown[]) => fetchRunProgramExercisesMock(...args),
}))

const createWorkoutDayMock = vi.fn()
vi.mock('../programs/programService', () => ({
  createWorkoutDay: (...args: unknown[]) => createWorkoutDayMock(...args),
}))

const {
  headSets,
  hasNoSets,
  assignWorkoutWeekday,
  detectSharedWeekdayWorkouts,
  fetchProgramSets,
  setExerciseSetCount,
  updateProgramSetRepTarget,
  setRepTargetForAllSets,
  updateProgramSetStageKind,
  addProgramSetStage,
  removeProgramSet,
  summarizeRepTargets,
  splitSharedWeekdayWorkouts,
} = await import('./plannerService')

function makeChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    // addProgramSetStage's own .insert(...).select().single() (chunk 14,
    // mirrors weekPlanService.ts's addStage) — unused by every other test
    // in this file, which never calls .single().
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
  fetchRunProgramExercisesMock.mockReset()
  createWorkoutDayMock.mockReset()
})

const EMPTY_SCHEDULE: WeeklySchedule = {
  monday: null, tuesday: null, wednesday: null, thursday: null,
  friday: null, saturday: null, sunday: null,
}

function programSet(overrides: Partial<ProgramSet> = {}): ProgramSet {
  return {
    id: 'ps-1',
    userId: 'user-1',
    programExerciseId: 'pe-1',
    position: 1,
    isWarmup: false,
    stageKind: null,
    stageRestSeconds: null,
    parentProgramSetId: null,
    stageIndex: 0,
    repMin: null,
    repMax: null,
    isAmrap: false,
    restSeconds: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── headSets / hasNoSets ───────────────────────────────────────────────────

describe('headSets — excludes stages (027: "a stage shares its head\'s position")', () => {
  it('keeps rows with parentProgramSetId null, drops rows with one', () => {
    const head = programSet({ id: 'head', parentProgramSetId: null })
    const stage = programSet({ id: 'stage', parentProgramSetId: 'head', stageIndex: 1 })
    expect(headSets([head, stage])).toEqual([head])
  })

  it('empty input -> empty output', () => {
    expect(headSets([])).toEqual([])
  })
})

describe('hasNoSets', () => {
  it('true when there are zero heads (reviewer note: the one place "no sets yet" is decided)', () => {
    expect(hasNoSets([])).toBe(true)
  })

  it('false once at least one head exists, even if every row is otherwise a stage', () => {
    const head = programSet({ id: 'head' })
    const stage = programSet({ id: 'stage', parentProgramSetId: 'head', stageIndex: 1 })
    expect(hasNoSets([stage])).toBe(true) // a stage alone is not a set of its own
    expect(hasNoSets([head, stage])).toBe(false)
  })
})

// ─── assignWorkoutWeekday ───────────────────────────────────────────────────

describe('assignWorkoutWeekday — "one weekday per workout" (TASKS.md step 2)', () => {
  it('assigns a fresh workout to a day with no prior assignment', () => {
    const next = assignWorkoutWeekday(EMPTY_SCHEDULE, 'wd-1', 'monday')
    expect(next.monday).toBe('wd-1')
    expect(next.tuesday).toBeNull()
  })

  it('moving a workout to a new day clears its OLD day — never on two days at once', () => {
    const schedule: WeeklySchedule = { ...EMPTY_SCHEDULE, monday: 'wd-1' }
    const next = assignWorkoutWeekday(schedule, 'wd-1', 'wednesday')
    expect(next.monday).toBeNull()
    expect(next.wednesday).toBe('wd-1')
  })

  it('dow = null clears the workout back to rest, touching no other day', () => {
    const schedule: WeeklySchedule = { ...EMPTY_SCHEDULE, monday: 'wd-1', friday: 'wd-2' }
    const next = assignWorkoutWeekday(schedule, 'wd-1', null)
    expect(next.monday).toBeNull()
    expect(next.friday).toBe('wd-2') // untouched — a different workout
  })

  it('does not mutate the schedule object passed in', () => {
    const schedule: WeeklySchedule = { ...EMPTY_SCHEDULE, monday: 'wd-1' }
    const frozen = { ...schedule }
    assignWorkoutWeekday(schedule, 'wd-1', 'tuesday')
    expect(schedule).toEqual(frozen)
  })
})

// ─── detectSharedWeekdayWorkouts (G14) ─────────────────────────────────────

describe('detectSharedWeekdayWorkouts — G14: one workout on several weekdays', () => {
  it('no groups when every assigned workout has exactly one day', () => {
    const schedule: WeeklySchedule = { ...EMPTY_SCHEDULE, monday: 'wd-1', wednesday: 'wd-2' }
    expect(detectSharedWeekdayWorkouts(schedule)).toEqual([])
  })

  it('empty schedule (sequence program, "{}") -> no groups', () => {
    expect(detectSharedWeekdayWorkouts(EMPTY_SCHEDULE)).toEqual([])
  })

  it('one workout on three weekdays -> one group naming all three, in week order', () => {
    const schedule: WeeklySchedule = { ...EMPTY_SCHEDULE, monday: 'wd-1', wednesday: 'wd-1', friday: 'wd-1' }
    expect(detectSharedWeekdayWorkouts(schedule)).toEqual([
      { workoutDayId: 'wd-1', weekdays: ['monday', 'wednesday', 'friday'] },
    ])
  })

  it('two different workouts, each shared across its own days -> two groups, un-shared ones absent', () => {
    const schedule: WeeklySchedule = {
      monday: 'wd-1', tuesday: 'wd-3', wednesday: 'wd-1',
      thursday: null, friday: 'wd-2', saturday: 'wd-2', sunday: null,
    }
    expect(detectSharedWeekdayWorkouts(schedule)).toEqual([
      { workoutDayId: 'wd-1', weekdays: ['monday', 'wednesday'] },
      { workoutDayId: 'wd-2', weekdays: ['friday', 'saturday'] },
    ])
  })
})

// ─── fetchProgramSets ───────────────────────────────────────────────────────

describe('fetchProgramSets', () => {
  it('empty id list short-circuits — no call to supabase at all', async () => {
    const result = await fetchProgramSets([])
    expect(result).toEqual([])
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('queries v2_program_sets with .in(program_exercise_id, ids), maps rows', async () => {
    const row = {
      id: 'ps-1', user_id: 'user-1', program_exercise_id: 'pe-1', position: 1,
      is_warmup: false, stage_kind: null, stage_rest_seconds: null,
      parent_program_set_id: null, stage_index: 0, rep_min: 8, rep_max: 12,
      is_amrap: false, rest_seconds: null, created_at: '2026-01-01T00:00:00Z',
    }
    const chain = makeChain({ data: [row], error: null })
    fromMock.mockReturnValue(chain)

    const result = await fetchProgramSets(['pe-1', 'pe-2'])

    expect(fromMock).toHaveBeenCalledWith('v2_program_sets')
    expect(chain.in).toHaveBeenCalledWith('program_exercise_id', ['pe-1', 'pe-2'])
    expect(result).toEqual([{
      id: 'ps-1', userId: 'user-1', programExerciseId: 'pe-1', position: 1,
      isWarmup: false, stageKind: null, stageRestSeconds: null,
      parentProgramSetId: null, stageIndex: 0, repMin: 8, repMax: 12,
      isAmrap: false, restSeconds: null, createdAt: '2026-01-01T00:00:00Z',
    }])
  })
})

// ─── setExerciseSetCount ────────────────────────────────────────────────────

describe('setExerciseSetCount — reconciles head rows to exactly `count`', () => {
  it('growing from 0 inserts `count` rows at positions 1..count, with no target to copy (none existed)', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await setExerciseSetCount('user-1', 'pe-1', [], 3)

    expect(fromMock).toHaveBeenCalledWith('v2_program_sets')
    expect(chain.insert).toHaveBeenCalledWith([
      { user_id: 'user-1', program_exercise_id: 'pe-1', position: 1, is_warmup: false, rep_min: null, rep_max: null, is_amrap: false },
      { user_id: 'user-1', program_exercise_id: 'pe-1', position: 2, is_warmup: false, rep_min: null, rep_max: null, is_amrap: false },
      { user_id: 'user-1', program_exercise_id: 'pe-1', position: 3, is_warmup: false, rep_min: null, rep_max: null, is_amrap: false },
    ])
  })

  // Review fix: "sets added by the stepper take the rep target of the
  // exercise's last existing set" (TASKS.md) — so raising the count after
  // an exercise-level "fill all" keeps adding sets with that same target.
  it('growing from an existing count continues positions after the highest existing one, copying ITS rep target onto every new row', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)
    const existing = [
      programSet({ id: 'a', position: 1, repMin: 10, repMax: 10 }),
      programSet({ id: 'b', position: 2, repMin: 8, repMax: 12 }), // the LAST one — this is what gets copied
    ]

    await setExerciseSetCount('user-1', 'pe-1', existing, 4)

    expect(chain.insert).toHaveBeenCalledWith([
      { user_id: 'user-1', program_exercise_id: 'pe-1', position: 3, is_warmup: false, rep_min: 8, rep_max: 12, is_amrap: false },
      { user_id: 'user-1', program_exercise_id: 'pe-1', position: 4, is_warmup: false, rep_min: 8, rep_max: 12, is_amrap: false },
    ])
  })

  it('growing copies AMRAP too when that is the last set\'s own target', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)
    const existing = [programSet({ id: 'a', position: 1, isAmrap: true })]

    await setExerciseSetCount('user-1', 'pe-1', existing, 2)

    expect(chain.insert).toHaveBeenCalledWith([
      { user_id: 'user-1', program_exercise_id: 'pe-1', position: 2, is_warmup: false, rep_min: null, rep_max: null, is_amrap: true },
    ])
  })

  it('"last existing set" means highest POSITION, not array order', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)
    // Deliberately out of position order, as a caller's own re-sort might
    // not be guaranteed — position 2 (repMin 8/12) is the true last, even
    // though it appears first in this array.
    const existing = [
      programSet({ id: 'b', position: 2, repMin: 8, repMax: 12 }),
      programSet({ id: 'a', position: 1, repMin: 10, repMax: 10 }),
    ]

    await setExerciseSetCount('user-1', 'pe-1', existing, 3)

    expect(chain.insert).toHaveBeenCalledWith([
      { user_id: 'user-1', program_exercise_id: 'pe-1', position: 3, is_warmup: false, rep_min: 8, rep_max: 12, is_amrap: false },
    ])
  })

  it('shrinking deletes exactly the TRAILING rows (highest position), keeps the rest untouched', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)
    const existing = [
      programSet({ id: 'a', position: 1 }),
      programSet({ id: 'b', position: 2 }),
      programSet({ id: 'c', position: 3 }),
    ]

    await setExerciseSetCount('user-1', 'pe-1', existing, 1)

    expect(chain.delete).toHaveBeenCalled()
    expect(chain.in).toHaveBeenCalledWith('id', ['b', 'c'])
  })

  // Review fix: "a per-set override survives an unrelated count change" —
  // growing NEVER updates or deletes a retained row (every position <= the
  // old count), so a set someone already overrode away from the rest stays
  // exactly as it was, whatever the new count is.
  it('a per-set override survives growing the count — no update/delete touches any retained row', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)
    const existing = [
      programSet({ id: 'a', position: 1, repMin: 8, repMax: 12 }),
      programSet({ id: 'overridden', position: 2, isAmrap: true }), // deliberately different from the rest
      programSet({ id: 'c', position: 3, repMin: 8, repMax: 12 }),
    ]

    await setExerciseSetCount('user-1', 'pe-1', existing, 4)

    expect(chain.update).not.toHaveBeenCalled()
    expect(chain.delete).not.toHaveBeenCalled()
    // The only write is the new row, copying set 3's (the true last) own
    // target — 'overridden' (position 2) is untouched by this call entirely.
    expect(chain.insert).toHaveBeenCalledWith([
      { user_id: 'user-1', program_exercise_id: 'pe-1', position: 4, is_warmup: false, rep_min: 8, rep_max: 12, is_amrap: false },
    ])
  })

  it('equal count: no insert, no delete (a true no-op — reviewer note 1\'s own guarantee)', async () => {
    const existing = [programSet({ id: 'a', position: 1 })]

    await setExerciseSetCount('user-1', 'pe-1', existing, 1)

    expect(fromMock).not.toHaveBeenCalled()
  })

  it('rejects a negative count rather than silently clamping', async () => {
    await expect(setExerciseSetCount('user-1', 'pe-1', [], -1)).rejects.toThrow()
  })
})

// ─── setRepTargetForAllSets ("fill all sets of an exercise at once") ───────

describe('setRepTargetForAllSets', () => {
  it('writes every given head id in ONE update call', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await setRepTargetForAllSets(['a', 'b', 'c'], { type: 'range', min: 8, max: 12 })

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith('v2_program_sets')
    expect(chain.update).toHaveBeenCalledWith({ rep_min: 8, rep_max: 12, is_amrap: false })
    expect(chain.in).toHaveBeenCalledWith('id', ['a', 'b', 'c'])
  })

  it('AMRAP clears any stray numbers on every head', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await setRepTargetForAllSets(['a', 'b'], { type: 'amrap' })

    expect(chain.update).toHaveBeenCalledWith({ rep_min: null, rep_max: null, is_amrap: true })
  })

  it('no heads given -> no Supabase call at all', async () => {
    await setRepTargetForAllSets([], { type: 'number', value: 8 })
    expect(fromMock).not.toHaveBeenCalled()
  })
})

// ─── summarizeRepTargets ────────────────────────────────────────────────────

describe('summarizeRepTargets', () => {
  it('no heads -> null (nothing to summarise yet)', () => {
    expect(summarizeRepTargets([])).toBeNull()
  })

  it('every head agreeing on a range -> that range', () => {
    const heads = [programSet({ id: 'a', repMin: 8, repMax: 12 }), programSet({ id: 'b', repMin: 8, repMax: 12 })]
    expect(summarizeRepTargets(heads)).toEqual({ type: 'range', min: 8, max: 12 })
  })

  it('every head agreeing on "no target" -> {type: none}, not mixed', () => {
    const heads = [programSet({ id: 'a' }), programSet({ id: 'b' })]
    expect(summarizeRepTargets(heads)).toEqual({ type: 'none' })
  })

  it('heads disagreeing -> \'mixed\'', () => {
    const heads = [programSet({ id: 'a', repMin: 8, repMax: 12 }), programSet({ id: 'b', isAmrap: true })]
    expect(summarizeRepTargets(heads)).toBe('mixed')
  })

  it('a single head -> that head\'s own target (trivially "agreeing" with itself)', () => {
    const heads = [programSet({ id: 'a', repMin: 10, repMax: 10 })]
    expect(summarizeRepTargets(heads)).toEqual({ type: 'number', value: 10 })
  })
})

// ─── updateProgramSetRepTarget ──────────────────────────────────────────────

describe('updateProgramSetRepTarget — mirrors repTargetToColumns exactly', () => {
  it('a plain number writes repMin = repMax = that value', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await updateProgramSetRepTarget('ps-1', { type: 'number', value: 8 })

    expect(chain.update).toHaveBeenCalledWith({ rep_min: 8, rep_max: 8, is_amrap: false })
    expect(chain.eq).toHaveBeenCalledWith('id', 'ps-1')
  })

  it('a range writes both ends, is_amrap false', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await updateProgramSetRepTarget('ps-1', { type: 'range', min: 8, max: 12 })

    expect(chain.update).toHaveBeenCalledWith({ rep_min: 8, rep_max: 12, is_amrap: false })
  })

  it('AMRAP writes null/null/true — no stray numbers', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await updateProgramSetRepTarget('ps-1', { type: 'amrap' })

    expect(chain.update).toHaveBeenCalledWith({ rep_min: null, rep_max: null, is_amrap: true })
  })

  it('none clears every field', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await updateProgramSetRepTarget('ps-1', { type: 'none' })

    expect(chain.update).toHaveBeenCalledWith({ rep_min: null, rep_max: null, is_amrap: false })
  })
})

// ─── Stages (chunk 14 — SPEC.md "Staged sets") ──────────────────────────────

describe('updateProgramSetStageKind — head-only (027: a stage carries no kind of its own)', () => {
  it('writes exactly { stage_kind } against the given head id', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await updateProgramSetStageKind('head-1', 'rest_pause')

    expect(fromMock).toHaveBeenCalledWith('v2_program_sets')
    expect(chain.update).toHaveBeenCalledWith({ stage_kind: 'rest_pause' })
    expect(chain.eq).toHaveBeenCalledWith('id', 'head-1')
  })

  it('null clears it back to "no kind chosen" (reads as a dropset, resolveStageKind)', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await updateProgramSetStageKind('head-1', null)

    expect(chain.update).toHaveBeenCalledWith({ stage_kind: null })
  })
})

describe('addProgramSetStage — parent id given directly, never inferred (mirrors weekPlanService.ts\'s addStage)', () => {
  it('inserts a stage row: the head\'s own parentId/position, the caller\'s stageIndex, no kind/rest/warmup of its own', async () => {
    const chain = makeChain({ data: { id: 'new-stage' }, error: null })
    fromMock.mockReturnValue(chain)

    await addProgramSetStage('user-1', 'pe-1', 'head-1', 3, 1)

    expect(fromMock).toHaveBeenCalledWith('v2_program_sets')
    const payload = (chain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(payload).toEqual({
      user_id: 'user-1',
      program_exercise_id: 'pe-1',
      position: 3,
      is_warmup: false,
      parent_program_set_id: 'head-1',
      stage_index: 1,
    })
    // Satisfies 027's stage_row_check by construction: no stage_kind,
    // stage_rest_seconds key at all (not even null) on a stage insert.
    expect('stage_kind' in payload).toBe(false)
    expect('stage_rest_seconds' in payload).toBe(false)
  })
})

describe('removeProgramSet — one row at a time (the SETS stepper\'s own bulk shrink is untouched)', () => {
  it('deletes by id against v2_program_sets', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await removeProgramSet('stage-1')

    expect(fromMock).toHaveBeenCalledWith('v2_program_sets')
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', 'stage-1')
  })
})

// ─── splitSharedWeekdayWorkouts (G14 — "give each weekday its own workout") ─

describe('splitSharedWeekdayWorkouts', () => {
  const workoutDays: WorkoutDay[] = [
    { id: 'wd-shared', programId: 'prog-1', userId: 'user-1', name: 'Full Body', position: 0, exercises: [] },
  ]

  it('keeps the FIRST weekday pointing at the original; clones for every other one', async () => {
    createWorkoutDayMock.mockResolvedValue({
      id: 'wd-clone', programId: 'prog-1', userId: 'user-1', name: 'Full Body', position: 0, exercises: [],
    })
    fetchRunProgramExercisesMock.mockResolvedValue([])
    const schedule: WeeklySchedule = { ...EMPTY_SCHEDULE, monday: 'wd-shared', wednesday: 'wd-shared', friday: 'wd-shared' }
    const groups = detectSharedWeekdayWorkouts(schedule)

    const next = await splitSharedWeekdayWorkouts('user-1', workoutDays, schedule, groups)

    expect(next.monday).toBe('wd-shared') // untouched — first occurrence
    expect(next.wednesday).toBe('wd-clone')
    expect(next.friday).toBe('wd-clone')
    expect(createWorkoutDayMock).toHaveBeenCalledTimes(2) // one clone per EXTRA weekday
  })

  it('clones every current exercise (name, position, weight unit) and its own head sets', async () => {
    createWorkoutDayMock.mockResolvedValue({
      id: 'wd-clone', programId: 'prog-1', userId: 'user-1', name: 'Full Body', position: 0, exercises: [],
    })
    const sourceExercise: ProgramExercise = {
      id: 'pe-src', workoutDayId: 'wd-shared', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: 'lbs',
    }
    fetchRunProgramExercisesMock.mockResolvedValue([sourceExercise])
    const insertChain = makeChain({ data: null, error: null })
    const setsSelectChain = makeChain({ data: [{
      id: 'ps-src', user_id: 'user-1', program_exercise_id: 'pe-src', position: 1, is_warmup: false,
      stage_kind: null, stage_rest_seconds: null, parent_program_set_id: null, stage_index: 0,
      rep_min: 8, rep_max: 12, is_amrap: false, rest_seconds: null, created_at: '2026-01-01T00:00:00Z',
    }], error: null })
    // v2_program_exercises insert (no .select chained — see plannerService.ts's
    // own header on why) and v2_program_sets select/insert all go through
    // fromMock; route by table name.
    fromMock.mockImplementation((table: string) => (table === 'v2_program_sets' ? setsSelectChain : insertChain))

    const schedule: WeeklySchedule = { ...EMPTY_SCHEDULE, monday: 'wd-shared', wednesday: 'wd-shared' }
    const groups = detectSharedWeekdayWorkouts(schedule)

    await splitSharedWeekdayWorkouts('user-1', workoutDays, schedule, groups)

    // v2_program_exercises: the clone row, with the SOURCE's own weight unit
    // preserved (never forced to a literal — see plannerService.ts's header
    // on why this is NOT programService.ts's own addProgramExercise).
    const peInsertCall = (insertChain.insert as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0]?.exercise_id === 'ex-1',
    )
    expect(peInsertCall?.[0]).toMatchObject({
      workout_day_id: 'wd-clone', exercise_id: 'ex-1', position: 0, weight_unit: 'lbs',
    })
    expect(typeof peInsertCall?.[0]?.id).toBe('string')

    // v2_program_sets: one row cloned from the source head. Both the
    // earlier SELECT (fetchProgramSets) and this INSERT share the same
    // 'v2_program_sets' table name, so both land on setsSelectChain —
    // insertChain is only ever hit by the v2_program_exercises write.
    const setsInsertCall = (setsSelectChain.insert as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => Array.isArray(c[0]) && c[0][0]?.rep_min === 8,
    )
    expect(setsInsertCall?.[0]).toEqual([{
      user_id: 'user-1', program_exercise_id: peInsertCall?.[0]?.id, position: 1,
      is_warmup: false, rep_min: 8, rep_max: 12, is_amrap: false, rest_seconds: null,
    }])
  })

  it('an unlisted group (no matching workoutDays entry) is skipped, not thrown', async () => {
    const schedule: WeeklySchedule = { ...EMPTY_SCHEDULE, monday: 'ghost', wednesday: 'ghost' }
    const groups = detectSharedWeekdayWorkouts(schedule)

    const next = await splitSharedWeekdayWorkouts('user-1', [], schedule, groups)

    expect(next).toEqual(schedule)
    expect(createWorkoutDayMock).not.toHaveBeenCalled()
  })
})
