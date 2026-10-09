// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Program, WorkoutDay, ProgramExercise, WarmupRoutineItem, SequenceItem } from '../../types'

// Chunk 11 — step 2 (exercises, order, weekday). Heavy-mocked at the hook
// boundary, same precedent as ProgramPage.test.tsx/PrioritiesEditor.test.tsx:
// usePrograms.ts's hooks value-import the real Supabase client at module
// load.

let workoutDays: WorkoutDay[] = []
let exercisesByDay: Record<string, ProgramExercise[]> = {}
let warmupItemsByDay: Record<string, WarmupRoutineItem[]> = {}
// Chunk 25 — empty by default (every existing describe block in this file
// is a WEEKDAY program, scheduleType omitted/'weekday', so SequenceEditor
// never renders and this list is never read); StepExercises.sequence.test.tsx
// is the one file that sets this.
let sequenceItems: SequenceItem[] = []
const createDayMutateAsyncMock = vi.fn()
const updateNameMutateAsyncMock = vi.fn()
const deleteDayMutateMock = vi.fn()
const reorderMutateMock = vi.fn()
const deleteExerciseMutateMock = vi.fn()
const updateWeightUnitMutateMock = vi.fn()
const updateRestMutateMock = vi.fn()
const updateTempoMutateMock = vi.fn()
const updateBlockRestMutateMock = vi.fn()
const assignWeekdayMutateMock = vi.fn()
const toggleLinkMutateMock = vi.fn()
const addWarmupItemMutateAsyncMock = vi.fn()
const updateWarmupItemMutateMock = vi.fn()
const removeWarmupItemMutateMock = vi.fn()
const reorderWarmupItemsMutateMock = vi.fn()
const updateScheduleTypeMutateMock = vi.fn()
const addSequenceItemMutateAsyncMock = vi.fn()
const updateSequenceItemMutateMock = vi.fn()
const removeSequenceItemMutateMock = vi.fn()
const reorderSequenceItemsMutateMock = vi.fn()

vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useCreateWorkoutDay: () => ({ mutateAsync: createDayMutateAsyncMock, isPending: false }),
  useUpdateWorkoutDayName: () => ({ mutateAsync: updateNameMutateAsyncMock, isPending: false }),
  useDeleteWorkoutDay: () => ({ mutate: deleteDayMutateMock, isPending: false }),
  useProgramExercises: (workoutDayId: string) => ({ data: exercisesByDay[workoutDayId] ?? [], isLoading: false }),
  useReorderProgramExercises: () => ({ mutate: reorderMutateMock, isPending: false }),
  useDeleteProgramExercise: () => ({ mutate: deleteExerciseMutateMock, isPending: false }),
  useUpdateProgramExerciseWeightUnit: () => ({ mutate: updateWeightUnitMutateMock, isPending: false }),
  useUpdateProgramExerciseRest: () => ({ mutate: updateRestMutateMock, isPending: false }),
  // Chunk 17 (SPEC "Tempo") — same "not this test file's own concern" posture
  // as useSupersetBlockRests below; TempoEditor's own describe block is the
  // one that cares what this mock is called with.
  useUpdateProgramExerciseTempo: () => ({ mutate: updateTempoMutateMock, isPending: false }),
  useToggleSupersetLink: () => ({ mutate: toggleLinkMutateMock, isPending: false }),
  // Chunk 16 (SPEC "Rest") — not this test file's own concern (workout/
  // exercise CRUD, weekday assignment, superset grouping); empty blocks so
  // every exercise's own REST/REST AFTER steppers render at their "no
  // override" default throughout.
  useSupersetBlockRests: () => ({ data: [] }),
  useUpdateSupersetBlockRest: () => ({ mutate: updateBlockRestMutateMock, isPending: false }),
  // Chunk 18 (SPEC "Warmup routine") — the warmup routine describe block
  // below is the one that cares what these are called with; every OTHER
  // describe block gets an empty list by default (warmupItemsByDay starts
  // {} in beforeEach), so WarmupRoutineEditor renders only its own
  // "ADD ITEM" affordance and never interferes with those tests.
  useWarmupRoutineItems: (workoutDayId: string) => ({ data: warmupItemsByDay[workoutDayId] ?? [], isLoading: false }),
  useAddWarmupItem: () => ({ mutateAsync: addWarmupItemMutateAsyncMock, isPending: false }),
  useUpdateWarmupItemBody: () => ({ mutate: updateWarmupItemMutateMock, isPending: false }),
  useRemoveWarmupItem: () => ({ mutate: removeWarmupItemMutateMock, isPending: false }),
  useReorderWarmupItems: () => ({ mutate: reorderWarmupItemsMutateMock, isPending: false }),
  // Chunk 25 (SPEC "Scheduling → Sequence") — not this test file's own
  // concern (every fixture here is a weekday program); the schedule-type
  // toggle and SequenceEditor's own describe block live in
  // StepExercises.sequence.test.tsx, which overrides sequenceItems.
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

