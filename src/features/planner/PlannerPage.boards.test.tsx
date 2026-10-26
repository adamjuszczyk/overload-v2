// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { Exercise, Mesocycle, Program, ProgramExercise, SequenceItem, WarmupRoutineItem, WeeklySchedule, WorkoutDay } from '../../types'
import type { StoredMark } from '../../lib/priorityMarks'
import { captureRender } from '../../testing/captureRender'

// Chunk 68's screens, rendered the way boards PP1–PP6 draw them, for the 390 px screenshots beside the boards (`CAPTURE_RENDER=1` writes
// `__fixtures__/planner-<board>.html`; `npm run shot` turns each into design/1.2/built/<board-id>.png + .txt). Each test captures first, then
// asserts the few things that say the capture is the state its board draws (RULES: a fixture is captured before it asserts, so a broken rule
// still writes the fixture the Chromium check measures). The planner is the real PlannerPage with the real steps 1 and 2 over the hook boundary;
// step 3 (chunk 67's) is a one-line stand-in. Boards: PP1 (priorities), PP1b and PP4b (one workout on several weekdays and its split), PP2 (exercises,
// weekday), PP2b (sequence), PP2c (add workout, add and change a slot), PP2d and PP2d2 (the add sheet), PP2e (editing in place), PP2f (the warmup
// routine), PP4 (the confirms), PP5 and PP5b (loading, missing, a run's copy, a mark that didn't save, no schedule), PP6 (the empty states).
//
// The fixture names read "planner-pp1" and so on; none is a utility-shaped word (RULES: Tailwind builds the stylesheet from every tracked file).

const state = vi.hoisted(() => ({
  programs: [] as unknown[],
  programsLoading: false,
  workoutDays: [] as unknown[],
  exercisesByDay: {} as Record<string, unknown[]>,
  warmupByDay: {} as Record<string, unknown[]>,
  sequenceItems: [] as unknown[],
  blockRests: [] as unknown[],
  marks: [] as unknown[],
  prioritiesLoading: false,
  prioritiesError: undefined as unknown,
  markError: undefined as unknown,
  mesos: [] as unknown[],
  library: [] as unknown[],
}))
const noMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })

vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: state.programs, isLoading: state.programsLoading }),
  useWorkoutDays: () => ({ data: state.workoutDays, isLoading: false }),
  useUpdateProgramName: noMutation,
  useSequenceItems: () => ({ data: state.sequenceItems, isLoading: false }),
  useCreateWorkoutDay: noMutation,
  useUpdateWorkoutDayName: noMutation,
  useDeleteWorkoutDay: noMutation,
  useProgramExercises: (workoutDayId: string) => ({ data: state.exercisesByDay[workoutDayId] ?? [], isLoading: false }),
  useAddProgramExercise: noMutation,
  useReorderProgramExercises: noMutation,
  useDeleteProgramExercise: noMutation,
  useUpdateProgramExerciseWeightUnit: noMutation,
  useUpdateProgramExerciseRest: noMutation,
  useUpdateProgramExerciseTempo: noMutation,
  useToggleSupersetLink: noMutation,
  useSupersetBlockRests: () => ({ data: state.blockRests }),
  useUpdateSupersetBlockRest: noMutation,
  useUpdateScheduleType: noMutation,
  useAddSequenceItem: noMutation,
  useUpdateSequenceItemWorkout: noMutation,
  useRemoveSequenceItem: noMutation,
  useReorderSequenceItems: noMutation,
  useWarmupRoutineItems: (workoutDayId: string) => ({ data: state.warmupByDay[workoutDayId] ?? [], isLoading: false }),
  useAddWarmupItem: noMutation,
  useUpdateWarmupItemBody: noMutation,
  useRemoveWarmupItem: noMutation,
  useReorderWarmupItems: noMutation,
}))
vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: state.mesos }),
  useStartRun: noMutation,
}))
vi.mock('../plan/useProgramPriorities', () => ({
  useProgramPriorities: () => ({ data: state.marks, isLoading: state.prioritiesLoading, isError: state.prioritiesError !== undefined, error: state.prioritiesError }),
  useSetPriorityMark: () => ({
    mutate: (_vars: unknown, options?: { onError?: (error: unknown) => void }) => {
      if (state.markError !== undefined) options?.onError?.(state.markError)
    },
    isPending: false,
  }),
}))
vi.mock('./usePlanner', async () => {
  const actual = await vi.importActual<typeof import('./plannerService')>('./plannerService')
  return {
    detectSharedWeekdayWorkouts: actual.detectSharedWeekdayWorkouts,
    useSplitSharedWeekdayWorkouts: noMutation,
    useAssignWorkoutWeekday: noMutation,
  }
})
vi.mock('../library/useExercises', () => ({
  useExercises: () => ({ data: state.library, isError: false }),
  useCreateExercise: noMutation,
}))
vi.mock('../settings/settingsStore', () => ({
  useSettingsStore: (selector: (s: { weightUnit: string }) => unknown) => selector({ weightUnit: 'kg' }),
}))
vi.mock('../settings/useSettings', () => ({ useSettings: () => ({ data: { weightUnit: 'kg' }, isLoading: false }) }))
vi.mock('./StepVolume', () => ({ default: () => <div>STEP VOLUME</div> }))

