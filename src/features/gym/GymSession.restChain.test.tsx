// @vitest-environment jsdom
//
// Chunk 16 (TASKS.md "The rest chain" / SPEC.md "Rest [P1]" — reviewer's
// brief: "jsdom 'real session' tests, one each"). Renders the REAL
// GymSession → ExerciseCard/SupersetBlock → SetGroup/SetRow tree (same
// precedent as GymSession.superset.test.tsx/GymSession.warmup.test.tsx) and
// asserts on restTimerStore's own resolved state after each log — not on
// RestTimer's rendered text (mocked to null here, same as every sibling
// GymSession test file), since restChain.test.ts already proves every
// resolution rule in isolation; this file proves the REAL read path
// (program exercise rest fields, program_set_id → program set rest/stage
// rest, superset block rest) reaches the store correctly end to end,
// through the real ExerciseCard/SupersetBlock/SetGroup/SetRow/
// useExerciseCardState chain. A SEPARATE file from D30's own: nothing here
// touches gymsession-d30-render.html or its test.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type {
  ProgramExercise,
  ProgramSet,
  ProgramSupersetBlock,
  WeekPlan,
  WeekPlanSet,
  WorkoutDay,
  Session,
  SetLog,
} from '../../types'

afterEach(() => cleanup())

// Mutable, module-level — same pattern as GymSession.superset.test.tsx's own
// `session`: the mocked hooks below all close over these, so a render after
// an update (via RTL's `rerender`) sees the latest value, the same way a
// real cache update would. Each test resets what it needs before rendering.
let session: Session = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined,
  workoutDayId: 'wd-1', workoutDay: undefined, date: '2026-01-05', status: 'in_progress', note: null,
  startedAt: '2026-01-05T10:00:00Z', completedAt: null, createdAt: '2026-01-05T10:00:00Z',
  setLogs: [], energyRating: null, pumpRating: null,
}
let programSetsFixture: ProgramSet[] = []
let blockRestsFixture: ProgramSupersetBlock[] = []

function programSet(overrides: Partial<ProgramSet> & { id: string; programExerciseId: string }): ProgramSet {
  return {
    userId: 'user-1', position: 1, isWarmup: false, stageKind: null, stageRestSeconds: null,
    parentProgramSetId: null, stageIndex: 0, repMin: null, repMax: null, isAmrap: false,
    restSeconds: null, createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const logSetMutateAsync = vi.fn((params: Record<string, unknown>) => {
  const log: SetLog = {
    id: `log-${(session.setLogs?.length ?? 0) + 1}`,
    userId: 'user-1',
    sessionId: 'session-1',
    exerciseId: params.exerciseId as string,
    weekPlanSetId: params.weekPlanSetId as string | null,
    setNumber: params.setNumber as number,
    weight: (params.weight as number | null) ?? null,
    reps: (params.reps as number | null) ?? null,
    rir: (params.rir as number | null) ?? null,
    note: null,
    isDropset: (params.isDropset as boolean | undefined) ?? false,
    parentSetId: (params.parentSetId as string | null) ?? null,
    stageIndex: (params.stageIndex as number | undefined) ?? 0,
    isWarmup: (params.isWarmup as boolean | undefined) ?? false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: false,
    loggedAt: '2026-01-05T10:05:00Z',
    restSeconds: null,
    formRating: null,
  }
  session = { ...session, setLogs: [...(session.setLogs ?? []), log] }
  return Promise.resolve(log)
})

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 0 }))
vi.mock('./useScrollToCurrentSet', () => ({
  useScrollToCurrentSet: () => ({ containerRef: { current: null }, direction: null, scrollToCurrentSet: () => {} }),
}))
vi.mock('./RestTimer', () => ({ default: () => null }))
vi.mock('./SessionComplete', () => ({ default: () => null }))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('./SwapExerciseSheet', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }),
  useSupersetBlockRests: () => ({ data: blockRestsFixture }),
  // Chunk 18 (SPEC "Warmup routine") — not this test's own concern (the rest
  // chain); empty so WarmupRoutineChecklist renders nothing at all.
  useWarmupRoutineItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: programSetsFixture }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: logSetMutateAsync }),
  useLastSessionLogs: () => ({ data: [], isLoading: false }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({
    data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn(),
  }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')
const { useRestTimerStore } = await import('./restTimerStore')
const { useSettingsStore, DEFAULT_SETTINGS } = await import('../settings/settingsStore')

beforeEach(() => {
  useRestTimerStore.setState({ startedAt: null, isVisible: true, anchorId: null, targetSeconds: null })
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, targetRestSeconds: 90 })
})

