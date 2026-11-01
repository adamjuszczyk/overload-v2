// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import type { Exercise, Program, WorkoutDay, ProgramExercise, WarmupRoutineItem, SequenceItem } from '../../types'
import { queryClient } from '../../lib/queryClient'
import { pickTempo } from '../../components/pickers/tempoPicker.testutil'

// Chunk 11 — step 2 (exercises, order, weekday). Heavy-mocked at the hook
// boundary, same precedent as ProgramPage.test.tsx/PrioritiesEditor.test.tsx:
// usePrograms.ts's hooks value-import the real Supabase client at module
// load.
//
// Chunk 68 redraws the step as boards PP2–PP6 do over every write it had: a workout is a card (the first open, the others shut), an
// exercise is a row that opens in place to its editors, a link is the small box in the rail, the add sheet is the shared picker and every
// confirm is the app's dialog. What changed in this file is how a control is found (it is opened first, or it has the board's label) and the
// board's words; every `expect` on a hook's call is as it was.

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
const addExerciseMutateAsyncMock = vi.fn()
// The workout day each `useAddProgramExercise` call was built for (chunk 68's review R1: the mock used to ignore its argument).
const addHookArgs: string[] = []
// What the settings query says (chunk 68: the add sheet reads the unit to write from it, never from the store, which stays 'kg' here).
let settingsUnit: 'kg' | 'lbs' = 'kg'
let settingsLoading = false
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
  useAddProgramExercise: (workoutDayId: string) => {
    addHookArgs.push(workoutDayId)
    return { mutateAsync: addExerciseMutateAsyncMock, isPending: false }
  },
  useReorderProgramExercises: () => ({ mutate: reorderMutateMock, isPending: false }),
  useDeleteProgramExercise: () => ({ mutate: deleteExerciseMutateMock, isPending: false }),
  useUpdateProgramExerciseWeightUnit: () => ({ mutate: updateWeightUnitMutateMock, isPending: false }),
  useUpdateProgramExerciseRest: () => ({ mutate: updateRestMutateMock, isPending: false }),
  // Chunk 17 (SPEC "Tempo") — same "not this test file's own concern" posture
  // as useSupersetBlockRests below; the tempo describe block is the
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

vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({ data: { weightUnit: settingsUnit }, isLoading: settingsLoading }),
}))

// The shared picker's stand-in (chunk 41's ExercisePickerSheet has its own 63 checks): it records the props the planner gives it, lists the
// library without what `exclude` names, and calls `onPick` with a whole Exercise, as the real one does.
const LIBRARY: Exercise[] = ['Barbell Row', 'Lat Pulldown', 'Face Pull'].map((name, i) => ({
  id: `lib-${i + 1}`, userId: 'user-1', name, muscleGroup: 'back', isArchived: false, createdAt: '2026-01-01T00:00:00Z',
  muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}))
const pickerProps: { current: Record<string, unknown> | null } = { current: null }
vi.mock('../../components/ExercisePickerSheet', () => ({
  default: (props: { mode: string; eyebrow?: string; title: string; exclude?: readonly string[]; onPick: (exercise: Exercise) => void; onClose: () => void }) => {
    pickerProps.current = props as unknown as Record<string, unknown>
    return (
      <div role="dialog" aria-label="picker stand-in">
        <span>{props.eyebrow}</span>
        <span>{props.title}</span>
        {LIBRARY.filter((e) => !(props.exclude ?? []).includes(e.id)).map((e) => (
          <button key={e.id} type="button" onClick={() => props.onPick(e)}>
            {`pick ${e.name}`}
          </button>
        ))}
        <button type="button" onClick={props.onClose}>close picker</button>
      </div>
    )
  },
}))

const { default: StepExercises } = await import('./StepExercises')

afterEach(() => {
  cleanup()
  queryClient.clear()
  createDayMutateAsyncMock.mockReset()
  updateNameMutateAsyncMock.mockReset()
  deleteDayMutateMock.mockReset()
  reorderMutateMock.mockReset()
  addExerciseMutateAsyncMock.mockReset()
  deleteExerciseMutateMock.mockReset()
  updateRestMutateMock.mockReset()
  updateBlockRestMutateMock.mockReset()
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
  settingsUnit = 'kg'
  settingsLoading = false
  pickerProps.current = null
  addHookArgs.length = 0
})

