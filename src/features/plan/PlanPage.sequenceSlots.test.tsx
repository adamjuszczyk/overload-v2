// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, Exercise, SequenceItem, WeekPlanSet } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import type { ChangeRecord } from './applyAhead'

// Chunk 25 review fix (first review — "a sequence run can't be planned in
// Plan, so the chunk's done-when isn't met") — Plan's own weeks view for a
// sequence run: the slot switcher, the panel matched by (workout_day_id,
// sequence_position), "Cycle n" labelling, "Mark this cycle as deload", and
// apply-ahead's own per-slot matching, all driven through the REAL PlanPage/
// WorkoutDayPanel/ExerciseSection tree (same seam every other PlanPage test
// file already uses: only the data hooks are mocked). Fixture: A, B, A, rest
// (SPEC G8, reviewer's own named shape) — cycle 1 is the viewed week,
// cycle 2's own two A occurrences already planned (its own two week_plan
// rows), so "the second A reaches the second A, not the first" and
// "apply-ahead reaches cycle 2's own A·1, not its A·3" are both provable
// against a REAL, already-ambiguous-by-workoutDayId-alone fixture, not a
// hypothetical one. Checked at 375px (this file's own beforeEach, same
// convention as every other PlanPage test file).

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const startDate = format(new Date(), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}

const workoutDayA: WorkoutDay = { id: 'wd-a', programId: 'prog-1', userId: 'user-1', name: 'Workout A', position: 0, exercises: [] }
const workoutDayB: WorkoutDay = { id: 'wd-b', programId: 'prog-1', userId: 'user-1', name: 'Workout B', position: 1, exercises: [] }

const EX_X: Exercise = {
  id: 'ex-x', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}

// A, B, A, rest — SPEC G8's own canonical repeated-workout shape, and this
// chunk's own sequenceSchedule.test.ts/scratch-R16 fixture.
const sequenceItems: SequenceItem[] = [
  { id: 'si-0', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-a' },
  { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 1, workoutDayId: 'wd-b' },
  { id: 'si-2', userId: 'user-1', programId: 'prog-1', position: 2, workoutDayId: 'wd-a' },
  { id: 'si-3', userId: 'user-1', programId: 'prog-1', position: 3, workoutDayId: null },
]

const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Sequence Program', schedule: EMPTY_SCHEDULE,
  workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  kind: 'run', planningType: 'week_dependent', scheduleType: 'sequence',
}

// Cycle 1 (the viewed week, week_number 1) — each slot its own week_plan
// row, its own week_plan_exercises row (chunk 7: "each planned session owns
// its exercise list" — a SEPARATE row per week-plan, even for the same
// workout), and its own set, so a mutate-arg assertion can tell slot 0's
// own row from slot 2's own row by id alone.
const peA0: ProgramExercise = { id: 'pe-a0-row', workoutDayId: 'wd-a', userId: 'user-1', exerciseId: 'ex-x', position: 0, weightUnit: null, exercise: EX_X }
const peB1: ProgramExercise = { id: 'pe-b1-row', workoutDayId: 'wd-b', userId: 'user-1', exerciseId: 'ex-x', position: 0, weightUnit: null, exercise: EX_X }
const peA2: ProgramExercise = { id: 'pe-a2-row', workoutDayId: 'wd-a', userId: 'user-1', exerciseId: 'ex-x', position: 0, weightUnit: null, exercise: EX_X }

function makeSet(id: string, programExerciseId: string, weekPlanId: string): WeekPlanSet {
  return {
    id, weekPlanId, userId: 'user-1', programExerciseId, setNumber: 1,
    targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null,
  }
}

const wpCycle1SlotA0: WeekPlan = {
  id: 'wp-1-a0', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 1,
  sequencePosition: 0, isDeload: false, notes: null, exercises: [peA0], sets: [makeSet('set-a0', 'pe-a0-row', 'wp-1-a0')],
  createdAt: '2026-01-01T00:00:00Z',
}
const wpCycle1SlotB1: WeekPlan = {
  id: 'wp-1-b1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-b', weekNumber: 1,
  sequencePosition: 1, isDeload: false, notes: null, exercises: [peB1], sets: [makeSet('set-b1', 'pe-b1-row', 'wp-1-b1')],
  createdAt: '2026-01-01T00:00:00Z',
}
const wpCycle1SlotA2: WeekPlan = {
  id: 'wp-1-a2', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 1,
  sequencePosition: 2, isDeload: false, notes: null, exercises: [peA2], sets: [makeSet('set-a2', 'pe-a2-row', 'wp-1-a2')],
  createdAt: '2026-01-01T00:00:00Z',
}

// Cycle 2 — already planned (both its own A slots), NOT the viewed week:
// only in allWeekPlans (the meso-wide history useAllWeekPlans/apply-ahead
// reads), never in the viewed week's own useWeekPlans list.
const wpCycle2SlotA0: WeekPlan = {
  id: 'wp-2-a0', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 2,
  sequencePosition: 0, isDeload: false, notes: null, exercises: [], sets: [], createdAt: '2026-01-01T00:00:00Z',
}
const wpCycle2SlotA2: WeekPlan = {
  id: 'wp-2-a2', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: 2,
  sequencePosition: 2, isDeload: false, notes: null, exercises: [], sets: [], createdAt: '2026-01-01T00:00:00Z',
}

