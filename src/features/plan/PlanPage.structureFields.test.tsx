// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, subWeeks } from 'date-fns'
import type {
  Mesocycle, Program, WorkoutDay, ProgramExercise, ProgramSet, ProgramSupersetBlock, WarmupRoutineItem,
  WeekPlan, WeekPlanSet, Exercise, MuscleGroup,
} from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 30 (TASKS-1.1 "Rest, tempo, grouping, the routine and units in the Structure view (run-wide)";
// SPEC Programs and runs / Rest / Tempo / Supersets / Warmup routine / Plan screen [P1.1]; the standing
// UI rule). Plan's STRUCTURE view shows and edits the fields that stay run-wide, each write going to the
// exercise's OWN program-exercise row — the row of the run's copy, or the `week_only` row of an exercise
// added or swapped in during the week — through the very mutation the program tab calls on it.
//
// The fixture is one workout whose week differs from the run's copy in every way that matters:
//
//   the run's copy (useProgramExercises):    this week (week 2, v2_week_plan_exercises):
//     pe-1 Bench Press   (position 0)          pe-1 Bench Press   (0)   rest 90, rest after 180, tempo, unit lbs
//     pe-2 Squat         (1)                   pe-3 Dips          (1)   moved up this week
//     pe-3 Dips          (2)                   pe-2 Squat         (2)
//     pe-4 Row           (3)                   pe-s Incline Press (3)   swapped in for pe-4: its own week_only row
//                                              pe-n Lunge         (4)   added this week: its own week_only row
//
// so that a control wired to the run copy's row AT THE SAME POSITION, to the week plan's row, or to the
// run copy's ORDER writes to a different row than the exercise, and a test sees it. The program sets are
// returned for ANY ids asked for (the fake is dumb on purpose): that a swapped-in exercise's sets show no
// REST is the screen's own rule, not an accident of what the fake returned.
//
// Renders the real PlanPage tree; only the data hooks are mocked (the seam every PlanPage test file uses).
// Checked at 375px (window.innerWidth).

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// ─── Fixture ──────────────────────────────────────────────────────────────────

// A meso that started a week ago, so the viewed (current) week is week 2; week 1 is past.
const startDate = format(subWeeks(new Date(), 1), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const workoutDay2: WorkoutDay = { id: 'wd-2', programId: 'prog-1', userId: 'user-1', name: 'Leg Day', position: 1, exercises: [] }

const ex = (id: string, name: string, muscleGroup: MuscleGroup): Exercise => ({
  id, userId: 'user-1', name, muscleGroup, isArchived: false, createdAt: '', muscleSubgroups: null,
  movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
})
const EX_BENCH = ex('ex-bench', 'Bench Press', 'chest')
const EX_SQUAT = ex('ex-squat', 'Squat', 'quads')
const EX_DIPS = ex('ex-dips', 'Dips', 'triceps')
const EX_ROW = ex('ex-row', 'Row', 'back')
const EX_INCLINE = ex('ex-incline', 'Incline Press', 'chest')
const EX_LUNGE = ex('ex-lunge', 'Lunge', 'quads')
const EX_PRESS = ex('ex-press', 'Overhead Press', 'shoulders')

const pe = (id: string, exercise: Exercise, position: number, over: Partial<ProgramExercise> = {}, workoutDayId = 'wd-1'): ProgramExercise => ({
  id, workoutDayId, userId: 'user-1', exerciseId: exercise.id, position, weightUnit: null, exercise, ...over,
})

// The run's copy, in ITS order.
const RUN_COPY: ProgramExercise[] = [
  pe('pe-1', EX_BENCH, 0, { restSeconds: 90, restAfterSeconds: 180, tempo: '3-1-1-0', weightUnit: 'lbs' }),
  pe('pe-2', EX_SQUAT, 1),
  pe('pe-3', EX_DIPS, 2, { weightUnit: 'kg' }),
  pe('pe-4', EX_ROW, 3),
]

// This week's list, in THIS week's order: Dips moved above Squat, the Row swapped for Incline Press (a
// week_only row), Lunge added (a week_only row).
function weekExercises(over: Record<string, Partial<ProgramExercise>> = {}): ProgramExercise[] {
  const rows = [
    pe('pe-1', EX_BENCH, 0, { restSeconds: 90, restAfterSeconds: 180, tempo: '3-1-1-0', weightUnit: 'lbs' }),
    pe('pe-3', EX_DIPS, 1, { weightUnit: 'kg' }),
    pe('pe-2', EX_SQUAT, 2),
    pe('pe-s', EX_INCLINE, 3),
    pe('pe-n', EX_LUNGE, 4),
  ]
  return rows.map((row) => ({ ...row, ...(over[row.id] ?? {}) }))
}

function wset(over: Partial<WeekPlanSet>): WeekPlanSet {
  return {
    id: 'x', weekPlanId: 'wp-2', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 2,
    isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: 100, repMin: 8, repMax: 8, ...over,
  }
}

// Bench Press: a warmup (1), a working set (2), a staged working set (3: rest-pause, one stage), a working
// set whose program set carries no rest (4), and a set ADDED this week (5: no program set at all).
// Dips and Squat: one set each. Incline Press (swapped in): one set that still names the REPLACED row's
// program set. Lunge (added): one set with none.
const SETS: WeekPlanSet[] = [
  wset({ id: 'bw', setNumber: 1, isWarmup: true, targetRir: null, programSetId: 'ps-bw' }),
  wset({ id: 'b2', setNumber: 2, programSetId: 'ps-b2' }),
  wset({ id: 'b3', setNumber: 3, stageKind: 'rest_pause', programSetId: 'ps-b3' }),
  wset({ id: 'b3s', setNumber: 3, isDropset: true, parentWeekPlanSetId: 'b3', stageIndex: 1, programSetId: 'ps-b3s' }),
  wset({ id: 'b4', setNumber: 4, programSetId: 'ps-b4' }),
  wset({ id: 'b5', setNumber: 5, programSetId: null }),
  wset({ id: 'd1', programExerciseId: 'pe-3', setNumber: 1, programSetId: 'ps-d1' }),
  wset({ id: 'q1', programExerciseId: 'pe-2', setNumber: 1, programSetId: 'ps-q1' }),
  wset({ id: 'i1', programExerciseId: 'pe-s', setNumber: 1, programSetId: 'ps-r1' }),
  wset({ id: 'l1', programExerciseId: 'pe-n', setNumber: 1, programSetId: null }),
]

const pset = (over: Partial<ProgramSet>): ProgramSet => ({
  id: 'ps', userId: 'user-1', programExerciseId: 'pe-1', position: 0, isWarmup: false, stageKind: null, stageRestSeconds: null,
  parentProgramSetId: null, stageIndex: 0, repMin: 8, repMax: 8, isAmrap: false, restSeconds: null, createdAt: '', ...over,
})
// Every program set the fixture knows of, the replaced row's (pe-4) included.
const PROGRAM_SETS: ProgramSet[] = [
  pset({ id: 'ps-bw', isWarmup: true, restSeconds: 45 }),
  pset({ id: 'ps-b2', restSeconds: 120 }),
  pset({ id: 'ps-b3', stageKind: 'rest_pause', stageRestSeconds: 20 }),
  pset({ id: 'ps-b3s', parentProgramSetId: 'ps-b3', stageIndex: 1, restSeconds: 10 }),
  pset({ id: 'ps-b4' }),
  pset({ id: 'ps-d1', programExerciseId: 'pe-3' }),
  pset({ id: 'ps-q1', programExerciseId: 'pe-2' }),
  pset({ id: 'ps-r1', programExerciseId: 'pe-4', restSeconds: 99 }),
]

function plan(weekNumber: number, sets: WeekPlanSet[], exercises: ProgramExercise[], workoutDayId = 'wd-1'): WeekPlan {
  return {
    id: workoutDayId === 'wd-1' ? `wp-${weekNumber}` : `wp-${weekNumber}-${workoutDayId}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId, weekNumber,
    isDeload: false, notes: null, sets, exercises, createdAt: '2026-01-01T00:00:00Z',
  }
}

function makeProgram(over: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' }, workoutDays: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent', ...over,
  }
}

const item = (id: string, position: number, body: string, workoutDayId = 'wd-1'): WarmupRoutineItem => ({ id, userId: 'user-1', workoutDayId, position, body })

const mockState: {
  all: WeekPlan[]
  program: Program
  days: WorkoutDay[]
  runCopy: ProgramExercise[]
  blocks: ProgramSupersetBlock[] | undefined
  programSets: ProgramSet[]
  routine: WarmupRoutineItem[]
  routineByDay: Record<string, WarmupRoutineItem[]>
  toggling: boolean
} = {
  all: [], program: makeProgram(), days: [workoutDay], runCopy: RUN_COPY, blocks: [], programSets: PROGRAM_SETS, routine: [], routineByDay: {}, toggling: false,
}

// The mutations the STRUCTURE view hands each edit to (all of them the program tab's own hooks) ...
const updateRestMutate = vi.fn()
const updateTempoMutate = vi.fn()
const updateUnitMutate = vi.fn()
const toggleLinkMutate = vi.fn()
const updateBlockRestMutate = vi.fn()
const updateSetRestMutate = vi.fn()
const updateStageRestMutate = vi.fn()
const addItemMutateAsync = vi.fn()
const updateItemMutate = vi.fn()
const removeItemMutate = vi.fn()
const reorderItemsMutate = vi.fn()
// ... and what each hook was keyed by, to prove which workout it edits.
const hookKeys = {
  rest: vi.fn(), tempo: vi.fn(), unit: vi.fn(), link: vi.fn(), blockRest: vi.fn(), blocks: vi.fn(),
  routine: vi.fn(), addItem: vi.fn(), updateItem: vi.fn(), removeItem: vi.fn(), reorderItems: vi.fn(), programSets: vi.fn(),
}
// The page's own week mutations, so a test can see none of them is touched by a run-wide edit.
const addWarmupMutate = vi.fn()
const updateSetMutate = vi.fn()
const swapMutate = vi.fn().mockResolvedValue({ id: 'swap-result-row' })
const reorderMutate = vi.fn()
const addExerciseMutate = vi.fn()
const removeExerciseMutate = vi.fn()
const applyAheadMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: mockState.days, isLoading: false }),
  // The run's copy of a workout, in the run copy's own order (the fallback the panel reads when a week has no plan row).
  useProgramExercises: (workoutDayId: string) => ({ data: workoutDayId === 'wd-1' ? mockState.runCopy : [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
  useUpdateProgramExerciseRest: (workoutDayId: string) => { hookKeys.rest(workoutDayId); return { mutate: updateRestMutate, isPending: false } },
  useUpdateProgramExerciseTempo: (workoutDayId: string) => { hookKeys.tempo(workoutDayId); return { mutate: updateTempoMutate, isPending: false } },
  useUpdateProgramExerciseWeightUnit: (workoutDayId: string) => { hookKeys.unit(workoutDayId); return { mutate: updateUnitMutate, isPending: false } },
  useToggleSupersetLink: (workoutDayId: string) => { hookKeys.link(workoutDayId); return { mutate: toggleLinkMutate, isPending: mockState.toggling } },
  useUpdateSupersetBlockRest: (workoutDayId: string) => { hookKeys.blockRest(workoutDayId); return { mutate: updateBlockRestMutate, isPending: false } },
  useSupersetBlockRests: (workoutDayId: string) => { hookKeys.blocks(workoutDayId); return { data: mockState.blocks } },
  useWarmupRoutineItems: (workoutDayId: string) => {
    hookKeys.routine(workoutDayId)
    return { data: mockState.routineByDay[workoutDayId] ?? (workoutDayId === 'wd-1' ? mockState.routine : []), isLoading: false }
  },
  useAddWarmupItem: (workoutDayId: string) => { hookKeys.addItem(workoutDayId); return { mutateAsync: addItemMutateAsync, isPending: false } },
  useUpdateWarmupItemBody: (workoutDayId: string) => { hookKeys.updateItem(workoutDayId); return { mutate: updateItemMutate, isPending: false } },
  useRemoveWarmupItem: (workoutDayId: string) => { hookKeys.removeItem(workoutDayId); return { mutate: removeItemMutate, isPending: false } },
  useReorderWarmupItems: (workoutDayId: string) => { hookKeys.reorderItems(workoutDayId); return { mutate: reorderItemsMutate, isPending: false } },
}))
// The program sets come back whatever ids are asked for (a dumb fake: see the header).
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  useProgramSets: (ids: string[]) => { hookKeys.programSets(ids); return { data: mockState.programSets } },
  useUpdateProgramSetRest: () => ({ mutate: updateSetRestMutate, isPending: false }),
  useUpdateProgramSetStageRest: () => ({ mutate: updateStageRestMutate, isPending: false }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [EX_PRESS] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: mockState.all.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.all, isLoading: false }),
  useApplyAhead: () => ({ mutate: applyAheadMutate, isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: addWarmupMutate, isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: swapMutate, isPending: false }),
  useAddWeekExercise: () => ({ mutate: addExerciseMutate, isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: removeExerciseMutate, isPending: false }),
  useReorderWeekExercises: () => ({ mutate: reorderMutate, isPending: false }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
// Chunk 32: a stable run's current and later weeks also show "Make this week the new default" (it owns
// a mutation, which needs a QueryClientProvider this file's render() doesn't set up). Nothing here is
// about it: PlanPage.makeDefault.test.tsx proves the real component.
vi.mock('./MakeWeekDefault', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')
const { openStructureView, openExerciseMenu } = await import('./planMenus.testutil')

const allMocks = [
  updateRestMutate, updateTempoMutate, updateUnitMutate, toggleLinkMutate, updateBlockRestMutate, updateSetRestMutate,
  updateStageRestMutate, addItemMutateAsync, updateItemMutate, removeItemMutate, reorderItemsMutate, addWarmupMutate,
  updateSetMutate, reorderMutate, addExerciseMutate, removeExerciseMutate, applyAheadMutate,
  ...Object.values(hookKeys),
]

afterEach(() => {
  for (const m of allMocks) m.mockClear()
  swapMutate.mockReset().mockResolvedValue({ id: 'swap-result-row' })
  addItemMutateAsync.mockReset().mockResolvedValue(undefined)
  mockState.program = makeProgram()
  mockState.days = [workoutDay]
  mockState.runCopy = RUN_COPY
  mockState.blocks = []
  mockState.programSets = PROGRAM_SETS
  mockState.routine = []
  mockState.routineByDay = {}
  mockState.toggling = false
})

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

// Week 2 (viewed) has the exercises and sets above; week 3 is planned, so an edit that is a normal week
// edit WOULD be offered ahead (which is what makes "no offer" after a run-wide edit mean something).
function arrange(exercises: ProgramExercise[] = weekExercises(), sets: WeekPlanSet[] = SETS) {
  mockState.all = [plan(1, sets, exercises), plan(2, sets, exercises), plan(3, [], [])]
  const view = renderPlanPage()
  openStructureView()
  return view
}

const more = (label: string) => fireEvent.click(screen.getByLabelText(`More ${label}`))
const less = (label: string) => fireEvent.click(screen.getByLabelText(`Less ${label}`))
// The set ⋯ buttons are in page order: this week's exercises in this week's order. Bench Press is first and has
// sets 1–5; Dips, Squat, Incline Press and Lunge have a set 1 each.
const setMenu = (setNumber: number, nth = 0) => fireEvent.click(screen.getAllByLabelText(`Options for set ${setNumber}`)[nth])
const stageMenu = () => fireEvent.click(screen.getByLabelText('Options for stage'))
const SET_1_OF = { bench: 0, dips: 1, squat: 2, incline: 3, lunge: 4 } as const

// Every compact marker on the page: a chip whose text starts with one of the run-wide fields' words.
// (The REST-PAUSE kind label is a different thing; the space after the word keeps it out.)
function runWideMarkers(): string[] {
  return Array.from(document.body.querySelectorAll('span'))
    .map((el) => el.textContent ?? '')
    .filter((text) => /^(REST|REST AFTER|STAGE REST|TEMPO|UNIT) \S/.test(text))
}

const bannerText = /APPLY THIS CHANGE TO \d+ PLANNED WEEKS? AHEAD\?/

// ─── The exercise's ⋯ ─────────────────────────────────────────────────────────

describe('PlanPage STRUCTURE — an exercise\'s REST, REST AFTER, TEMPO and unit are in its ⋯, and write that exercise\'s own row', () => {
  it('REST and REST AFTER write restSeconds / restAfterSeconds on THE exercise\'s program-exercise row, for each exercise of the week', () => {
    arrange()

    // Bench Press already has REST 90 s and REST AFTER 180 s: one step each way.
    openExerciseMenu('Bench Press')
    more('rest for Bench Press')
    expect(updateRestMutate).toHaveBeenLastCalledWith({ id: 'pe-1', changes: { restSeconds: 105 } })
    less('rest for Bench Press')
    expect(updateRestMutate).toHaveBeenLastCalledWith({ id: 'pe-1', changes: { restSeconds: 75 } })
    more('rest after for Bench Press')
    expect(updateRestMutate).toHaveBeenLastCalledWith({ id: 'pe-1', changes: { restAfterSeconds: 195 } })
    less('rest after for Bench Press')
    expect(updateRestMutate).toHaveBeenLastCalledWith({ id: 'pe-1', changes: { restAfterSeconds: 165 } })
    openExerciseMenu('Bench Press') // close

    // Dips is second IN THIS WEEK (it is third in the run's copy) and Squat third (second in the copy): each writes its own row.
    openExerciseMenu('Dips')
    more('rest for Dips')
    expect(updateRestMutate).toHaveBeenLastCalledWith({ id: 'pe-3', changes: { restSeconds: 15 } })
    openExerciseMenu('Dips')
    openExerciseMenu('Squat')
    more('rest for Squat')
    expect(updateRestMutate).toHaveBeenLastCalledWith({ id: 'pe-2', changes: { restSeconds: 15 } })
    more('rest after for Squat')
    expect(updateRestMutate).toHaveBeenLastCalledWith({ id: 'pe-2', changes: { restAfterSeconds: 15 } })

    expect(updateRestMutate.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['pe-1', 'pe-1', 'pe-1', 'pe-1', 'pe-3', 'pe-2', 'pe-2'])
    // The hook is the run copy's workout's own (the week plan's id is not a workout's).
    expect(hookKeys.rest).toHaveBeenCalledWith('wd-1')
    expect(hookKeys.rest).not.toHaveBeenCalledWith('wp-2')
  })

  it('an exercise swapped in or added this week is a slot of its own: its REST is ITS week_only row, never the run copy\'s row at its position', () => {
    arrange()

    // Incline Press (fourth this week) replaced the Row; the run's copy has the Row, pe-4, at that position.
    openExerciseMenu('Incline Press')
    more('rest for Incline Press')
    expect(updateRestMutate).toHaveBeenLastCalledWith({ id: 'pe-s', changes: { restSeconds: 15 } })
    more('rest after for Incline Press')
    expect(updateRestMutate).toHaveBeenLastCalledWith({ id: 'pe-s', changes: { restAfterSeconds: 15 } })
    openExerciseMenu('Incline Press')

    // Lunge was added this week: the run's copy has no fifth row at all.
    openExerciseMenu('Lunge')
    more('rest for Lunge')
    expect(updateRestMutate).toHaveBeenLastCalledWith({ id: 'pe-n', changes: { restSeconds: 15 } })

    // ... and its tempo and unit are its own row's too.
    fireEvent.click(screen.getByText('—'))
    fireEvent.change(screen.getByLabelText('Tempo'), { target: { value: '2-0-2-0' } })
    fireEvent.blur(screen.getByLabelText('Tempo'))
    expect(updateTempoMutate).toHaveBeenLastCalledWith({ id: 'pe-n', tempo: '2-0-2-0' })
    fireEvent.click(within(screen.getByRole('group', { name: 'Weight unit' })).getByRole('button', { name: 'LBS' }))
    expect(updateUnitMutate).toHaveBeenLastCalledWith({ id: 'pe-n', weightUnit: 'lbs' })

    const ids = [...updateRestMutate.mock.calls, ...updateTempoMutate.mock.calls, ...updateUnitMutate.mock.calls].map((c) => (c[0] as { id: string }).id)
    expect(ids).toEqual(['pe-s', 'pe-s', 'pe-n', 'pe-n', 'pe-n'])
    expect(ids).not.toContain('pe-4') // the replaced Row's row, which the run's copy still holds at that position
  })

  it('TEMPO writes the NORMALISED tempo on the exercise\'s row; an invalid entry shows an inline error and writes nothing; blank writes null', () => {
    arrange()
    openExerciseMenu('Bench Press') // tempo 3-1-1-0

    // Valid: lowercase x is normalised by plannerVocabulary's parser, the one parser there is.
    fireEvent.click(screen.getByText('3-1-1-0'))
    fireEvent.change(screen.getByLabelText('Tempo'), { target: { value: '3-1-x-0' } })
    fireEvent.blur(screen.getByLabelText('Tempo'))
    expect(updateTempoMutate).toHaveBeenCalledTimes(1)
    expect(updateTempoMutate).toHaveBeenLastCalledWith({ id: 'pe-1', tempo: '3-1-X-0' })

    // Invalid: refused inline, the raw entry stays, nothing is written.
    fireEvent.click(screen.getByText('3-1-1-0'))
    fireEvent.change(screen.getByLabelText('Tempo'), { target: { value: 'fast' } })
    fireEvent.blur(screen.getByLabelText('Tempo'))
    expect(screen.getByText(/Use 4 fields/)).toBeTruthy()
    expect((screen.getByLabelText('Tempo') as HTMLInputElement).value).toBe('fast')
    expect(updateTempoMutate).toHaveBeenCalledTimes(1)

    // ... a fixed entry then writes; blank clears.
    fireEvent.change(screen.getByLabelText('Tempo'), { target: { value: '4-0-1-0' } })
    fireEvent.blur(screen.getByLabelText('Tempo'))
    expect(updateTempoMutate).toHaveBeenCalledTimes(2)
    expect(updateTempoMutate).toHaveBeenLastCalledWith({ id: 'pe-1', tempo: '4-0-1-0' })
    fireEvent.click(screen.getByText('3-1-1-0'))
    fireEvent.change(screen.getByLabelText('Tempo'), { target: { value: '  ' } })
    fireEvent.blur(screen.getByLabelText('Tempo'))
    expect(updateTempoMutate).toHaveBeenLastCalledWith({ id: 'pe-1', tempo: null })
    expect(hookKeys.tempo).toHaveBeenCalledWith('wd-1')
  })

  it('the unit is editable on a week-dependent run — the program tab disables it there — and on a stable one, writing the exercise\'s own row', () => {
    for (const planningType of ['week_dependent', 'stable'] as const) {
      mockState.program = makeProgram({ planningType })
      updateUnitMutate.mockClear()
      const { unmount } = arrange()

      openExerciseMenu('Squat') // no unit of its own: INHERIT is the active chip
      const chips = within(screen.getByRole('group', { name: 'Weight unit' }))
      const inherit = chips.getByRole('button', { name: 'INHERIT (KG)' }) as HTMLButtonElement
      const lbs = chips.getByRole('button', { name: 'LBS' }) as HTMLButtonElement
      const kg = chips.getByRole('button', { name: 'KG' }) as HTMLButtonElement
      expect([inherit.disabled, lbs.disabled, kg.disabled]).toEqual([false, false, false])
      fireEvent.click(lbs)
      expect(updateUnitMutate).toHaveBeenLastCalledWith({ id: 'pe-2', weightUnit: 'lbs' })
      fireEvent.click(kg)
      expect(updateUnitMutate).toHaveBeenLastCalledWith({ id: 'pe-2', weightUnit: 'kg' })
      fireEvent.click(inherit)
      expect(updateUnitMutate).toHaveBeenLastCalledWith({ id: 'pe-2', weightUnit: null })
      expect(updateUnitMutate).toHaveBeenCalledTimes(3)
      unmount()
    }
    expect(hookKeys.unit).toHaveBeenCalledWith('wd-1')
  })

  it('the active unit chip is the exercise\'s own (INHERIT / KG / LBS), read from the week\'s row', () => {
    arrange()

    const activeChips = () => {
      const chips = within(screen.getByRole('group', { name: 'Weight unit' }))
      return ['INHERIT (KG)', 'KG', 'LBS'].filter((name) => chips.getByRole('button', { name }).style.background === 'var(--accent-muted)')
    }
    openExerciseMenu('Bench Press') // lbs
    expect(activeChips()).toEqual(['LBS'])
    openExerciseMenu('Bench Press')
    openExerciseMenu('Dips') // kg
    expect(activeChips()).toEqual(['KG'])
    openExerciseMenu('Dips')
    openExerciseMenu('Squat') // none
    expect(activeChips()).toEqual(['INHERIT (KG)'])
  })

  it('no exercise ⋯ holds a control for a field another view owns, and the ⋯ keeps its four week actions', () => {
    arrange()
    openExerciseMenu('Dips')
    for (const label of ['Swap Dips', 'Move up', 'Move down', 'Add warmup sets', 'Remove Dips from this week']) expect(screen.getByLabelText(label)).toBeTruthy()
    // The steppers' own taps do not close the menu (they are tapped several times in a row) ...
    more('rest for Dips')
    more('rest for Dips')
    expect(screen.getByLabelText('Swap Dips')).toBeTruthy()
    // ... and an action does.
    fireEvent.click(screen.getByLabelText('Add warmup sets'))
    expect(screen.queryByLabelText('Swap Dips')).toBeNull()
    expect(addWarmupMutate).toHaveBeenCalledWith({ workoutDayId: 'wd-1', weekPlanId: 'wp-2', programExerciseId: 'pe-3' })
  })

  it('every hook the run-wide fields add is keyed by the SELECTED workout\'s id, and the week page is never asked for them while SETS shows', () => {
    mockState.program = makeProgram({ schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1', thursday: 'wd-2' } })
    mockState.days = [workoutDay, workoutDay2]
    const press = pe('pe-p', EX_PRESS, 0, {}, 'wd-2')
    mockState.all = [
      plan(2, SETS, weekExercises()), plan(2, [wset({ id: 'p1', weekPlanId: 'wp-2-wd-2', programExerciseId: 'pe-p' })], [press], 'wd-2'),
      plan(3, [], []),
    ]
    renderPlanPage()
    // SETS opens first: none of the STRUCTURE view's hooks is called (it mounts them only when it shows).
    for (const key of Object.values(hookKeys)) expect(key).not.toHaveBeenCalled()

    openStructureView()
    for (const key of [hookKeys.rest, hookKeys.tempo, hookKeys.unit, hookKeys.link, hookKeys.blocks, hookKeys.blockRest, hookKeys.routine]) {
      expect(key).toHaveBeenCalledWith('wd-1')
      expect(key).not.toHaveBeenCalledWith('wd-2')
    }
    for (const key of Object.values(hookKeys)) key.mockClear()

    fireEvent.click(screen.getByText('THU'))
    for (const key of [hookKeys.rest, hookKeys.tempo, hookKeys.unit, hookKeys.link, hookKeys.blocks, hookKeys.blockRest, hookKeys.routine]) {
      expect(key).toHaveBeenCalledWith('wd-2')
      expect(key).not.toHaveBeenCalledWith('wd-1')
    }
    // ... and the exercise it edits is that workout's own row.
    openExerciseMenu('Overhead Press')
    more('rest for Overhead Press')
    expect(updateRestMutate).toHaveBeenLastCalledWith({ id: 'pe-p', changes: { restSeconds: 15 } })
    // The program sets are read for THIS week's rows (this workout's), not the run copy's.
    expect(hookKeys.programSets).toHaveBeenLastCalledWith(['pe-p'])
  })

  it('the program sets are read for this week\'s exercise rows — the swapped-in and added ones included', () => {
    arrange()
    expect(hookKeys.programSets).toHaveBeenCalledWith(['pe-1', 'pe-3', 'pe-2', 'pe-s', 'pe-n'])
  })
})

// ─── Grouping ─────────────────────────────────────────────────────────────────

function expectBefore(a: HTMLElement, b: HTMLElement) {
  expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}
const toggles = () => screen.getAllByRole('button', { name: /LINK AS SUPERSET|TAP TO UNLINK/ })
const withoutLabel = (text: string | null) => (text ?? '').replace('EVERY WEEK', '')

describe('PlanPage STRUCTURE — superset grouping: any two neighbours IN THIS WEEK can be linked or unlinked (G35)', () => {
  it('a toggle sits between every two neighbours of this week\'s order, and linking runs planLinkToggle over THAT order, not the run copy\'s', () => {
    arrange()

    // Five exercises this week, four gaps — none after the last.
    expect(toggles()).toHaveLength(4)
    expect(toggles().map((b) => withoutLabel(b.textContent))).toEqual(Array(4).fill('LINK AS SUPERSET'))

    // Gap 0: Bench Press and Dips are neighbours this week; in the run's copy Squat is between them.
    fireEvent.click(toggles()[0])
    expect(toggleLinkMutate).toHaveBeenLastCalledWith([{ ids: ['pe-1', 'pe-3'], blockId: null, needsNewBlock: true }])
    // Gap 2: Squat and Incline Press — a run-copy row and a swapped-in week_only row, neighbours only this week.
    fireEvent.click(toggles()[2])
    expect(toggleLinkMutate).toHaveBeenLastCalledWith([{ ids: ['pe-2', 'pe-s'], blockId: null, needsNewBlock: true }])
    // Gap 3: Incline Press and Lunge — two week_only rows, neither in the run's copy at all.
    fireEvent.click(toggles()[3])
    expect(toggleLinkMutate).toHaveBeenLastCalledWith([{ ids: ['pe-s', 'pe-n'], blockId: null, needsNewBlock: true }])
    expect(toggleLinkMutate).toHaveBeenCalledTimes(3)
    expect(hookKeys.link).toHaveBeenCalledWith('wd-1')
  })

  it('linking next to a block joins it (its id is kept); unlinking inside a run of three splits it where the gap is', () => {
    mockState.blocks = [{ id: 'blk-1', restWithinRoundSeconds: null, restAfterRoundSeconds: null }]
    // Bench Press, Dips and Squat are one block this week.
    arrange(weekExercises({ 'pe-1': { supersetBlockId: 'blk-1' }, 'pe-3': { supersetBlockId: 'blk-1' }, 'pe-2': { supersetBlockId: 'blk-1' } }))

    expect(toggles().map((b) => withoutLabel(b.textContent))).toEqual([
      'SUPERSET — TAP TO UNLINK', 'SUPERSET — TAP TO UNLINK', 'LINK AS SUPERSET', 'LINK AS SUPERSET',
    ])
    // Squat | Incline Press: the whole run joins, under the block it already has.
    fireEvent.click(toggles()[2])
    expect(toggleLinkMutate).toHaveBeenLastCalledWith([{ ids: ['pe-1', 'pe-3', 'pe-2', 'pe-s'], blockId: 'blk-1', needsNewBlock: false }])
    // Bench Press | Dips: the first one leaves; the other two stay together under the same block.
    fireEvent.click(toggles()[0])
    expect(toggleLinkMutate).toHaveBeenLastCalledWith([
      { ids: ['pe-1'], blockId: null, needsNewBlock: false },
      { ids: ['pe-3', 'pe-2'], blockId: 'blk-1', needsNewBlock: false },
    ])
    // Dips | Squat: the pair on the left keeps the block; Squat leaves it.
    fireEvent.click(toggles()[1])
    expect(toggleLinkMutate).toHaveBeenLastCalledWith([
      { ids: ['pe-1', 'pe-3'], blockId: 'blk-1', needsNewBlock: false },
      { ids: ['pe-2'], blockId: null, needsNewBlock: false },
    ])

    // A pair splits into two singles, neither in a superset any more.
    cleanup()
    toggleLinkMutate.mockClear()
    arrange(weekExercises({ 'pe-3': { supersetBlockId: 'blk-1' }, 'pe-2': { supersetBlockId: 'blk-1' } }))
    fireEvent.click(toggles()[1])
    expect(toggleLinkMutate).toHaveBeenLastCalledWith([
      { ids: ['pe-3'], blockId: null, needsNewBlock: false },
      { ids: ['pe-2'], blockId: null, needsNewBlock: false },
    ])
  })

  it('linked exercises show as a superset only in a week where they are next to each other: a later week where they are apart shows them separately', () => {
    mockState.blocks = [{ id: 'blk-1', restWithinRoundSeconds: null, restAfterRoundSeconds: null }]
    // The same two rows (Bench Press and Dips, one block) are neighbours in week 2 and apart in week 3.
    const week2 = weekExercises({ 'pe-1': { supersetBlockId: 'blk-1' }, 'pe-3': { supersetBlockId: 'blk-1' } })
    const week3 = [
      { ...week2[0], position: 0 }, { ...week2[2], position: 1 }, { ...week2[1], position: 2 }, { ...week2[3], position: 3 }, { ...week2[4], position: 4 },
    ]
    mockState.all = [plan(2, SETS, week2), plan(3, [], week3)]
    renderPlanPage()
    openStructureView()

    expect(screen.getAllByText('· SUPERSET')).toHaveLength(2)
    expect(screen.getAllByText('WITHIN ROUND')).toHaveLength(1) // one block, edited once
    expect(toggles()[0].textContent).toContain('TAP TO UNLINK')

    fireEvent.click(screen.getByLabelText('Next week'))
    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.getByLabelText('Bench Press options')).toBeTruthy() // not a past week: still editable
    // Apart in this week: two plain exercises, no marker, no block rests, a LINK toggle between each pair.
    expect(screen.queryByText('· SUPERSET')).toBeNull()
    expect(screen.queryByText('WITHIN ROUND')).toBeNull()
    expect(screen.queryByText('SUPERSET')).toBeNull()
    expect(toggles().map((b) => withoutLabel(b.textContent))).toEqual(Array(4).fill('LINK AS SUPERSET'))
    // Bench Press (position 0) and Squat (position 1) are neighbours here — and Bench Press already has the block.
    fireEvent.click(toggles()[0])
    expect(toggleLinkMutate).toHaveBeenLastCalledWith([{ ids: ['pe-1', 'pe-2'], blockId: 'blk-1', needsNewBlock: false }])
  })

  it('a toggle is disabled while a link is being written (as the program tab\'s is), so a second tap cannot plan from stale rows', () => {
    arrange()
    expect(toggles().every((b) => !(b as HTMLButtonElement).disabled)).toBe(true)
    cleanup()

    mockState.toggling = true
    arrange()
    expect(toggles().every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    fireEvent.click(toggles()[0])
    expect(toggleLinkMutate).not.toHaveBeenCalled()
  })
})

describe('PlanPage STRUCTURE — a superset\'s round rests are edited once, after its last member, and write that block', () => {
  function arrangeBlocks() {
    mockState.blocks = [
      { id: 'blk-1', restWithinRoundSeconds: 30, restAfterRoundSeconds: null },
      { id: 'blk-2', restWithinRoundSeconds: null, restAfterRoundSeconds: 120 },
    ]
    // Bench Press + Dips are block 1; Squat + Incline Press are block 2; Lunge is on its own.
    return arrange(weekExercises({
      'pe-1': { supersetBlockId: 'blk-1' }, 'pe-3': { supersetBlockId: 'blk-1' },
      'pe-2': { supersetBlockId: 'blk-2' }, 'pe-s': { supersetBlockId: 'blk-2' },
    }))
  }

  it('one WITHIN ROUND / AFTER ROUND editor per block — not per member, none for the exercise on its own — after its last member', () => {
    arrangeBlocks()

    expect(screen.getAllByText('WITHIN ROUND')).toHaveLength(2)
    expect(screen.getAllByText('AFTER ROUND')).toHaveLength(2)
    const [first, second] = screen.getAllByText('SUPERSET').map((el) => el.parentElement as HTMLElement)
    // Block 1's values: 30 s within the round, none after; block 2's the other way round.
    expect(within(first).getByText('30s')).toBeTruthy()
    expect(within(first).getByText('PER EXERCISE')).toBeTruthy()
    expect(within(second).getByText('NO TIMER')).toBeTruthy()
    expect(within(second).getByText('2min 0s')).toBeTruthy()
    // Placement: block 1's editor is after Dips (its last member), before Squat; block 2's after Incline Press, before Lunge.
    expectBefore(screen.getByText('Dips'), first)
    expectBefore(first, screen.getByText('Squat'))
    expectBefore(screen.getByText('Incline Press'), second)
    expectBefore(second, screen.getByText('Lunge'))
  })

  it('WITHIN ROUND writes restWithinRoundSeconds and AFTER ROUND restAfterRoundSeconds, each on its own block', () => {
    arrangeBlocks()

    fireEvent.click(screen.getAllByLabelText('More rest within round')[0])
    expect(updateBlockRestMutate).toHaveBeenLastCalledWith({ id: 'blk-1', changes: { restWithinRoundSeconds: 45 } })
    fireEvent.click(screen.getAllByLabelText('More rest after round')[0])
    expect(updateBlockRestMutate).toHaveBeenLastCalledWith({ id: 'blk-1', changes: { restAfterRoundSeconds: 15 } })
    fireEvent.click(screen.getAllByLabelText('More rest within round')[1])
    expect(updateBlockRestMutate).toHaveBeenLastCalledWith({ id: 'blk-2', changes: { restWithinRoundSeconds: 15 } })
    fireEvent.click(screen.getAllByLabelText('More rest after round')[1])
    expect(updateBlockRestMutate).toHaveBeenLastCalledWith({ id: 'blk-2', changes: { restAfterRoundSeconds: 135 } })
    fireEvent.click(screen.getAllByLabelText('Less rest within round')[0]) // 30 s -> 15 s
    expect(updateBlockRestMutate).toHaveBeenLastCalledWith({ id: 'blk-1', changes: { restWithinRoundSeconds: 15 } })
    expect(updateBlockRestMutate).toHaveBeenCalledTimes(5)
    expect(hookKeys.blockRest).toHaveBeenCalledWith('wd-1')
    expect(hookKeys.blocks).toHaveBeenCalledWith('wd-1')
  })

  it('waits for the blocks to be read: until then there is no editor to tap a default over (the toggles are there)', () => {
    mockState.blocks = undefined
    arrange(weekExercises({ 'pe-1': { supersetBlockId: 'blk-1' }, 'pe-3': { supersetBlockId: 'blk-1' } }))

    expect(screen.queryByText('WITHIN ROUND')).toBeNull()
    expect(screen.queryByText('AFTER ROUND')).toBeNull()
    expect(withoutLabel(toggles()[0].textContent)).toBe('SUPERSET — TAP TO UNLINK')
  })

  it('a run of three has one editor, after its third member', () => {
    mockState.blocks = [{ id: 'blk-1', restWithinRoundSeconds: null, restAfterRoundSeconds: null }]
    arrange(weekExercises({ 'pe-1': { supersetBlockId: 'blk-1' }, 'pe-3': { supersetBlockId: 'blk-1' }, 'pe-2': { supersetBlockId: 'blk-1' } }))

    expect(screen.getAllByText('WITHIN ROUND')).toHaveLength(1)
    expectBefore(screen.getByText('Squat'), screen.getByText('WITHIN ROUND'))
    expectBefore(screen.getByText('WITHIN ROUND'), screen.getByText('Incline Press'))
  })

  it('a block with one member left in this week is no superset: no marker, no editor', () => {
    mockState.blocks = [{ id: 'blk-1', restWithinRoundSeconds: 30, restAfterRoundSeconds: 30 }]
    // Only Bench Press carries the block here (its partner was removed from this week, say).
    arrange(weekExercises({ 'pe-1': { supersetBlockId: 'blk-1' } }))

    expect(screen.queryByText('WITHIN ROUND')).toBeNull()
    expect(screen.queryByText('· SUPERSET')).toBeNull()
  })
})

// ─── A set's own REST and a staged head's STAGE REST ──────────────────────────

describe('PlanPage STRUCTURE — a set\'s own REST and a staged head\'s STAGE REST are in that set\'s ⋯, and write that set\'s own program set', () => {
  it('REST on a working set, a warmup and a stage each write THAT set\'s program set (restSeconds)', () => {
    arrange()

    setMenu(2) // Bench Press set 2: ps-b2, REST 120 s
    more('rest of set 2 for Bench Press')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-b2', restSeconds: 135 })
    less('rest of set 2 for Bench Press')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-b2', restSeconds: 105 })
    setMenu(2) // close

    setMenu(1, SET_1_OF.bench) // the warmup: ps-bw, REST 45 s
    more('rest of set 1 for Bench Press')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-bw', restSeconds: 60 })
    setMenu(1, SET_1_OF.bench)

    stageMenu() // the stage of set 3: ps-b3s, REST 10 s — its own rest, not its head's
    more('rest of stage 1 of set 3 for Bench Press')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-b3s', restSeconds: 25 })
    stageMenu()

    setMenu(4) // a working set whose program set has no rest yet: the first tap starts at 15 s
    expect(screen.getByText('CHAIN')).toBeTruthy()
    more('rest of set 4 for Bench Press')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-b4', restSeconds: 15 })
    setMenu(4)

    // Each other exercise's set is its own program set.
    setMenu(1, SET_1_OF.dips)
    more('rest of set 1 for Dips')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-d1', restSeconds: 15 })
    setMenu(1, SET_1_OF.dips)
    setMenu(1, SET_1_OF.squat)
    more('rest of set 1 for Squat')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-q1', restSeconds: 15 })

    expect(updateSetRestMutate.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['ps-b2', 'ps-b2', 'ps-bw', 'ps-b3s', 'ps-b4', 'ps-d1', 'ps-q1'])
    // ... and none of them is a stage rest.
    expect(updateStageRestMutate).not.toHaveBeenCalled()
  })

  it('STAGE REST is on a STAGED head only, writes stageRestSeconds on the head\'s program set, and is separate from the head\'s own REST', () => {
    arrange()

    setMenu(3) // the staged head: ps-b3, STAGE REST 20 s, REST none
    expect(screen.getByText('20s')).toBeTruthy()
    more('stage rest of set 3 for Bench Press')
    expect(updateStageRestMutate).toHaveBeenLastCalledWith({ id: 'ps-b3', stageRestSeconds: 35 })
    less('stage rest of set 3 for Bench Press')
    expect(updateStageRestMutate).toHaveBeenLastCalledWith({ id: 'ps-b3', stageRestSeconds: 5 })
    expect(updateSetRestMutate).not.toHaveBeenCalled()
    more('rest of set 3 for Bench Press') // its own REST: a different field of the same program set
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-b3', restSeconds: 15 })
    expect(updateStageRestMutate).toHaveBeenCalledTimes(2)
    setMenu(3)

    // Not on a working set that has no stage, a warmup, or a stage row (absence).
    for (const [n, nth, ownAction] of [[2, 0, 'Add stage'], [4, 0, 'Add stage'], [1, SET_1_OF.bench, 'Delete set'], [1, SET_1_OF.dips, 'Add stage']] as const) {
      setMenu(n, nth)
      expect(screen.getByLabelText(ownAction)).toBeTruthy() // (the set's own menu is open, and has its REST)
      expect(screen.getByRole('group', { name: 'Every week' })).toBeTruthy()
      expect(screen.queryByText('STAGE REST')).toBeNull()
      expect(screen.queryByLabelText(/^More stage rest/)).toBeNull()
      setMenu(n, nth)
    }
    stageMenu()
    expect(screen.queryByText('STAGE REST')).toBeNull()
    expect(screen.getByLabelText('Delete stage')).toBeTruthy() // (its menu is open)
  })

  it('an unset STAGE REST reads its kind\'s own default — no timer for a dropset, 15 s for the others — and the first tap starts from nothing', () => {
    mockState.programSets = PROGRAM_SETS.map((ps) => (ps.id === 'ps-b3' ? { ...ps, stageRestSeconds: null } : ps))
    arrange()

    setMenu(3) // rest-pause
    expect(screen.getByText('15S')).toBeTruthy()
    more('stage rest of set 3 for Bench Press')
    expect(updateStageRestMutate).toHaveBeenLastCalledWith({ id: 'ps-b3', stageRestSeconds: 15 })
    // Changing the head's kind (the week's own stage kind) changes what the default reads.
    cleanup()
    arrange(weekExercises(), SETS.map((row) => (row.id === 'b3' ? { ...row, stageKind: 'dropset' as const } : row)))
    setMenu(3)
    expect(screen.getByText('NO TIMER')).toBeTruthy()
    expect(screen.queryByText('15S')).toBeNull()
  })
})

// ─── A superset member's sets ─────────────────────────────────────────────────

// Every test above runs without a superset block, so an exercise is always a unit of one. Here Dips (pe-3) and
// Squat (pe-2) are linked in blk-1, and each has a plain set 1 and a rest-pause head as set 2 with one stage. Every
// set names a program set of its OWN exercise row, and the two members' program sets differ in every value, so a
// REST or STAGE REST that is read from, or written to, the other member's program set (the unit's first member's, say)
// is seen on the screen and in the write.
const SUPERSET_WEEK = [pe('pe-3', EX_DIPS, 0, { supersetBlockId: 'blk-1' }), pe('pe-2', EX_SQUAT, 1, { supersetBlockId: 'blk-1' })]
const SUPERSET_SETS: WeekPlanSet[] = [
  wset({ id: 'd1', programExerciseId: 'pe-3', setNumber: 1, programSetId: 'ps-d1' }),
  wset({ id: 'd2', programExerciseId: 'pe-3', setNumber: 2, stageKind: 'rest_pause', programSetId: 'ps-d2' }),
  wset({ id: 'd2s', programExerciseId: 'pe-3', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'd2', stageIndex: 1, programSetId: 'ps-d2s' }),
  wset({ id: 'q1', programExerciseId: 'pe-2', setNumber: 1, programSetId: 'ps-q1' }),
  wset({ id: 'q2', programExerciseId: 'pe-2', setNumber: 2, stageKind: 'rest_pause', programSetId: 'ps-q2' }),
  wset({ id: 'q2s', programExerciseId: 'pe-2', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'q2', stageIndex: 1, programSetId: 'ps-q2s' }),
]
const SUPERSET_PROGRAM_SETS: ProgramSet[] = [
  pset({ id: 'ps-d1', programExerciseId: 'pe-3', restSeconds: 50 }),
  pset({ id: 'ps-d2', programExerciseId: 'pe-3', position: 1, stageKind: 'rest_pause', stageRestSeconds: 25 }),
  pset({ id: 'ps-d2s', programExerciseId: 'pe-3', position: 2, parentProgramSetId: 'ps-d2', stageIndex: 1, restSeconds: 12 }),
  pset({ id: 'ps-q1', programExerciseId: 'pe-2', restSeconds: 60 }),
  pset({ id: 'ps-q2', programExerciseId: 'pe-2', position: 1, stageKind: 'rest_pause', restSeconds: 70, stageRestSeconds: 40 }),
  pset({ id: 'ps-q2s', programExerciseId: 'pe-2', position: 2, parentProgramSetId: 'ps-q2', stageIndex: 1, restSeconds: 8 }),
]

describe('PlanPage STRUCTURE — a superset member\'s sets: each member\'s REST and STAGE REST are its OWN program sets, the second member\'s included', () => {
  const FIRST = 0 // Dips
  const SECOND = 1 // Squat
  const stageMenuOf = (nth: number) => fireEvent.click(screen.getAllByLabelText('Options for stage')[nth])
  const everyWeek = () => within(screen.getByRole('group', { name: 'Every week' }))

  function arrangeSuperset() {
    mockState.blocks = [{ id: 'blk-1', restWithinRoundSeconds: null, restAfterRoundSeconds: null }]
    mockState.programSets = SUPERSET_PROGRAM_SETS
    const view = arrange(SUPERSET_WEEK, SUPERSET_SETS)
    // Control: the two ARE one superset (a unit of two), with one pair of round rests, after Squat.
    expect(screen.getAllByText('· SUPERSET')).toHaveLength(2)
    expect(screen.getAllByText('WITHIN ROUND')).toHaveLength(1)
    return view
  }

  it('the second member\'s set REST, STAGE REST and stage REST show its own values and write ITS program sets; the first member\'s write its own', () => {
    arrangeSuperset()

    // Squat, the second member. Set 2 is a staged head: REST 70 s and STAGE REST 40 s, both Squat's.
    setMenu(2, SECOND)
    expect(everyWeek().getByText('1min 10s')).toBeTruthy()
    expect(everyWeek().getByText('40s')).toBeTruthy()
    more('rest of set 2 for Squat')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-q2', restSeconds: 85 })
    more('stage rest of set 2 for Squat')
    expect(updateStageRestMutate).toHaveBeenLastCalledWith({ id: 'ps-q2', stageRestSeconds: 55 })
    setMenu(2, SECOND)
    // Set 1, and the stage row (its own rest, not its head's).
    setMenu(1, SECOND)
    more('rest of set 1 for Squat')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-q1', restSeconds: 75 })
    setMenu(1, SECOND)
    stageMenuOf(SECOND)
    more('rest of stage 1 of set 2 for Squat')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-q2s', restSeconds: 23 })
    stageMenuOf(SECOND)

    // Dips, the first member: its own, with its own values (set 2 has no rest of its own, a stage rest of 25 s).
    setMenu(2, FIRST)
    expect(everyWeek().getByText('CHAIN')).toBeTruthy()
    expect(everyWeek().getByText('25s')).toBeTruthy()
    more('rest of set 2 for Dips')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-d2', restSeconds: 15 })
    more('stage rest of set 2 for Dips')
    expect(updateStageRestMutate).toHaveBeenLastCalledWith({ id: 'ps-d2', stageRestSeconds: 40 })
    setMenu(2, FIRST)
    setMenu(1, FIRST)
    more('rest of set 1 for Dips')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-d1', restSeconds: 65 })
    setMenu(1, FIRST)
    stageMenuOf(FIRST)
    more('rest of stage 1 of set 2 for Dips')
    expect(updateSetRestMutate).toHaveBeenLastCalledWith({ id: 'ps-d2s', restSeconds: 27 })

    // Nothing else was written, and each write went to a program set of the member whose menu it was.
    expect(updateSetRestMutate.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['ps-q2', 'ps-q1', 'ps-q2s', 'ps-d2', 'ps-d1', 'ps-d2s'])
    expect(updateStageRestMutate.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['ps-q2', 'ps-d2'])
    expect(updateRestMutate).not.toHaveBeenCalled() // (an exercise's own rest is another write)
  })

  it('each member\'s markers are its own program sets\' values', () => {
    arrangeSuperset()
    expect(runWideMarkers()).toEqual([
      'REST 50s', // Dips set 1
      'STAGE REST 25s', 'REST 12s', // Dips set 2 (a staged head with a stage rest and none of its own) and its stage
      'REST 1min 0s', // Squat set 1
      'REST 1min 10s', 'STAGE REST 40s', 'REST 8s', // Squat set 2 (rest and stage rest) and its stage
    ])
  })
})

// ─── Sets with no program set of their own exercise (G45 answered "no") ───────

describe('PlanPage STRUCTURE — a set with no program set of its OWN exercise row shows no REST and no STAGE REST (G45)', () => {
  const noRestControls = () => {
    expect(screen.queryByRole('group', { name: 'Every week' })).toBeNull()
    expect(screen.queryByLabelText(/^(More|Less) (stage )?rest of /)).toBeNull()
    expect(screen.queryByText('CHAIN')).toBeNull()
  }

  it('a set added in a week (no program_set_id), the sets of an exercise added in a week, and the sets of a swapped-in exercise: their ⋯ holds no REST', () => {
    arrange()

    // The added set: Bench Press set 5. Its ⋯ is open (it holds ADD STAGE) and has no rest control.
    setMenu(5)
    expect(screen.getByLabelText('Add stage')).toBeTruthy()
    noRestControls()
    setMenu(5)

    // The swapped-in exercise's set: it still NAMES the replaced Row's program set (ps-r1, which the
    // fake hands back), but that program set belongs to another exercise row.
    setMenu(1, SET_1_OF.incline)
    expect(screen.getByLabelText('Add stage')).toBeTruthy()
    noRestControls()
    setMenu(1, SET_1_OF.incline)

    // The added exercise's set.
    setMenu(1, SET_1_OF.lunge)
    expect(screen.getByLabelText('Add stage')).toBeTruthy()
    noRestControls()
    setMenu(1, SET_1_OF.lunge)

    // The same menus on the exercises that DO have program sets show it (so the absences above are not vacuous).
    for (const nth of [SET_1_OF.bench, SET_1_OF.dips, SET_1_OF.squat]) {
      setMenu(1, nth)
      expect(screen.getByRole('group', { name: 'Every week' })).toBeTruthy()
      setMenu(1, nth)
    }
    expect(updateSetRestMutate).not.toHaveBeenCalled()
  })

  it('and no marker either: the replaced Row\'s rest (99 s on ps-r1) is not shown on the swapped-in exercise\'s set', () => {
    arrange()
    expect(runWideMarkers()).not.toContain('REST 1min 39s')
    expect(screen.queryByText(/1min 39s/)).toBeNull()
  })

  it('an exercise swapped in carries no set REST even when its sets name a program set of a DIFFERENT exercise that is also in the week', () => {
    // Incline Press's set names Squat's program set (the ids of two rows in this very week).
    arrange(weekExercises(), SETS.map((row) => (row.id === 'i1' ? { ...row, programSetId: 'ps-q1' } : row)))
    setMenu(1, SET_1_OF.incline)
    expect(screen.getByLabelText('Add stage')).toBeTruthy()
    noRestControls()
  })

  it('a set naming a program set that is gone (deleted from the run\'s copy) has none either', () => {
    mockState.programSets = PROGRAM_SETS.filter((ps) => ps.id !== 'ps-d1')
    arrange()
    setMenu(1, SET_1_OF.dips)
    expect(screen.getByLabelText('Add stage')).toBeTruthy()
    noRestControls()
  })

  it('until the program sets have been read there is none: a set is never offered a REST that has nothing to write to', () => {
    mockState.programSets = undefined as unknown as ProgramSet[]
    arrange()
    setMenu(2)
    expect(screen.getByLabelText('Add stage')).toBeTruthy()
    noRestControls()
  })
})

// ─── The warmup routine ───────────────────────────────────────────────────────

describe('PlanPage STRUCTURE — the warmup routine is at the top of the view, run-wide, and edits the workout\'s routine', () => {
  const ROUTINE = [item('wi-1', 0, 'Bike 5 min'), item('wi-2', 1, 'Band pull-aparts'), item('wi-3', 2, 'Arm circles')]
  const card = () => screen.getByRole('group', { name: 'Warmup routine' })

  it('sits above the exercises, under the SETS / STRUCTURE switch, labelled EVERY WEEK; its items show in order', () => {
    mockState.routine = ROUTINE
    arrange()

    expectBefore(screen.getByText('STRUCTURE').parentElement as HTMLElement, card())
    expectBefore(card(), screen.getByText('Bench Press'))
    expect(within(card()).getByText('WARMUP ROUTINE')).toBeTruthy()
    expect(within(card()).getByText('EVERY WEEK')).toBeTruthy()
    const texts = ['Bike 5 min', 'Band pull-aparts', 'Arm circles']
    texts.forEach((text) => expect(within(card()).getByText(text)).toBeTruthy())
    expectBefore(screen.getByText(texts[0]), screen.getByText(texts[1]))
    expectBefore(screen.getByText(texts[1]), screen.getByText(texts[2]))
    expect(hookKeys.routine).toHaveBeenCalledWith('wd-1')
  })

  it('is in STRUCTURE only: SETS shows no routine', () => {
    mockState.routine = ROUTINE
    renderPlanPage()
    expect(screen.queryByRole('group', { name: 'Warmup routine' })).toBeNull()
    expect(screen.queryByText('WARMUP ROUTINE')).toBeNull()
    expect(screen.queryByText('Bike 5 min')).toBeNull()
  })

  it('an item is its text and a ⋯: reorder and remove are behind the ⋯, not icons on the row (the standing UI rule)', () => {
    mockState.routine = ROUTINE
    arrange()

    // The routine card holds nothing but its title, EVERY WEEK, each item's text and ⋯, and ADD ITEM.
    const buttons = within(card()).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(buttons).toEqual(['Bike 5 min', 'Options for warmup item 1', 'Band pull-aparts', 'Options for warmup item 2', 'Arm circles', 'Options for warmup item 3', 'ADD ITEM'])
    expect(card().querySelectorAll('svg.lucide-chevron-up, svg.lucide-chevron-down, svg.lucide-trash2')).toHaveLength(0)
    // Opened, the ⋯ holds exactly MOVE UP, MOVE DOWN and REMOVE.
    fireEvent.click(screen.getByLabelText('Options for warmup item 2'))
    expect(within(card()).getAllByRole('button').filter((b) => b.getAttribute('aria-label')?.match(/^(Move|Remove) warmup item/)).map((b) => b.textContent)).toEqual(['MOVE UP', 'MOVE DOWN', 'REMOVE'])
  })

  it('an empty routine shows its ADD ITEM and no placeholder (an unset feature shows nothing)', () => {
    mockState.routine = []
    arrange()

    expect(within(card()).getByText('ADD ITEM')).toBeTruthy()
    expect(within(card()).getByText('EVERY WEEK')).toBeTruthy()
    expect(screen.queryByText('NO WARMUP ITEMS YET')).toBeNull()
    expect(within(card()).queryByLabelText(/^Options for warmup item/)).toBeNull()
  })

  it('add: the trimmed text at the next position, on THIS workout\'s routine; a blank entry writes nothing and keeps the form', async () => {
    mockState.routine = ROUTINE
    arrange()

    fireEvent.click(screen.getByText('ADD ITEM'))
    fireEvent.change(screen.getByLabelText('New warmup item'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('ADD'))
    expect(addItemMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByLabelText('New warmup item')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('New warmup item'), { target: { value: '  Jumping jacks  ' } })
    await act(async () => {
      fireEvent.click(screen.getByText('ADD'))
    })
    expect(addItemMutateAsync).toHaveBeenCalledTimes(1)
    expect(addItemMutateAsync).toHaveBeenCalledWith({ body: 'Jumping jacks', position: 3 })
    expect(hookKeys.addItem).toHaveBeenCalledWith('wd-1')
  })

  it('edit: tap the text, blur commits the trimmed body on THAT item; unchanged or blank writes nothing', () => {
    mockState.routine = ROUTINE
    arrange()

    fireEvent.click(screen.getByText('Band pull-aparts'))
    fireEvent.change(screen.getByLabelText('Warmup item text'), { target: { value: '  Face pulls  ' } })
    fireEvent.blur(screen.getByLabelText('Warmup item text'))
    expect(updateItemMutate).toHaveBeenCalledTimes(1)
    expect(updateItemMutate).toHaveBeenLastCalledWith({ id: 'wi-2', body: 'Face pulls' })

    fireEvent.click(screen.getByText('Arm circles'))
    fireEvent.change(screen.getByLabelText('Warmup item text'), { target: { value: '   ' } })
    fireEvent.blur(screen.getByLabelText('Warmup item text'))
    fireEvent.click(screen.getByText('Bike 5 min'))
    fireEvent.blur(screen.getByLabelText('Warmup item text')) // unchanged
    expect(updateItemMutate).toHaveBeenCalledTimes(1)
    expect(hookKeys.updateItem).toHaveBeenCalledWith('wd-1')
  })

  it('remove: the ⋯ asks first, and confirming removes THAT item; cancelling removes nothing', () => {
    mockState.routine = ROUTINE
    arrange()

    fireEvent.click(screen.getByLabelText('Options for warmup item 2'))
    fireEvent.click(screen.getByLabelText('Remove warmup item 2'))
    expect(screen.getByText('Remove this item?')).toBeTruthy()
    expect(removeItemMutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('CANCEL'))
    expect(removeItemMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Options for warmup item 3'))
    fireEvent.click(screen.getByLabelText('Remove warmup item 3'))
    fireEvent.click(screen.getByText('REMOVE'))
    expect(removeItemMutate).toHaveBeenCalledTimes(1)
    expect(removeItemMutate).toHaveBeenCalledWith('wi-3')
    expect(hookKeys.removeItem).toHaveBeenCalledWith('wd-1')
  })

  it('reorder: MOVE UP / MOVE DOWN write dense positions for the whole routine; the first item cannot go up, the last cannot go down', () => {
    mockState.routine = ROUTINE
    arrange()

    fireEvent.click(screen.getByLabelText('Options for warmup item 1'))
    expect((screen.getByLabelText('Move warmup item 1 up') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Move warmup item 1 down'))
    expect(reorderItemsMutate).toHaveBeenLastCalledWith([{ id: 'wi-2', position: 0 }, { id: 'wi-1', position: 1 }, { id: 'wi-3', position: 2 }])

    fireEvent.click(screen.getByLabelText('Options for warmup item 3'))
    expect((screen.getByLabelText('Move warmup item 3 down') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Move warmup item 3 up'))
    expect(reorderItemsMutate).toHaveBeenLastCalledWith([{ id: 'wi-1', position: 0 }, { id: 'wi-3', position: 1 }, { id: 'wi-2', position: 2 }])
    expect(reorderItemsMutate).toHaveBeenCalledTimes(2)
    expect(hookKeys.reorderItems).toHaveBeenCalledWith('wd-1')
  })

  it('is the SELECTED workout\'s own routine: another workout shows and edits its own', () => {
    mockState.program = makeProgram({ schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1', thursday: 'wd-2' } })
    mockState.days = [workoutDay, workoutDay2]
    mockState.routineByDay = { 'wd-1': [item('wi-1', 0, 'Bike 5 min')], 'wd-2': [item('wi-9', 0, 'Leg swings', 'wd-2')] }
    mockState.all = [plan(2, SETS, weekExercises()), plan(2, [], [], 'wd-2'), plan(3, [], [])]
    renderPlanPage()
    openStructureView()
    expect(screen.getByText('Bike 5 min')).toBeTruthy()
    expect(screen.queryByText('Leg swings')).toBeNull()

    fireEvent.click(screen.getByText('THU'))
    expect(screen.getByText('Leg swings')).toBeTruthy()
    expect(screen.queryByText('Bike 5 min')).toBeNull()
    fireEvent.click(screen.getByText('Leg swings'))
    fireEvent.change(screen.getByLabelText('Warmup item text'), { target: { value: 'Hip circles' } })
    fireEvent.blur(screen.getByLabelText('Warmup item text'))
    expect(updateItemMutate).toHaveBeenCalledWith({ id: 'wi-9', body: 'Hip circles' })
    expect(hookKeys.updateItem).toHaveBeenLastCalledWith('wd-2')
  })
})

// ─── Labels ───────────────────────────────────────────────────────────────────

describe('PlanPage STRUCTURE — EVERY WEEK labels rest, tempo, grouping and the routine; the unit does not carry it', () => {
  it('the exercise ⋯: REST, REST AFTER and TEMPO sit under one EVERY WEEK; the unit is a group of its own, outside it, without one', () => {
    arrange()
    openExerciseMenu('Bench Press')

    const every = screen.getByRole('group', { name: 'Every week' })
    expect(within(every).getByText('EVERY WEEK')).toBeTruthy()
    for (const control of ['REST', 'REST AFTER', 'TEMPO']) expect(within(every).getByText(control)).toBeTruthy()
    expect(within(every).getByLabelText('More rest for Bench Press')).toBeTruthy()
    expect(within(every).getByLabelText('More rest after for Bench Press')).toBeTruthy()
    expect(within(every).getByText('3-1-1-0')).toBeTruthy()

    const unit = screen.getByRole('group', { name: 'Weight unit' })
    expect(within(unit).getByText('UNIT')).toBeTruthy()
    expect(within(unit).queryByText('EVERY WEEK')).toBeNull()
    expect(every.contains(unit)).toBe(false)
    expect(unit.contains(every)).toBe(false)
    for (const chip of ['INHERIT (KG)', 'KG', 'LBS']) {
      expect(every.contains(within(unit).getByRole('button', { name: chip }))).toBe(false)
    }
    // The one label in the whole menu is the group's.
    expect(within(every.parentElement as HTMLElement).getAllByText('EVERY WEEK')).toHaveLength(1)
  })

  it('a set\'s ⋯ (REST, and STAGE REST on a staged head) is under EVERY WEEK too', () => {
    arrange()

    for (const open of [() => setMenu(2), () => setMenu(3), () => stageMenu(), () => setMenu(1, SET_1_OF.bench)]) {
      open()
      const every = screen.getByRole('group', { name: 'Every week' })
      expect(within(every).getByText('EVERY WEEK')).toBeTruthy()
      expect(within(every).getByText('REST')).toBeTruthy()
      cleanup()
      arrange()
    }
    setMenu(3)
    expect(within(screen.getByRole('group', { name: 'Every week' })).getByText('STAGE REST')).toBeTruthy()
  })

  it('every link toggle, every block\'s round rests and the routine carry it, and the unit group does not', () => {
    mockState.blocks = [{ id: 'blk-1', restWithinRoundSeconds: null, restAfterRoundSeconds: null }]
    mockState.routine = [item('wi-1', 0, 'Bike 5 min')]
    arrange(weekExercises({ 'pe-1': { supersetBlockId: 'blk-1' }, 'pe-3': { supersetBlockId: 'blk-1' } }))

    // One toggle per gap (a linked one and plain ones) ...
    expect(toggles()).toHaveLength(4)
    for (const toggle of toggles()) expect(within(toggle).getByText('EVERY WEEK')).toBeTruthy()
    // ... the block's rests ...
    const rests = screen.getByText('SUPERSET').parentElement as HTMLElement
    expect(within(rests).getByText('EVERY WEEK')).toBeTruthy()
    expect(within(rests).getByText('WITHIN ROUND')).toBeTruthy()
    // ... and the routine.
    expect(within(screen.getByRole('group', { name: 'Warmup routine' })).getByText('EVERY WEEK')).toBeTruthy()
    // Nothing else on the page (markers, exercise names, set rows) says it.
    expect(screen.getAllByText('EVERY WEEK')).toHaveLength(4 + 1 + 1)
  })

  it('the label is not on the page until there is something it labels: no ⋯ open and no block, no routine card item', () => {
    arrange()
    // The closed menus hold nothing; the toggles and the routine card (an empty routine still has its ADD ITEM) are the labels there are.
    expect(screen.getAllByText('EVERY WEEK')).toHaveLength(4 + 1)
  })
})

// ─── Markers ──────────────────────────────────────────────────────────────────

describe('PlanPage STRUCTURE — a marker shows only where the field is set (the standing UI rule)', () => {
  it('exercise and set markers are exactly the fields that are set, in page order, and nothing for an unset one', () => {
    arrange()

    expect(runWideMarkers()).toEqual([
      // Bench Press: rest 90 s, rest after 180 s, tempo, unit lbs (the Settings unit is kg)
      'REST 1min 30s', 'REST AFTER 3min 0s', 'TEMPO 3-1-1-0', 'UNIT LBS',
      // its sets: the warmup's rest, set 2's rest, the staged head's stage rest, then its stage's rest
      'REST 45s', 'REST 2min 0s', 'STAGE REST 20s', 'REST 10s',
    ])
  })

  it('Dips (unit kg = the Settings unit), Squat, Incline Press and Lunge carry no marker at all; nor do sets with no rest', () => {
    arrange()

    const header = (name: string) => (screen.getByText(name).parentElement as HTMLElement)
    for (const name of ['Dips', 'Squat', 'Incline Press', 'Lunge']) {
      const chips = Array.from(header(name).querySelectorAll('span')).map((el) => el.textContent)
      // only the muscle-group line: no marker chip under the name
      expect(chips.filter((text) => /^(REST|REST AFTER|TEMPO|UNIT) \S/.test(text ?? ''))).toEqual([])
      expect(header(name).children).toHaveLength(2) // the name and its muscle-group line
    }
    // Set 4 (a program set with no rest), set 5 (added), and every other exercise's set 1: no marker line under the row.
    const rowOf = (button: HTMLElement) => button.parentElement as HTMLElement
    const unmarked = [
      screen.getAllByLabelText('Options for set 4')[0], screen.getAllByLabelText('Options for set 5')[0],
      ...[SET_1_OF.dips, SET_1_OF.squat, SET_1_OF.incline, SET_1_OF.lunge].map((nth) => screen.getAllByLabelText('Options for set 1')[nth]),
    ]
    for (const button of unmarked) expect(rowOf(button).nextElementSibling).toBeNull()
    // ... while the rows that are set have one.
    for (const button of [screen.getAllByLabelText('Options for set 2')[0], screen.getAllByLabelText('Options for set 1')[SET_1_OF.bench]]) {
      expect(rowOf(button).nextElementSibling).not.toBeNull()
    }
  })

  it('a unit set to something other than the Settings unit is marked; one equal to it, or none, is not', () => {
    arrange(weekExercises({ 'pe-2': { weightUnit: 'lbs' }, 'pe-3': { weightUnit: 'kg' }, 'pe-1': { weightUnit: null } }))
    expect(runWideMarkers().filter((m) => m.startsWith('UNIT'))).toEqual(['UNIT LBS'])
    cleanup()
    arrange(weekExercises({ 'pe-1': { weightUnit: 'kg' }, 'pe-3': { weightUnit: 'kg' } }))
    expect(runWideMarkers().filter((m) => m.startsWith('UNIT'))).toEqual([])
  })

  it('a value and a null differ: rest after alone, tempo alone, or neither shows only what is set', () => {
    arrange(weekExercises({
      'pe-1': { restSeconds: null, restAfterSeconds: 60, tempo: null, weightUnit: null },
      'pe-3': { tempo: '2-0-2-0', weightUnit: null },
      'pe-2': { restSeconds: 30, weightUnit: null },
    }), []) // (no sets, so only the exercises' own markers are on the page)
    expect(runWideMarkers()).toEqual(['REST AFTER 1min 0s', 'TEMPO 2-0-2-0', 'REST 30s'])
  })

  it('a staged head with a stage rest but no rest of its own shows only STAGE REST; a stage row shows its own rest, not its head\'s', () => {
    arrange()
    const stageRestChip = screen.getByText('STAGE REST 20s')
    const stageChips = Array.from(stageRestChip.parentElement!.querySelectorAll('span')).map((el) => el.textContent)
    expect(stageChips).toEqual(['REST-PAUSE', 'STAGE REST 20s']) // the kind, and the stage rest — no "REST" chip for the head
    const stageRow = screen.getByText('REST 10s').parentElement as HTMLElement
    expect(Array.from(stageRow.querySelectorAll('span')).map((el) => el.textContent)).toEqual(['REST 10s'])
  })

  it('a stage row has no STAGE REST marker even when its own program set carries a stage rest (the stage rest is a staged HEAD\'s field)', () => {
    // The stage's program set (ps-b3s) holds a stage rest of 33 s — stale data, say, from a stage that was once a head.
    mockState.programSets = PROGRAM_SETS.map((ps) => (ps.id === 'ps-b3s' ? { ...ps, stageRestSeconds: 33 } : ps))
    arrange()

    // Control: the data is there, and the head's own stage rest still shows ...
    expect(mockState.programSets.find((ps) => ps.id === 'ps-b3s')?.stageRestSeconds).toBe(33)
    expect(screen.getByText('STAGE REST 20s')).toBeTruthy()
    // ... but the stage row shows only its own rest, and nothing on the page reads 33 s.
    const stageRow = screen.getByText('REST 10s').parentElement as HTMLElement
    expect(Array.from(stageRow.querySelectorAll('span')).map((el) => el.textContent)).toEqual(['REST 10s'])
    expect(screen.queryByText('STAGE REST 33s')).toBeNull()
    expect(runWideMarkers().filter((m) => m.startsWith('STAGE REST'))).toEqual(['STAGE REST 20s'])
  })

  it('the SETS view marks none of them (each view marks its own fields), nor shows a routine, a toggle or a label', () => {
    mockState.routine = [item('wi-1', 0, 'Bike 5 min')]
    mockState.blocks = [{ id: 'blk-1', restWithinRoundSeconds: 30, restAfterRoundSeconds: 30 }]
    mockState.all = [plan(2, SETS, weekExercises({ 'pe-1': { supersetBlockId: 'blk-1' }, 'pe-3': { supersetBlockId: 'blk-1' } })), plan(3, [], [])]
    renderPlanPage()

    expect(runWideMarkers()).toEqual([])
    const text = document.body.textContent ?? ''
    for (const word of ['EVERY WEEK', 'WARMUP ROUTINE', 'Bike 5 min', 'LINK AS SUPERSET', 'TAP TO UNLINK', 'WITHIN ROUND', 'TEMPO', 'STAGE REST']) expect(text).not.toContain(word)
    expect(screen.queryByText('SUPERSET')).toBeNull()
    // The "· SUPERSET" marker is both views' (the existing read-only indicator): it stays.
    expect(screen.getAllByText('· SUPERSET')).toHaveLength(2)
  })
})

// ─── No offer ahead ───────────────────────────────────────────────────────────

describe('PlanPage STRUCTURE — a run-wide edit offers nothing ahead: every week that slot appears in already reads it', () => {
  it('after each of them, with a later week planned, there is no apply-ahead banner and the apply-ahead mutation never runs', async () => {
    mockState.blocks = [{ id: 'blk-1', restWithinRoundSeconds: null, restAfterRoundSeconds: null }]
    mockState.routine = [item('wi-1', 0, 'Bike 5 min'), item('wi-2', 1, 'Arm circles')]
    arrange(weekExercises({ 'pe-3': { supersetBlockId: 'blk-1' }, 'pe-2': { supersetBlockId: 'blk-1' } })) // Dips + Squat linked

    // The control: an ordinary week edit IS offered ahead on this very screen ...
    openExerciseMenu('Lunge')
    fireEvent.click(screen.getByLabelText('Add warmup sets'))
    expect(screen.getByText(bannerText)).toBeTruthy()
    // ... until it is dismissed.
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(screen.queryByText(bannerText)).toBeNull()

    const noOffer = (after: string) => {
      expect(screen.queryByText(bannerText), `an offer after ${after}`).toBeNull()
      expect(screen.queryByText(/APPLIED TO/), `an outcome after ${after}`).toBeNull()
      expect(screen.queryByText('APPLY'), `APPLY after ${after}`).toBeNull()
      expect(applyAheadMutate, `apply ahead after ${after}`).not.toHaveBeenCalled()
    }
    const edits: Array<[string, () => void | Promise<void>]> = [
      ['REST', () => { openExerciseMenu('Bench Press'); more('rest for Bench Press') }],
      ['REST AFTER', () => more('rest after for Bench Press')],
      ['TEMPO', () => {
        fireEvent.click(screen.getByText('3-1-1-0'))
        fireEvent.change(screen.getByLabelText('Tempo'), { target: { value: '2-0-2-0' } })
        fireEvent.blur(screen.getByLabelText('Tempo'))
      }],
      ['unit', () => fireEvent.click(within(screen.getByRole('group', { name: 'Weight unit' })).getByRole('button', { name: 'KG' }))],
      ['set REST', () => { openExerciseMenu('Bench Press'); setMenu(2); more('rest of set 2 for Bench Press') }],
      ['STAGE REST', () => { setMenu(2); setMenu(3); more('stage rest of set 3 for Bench Press') }],
      ['link', () => { setMenu(3); fireEvent.click(toggles()[0]) }],
      ['unlink', () => fireEvent.click(toggles()[1])],
      ['WITHIN ROUND', () => fireEvent.click(screen.getByLabelText('More rest within round'))],
      ['AFTER ROUND', () => fireEvent.click(screen.getByLabelText('More rest after round'))],
      ['routine add', async () => {
        fireEvent.click(screen.getByText('ADD ITEM'))
        fireEvent.change(screen.getByLabelText('New warmup item'), { target: { value: 'Jumping jacks' } })
        await act(async () => { fireEvent.click(screen.getByText('ADD')) })
      }],
      ['routine edit', () => {
        fireEvent.click(screen.getByText('Bike 5 min'))
        fireEvent.change(screen.getByLabelText('Warmup item text'), { target: { value: 'Rower' } })
        fireEvent.blur(screen.getByLabelText('Warmup item text'))
      }],
      ['routine reorder', () => { fireEvent.click(screen.getByLabelText('Options for warmup item 2')); fireEvent.click(screen.getByLabelText('Move warmup item 2 up')) }],
      ['routine remove', () => {
        fireEvent.click(screen.getByLabelText('Options for warmup item 1'))
        fireEvent.click(screen.getByLabelText('Remove warmup item 1'))
        fireEvent.click(screen.getByText('REMOVE'))
      }],
    ]
    for (const [name, edit] of edits) {
      await edit()
      noOffer(name)
    }
    // Every one of them did write (so "no offer" is not "nothing happened").
    expect(updateRestMutate).toHaveBeenCalledTimes(2)
    expect(updateTempoMutate).toHaveBeenCalledTimes(1)
    expect(updateUnitMutate).toHaveBeenCalledTimes(1)
    expect(updateSetRestMutate).toHaveBeenCalledTimes(1)
    expect(updateStageRestMutate).toHaveBeenCalledTimes(1)
    expect(toggleLinkMutate).toHaveBeenCalledTimes(2)
    expect(updateBlockRestMutate).toHaveBeenCalledTimes(2)
    expect(addItemMutateAsync).toHaveBeenCalledTimes(1)
    expect(updateItemMutate).toHaveBeenCalledTimes(1)
    expect(reorderItemsMutate).toHaveBeenCalledTimes(1)
    expect(removeItemMutate).toHaveBeenCalledTimes(1)
    // and none of the week's own edits ran: a run-wide edit changes the slot's row, not this week's plan
    expect(updateSetMutate).not.toHaveBeenCalled()
    expect(swapMutate).not.toHaveBeenCalled()
    expect(reorderMutate).not.toHaveBeenCalled()
    expect(addExerciseMutate).not.toHaveBeenCalled()
    expect(removeExerciseMutate).not.toHaveBeenCalled()
    expect(addWarmupMutate).toHaveBeenCalledTimes(1) // (the control above)
  })
})

// ─── A past week ──────────────────────────────────────────────────────────────

describe('PlanPage STRUCTURE — a past week is read-only for the run-wide fields too', () => {
  function arrangePast() {
    mockState.blocks = [{ id: 'blk-1', restWithinRoundSeconds: 30, restAfterRoundSeconds: null }]
    mockState.routine = [item('wi-1', 0, 'Bike 5 min'), item('wi-2', 1, 'Arm circles')]
    const exercises = weekExercises({ 'pe-3': { supersetBlockId: 'blk-1' }, 'pe-2': { supersetBlockId: 'blk-1' } })
    const view = arrange(exercises)
    return view
  }

  it('current week first: every control is there (so the absences below mean something)', () => {
    arrangePast()
    expect(screen.queryByText('PAST WEEK — READ ONLY')).toBeNull()
    expect(screen.getByLabelText('Bench Press options')).toBeTruthy()
    expect(toggles()).toHaveLength(4)
    expect(screen.getAllByText('WITHIN ROUND')).toHaveLength(1)
    expect(screen.getAllByLabelText(/^Options for (set|stage)/).length).toBeGreaterThan(0)
    expect(screen.getByText('ADD ITEM')).toBeTruthy()
    expect(screen.getAllByLabelText(/^Options for warmup item/)).toHaveLength(2)
  })

  it('in the past: no exercise ⋯, no set ⋯, no link toggle, no round-rest stepper, no ADD ITEM, no item ⋯ — the routine\'s text and every marker stay', () => {
    arrangePast()
    fireEvent.click(screen.getByLabelText('Previous week'))
    expect(screen.getByText('WEEK 1')).toBeTruthy()
    expect(screen.getByText('PAST WEEK — READ ONLY')).toBeTruthy()

    expect(screen.queryByLabelText(/ options$/)).toBeNull()
    expect(screen.queryByLabelText(/^Options for /)).toBeNull()
    expect(screen.queryByRole('button', { name: /LINK AS SUPERSET|TAP TO UNLINK/ })).toBeNull()
    expect(screen.queryByText('LINK AS SUPERSET')).toBeNull()
    expect(screen.queryByText('WITHIN ROUND')).toBeNull()
    expect(screen.queryByText('AFTER ROUND')).toBeNull()
    expect(screen.queryByLabelText(/^(More|Less) /)).toBeNull()
    expect(screen.queryByRole('group', { name: 'Every week' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Weight unit' })).toBeNull()
    expect(screen.queryByText('ADD ITEM')).toBeNull()
    expect(screen.queryByLabelText(/^Options for warmup item/)).toBeNull()
    expect(screen.queryByText('ADD EXERCISE')).toBeNull()
    // The routine is still there to read, and its text is no longer a button to edit.
    const routine = screen.getByRole('group', { name: 'Warmup routine' })
    expect(within(routine).getByText('Bike 5 min')).toBeTruthy()
    expect(within(routine).getByText('Arm circles')).toBeTruthy()
    expect(within(routine).queryAllByRole('button')).toHaveLength(0)
    fireEvent.click(within(routine).getByText('Bike 5 min'))
    expect(screen.queryByLabelText('Warmup item text')).toBeNull()
    // The markers are display: they stay on a read-only week.
    expect(runWideMarkers()).toContain('REST 1min 30s')
    expect(runWideMarkers()).toContain('REST 2min 0s')
    expect(screen.getAllByText('· SUPERSET')).toHaveLength(2)
    // And nothing was written by looking.
    for (const m of [updateRestMutate, updateTempoMutate, updateUnitMutate, toggleLinkMutate, updateBlockRestMutate, updateSetRestMutate, updateStageRestMutate, addItemMutateAsync, updateItemMutate, removeItemMutate, reorderItemsMutate]) {
      expect(m).not.toHaveBeenCalled()
    }
  })

  it('a past week with an empty routine shows no routine card at all', () => {
    mockState.routine = []
    arrange()
    expect(screen.getByRole('group', { name: 'Warmup routine' })).toBeTruthy() // the current week: ADD ITEM
    fireEvent.click(screen.getByLabelText('Previous week'))
    expect(screen.queryByRole('group', { name: 'Warmup routine' })).toBeNull()
    expect(screen.queryByText('WARMUP ROUTINE')).toBeNull()
  })
})

// ─── Width ────────────────────────────────────────────────────────────────────

describe('PlanPage STRUCTURE — 375px', () => {
  it('with every marker set and every menu open, no element carries a fixed pixel width wider than the screen', () => {
    mockState.blocks = [{ id: 'blk-1', restWithinRoundSeconds: 30, restAfterRoundSeconds: 120 }]
    mockState.routine = [item('wi-1', 0, 'Bike 5 min easy then a long second line of text to wrap'), item('wi-2', 1, 'Arm circles')]
    const { container } = arrange(weekExercises({ 'pe-3': { supersetBlockId: 'blk-1' }, 'pe-2': { supersetBlockId: 'blk-1' } }))
    openExerciseMenu('Bench Press')
    setMenu(3)
    stageMenu()
    fireEvent.click(screen.getByLabelText('Options for warmup item 1'))

    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(el.style[prop])
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${el.style[prop]}`)
      }
    }
    expect(offenders).toEqual([])
    expect(window.innerWidth).toBe(375)
  })
})