// An exercise's row is shut until it is tapped (PP2): its editors are in the open one.
const openExercise = (name: string) => fireEvent.click(screen.getByLabelText(`Edit ${name}`))

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

  it('a workout with no exercises shows the SPEC empty state, board PP6\'s "+ ADD AN EXERCISE", and no warmup items yet', () => {
    workoutDays = [day()]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    expect(screen.getByText('ADD AN EXERCISE')).toBeTruthy()
    expect(screen.getByText('WARMUP ROUTINE')).toBeTruthy()
    expect(screen.getByText('NO WARMUP ITEMS YET')).toBeTruthy()
    expect(screen.getByText('ADD ITEM')).toBeTruthy()
  })

  it('read-only: a workout with no exercises shows NO EXERCISES YET, not an add button', () => {
    workoutDays = [day()]
    render(<StepExercises program={program()} volumeReadOnly />)
    expect(screen.getByText('NO EXERCISES YET')).toBeTruthy()
    expect(screen.queryByText('ADD AN EXERCISE')).toBeNull()
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

    openExercise('Incline Press')
    fireEvent.click(screen.getByLabelText('Move Incline Press up')) // Incline Press's own "up"

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

describe('StepExercises — superset grouping (chunk 13, never gated by volumeReadOnly)', () => {
  it('two ungrouped exercises show LINK AS SUPERSET; tapping it plans a new shared block', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0 }),
      exercise({ id: 'pe-2', position: 1 }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    // the board's link: a small box in the rail between two rows, named for the pair (PP2)
    expect(screen.getByLabelText('Link Bench Press and Bench Press as superset').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByLabelText('Link Bench Press and Bench Press as superset'))

    expect(toggleLinkMutateMock).toHaveBeenCalledWith([
      { ids: ['pe-1', 'pe-2'], blockId: null, needsNewBlock: true },
    ])
  })

  it('W: the link between the SECOND and THIRD of three exercises plans that pair, not the first', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, exercise: { ...exercise().exercise!, name: 'Bench Press' } }),
      exercise({ id: 'pe-2', position: 1, exercise: { ...exercise().exercise!, name: 'Incline Press' } }),
      exercise({ id: 'pe-3', position: 2, exercise: { ...exercise().exercise!, name: 'Dips' } }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    fireEvent.click(screen.getByLabelText('Link Incline Press and Dips as superset'))
    expect(toggleLinkMutateMock).toHaveBeenCalledWith([{ ids: ['pe-2', 'pe-3'], blockId: null, needsNewBlock: true }])
  })

  it('the link sits above the rows it overlaps (z-index 1 on its rule): its 44 px target reaches into the next row, whose positioned rail would take the lower half of a tap (found in Chromium, where jsdom sees no layout)', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, exercise: { ...exercise().exercise!, name: 'Bench Press' } }),
      exercise({ id: 'pe-2', position: 1, exercise: { ...exercise().exercise!, name: 'Incline Press' } }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    expect(screen.getByLabelText('Link Bench Press and Incline Press as superset').parentElement!.style.zIndex).toBe('1')
  })

  it('already-linked exercises show their link pressed; tapping it plans clearing both', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, supersetBlockId: 'blk-1' }),
      exercise({ id: 'pe-2', position: 1, supersetBlockId: 'blk-1' }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    expect(screen.getByLabelText('Unlink Bench Press and Bench Press').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByLabelText('Unlink Bench Press and Bench Press'))

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

    const toggle = screen.getByLabelText('Link Bench Press and Bench Press as superset')
    expect(toggle).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggleLinkMutateMock).toHaveBeenCalled()
  })

  it('reorder moves a 2-member block as one unit past a neighbouring single exercise (the superset’s own row: 1.2.1 item 2; this test moved there from a member’s arrows)', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, supersetBlockId: 'blk-1', exercise: { ...exercise().exercise!, name: 'Bench Press' } }),
      exercise({ id: 'pe-2', position: 1, supersetBlockId: 'blk-1', exercise: { ...exercise().exercise!, name: 'Incline Press' } }),
      exercise({ id: 'pe-3', position: 2, exercise: { ...exercise().exercise!, name: 'Dips' } }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    // The block has one pair of arrows on its own row, with every exercise shut, and it moves the whole block.
    expect(screen.getAllByRole('button').filter((b) => b.querySelector('svg.lucide-chevron-down'))).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Move superset A down')) // moves [pe-1, pe-2] down past pe-3

    expect(reorderMutateMock).toHaveBeenCalledWith([
      { id: 'pe-3', position: 0 },
      { id: 'pe-1', position: 1 },
      { id: 'pe-2', position: 2 },
    ])
    // the same block, opened at either member: the member’s arrows move the member inside the block now, and the whole block stays where it is
    reorderMutateMock.mockClear()
    openExercise('Incline Press')
    fireEvent.click(screen.getByLabelText('Move Incline Press up'))
    expect(reorderMutateMock).toHaveBeenCalledWith([
      { id: 'pe-2', position: 0 },
      { id: 'pe-1', position: 1 },
    ])
  })
})

