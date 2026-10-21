// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise, MuscleGroup } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 54a (TASKS-1.2 "Plan's week view: exercise cards and set rows on the pickers"; SPEC Screens → Plan screen: "'+ ADD SET' adds a Normal
// set with the previous set's rep target and no weight or RIR (Defaults, 8)"; Removals: REMOVE THIS SET removes the set, its stages first).
// The two writers that make or remove a set's row, through the real PlanPage tree with the data hooks mocked (the seam every PlanPage test
// file uses). What each one reaches the hooks with is asserted; PlanPage.setWrites.e2e.test.tsx runs the same two over a database
// stand-in that checks them.
//
//   + ADD SET        useAddSet({ weekPlanId, programExerciseId, setNumber, defaults }): the week's own plan row for the workout, the exercise
//                    of the card whose "+" it was, the next head number, and addSetDefaults (a Normal set; the last set's rep target;
//                    weight, RIR and RIR range null). Break proofs (the report): copy the last set's weight; number the new set by
//                    the head count; write the new set to the first card's exercise.
//   REMOVE THIS SET  useRemoveSet(id) once per row, the stage rows from the highest stage index first, then the head. Break proof: send
//                    the head alone (relying on the cascade).

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// ─── Fixture ──────────────────────────────────────────────────────────────────

// A meso that started a week ago, so the viewed (current) week is week 2.
const startDate = format(subWeeks(new Date(), 1), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

const ex = (id: string, name: string, muscleGroup: MuscleGroup): Exercise => ({
  id, userId: 'user-1', name, muscleGroup, isArchived: false, createdAt: '', muscleSubgroups: null,
  movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
})
const pe = (id: string, exercise: Exercise, position: number, over: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id, workoutDayId: 'wd-1', userId: 'user-1', exerciseId: exercise.id, position, weightUnit: null, exercise, ...over,
})
const PE_BENCH = pe('pe-bench', ex('ex-bench', 'Bench Press', 'chest'), 0)
const PE_SQUAT = pe('pe-squat', ex('ex-squat', 'Squat', 'quads'), 1)

function setRow(over: Partial<WeekPlanSet>): WeekPlanSet {
  return {
    id: 'x', weekPlanId: 'wp-2', userId: 'user-1', programExerciseId: 'pe-bench', setNumber: 1, targetRir: 2,
    isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null, ...over,
  }
}

function plan(sets: WeekPlanSet[], exercises: ProgramExercise[], over: Partial<WeekPlan> = {}): WeekPlan {
  return {
    id: 'wp-2', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2,
    isDeload: false, notes: null, sets, exercises, createdAt: '2026-01-01T00:00:00Z', ...over,
  }
}

const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' }, workoutDays: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent',
}

const mockState: { all: WeekPlan[] } = { all: [] }
// What the mocked mutations report: `isPending` and `variables` are what the cards disable themselves on while a write is out.
const pending: { add: boolean; addVariables: { programExerciseId: string } | undefined; remove: boolean } = { add: false, addVariables: undefined, remove: false }
const addSetMutate = vi.fn()
const removeSetMutate = vi.fn()
const updateSetMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined })) // the week view's session states (chunk 54b): none here
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: mockState.all.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.all, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: addSetMutate, isPending: pending.add, variables: pending.addVariables }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: removeSetMutate, isPending: pending.remove }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')
const { openSetMenu } = await import('./planMenus.testutil')

afterEach(() => {
  mockState.all = []
  pending.add = false
  pending.addVariables = undefined
  pending.remove = false
  addSetMutate.mockClear()
  removeSetMutate.mockClear()
  updateSetMutate.mockClear()
})