const { default: PlannerPage } = await import('./PlannerPage')

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
  state.programs = []
  state.programsLoading = false
  state.workoutDays = []
  state.exercisesByDay = {}
  state.warmupByDay = {}
  state.sequenceItems = []
  state.blockRests = []
  state.marks = []
  state.prioritiesLoading = false
  state.prioritiesError = undefined
  state.markError = undefined
  state.mesos = []
  state.library = []
})
afterEach(() => cleanup())

const NO_DAYS: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
const BULK_SCHEDULE: WeeklySchedule = { ...NO_DAYS, monday: 'wd-push1', tuesday: 'wd-pull1', thursday: 'wd-push2', friday: 'wd-pull2', saturday: 'wd-legs' }
const bulk = (over: Partial<Program> = {}): Program => ({
  id: 'prog-bulk', userId: 'user-1', name: 'Bulk', schedule: BULK_SCHEDULE, workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  kind: 'saved', planningType: 'week_dependent', scheduleType: 'weekday', ...over,
})
const day = (id: string, name: string, position: number): WorkoutDay => ({ id, programId: 'prog-bulk', userId: 'user-1', name, position, exercises: [] })
const FIVE = [day('wd-push1', 'Push 1', 0), day('wd-pull1', 'Pull 1', 1), day('wd-push2', 'Push 2', 2), day('wd-pull2', 'Pull 2', 3), day('wd-legs', 'Legs', 4)]

const ex = (id: string, name: string, muscleGroup: Exercise['muscleGroup'] = 'back'): Exercise => ({
  id, userId: 'user-1', name, muscleGroup, isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
})
const pe = (id: string, workoutDayId: string, position: number, exercise: Exercise, over: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id, workoutDayId, userId: 'user-1', exerciseId: exercise.id, position, weightUnit: null, exercise, ...over,
})
const PULL_1: ProgramExercise[] = [
  pe('pe-1', 'wd-pull1', 0, ex('ex-lat', 'Lat Pulldown'), { restAfterSeconds: 180 }),
  pe('pe-2', 'wd-pull1', 1, ex('ex-row', 'Seated Cable Row'), { restSeconds: 90, tempo: '3-1-1-0' }),
  pe('pe-3', 'wd-pull1', 2, ex('ex-face', 'Face Pull', 'shoulders'), { restSeconds: 60, supersetBlockId: 'blk-1' }),
  pe('pe-4', 'wd-pull1', 3, ex('ex-ez', 'EZ Bar Curl', 'biceps'), { supersetBlockId: 'blk-1' }),
]
const WARMUP: WarmupRoutineItem[] = [
  { id: 'wi-1', userId: 'user-1', workoutDayId: 'wd-pull1', position: 0, body: '5 min easy bike' },
  { id: 'wi-2', userId: 'user-1', workoutDayId: 'wd-pull1', position: 1, body: 'Band pull-aparts' },
]
const mark = (tagType: StoredMark['tagType'], tagValue: string, m: StoredMark['mark']): StoredMark => ({ tagType, tagValue, mark: m, updatedAt: '2026-10-01T00:00:00Z' })