// 1.2.1 item 2 (SPEC Planner, step 2; prototype "Pull 1 with a superset"): a superset has its own row above its first member, with its letter, how many
// exercises it holds and ↑ ↓ that move the whole superset; a member's ↑ ↓ move it past the member next to it, inside the superset only, and are greyed at
// the superset's edges; a single exercise is as it was. The prototype's Pull 1 is the world: Lat Pulldown, a trio (Seated Cable Row, Face Pull, Rear
// Delt Fly) and EZ Bar Curl, and the members' places are told apart by their ids, so a write that lands on the wrong exercise fails.
describe('StepExercises — a superset’s own row and its members’ arrows (1.2.1 item 2)', () => {
  const named = (name: string) => ({ ...exercise().exercise!, name })
  /** Lat Pulldown, the trio A/B/C, EZ Bar Curl — in the places given (0 to 4 unless a test gives others). */
  function pull(places: number[] = [0, 1, 2, 3, 4]): ProgramExercise[] {
    return [
      exercise({ id: 'pe-lat', position: places[0], exercise: named('Lat Pulldown') }),
      exercise({ id: 'pe-row', position: places[1], supersetBlockId: 'blk-1', exercise: named('Seated Cable Row') }),
      exercise({ id: 'pe-face', position: places[2], supersetBlockId: 'blk-1', exercise: named('Face Pull') }),
      exercise({ id: 'pe-fly', position: places[3], supersetBlockId: 'blk-1', exercise: named('Rear Delt Fly') }),
      exercise({ id: 'pe-ez', position: places[4], exercise: named('EZ Bar Curl') }),
    ]
  }
  const draw = (list: ProgramExercise[], volumeReadOnly = false) => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = list
    return render(<StepExercises program={program()} volumeReadOnly={volumeReadOnly} />)
  }
  const arrow = (label: string) => screen.getByLabelText(label) as HTMLButtonElement
  const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
  // The list the move holds at once (the planner's own query key), read from the cache the mocked hook doesn't use.
  const cachedList = () => {
    const list = queryClient.getQueryData<ProgramExercise[]>(['v2_programExercises', 'wd-1'])
    expect(list, 'the move holds the new order in the cache').toBeTruthy()
    return list!
  }
  const cachedOrder = () => cachedList().map((e) => e.id)

  it('a superset has its own row above its first member: its letter and how many exercises, between the exercise before it and the first member; a single exercise has none', () => {
    draw(pull())
    const header = screen.getByText('SUPERSET A · 3 EXERCISES')
    expect(screen.getAllByText(/^SUPERSET [A-Z] · \d+ EXERCISES$/)).toHaveLength(1)
    const order = [screen.getByLabelText('Edit Lat Pulldown'), header, screen.getByLabelText('Edit Seated Cable Row'), screen.getByLabelText('Edit Face Pull'), screen.getByLabelText('Edit Rear Delt Fly'), screen.getByLabelText('Edit EZ Bar Curl')]
    for (let i = 1; i < order.length; i++) expect(follows(order[i - 1], order[i])).toBe(true)
    expect(header.parentElement!.querySelector('svg')).toBeTruthy() // the link icon
  })

  it('two supersets in a workout are A and B, each with its own count and its own arrows', () => {
    draw([
      exercise({ id: 'pe-bench', position: 0, supersetBlockId: 'blk-1', exercise: named('Bench Press') }),
      exercise({ id: 'pe-incline', position: 1, supersetBlockId: 'blk-1', exercise: named('Incline Press') }),
      exercise({ id: 'pe-dips', position: 2, exercise: named('Dips') }),
      exercise({ id: 'pe-row', position: 3, supersetBlockId: 'blk-2', exercise: named('Row') }),
      exercise({ id: 'pe-pulldown', position: 4, supersetBlockId: 'blk-2', exercise: named('Pulldown') }),
      exercise({ id: 'pe-curl', position: 5, supersetBlockId: 'blk-2', exercise: named('Curl') }),
    ])
    expect(screen.getAllByText(/^SUPERSET [A-Z] · \d+ EXERCISES$/).map((n) => n.textContent)).toEqual(['SUPERSET A · 2 EXERCISES', 'SUPERSET B · 3 EXERCISES'])
    fireEvent.click(arrow('Move superset B up')) // past Dips, not past a member of A
    expect(reorderMutateMock).toHaveBeenCalledWith([
      { id: 'pe-bench', position: 0 },
      { id: 'pe-incline', position: 1 },
      { id: 'pe-row', position: 2 },
      { id: 'pe-pulldown', position: 3 },
      { id: 'pe-curl', position: 4 },
      { id: 'pe-dips', position: 5 },
    ])
  })

  it('the row’s ↑ moves the whole superset above the exercise before it, and its ↓ below the one after, with every exercise shut', () => {
    draw(pull())
    fireEvent.click(arrow('Move superset A up'))
    expect(reorderMutateMock).toHaveBeenLastCalledWith([
      { id: 'pe-row', position: 0 },
      { id: 'pe-face', position: 1 },
      { id: 'pe-fly', position: 2 },
      { id: 'pe-lat', position: 3 },
      { id: 'pe-ez', position: 4 },
    ])
    fireEvent.click(arrow('Move superset A down'))
    expect(reorderMutateMock).toHaveBeenLastCalledWith([
      { id: 'pe-lat', position: 0 },
      { id: 'pe-ez', position: 1 },
      { id: 'pe-row', position: 2 },
      { id: 'pe-face', position: 3 },
      { id: 'pe-fly', position: 4 },
    ])
  })

  it('the row’s arrows are greyed at the edges of the list: ↑ on the first unit, ↓ on the last, and neither when it is the only unit', () => {
    const [lat, row, face, fly, ez] = pull()
    draw([row, face, fly, lat, ez])
    expect(arrow('Move superset A up').disabled).toBe(true)
    expect(arrow('Move superset A down').disabled).toBe(false)
    fireEvent.click(arrow('Move superset A up'))
    expect(reorderMutateMock).not.toHaveBeenCalled()
    cleanup()
    draw([lat, ez, row, face, fly])
    expect(arrow('Move superset A up').disabled).toBe(false)
    expect(arrow('Move superset A down').disabled).toBe(true)
    fireEvent.click(arrow('Move superset A down'))
    expect(reorderMutateMock).not.toHaveBeenCalled()
    cleanup()
    draw([row, face, fly])
    expect(arrow('Move superset A up').disabled).toBe(true)
    expect(arrow('Move superset A down').disabled).toBe(true)
    cleanup()
    draw(pull())
    expect(arrow('Move superset A up').disabled).toBe(false)
    expect(arrow('Move superset A down').disabled).toBe(false)
  })

  it('the row stays and its arrows go when volumeReadOnly: moving is reordering, which a run’s copy refuses', () => {
    draw(pull(), true)
    expect(screen.getByText('SUPERSET A · 3 EXERCISES')).toBeTruthy()
    expect(screen.queryByLabelText('Move superset A up')).toBeNull()
    expect(screen.queryByLabelText('Move superset A down')).toBeNull()
    openExercise('Face Pull')
    expect(screen.queryByLabelText('Move Face Pull up')).toBeNull()
    expect(screen.queryByLabelText('Move Face Pull down')).toBeNull()
  })

  it('the middle member’s ↑ swaps it with the member above, and only those two places are written; the block is as it was', () => {
    draw(pull())
    openExercise('Face Pull')
    expect(arrow('Move Face Pull up').disabled).toBe(false)
    expect(arrow('Move Face Pull down').disabled).toBe(false)
    fireEvent.click(arrow('Move Face Pull up'))
    expect(reorderMutateMock).toHaveBeenCalledTimes(1)
    expect(reorderMutateMock).toHaveBeenCalledWith([
      { id: 'pe-face', position: 1 },
      { id: 'pe-row', position: 2 },
    ])
    // the list is held in its new order at once, the exercises outside the block where they were, the block still one block
    expect(cachedOrder()).toEqual(['pe-lat', 'pe-face', 'pe-row', 'pe-fly', 'pe-ez'])
    expect(cachedList().map((e) => e.supersetBlockId ?? null)).toEqual([null, 'blk-1', 'blk-1', 'blk-1', null])
    expect(cachedList().map((e) => e.position)).toEqual([0, 1, 2, 3, 4])
    expect(toggleLinkMutateMock).not.toHaveBeenCalled()
    expect(updateBlockRestMutateMock).not.toHaveBeenCalled()
  })

  it('the middle member’s ↓ swaps it with the member below, and only those two places are written', () => {
    draw(pull())
    openExercise('Face Pull')
    fireEvent.click(arrow('Move Face Pull down'))
    expect(reorderMutateMock).toHaveBeenCalledTimes(1)
    expect(reorderMutateMock).toHaveBeenCalledWith([
      { id: 'pe-fly', position: 2 },
      { id: 'pe-face', position: 3 },
    ])
    expect(cachedOrder()).toEqual(['pe-lat', 'pe-row', 'pe-fly', 'pe-face', 'pe-ez'])
  })

  it('the first member’s ↑ and the last member’s ↓ are greyed, the superset’s edges, and a press there writes nothing; the other arrow of each works', () => {
    draw(pull())
    openExercise('Seated Cable Row')
    expect(arrow('Move Seated Cable Row up').disabled).toBe(true) // Lat Pulldown is above, outside the superset
    expect(arrow('Move Seated Cable Row down').disabled).toBe(false)
    fireEvent.click(arrow('Move Seated Cable Row up'))
    expect(reorderMutateMock).not.toHaveBeenCalled()
    fireEvent.click(arrow('Move Seated Cable Row down'))
    expect(reorderMutateMock).toHaveBeenLastCalledWith([
      { id: 'pe-face', position: 1 },
      { id: 'pe-row', position: 2 },
    ])
    reorderMutateMock.mockClear()
    fireEvent.click(screen.getByLabelText('Close Seated Cable Row'))
    openExercise('Rear Delt Fly')
    expect(arrow('Move Rear Delt Fly down').disabled).toBe(true) // EZ Bar Curl is below, outside the superset
    expect(arrow('Move Rear Delt Fly up').disabled).toBe(false)
    fireEvent.click(arrow('Move Rear Delt Fly down'))
    expect(reorderMutateMock).not.toHaveBeenCalled()
    fireEvent.click(arrow('Move Rear Delt Fly up'))
    expect(reorderMutateMock).toHaveBeenLastCalledWith([
      { id: 'pe-fly', position: 2 },
      { id: 'pe-face', position: 3 },
    ])
  })

  it('a member does not leave its superset for the one beside it: two supersets one above the other keep their edges', () => {
    draw([
      exercise({ id: 'pe-bench', position: 0, supersetBlockId: 'blk-1', exercise: named('Bench Press') }),
      exercise({ id: 'pe-incline', position: 1, supersetBlockId: 'blk-1', exercise: named('Incline Press') }),
      exercise({ id: 'pe-row', position: 2, supersetBlockId: 'blk-2', exercise: named('Row') }),
      exercise({ id: 'pe-pulldown', position: 3, supersetBlockId: 'blk-2', exercise: named('Pulldown') }),
    ])
    openExercise('Incline Press')
    expect(arrow('Move Incline Press down').disabled).toBe(true) // Row is the next exercise, in the other superset
    expect(arrow('Move Incline Press up').disabled).toBe(false)
    fireEvent.click(screen.getByLabelText('Close Incline Press'))
    openExercise('Row')
    expect(arrow('Move Row up').disabled).toBe(true)
    expect(arrow('Move Row down').disabled).toBe(false)
  })

  it('a single exercise is as it was: its arrows move it past the neighbouring unit, a whole superset and not one member of it', () => {
    draw(pull())
    openExercise('Lat Pulldown')
    expect(arrow('Move Lat Pulldown up').disabled).toBe(true)
    fireEvent.click(arrow('Move Lat Pulldown down'))
    expect(reorderMutateMock).toHaveBeenLastCalledWith([
      { id: 'pe-row', position: 0 },
      { id: 'pe-face', position: 1 },
      { id: 'pe-fly', position: 2 },
      { id: 'pe-lat', position: 3 },
      { id: 'pe-ez', position: 4 },
    ])
    reorderMutateMock.mockClear()
    fireEvent.click(screen.getByLabelText('Close Lat Pulldown'))
    openExercise('EZ Bar Curl')
    expect(arrow('Move EZ Bar Curl down').disabled).toBe(true)
    fireEvent.click(arrow('Move EZ Bar Curl up'))
    expect(reorderMutateMock).toHaveBeenLastCalledWith([
      { id: 'pe-lat', position: 0 },
      { id: 'pe-ez', position: 1 },
      { id: 'pe-row', position: 2 },
      { id: 'pe-face', position: 3 },
      { id: 'pe-fly', position: 4 },
    ])
  })

  // A delete leaves a gap in the stored places and the next add takes the last place twice, so the stored places are not always 0, 1, 2 … The move
  // holds the list to its indexes, as the whole-superset move always has, and sends the exercises whose stored place is not their index now.
  it('with a gap in the stored places the move puts them right: the exercises whose place is not their index are written, the two that swapped among them', () => {
    draw(pull([0, 2, 3, 4, 7]))
    openExercise('Face Pull')
    fireEvent.click(arrow('Move Face Pull up'))
    expect(reorderMutateMock).toHaveBeenCalledTimes(1)
    expect(reorderMutateMock).toHaveBeenCalledWith([
      { id: 'pe-face', position: 1 },
      { id: 'pe-fly', position: 3 },
      { id: 'pe-ez', position: 4 },
    ])
  })

  it('with two exercises in one place the move breaks the tie, and what it writes is every place that is not its index', () => {
    draw(pull([0, 1, 2, 3, 3]))
    openExercise('Face Pull')
    fireEvent.click(arrow('Move Face Pull up'))
    expect(reorderMutateMock).toHaveBeenCalledWith([
      { id: 'pe-face', position: 1 },
      { id: 'pe-row', position: 2 },
      { id: 'pe-ez', position: 4 },
    ])
  })
})

