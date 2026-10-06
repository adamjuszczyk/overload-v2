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
const setAllTargetMutateMock = vi.fn()

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
    useSetRepTargetForAllSets: () => ({ mutate: setAllTargetMutateMock, isPending: false }),
    headSets: actual.headSets,
    summarizeRepTargets: actual.summarizeRepTargets,
  }
})

const { default: StepVolume } = await import('./StepVolume')

afterEach(() => {
  cleanup()
  updatePlanningTypeMutateMock.mockReset()
  setCountMutateMock.mockReset()
  updateTargetMutateMock.mockReset()
  setAllTargetMutateMock.mockReset()
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

// The per-set row's own target button carries no aria-label of its own (its
// accessible name falls back to its text), unlike the new "fill all sets"
// row right above it (ExerciseTargetRow, its own describe block below),
// which does — so getByRole, not getByText, is what tells the two apart
// once both can show the exact same text (a single-set exercise's one head
// and "every set" necessarily agree).
function perSetTargetButton(text: string) {
  return screen.getByRole('button', { name: text })
}

describe('StepVolume — per-set rep target (number / range / AMRAP)', () => {
  it('a set with no target shows the dash placeholder', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    expect(perSetTargetButton('—')).toBeTruthy()
  })

  it('a set with a range shows it formatted with an en dash', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1, repMin: 8, repMax: 12 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    expect(perSetTargetButton('8–12')).toBeTruthy()
  })

  it('tapping a target, typing a range, and blurring commits the parsed RepTarget', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(perSetTargetButton('—'))
    const input = screen.getByPlaceholderText('8, 8-12, or AMRAP')
    fireEvent.change(input, { target: { value: '8-12' } })
    fireEvent.blur(input)

    expect(updateTargetMutateMock).toHaveBeenCalledWith({ id: 'ps-1', target: { type: 'range', min: 8, max: 12 } })
  })

  it('typing AMRAP (any case) commits the amrap target', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(perSetTargetButton('—'))
    const input = screen.getByPlaceholderText('8, 8-12, or AMRAP')
    fireEvent.change(input, { target: { value: 'amrap' } })
    fireEvent.blur(input)

    expect(updateTargetMutateMock).toHaveBeenCalledWith({ id: 'ps-1', target: { type: 'amrap' } })
  })

  it('an unparseable entry is not saved (no mutate call)', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(perSetTargetButton('—'))
    const input = screen.getByPlaceholderText('8, 8-12, or AMRAP')
    fireEvent.change(input, { target: { value: 'lots' } })
    fireEvent.blur(input)

    expect(updateTargetMutateMock).not.toHaveBeenCalled()
  })

  it('committing the same value it already had does not call mutate (true no-op)', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1, repMin: 8, repMax: 8 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(perSetTargetButton('8'))
    const input = screen.getByPlaceholderText('8, 8-12, or AMRAP')
    fireEvent.blur(input) // unchanged value

    expect(updateTargetMutateMock).not.toHaveBeenCalled()
  })

  it('volumeReadOnly: the target is not tappable', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'ps-1', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly canChangePlanningType={false} />)

    expect((perSetTargetButton('—') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('StepVolume — "fill all sets at once" (review fix)', () => {
  function allSetsButton(exerciseName = 'Bench Press') {
    return screen.getByRole('button', { name: `Set every set's rep target for ${exerciseName}` })
  }

  it('shows the shared target when every head agrees', () => {
    setup()
    setsByExercise['pe-1'] = [
      set({ id: 'a', position: 1, repMin: 8, repMax: 12 }),
      set({ id: 'b', position: 2, repMin: 8, repMax: 12 }),
    ]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    expect(allSetsButton().textContent).toBe('8–12')
  })

  it('shows MIXED when heads disagree', () => {
    setup()
    setsByExercise['pe-1'] = [
      set({ id: 'a', position: 1, repMin: 8, repMax: 12 }),
      set({ id: 'b', position: 2, isAmrap: true }),
    ]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    expect(allSetsButton().textContent).toBe('MIXED')
  })

  it('shows the dash when no head has a target yet', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'a', position: 1 }), set({ id: 'b', position: 2 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    expect(allSetsButton().textContent).toBe('—')
  })

  it('setting 8–12 writes every current head in one call', () => {
    setup()
    setsByExercise['pe-1'] = [
      set({ id: 'a', position: 1 }),
      set({ id: 'b', position: 2 }),
      set({ id: 'c', position: 3, isAmrap: true }), // mixed beforehand — still all get overwritten
    ]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(allSetsButton())
    const input = screen.getByPlaceholderText('8, 8-12, or AMRAP')
    fireEvent.change(input, { target: { value: '8-12' } })
    fireEvent.blur(input)

    expect(setAllTargetMutateMock).toHaveBeenCalledTimes(1)
    expect(setAllTargetMutateMock).toHaveBeenCalledWith({
      headIds: ['a', 'b', 'c'],
      target: { type: 'range', min: 8, max: 12 },
    })
  })

  it('does not call the per-set mutation — one bulk write, not several', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'a', position: 1 }), set({ id: 'b', position: 2 })]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(allSetsButton())
    fireEvent.change(screen.getByPlaceholderText('8, 8-12, or AMRAP'), { target: { value: 'amrap' } })
    fireEvent.blur(screen.getByPlaceholderText('8, 8-12, or AMRAP'))

    expect(updateTargetMutateMock).not.toHaveBeenCalled()
  })

  it('committing the same shared value as every head already has does not call mutate', () => {
    setup()
    setsByExercise['pe-1'] = [
      set({ id: 'a', position: 1, repMin: 8, repMax: 12 }),
      set({ id: 'b', position: 2, repMin: 8, repMax: 12 }),
    ]
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)

    fireEvent.click(allSetsButton())
    fireEvent.blur(screen.getByPlaceholderText('8, 8-12, or AMRAP')) // unchanged

    expect(setAllTargetMutateMock).not.toHaveBeenCalled()
  })

  it('hidden entirely when there are no sets yet (nothing to fill)', () => {
    setup()
    setsByExercise['pe-1'] = []
    render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
    expect(screen.queryByText("Set every set's rep target for Bench Press")).toBeNull()
  })

  it('volumeReadOnly: not tappable', () => {
    setup()
    setsByExercise['pe-1'] = [set({ id: 'a', position: 1 })]
    render(<StepVolume program={program()} volumeReadOnly canChangePlanningType={false} />)
    expect((allSetsButton() as HTMLButtonElement).disabled).toBe(true)
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
