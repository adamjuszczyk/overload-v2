// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Program, WorkoutDay, ProgramExercise, ProgramSet } from '../../types'

// Chunk 14 — "Staged sets: all four stage kinds" (SPEC.md), the program
// (planner step 3) authoring half: ProgramSetGroupEditor labels each stage
// row by its head's resolved kind, and — once a head has at least one
// real stage — offers the same STAGE KIND chip row (RatingChips) the week
// plan's own PlanSetGroup does. Same mocking recipe as StepVolume.test.tsx,
// with capturable mutate mocks for the three new hooks.

let workoutDays: WorkoutDay[] = []
let exercisesByDay: Record<string, ProgramExercise[]> = {}
let setsByExercise: Record<string, ProgramSet[]> = {}
const updateStageKindMutateMock = vi.fn()
const addStageMutateMock = vi.fn()
const removeStageMutateMock = vi.fn()
const updateStageRestMutateMock = vi.fn()

vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useProgramExercises: (workoutDayId: string) => ({ data: exercisesByDay[workoutDayId] ?? [], isLoading: false }),
  useUpdatePlanningType: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('./usePlanner', async () => {
  const actual = await vi.importActual<typeof import('./plannerService')>('./plannerService')
  return {
    useProgramSets: (ids: string[]) => ({
      data: ids.flatMap((id) => setsByExercise[id] ?? []),
      isLoading: false,
    }),
    useSetExerciseSetCount: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateSetRepTarget: () => ({ mutate: vi.fn(), isPending: false }),
    useSetRepTargetForAllSets: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateProgramSetIsWarmup: () => ({ mutate: vi.fn() }),
    useUpdateProgramSetStageKind: () => ({ mutate: updateStageKindMutateMock }),
    // Chunk 16 (SPEC "Rest") — not this file's own concern (stage kind
    // authoring); every render now also mounts RestStepper(s), so these
    // must resolve too.
    useUpdateProgramSetRest: () => ({ mutate: vi.fn() }),
    useUpdateProgramSetStageRest: () => ({ mutate: updateStageRestMutateMock }),
    useAddProgramSetStage: () => ({ mutate: addStageMutateMock, isPending: false }),
    useRemoveProgramSetStage: () => ({ mutate: removeStageMutateMock }),
    headSets: actual.headSets,
    summarizeRepTargets: actual.summarizeRepTargets,
  }
})

const { default: StepVolume } = await import('./StepVolume')

afterEach(() => {
  cleanup()
  updateStageKindMutateMock.mockReset()
  addStageMutateMock.mockReset()
  removeStageMutateMock.mockReset()
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  workoutDays = [{ id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }]
  exercisesByDay = {
    'wd-1': [{
      id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null,
      exercise: { id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
    }],
  }
  setsByExercise = {}
})

function program(): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program',
    schedule: { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'saved', planningType: 'week_dependent',
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

function renderStep() {
  return render(<StepVolume program={program()} volumeReadOnly={false} canChangePlanningType />)
}

describe('StepVolume — a head with no stages shows no ADD STAGE chip row yet', () => {
  it('ADD STAGE is offered; no STAGE KIND row until a real stage exists', () => {
    setsByExercise['pe-1'] = [set({ id: 'head' })]
    renderStep()
    expect(screen.getByRole('button', { name: /ADD STAGE/i })).toBeTruthy()
    expect(screen.queryByText('STAGE KIND')).toBeNull()
  })
})

describe('StepVolume — ADD STAGE calls useAddProgramSetStage with the head as parent', () => {
  it('passes programExerciseId, the head\'s own id and position, and the next stage index', () => {
    setsByExercise['pe-1'] = [set({ id: 'head', position: 1 })]
    renderStep()

    fireEvent.click(screen.getByRole('button', { name: /ADD STAGE/i }))

    expect(addStageMutateMock).toHaveBeenCalledWith({
      programExerciseId: 'pe-1',
      parentId: 'head',
      position: 1,
      stageIndex: 1,
    })
  })

  it('a second ADD STAGE (one stage already exists) uses stageIndex 2, not 1 again', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'head', position: 1 }),
      set({ id: 'stage-1', position: 1, parentProgramSetId: 'head', stageIndex: 1 }),
    ]
    renderStep()

    fireEvent.click(screen.getByRole('button', { name: /ADD STAGE/i }))

    expect(addStageMutateMock).toHaveBeenCalledWith({
      programExerciseId: 'pe-1',
      parentId: 'head',
      position: 1,
      stageIndex: 2,
    })
  })
})