function renderPlanner(programId = 'prog-bulk') {
  return render(
    <MemoryRouter initialEntries={[`/program/${programId}`]}>
      <Routes>
        <Route path="/program/:programId" element={<PlannerPage />} />
        <Route path="/program" element={<div>PROGRAMS</div>} />
      </Routes>
    </MemoryRouter>,
  )
}
const step = (label: string) => fireEvent.click(screen.getByRole('tab', { name: label }))

function bulkWorld(over: Partial<Program> = {}) {
  state.programs = [bulk(over)]
  state.workoutDays = FIVE
  state.exercisesByDay = { 'wd-pull1': PULL_1 }
  state.warmupByDay = { 'wd-pull1': WARMUP }
  state.blockRests = []
}

describe('PP1 — step 1, priorities', () => {
  it('PP1: the groups as one card, a mark on a group and on a subgroup, two groups unfolded', () => {
    bulkWorld()
    state.marks = [
      mark('muscle_group', 'chest', 'focus'), mark('muscle_group', 'back', 'focus'), mark('muscle_group', 'forearms', 'dont_care'), mark('muscle_group', 'calves', 'dont_care'),
      mark('muscle_subgroup', 'lower_chest', 'dont_care'), mark('muscle_subgroup', 'side_delt', 'focus'),
    ]
    const { container } = renderPlanner()
    fireEvent.click(screen.getByLabelText('Expand CHEST'))
    fireEvent.click(screen.getByLabelText('Expand SHOULDERS'))
    captureRender('planner-pp1', container)

    expect(screen.getByRole('tab', { name: '1 · PRIORITIES' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText("OPTIONAL — SKIP IF YOU DON'T NEED IT")).toBeTruthy()
    expect(screen.getByText(/^chest without lower chest$/i)).toBeTruthy()
    expect(screen.getAllByText('INHERITED: FOCUS')).toHaveLength(2)
    expect(screen.getByText('SAVE')).toBeTruthy()
    expect(screen.getByText('START')).toBeTruthy()
  })
})

describe('PP1b and PP4b — one workout on several weekdays', () => {
  const shared = (): Program => bulk({ name: 'Cut PPL', schedule: { ...NO_DAYS, monday: 'wd-push1', thursday: 'wd-push1', tuesday: 'wd-pull1', friday: 'wd-pull1' } })
  const world = () => {
    state.programs = [shared()]
    state.workoutDays = [day('wd-push1', 'Push', 0), day('wd-pull1', 'Pull', 1)]
  }

  it('PP1b: the prompt, over the planner', () => {
    world()
    renderPlanner()
    captureRender('planner-pp1b', document.body)
    expect(screen.getByText('One workout, several weekdays')).toBeTruthy()
    expect(screen.getByText('CUT PPL')).toBeTruthy()
    expect(screen.getByText('Monday · Thursday')).toBeTruthy()
    expect(screen.getByText('Tuesday · Friday')).toBeTruthy()
  })

  it('PP4b: the confirm, and the confirm after a split that failed', async () => {
    world()
    renderPlanner()
    fireEvent.click(screen.getByText('GIVE EACH DAY ITS OWN WORKOUT'))
    captureRender('planner-pp4b-confirm', document.body)
    expect(screen.getByText('Give each weekday its own workout?')).toBeTruthy()
    expect(screen.getByText(/^Creates 2 new workouts/)).toBeTruthy()
  })
})

describe('PP2, PP2b, PP2c — step 2', () => {
  it('PP2: weekday, one workout open to its editor, one exercise open in it, a superset, the warmup routine', () => {
    bulkWorld()
    state.blockRests = []
    const { container } = renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByLabelText('Show editor for Pull 1'))
    fireEvent.click(screen.getByLabelText('Edit Face Pull'))
    captureRender('planner-pp2', container)

    expect(screen.getByRole('group', { name: 'Schedule type' })).toBeTruthy()
    expect(screen.getByLabelText('Hide editor for Pull 1')).toBeTruthy()
    expect(screen.getByLabelText('Show editor for Push 1')).toBeTruthy()
    expect(screen.getByText('REST AFTER 3min 0s')).toBeTruthy()
    expect(screen.getByText('TEMPO 3-1-1-0')).toBeTruthy()
    expect(screen.getByLabelText('Close Face Pull')).toBeTruthy()
    expect(screen.getByText('SUPERSET REST')).toBeTruthy()
    expect(screen.getByLabelText('Unlink Face Pull and EZ Bar Curl').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('5 min easy bike')).toBeTruthy()
    expect(screen.getByText('ADD EXERCISE')).toBeTruthy()
    expect(screen.getByText('ADD WORKOUT')).toBeTruthy()
  })

  it('PP2b: a sequence program, its slots and every workout shut', () => {
    bulkWorld({ scheduleType: 'sequence', schedule: NO_DAYS })
    state.sequenceItems = [
      ['wd-push1', 'si-1'], ['wd-pull1', 'si-2'], ['wd-legs', 'si-3'], [null, 'si-4'], ['wd-push2', 'si-5'], ['wd-pull2', 'si-6'], [null, 'si-7'],
    ].map(([workoutDayId, id], position) => ({ id, userId: 'user-1', programId: 'prog-bulk', position, workoutDayId })) as SequenceItem[]
    const { container } = renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByLabelText('Hide editor for Push 1'))
    captureRender('planner-pp2b', container)

    expect(screen.getByRole('region', { name: 'Sequence editor' })).toBeTruthy()
    expect(screen.getAllByText('REST DAY')).toHaveLength(2)
    expect(screen.getByText('ADD SLOT')).toBeTruthy()
    expect(screen.queryByText('MON')).toBeNull()
  })

  it('PP2c: Add workout, Add slot and Change slot', () => {
    bulkWorld({ scheduleType: 'sequence', schedule: NO_DAYS })
    state.sequenceItems = [{ id: 'si-1', userId: 'user-1', programId: 'prog-bulk', position: 0, workoutDayId: 'wd-push1' }] as SequenceItem[]
    renderPlanner()
    step('2 · EXERCISES')

    fireEvent.click(screen.getAllByText('ADD WORKOUT')[0])
    captureRender('planner-pp2c-add-workout', document.body)
    expect(screen.getByText('Add workout')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Close'))

    fireEvent.click(within(screen.getByRole('region', { name: 'Sequence editor' })).getByText('ADD SLOT'))
    captureRender('planner-pp2c-add-slot', document.body)
    expect(screen.getByText('Add slot')).toBeTruthy()
    expect(screen.getByText('SEQUENCE · SLOT 02')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Close'))

    fireEvent.click(screen.getByLabelText('Change slot 01: Push 1'))
    captureRender('planner-pp2c-change-slot', document.body)
    expect(screen.getByText('Change slot')).toBeTruthy()
    expect(screen.getByText('SEQUENCE · SLOT 01')).toBeTruthy()
  })
})

describe('PP2d and PP2d2 — the add sheet', () => {
  const CHEST = ['Barbell Bench Press', 'Bench Supported Incline Cable Fly', 'Chest Press', 'Dumbbell Bench Press', 'Dumbbell Fly', 'Incline Barbell Bench Press', 'Incline Smith Press', 'Push-Up']
  const library = () => [
    ...CHEST.map((name, i) => ex(`lib-c${i}`, name, 'chest')),
    ex('lib-b1', 'Lat Pulldown', 'back'), ex('lib-b2', 'Barbell Row', 'back'), ex('lib-s1', 'Overhead Press', 'shoulders'),
  ]

  it('PP2d: add mode, "Tap to add. The list stays open for the next one.", the chest chip on', () => {
    bulkWorld()
    state.library = library()
    renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByText('ADD AN EXERCISE')) // Push 1 holds nothing
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'CHEST' }))
    captureRender('planner-pp2d', document.body)

    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByText('PUSH 1')).toBeTruthy()
    expect(sheet.getByText('Add exercise')).toBeTruthy()
    expect(sheet.getByText('Tap to add. The list stays open for the next one.')).toBeTruthy()
    expect(sheet.getByText('Barbell Bench Press')).toBeTruthy()
    expect(sheet.queryByText('Lat Pulldown')).toBeNull()
  })

  it('PP2d2: every chest exercise already in the workout: none in this group', () => {
    bulkWorld()
    state.library = library()
    state.exercisesByDay = { 'wd-push1': CHEST.map((name, i) => pe(`pe-c${i}`, 'wd-push1', i, ex(`lib-c${i}`, name, 'chest'))) }
    renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByText('ADD EXERCISE'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'CHEST' }))
    captureRender('planner-pp2d2', document.body)

    expect(within(screen.getByRole('dialog')).getByText('NONE IN THIS GROUP')).toBeTruthy()
  })
})