vi.mock('../programs/ExercisePicker', () => ({
  // Review fix 2 (second review) — `onAdded` needs a real trigger so a
  // test can exercise StepExercises.tsx's OWN onVolumeChange construction
  // at line ~467, not just assert against a hand-built ChangeRecord
  // literal (ProgramTab.applyAhead.test.tsx's own seam, which never
  // touches this file's code at all). Additive only — no existing test
  // looks for this button, so nothing else is affected.
  default: ({ onClose, onAdded }: { onClose: () => void; onAdded?: (exerciseId: string) => void }) => (
    <div>
      EXERCISE PICKER
      <button onClick={onClose}>close picker</button>
      <button onClick={() => onAdded?.('ex-new')}>pick ex-new</button>
    </div>
  ),
}))

const { default: StepExercises } = await import('./StepExercises')

afterEach(() => {
  cleanup()
  createDayMutateAsyncMock.mockReset()
  updateNameMutateAsyncMock.mockReset()
  deleteDayMutateMock.mockReset()
  reorderMutateMock.mockReset()
  deleteExerciseMutateMock.mockReset()
  updateWeightUnitMutateMock.mockReset()
  updateTempoMutateMock.mockReset()
  assignWeekdayMutateMock.mockReset()
  toggleLinkMutateMock.mockReset()
  addWarmupItemMutateAsyncMock.mockReset()
  updateWarmupItemMutateMock.mockReset()
  removeWarmupItemMutateMock.mockReset()
  reorderWarmupItemsMutateMock.mockReset()
  updateScheduleTypeMutateMock.mockReset()
  addSequenceItemMutateAsyncMock.mockReset()
  updateSequenceItemMutateMock.mockReset()
  removeSequenceItemMutateMock.mockReset()
  reorderSequenceItemsMutateMock.mockReset()
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  workoutDays = []
  exercisesByDay = {}
  warmupItemsByDay = {}
  sequenceItems = []
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
    weightUnit: null,
    exercise: { id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
    ...overrides,
  }
}

function warmupItem(overrides: Partial<WarmupRoutineItem> = {}): WarmupRoutineItem {
  return { id: 'wi-1', userId: 'user-1', workoutDayId: 'wd-1', position: 0, body: 'Bike 5 min', ...overrides }
}

describe('StepExercises — empty states', () => {
  it('no workouts yet', () => {
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    expect(screen.getByText('NO WORKOUTS YET')).toBeTruthy()
  })

  it('a workout with no exercises shows the SPEC empty state "Add an exercise"', () => {
    workoutDays = [day()]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    expect(screen.getByText('Add an exercise')).toBeTruthy()
  })

  it('read-only: a workout with no exercises shows NO EXERCISES YET, not an add button', () => {
    workoutDays = [day()]
    render(<StepExercises program={program()} volumeReadOnly />)
    expect(screen.getByText('NO EXERCISES YET')).toBeTruthy()
    expect(screen.queryByText('Add an exercise')).toBeNull()
  })
})

describe('StepExercises — weekday assignment ("one weekday per workout")', () => {
  it('tapping an unassigned day assigns this workout to it', () => {
    workoutDays = [day({ id: 'wd-1' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    fireEvent.click(screen.getByText('MON'))

    expect(assignWeekdayMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ workoutDayId: 'wd-1', dow: 'monday' }),
    )
  })

  it('tapping the already-assigned day clears it back to rest (dow: null)', () => {
    workoutDays = [day({ id: 'wd-1' })]
    const p = program({ schedule: { monday: 'wd-1', tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null } })
    render(<StepExercises program={p} volumeReadOnly={false} />)

    fireEvent.click(screen.getByText('MON'))

    expect(assignWeekdayMutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ workoutDayId: 'wd-1', dow: null }),
    )
  })

  it('weekday chips stay interactive even when volumeReadOnly (schedule is not "volume")', () => {
    workoutDays = [day({ id: 'wd-1' })]
    render(<StepExercises program={program()} volumeReadOnly />)

    fireEvent.click(screen.getByText('TUE'))

    expect(assignWeekdayMutateMock).toHaveBeenCalled()
  })
})

