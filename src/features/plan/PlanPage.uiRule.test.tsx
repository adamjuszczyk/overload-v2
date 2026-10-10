// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 15 (SPEC "Warmup sets" — "the week plan offer[s] warmup sets"):
// PlanSetGroup's WARMUP chip, head-only and mutually exclusive with
// staging (same posture as StepVolume.tsx's own, one layer up — the
// program's own sets). Same mocking recipe as PlanPage.stageKind.test.tsx.

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

function makeSet(overrides: Partial<WeekPlanSet>): WeekPlanSet {
  return {
    id: 'set-1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1',
    setNumber: 1, targetRir: null, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
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
const updateSetMutate = vi.fn()
const addWarmupMutate = vi.fn()
const removeSetMutate = vi.fn()

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
  // Chunk 21 - the week-level mark/unmark action's own hook.
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: addWarmupMutate, isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: removeSetMutate, isPending: false }),
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
const { openSetMenu } = await import('./planMenus.testutil')

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

describe('PlanPage — a plain week shows only set rows with three numbers each (standing UI rule, 2026-10-10)', () => {
  function plainWeek() {
    return makePlan([
      makeSet({ id: 's1', setNumber: 1, targetRir: 2, targetWeight: 100, repMin: 8, repMax: 12 }),
      makeSet({ id: 's2', setNumber: 2, targetRir: 2, targetWeight: 100, repMin: 8, repMax: 12 }),
      makeSet({ id: 's3', setNumber: 3, targetRir: 1 }),
    ])
  }

  it('each set row is: number, weight, reps, RIR, and one ⋯ — nothing else', () => {
    mockState.plans = [plainWeek()]
    renderPlanPage()

    const menuButtons = screen.getAllByLabelText(/^Options for set /)
    expect(menuButtons).toHaveLength(3)
    menuButtons.forEach((menuBtn, i) => {
      const row = menuBtn.parentElement as HTMLElement
      // Buttons in a row: weight, reps, RIR minus, RIR plus, ⋯.
      expect(row.querySelectorAll('button')).toHaveLength(5)
      expect(row.querySelector('input')).toBeNull()
      // The row's whole text: number, weight, ×, reps, RIR value — and no
      // label, chip, placeholder or marker.
      const text = (row.textContent ?? '').replace(/\s+/g, ' ').trim()
      const expected = [
        '01100kg × 8–12 − RIR 2 +'.replace(/\s/g, ''),
        '02100kg × 8–12 − RIR 2 +'.replace(/\s/g, ''),
        '03— × — − RIR 1 +'.replace(/\s/g, ''),
      ][i]
      expect(text.replace(/\s/g, '')).toBe(expected)
    })
  })

  it('no kind, tag, warmup, stage, rest, swap, reorder, remove or delete control is on the page until a ⋯ is opened', () => {
    mockState.plans = [plainWeek()]
    renderPlanPage()
    const text = document.body.textContent ?? ''
    for (const word of ['WARMUP', 'DROPSET', 'REST-PAUSE', 'MYO', 'CLUSTER', 'STAGE', 'TAGS', 'CUSTOM', 'SET KIND', 'REST', 'SWAP', 'MOVE', 'DELETE', 'REMOVE FROM']) {
      expect(text).not.toContain(word)
    }
    expect(screen.queryByLabelText(/^Swap /)).toBeNull()
    expect(screen.queryByLabelText('Move up')).toBeNull()
    expect(screen.queryByLabelText('Add warmup sets')).toBeNull()
    expect(document.body.querySelectorAll('svg.lucide-trash2')).toHaveLength(0)
  })

  it('reps are editable per set, right on the row', () => {
    updateSetMutate.mockClear()
    mockState.plans = [plainWeek()]
    renderPlanPage()

    fireEvent.click(screen.getAllByText('8–12')[0])
    const input = screen.getByLabelText('Rep target')
    fireEvent.change(input, { target: { value: '6-8' } })
    fireEvent.blur(input)

    expect(updateSetMutate).toHaveBeenCalledWith({ id: 's1', changes: { repMin: 6, repMax: 8, isAmrap: false } })
  })

  it('a set\'s ⋯ holds set kind (add stage), tags and delete — and delete removes that set', () => {
    removeSetMutate.mockClear()
    mockState.plans = [plainWeek()]
    renderPlanPage()

    openSetMenu(2)
    expect(screen.getByLabelText('Add stage')).toBeTruthy()
    expect(screen.getByText('TAGS')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Delete set'))

    expect(removeSetMutate).toHaveBeenCalledWith('s2')
    // Closed again after the action.
    expect(screen.queryByText('TAGS')).toBeNull()
  })
})
