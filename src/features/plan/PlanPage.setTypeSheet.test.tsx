// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, subWeeks } from 'date-fns'
import type { Mesocycle, Program, ProgramSet, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise, PlanningType } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 54a (TASKS-1.2 "Plan's week view": "⋯ on a head → SetTypePicker (`plan-week-dependent` / `plan-stable` context, `canEditRest` by G45's
// own-program-set rule; its Cues row → CuesSheet; REMOVE THIS SET ...)"; "the rest row appears in the picker only on a week-dependent run and
// only for a set with an own program set, and writes the run copy's program set named by `program_set_id` (fixture: a week set whose
// `program_set_id` belongs to another exercise row → no rest row; break: show it → fails); the picker's write goes to the week set, never to
// the program set (absence on the program-set service, except the rest row)"; SPEC Rest [1.2]: the picker's rest row, week-dependent only
// (G45 c)). The set type picker as the week view hosts it: which rows it draws, what each tap writes and to what, through the real PlanPage
// tree with the data hooks mocked (the seam every PlanPage test file uses).
//
// The fixture tells the right data source from the wrong one: two exercise rows each have a program set; the week set names one of them.
// A rest row that read "the program sets of the workout" or "the first program set" would find a program set for the wrong row.
//
// Break proofs (the report): canEditRest from "the exercise has any program set"; the rest write going to the first program set read; the
// stable context given the rest rows; a type pick written through the program-set services.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const startDate = format(subWeeks(new Date(), 1), 'yyyy-MM-dd')
const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const EX_BENCH: Exercise = {
  id: 'ex-bench', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '',
  muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
const PE_BENCH: ProgramExercise = { id: 'pe-bench', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-bench', position: 0, weightUnit: null, exercise: EX_BENCH }
const PE_ROW: ProgramExercise = { ...PE_BENCH, id: 'pe-row', position: 1, exercise: { ...EX_BENCH, id: 'ex-row', name: 'Row', muscleGroup: 'back' } }

const pset = (id: string, programExerciseId: string, over: Partial<ProgramSet> = {}): ProgramSet => ({
  id, userId: 'user-1', programExerciseId, position: 0, isWarmup: false, stageKind: null, stageRestSeconds: null,
  parentProgramSetId: null, stageIndex: 0, repMin: 8, repMax: 8, isAmrap: false, restSeconds: null, createdAt: '', ...over,
})
function setRow(over: Partial<WeekPlanSet>): WeekPlanSet {
  return {
    id: 'x', weekPlanId: 'wp-2', userId: 'user-1', programExerciseId: 'pe-bench', setNumber: 1, targetRir: 2,
    isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null, ...over,
  }
}
const program = (planningType: PlanningType): Program => ({
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' }, workoutDays: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType,
})

const mockState: { all: WeekPlan[]; planningType: PlanningType; programSets: ProgramSet[]; changePending: boolean } = {
  all: [], planningType: 'week_dependent', programSets: [], changePending: false,
}
const programSetReads: string[][] = []
const changeTypeMutate = vi.fn()
const updateSetMutate = vi.fn()
const removeSetMutate = vi.fn()
const updateRestMutate = vi.fn()
const updateStageRestMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program(mockState.planningType)], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  useProgramSets: (ids: string[]) => {
    programSetReads.push(ids)
    return { data: mockState.programSets.filter((ps) => ids.includes(ps.programExerciseId)) }
  },
  useUpdateProgramSetRest: () => ({ mutate: updateRestMutate }),
  useUpdateProgramSetStageRest: () => ({ mutate: updateStageRestMutate }),
}))
vi.mock('./useReview', () => ({ useReview: () => ({ status: 'ready', groups: [], count: 0, error: null }) })) // REVIEW's line (chunk 56): nothing differed here
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
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: removeSetMutate, isPending: false }),
  useChangeSetType: () => ({ mutate: changeTypeMutate, isPending: mockState.changePending }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')
const { openSetMenu } = await import('./planMenus.testutil')

afterEach(() => {
  mockState.all = []
  mockState.planningType = 'week_dependent'
  mockState.programSets = []
  mockState.changePending = false
  programSetReads.length = 0
  for (const mock of [changeTypeMutate, updateSetMutate, removeSetMutate, updateRestMutate, updateStageRestMutate]) mock.mockClear()
})

function arrange(sets: WeekPlanSet[], exercises: ProgramExercise[] = [PE_BENCH]) {
  mockState.all = [{
    id: 'wp-2', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2,
    isDeload: false, notes: null, sets, exercises, createdAt: '2026-01-01T00:00:00Z',
  }]
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

const picker = () => within(screen.getByRole('dialog', { name: 'What is this set?' }))
const kind = (name: string) => picker().getByRole('button', { name: new RegExp(`^${name}`) })
const restAfterRow = () => picker().queryByText('Rest after this set')
const restBetweenRow = () => picker().queryByText('REST BETWEEN')

// ─── Which rows the picker draws, by run and by program set (G45 c) ───────────

describe('PlanPage — the set type picker\'s rest rows: a week-dependent run, a set with a program set of its own (G45 c)', () => {
  // Two exercise rows, each with its own program set; the week sets name theirs.
  const programSets = () => [pset('ps-bench', 'pe-bench', { restSeconds: 90 }), pset('ps-row', 'pe-row', { restSeconds: 45 })]

  it('draws "Rest after this set" for a set that names its own exercise row\'s program set, showing that program set\'s rest', () => {
    mockState.programSets = programSets()
    arrange([setRow({ id: 'a', setNumber: 1, programSetId: 'ps-bench' })])

    openSetMenu(1)

    expect(restAfterRow()).toBeTruthy()
    expect(picker().getByText('1:30')).toBeTruthy()
    expect(restBetweenRow()).toBeNull() // a plain set has no stages to rest between
  })

  it('writes the program set the week set NAMES — not the first program set read, not another row\'s (fixture: Row\'s program set is listed first)', () => {
    mockState.programSets = [pset('ps-row', 'pe-row', { restSeconds: 45 }), pset('ps-bench', 'pe-bench', { restSeconds: 90 })]
    arrange(
      [setRow({ id: 'a', setNumber: 1, programSetId: 'ps-bench' }), setRow({ id: 'r', programExerciseId: 'pe-row', setNumber: 1, programSetId: 'ps-row' })],
      [PE_BENCH, PE_ROW],
    )

    fireEvent.click(within(screen.getByText('Row').closest('[data-exercise-card]') as HTMLElement).getByLabelText('Options for set 1'))
    fireEvent.click(picker().getByRole('button', { name: 'Rest after this set: more' }))
    expect(updateRestMutate.mock.calls).toEqual([[{ id: 'ps-row', restSeconds: 60 }]])
    fireEvent.click(screen.getByLabelText('Close'))

    updateRestMutate.mockClear()
    fireEvent.click(within(screen.getByText('Bench Press').closest('[data-exercise-card]') as HTMLElement).getByLabelText('Options for set 1'))
    fireEvent.click(picker().getByRole('button', { name: 'Rest after this set: less' }))
    expect(updateRestMutate.mock.calls).toEqual([[{ id: 'ps-bench', restSeconds: 75 }]])
  })

  it('an exercise with two program sets: the rest shown and written is the one the week set NAMES, not the first the read returned', () => {
    mockState.programSets = [pset('ps-bench-1', 'pe-bench', { position: 0, restSeconds: 60 }), pset('ps-bench-2', 'pe-bench', { position: 1, restSeconds: 90 })]
    arrange([setRow({ id: 'a', setNumber: 1, programSetId: 'ps-bench-1' }), setRow({ id: 'b', setNumber: 2, programSetId: 'ps-bench-2' })])

    openSetMenu(2) // the second set names the second program set
    expect(picker().getByText('1:30')).toBeTruthy()
    fireEvent.click(picker().getByRole('button', { name: 'Rest after this set: more' }))
    expect(updateRestMutate.mock.calls).toEqual([[{ id: 'ps-bench-2', restSeconds: 105 }]])
    fireEvent.click(screen.getByLabelText('Close'))

    updateRestMutate.mockClear()
    openSetMenu(1)
    expect(picker().getByText('1:00')).toBeTruthy()
    fireEvent.click(picker().getByRole('button', { name: 'Rest after this set: less' }))
    expect(updateRestMutate.mock.calls).toEqual([[{ id: 'ps-bench-1', restSeconds: 45 }]])
  })

  it('does NOT draw it for a set whose program set belongs to another exercise row (the fixture: Bench Press\'s week set naming Row\'s program set)', () => {
    mockState.programSets = programSets()
    arrange([setRow({ id: 'a', setNumber: 1, programSetId: 'ps-row' })], [PE_BENCH])
    // The program sets of the card's exercise are read for it; Row's is not among them, and a set is not given another row's rest.
    openSetMenu(1)

    expect(restAfterRow()).toBeNull()
    expect(picker().queryByRole('button', { name: /^Rest after this set/ })).toBeNull()
  })

  it('does NOT draw it when the week set names no program set (a set added in the week), nor when it names one that was not read', () => {
    mockState.programSets = programSets()
    arrange([setRow({ id: 'a', setNumber: 1, programSetId: null }), setRow({ id: 'b', setNumber: 2, programSetId: 'ps-gone' })])

    openSetMenu(1)
    expect(restAfterRow()).toBeNull()
    fireEvent.click(screen.getByLabelText('Close'))
    openSetMenu(2)
    expect(restAfterRow()).toBeNull()
  })

  it('a staged set with its own program set also draws REST BETWEEN, writing that program set\'s stage rest — and no week write', () => {
    mockState.programSets = [pset('ps-bench', 'pe-bench', { restSeconds: 90, stageKind: 'dropset' })]
    arrange([
      setRow({ id: 'h', setNumber: 1, stageKind: 'dropset', programSetId: 'ps-bench' }),
      setRow({ id: 'h1', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'h', stageIndex: 1 }),
    ])

    openSetMenu(1)
    expect(restBetweenRow()).toBeTruthy()
    expect(picker().getByText('NO TIMER')).toBeTruthy() // a dropset's own default
    fireEvent.click(picker().getByRole('button', { name: 'Rest between: more' }))

    expect(updateStageRestMutate.mock.calls).toEqual([[{ id: 'ps-bench', stageRestSeconds: 15 }]])
    expect(changeTypeMutate).not.toHaveBeenCalled() // the stage rows and the head's kind are unchanged
    expect(updateRestMutate).not.toHaveBeenCalled()
  })

  it('an exercise with two program sets: REST BETWEEN is written to the one the staged week set NAMES, not the first the read returned', () => {
    mockState.programSets = [pset('ps-bench-1', 'pe-bench', { position: 0, restSeconds: 60 }), pset('ps-bench-2', 'pe-bench', { position: 1, restSeconds: 90, stageKind: 'dropset' })]
    arrange([
      setRow({ id: 'a', setNumber: 1, programSetId: 'ps-bench-1' }),
      setRow({ id: 'h', setNumber: 2, stageKind: 'dropset', programSetId: 'ps-bench-2' }),
      setRow({ id: 'h1', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'h', stageIndex: 1 }),
    ])

    openSetMenu(2) // the staged set
    fireEvent.click(picker().getByRole('button', { name: 'Rest between: more' }))

    expect(updateStageRestMutate.mock.calls).toEqual([[{ id: 'ps-bench-2', stageRestSeconds: 15 }]])
  })

  it('a staged set without a program set of its own has no REST BETWEEN either (nowhere to write it)', () => {
    mockState.programSets = programSets()
    arrange([
      setRow({ id: 'h', setNumber: 1, stageKind: 'dropset', programSetId: 'ps-row' }),
      setRow({ id: 'h1', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'h', stageIndex: 1 }),
    ])
    openSetMenu(1)
    expect(restBetweenRow()).toBeNull()
    expect(restAfterRow()).toBeNull()
    expect(picker().getByText('DROPS')).toBeTruthy() // the stage stepper is the week's, and stays
  })

  it('reads the program sets of the card\'s exercise only when a picker is opened, and only for that exercise', () => {
    mockState.programSets = programSets()
    arrange([setRow({ id: 'a', setNumber: 1, programSetId: 'ps-bench' }), setRow({ id: 'r', programExerciseId: 'pe-row', setNumber: 1, programSetId: 'ps-row' })], [PE_BENCH, PE_ROW])
    expect(programSetReads.filter((ids) => ids.includes('pe-bench') && ids.length === 1)).toHaveLength(0) // nothing is read for a closed picker

    fireEvent.click(within(screen.getByText('Bench Press').closest('[data-exercise-card]') as HTMLElement).getByLabelText('Options for set 1'))
    expect(programSetReads).toContainEqual(['pe-bench'])
    expect(programSetReads).not.toContainEqual(['pe-row'])
  })
})

describe('PlanPage — a stable run\'s picker has no rest rows at all (SPEC Rest: the rest of a stable week is CHANGE THE PROGRAM\'s)', () => {
  it('even for a set that names its own program set, and it reads no program sets for it', () => {
    mockState.planningType = 'stable'
    mockState.programSets = [pset('ps-bench', 'pe-bench', { restSeconds: 90 })]
    arrange([
      setRow({ id: 'h', setNumber: 1, stageKind: 'dropset', programSetId: 'ps-bench' }),
      setRow({ id: 'h1', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'h', stageIndex: 1 }),
    ])

    openSetMenu(1)

    expect(restAfterRow()).toBeNull()
    expect(restBetweenRow()).toBeNull()
    expect(picker().getByText('DROPS')).toBeTruthy() // the kind and its stepper are there
    expect(picker().getByText('Cues')).toBeTruthy()
    expect(picker().getByText('REMOVE THIS SET')).toBeTruthy()
    expect(programSetReads).toHaveLength(0)
  })

  it('writes the same week writes as a week-dependent run\'s picker (a kind pick is the week set\'s either way)', () => {
    mockState.planningType = 'stable'
    arrange([setRow({ id: 'a', setNumber: 1 })])
    openSetMenu(1)
    fireEvent.click(kind('Cluster'))
    expect(changeTypeMutate).toHaveBeenCalledTimes(1)
    expect(changeTypeMutate.mock.calls[0][0]).toEqual({
      ops: [
        { kind: 'updateHead', id: 'a', changes: { stageKind: 'cluster' } },
        { kind: 'addStage', weekPlanId: 'wp-2', programExerciseId: 'pe-bench', parentId: 'a', setNumber: 1, stageIndex: 1 },
      ],
    })
  })
})

// ─── What a pick writes, and to what ──────────────────────────────────────────

describe('PlanPage — the picker\'s writes go to the week set, never to the program set (except the rest rows)', () => {
  it('a type pick on a set with its own program set writes week ops only: no program-set rest, no stage rest', () => {
    mockState.programSets = [pset('ps-bench', 'pe-bench', { restSeconds: 90 })]
    arrange([setRow({ id: 'a', setNumber: 1, programSetId: 'ps-bench' })])

    openSetMenu(1)
    fireEvent.click(kind('Dropset'))
    fireEvent.click(kind('Warmup')) // (the mocked write changes nothing in the week, so the picker still holds Normal)

    expect(changeTypeMutate).toHaveBeenCalledTimes(2)
    expect(updateRestMutate).not.toHaveBeenCalled()
    expect(updateStageRestMutate).not.toHaveBeenCalled()
    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('REMOVE THIS SET and Cues write the week set and nothing of the program\'s', () => {
    mockState.programSets = [pset('ps-bench', 'pe-bench', { restSeconds: 90 })]
    arrange([setRow({ id: 'a', setNumber: 1, programSetId: 'ps-bench' }), setRow({ id: 'b', setNumber: 2, programSetId: 'ps-bench' })])

    openSetMenu(1)
    fireEvent.click(picker().getByText('Cues'))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Cues for this set' })).getByRole('checkbox', { name: 'Push here' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Cues for this set' })).getByRole('button', { name: 'DONE' }))
    expect(updateSetMutate.mock.calls).toEqual([[{ id: 'a', changes: { tags: ['push here'] } }]])

    fireEvent.click(picker().getByText('REMOVE THIS SET'))
    expect(removeSetMutate.mock.calls).toEqual([['a']])

    expect(updateRestMutate).not.toHaveBeenCalled()
    expect(updateStageRestMutate).not.toHaveBeenCalled()
  })

  it('a pick while a change is still out asks for nothing (each tap would be worked out from rows the first is still changing)', () => {
    mockState.changePending = true
    arrange([setRow({ id: 'a', setNumber: 1, stageKind: 'dropset' }), setRow({ id: 'a1', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'a', stageIndex: 1 })])

    openSetMenu(1)
    fireEvent.click(picker().getByRole('button', { name: 'More drops' }))
    fireEvent.click(kind('Normal'))

    expect(changeTypeMutate).not.toHaveBeenCalled()
  })

  it('shows the type the week holds, not the one just picked, until the week is read again', () => {
    arrange([setRow({ id: 'a', setNumber: 1 })])
    openSetMenu(1)
    fireEvent.click(kind('Warmup'))
    expect(changeTypeMutate).toHaveBeenCalledTimes(1)
    // The mocked hook changes nothing in the week: the picker still draws what the week holds.
    expect(kind('Normal').getAttribute('aria-pressed')).toBe('true')
    expect(kind('Warmup').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('PlanPage — the picker and the sheets it opens', () => {
  it('names the exercise, the set and the week (CYCLE on a sequence run is the sequence tests\' own), and closes on ×', () => {
    arrange([setRow({ id: 'a', setNumber: 1 })])
    openSetMenu(1)
    expect(picker().getByText('Bench Press · SET 01 · WEEK 2')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the Cues row says what the set has, the cues sheet stacks over the picker, and closing the sheet leaves the picker open', () => {
    arrange([setRow({ id: 'a', setNumber: 1, tags: ['push here'] })])
    openSetMenu(1)
    fireEvent.click(picker().getByText('Cues'))
    const cues = within(screen.getByRole('dialog', { name: 'Cues for this set' }))
    fireEvent.click(cues.getByLabelText('Close'))

    expect(screen.queryByRole('dialog', { name: 'Cues for this set' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'What is this set?' })).toBeTruthy()
    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('is opened by the kind chip as by the ⋯, on the same set', () => {
    arrange([
      setRow({ id: 'a', setNumber: 1 }),
      setRow({ id: 'h', setNumber: 2, stageKind: 'myo_reps' }),
      setRow({ id: 'h1', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'h', stageIndex: 1 }),
    ])
    fireEvent.click(screen.getByText('MYO-REPS · 1 MINI-SET'))
    expect(picker().getByText('Bench Press · SET 02 · WEEK 2')).toBeTruthy()
    expect(kind('Myo-reps').getAttribute('aria-pressed')).toBe('true')
  })
})