describe('StepExercises — volumeReadOnly gates exercise and workout structure, not schedule', () => {
  it('hides reorder/delete on an exercise row and the ADD EXERCISE button', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise()]
    render(<StepExercises program={program()} volumeReadOnly />)

    expect(screen.queryByText('ADD EXERCISE')).toBeNull()
    expect(screen.queryByLabelText(`Delete ${workoutDays[0].name}`)).toBeNull()
  })

  it('hides ADD WORKOUT when read-only', () => {
    render(<StepExercises program={program()} volumeReadOnly />)
    expect(screen.queryByText('ADD WORKOUT')).toBeNull()
  })

  it('shows ADD WORKOUT and per-exercise controls when editable', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise()]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    expect(screen.getByText('ADD WORKOUT')).toBeTruthy()
    expect(screen.getByText('ADD EXERCISE')).toBeTruthy()
  })
})

describe('StepExercises — reorder, 375px', () => {
  it('moving the second exercise up swaps its position with the first', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, exercise: { ...exercise().exercise!, name: 'Bench Press' } }),
      exercise({ id: 'pe-2', position: 1, exercise: { ...exercise().exercise!, name: 'Incline Press' } }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    const upButtons = screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-chevron-up'))
    fireEvent.click(upButtons[1]) // Incline Press's own "up"

    expect(reorderMutateMock).toHaveBeenCalledWith([
      { id: 'pe-2', position: 0 },
      { id: 'pe-1', position: 1 },
    ])
  })

  it('no rendered element carries a fixed pixel width wider than 375px', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise()]
    const { container } = render(<StepExercises program={program()} volumeReadOnly={false} />)
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