describe('PP2e and PP2f — editing in place', () => {
  it('PP2e: renaming the program', () => {
    bulkWorld()
    const { container } = renderPlanner()
    fireEvent.click(screen.getByLabelText('Rename program'))
    captureRender('planner-pp2e-program', container)
    expect((screen.getByLabelText('Program name') as HTMLInputElement).value).toBe('Bulk')
  })

  it('PP2e: renaming a workout', () => {
    bulkWorld()
    const { container } = renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByLabelText('Show editor for Pull 1'))
    fireEvent.click(screen.getByLabelText('Rename Pull 1'))
    captureRender('planner-pp2e-workout', container)
    expect((screen.getByLabelText('Workout name') as HTMLInputElement).value).toBe('Pull 1')
  })

  it('PP2e: tempo — typing, refused, saved', () => {
    bulkWorld()
    const { container } = renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByLabelText('Show editor for Pull 1'))
    fireEvent.click(screen.getByLabelText('Edit Lat Pulldown'))
    fireEvent.click(screen.getByText('—'))
    captureRender('planner-pp2e-tempo-typing', container)
    expect(screen.getByPlaceholderText('3-1-1-0')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('3-1-1-0'), { target: { value: '3-1-1' } })
    fireEvent.blur(screen.getByPlaceholderText('3-1-1-0'))
    captureRender('planner-pp2e-tempo-invalid', container)
    expect(screen.getByText('Use 4 fields, e.g. 3-1-1-0 (X allowed)')).toBeTruthy()

    cleanup()
    renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByLabelText('Show editor for Pull 1'))
    fireEvent.click(screen.getByLabelText('Edit Seated Cable Row'))
    captureRender('planner-pp2e-tempo-saved', document.body)
    expect(screen.getByText('3-1-1-0')).toBeTruthy()
  })

  it('PP2f: the warmup routine, one item being edited, and an item being added (the board draws both at once; a tap from one to the other settles the first)', () => {
    bulkWorld()
    const { container } = renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByLabelText('Show editor for Pull 1'))
    fireEvent.click(screen.getByLabelText('Edit 5 min easy bike'))
    fireEvent.change(screen.getByLabelText('Warmup item text'), { target: { value: '5 min easy bike, then rower' } })
    captureRender('planner-pp2f-edit', container)
    expect((screen.getByLabelText('Warmup item text') as HTMLInputElement).value).toBe('5 min easy bike, then rower')
    expect(screen.getByText('Band pull-aparts')).toBeTruthy()

    fireEvent.blur(screen.getByLabelText('Warmup item text'))
    fireEvent.click(screen.getByText('ADD ITEM'))
    captureRender('planner-pp2f-add', container)
    expect(screen.getByLabelText('New warmup item')).toBeTruthy()
    expect(screen.getByPlaceholderText('e.g. 5 min easy bike')).toBeTruthy()
    expect(screen.getByText('ADD')).toBeTruthy()
  })
})