function sessionJsx(workoutDay: WorkoutDay, weekPlan: WeekPlan) {
  return (
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
    </MemoryRouter>
  )
}

// Finds and logs the first currently-loggable row in `container`, in DOM
// order — weight is the first non-disabled inputMode="decimal" field, reps
// the first non-disabled inputMode="numeric" one (SetRow.tsx's own two
// input definitions; a disabled one belongs to a LOCKED stage preview row,
// never a row this is meant to act on). This one query handles every shape
// this file needs: a plain working set (nothing else disables it), a
// superset's several simultaneously-active member rows (DOM order already
// matches the zigzag — round-major, member order within a round, the same
// property GymSession.superset.test.tsx's own [data-unlogged-set] query
// relies on), and a staged set's own head-then-stage sequence (a locked
// stage's inputs are disabled, so this skips straight past them to the one
// row that's actually active). Climbing to the nearest `div.space-y-1`
// finds SetRow's own root (its exact, unique className — SetGroup.tsx's
// wrapping divs use "space-y-1.5", a different literal class, so this never
// climbs past the row itself) to scope the LOG button lookup to this row
// alone, never a sibling's.
async function logFirstActiveRow(container: HTMLElement, weight: string, reps: string) {
  const weightInput = container.querySelector('input[inputmode="decimal"]:not([disabled])') as HTMLInputElement
  const repsInput = container.querySelector('input[inputmode="numeric"]:not([disabled])') as HTMLInputElement
  fireEvent.change(weightInput, { target: { value: weight } })
  fireEvent.change(repsInput, { target: { value: reps } })
  const row = weightInput.closest('div.space-y-1') as HTMLElement
  const logButton = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'LOG')!
  await act(async () => {
    fireEvent.click(logButton)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('GymSession — rest chain, real session (non-superset)', () => {
  const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
  const pe1: ProgramExercise = {
    id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null,
    restSeconds: 40, restAfterSeconds: 90,
    exercise: {
      id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
      createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
      status: 'active', sourceLibraryId: null, lostAt: null,
    },
  }

  function twoPlainSets(set2ProgramSetId: string | null = null): WeekPlanSet[] {
    return [
      { id: 'wps-1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId: null },
      { id: 'wps-2', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 2, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId: set2ProgramSetId },
    ]
  }

  beforeEach(() => {
    session = { ...session, setLogs: [] }
  })

  it('set 2\'s own rest override (program_set_id → v2_program_sets.rest_seconds) is the target — not the exercise\'s own rest-after, even on the last set', async () => {
    programSetsFixture = [programSet({ id: 'ps-2', programExerciseId: 'pe-1', restSeconds: 7 })]
    blockRestsFixture = []
    const weekPlan: WeekPlan = {
      id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
      isDeload: false, notes: null, sets: twoPlainSets('ps-2'), exercises: [pe1],
      createdAt: '2026-01-01T00:00:00Z',
    }
    const { container, rerender } = render(sessionJsx(workoutDay, weekPlan))

    await logFirstActiveRow(container, '60', '10') // set 1 — no override, not the last set
    expect(useRestTimerStore.getState().targetSeconds).toBe(40) // exercise's own rest (level 3)

    rerender(sessionJsx(workoutDay, weekPlan))
    await logFirstActiveRow(container, '62.5', '8') // set 2 — its own override, AND the exercise's last set
    expect(useRestTimerStore.getState().targetSeconds).toBe(7) // the override wins over level 2 (90) and level 3 (40)
    expect(useRestTimerStore.getState().startedAt).not.toBeNull()
  })

  it('D30: with no overrides anywhere (no exercise rest/rest-after, no set override, no superset, no stage), the resolved target and the GO point are the global Settings value — exactly as master', async () => {
    programSetsFixture = []
    blockRestsFixture = []
    const plainExercise: ProgramExercise = { ...pe1, restSeconds: null, restAfterSeconds: null }
    const weekPlan: WeekPlan = {
      id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
      isDeload: false, notes: null, sets: twoPlainSets(), exercises: [plainExercise],
      createdAt: '2026-01-01T00:00:00Z',
    }
    const { container } = render(sessionJsx(workoutDay, weekPlan))

    await logFirstActiveRow(container, '60', '10')

    // The resolved target...
    expect(useRestTimerStore.getState().targetSeconds).toBe(useSettingsStore.getState().targetRestSeconds)
    // ...and the GO point (RestTimer.d30.test.tsx's own proof, repeated
    // here through the REAL logging chain rather than a direct
    // useRestTimerStore.start() call): "GO" appears exactly at
    // targetRestSeconds, read the same way RestTimer.tsx itself does
    // (chainTarget ?? settingsTarget).
    const chainTarget = useRestTimerStore.getState().targetSeconds
    const goPoint = chainTarget ?? useSettingsStore.getState().targetRestSeconds
    expect(goPoint).toBe(90) // this file's own beforeEach sets targetRestSeconds: 90
  })

  it('"rest after" fires only on the exercise\'s last set', async () => {
    programSetsFixture = []
    blockRestsFixture = []
    const weekPlan: WeekPlan = {
      id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
      isDeload: false, notes: null, sets: twoPlainSets(), exercises: [pe1],
      createdAt: '2026-01-01T00:00:00Z',
    }
    const { container, rerender } = render(sessionJsx(workoutDay, weekPlan))

    await logFirstActiveRow(container, '60', '10') // set 1 — not the last set
    expect(useRestTimerStore.getState().targetSeconds).toBe(40) // level 3, not "rest after"

    rerender(sessionJsx(workoutDay, weekPlan))
    await logFirstActiveRow(container, '62.5', '8') // set 2 — the last set
    expect(useRestTimerStore.getState().targetSeconds).toBe(90) // level 2, "rest after"
  })
})

describe('GymSession — rest chain, real session (staged sets)', () => {
  // kind: null is the LEGACY case (review fix) — a head with stages but no
  // stage_kind ever written (every row this build produced before chunk
  // 14's STAGE KIND chip existed, and every head authored since that never
  // had that chip explicitly re-tapped — see restChain.ts's own header,
  // reading 1; null here reads identically to the field being absent
  // entirely, same "?? null" fallback every mapper in this build already
  // uses). Program sets are still present (program_set_id resolves to a
  // real row), every one of their own rest fields null too, so this proves
  // the fallthrough is driven by the KIND itself being unset, not by there
  // being no program-set row to find at all.
  function stagedFixture(workoutDayId: string, kind: 'dropset' | 'rest_pause' | null) {
    const idSuffix = kind ?? 'legacy'
    const workoutDay: WorkoutDay = { id: workoutDayId, programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
    const pe: ProgramExercise = {
      id: `pe-${idSuffix}`, workoutDayId, userId: 'user-1', exerciseId: `ex-${idSuffix}`, position: 0, weightUnit: null,
      exercise: {
        id: `ex-${idSuffix}`, userId: 'user-1', name: 'Leg Press', muscleGroup: 'quads', isArchived: false,
        createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
        status: 'active', sourceLibraryId: null, lostAt: null,
      },
    }
    const head: WeekPlanSet = {
      id: `wps-${idSuffix}-head`, weekPlanId: `wp-${idSuffix}`, userId: 'user-1', programExerciseId: pe.id,
      setNumber: 1, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
      stageKind: kind, programSetId: `ps-${idSuffix}-head`,
    }
    // Two planned stages — logging stage 1 still has a next stage to come,
    // so restChain.ts's hasNextStage holds and the stage-kind rule applies
    // (not the "last configured stage falls through" case, which chunk 16's
    // own report covers separately).
    const stage1: WeekPlanSet = {
      id: `wps-${idSuffix}-s1`, weekPlanId: `wp-${idSuffix}`, userId: 'user-1', programExerciseId: pe.id,
      setNumber: 1, targetRir: 0, isDropset: true, parentWeekPlanSetId: head.id, stageIndex: 1, isWarmup: false,
      programSetId: `ps-${idSuffix}-s1`,
    }
    const stage2: WeekPlanSet = {
      id: `wps-${idSuffix}-s2`, weekPlanId: `wp-${idSuffix}`, userId: 'user-1', programExerciseId: pe.id,
      setNumber: 1, targetRir: 0, isDropset: true, parentWeekPlanSetId: head.id, stageIndex: 2, isWarmup: false,
      programSetId: `ps-${idSuffix}-s2`,
    }
    const weekPlan: WeekPlan = {
      id: `wp-${idSuffix}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId, weekNumber: 1,
      isDeload: false, notes: null, sets: [head, stage1, stage2], exercises: [pe],
      createdAt: '2026-01-01T00:00:00Z',
    }
    programSetsFixture = [
      programSet({ id: `ps-${idSuffix}-head`, programExerciseId: pe.id, stageKind: kind, stageRestSeconds: null }),
      programSet({ id: `ps-${idSuffix}-s1`, programExerciseId: pe.id, parentProgramSetId: `ps-${idSuffix}-head`, stageIndex: 1 }),
      programSet({ id: `ps-${idSuffix}-s2`, programExerciseId: pe.id, parentProgramSetId: `ps-${idSuffix}-head`, stageIndex: 2 }),
    ]
    blockRestsFixture = []
    return { workoutDay, weekPlan }
  }

  beforeEach(() => {
    session = { ...session, setLogs: [] }
  })

  it('a dropset stage starts no timer (kind\'s own default)', async () => {
    const { workoutDay, weekPlan } = stagedFixture('wd-dropset', 'dropset')
    const { container, rerender } = render(sessionJsx(workoutDay, weekPlan))

    await logFirstActiveRow(container, '100', '10') // the head — rests before stage 1 (also "no timer", dropset)
    expect(useRestTimerStore.getState().startedAt).toBeNull()

    rerender(sessionJsx(workoutDay, weekPlan))
    await logFirstActiveRow(container, '80', '10') // stage 1 — rests before stage 2, still "no timer"
    expect(useRestTimerStore.getState().startedAt).toBeNull()
  })

  // Review fix — D30's own gate, proven at the SESSION level, not just the
  // resolver's (restChain.test.ts's own unit test covers resolveRestTarget
  // in isolation; it can't see useExerciseCardState.ts's OWN mapping from a
  // nullable DB field to that resolver's input, which is exactly where a
  // regression was found: stageContextForHead/stageContextForStage reading
  // `plannedSet.stageKind ?? 'dropset'` instead of `?? null` passed every
  // existing test, including every one of THIS file's own, because none of
  // them ever logged a null-kind staged set through the real hook). The
  // contrast with the test right above is deliberate and direct: same
  // session shape, same two-planned-stage structure, same "every rest field
  // null" program sets — the only difference is stageKind itself.
  it('D30: a LEGACY staged set (stage_kind never written) times rests exactly as before — the global setting, not "no timer"', async () => {
    const { workoutDay, weekPlan } = stagedFixture('wd-legacy', null)
    const { container, rerender } = render(sessionJsx(workoutDay, weekPlan))

    await logFirstActiveRow(container, '100', '10') // the head — rests before stage 1
    expect(useRestTimerStore.getState().startedAt).not.toBeNull()
    // The GO point RestTimer.tsx would actually show: chainTarget ?? settings.
    expect(useRestTimerStore.getState().targetSeconds ?? useSettingsStore.getState().targetRestSeconds).toBe(90)

    rerender(sessionJsx(workoutDay, weekPlan))
    await logFirstActiveRow(container, '80', '10') // stage 1 — rests before stage 2, same fallthrough
    expect(useRestTimerStore.getState().startedAt).not.toBeNull()
    expect(useRestTimerStore.getState().targetSeconds ?? useSettingsStore.getState().targetRestSeconds).toBe(90)
  })

  it('a rest-pause stage is 15s by default', async () => {
    const { workoutDay, weekPlan } = stagedFixture('wd-restpause', 'rest_pause')
    const { container, rerender } = render(sessionJsx(workoutDay, weekPlan))

    await logFirstActiveRow(container, '100', '10') // the head
    rerender(sessionJsx(workoutDay, weekPlan))
    await logFirstActiveRow(container, '80', '10') // stage 1 — rests before stage 2
    expect(useRestTimerStore.getState().targetSeconds).toBe(15)
    expect(useRestTimerStore.getState().startedAt).not.toBeNull()
  })
})

describe('GymSession — rest chain, real session (supersets)', () => {
  const workoutDay: WorkoutDay = { id: 'wd-ss', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

  function makeExercise(id: string, exerciseId: string, name: string, position: number): ProgramExercise {
    return {
      id, workoutDayId: 'wd-ss', userId: 'user-1', exerciseId, position, weightUnit: null,
      supersetBlockId: 'block-1',
      exercise: {
        id: exerciseId, userId: 'user-1', name, muscleGroup: 'chest', isArchived: false,
        createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
        status: 'active', sourceLibraryId: null, lostAt: null,
      },
    }
  }
  function planSet(id: string, programExerciseId: string, setNumber: number, programSetId: string | null = null): WeekPlanSet {
    return {
      id, weekPlanId: 'wp-ss', userId: 'user-1', programExerciseId, setNumber,
      targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId,
    }
  }

  beforeEach(() => {
    session = { ...session, setLogs: [] }
  })

  it('no timer inside a round by default, but a set\'s own override still wins', async () => {
    const peA = makeExercise('pe-a', 'ex-a', 'Bench Press', 0)
    const peB = makeExercise('pe-b', 'ex-b', 'Barbell Row', 1)
    const peC = makeExercise('pe-c', 'ex-c', 'Shoulder Press', 2)
    // Round 1 = [A1, B1, C1] (1 set each) — C1 ends it; A1 and B1 do not.
    programSetsFixture = [programSet({ id: 'ps-b1', programExerciseId: 'pe-b', restSeconds: 12 })]
    blockRestsFixture = [{ id: 'block-1', restWithinRoundSeconds: null, restAfterRoundSeconds: null }]
    const weekPlan: WeekPlan = {
      id: 'wp-ss', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-ss', weekNumber: 1,
      isDeload: false, notes: null,
      sets: [planSet('set-a1', 'pe-a', 1), planSet('set-b1', 'pe-b', 1, 'ps-b1'), planSet('set-c1', 'pe-c', 1)],
      exercises: [peA, peB, peC], createdAt: '2026-01-01T00:00:00Z',
    }
    const { container, rerender } = render(sessionJsx(workoutDay, weekPlan))

    // A1 — within the round, no override of its own: no timer at all.
    await logFirstActiveRow(container, '60', '10')
    expect(useRestTimerStore.getState().startedAt).toBeNull()
    rerender(sessionJsx(workoutDay, weekPlan))

    // B1 — also within the round (not the ending cell), but carries its own
    // explicit override: SPEC, verbatim — "a set's own explicit rest
    // override wins over 'no timer within a round'".
    await logFirstActiveRow(container, '40', '12')
    expect(useRestTimerStore.getState().targetSeconds).toBe(12)
  })

  it('the ending exercise\'s own chain after a round with no block override — and "rest after" only on the block\'s final round', async () => {
    const peA: ProgramExercise = { ...makeExercise('pe-a', 'ex-a', 'Bench Press', 0), restSeconds: 65, restAfterSeconds: 290 } // 2 sets
    const peB: ProgramExercise = { ...makeExercise('pe-b', 'ex-b', 'Barbell Row', 1), restSeconds: 45, restAfterSeconds: 190 } // 1 set
    programSetsFixture = []
    blockRestsFixture = [{ id: 'block-1', restWithinRoundSeconds: null, restAfterRoundSeconds: null }]
    const weekPlan: WeekPlan = {
      id: 'wp-ss2', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-ss', weekNumber: 1,
      isDeload: false, notes: null,
      // Round 1 = [A1, B1] (B ends it — NOT the block's final round, round 2
      // still has A2). Round 2 = [A2] (A ends it — the FINAL round).
      sets: [planSet('set-a1', 'pe-a', 1), planSet('set-a2', 'pe-a', 2), planSet('set-b1', 'pe-b', 1)],
      exercises: [peA, peB], createdAt: '2026-01-01T00:00:00Z',
    }
    const { container, rerender } = render(sessionJsx(workoutDay, weekPlan))

    // A1 — within round 1, no override.
    await logFirstActiveRow(container, '60', '10')
    expect(useRestTimerStore.getState().startedAt).toBeNull()
    rerender(sessionJsx(workoutDay, weekPlan))

    // B1 ends round 1 — NOT the block's final round. B's own "rest after"
    // (190) must NOT fire here, even though this is also B's own last
    // planned set — SPEC: "An exercise's rest after never fires inside a
    // round; it applies only after the block's final round."
    await logFirstActiveRow(container, '40', '12')
    expect(useRestTimerStore.getState().targetSeconds).toBe(45) // B's plain exercise rest, not 190
    rerender(sessionJsx(workoutDay, weekPlan))

    // A2 ends round 2 — the block's FINAL round, and A's own last set: A's
    // "rest after" DOES fire here.
    await logFirstActiveRow(container, '62.5', '8')
    expect(useRestTimerStore.getState().targetSeconds).toBe(290)
  })
})