// Review fix 2 (second review) — ProgramTab.applyAhead.test.tsx mocks this
// whole component away and hand-builds its own ChangeRecord literal to feed
// ProgramTab's offer logic, so StepExercises.tsx's OWN construction of that
// record (moveExercise/onAdded/the remove confirm, below) was never
// actually exercised by any test. These render the real component and
// assert the real onVolumeChange call.
describe('StepExercises — onVolumeChange carries the real ChangeRecord (review fix 2)', () => {
  const onVolumeChange = vi.fn()
  afterEach(() => onVolumeChange.mockReset())

  it('reorder carries every moved slot\'s own pre-move and post-move position', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0 }),
      exercise({ id: 'pe-2', position: 1, exerciseId: 'ex-2' }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} onVolumeChange={onVolumeChange} />)

    const upButtons = screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-chevron-up'))
    fireEvent.click(upButtons[1]) // the second exercise's own "up"

    expect(onVolumeChange).toHaveBeenCalledWith('wd-1', [
      {
        editType: 'reorderExercise',
        moves: [
          { slotId: 'pe-1', oldPosition: 0, newPosition: 1 },
          { slotId: 'pe-2', oldPosition: 1, newPosition: 0 },
        ],
      },
    ])
  })

  it('adding an exercise carries the right workout and exercise', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1' })]
    render(<StepExercises program={program()} volumeReadOnly={false} onVolumeChange={onVolumeChange} />)

    fireEvent.click(screen.getByText('ADD EXERCISE'))
    fireEvent.click(screen.getByText('pick ex-new'))

    expect(onVolumeChange).toHaveBeenCalledWith('wd-1', [{ editType: 'addExercise', workoutDayId: 'wd-1', exerciseId: 'ex-new' }])
  })

  it('removing an exercise carries the right slot and exercise', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', exerciseId: 'ex-1' })]
    render(<StepExercises program={program()} volumeReadOnly={false} onVolumeChange={onVolumeChange} />)

    const deleteButton = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-trash2') && !b.getAttribute('aria-label'))
    fireEvent.click(deleteButton!)
    fireEvent.click(screen.getByText('REMOVE'))

    expect(onVolumeChange).toHaveBeenCalledWith('wd-1', [{ editType: 'removeExercise', slotId: 'pe-1', exerciseId: 'ex-1' }])
  })
})

describe('StepExercises — superset grouping (chunk 13, never gated by volumeReadOnly)', () => {
  it('two ungrouped exercises show LINK AS SUPERSET; tapping it plans a new shared block', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0 }),
      exercise({ id: 'pe-2', position: 1 }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    expect(screen.getByText('LINK AS SUPERSET')).toBeTruthy()
    fireEvent.click(screen.getByText('LINK AS SUPERSET'))

    expect(toggleLinkMutateMock).toHaveBeenCalledWith([
      { ids: ['pe-1', 'pe-2'], blockId: null, needsNewBlock: true },
    ])
  })

  it('already-linked exercises show SUPERSET — TAP TO UNLINK; tapping it plans clearing both', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, supersetBlockId: 'blk-1' }),
      exercise({ id: 'pe-2', position: 1, supersetBlockId: 'blk-1' }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    fireEvent.click(screen.getByText('SUPERSET — TAP TO UNLINK'))

    expect(toggleLinkMutateMock).toHaveBeenCalledWith([
      { ids: ['pe-1'], blockId: null, needsNewBlock: false },
      { ids: ['pe-2'], blockId: null, needsNewBlock: false },
    ])
  })

  it('stays interactive and visible even when volumeReadOnly (grouping is a design field, not volume)', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0 }),
      exercise({ id: 'pe-2', position: 1 }),
    ]
    render(<StepExercises program={program()} volumeReadOnly />)

    const toggle = screen.getByText('LINK AS SUPERSET')
    expect(toggle).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggleLinkMutateMock).toHaveBeenCalled()
  })

  it('reorder moves a 2-member block as one unit past a neighbouring single exercise', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, supersetBlockId: 'blk-1', exercise: { ...exercise().exercise!, name: 'Bench Press' } }),
      exercise({ id: 'pe-2', position: 1, supersetBlockId: 'blk-1', exercise: { ...exercise().exercise!, name: 'Incline Press' } }),
      exercise({ id: 'pe-3', position: 2, exercise: { ...exercise().exercise!, name: 'Dips' } }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    // Exactly one up/down pair for the whole 2-member block (shown on its
    // first member only), plus one more pair for the trailing single — not
    // one pair per row.
    const downButtons = screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-chevron-down'))
    expect(downButtons).toHaveLength(2)
    fireEvent.click(downButtons[0]) // moves [pe-1, pe-2] down past pe-3

    expect(reorderMutateMock).toHaveBeenCalledWith([
      { id: 'pe-3', position: 0 },
      { id: 'pe-1', position: 1 },
      { id: 'pe-2', position: 2 },
    ])
  })
})