describe('StepExercises — rest / rest after / superset rest (chunk 16, never gated by volumeReadOnly)', () => {
  it('an exercise\'s own REST and REST AFTER steppers write restSeconds/restAfterSeconds, even when volumeReadOnly', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0, restSeconds: null, restAfterSeconds: null })]
    render(<StepExercises program={program()} volumeReadOnly />)

    openExercise('Bench Press')
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
      exercise({ id: 'pe-2', position: 1, supersetBlockId: 'blk-1', exercise: { ...exercise().exercise!, name: 'Incline Press' } }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    // Nothing of a block's rests on the shut rows; the open member carries them (PP2: SUPERSET REST), once (one exercise is open at a time).
    expect(screen.queryByText('WITHIN ROUND')).toBeNull()
    openExercise('Bench Press')
    expect(screen.getByText('SUPERSET REST')).toBeTruthy()
    expect(screen.getByText('WITHIN ROUND')).toBeTruthy()
    expect(screen.getByText('AFTER ROUND')).toBeTruthy()
    expect(screen.getAllByText('NO TIMER')).toHaveLength(1)
    expect(screen.getAllByText('PER EXERCISE')).toHaveLength(1)

    fireEvent.click(screen.getByLabelText('More rest within round'))
    expect(updateBlockRestMutateMock).toHaveBeenCalledWith({ id: 'blk-1', changes: { restWithinRoundSeconds: 15 } })
    fireEvent.click(screen.getByLabelText('More rest after round'))
    expect(updateBlockRestMutateMock).toHaveBeenCalledWith({ id: 'blk-1', changes: { restAfterRoundSeconds: 15 } })
  })

  it('a block\'s rest is the same from either member: the second member writes the same block', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, supersetBlockId: 'blk-1', exercise: { ...exercise().exercise!, name: 'Bench Press' } }),
      exercise({ id: 'pe-2', position: 1, supersetBlockId: 'blk-1', exercise: { ...exercise().exercise!, name: 'Incline Press' } }),
      exercise({ id: 'pe-3', position: 2, exercise: { ...exercise().exercise!, name: 'Dips' } }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    openExercise('Incline Press')
    fireEvent.click(screen.getByLabelText('More rest after round'))
    expect(updateBlockRestMutateMock).toHaveBeenCalledWith({ id: 'blk-1', changes: { restAfterRoundSeconds: 15 } })

    fireEvent.click(screen.getByLabelText('Close Incline Press'))
    openExercise('Dips') // not in a block: no SUPERSET REST
    expect(screen.queryByText('SUPERSET REST')).toBeNull()
  })

  it('375px: the per-exercise rest steppers and a block\'s own rest editor carry no fixed pixel width wider than 375px', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, supersetBlockId: 'blk-1', restSeconds: 45, restAfterSeconds: 90 }),
      exercise({ id: 'pe-2', position: 1, supersetBlockId: 'blk-1', exercise: { ...exercise().exercise!, name: 'Incline Press' } }),
    ]
    const { container } = render(<StepExercises program={program()} volumeReadOnly={false} />)
    openExercise('Bench Press')
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

