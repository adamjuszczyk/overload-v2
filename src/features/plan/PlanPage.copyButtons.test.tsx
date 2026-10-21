// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { subWeeks, format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 8 gave an empty week of a week-dependent run two buttons, COPY WEEK and COPY THIS WORKOUT, shown only when a usable earlier
// occurrence existed (not deload, not empty, planned). Chunk 52 (TASKS-1.2 "Plan's header"; SPEC Weeks and copying [1.2] → COPY (2c);
// board 1 and board 2) replaces them with one COPY under the header, which opens a sheet listing every workout of the week with the
// week its numbers come from. This file holds what is left of the old rule at the screen that applies it:
//   - the two old buttons are gone (absence, Checks that lied #32), on every week and every kind of run;
//   - COPY is on week 2 and later, not on week 1 (there is nothing before it, and numbers never come from another program; P1.2-1);
//   - a workout whose earlier occurrences are all empty, deload or missing is listed as NO EARLIER WEEK, unticked, so it is never
//     copied into (DECISIONS 42's empty skip, deload is never a source, DECISIONS 132);
//   - a stable run's sheet offers WEIGHT and RIR only (G53: the default owns a stable week's rep targets).
// What the sheet then writes is PlanPage.copySheet.test.tsx's, and the rows the writes reach PlanPage.copyWeek.storedCarry.test.tsx's.
//
// Renders the real PlanPage/WorkoutDayPanel/CopySheet component tree; only the data hooks are mocked (same seam as the render-parity
// test). Asserted by visible text and roles, not a byte-identical snapshot.

afterEach(() => cleanup())

// Week 2 of a meso that started 8 days ago — computeWeekNumber (date-fns
// differenceInCalendarWeeks, Monday-anchored) lands on week 2 for "today"
// without needing to open a tile, and isPast stays false (viewWeek ===
// currentWeek). `weekOne` is a run that started this week: its current week is 1.
const startDate = format(subWeeks(new Date(), 1), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const weekOne: Mesocycle = { ...activeMeso, startDate: format(new Date(), 'yyyy-MM-dd') }

const workoutDay: WorkoutDay = {
  id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [],
}

const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0,
  weightUnit: null,
}

function makeProgram(planningType: Program['planningType']): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program',
    schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType,
  }
}