describe('StepExercises — rest / rest after / superset rest (chunk 16, never gated by volumeReadOnly)', () => {
  it('an exercise\'s own REST and REST AFTER steppers write restSeconds/restAfterSeconds, even when volumeReadOnly', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0, restSeconds: null, restAfterSeconds: null })]
    render(<StepExercises program={program()} volumeReadOnly />)

    expect(screen.getByText('GLOBAL')).toBeTruthy() // REST, no override
    expect(screen.getByText('NONE')).toBeTruthy() // REST AFTER, no override

    const plusButtons = screen.getAllByText('+')
    fireEvent.click(plusButtons[0]) // REST's own +15s
    expect(updateRestMutateMock).toHaveBeenCalledWith({ id: 'pe-1', changes: { restSeconds: 15 } })

    fireEvent.click(plusButtons[1]) // REST AFTER's own +15s
    expect(updateRestMutateMock).toHaveBeenCalledWith({ id: 'pe-1', changes: { restAfterSeconds: 15 } })
  })

  it('a linked block shows its own WITHIN ROUND / AFTER ROUND steppers once, writing restWithinRoundSeconds/restAfterRoundSeconds', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, supersetBlockId: 'blk-1' }),
      exercise({ id: 'pe-2', position: 1, supersetBlockId: 'blk-1' }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    expect(screen.getByText('WITHIN ROUND')).toBeTruthy()
    expect(screen.getByText('AFTER ROUND')).toBeTruthy()
    // Exactly one of each — rendered once per block (its last member), not
    // once per member.
    expect(screen.getAllByText('NO TIMER')).toHaveLength(1)
    expect(screen.getAllByText('PER EXERCISE')).toHaveLength(1)

    fireEvent.click(screen.getByText('NO TIMER').parentElement!.querySelector('button:last-of-type')!)
    expect(updateBlockRestMutateMock).toHaveBeenCalledWith({ id: 'blk-1', changes: { restWithinRoundSeconds: 15 } })
  })

  it('375px: the per-exercise rest steppers and a block\'s own rest editor carry no fixed pixel width wider than 375px', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, supersetBlockId: 'blk-1', restSeconds: 45, restAfterSeconds: 90 }),
      exercise({ id: 'pe-2', position: 1, supersetBlockId: 'blk-1' }),
    ]
    const { container } = render(<StepExercises program={program()} volumeReadOnly={false} />)
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

// Chunk 17 (SPEC "Tempo") — TempoEditor lives in the same row as REST/REST
// AFTER (ExerciseRow), so these mirror that describe block's own shape:
// same mock hook (useUpdateProgramExerciseTempo), same "even when
// volumeReadOnly" proof.
describe('StepExercises — tempo (chunk 17, never gated by volumeReadOnly)', () => {
  it('shows "—" with no tempo', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0 })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    expect(screen.getByText('—')).toBeTruthy()
  })

  it('shows the exercise\'s own tempo text when set', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0, tempo: '3-1-1-0' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    expect(screen.getByText('3-1-1-0')).toBeTruthy()
  })

  it('a valid entry writes the normalised tempo via updateProgramExerciseTempo, even when volumeReadOnly', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0 })]
    render(<StepExercises program={program()} volumeReadOnly />)

    fireEvent.click(screen.getByText('—'))
    const input = screen.getByPlaceholderText('3-1-1-0')
    fireEvent.change(input, { target: { value: '3-1-x-0' } }) // lowercase x
    fireEvent.blur(input)

    // normaliseTempo upper-cases the X (chunk 2) — the editor writes exactly
    // what the parser returns, never the raw input.
    expect(updateTempoMutateMock).toHaveBeenCalledWith({ id: 'pe-1', tempo: '3-1-X-0' })
  })

  it('an invalid entry is refused with an inline message, and nothing is written', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0 })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    fireEvent.click(screen.getByText('—'))
    const input = screen.getByPlaceholderText('3-1-1-0')
    fireEvent.change(input, { target: { value: 'not-a-tempo' } })
    fireEvent.blur(input)

    expect(updateTempoMutateMock).not.toHaveBeenCalled()
    expect(screen.getByText(/use 4 fields/i)).toBeTruthy()
    // The raw (unparsed) input is still right there, not silently cleared.
    expect((input as HTMLInputElement).value).toBe('not-a-tempo')
  })

  it('clearing the field writes null', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0, tempo: '3-1-1-0' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    fireEvent.click(screen.getByText('3-1-1-0'))
    const input = screen.getByPlaceholderText('3-1-1-0')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(updateTempoMutateMock).toHaveBeenCalledWith({ id: 'pe-1', tempo: null })
  })
})

