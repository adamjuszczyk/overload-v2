// @vitest-environment jsdom
//
// Chunk 25 (SPEC.md "Scheduling → Sequence" / TASKS.md "Planner step 2
// gains the schedule type and a sequence editor"). A sibling of
// StepExercises.test.tsx (that file's own fixtures are all weekday
// programs; this one is the sequence-specific describe blocks), same
// heavy-mocked-at-the-hook-boundary precedent.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { Program, WorkoutDay, SequenceItem } from '../../types'

// Every workout day also renders its OWN section below (WorkoutEditor),
// headed by its name — the same text a sequence slot referencing it shows.
// Scoping to the editor's own region (role="region", chunk 25's own addition
// to SequenceEditor) keeps every query here unambiguous regardless of how
// many times a workout's name is reused across slots or appears in its own
// WorkoutEditor heading.
function sequenceRegion() {
  return within(screen.getByRole('region', { name: 'Sequence editor' }))
}

let workoutDays: WorkoutDay[] = []
let sequenceItems: SequenceItem[] = []
const updateScheduleTypeMutateMock = vi.fn()
const addSequenceItemMutateAsyncMock = vi.fn()
const updateSequenceItemMutateMock = vi.fn()
const removeSequenceItemMutateMock = vi.fn()
const reorderSequenceItemsMutateMock = vi.fn()
const assignWeekdayMutateMock = vi.fn()

vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useCreateWorkoutDay: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWorkoutDayName: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteWorkoutDay: () => ({ mutate: vi.fn(), isPending: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useReorderProgramExercises: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProgramExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProgramExerciseWeightUnit: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProgramExerciseRest: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProgramExerciseTempo: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleSupersetLink: () => ({ mutate: vi.fn(), isPending: false }),
  useSupersetBlockRests: () => ({ data: [] }),
  useUpdateSupersetBlockRest: () => ({ mutate: vi.fn(), isPending: false }),
  useWarmupRoutineItems: () => ({ data: [], isLoading: false }),
  useAddWarmupItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWarmupItemBody: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWarmupItem: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWarmupItems: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateScheduleType: () => ({ mutate: updateScheduleTypeMutateMock, isPending: false }),
  useSequenceItems: () => ({ data: sequenceItems, isLoading: false }),
  useAddSequenceItem: () => ({ mutateAsync: addSequenceItemMutateAsyncMock, isPending: false }),
  useUpdateSequenceItemWorkout: () => ({ mutate: updateSequenceItemMutateMock, isPending: false }),
  useRemoveSequenceItem: () => ({ mutate: removeSequenceItemMutateMock, isPending: false }),
  useReorderSequenceItems: () => ({ mutate: reorderSequenceItemsMutateMock, isPending: false }),
}))

vi.mock('./usePlanner', () => ({
  useAssignWorkoutWeekday: () => ({ mutate: assignWeekdayMutateMock, isPending: false }),
}))

vi.mock('../settings/settingsStore', () => ({
  useSettingsStore: (selector: (s: { weightUnit: string }) => unknown) => selector({ weightUnit: 'kg' }),
}))

vi.mock('../programs/ExercisePicker', () => ({ default: () => null }))

const { default: StepExercises } = await import('./StepExercises')

afterEach(() => {
  cleanup()
  updateScheduleTypeMutateMock.mockReset()
  addSequenceItemMutateAsyncMock.mockReset()
  updateSequenceItemMutateMock.mockReset()
  removeSequenceItemMutateMock.mockReset()
  reorderSequenceItemsMutateMock.mockReset()
  assignWeekdayMutateMock.mockReset()
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  workoutDays = []
  sequenceItems = []
})

function program(overrides: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program',
    schedule: { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'saved', planningType: 'week_dependent', scheduleType: 'weekday',
    ...overrides,
  }
}

function day(overrides: Partial<WorkoutDay> = {}): WorkoutDay {
  return { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'A', position: 0, exercises: [], ...overrides }
}