const currentPlans: WeekPlan[] = [wpCycle1SlotA0, wpCycle1SlotB1, wpCycle1SlotA2]
const allPlans: WeekPlan[] = [wpCycle1SlotA0, wpCycle1SlotB1, wpCycle1SlotA2, wpCycle2SlotA0, wpCycle2SlotA2]

const updateSetMutate = vi.fn()
const setWeekDeloadMutate = vi.fn()
const useSetWeekDeloadSpy = vi.fn((_mesoId: string, _weekNumber: number) => ({ mutate: setWeekDeloadMutate, isPending: false }))
let applyAheadLastCall: { changes: ChangeRecord[]; weeks: WeekPlan[] } | null = null
const applyAheadMutate = vi.fn((vars: { changes: ChangeRecord[]; weeks: WeekPlan[] }) => {
  applyAheadLastCall = vars
})

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDayA, workoutDayB], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: sequenceItems, isLoading: false }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: currentPlans, isLoading: false }),
  useAllWeekPlans: () => ({ data: allPlans, isLoading: false }),
  useApplyAhead: () => ({ mutate: applyAheadMutate, isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: (mesoId: string, weekNumber: number) => useSetWeekDeloadSpy(mesoId, weekNumber),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

function editWeightTarget() {
  fireEvent.click(screen.getByRole('button', { name: '—' }))
  fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '100' } })
  fireEvent.blur(screen.getByLabelText('Weight target'))
}

afterEach(() => {
  updateSetMutate.mockClear()
  setWeekDeloadMutate.mockClear()
  useSetWeekDeloadSpy.mockClear()
  applyAheadMutate.mockClear()
  applyAheadLastCall = null
})

describe('PlanPage — sequence runs\' own Weeks view (chunk 25 review fix)', () => {
  it('the switcher shows 3 workout slots (A, B, A) plus the one rest slot, non-selectable', () => {
    renderPlanPage()
    const switcher = within(screen.getByRole('region', { name: 'Sequence slot switcher' }))

    expect(switcher.getAllByText('Workout A')).toHaveLength(2) // slots 0 and 2
    expect(switcher.getByText('Workout B')).toBeTruthy() // slot 1
    expect(switcher.getByText('REST DAY')).toBeTruthy() // slot 3 — shown, not omitted
    const restChip = switcher.getByText('REST DAY').closest('button') as HTMLButtonElement
    expect(restChip.disabled).toBe(true)
  })

  it('the week stepper reads CYCLE, not WEEK, for a sequence run', () => {
    renderPlanPage()
    expect(screen.getByText('CYCLE 1')).toBeTruthy()
    expect(screen.queryByText('WEEK 1')).toBeNull()
  })

  it('choosing the second A (slot 3, position 2) edits THAT row, not the first A\'s (position 0) — asserted by the exact set id handed to useUpdateSet', () => {
    renderPlanPage()

    fireEvent.click(screen.getByText('SLOT 3')) // the second A, 1-based display of position 2
    editWeightTarget()

    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    const call = updateSetMutate.mock.calls[0][0] as { id: string; changes: unknown }
    expect(call.id).toBe('set-a2') // slot 2's own set — never set-a0's
  })

  it('choosing the first A (the default-selected slot) edits ITS OWN row, not the second A\'s', () => {
    renderPlanPage()

    editWeightTarget() // slot 0 (SLOT 1) is selected by default — the first workout-bearing slot

    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    const call = updateSetMutate.mock.calls[0][0] as { id: string; changes: unknown }
    expect(call.id).toBe('set-a0')
  })

  it('"Mark this cycle as deload" calls useSetWeekDeload with (mesoId, cycle), and the label reads CYCLE not WEEK', () => {
    renderPlanPage()

    expect(screen.getByText('MARK CYCLE AS DELOAD')).toBeTruthy()
    expect(screen.queryByText('MARK WEEK AS DELOAD')).toBeNull()
    expect(useSetWeekDeloadSpy).toHaveBeenCalledWith('meso-1', 1)

    fireEvent.click(screen.getByText('MARK CYCLE AS DELOAD'))
    expect(setWeekDeloadMutate).toHaveBeenCalledTimes(1)
    const call = setWeekDeloadMutate.mock.calls[0][0] as { isDeload: boolean }
    expect(call.isDeload).toBe(true)
  })

  it('apply-ahead from cycle 1\'s A·1 (slot 0) reaches cycle 2\'s own A·1 (slot 0) ONLY — never cycle 2\'s A·3 (slot 2)', () => {
    renderPlanPage()

    editWeightTarget() // slot 0 (the default-selected first A) is edited

    expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()
    fireEvent.click(screen.getByText('APPLY'))
    expect(applyAheadLastCall).not.toBeNull()
    expect(applyAheadLastCall!.weeks.map((w) => w.id)).toEqual(['wp-2-a0'])
  })

  it('apply-ahead from cycle 1\'s A·3 (slot 2) reaches cycle 2\'s own A·3 (slot 2) ONLY — never cycle 2\'s A·1 (slot 0)', () => {
    renderPlanPage()

    fireEvent.click(screen.getByText('SLOT 3'))
    editWeightTarget()

    expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()
    fireEvent.click(screen.getByText('APPLY'))
    expect(applyAheadLastCall).not.toBeNull()
    expect(applyAheadLastCall!.weeks.map((w) => w.id)).toEqual(['wp-2-a2'])
  })
})
