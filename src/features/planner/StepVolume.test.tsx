// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Program, WorkoutDay, ProgramExercise, ProgramSet } from '../../types'

let workoutDays: WorkoutDay[] = []
let exercisesByDay: Record<string, ProgramExercise[]> = {}
let setsByExercise: Record<string, ProgramSet[]> = {}
const updatePlanningTypeMutateMock = vi.fn()
const setCountMutateMock = vi.fn()
const updateTargetMutateMock = vi.fn()

vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useProgramExercises: (workoutDayId: string) => ({ data: exercisesByDay[workoutDayId] ?? [], isLoading: false }),
  useUpdatePlanningType: () => ({ mutate: updatePlanningTypeMutateMock, isPending: false }),
}))

vi.mock('./usePlanner', async () => {
  const actual = await vi.importActual<typeof import('./plannerService')>('./plannerService')
  return {
    useProgramSets: (ids: string[]) => ({
      data: ids.flatMap((id) => setsByExercise[id] ?? []),
      isLoading: false,
    }),
    useSetExerciseSetCount: () => ({ mutate: setCountMutateMock, isPending: false }),
    useUpdateSetRepTarget: () => ({ mutate: updateTargetMutateMock, isPending: false }),
    headSets: actual.headSets,
  }
})

const { default: StepVolume } = await import('./StepVolume')

afterEach(() => {
  cleanup()
  updatePlanningTypeMutateMock.mockReset()
  setCountMutateMock.mockReset()
  updateTargetMutateMock.mockReset()
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  workoutDays = []
  exercisesByDay = {}
  setsByExercise = {}
})

function program(overrides: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program',
    schedule: { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'saved', planningType: 'week_dependent',
    ...overrides,
  }
}

function day(overrides: Partial<WorkoutDay> = {}): WorkoutDay {
  return { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [], ...overrides }
}

function exercise(overrides: Partial<ProgramExercise> = {}): ProgramExercise {
  return {
    id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0,
    targetReps: null, weightUnit: null,
    exercise: { id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
    ...overrides,
  }
}

function set(overrides: Partial<ProgramSet> = {}): ProgramSet {
  return {
    id: 'ps-1', userId: 'user-1', programExerciseId: 'pe-1', position: 1, isWarmup: false,
    stageKind: null, stageRestSeconds: null, parentProgramSetId: null, stageIndex: 0,
    repMin: null, repMax: null, isAmrap: false, restSeconds: null, createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function setup() {
  workoutDays = [day({ id: 'wd-1' })]
  exercisesByDay['wd-1'] = [exercise({ id: 'pe-1' })]
}

describe('StepVolume — "no sets yet" flag (reviewer note: Save/Start never blocked by it)', () => {
  it('an exercise with zero sets shows NO SETS YET', () => {
    setup()
    setsByExercise['pe-1'] = []
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    expect(screen.getByText('NO SETS YET')).toBeTruthy()
  })

  it('once at least one set exists, the flag is gone', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    expect(screen.queryByText('NO SETS YET')).toBeNull()
  })
})

describe('StepVolume — the SETS stepper (the one required value)', () => {
  it('tapping + on zero sets calls useSetExerciseSetCount with count 1', () => {
    setup()
    setsByExercise['pe-1'] = []
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(screen.getByLabelText('More sets for Bench Press'))

    expect(setCountMutateMock).toHaveBeenCalledWith({ programExerciseId: 'pe-1', currentHeads: [], count: 1 })
  })

  it('tapping − on one set calls it with count 0 (never below zero)', () => {
    setup()
    const s = set({ id: 'ps-1', position: 1 })
    setsByExercise['pe-1'] = [s]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(screen.getByLabelText('Fewer sets for Bench Press'))

    expect(setCountMutateMock).toHaveBeenCalledWith({ programExerciseId: 'pe-1', currentHeads: [s], count: 0 })
  })

  it('stages (parentProgramSetId set) are excluded from the displayed count', () => {
    setup()
    setsByExercise['pe-1'] = [
      set({ id: 'head-1', position: 1 }),
      set({ id: 'stage-1', position: 1, parentProgramSetId: 'head-1', stageIndex: 1 }),
    ]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    // Exactly one head -> displayed count "1", and only one numbered row (01).
    expect(screen.getByText('01')).toBeTruthy()
    expect(screen.queryByText('02')).toBeNull()
  })

  it('volumeReadOnly disables both stepper buttons', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly canChangePlanningType={false} />)

    expect((screen.getByLabelText('More sets for Bench Press') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Fewer sets for Bench Press') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('StepVolume — per-set rep target (number / range / AMRAP)', () => {
  it('a set with no target shows the dash placeholder', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('a set with a range shows it formatted with an en dash', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1, repMin: 8, repMax: 12 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    expect(screen.getByText('8–12')).toBeTruthy()
  })

  it('tapping a target, typing a range, and blurring commits the parsed RepTarget', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(screen.getByText('—'))
    const input = screen.getByPlaceholderText('8, 8-12, or AMRAP')
    fireEvent.change(input, { target: { value: '8-12' } })
    fireEvent.blur(input)

    expect(updateTargetMutateMock).toHaveBeenCalledWith({ id: 'ps-1', target: { type: 'range', min: 8, max: 12 } })
  })

  it('typing AMRAP (any case) commits the amrap target', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(screen.getByText('—'))
    const input = screen.getByPlaceholderText('8, 8-12, or AMRAP')
    fireEvent.change(input, { target: { value: 'amrap' } })
    fireEvent.blur(input)

    expect(updateTargetMutateMock).toHaveBeenCalledWith({ id: 'ps-1', target: { type: 'amrap' } })
  })

  it('an unparseable entry is not saved (no mutate call)', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(screen.getByText('—'))
    const input = screen.getByPlaceholderText('8, 8-12, or AMRAP')
    fireEvent.change(input, { target: { value: 'lots' } })
    fireEvent.blur(input)

    expect(updateTargetMutateMock).not.toHaveBeenCalled()
  })

  it('committing the same value it already had does not call mutate (true no-op)', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1, repMin: 8, repMax: 8 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(screen.getByText('8'))
    const input = screen.getByPlaceholderText('8, 8-12, or AMRAP')
    fireEvent.blur(input) // unchanged value

    expect(updateTargetMutateMock).not.toHaveBeenCalled()
  })

  it('volumeReadOnly: the target is not tappable', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly canChangePlanningType={false} />)

    expect((screen.getByText('—').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('StepVolume — planning type picker', () => {
  it('canChangePlanningType: tapping STABLE calls useUpdatePlanningType', () => {
    setup()
    render(<StepVolume program={program({ planningType: 'week_dependent' })} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(screen.getByText('STABLE'))

    expect(updatePlanningTypeMutateMock).toHaveBeenCalledWith({ id: 'prog-1', planningType: 'stable' })
  })

  it('!canChangePlanningType: both options are disabled (a run does not re-choose this)', () => {
    setup()
    render(<StepVolume program={program({ planningType: 'stable' })} volumeReadOnly canChangePlanningType={false} />)

    expect((screen.getByText('STABLE') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('WEEK-DEPENDENT') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('StepVolume — 375px', () => {
  it('no rendered element carries a fixed pixel width wider than 375px', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1, repMin: 8, repMax: 12 })]
    const { container } = render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const value = el.style[prop]
        const m = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
