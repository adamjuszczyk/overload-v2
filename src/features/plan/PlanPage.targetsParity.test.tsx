// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 19 (D30 gate, reviewer's note): "Existing week plans have target_rir
// and (since 034) rep targets, but no weights or tags, so their Plan ...
// screens must render exactly as on master. Add a Plan-side parity test ...
// if one isn't already equivalent."
//
// A literal whole-row byte-diff against pre-chunk-19 master (the way
// PlanPage.renderParity.test.tsx or GymSession.d30.test.tsx compare against
// a frozen HTML fixture) is not possible here, by construction: this chunk
// makes the rep target genuinely editable (SPEC "Targets" — "the week plan
// can override a set's rep target"), and weight/tags have NO source other
// than Plan's own new editor at all (unlike target_rir, nothing upstream
// can ever seed them). So, unlike a read-only display that can legitimately
// render nothing when a field is absent (rule 3's "no target shows no
// target" — SetRow.tsx/PlanTargetsPanel.tsx, the WORKOUT screen), Plan's own
// row needs SOME always-present affordance to let a first weight/tag ever
// be typed — a "—" weight placeholder, a tags chip row — regardless of
// whether this particular set has one yet. That is new markup master never
// had, for every row, so a frozen "master" fixture re-captured here would
// immediately and unavoidably differ from this branch's render, for ANY
// input.
//
// What this test actually proves instead — the content-level property that
// is both testable and the one that actually matters for "nothing has
// regressed": a set that already has an RIR and a rep target (the common
// historical shape — every real week plan, since migration 034) still shows
// that exact RIR and that exact rep target, in the exact same text, whether
// or not it ALSO happens to have a weight target or tags; and a set with no
// weight/tags shows no SIGN of having any (no populated weight value, no
// tag marked active/appliable-to-all) — only the same always-present,
// value-less affordances every other set's row also gets. Together these
// show chunk 19's new fields are strictly additive: they neither change how
// an existing RIR/rep-target value renders, nor fabricate the appearance of
// a weight/tag that was never set.
//
// Same mocking recipe as PlanPage.repTargets.test.tsx, trimmed to this
// file's own concern.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const startDate = format(new Date(), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = {
  id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [],
}
const EX_A: Exercise = {
  id: 'ex-a', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0,
  weightUnit: null, exercise: EX_A,
}

function makeProgram(): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType: 'week_dependent',
  }
}

// A historical set exactly as 034's backfill + chunk 8's own copy-forward
// would leave one: RIR and a rep target (both pre-chunk-19 fields), no
// targetWeight/tags at all (genuinely absent — undefined, same "doesn't
// exist yet" convention every other optional WeekPlanSet field uses).
function makeHistoricalSet(overrides: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id: 'set-1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1',
    setNumber: 1, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
    repMin: 8, repMax: 12, isAmrap: false,
    ...overrides,
  }
}

function makePlan(sets: WeekPlanSet[]): WeekPlan {
  return {
    id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1',
    weekNumber: 1, isDeload: false, notes: null, sets, exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
  }
}

const mockState: { plans: WeekPlan[] } = { plans: [] }

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [makeProgram()], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.plans, isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  // Chunk 21 - the week-level mark/unmark action's own hook.
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
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

describe('PlanPage — chunk 19 is additive: an existing RIR + rep target render unchanged, with or without weight/tags', () => {
  it('a historical set (RIR + rep target, no weight, no tags) still shows the same RIR and rep-target text', () => {
    mockState.plans = [makePlan([makeHistoricalSet()])]
    renderPlanPage()

    // The two pre-chunk-19 values — same text master always showed.
    expect(screen.getByText('RIR 2')).toBeTruthy()
    expect(screen.getByText('8–12')).toBeTruthy()
  })

  it('that same set shows no SIGN of a weight target — the one value-level placeholder, nothing more', () => {
    mockState.plans = [makePlan([makeHistoricalSet()])]
    renderPlanPage()

    // The only weight-valued text this row could show is "—" (the
    // null-weight placeholder) — never a number+unit, which would mean a
    // weight was fabricated out of nothing.
    expect(screen.getByRole('button', { name: '—' })).toBeTruthy()
    expect(screen.queryByText(/^\d+(\.\d+)?(kg|lbs)$/)).toBeNull()
  })

  it('that same set shows no tag as applied — no "apply to all" control exists for any preset (that control only ever renders on an ACTIVE tag)', () => {
    mockState.plans = [makePlan([makeHistoricalSet()])]
    renderPlanPage()

    expect(screen.queryAllByLabelText(/Apply ".*" to all sets/)).toHaveLength(0)
  })

  it('adding a weight target and a tag changes ONLY those two things — RIR and rep-target text are still the exact same strings', () => {
    mockState.plans = [makePlan([makeHistoricalSet({ targetWeight: 102.06, tags: ['push here'] })])]
    renderPlanPage()

    // Still there, still the same text — chunk 19 disturbs neither.
    expect(screen.getByText('RIR 2')).toBeTruthy()
    expect(screen.getByText('8–12')).toBeTruthy()

    // And now the two new fields genuinely show something.
    expect(screen.getByRole('button', { name: '102.06kg' })).toBeTruthy()
    expect(screen.getByLabelText('Apply "push here" to all sets')).toBeTruthy()
  })
})
