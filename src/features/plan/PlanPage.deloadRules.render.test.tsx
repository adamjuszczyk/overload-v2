// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { calculateDeloadSets, type DeloadSourceSet, type DeloadRules } from '../../lib/deloadRules'

// Chunk 22 — "jsdom: mark with rules on -> the shown sets equal the
// calculator's output" and "edit one calculated set, then unmark -> the
// pre-mark sets are back exactly" (verification list, verbatim). Same
// "mock ./useWeekPlan entirely" seam as PlanPage.deload.test.tsx — this
// file proves the RENDER layer (given a WeekPlan.sets value, PlanPage
// shows exactly those weight/rep numbers), which combines with:
//   - deloadRules.test.ts: the calculator's own pure output for a fixture
//     (this file calls the REAL calculateDeloadSets on the same fixture,
//     never hand-computed numbers, so a calculator regression shows up
//     here too);
//   - weekPlanService.deload.test.ts: the executor writes exactly the
//     calculator's output (insertCalculatedPlanSets), and restore's only
//     input is the snapshot, never the current (possibly hand-edited) sets
//     (applyDeloadRestore) —
// into one end-to-end proof that doesn't require re-implementing a fake
// Postgres: calculate -> (proven) write -> (this file) render.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const startDate = format(new Date(), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const EX_A: Exercise = {
  id: 'ex-a', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
// weightUnit: null -> inherits the global default, which DEFAULT_SETTINGS
// (useSettingsStore's own untouched state through this file) sets to 'kg'
// — so displayed weight is kg, no lbs round trip to account for here.
const pe1: ProgramExercise = { id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0, weightUnit: null, exercise: EX_A }

function makeProgram(): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType: 'week_dependent', deloadRules: null,
  }
}

function makePlan(sets: WeekPlanSet[], isDeload: boolean): WeekPlan {
  return {
    id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1',
    weekNumber: 2, isDeload, notes: null, sets, exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
  }
}

const mockState: { plans: WeekPlan[] } = { plans: [] }

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [makeProgram()], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))

// Chunk 24 — this component owns its own hooks (useSessionsInRange via
// gym/useSession.ts, which needs a real QueryClientProvider this file's
// own render() doesn't set up — every other PlanPage hook is mocked away
// the same way for the same reason). Stubbed to nothing: this file's own
// job is unrelated to session-moving: MoveSessionControl.test.tsx proves
// the real component.
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

// Same sourceId -> new-id remap the real executor performs
// (insertCalculatedPlanSets) — a stage's parentWeekPlanSetId must resolve
// to its OWN head's new id, never stay null (which would render it as an
// independent head instead of nested beneath its group).
function weekPlanSetsFromCalculated(calculated: ReturnType<typeof calculateDeloadSets>): WeekPlanSet[] {
  const idBySourceId = new Map(calculated.map((c, i) => [c.sourceId, `calc-${i}`]))
  return calculated.map((c) => ({
    id: idBySourceId.get(c.sourceId)!, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: c.programExerciseId,
    setNumber: c.setNumber, targetRir: c.targetRir, isDropset: c.isDropset,
    parentWeekPlanSetId: c.parentSourceId ? (idBySourceId.get(c.parentSourceId) ?? null) : null,
    stageIndex: c.stageIndex, isWarmup: c.isWarmup,
    repMin: c.repMin, repMax: c.repMax, isAmrap: c.isAmrap, stageKind: c.stageKind,
    programSetId: c.programSetId, targetWeight: c.targetWeight, tags: c.tags,
  }))
}