// Chunk 18 (SPEC "Warmup routine") — WarmupRoutineEditor lives below the
// exercise list, inside the same per-workout box. Every fixture here keeps
// exercisesByDay empty unless a test says otherwise, so the only
// up/down/delete icon buttons rendered belong to warmup items, not exercise
// rows — same isolation precedent the reorder/superset describe blocks
// above already rely on for their own icon-button queries.
describe('StepExercises — warmup routine checklist (chunk 18, never gated by volumeReadOnly)', () => {
  it('empty: shows NO WARMUP ITEMS YET and an ADD ITEM affordance, even when volumeReadOnly', () => {
    workoutDays = [day({ id: 'wd-1' })]
    render(<StepExercises program={program()} volumeReadOnly />)

    expect(screen.getByText('NO WARMUP ITEMS YET')).toBeTruthy()
    expect(screen.getByText('ADD ITEM')).toBeTruthy()
  })

  it('shows existing items in position order', () => {
    workoutDays = [day({ id: 'wd-1' })]
    warmupItemsByDay['wd-1'] = [
      warmupItem({ id: 'wi-1', position: 0, body: 'Bike 5 min' }),
      warmupItem({ id: 'wi-2', position: 1, body: 'Band pull-aparts' }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    expect(screen.getByText('Bike 5 min')).toBeTruthy()
    expect(screen.getByText('Band pull-aparts')).toBeTruthy()
  })

  it('add: typing text and submitting calls useAddWarmupItem with the trimmed body and the next position, even when volumeReadOnly', () => {
    workoutDays = [day({ id: 'wd-1' })]
    warmupItemsByDay['wd-1'] = [warmupItem({ id: 'wi-1', position: 0, body: 'Bike 5 min' })]
    render(<StepExercises program={program()} volumeReadOnly />)

    fireEvent.click(screen.getByText('ADD ITEM'))
    const input = screen.getByLabelText('New warmup item')
    fireEvent.change(input, { target: { value: '  Jumping jacks  ' } })
    fireEvent.click(screen.getByText('ADD'))

    expect(addWarmupItemMutateAsyncMock).toHaveBeenCalledWith({ body: 'Jumping jacks', position: 1 })
  })

  it('add: a blank entry is refused — nothing is written, the add form stays open', () => {
    workoutDays = [day({ id: 'wd-1' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    fireEvent.click(screen.getByText('ADD ITEM'))
    const input = screen.getByLabelText('New warmup item')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('ADD'))

    expect(addWarmupItemMutateAsyncMock).not.toHaveBeenCalled()
    expect(screen.getByLabelText('New warmup item')).toBeTruthy() // still open
  })

  it('edit: tap-to-edit text, blur commits the trimmed body via useUpdateWarmupItemBody, even when volumeReadOnly', () => {
    workoutDays = [day({ id: 'wd-1' })]
    warmupItemsByDay['wd-1'] = [warmupItem({ id: 'wi-1', position: 0, body: 'Bike 5 min' })]
    render(<StepExercises program={program()} volumeReadOnly />)

    fireEvent.click(screen.getByText('Bike 5 min'))
    const input = screen.getByLabelText('Warmup item text')
    fireEvent.change(input, { target: { value: '  Rower 5 min  ' } })
    fireEvent.blur(input)

    expect(updateWarmupItemMutateMock).toHaveBeenCalledWith({ id: 'wi-1', body: 'Rower 5 min' })
  })

  it('edit: a blank entry is refused — nothing is written, the original text is still shown', () => {
    workoutDays = [day({ id: 'wd-1' })]
    warmupItemsByDay['wd-1'] = [warmupItem({ id: 'wi-1', position: 0, body: 'Bike 5 min' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    fireEvent.click(screen.getByText('Bike 5 min'))
    const input = screen.getByLabelText('Warmup item text')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)

    expect(updateWarmupItemMutateMock).not.toHaveBeenCalled()
    expect(screen.getByText('Bike 5 min')).toBeTruthy()
  })

  it('remove: the delete icon opens a confirm sheet; confirming calls useRemoveWarmupItem with the item id, even when volumeReadOnly', () => {
    workoutDays = [day({ id: 'wd-1' })]
    warmupItemsByDay['wd-1'] = [warmupItem({ id: 'wi-1', position: 0, body: 'Bike 5 min' })]
    render(<StepExercises program={program()} volumeReadOnly />)

    const deleteButtons = screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-trash2'))
    expect(deleteButtons).toHaveLength(1)
    fireEvent.click(deleteButtons[0])

    expect(screen.getByText('Remove this item?')).toBeTruthy()
    fireEvent.click(screen.getByText('REMOVE'))

    expect(removeWarmupItemMutateMock).toHaveBeenCalledWith('wi-1')
  })

  it('reorder: moving the second item up swaps its position with the first, with dense positions, even when volumeReadOnly', () => {
    workoutDays = [day({ id: 'wd-1' })]
    warmupItemsByDay['wd-1'] = [
      warmupItem({ id: 'wi-1', position: 0, body: 'Bike 5 min' }),
      warmupItem({ id: 'wi-2', position: 1, body: 'Band pull-aparts' }),
    ]
    render(<StepExercises program={program()} volumeReadOnly />)

    const upButtons = screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-chevron-up'))
    expect(upButtons).toHaveLength(2) // one per item — a flat list, no grouping
    fireEvent.click(upButtons[1]) // "Band pull-aparts" own up arrow

    expect(reorderWarmupItemsMutateMock).toHaveBeenCalledWith([
      { id: 'wi-2', position: 0 },
      { id: 'wi-1', position: 1 },
    ])
  })

  it('the first item\'s own up arrow and the last item\'s own down arrow are disabled', () => {
    workoutDays = [day({ id: 'wd-1' })]
    warmupItemsByDay['wd-1'] = [
      warmupItem({ id: 'wi-1', position: 0, body: 'Bike 5 min' }),
      warmupItem({ id: 'wi-2', position: 1, body: 'Band pull-aparts' }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    const upButtons = screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-chevron-up')) as HTMLButtonElement[]
    const downButtons = screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-chevron-down')) as HTMLButtonElement[]
    expect(upButtons[0].disabled).toBe(true)
    expect(downButtons[1].disabled).toBe(true)
    expect(upButtons[1].disabled).toBe(false)
    expect(downButtons[0].disabled).toBe(false)
  })

  it('375px: no element carries a fixed pixel width wider than 375px', () => {
    workoutDays = [day({ id: 'wd-1' })]
    warmupItemsByDay['wd-1'] = [warmupItem({ id: 'wi-1', position: 0, body: 'Bike 5 min' })]
    const { container } = render(<StepExercises program={program()} volumeReadOnly={false} />)
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