function arrange(sets: WeekPlanSet[], exercises: ProgramExercise[] = [PE_BENCH], over: Partial<WeekPlan> = {}) {
  mockState.all = [plan(sets, exercises, over)]
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

const cardOf = (name: string) => screen.getByText(name).closest('[data-exercise-card]') as HTMLElement
const NORMAL_NO_NUMBERS = { isWarmup: false, stageKind: null, isAmrap: false, targetWeight: null, targetRir: null, targetRirMax: null }

// ─── + ADD SET ────────────────────────────────────────────────────────────────

describe('PlanPage — "+ ADD SET" adds a Normal set with the previous set\'s rep target and no weight or RIR (SPEC Defaults 8)', () => {
  it('writes this week\'s plan row, the card\'s exercise, the next head number and the defaults — the last set\'s reps, null weight, null RIR', () => {
    arrange([
      setRow({ id: 'a', setNumber: 1, targetWeight: 100, repMin: 8, repMax: 12, targetRir: 2 }),
      setRow({ id: 'b', setNumber: 2, targetWeight: 110, repMin: 6, repMax: 6, targetRir: 1 }),
    ])

    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))

    expect(addSetMutate).toHaveBeenCalledTimes(1)
    expect(addSetMutate).toHaveBeenCalledWith({
      weekPlanId: 'wp-2',
      programExerciseId: 'pe-bench',
      setNumber: 3,
      defaults: { ...NORMAL_NO_NUMBERS, repMin: 6, repMax: 6 }, // the LAST set's 6, not the first's 8–12; no weight 110, no RIR 1
    })
  })

  it('the next head number is one past the highest head number: stage rows do not count, and a gap is not filled by a repeat', () => {
    // Heads 1, 2 (with two stages sharing the number 2) and 4: three heads, five rows. The new set is 5, not 4 (the head count + 1) and not 3.
    arrange([
      setRow({ id: 'a', setNumber: 1 }),
      setRow({ id: 'b', setNumber: 2, stageKind: 'dropset' }),
      setRow({ id: 'b1', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'b', stageIndex: 1 }),
      setRow({ id: 'b2', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'b', stageIndex: 2 }),
      setRow({ id: 'd', setNumber: 4 }),
    ])

    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))

    expect(addSetMutate).toHaveBeenCalledTimes(1)
    expect((addSetMutate.mock.calls[0][0] as { setNumber: number }).setNumber).toBe(5)
  })

  it('takes its rep target from the head with the highest number, whatever order the rows come in — and a stage row never lends its own', () => {
    arrange([
      setRow({ id: 'stage', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'b', stageIndex: 1, repMin: 12, repMax: 12 }),
      setRow({ id: 'b', setNumber: 2, stageKind: 'dropset', repMin: 5, repMax: 5 }),
      setRow({ id: 'a', setNumber: 1, repMin: 10, repMax: 10 }),
    ])

    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))

    expect(addSetMutate.mock.calls[0][0]).toMatchObject({ setNumber: 3, defaults: { repMin: 5, repMax: 5 } })
  })

  it('an AMRAP last set gives an AMRAP set; a last set with no target gives none; an exercise with no set yet gets set 1 with none', () => {
    arrange([setRow({ id: 'a', setNumber: 1, repMin: null, repMax: null, isAmrap: true, targetRir: 0 })])
    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    expect(addSetMutate.mock.calls[0][0]).toMatchObject({ setNumber: 2, defaults: { ...NORMAL_NO_NUMBERS, repMin: null, repMax: null, isAmrap: true } })
    cleanup()
    addSetMutate.mockClear()

    arrange([setRow({ id: 'a', setNumber: 1 })])
    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    expect(addSetMutate.mock.calls[0][0]).toMatchObject({ setNumber: 2, defaults: { ...NORMAL_NO_NUMBERS, repMin: null, repMax: null } })
    cleanup()
    addSetMutate.mockClear()

    arrange([], [PE_BENCH])
    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    expect(addSetMutate.mock.calls[0][0]).toEqual({
      weekPlanId: 'wp-2', programExerciseId: 'pe-bench', setNumber: 1, defaults: { ...NORMAL_NO_NUMBERS, repMin: null, repMax: null },
    })
  })

  it('a warmup as the last set lends its rep target too (the previous set is the previous set), and the new set is a working one', () => {
    arrange([setRow({ id: 'a', setNumber: 1, repMin: 8, repMax: 8 }), setRow({ id: 'w', setNumber: 2, isWarmup: true, repMin: 15, repMax: 15, targetRir: null })])
    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    expect(addSetMutate.mock.calls[0][0]).toMatchObject({ setNumber: 3, defaults: { isWarmup: false, repMin: 15, repMax: 15 } })
  })

  it('each exercise\'s "+" writes that exercise\'s own row and numbers its own sets (set numbers repeat across exercises)', () => {
    arrange(
      [
        setRow({ id: 'a1', setNumber: 1, repMin: 8, repMax: 8 }), setRow({ id: 'a2', setNumber: 2, repMin: 8, repMax: 8 }),
        setRow({ id: 'q1', programExerciseId: 'pe-squat', setNumber: 1, repMin: 5, repMax: 5 }),
      ],
      [PE_BENCH, PE_SQUAT],
    )

    fireEvent.click(screen.getByLabelText('Add set to Squat'))
    expect(addSetMutate).toHaveBeenLastCalledWith({ weekPlanId: 'wp-2', programExerciseId: 'pe-squat', setNumber: 2, defaults: { ...NORMAL_NO_NUMBERS, repMin: 5, repMax: 5 } })
    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    expect(addSetMutate).toHaveBeenLastCalledWith({ weekPlanId: 'wp-2', programExerciseId: 'pe-bench', setNumber: 3, defaults: { ...NORMAL_NO_NUMBERS, repMin: 8, repMax: 8 } })
  })

  it('each member of a superset has its own "+", writing its own row (a layout change keeps every per-item action)', () => {
    const benchInBlock = { ...PE_BENCH, supersetBlockId: 'blk-1' }
    const squatInBlock = { ...PE_SQUAT, supersetBlockId: 'blk-1' }
    arrange(
      [setRow({ id: 'a1', setNumber: 1 }), setRow({ id: 'q1', programExerciseId: 'pe-squat', setNumber: 1 })],
      [benchInBlock, squatInBlock],
    )
    expect(screen.getAllByText(/SUPERSET/)).toHaveLength(2)

    fireEvent.click(screen.getByLabelText('Add set to Squat'))
    expect(addSetMutate).toHaveBeenLastCalledWith(expect.objectContaining({ programExerciseId: 'pe-squat', setNumber: 2 }))
    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    expect(addSetMutate).toHaveBeenLastCalledWith(expect.objectContaining({ programExerciseId: 'pe-bench', setNumber: 2 }))
  })

  it('while an add is out, that card\'s "+" is disabled and says so (board 9: ADDING A SET), and so is every other card\'s — the rows they would count are not read again yet', () => {
    pending.add = true
    pending.addVariables = { programExerciseId: 'pe-squat' }
    arrange([setRow({ id: 'a1', setNumber: 1 }), setRow({ id: 'q1', programExerciseId: 'pe-squat', setNumber: 1 })], [PE_BENCH, PE_SQUAT])

    const adding = screen.getByLabelText('Adding a set to Squat') as HTMLButtonElement
    expect(adding.disabled).toBe(true)
    const other = screen.getByLabelText('Add set to Bench Press') as HTMLButtonElement
    expect(other.disabled).toBe(true)
    fireEvent.click(adding)
    fireEvent.click(other)
    expect(addSetMutate).not.toHaveBeenCalled()
  })

  it('while a removal is out the "+" waits too (a number counted now would be one the removal is about to free)', () => {
    pending.remove = true
    arrange([setRow({ id: 'a1', setNumber: 1 })])
    const plus = screen.getByLabelText('Add set to Bench Press') as HTMLButtonElement
    expect(plus.disabled).toBe(true)
    fireEvent.click(plus)
    expect(addSetMutate).not.toHaveBeenCalled()
  })

  it('writes nothing to the sets already there (no loose update beside the add)', () => {
    arrange([setRow({ id: 'a', setNumber: 1, targetWeight: 100, repMin: 8, repMax: 8 })])
    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    expect(updateSetMutate).not.toHaveBeenCalled()
    expect(removeSetMutate).not.toHaveBeenCalled()
  })
})

