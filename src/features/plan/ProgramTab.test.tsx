// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Program } from '../../types'
import ProgramTab from './ProgramTab'

// Chunk 11 (TASKS.md "the program tab edits the run's copy... with the
// same step 2/step 3 components"). ProgramBuilderPage/WorkoutDayEditorPage
// are gone (chunk 9's own test file, ProgramTab — renders the run copy's
// workouts / each row opens the existing workout editor — no longer
// applies: there is no per-workout sub-route left to navigate into).
// StepExercises/StepVolume are heavily-tested components of their own
// (StepExercises.test.tsx / StepVolume.test.tsx); this file's only job is
// proving ProgramTab wires the right `program` and the right
// `volumeReadOnly` (chunk 9's own rule, unchanged) into both, and shows the
// read-only notice exactly when that flag is true — so both are mocked at
// the module boundary, same precedent as ProgramPage.test.tsx's own
// heavy-mocking of its data hooks.

const stepExercisesMock = vi.fn()
const stepVolumeMock = vi.fn()

vi.mock('../planner/StepExercises', () => ({
  default: (props: Record<string, unknown>) => {
    stepExercisesMock(props)
    return <div>STEP EXERCISES</div>
  },
}))
vi.mock('../planner/StepVolume', () => ({
  default: (props: Record<string, unknown>) => {
    stepVolumeMock(props)
    return <div>STEP VOLUME</div>
  },
}))

afterEach(() => {
  cleanup()
  stepExercisesMock.mockClear()
  stepVolumeMock.mockClear()
})

function program(overrides: Partial<Program> = {}): Program {
  return {
    id: 'run-copy-1',
    userId: 'user-1',
    name: 'My Run',
    schedule: {
      monday: 'wd-1', tuesday: null, wednesday: null, thursday: null,
      friday: null, saturday: null, sunday: null,
    },
    workoutDays: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run',
    planningType: 'week_dependent',
    ...overrides,
  }
}

describe('ProgramTab — stable run, same step 2/step 3 components (chunk 11)', () => {
  it('renders StepExercises and StepVolume for the run copy, both receiving this program', () => {
    const p = program()
    render(<ProgramTab program={p} />)

    expect(screen.getByText('STEP EXERCISES')).toBeTruthy()
    expect(screen.getByText('STEP VOLUME')).toBeTruthy()
    expect(stepExercisesMock).toHaveBeenCalledWith(expect.objectContaining({ program: p }))
    expect(stepVolumeMock).toHaveBeenCalledWith(expect.objectContaining({ program: p }))
  })

  it('week-dependent (chunk 9\'s rule): volumeReadOnly true on both steps, read-only notice shown, planning type not offered', () => {
    render(<ProgramTab program={program({ planningType: 'week_dependent' })} />)

    expect(stepExercisesMock).toHaveBeenCalledWith(expect.objectContaining({ volumeReadOnly: true }))
    expect(stepVolumeMock).toHaveBeenCalledWith(
      expect.objectContaining({ volumeReadOnly: true, canChangePlanningType: false }),
    )
    expect(screen.getByText('VOLUME IS READ-ONLY HERE — EDIT IT IN A WEEK')).toBeTruthy()
  })

  it('stable: volumeReadOnly false on both steps, no read-only notice', () => {
    render(<ProgramTab program={program({ planningType: 'stable' })} />)

    expect(stepExercisesMock).toHaveBeenCalledWith(expect.objectContaining({ volumeReadOnly: false }))
    expect(stepVolumeMock).toHaveBeenCalledWith(expect.objectContaining({ volumeReadOnly: false }))
    expect(screen.queryByText('VOLUME IS READ-ONLY HERE — EDIT IT IN A WEEK')).toBeNull()
  })

  it('missing planningType (a run predating chunk 8) defaults to week-dependent, read-only', () => {
    const p = program()
    delete (p as { planningType?: string }).planningType
    render(<ProgramTab program={p} />)

    expect(stepExercisesMock).toHaveBeenCalledWith(expect.objectContaining({ volumeReadOnly: true }))
  })
})