describe('PP4 — the confirms', () => {
  it('PP4: delete a workout, remove an exercise, remove a warmup item, remove a slot', () => {
    bulkWorld()
    renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByLabelText('Show editor for Pull 1'))

    fireEvent.click(screen.getByLabelText('Delete Pull 1'))
    captureRender('planner-pp4-delete-workout', document.body)
    expect(screen.getByText('Delete “Pull 1”?')).toBeTruthy()
    fireEvent.click(screen.getByText('CANCEL'))

    fireEvent.click(screen.getByLabelText('Edit Lat Pulldown'))
    fireEvent.click(screen.getByLabelText('Remove Lat Pulldown'))
    captureRender('planner-pp4-remove-exercise', document.body)
    expect(screen.getByText('Remove “Lat Pulldown”?')).toBeTruthy()
    fireEvent.click(screen.getByText('CANCEL'))

    fireEvent.click(screen.getByLabelText('Remove Band pull-aparts'))
    captureRender('planner-pp4-remove-warmup', document.body)
    expect(screen.getByText('Remove this item?')).toBeTruthy()
  })

  it('PP4: remove a slot', () => {
    bulkWorld({ scheduleType: 'sequence', schedule: NO_DAYS })
    state.sequenceItems = [{ id: 'si-1', userId: 'user-1', programId: 'prog-bulk', position: 0, workoutDayId: 'wd-pull1' }] as SequenceItem[]
    renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByLabelText('Remove slot'))
    captureRender('planner-pp4-remove-slot', document.body)
    expect(screen.getByText('Remove this slot?')).toBeTruthy()
    expect(screen.getByText("“Pull 1”. This can't be undone.")).toBeTruthy()
  })
})