function makePlan(weekNumber: number, opts: { isDeload?: boolean; withContent?: boolean } = {}): WeekPlan {
  return {
    id: `wp-${weekNumber}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1',
    weekNumber, isDeload: opts.isDeload ?? false, notes: null,
    sets: opts.withContent
      ? [{ id: `set-${weekNumber}`, weekPlanId: `wp-${weekNumber}`, userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false }]
      : [],
    exercises: opts.withContent ? [pe1] : [],
    createdAt: '2026-01-01T00:00:00Z',
  }
}

// mockState is read by the mocked hooks below — each test sets it before
// rendering, so one shared mock module can serve every scenario.
const mockState: { currentPlans: WeekPlan[]; allPlans: WeekPlan[]; program: Program; meso: Mesocycle } = {
  currentPlans: [],
  allPlans: [],
  program: makeProgram('week_dependent'),
  meso: activeMeso,
}

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [mockState.meso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
// Plan reads which sessions are done (useDoneWeekPlanIds); none here.
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() })) // the CHANGE THE PROGRAM button's statuses: none here
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: mockState.currentPlans, isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.allPlans, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  // Chunk 21 - the week-level mark/unmark action's own hook.
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
  // Chunk 9 — Week actions, called unconditionally by WorkoutDayPanel on
  // every render; not exercised by this file's own copy-button assertions.
}))

// Chunk 24 — this component owns its own hooks (useSessionsInRange via
// gym/useSession.ts, which needs a real QueryClientProvider this file's
// own render() doesn't set up — every other PlanPage hook is mocked away
// the same way for the same reason). Stubbed to nothing: this file's own
// job is unrelated to session-moving: MoveSessionControl.test.tsx proves
// the real component.
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
// COPY's sheet writes through its own hook (chunk 52); this file opens the sheet only to read what it lists.
vi.mock('./useCopyNumbers', () => ({ useCopyNumbers: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }) }))

const { default: PlanPage } = await import('./PlanPage')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  mockState.meso = activeMeso
})

const COPY = 'COPY'
const sheet = () => within(screen.getByRole('dialog'))
const rowOfWorkout = (name: string) => sheet().getByText(name).closest('button') as HTMLElement

describe('PlanPage — COPY replaces COPY WEEK and COPY THIS WORKOUT (chunk 52)', () => {
  it('week 2 of a week-dependent run, empty, with a usable week 1: COPY and WEEK ⋯ are the header\'s, and the two old buttons are nowhere', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: false })]
    mockState.allPlans = [makePlan(1, { withContent: true }), makePlan(2, { withContent: false })]

    const { container } = renderPlanPage()
    expect(screen.getByText(COPY)).toBeTruthy()
    expect(screen.getByLabelText('Week 2 options')).toBeTruthy()
    expect(container.textContent).not.toContain('COPY WEEK')
    expect(container.textContent).not.toContain('COPY THIS WORKOUT')
    expect(container.textContent).not.toContain('COPY LAST')
  })

  it('the old buttons are gone on a stable run, on a week with content and on a week-dependent run alike', () => {
    for (const [planningType, withContent] of [['stable', true], ['stable', false], ['week_dependent', true]] as const) {
      mockState.program = makeProgram(planningType)
      mockState.currentPlans = [makePlan(2, { withContent })]
      mockState.allPlans = [makePlan(1, { withContent: true }), makePlan(2, { withContent })]
      const { container } = renderPlanPage()
      expect(container.textContent).not.toContain('COPY WEEK')
      expect(container.textContent).not.toContain('COPY THIS WORKOUT')
      expect(screen.getByText(COPY)).toBeTruthy() // the header's one COPY, whatever the run or the week holds
      cleanup()
    }
  })

  it('week 1 has no COPY (P1.2-1: nothing is before it, and numbers never come from another program), and still has WEEK ⋯', () => {
    mockState.meso = weekOne
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(1, { withContent: true })]
    mockState.allPlans = [makePlan(1, { withContent: true })]

    renderPlanPage()
    expect(screen.getByLabelText('Week 1 options')).toBeTruthy()
    expect(screen.queryByText(COPY)).toBeNull()
  })

  it('a past week has no COPY (board 1c)', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: true })]
    mockState.allPlans = [makePlan(1, { withContent: true }), makePlan(2, { withContent: true })]
    renderPlanPage()
    fireEvent.click(screen.getByText('WEEK 1').closest('button') as HTMLButtonElement)
    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()
    expect(screen.queryByText(COPY)).toBeNull()
  })
})

describe('PlanPage — the sheet lists a workout with no usable earlier week as NO EARLIER WEEK, unticked', () => {
  function openSheet() {
    renderPlanPage()
    fireEvent.click(screen.getByText(COPY))
  }

  it('a usable week 1: the workout is ticked, from week 1, and the button counts it', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: true })]
    mockState.allPlans = [makePlan(1, { withContent: true }), makePlan(2, { withContent: true })]
    openSheet()
    expect(rowOfWorkout('Push Day').getAttribute('aria-checked')).toBe('true')
    expect(within(rowOfWorkout('Push Day')).queryByText('NO EARLIER WEEK')).toBeNull()
    expect(screen.getByText("WEEK 2 · FROM WEEK 1'S PLAN")).toBeTruthy()
  })

  it('DECISIONS 42 (b): the only earlier week was empty (not deload): empty is skipped the same as deload', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: true })]
    mockState.allPlans = [makePlan(1, { withContent: false }), makePlan(2, { withContent: true })]
    openSheet()
    expect(rowOfWorkout('Push Day').getAttribute('aria-checked')).toBe('false')
    expect(within(rowOfWorkout('Push Day')).getByText('NO EARLIER WEEK')).toBeTruthy()
    expect(sheet().getByText('PICK A WORKOUT')).toBeTruthy()
  })

  it('nothing has ever been planned for this workout before this week ("missing source")', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: true })]
    mockState.allPlans = [makePlan(2, { withContent: true })] // no week 1 at all
    openSheet()
    expect(within(rowOfWorkout('Push Day')).getByText('NO EARLIER WEEK')).toBeTruthy()
    expect(sheet().getByText('PICK A WORKOUT')).toBeTruthy()
  })

  it('the only earlier occurrence was deload (a deload session is never a copy source)', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: true })]
    mockState.allPlans = [makePlan(1, { withContent: true, isDeload: true }), makePlan(2, { withContent: true })]
    openSheet()
    expect(rowOfWorkout('Push Day').getAttribute('aria-checked')).toBe('false')
    expect(within(rowOfWorkout('Push Day')).getByText('NO EARLIER WEEK')).toBeTruthy()
    expect(sheet().getByText('PICK A WORKOUT')).toBeTruthy()
  })

  it('G53: a stable run\'s sheet offers WEIGHT and RIR and no REPS (the default owns a stable week\'s rep targets)', () => {
    mockState.program = makeProgram('stable')
    mockState.currentPlans = [makePlan(2, { withContent: true })]
    mockState.allPlans = [makePlan(1, { withContent: true }), makePlan(2, { withContent: true })]
    openSheet()
    expect(sheet().getByRole('checkbox', { name: 'WEIGHT' })).toBeTruthy()
    expect(sheet().getByRole('checkbox', { name: 'RIR' })).toBeTruthy()
    expect(sheet().queryByRole('checkbox', { name: 'REPS' })).toBeNull()
  })

  it('and a week-dependent run\'s offers all three', () => {
    mockState.program = makeProgram('week_dependent')
    mockState.currentPlans = [makePlan(2, { withContent: true })]
    mockState.allPlans = [makePlan(1, { withContent: true }), makePlan(2, { withContent: true })]
    openSheet()
    for (const name of ['WEIGHT', 'REPS', 'RIR']) expect(sheet().getByRole('checkbox', { name })).toBeTruthy()
  })
})