// Chunk 17 (SPEC "Tempo") — the TEMPO row lives in the same open exercise as REST/REST AFTER, so these mirror that describe block's own shape: same mock
// hook (useUpdateProgramExerciseTempo), same "even when volumeReadOnly" proof. Since 1.2.1 (item 3, SPEC Tempo picker) the row opens the tempo picker in
// place of a text box typed with dashes: the picker's own rules (four boxes, X, 0-20) are proven in TempoPicker.test.tsx, and here what the row writes.
describe('StepExercises — tempo (chunk 17, never gated by volumeReadOnly; the tempo picker since 1.2.1)', () => {
  const tempoRow = (name = 'Bench Press') => screen.getByLabelText(`Tempo for ${name}`) as HTMLButtonElement
  const picker = () => screen.getByRole('dialog', { name: 'Tempo' })

  it('shows "—" with no tempo', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0 })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    openExercise('Bench Press')
    expect(screen.getByText('—')).toBeTruthy()
    expect(tempoRow().textContent).toBe('—')
  })

  it('shows the exercise\'s own tempo text when set (on its shut row too: TEMPO 3-1-1-0, PP2)', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0, tempo: '3-1-1-0' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    expect(screen.getByText('TEMPO 3-1-1-0')).toBeTruthy()
    openExercise('Bench Press')
    expect(screen.getByText('3-1-1-0')).toBeTruthy()
    expect(tempoRow().textContent).toBe('3-1-1-0')
  })

  it('a tap on TEMPO opens the tempo picker, named for the exercise, on the tempo it has; there is no text box to type dashes in', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0, tempo: '3-1-1-0' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    openExercise('Bench Press')
    expect(screen.queryByRole('dialog', { name: 'Tempo' })).toBeNull()
    expect(screen.queryByPlaceholderText('3-1-1-0')).toBeNull()
    fireEvent.click(tempoRow())
    expect(within(picker()).getByText('Bench Press')).toBeTruthy() // the eyebrow
    expect((within(picker()).getByRole('textbox', { name: 'Bottom seconds' }) as HTMLInputElement).value).toBe('1')
    expect(within(picker()).getByRole('button', { name: 'SET TEMPO 3-1-1-0' })).toBeTruthy()
  })

  it('a pick writes the picked tempo through onTempo, the text the box wrote (four fields, X in capitals), even when volumeReadOnly', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0 })]
    render(<StepExercises program={program()} volumeReadOnly />)

    openExercise('Bench Press')
    fireEvent.click(tempoRow())
    pickTempo(picker(), '3-1-x-0') // a lowercase x typed in a box, as the text box once took it
    expect(updateTempoMutateMock).toHaveBeenCalledTimes(1)
    expect(updateTempoMutateMock).toHaveBeenCalledWith({ id: 'pe-1', tempo: '3-1-X-0' })
    expect(screen.queryByRole('dialog', { name: 'Tempo' })).toBeNull() // the pick closes the picker
  })

  it('a valid pick is never written as null: SET with the start tempo writes 3-0-1-0, and no call carries a null tempo', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0 })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    openExercise('Bench Press')
    fireEvent.click(tempoRow())
    fireEvent.click(within(picker()).getByRole('button', { name: 'SET' }))
    fireEvent.click(within(picker()).getByRole('button', { name: 'SET TEMPO 3-0-1-0' }))
    expect(updateTempoMutateMock).toHaveBeenCalledWith({ id: 'pe-1', tempo: '3-0-1-0' })
    expect(updateTempoMutateMock.mock.calls.filter(([arg]) => (arg as { tempo: string | null }).tempo === null)).toEqual([])
  })

  it('a pick writes to the exercise whose TEMPO was tapped: the middle one of three, one of them a superset member', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, exercise: { ...exercise().exercise!, name: 'Bench Press' } }),
      exercise({ id: 'pe-2', position: 1, supersetBlockId: 'blk-1', exercise: { ...exercise().exercise!, name: 'Incline Press' } }),
      exercise({ id: 'pe-3', position: 2, supersetBlockId: 'blk-1', exercise: { ...exercise().exercise!, name: 'Dips' } }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    openExercise('Incline Press')
    fireEvent.click(tempoRow('Incline Press'))
    pickTempo(picker(), '2-0-X-1')
    expect(updateTempoMutateMock).toHaveBeenCalledTimes(1)
    expect(updateTempoMutateMock).toHaveBeenCalledWith({ id: 'pe-2', tempo: '2-0-X-1' })
    fireEvent.click(screen.getByLabelText('Close Incline Press'))
    openExercise('Dips')
    fireEvent.click(tempoRow('Dips'))
    pickTempo(picker(), '4-0-1-0')
    expect(updateTempoMutateMock).toHaveBeenLastCalledWith({ id: 'pe-3', tempo: '4-0-1-0' })
  })

  it('NONE writes null: clearing a tempo that was set', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0, tempo: '3-1-1-0' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    openExercise('Bench Press')
    fireEvent.click(tempoRow())
    pickTempo(picker(), '')
    expect(updateTempoMutateMock).toHaveBeenCalledWith({ id: 'pe-1', tempo: null })
  })

  it('a pick that is the tempo already there writes nothing, and closes the picker', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0, tempo: '3-1-1-0' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    openExercise('Bench Press')
    fireEvent.click(tempoRow())
    fireEvent.click(within(picker()).getByRole('button', { name: 'SET TEMPO 3-1-1-0' }))
    expect(updateTempoMutateMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Tempo' })).toBeNull()
    // and with no tempo, NONE is the tempo already there
    cleanup()
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0 })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    openExercise('Bench Press')
    fireEvent.click(tempoRow())
    fireEvent.click(within(picker()).getByRole('button', { name: 'SET NO TEMPO' }))
    expect(updateTempoMutateMock).not.toHaveBeenCalled()
  })

  it('closing the picker (×, Escape) writes nothing', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0, tempo: '3-1-1-0' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    openExercise('Bench Press')
    fireEvent.click(tempoRow())
    fireEvent.click(within(picker()).getByRole('button', { name: 'NONE' }))
    fireEvent.click(within(picker()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Tempo' })).toBeNull()
    fireEvent.click(tempoRow())
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Tempo' })).toBeNull()
    expect(updateTempoMutateMock).not.toHaveBeenCalled()
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

// ─── Chunk 68: the workout cards, the rows, the sheets and the confirms (boards PP2, PP2c, PP2d, PP2e, PP4, PP6) ───────────────────────────

const NO_DAYS = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }

describe('StepExercises — workout cards (PP2, PP6)', () => {
  it('the first workout is open and the others are shut to their name and weekday; a tap opens one and shuts the one that was open', () => {
    workoutDays = [day({ id: 'wd-1', name: 'Push 1' }), day({ id: 'wd-2', name: 'Pull 1', position: 1 })]
    render(<StepExercises program={program({ schedule: { ...NO_DAYS, monday: 'wd-1', tuesday: 'wd-2' } })} volumeReadOnly={false} />)

    expect(screen.getByLabelText('Hide editor for Push 1').getAttribute('aria-expanded')).toBe('true')
    const shut = screen.getByLabelText('Show editor for Pull 1')
    expect(shut.getAttribute('aria-expanded')).toBe('false')
    expect(within(shut).getByText('TUE')).toBeTruthy()
    expect(within(shut).getByText('Pull 1')).toBeTruthy()

    fireEvent.click(shut)
    expect(screen.getByLabelText('Hide editor for Pull 1')).toBeTruthy()
    expect(screen.getByLabelText('Show editor for Push 1')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Hide editor for Pull 1'))
    expect(screen.queryByLabelText(/^Hide editor for/)).toBeNull() // every card shut
  })

  it('a sequence program\'s shut card carries no weekday', () => {
    workoutDays = [day({ id: 'wd-1', name: 'Push 1' }), day({ id: 'wd-2', name: 'Pull 1', position: 1 })]
    render(<StepExercises program={program({ scheduleType: 'sequence', schedule: { ...NO_DAYS, monday: 'wd-2' } })} volumeReadOnly={false} />)
    expect(within(screen.getByLabelText('Show editor for Pull 1')).queryByText('MON')).toBeNull()
  })

  it('W: a day another workout holds is dimmed, as the board draws it, and still writes the day (the write is unchanged)', () => {
    workoutDays = [day({ id: 'wd-1', name: 'Push 1' }), day({ id: 'wd-2', name: 'Pull 1', position: 1 })]
    const schedule = { ...NO_DAYS, monday: 'wd-1', tuesday: 'wd-2' }
    render(<StepExercises program={program({ schedule })} volumeReadOnly={false} />)

    fireEvent.click(screen.getByLabelText('Show editor for Pull 1'))
    const days = within(screen.getByRole('group', { name: 'Weekday' }))
    expect(days.getByText('MON').style.background).toBe('var(--surface-raised)') // Push 1's
    expect(days.getByText('TUE').getAttribute('aria-pressed')).toBe('true')
    expect(days.getByText('WED').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(days.getByText('MON'))
    expect(assignWeekdayMutateMock).toHaveBeenCalledWith({ schedule, workoutDayId: 'wd-2', dow: 'monday' })
  })

  it('W: a tap on the name renames it in place; Enter or a tap away saves the trimmed name, an unchanged name writes nothing', async () => {
    workoutDays = [day({ id: 'wd-1', name: 'Push 1' })]
    updateNameMutateAsyncMock.mockResolvedValue(undefined)
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    fireEvent.click(screen.getByLabelText('Rename Push 1'))
    const input = screen.getByLabelText('Workout name') as HTMLInputElement
    expect(input.value).toBe('Push 1')
    fireEvent.change(input, { target: { value: '  Push A  ' } })
    await act(async () => { fireEvent.blur(input) })
    expect(updateNameMutateAsyncMock).toHaveBeenCalledWith({ id: 'wd-1', name: 'Push A' })

    updateNameMutateAsyncMock.mockClear()
    fireEvent.click(screen.getByLabelText('Rename Push 1'))
    await act(async () => { fireEvent.blur(screen.getByLabelText('Workout name')) })
    expect(updateNameMutateAsyncMock).not.toHaveBeenCalled()
  })

  it('W: the second workout renames and deletes itself (its own id), and its weekday chips write its own id', async () => {
    workoutDays = [day({ id: 'wd-1', name: 'Push 1' }), day({ id: 'wd-2', name: 'Pull 1', position: 1 })]
    const schedule = { ...NO_DAYS, monday: 'wd-1' }
    updateNameMutateAsyncMock.mockResolvedValue(undefined)
    render(<StepExercises program={program({ schedule })} volumeReadOnly={false} />)
    fireEvent.click(screen.getByLabelText('Show editor for Pull 1'))

    fireEvent.click(screen.getByLabelText('Rename Pull 1'))
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Pull A' } })
    await act(async () => { fireEvent.blur(screen.getByLabelText('Workout name')) })
    expect(updateNameMutateAsyncMock).toHaveBeenCalledWith({ id: 'wd-2', name: 'Pull A' })

    fireEvent.click(within(screen.getByRole('group', { name: 'Weekday' })).getByText('WED'))
    expect(assignWeekdayMutateMock).toHaveBeenCalledWith({ schedule, workoutDayId: 'wd-2', dow: 'wednesday' })

    fireEvent.click(screen.getByLabelText('Delete Pull 1'))
    fireEvent.click(screen.getByText('DELETE'))
    expect(deleteDayMutateMock).toHaveBeenCalledWith({ id: 'wd-2', schedule })
  })

  it('read-only: the name does not rename and there is no trash', () => {
    workoutDays = [day({ id: 'wd-1', name: 'Push 1' })]
    render(<StepExercises program={program()} volumeReadOnly />)
    expect((screen.getByLabelText('Rename Push 1') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByLabelText('Delete Push 1')).toBeNull()
  })

  it('W: DELETE asks first (PP4), CANCEL writes nothing, DELETE calls useDeleteWorkoutDay with the workout and the schedule', () => {
    workoutDays = [day({ id: 'wd-1', name: 'Push 1' })]
    const schedule = { ...NO_DAYS, monday: 'wd-1' }
    render(<StepExercises program={program({ schedule })} volumeReadOnly={false} />)

    fireEvent.click(screen.getByLabelText('Delete Push 1'))
    expect(screen.getByText('Delete “Push 1”?')).toBeTruthy()
    expect(screen.getByText("This removes the workout and every exercise in it. This can't be undone.")).toBeTruthy()
    fireEvent.click(screen.getByText('CANCEL'))
    expect(deleteDayMutateMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Delete “Push 1”?')).toBeNull()

    fireEvent.click(screen.getByLabelText('Delete Push 1'))
    fireEvent.click(screen.getByText('DELETE'))
    expect(deleteDayMutateMock).toHaveBeenCalledWith({ id: 'wd-1', schedule })
    expect(screen.queryByText('Delete “Push 1”?')).toBeNull()
  })
})

describe('StepExercises — ADD WORKOUT (PP2c)', () => {
  const sheet = () => within(screen.getByRole('dialog'))

  it('W: the sheet\'s ADD WORKOUT writes the trimmed name at the next position, closes, and opens the new workout', async () => {
    workoutDays = [day({ id: 'wd-1', name: 'Push 1' })]
    createDayMutateAsyncMock.mockResolvedValue({ id: 'wd-9' })
    const { rerender } = render(<StepExercises program={program({ name: 'Bulk' })} volumeReadOnly={false} />)

    fireEvent.click(screen.getByText('ADD WORKOUT'))
    expect(sheet().getByText('BULK')).toBeTruthy() // the eyebrow: the program's name
    expect(sheet().getByText('Add workout')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('WORKOUT NAME'), { target: { value: '  Legs  ' } })
    await act(async () => { fireEvent.click(sheet().getByText('ADD WORKOUT')) })

    expect(createDayMutateAsyncMock).toHaveBeenCalledWith({ name: 'Legs', position: 1 })
    expect(screen.queryByRole('dialog')).toBeNull()
    workoutDays = [...workoutDays, day({ id: 'wd-9', name: 'Legs', position: 1 })]
    rerender(<StepExercises program={program({ name: 'Bulk' })} volumeReadOnly={false} />)
    expect(screen.getByLabelText('Hide editor for Legs')).toBeTruthy()
    expect(screen.getByLabelText('Show editor for Push 1')).toBeTruthy()
  })

  it('a blank name writes nothing and leaves the sheet open; Enter in the field adds as the button does', async () => {
    workoutDays = []
    createDayMutateAsyncMock.mockResolvedValue({ id: 'wd-1' })
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    fireEvent.click(screen.getByText('ADD WORKOUT'))
    fireEvent.change(screen.getByLabelText('WORKOUT NAME'), { target: { value: '   ' } })
    await act(async () => { fireEvent.click(sheet().getByText('ADD WORKOUT')) })
    expect(createDayMutateAsyncMock).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('WORKOUT NAME'), { target: { value: 'Arms' } })
    await act(async () => { fireEvent.submit(screen.getByLabelText('WORKOUT NAME').closest('form')!) })
    expect(createDayMutateAsyncMock).toHaveBeenCalledWith({ name: 'Arms', position: 0 })
  })
})

describe('StepExercises — exercise rows (PP2, PP2e)', () => {
  it('a shut row says what is set on it (REST, REST AFTER, TEMPO) and nothing when nothing is', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0, restSeconds: 90, restAfterSeconds: 180, tempo: '3-1-1-0' }),
      exercise({ id: 'pe-2', position: 1, exercise: { ...exercise().exercise!, name: 'Dips' } }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    const bench = within(screen.getByLabelText('Edit Bench Press'))
    expect(bench.getByText('REST 1min 30s')).toBeTruthy()
    expect(bench.getByText('REST AFTER 3min 0s')).toBeTruthy()
    expect(bench.getByText('TEMPO 3-1-1-0')).toBeTruthy()
    expect(within(screen.getByLabelText('Edit Dips')).queryByText(/^(REST|TEMPO)/)).toBeNull()
    // the numbers
    expect(screen.getByText('01')).toBeTruthy()
    expect(screen.getByText('02')).toBeTruthy()
  })

  it('one exercise is open at a time: opening another shuts the one that was open; its own name shuts it', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [
      exercise({ id: 'pe-1', position: 0 }),
      exercise({ id: 'pe-2', position: 1, exercise: { ...exercise().exercise!, name: 'Dips' } }),
    ]
    render(<StepExercises program={program()} volumeReadOnly={false} />)

    openExercise('Bench Press')
    expect(screen.getByLabelText('Close Bench Press')).toBeTruthy()
    expect(screen.getByText('UNIT')).toBeTruthy()
    openExercise('Dips')
    expect(screen.queryByLabelText('Close Bench Press')).toBeNull()
    expect(screen.getByLabelText('Edit Bench Press')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Close Dips'))
    expect(screen.queryByText('UNIT')).toBeNull()
  })

  it('the open row names the muscle group and carries the three arrows; read-only has none of them but keeps the design fields', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0 })]
    const { unmount } = render(<StepExercises program={program()} volumeReadOnly={false} />)
    openExercise('Bench Press')
    expect(screen.getByText('chest')).toBeTruthy()
    expect(screen.getByLabelText('Move Bench Press up')).toBeTruthy()
    expect(screen.getByLabelText('Move Bench Press down')).toBeTruthy()
    expect(screen.getByLabelText('Remove Bench Press')).toBeTruthy()
    unmount()

    render(<StepExercises program={program()} volumeReadOnly />)
    openExercise('Bench Press')
    expect(screen.queryByLabelText('Move Bench Press up')).toBeNull()
    expect(screen.queryByLabelText('Remove Bench Press')).toBeNull()
    expect(screen.getByLabelText('More rest')).toBeTruthy()
  })

  it('W: the unit chips write the exercise\'s own unit (INHERIT is null); read-only they are off', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0 })]
    const { unmount } = render(<StepExercises program={program()} volumeReadOnly={false} />)
    openExercise('Bench Press')

    fireEvent.click(screen.getByRole('button', { name: 'LBS' }))
    fireEvent.click(screen.getByRole('button', { name: 'KG' }))
    fireEvent.click(screen.getByRole('button', { name: 'INHERIT (KG)' }))
    expect(updateWeightUnitMutateMock.mock.calls).toEqual([
      [{ id: 'pe-1', weightUnit: 'lbs' }],
      [{ id: 'pe-1', weightUnit: 'kg' }],
      [{ id: 'pe-1', weightUnit: null }],
    ])
    unmount()

    updateWeightUnitMutateMock.mockClear()
    render(<StepExercises program={program()} volumeReadOnly />)
    openExercise('Bench Press')
    expect((screen.getByRole('button', { name: 'LBS' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'LBS' }))
    expect(updateWeightUnitMutateMock).not.toHaveBeenCalled()
  })

  it('W: REMOVE asks first (PP4), CANCEL writes nothing, REMOVE calls useDeleteProgramExercise with the exercise row id and shuts the row', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', position: 0 })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    openExercise('Bench Press')

    fireEvent.click(screen.getByLabelText('Remove Bench Press'))
    expect(screen.getByText('Remove “Bench Press”?')).toBeTruthy()
    expect(screen.getByText("This also removes its planned sets here. This can't be undone.")).toBeTruthy()
    fireEvent.click(screen.getByText('CANCEL'))
    expect(deleteExerciseMutateMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Remove Bench Press'))
    fireEvent.click(screen.getByText('REMOVE'))
    expect(deleteExerciseMutateMock).toHaveBeenCalledWith('pe-1')
    expect(screen.queryByLabelText('Close Bench Press')).toBeNull()
  })

  it('PP4: removing a warmup item asks with the item\'s own words', () => {
    workoutDays = [day({ id: 'wd-1' })]
    warmupItemsByDay['wd-1'] = [warmupItem({ id: 'wi-1', position: 0, body: 'Band pull-aparts' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    fireEvent.click(screen.getByLabelText('Remove Band pull-aparts'))
    expect(screen.getByText('Remove this item?')).toBeTruthy()
    expect(screen.getByText("“Band pull-aparts”. This can't be undone.")).toBeTruthy()
  })
})

describe('StepExercises — the add-exercise sheet is the shared picker (PP2d)', () => {
  const OPEN_WITH_ONE = () => {
    workoutDays = [day({ id: 'wd-1', name: 'Push 1' })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', exerciseId: 'lib-1', position: 0, exercise: { ...LIBRARY[0] } })]
    const view = render(<StepExercises program={program()} volumeReadOnly={false} />)
    fireEvent.click(screen.getByText('ADD EXERCISE'))
    return view
  }

  it('opens in add mode for the workout, staying open for the next, with the board\'s eyebrow and title and without what the workout holds', () => {
    OPEN_WITH_ONE()
    const props = pickerProps.current!
    expect(props.mode).toBe('add')
    expect(props.stayOpenAfterAdd).toBe(true)
    expect(props.showGroup).toBe(false)
    expect(props.onCreate).toBeUndefined() // PP2d draws no "+ NEW EXERCISE" row
    expect(props.confirmLabel).toBeUndefined() // a tap adds at once
    expect(props.eyebrow).toBe('PUSH 1')
    expect(props.title).toBe('Add exercise')
    expect(props.exclude).toEqual(['lib-1'])
    expect(screen.queryByText('pick Barbell Row')).toBeNull()
    expect(screen.getByText('pick Lat Pulldown')).toBeTruthy()
  })

  it('W: a tap adds the exercise at the next position with the unit the SETTINGS say (the store says kg here), and the sheet stays', async () => {
    settingsUnit = 'lbs'
    OPEN_WITH_ONE()
    addExerciseMutateAsyncMock.mockResolvedValue(undefined)

    await act(async () => { fireEvent.click(screen.getByText('pick Lat Pulldown')) })

    expect(addExerciseMutateAsyncMock).toHaveBeenCalledTimes(1)
    expect(addExerciseMutateAsyncMock).toHaveBeenCalledWith({ exerciseId: 'lib-2', position: 1, weightUnit: 'lbs' })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('the list is the workout\'s own LIVE list: an exercise that has landed is not offered again', () => {
    const { rerender } = OPEN_WITH_ONE()
    expect(screen.getByText('pick Lat Pulldown')).toBeTruthy()
    exercisesByDay['wd-1'] = [...exercisesByDay['wd-1'], exercise({ id: 'pe-2', exerciseId: 'lib-2', position: 1, exercise: { ...LIBRARY[1] } })]
    rerender(<StepExercises program={program()} volumeReadOnly={false} />)
    expect(screen.queryByText('pick Lat Pulldown')).toBeNull()
    expect(screen.getByText('pick Face Pull')).toBeTruthy()
    expect(pickerProps.current!.exclude).toEqual(['lib-1', 'lib-2'])
  })

  it('W: the sheet writes to the workout whose card opened it: with two unlike workouts, the second one\'s + ADD EXERCISE builds the add for the second one\'s own id (break: the program\'s id)', async () => {
    workoutDays = [day({ id: 'wd-1', name: 'Push 1' }), day({ id: 'wd-2', name: 'Pull 1', position: 1 })]
    exercisesByDay['wd-1'] = [exercise({ id: 'pe-1', workoutDayId: 'wd-1', exerciseId: 'lib-1', position: 0, exercise: { ...LIBRARY[0] } })]
    exercisesByDay['wd-2'] = [exercise({ id: 'pe-2', workoutDayId: 'wd-2', exerciseId: 'lib-2', position: 0, exercise: { ...LIBRARY[1] } })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    fireEvent.click(screen.getByLabelText('Show editor for Pull 1')) // the first card is the open one
    fireEvent.click(screen.getByText('ADD EXERCISE'))
    expect(pickerProps.current!.eyebrow).toBe('PULL 1')
    expect([...new Set(addHookArgs)]).toEqual(['wd-2']) // the workout day's id: not the program's ('prog-1'), not the first workout's
    addExerciseMutateAsyncMock.mockResolvedValue(undefined)
    await act(async () => { fireEvent.click(screen.getByText('pick Face Pull')) })
    expect(addExerciseMutateAsyncMock).toHaveBeenCalledWith({ exerciseId: 'lib-3', position: 1, weightUnit: 'kg' })
  })

  it('W: two taps in one instant add once (a ref says one is out: the pending flag only turns true after a draw); the next tap after it lands adds', async () => {
    OPEN_WITH_ONE()
    let land!: () => void
    addExerciseMutateAsyncMock.mockImplementationOnce(() => new Promise<void>((resolve) => { land = resolve }))
    await act(async () => {
      fireEvent.click(screen.getByText('pick Lat Pulldown'))
      fireEvent.click(screen.getByText('pick Lat Pulldown'))
    })
    expect(addExerciseMutateAsyncMock).toHaveBeenCalledTimes(1)

    await act(async () => { land() })
    addExerciseMutateAsyncMock.mockResolvedValue(undefined)
    await act(async () => { fireEvent.click(screen.getByText('pick Face Pull')) })
    expect(addExerciseMutateAsyncMock).toHaveBeenCalledTimes(2)
    expect(addExerciseMutateAsyncMock).toHaveBeenLastCalledWith({ exerciseId: 'lib-3', position: 1, weightUnit: 'kg' })
  })

  it('W: while the settings are loading a tap writes nothing (a wrong unit would be permanent)', async () => {
    settingsLoading = true
    OPEN_WITH_ONE()
    await act(async () => { fireEvent.click(screen.getByText('pick Lat Pulldown')) })
    expect(addExerciseMutateAsyncMock).not.toHaveBeenCalled()
  })

  it('a failed add says so with the real reason (a Supabase error is not an Error), keeps the sheet, and the next tap clears the line', async () => {
    OPEN_WITH_ONE()
    addExerciseMutateAsyncMock.mockRejectedValueOnce({ message: 'duplicate key value violates unique constraint' })
    await act(async () => { fireEvent.click(screen.getByText('pick Lat Pulldown')) })

    expect(screen.getByText("Couldn't add Lat Pulldown.")).toBeTruthy()
    expect(screen.getByText('duplicate key value violates unique constraint')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()

    addExerciseMutateAsyncMock.mockResolvedValue(undefined)
    await act(async () => { fireEvent.click(screen.getByText('pick Lat Pulldown')) })
    expect(screen.queryByText("Couldn't add Lat Pulldown.")).toBeNull()
  })

  it('the empty workout\'s ADD AN EXERCISE opens the same sheet, and the sheet closes through its own close', () => {
    workoutDays = [day({ id: 'wd-1', name: 'Arms' })]
    render(<StepExercises program={program()} volumeReadOnly={false} />)
    fireEvent.click(screen.getByText('ADD AN EXERCISE'))
    expect(pickerProps.current!.eyebrow).toBe('ARMS')
    expect(pickerProps.current!.exclude).toEqual([])
    fireEvent.click(screen.getByText('close picker'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('read-only: no sheet can open', () => {
    workoutDays = [day({ id: 'wd-1' })]
    exercisesByDay['wd-1'] = [exercise()]
    render(<StepExercises program={program()} volumeReadOnly />)
    expect(screen.queryByText('ADD EXERCISE')).toBeNull()
    expect(pickerProps.current).toBeNull()
  })
})