describe('PP5 and PP5b — loading, missing, a run\'s copy, a mark that did not save, no schedule', () => {
  it('PP5: loading the program, not found, the current program\'s copy', () => {
    state.programsLoading = true
    const loading = renderPlanner()
    captureRender('planner-pp5-loading', loading.container)
    expect(screen.getByLabelText('Loading the program')).toBeTruthy()
    cleanup()

    state.programsLoading = false
    state.programs = []
    const missing = renderPlanner('nope')
    captureRender('planner-pp5-not-found', missing.container)
    expect(screen.getByText('Program not found')).toBeTruthy()
    expect(screen.getByText('BACK TO PROGRAMS')).toBeTruthy()
    cleanup()

    state.programs = [bulk({ kind: 'run' })]
    const copy = renderPlanner()
    captureRender('planner-pp5-run-copy', copy.container)
    expect(screen.getByText("This is the current program's copy")).toBeTruthy()
    expect(screen.getByText('It opens from Plan instead: plan its weeks there, or use EDIT PROGRAM in Programs.')).toBeTruthy()
  })

  it('PP5: priorities loading, and priorities that could not be read (with the real reason)', () => {
    bulkWorld()
    state.prioritiesLoading = true
    const loading = renderPlanner()
    captureRender('planner-pp5-priorities-loading', loading.container)
    expect(screen.getByLabelText('Loading priorities')).toBeTruthy()
    cleanup()

    state.prioritiesLoading = false
    state.prioritiesError = { message: 'Failed to fetch' }
    const failed = renderPlanner()
    captureRender('planner-pp5-priorities-error', failed.container)
    expect(screen.getByText("Couldn't load priorities")).toBeTruthy()
    expect(screen.getByText('Failed to fetch')).toBeTruthy()
  })

  it('PP5b: a mark that did not save, with the server\'s own message', () => {
    bulkWorld()
    state.markError = { message: 'Failed to fetch' }
    const { container } = renderPlanner()
    fireEvent.click(within(screen.getByRole('group', { name: 'Priority for BICEPS' })).getByText('FOCUS'))
    captureRender('planner-pp5b-mark-error', container)
    expect(screen.getByText("Couldn't update priorities.")).toBeTruthy()
    expect(screen.getByText('Failed to fetch')).toBeTruthy()
  })

  it('PP5b: no workout scheduled (START off, with its reason); START opens the start sheet over the planner', () => {
    bulkWorld({ schedule: NO_DAYS })
    const noSchedule = renderPlanner()
    captureRender('planner-pp5b-no-schedule', noSchedule.container)
    expect((screen.getByText('START') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Schedule at least one workout to start')).toBeTruthy()
    cleanup()

    bulkWorld()
    state.mesos = [{ id: 'meso-1', userId: 'user-1', name: 'Cut PPL', programId: 'run-1', sourceProgramId: 'prog-9', status: 'active', startDate: '2026-10-05', endDate: null, createdAt: '2026-10-05T08:00:00Z' }] as Mesocycle[]
    renderPlanner()
    fireEvent.click(screen.getByText('START'))
    captureRender('planner-pp5b-start-sheet', document.body)
    expect(screen.getByText('Start a new program')).toBeTruthy()
    expect(screen.getByText('Starting it finishes Cut PPL. Its weeks stay in History.')).toBeTruthy()
  })
})

describe('long names (80 letters with no break): nothing runs out of its box at 375 px', () => {
  const LONG = 'X'.repeat(80)
  it('the page: a workout, its exercises, a warmup item, a slot and the program\'s name', () => {
    state.programs = [bulk({ name: LONG, schedule: { ...NO_DAYS, monday: 'wd-long' } })]
    state.workoutDays = [day('wd-long', LONG, 0), day('wd-two', `${LONG}2`, 1)]
    state.exercisesByDay = { 'wd-long': [pe('pe-l1', 'wd-long', 0, ex('ex-l1', LONG)), pe('pe-l2', 'wd-long', 1, ex('ex-l2', `${LONG}2`), { restSeconds: 90, tempo: '3-1-1-0' })] }
    state.warmupByDay = { 'wd-long': [{ id: 'wi-l', userId: 'user-1', workoutDayId: 'wd-long', position: 0, body: `${LONG}W` }] }
    const { container } = renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByLabelText(`Edit ${LONG}`))
    captureRender('planner-long-page', container)
    expect(screen.getAllByText(LONG).length).toBeGreaterThan(0)
  })

  it('the confirms: a workout, an exercise, a warmup item and a slot with a long name', () => {
    state.programs = [bulk({ scheduleType: 'sequence', schedule: NO_DAYS })]
    state.workoutDays = [day('wd-long', LONG, 0)]
    state.sequenceItems = [{ id: 'si-1', userId: 'user-1', programId: 'prog-bulk', position: 0, workoutDayId: 'wd-long' }] as SequenceItem[]
    state.exercisesByDay = { 'wd-long': [pe('pe-l1', 'wd-long', 0, ex('ex-l1', LONG))] }
    state.warmupByDay = { 'wd-long': [{ id: 'wi-l', userId: 'user-1', workoutDayId: 'wd-long', position: 0, body: `${LONG}W` }] }
    renderPlanner()
    step('2 · EXERCISES')
    fireEvent.click(screen.getByLabelText('Remove slot'))
    captureRender('planner-long-confirm-slot', document.body)
    fireEvent.click(screen.getByText('CANCEL'))
    fireEvent.click(screen.getByLabelText(`Remove ${LONG}W`))
    captureRender('planner-long-confirm-warmup', document.body)
    expect(screen.getByText('Remove this item?')).toBeTruthy()
  })
})

describe('PP6 — the empty states', () => {
  it('PP6: no workouts yet (weekday), a new workout with nothing in it, no slots yet (sequence)', async () => {
    state.programs = [bulk({ schedule: NO_DAYS })]
    const none = renderPlanner()
    step('2 · EXERCISES')
    captureRender('planner-pp6-no-workouts', none.container)
    expect(screen.getByText('NO WORKOUTS YET')).toBeTruthy()
    expect(screen.getByText('ADD WORKOUT')).toBeTruthy()
    cleanup()

    state.workoutDays = [day('wd-arms', 'Arms', 0)]
    state.programs = [bulk({ schedule: { ...NO_DAYS, wednesday: 'wd-arms' } })]
    const arms = renderPlanner()
    step('2 · EXERCISES')
    captureRender('planner-pp6-new-workout', arms.container)
    expect(screen.getByText('ADD AN EXERCISE')).toBeTruthy()
    expect(screen.getByText('NO WARMUP ITEMS YET')).toBeTruthy()
    cleanup()

    state.programs = [bulk({ scheduleType: 'sequence', schedule: NO_DAYS })]
    state.workoutDays = []
    const sequence = renderPlanner()
    step('2 · EXERCISES')
    await act(async () => {})
    captureRender('planner-pp6-no-slots', sequence.container)
    expect(screen.getByText('NO SLOTS YET')).toBeTruthy()
  })
})