// ─── REMOVE THIS SET ──────────────────────────────────────────────────────────

describe('PlanPage — REMOVE THIS SET removes the set, its stages first (SPEC Removals; G55)', () => {
  const remove = (setNumber: number) => {
    openSetMenu(setNumber)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'What is this set?' })).getByText('REMOVE THIS SET'))
  }

  it('a plain set: one removal, of that set; the picker closes', () => {
    arrange([setRow({ id: 'a', setNumber: 1 }), setRow({ id: 'b', setNumber: 2 })])

    remove(2)

    expect(removeSetMutate.mock.calls).toEqual([['b']])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a staged set: its stage rows from the highest stage index first, then the head, one removal each, in that order', () => {
    arrange([
      setRow({ id: 'a', setNumber: 1 }),
      setRow({ id: 'b', setNumber: 2, stageKind: 'dropset' }),
      setRow({ id: 'b1', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'b', stageIndex: 1 }),
      setRow({ id: 'b3', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'b', stageIndex: 3 }),
      setRow({ id: 'b2', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'b', stageIndex: 2 }),
    ])

    remove(2)

    expect(removeSetMutate.mock.calls).toEqual([['b3'], ['b2'], ['b1'], ['b']])
  })

  it('a warmup: that warmup alone', () => {
    arrange([setRow({ id: 'w', setNumber: 1, isWarmup: true, targetRir: null }), setRow({ id: 'a', setNumber: 2 })])

    fireEvent.click(screen.getByLabelText('Options for warmup set 1')) // the working set after it is "set 1"
    fireEvent.click(within(screen.getByRole('dialog', { name: 'What is this set?' })).getByText('REMOVE THIS SET'))

    expect(removeSetMutate.mock.calls).toEqual([['w']])
  })

  it('the second exercise\'s set removes that exercise\'s own set, not the first exercise\'s set of the same number', () => {
    arrange(
      [setRow({ id: 'a1', setNumber: 1 }), setRow({ id: 'q1', programExerciseId: 'pe-squat', setNumber: 1 })],
      [PE_BENCH, PE_SQUAT],
    )

    fireEvent.click(within(cardOf('Squat')).getByLabelText('Options for set 1'))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'What is this set?' })).getByText('REMOVE THIS SET'))

    expect(removeSetMutate.mock.calls).toEqual([['q1']])
  })

  it('removes no set of the card\'s other sets and writes no update beside it', () => {
    arrange([setRow({ id: 'a', setNumber: 1 }), setRow({ id: 'b', setNumber: 2 })])
    remove(1)
    expect(removeSetMutate.mock.calls.map(([id]) => id)).toEqual(['a'])
    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('the removal button is not on the page until a ⋯ is opened, and not on a stage row (it has no ⋯, G55)', () => {
    arrange([
      setRow({ id: 'b', setNumber: 1, stageKind: 'dropset' }),
      setRow({ id: 'b1', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'b', stageIndex: 1 }),
    ])
    expect(screen.queryByText('REMOVE THIS SET')).toBeNull()
    const stageRow = screen.getByText('↳').parentElement as HTMLElement
    expect(within(stageRow).queryByLabelText(/^Options for /)).toBeNull()
    expect(screen.getAllByLabelText(/^Options for /)).toHaveLength(1)
  })
})