function seqItem(overrides: Partial<SequenceItem> = {}): SequenceItem {
  return { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-1', ...overrides }
}

describe('StepExercises — schedule type toggle (chunk 25)', () => {
  it('a weekday program (the column default) shows the weekday chip row and no sequence editor region', () => {
    workoutDays = [day()]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    expect(screen.getByText('MON')).toBeTruthy() // weekday chip row present
    expect(screen.queryByRole('region', { name: 'Sequence editor' })).toBeNull()
  })

  it('tapping SEQUENCE calls useUpdateScheduleType with the program id and the new type', () => {
    workoutDays = [day()]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    fireEvent.click(screen.getByText('SEQUENCE'))
    expect(updateScheduleTypeMutateMock).toHaveBeenCalledWith({ id: 'prog-1', scheduleType: 'sequence' })
  })

  it('tapping the already-active WEEKDAY tab does nothing (no spurious write)', () => {
    workoutDays = [day()]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    fireEvent.click(screen.getByText('WEEKDAY'))
    expect(updateScheduleTypeMutateMock).not.toHaveBeenCalled()
  })

  it('a sequence program hides the weekday chip row and shows SequenceEditor instead', () => {
    workoutDays = [day()]
    render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)
    expect(screen.queryByText('MON')).toBeNull()
    expect(screen.getByRole('region', { name: 'Sequence editor' })).toBeTruthy()
  })

  it('never gated by volumeReadOnly — the toggle still writes on a read-only (stable) run', () => {
    workoutDays = [day()]
    render(<StepExercises program={program()} volumeReadOnly />)
    fireEvent.click(screen.getByText('SEQUENCE'))
    expect(updateScheduleTypeMutateMock).toHaveBeenCalledWith({ id: 'prog-1', scheduleType: 'sequence' })
  })
})