describe('StepVolume — stage rows are labelled by the head\'s resolved kind, and the chip row writes it', () => {
  it('a legacy/null stage_kind head labels its stage DROPSET', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'head', position: 1 }),
      set({ id: 'stage-1', position: 1, parentProgramSetId: 'head', stageIndex: 1 }),
    ]
    renderStep()
    expect(screen.getByText('STAGE KIND')).toBeTruthy()
    // The stage row's own label, plus the (active) DROPSET chip.
    expect(screen.getAllByText('DROPSET')).toHaveLength(2)
  })

  it('a head with stageKind "myo_reps" labels its stage MYO-REPS', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'head', position: 1, stageKind: 'myo_reps' }),
      set({ id: 'stage-1', position: 1, parentProgramSetId: 'head', stageIndex: 1 }),
    ]
    renderStep()
    expect(screen.getAllByText('MYO-REPS')).toHaveLength(2)
  })

  it('tapping the CLUSTER chip calls useUpdateProgramSetStageKind with {id: head.id, stageKind: "cluster"}', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'head', position: 1 }),
      set({ id: 'stage-1', position: 1, parentProgramSetId: 'head', stageIndex: 1 }),
    ]
    renderStep()

    fireEvent.click(screen.getByRole('button', { name: 'CLUSTER' }))

    expect(updateStageKindMutateMock).toHaveBeenCalledWith({ id: 'head', stageKind: 'cluster' })
  })
})

describe('StepVolume — removing a stage uses the one-at-a-time remove, not the SETS stepper', () => {
  it('tapping a stage\'s own remove button calls useRemoveProgramSetStage with that stage\'s id', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'head', position: 1 }),
      set({ id: 'stage-1', position: 1, parentProgramSetId: 'head', stageIndex: 1 }),
    ]
    renderStep()

    fireEvent.click(screen.getByRole('button', { name: 'Remove stage' }))

    expect(removeStageMutateMock).toHaveBeenCalledWith('stage-1')
  })
})

describe('StepVolume — stage rest (chunk 16 — SPEC.md "Rest": "dropset none; others 15s" by default)', () => {
  it('a dropset head with no override shows NO TIMER as its stage rest default', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'head', position: 1, stageRestSeconds: null }),
      set({ id: 'stage-1', position: 1, parentProgramSetId: 'head', stageIndex: 1 }),
    ]
    renderStep()
    expect(screen.getByText('STAGE REST')).toBeTruthy()
    expect(screen.getByText('NO TIMER')).toBeTruthy()
  })

  it('a rest_pause head with no override shows 15S as its stage rest default', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'head', position: 1, stageKind: 'rest_pause', stageRestSeconds: null }),
      set({ id: 'stage-1', position: 1, parentProgramSetId: 'head', stageIndex: 1 }),
    ]
    renderStep()
    expect(screen.getByText('15S')).toBeTruthy()
  })

  it('stepping the STAGE REST control writes stageRestSeconds on the head', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'head', position: 1 }),
      set({ id: 'stage-1', position: 1, parentProgramSetId: 'head', stageIndex: 1 }),
    ]
    renderStep()

    const stepper = screen.getByText('NO TIMER').parentElement!
    fireEvent.click(stepper.querySelector('button:last-of-type')!)

    expect(updateStageRestMutateMock).toHaveBeenCalledWith({ id: 'head', stageRestSeconds: 15 })
  })

  it('375px: a staged head (STAGE KIND chips + its own STAGE REST stepper) carries no fixed pixel width wider than 375px', () => {
    setsByExercise['pe-1'] = [
      set({ id: 'head', position: 1, stageKind: 'cluster' }),
      set({ id: 'stage-1', position: 1, parentProgramSetId: 'head', stageIndex: 1 }),
    ]
    const { container } = renderStep()
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