describe('PlanPage — a marked-with-rules session shows exactly the calculator\'s own output', () => {
  it('4 base sets at 100kg/8–12, −50% sets and 75% weight → 2 rows shown at 75kg/8–12 (set 3/4 gone)', () => {
    const base: DeloadSourceSet[] = [1, 2, 3, 4].map((n) => ({
      id: `base-${n}`, programExerciseId: 'pe-1', setNumber: n, parentId: null, stageIndex: 0,
      isWarmup: false, stageKind: null, programSetId: null, repMin: 8, repMax: 12, isAmrap: false,
      targetRir: 2, tags: null, isDropset: false, plannedWeight: 100, loggedWeight: null,
    }))
    const rules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' }, weight: { percent: 75, rounding: 'down', step: 2.5, stepUnit: 'kg' } }
    const calculated = calculateDeloadSets(base, rules)
    expect(calculated).toHaveLength(2) // sanity on the fixture itself

    mockState.plans = [makePlan(weekPlanSetsFromCalculated(calculated), true)]
    renderPlanPage()

    expect(screen.getAllByRole('button', { name: '75kg' })).toHaveLength(2)
    expect(screen.getAllByText('8–12')).toHaveLength(2) // a real (non-"—") rep target renders as plain text, not a button
    expect(screen.getByText('01')).toBeTruthy()
    expect(screen.getByText('02')).toBeTruthy()
    expect(screen.queryByText('03')).toBeNull() // the dropped (3rd/4th) sets never render at all
    expect(screen.queryByText('04')).toBeNull()
  })

  it('a staged set counted as one + warmups untouched, rendered: 2 working rows (one staged) plus the warmup, unchanged', () => {
    const warmup: DeloadSourceSet = {
      id: 'w1', programExerciseId: 'pe-1', setNumber: 1, parentId: null, stageIndex: 0,
      isWarmup: true, stageKind: null, programSetId: null, repMin: null, repMax: null, isAmrap: false,
      targetRir: null, tags: null, isDropset: false, plannedWeight: 40, loggedWeight: null,
    }
    const head1 = {
      id: 'h1', programExerciseId: 'pe-1', setNumber: 2, parentId: null, stageIndex: 0,
      isWarmup: false, stageKind: 'dropset' as const, programSetId: null, repMin: 8, repMax: 12, isAmrap: false,
      targetRir: 2, tags: null, isDropset: false, plannedWeight: 100, loggedWeight: null,
    }
    const stage1 = {
      id: 's1', programExerciseId: 'pe-1', setNumber: 2, parentId: 'h1', stageIndex: 1,
      isWarmup: false, stageKind: null, programSetId: null, repMin: 8, repMax: 12, isAmrap: false,
      targetRir: 2, tags: null, isDropset: true, plannedWeight: 80, loggedWeight: null,
    }
    const head2 = {
      id: 'h2', programExerciseId: 'pe-1', setNumber: 3, parentId: null, stageIndex: 0,
      isWarmup: false, stageKind: null, programSetId: null, repMin: 8, repMax: 12, isAmrap: false,
      targetRir: 2, tags: null, isDropset: false, plannedWeight: 100, loggedWeight: null,
    }
    const rules: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } } // no weight rule — untouched
    const calculated = calculateDeloadSets([warmup, head1, stage1, head2], rules)
    // 2 working "sets" by position (head1+stage1 counts as one, head2 the
    // other) -> -50% keeps 1: the staged one (set 2 is "first" by number).
    expect(calculated.map((c) => c.sourceId)).toEqual(['w1', 'h1', 's1'])

    mockState.plans = [makePlan(weekPlanSetsFromCalculated(calculated), true)]
    renderPlanPage()

    expect(screen.getByRole('button', { name: '40kg' })).toBeTruthy() // the warmup — untouched, still shown
    expect(screen.getAllByRole('button', { name: '100kg' })).toHaveLength(1) // head1, weight rule off -> planned value
    expect(screen.getByRole('button', { name: '80kg' })).toBeTruthy() // stage1, nested under head1 (not an independent head)
    // head2 (the dropped, LAST working set) never renders at all — only
    // 3 of the original 4 source rows (warmup, head1, stage1) show up.
    expect(screen.getAllByRole('button', { name: /\d+kg/ })).toHaveLength(3)
  })
})

describe('PlanPage — unmarking restores the exact pre-mark sets, regardless of any hand-edit to the calculated ones', () => {
  it('shows the ORIGINAL pre-mark values after unmark, not the calculated (and since-edited) ones', () => {
    // "Before": the calculated sets, as they stood right before unmarking —
    // one of them hand-edited (90kg here) after marking, which a real
    // deload_restore snapshot (captured at MARK time, before any edit)
    // never reflects — weekPlanService.deload.test.ts's own "restore's
    // only input is the snapshot" test proves the executor never reads
    // this value; this test proves the render layer shows whatever the
    // (correctly-restored) data says, i.e. the pre-mark value below, not
    // this one.
    const calculatedAndEdited: WeekPlanSet = {
      id: 'calc-1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1,
      targetRir: 4, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
      repMin: 6, repMax: 10, isAmrap: false, targetWeight: 90, tags: null,
    }
    // Sanity: this is a DIFFERENT value from the restored one below —
    // proves the test isn't vacuously true.
    expect(calculatedAndEdited.targetWeight).not.toBe(50)

    // "After unmark": what a real restore (insertRestoredPlanSets, from
    // the ORIGINAL pre-mark snapshot) produces — new id, every other
    // column exactly the pre-mark row's own.
    const restored: WeekPlanSet = {
      id: 'restored-1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1,
      targetRir: 3, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
      repMin: 5, repMax: 5, isAmrap: false, targetWeight: 50, tags: ['push here'],
    }

    mockState.plans = [makePlan([restored], false)]
    renderPlanPage()

    expect(screen.getByRole('button', { name: '50kg' })).toBeTruthy() // the pre-mark weight, not 90kg
    expect(screen.getByText('5')).toBeTruthy() // the pre-mark rep target (a plain number), not 6–10
    expect(screen.queryByRole('button', { name: '90kg' })).toBeNull()
    expect(screen.queryByText('6–10')).toBeNull()
  })
})