describe('StepExercises — SequenceEditor (chunk 25)', () => {
  it('empty state: no slots yet', () => {
    workoutDays = [day()]
    render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)
    expect(screen.getByText('NO SLOTS YET')).toBeTruthy()
  })

  it('renders each slot in position order, a rest slot labelled REST DAY, a workout slot by name', () => {
    workoutDays = [day({ id: 'wd-1', name: 'A' }), day({ id: 'wd-2', name: 'B' })]
    sequenceItems = [
      seqItem({ id: 'si-1', position: 0, workoutDayId: 'wd-1' }),
      seqItem({ id: 'si-2', position: 1, workoutDayId: 'wd-2' }),
      seqItem({ id: 'si-3', position: 2, workoutDayId: null }),
    ]
    render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)
    expect(sequenceRegion().getByText('A')).toBeTruthy()
    expect(sequenceRegion().getByText('B')).toBeTruthy()
    expect(sequenceRegion().getByText('REST DAY')).toBeTruthy()
  })

  it('a workout may appear more than once — two distinct rows, same label (SPEC, G8)', () => {
    workoutDays = [day({ id: 'wd-1', name: 'A' }), day({ id: 'wd-2', name: 'B' })]
    sequenceItems = [
      seqItem({ id: 'si-1', position: 0, workoutDayId: 'wd-1' }),
      seqItem({ id: 'si-2', position: 1, workoutDayId: 'wd-2' }),
      seqItem({ id: 'si-3', position: 2, workoutDayId: 'wd-1' }),
    ]
    render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)
    expect(sequenceRegion().getAllByText('A')).toHaveLength(2)
  })

  it('ADD SLOT opens a picker; picking a workout calls useAddSequenceItem with the next position', async () => {
    workoutDays = [day({ id: 'wd-1', name: 'A' })]
    sequenceItems = [seqItem({ id: 'si-1', position: 0, workoutDayId: 'wd-1' })]
    render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)

    fireEvent.click(sequenceRegion().getByText('ADD SLOT'))
    expect(sequenceRegion().getByText('ADD SLOT', { selector: 'p' })).toBeTruthy() // sheet title
    // Two "A" buttons now exist inside the region: the existing row and the
    // picker's own option — the picker renders AFTER the existing row in
    // DOM order, so the last one is the picker's.
    const options = sequenceRegion().getAllByText('A')
    fireEvent.click(options[options.length - 1])

    expect(addSequenceItemMutateAsyncMock).toHaveBeenCalledWith({ position: 1, workoutDayId: 'wd-1' })
  })

  it('ADD SLOT → REST DAY calls useAddSequenceItem with workoutDayId null', () => {
    workoutDays = [day({ id: 'wd-1', name: 'A' })]
    render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)

    fireEvent.click(sequenceRegion().getByText('ADD SLOT'))
    fireEvent.click(sequenceRegion().getByText('REST DAY'))

    expect(addSequenceItemMutateAsyncMock).toHaveBeenCalledWith({ position: 0, workoutDayId: null })
  })

  it('tapping an existing slot opens CHANGE SLOT; picking a different workout calls useUpdateSequenceItemWorkout with that slot id', () => {
    workoutDays = [day({ id: 'wd-1', name: 'A' }), day({ id: 'wd-2', name: 'B' })]
    sequenceItems = [seqItem({ id: 'si-1', position: 0, workoutDayId: 'wd-1' })]
    render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)

    fireEvent.click(sequenceRegion().getByText('A')) // the existing row's own label
    expect(sequenceRegion().getByText('CHANGE SLOT')).toBeTruthy()
    fireEvent.click(sequenceRegion().getByText('B'))

    expect(updateSequenceItemMutateMock).toHaveBeenCalledWith({ id: 'si-1', workoutDayId: 'wd-2' })
  })

  it('reorder: moving the second slot up swaps its position with the first, dense positions, via useReorderSequenceItems', () => {
    workoutDays = [day({ id: 'wd-1', name: 'A' }), day({ id: 'wd-2', name: 'B' })]
    sequenceItems = [
      seqItem({ id: 'si-1', position: 0, workoutDayId: 'wd-1' }),
      seqItem({ id: 'si-2', position: 1, workoutDayId: 'wd-2' }),
    ]
    render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)

    const upButtons = sequenceRegion().getAllByRole('button').filter((b) => b.querySelector('svg.lucide-chevron-up'))
    fireEvent.click(upButtons[1]) // the SECOND row's own up arrow (first is disabled)

    expect(reorderSequenceItemsMutateMock).toHaveBeenCalledWith([
      { id: 'si-2', position: 0 },
      { id: 'si-1', position: 1 },
    ])
  })

  it('the first slot\'s own up arrow and the last slot\'s own down arrow are disabled', () => {
    workoutDays = [day({ id: 'wd-1', name: 'A' })]
    sequenceItems = [
      seqItem({ id: 'si-1', position: 0, workoutDayId: 'wd-1' }),
      seqItem({ id: 'si-2', position: 1, workoutDayId: null }),
    ]
    render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)

    const upButtons = sequenceRegion().getAllByRole('button').filter((b) => b.querySelector('svg.lucide-chevron-up'))
    const downButtons = sequenceRegion().getAllByRole('button').filter((b) => b.querySelector('svg.lucide-chevron-down'))
    expect((upButtons[0] as HTMLButtonElement).disabled).toBe(true)
    expect((downButtons[downButtons.length - 1] as HTMLButtonElement).disabled).toBe(true)
  })

  it('remove: the delete icon opens a confirm sheet; confirming calls useRemoveSequenceItem with the slot id', () => {
    workoutDays = [day({ id: 'wd-1', name: 'A' })]
    sequenceItems = [seqItem({ id: 'si-1', position: 0, workoutDayId: 'wd-1' })]
    render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)

    const deleteButtons = sequenceRegion().getAllByRole('button').filter((b) => b.querySelector('svg.lucide-trash2'))
    fireEvent.click(deleteButtons[0])
    expect(sequenceRegion().getByText('Remove this slot?')).toBeTruthy()
    fireEvent.click(sequenceRegion().getByText('REMOVE'))

    expect(removeSequenceItemMutateMock).toHaveBeenCalledWith('si-1')
  })

  it('CANCEL on the remove sheet writes nothing', () => {
    workoutDays = [day({ id: 'wd-1', name: 'A' })]
    sequenceItems = [seqItem({ id: 'si-1', position: 0, workoutDayId: 'wd-1' })]
    render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)

    const deleteButtons = sequenceRegion().getAllByRole('button').filter((b) => b.querySelector('svg.lucide-trash2'))
    fireEvent.click(deleteButtons[0])
    fireEvent.click(sequenceRegion().getByText('CANCEL'))

    expect(removeSequenceItemMutateMock).not.toHaveBeenCalled()
  })

  it('375px: no element carries a fixed pixel width wider than 375px', () => {
    workoutDays = [day({ id: 'wd-1', name: 'A' })]
    sequenceItems = [
      seqItem({ id: 'si-1', position: 0, workoutDayId: 'wd-1' }),
      seqItem({ id: 'si-2', position: 1, workoutDayId: null }),
    ]
    const { container } = render(<StepExercises program={program({ scheduleType: 'sequence' })} volumeReadOnly={false} />)
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
