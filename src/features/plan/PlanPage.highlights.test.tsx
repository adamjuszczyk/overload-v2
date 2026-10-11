// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, subWeeks } from 'date-fns'
import type {
  Mesocycle, Program, WorkoutDay, ProgramExercise, ProgramSet, WeekPlan, WeekPlanSet, Exercise, MuscleGroup, SequenceItem,
} from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore } from '../settings/settingsStore'

// Chunk 31 (TASKS-1.1 "Differences from the week's source are highlighted"; SPEC Plan screen [P1.1]: "Anything
// different from the week's source is highlighted, in both views: numbers, sets, exercises, order and set kinds.
// Tags are never highlighted … Rest, tempo, superset grouping and the warmup routine are run-wide, so they're never
// compared"). weekDiff.test.ts proves the rules; this file proves they are wired to the screen: the real PlanPage
// tree, only the data hooks mocked (the seam every PlanPage test file uses), checked at 375px.
//
//   SETS       weight, reps and RIR (a stage's and a warmup's too); a working set added or removed
//   STRUCTURE  exercises added, removed, moved; warmup sets and stages added or removed; a set's kind (a dot on its ⋯)
//
// A mark is read through `data-diff` ("changed" | "added" | "moved" | "removed" | "kind") AND through the token it
// draws with (`--accent`; removed: `--text-dim` and line-through), so a mark that is there but not drawn fails too.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// ─── Fixture ──────────────────────────────────────────────────────────────────

const mesoStarting = (currentWeek: number): Mesocycle => ({
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active',
  startDate: format(subWeeks(new Date(), currentWeek - 1), 'yyyy-MM-dd'), endDate: null, createdAt: '2026-01-01T00:00:00Z',
})
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const workoutDayB: WorkoutDay = { id: 'wd-b', programId: 'prog-1', userId: 'user-1', name: 'Pull Day', position: 1, exercises: [] }

const ex = (id: string, name: string, muscleGroup: MuscleGroup): Exercise => ({
  id, userId: 'user-1', name, muscleGroup, isArchived: false, createdAt: '', muscleSubgroups: null,
  movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
})
const EX_BENCH = ex('ex-bench', 'Bench Press', 'chest')
const EX_ROW = ex('ex-row', 'Row', 'back')
const EX_SQUAT = ex('ex-squat', 'Squat', 'quads')
const EX_INCLINE = ex('ex-incline', 'Incline Press', 'chest')
const EX_LUNGE = ex('ex-lunge', 'Lunge', 'quads')

const pe = (id: string, exercise: Exercise, position: number, over: Partial<ProgramExercise> = {}, workoutDayId = 'wd-1'): ProgramExercise => ({
  id, workoutDayId, userId: 'user-1', exerciseId: exercise.id, position, weightUnit: null, exercise, ...over,
})
// The run's copy rows, which every week of a plain run shares.
const BENCH = pe('pe-bench', EX_BENCH, 0)
const ROW = pe('pe-row', EX_ROW, 1)
const SQUAT = pe('pe-squat', EX_SQUAT, 2)
const withPosition = (p: ProgramExercise, position: number): ProgramExercise => ({ ...p, position })

function wset(id: string, programExerciseId: string, setNumber: number, over: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id, weekPlanId: 'wp', userId: 'user-1', programExerciseId, setNumber, targetRir: 2, isDropset: false,
    parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: 100, repMin: 8, repMax: 8, ...over,
  }
}
const stageOf = (id: string, parent: string, programExerciseId: string, stageIndex: number, over: Partial<WeekPlanSet> = {}) =>
  wset(id, programExerciseId, 1, { isDropset: true, parentWeekPlanSetId: parent, stageIndex, targetWeight: 80, repMin: 6, repMax: 6, targetRir: 0, ...over })
// `n` working sets of an exercise, set ids `${prefix}${i}`, weights 100, 105, 110 … .
const workSets = (peId: string, prefix: string, n: number, over: (i: number) => Partial<WeekPlanSet> = () => ({})): WeekPlanSet[] =>
  Array.from({ length: n }, (_, i) => wset(`${prefix}${i + 1}`, peId, i + 1, { targetWeight: 100 + 5 * i, ...over(i + 1) }))

function plan(weekNumber: number, exercises: ProgramExercise[], sets: WeekPlanSet[], over: Partial<WeekPlan> = {}): WeekPlan {
  const workoutDayId = over.workoutDayId ?? 'wd-1'
  return {
    id: `wp-${weekNumber}-${workoutDayId}${over.sequencePosition != null ? `-s${over.sequencePosition}` : ''}`, userId: 'user-1', mesocycleId: 'meso-1',
    workoutDayId, weekNumber, isDeload: false, notes: null, sets, exercises, createdAt: '2026-01-01T00:00:00Z', ...over,
  }
}

const pset = (id: string, programExerciseId: string, position: number, over: Partial<ProgramSet> = {}): ProgramSet => ({
  id, userId: 'user-1', programExerciseId, position, isWarmup: false, stageKind: null, stageRestSeconds: null,
  parentProgramSetId: null, stageIndex: 0, repMin: 8, repMax: 8, isAmrap: false, restSeconds: null, createdAt: '', ...over,
})

function makeProgram(over: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' }, workoutDays: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent', ...over,
  }
}

const mockState: {
  meso: Mesocycle
  all: WeekPlan[]
  program: Program
  days: WorkoutDay[]
  // The run's copy of each workout: undefined = not read yet.
  runCopy: Record<string, ProgramExercise[] | undefined>
  // Every program set of the run's copy (removed ones included); undefined = not read yet.
  programSets: ProgramSet[] | undefined
  sequenceItems: SequenceItem[]
} = { meso: mesoStarting(5), all: [], program: makeProgram(), days: [workoutDay], runCopy: {}, programSets: [], sequenceItems: [] }

const programSetReads: string[][] = []

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [mockState.meso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  ...(await import('./structureHooks.testutil')).quietProgramsHooks,
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: mockState.days, isLoading: false }),
  useProgramExercises: (workoutDayId: string) => ({ data: mockState.runCopy[workoutDayId], isLoading: false }),
  useSequenceItems: () => ({ data: mockState.sequenceItems }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./structureHooks.testutil')).quietPlannerHooks,
  // The program sets of the rows asked for (the highlighting asks for the run's copy; the STRUCTURE view for the week's).
  useProgramSets: (ids: string[]) => {
    programSetReads.push(ids)
    return { data: mockState.programSets === undefined ? undefined : mockState.programSets.filter((ps) => ids.includes(ps.programExerciseId)) }
  },
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../gym/useSession', () => ({ useLastDoneOrSkippedSession: () => ({ data: null }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: mockState.all.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.all, isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')
const { openStructureView, openSetsView } = await import('./planMenus.testutil')

afterEach(() => {
  mockState.meso = mesoStarting(5)
  mockState.all = []
  mockState.program = makeProgram()
  mockState.days = [workoutDay]
  mockState.runCopy = {}
  mockState.programSets = []
  mockState.sequenceItems = []
  programSetReads.length = 0
  useSettingsStore.setState({ weekStart: 'copy' })
})

function renderPlan(currentWeek: number) {
  mockState.meso = mesoStarting(currentWeek)
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

// ─── Reading the marks ────────────────────────────────────────────────────────

// A set row, found by its number text ('01'), the nth such row on the page (the page lists exercises in order).
const rowOf = (numberText: string, nth = 0) => screen.getAllByText(numberText)[nth].parentElement as HTMLElement
// ... and the row as a whole (the element a row-level mark is on: the wrapper around the row and its markers).
const wholeRow = (numberText: string, nth = 0) => rowOf(numberText, nth).parentElement as HTMLElement
const buttonsOf = (row: HTMLElement) => Array.from(row.querySelectorAll('button'))
// A working set's cells: weight, reps, and the RIR stepper (the container of its − and + buttons).
const cellsOf = (row: HTMLElement) => {
  const buttons = buttonsOf(row)
  return { weight: buttons[0], reps: buttons[1], rir: buttons[2].parentElement as HTMLElement }
}
const mark = (el: Element | null | undefined) => el?.getAttribute('data-diff') ?? null
// Drawn in the accent: the token is on the element's own style, over its text or its edge.
const inAccent = (el: HTMLElement) => (el.getAttribute('style') ?? '').includes('var(--accent)')
const markedCells = (numberText: string, nth = 0) => {
  const c = cellsOf(rowOf(numberText, nth))
  return { weight: mark(c.weight), reps: mark(c.reps), rir: mark(c.rir) }
}
// The exercise's header band (its name's grandparent), and its mark.
const headerOf = (name: string) => screen.getByText(name).parentElement!.parentElement as HTMLElement
const exerciseMark = (name: string) => mark(headerOf(name))
// Every removed (dim, struck-through) element on the page.
const removedLines = () => Array.from(document.querySelectorAll('[data-diff="removed"]')) as HTMLElement[]
const struck = (el: HTMLElement) => {
  const del = el.querySelector('del') as HTMLElement
  return { text: del.textContent, line: del.style.textDecoration, color: del.style.color }
}
// Everything marked, anywhere on the page.
const allMarks = () => Array.from(document.querySelectorAll('[data-diff]'))
const allRemoved = () => Array.from(document.querySelectorAll('del'))
const dotOf = (ariaLabel: string) => screen.getByLabelText(ariaLabel).querySelector('[data-diff="kind"]')

// ═══════════════════════════════════════════════════════════════════════════════
// SETS
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage SETS — the numbers that differ from last week (a week-dependent run)', () => {
  // Week 4: Bench Press 100 / 105 / 110, 8 reps, RIR 2 (three working sets) and Squat 120.
  const week4 = () => plan(4, [BENCH, SQUAT], [...workSets('pe-bench', 'b4-', 3), wset('q4-1', 'pe-squat', 1, { targetWeight: 120 })])

  it('week 5 against week 4: set 2\'s weight differs → set 2\'s weight is marked and set 1\'s is not; nothing else is', () => {
    const sets5 = [...workSets('pe-bench', 'b5-', 3, (n) => (n === 2 ? { targetWeight: 107.5 } : {})), wset('q5-1', 'pe-squat', 1, { targetWeight: 120 })]
    mockState.all = [week4(), plan(5, [BENCH, SQUAT], sets5)]
    renderPlan(5)

    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null })
    expect(markedCells('02')).toEqual({ weight: 'changed', reps: null, rir: null })
    expect(markedCells('03')).toEqual({ weight: null, reps: null, rir: null })
    // Drawn in the accent — the cell that differs, and no other.
    expect(inAccent(cellsOf(rowOf('02')).weight)).toBe(true)
    expect(inAccent(cellsOf(rowOf('01')).weight)).toBe(false)
    expect(inAccent(cellsOf(rowOf('02')).reps)).toBe(false)
    // Squat's one set is the same as last week's: nothing marked.
    expect(markedCells('01', 1)).toEqual({ weight: null, reps: null, rir: null })
    // Nothing else on the page is marked.
    expect(allMarks()).toHaveLength(1)
    expect(allRemoved()).toHaveLength(0)
  })

  it('reps and RIR are marked on their own cell, and a rep range or AMRAP against a number is a difference', () => {
    const sets5 = workSets('pe-bench', 'b5-', 3, (n) => (n === 1 ? { repMin: 8, repMax: 12 } : n === 2 ? { targetRir: 1 } : { isAmrap: true, repMin: null, repMax: null }))
    mockState.all = [week4(), plan(5, [BENCH, SQUAT], [...sets5, wset('q5-1', 'pe-squat', 1, { targetWeight: 120 })])]
    renderPlan(5)

    expect(markedCells('01')).toEqual({ weight: null, reps: 'changed', rir: null })
    expect(markedCells('02')).toEqual({ weight: null, reps: null, rir: 'changed' })
    expect(markedCells('03')).toEqual({ weight: null, reps: 'changed', rir: null })
    expect(inAccent(cellsOf(rowOf('02')).rir)).toBe(true) // the RIR stepper's edge and text
    expect(inAccent(cellsOf(rowOf('01')).rir)).toBe(false)
  })

  it('a set removed in week 5 → a dim struck-through row in its place, after the exercise\'s own sets and before the next exercise', () => {
    mockState.all = [week4(), plan(5, [BENCH, SQUAT], [...workSets('pe-bench', 'b5-', 2), wset('q5-1', 'pe-squat', 1, { targetWeight: 120 })])]
    renderPlan(5)

    const removed = removedLines()
    expect(removed).toHaveLength(1)
    // Set 3 as it was: its number and its numbers, dim and struck through.
    expect(removed[0].textContent).toBe('03110kg × 8  RIR 2')
    expect(struck(removed[0])).toEqual({ text: '110kg × 8  RIR 2', line: 'line-through', color: 'var(--text-dim)' })
    // In its place: below Bench Press's second set, above Squat.
    const second = rowOf('02')
    expect(second.compareDocumentPosition(removed[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(removed[0].compareDocumentPosition(screen.getByText('Squat')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // It is no control: nothing in it can be pressed.
    expect(removed[0].querySelectorAll('button')).toHaveLength(0)
    // The sets that are there are not marked.
    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null })
    expect(markedCells('02')).toEqual({ weight: null, reps: null, rir: null })
  })

  it('a working set added in week 5 is marked whole: its number and every number on it', () => {
    mockState.all = [week4(), plan(5, [BENCH, SQUAT], [...workSets('pe-bench', 'b5-', 4), wset('q5-1', 'pe-squat', 1, { targetWeight: 120 })])]
    renderPlan(5)

    expect(mark(wholeRow('04'))).toBe('added')
    expect(inAccent(screen.getByText('04'))).toBe(true)
    expect(markedCells('04')).toEqual({ weight: 'changed', reps: 'changed', rir: 'changed' })
    expect(mark(wholeRow('03'))).toBeNull()
    expect(markedCells('03')).toEqual({ weight: null, reps: null, rir: null })
    expect(removedLines()).toHaveLength(0)
  })

  it('a stage\'s and a warmup\'s numbers are marked where they differ from their counterpart\'s', () => {
    const base = (warmW: number, stageW: number) => [
      wset('w', 'pe-bench', 1, { isWarmup: true, targetRir: null, targetWeight: warmW, repMin: 10, repMax: 10 }),
      wset('h', 'pe-bench', 2, { stageKind: 'dropset' }),
      stageOf('hs', 'h', 'pe-bench', 1, { targetWeight: stageW }),
    ]
    mockState.all = [plan(4, [BENCH], base(40, 80)), plan(5, [BENCH], base(45, 75))]
    renderPlan(5)

    // The warmup (01): weight differs; reps the same; it has no RIR to mark.
    const warm = buttonsOf(rowOf('01'))
    expect([mark(warm[0]), mark(warm[1])]).toEqual(['changed', null])
    expect(within(rowOf('01')).queryByText(/RIR/)).toBeNull()
    // The working set (02) is the same.
    expect(markedCells('02')).toEqual({ weight: null, reps: null, rir: null })
    // The stage row (↳): its weight differs.
    const stageRow = screen.getByText('↳').parentElement as HTMLElement
    const stage = cellsOf(stageRow)
    expect([mark(stage.weight), mark(stage.reps), mark(stage.rir)]).toEqual(['changed', null, null])
  })

  it('a warmup or a stage new this week is not the SETS view\'s to mark (it is a set kind); its working sets\' added/removed are', () => {
    const warm = wset('w', 'pe-bench', 3, { isWarmup: true, targetRir: null })
    mockState.all = [plan(4, [BENCH], workSets('pe-bench', 'b4-', 2)), plan(5, [BENCH], [...workSets('pe-bench', 'b5-', 2), warm])]
    renderPlan(5)
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
  })

  it('SETS marks no exercise: an added, moved or removed exercise leaves no mark and no line in this view (those are STRUCTURE\'s)', () => {
    const lunge = pe('pe-lunge', EX_LUNGE, 2)
    mockState.all = [
      plan(4, [BENCH, ROW, SQUAT], [...workSets('pe-bench', 'b4-', 1), wset('r4', 'pe-row', 1), wset('q4', 'pe-squat', 1)]),
      // Row removed, Lunge added, Squat moved above Bench.
      plan(5, [withPosition(SQUAT, 0), withPosition(BENCH, 1), lunge], [...workSets('pe-bench', 'b5-', 1), wset('q5', 'pe-squat', 1), wset('l5', 'pe-lunge', 1)]),
    ]
    renderPlan(5)
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
    expect(screen.queryByText('Row')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage STRUCTURE — exercises, their order, set kinds', () => {
  const rows4 = [BENCH, ROW, SQUAT]
  const sets4 = () => [wset('b4', 'pe-bench', 1), wset('r4', 'pe-row', 1), wset('q4', 'pe-squat', 1)]

  it('an exercise added this week is highlighted: its header is the accent (and only that one)', () => {
    const lunge = pe('pe-lunge', EX_LUNGE, 3)
    mockState.all = [plan(4, rows4, sets4()), plan(5, [...rows4, lunge], [...sets4(), wset('l5', 'pe-lunge', 1)])]
    renderPlan(5)
    openStructureView()

    expect(exerciseMark('Lunge')).toBe('added')
    expect(headerOf('Lunge').getAttribute('style')).toContain('var(--accent-muted)') // the band behind it
    expect(inAccent(screen.getByText('Lunge'))).toBe(true) // its name
    for (const name of ['Bench Press', 'Row', 'Squat']) {
      expect(exerciseMark(name), name).toBeNull()
      expect(headerOf(name).getAttribute('style')).not.toContain('var(--accent-muted)')
      expect(inAccent(screen.getByText(name)), name).toBe(false)
    }
    expect(removedLines()).toHaveLength(0)
  })

  it('a changed stage kind puts a dot on that set\'s ⋯ — and on no other', () => {
    const staged = (kind: WeekPlanSet['stageKind']) => [
      wset('h1', 'pe-bench', 1), wset('h2', 'pe-bench', 2, { stageKind: kind }), stageOf('h2s', 'h2', 'pe-bench', 1), wset('h3', 'pe-bench', 3),
    ]
    mockState.all = [plan(4, [BENCH], staged('dropset')), plan(5, [BENCH], staged('rest_pause'))]
    renderPlan(5)
    openStructureView()

    expect(dotOf('Options for set 2')).not.toBeNull()
    expect(inAccent(dotOf('Options for set 2') as HTMLElement)).toBe(true)
    expect(dotOf('Options for set 1')).toBeNull()
    expect(dotOf('Options for set 3')).toBeNull()
    expect(dotOf('Options for stage')).toBeNull()
    expect(document.querySelectorAll('[data-diff="kind"]')).toHaveLength(1)
    // The dot is not in the SETS view: that view has no kind (and nothing in its ⋯ differs).
    openSetsView()
    expect(document.querySelectorAll('[data-diff="kind"]')).toHaveLength(0)
  })

  it('a null stage kind on a staged set is a dropset, as its row shows: no dot against an explicit dropset', () => {
    const staged = (kind: WeekPlanSet['stageKind']) => [wset('h2', 'pe-bench', 1, { stageKind: kind }), stageOf('h2s', 'h2', 'pe-bench', 1)]
    mockState.all = [plan(4, [BENCH], staged('dropset')), plan(5, [BENCH], staged(null))]
    renderPlan(5)
    openStructureView()
    expect(document.querySelectorAll('[data-diff="kind"]')).toHaveLength(0)
  })

  it('one exercise moved past two others → only it is highlighted', () => {
    // Bench was first; it is now last: Row and Squat each kept their order.
    mockState.all = [plan(4, rows4, sets4()), plan(5, [withPosition(ROW, 0), withPosition(SQUAT, 1), withPosition(BENCH, 2)], sets4())]
    renderPlan(5)
    openStructureView()

    expect(exerciseMark('Bench Press')).toBe('moved')
    expect(inAccent(screen.getByText('Bench Press'))).toBe(true)
    expect(exerciseMark('Row')).toBeNull()
    expect(exerciseMark('Squat')).toBeNull()
    expect(allMarks()).toHaveLength(1)
  })

  it('two neighbours that traded places → both are highlighted', () => {
    mockState.all = [plan(4, rows4, sets4()), plan(5, [withPosition(ROW, 0), withPosition(BENCH, 1), withPosition(SQUAT, 2)], sets4())]
    renderPlan(5)
    openStructureView()

    expect(exerciseMark('Row')).toBe('moved')
    expect(exerciseMark('Bench Press')).toBe('moved')
    expect(exerciseMark('Squat')).toBeNull()
    expect(allMarks()).toHaveLength(2)
  })

  it('a swap → the old exercise struck through, directly above the new one, highlighted (not one changed row)', () => {
    // Row (pe-row) is swapped for Incline Press (a new week-only row, same place).
    const incline = pe('pe-incline', EX_INCLINE, 1)
    mockState.all = [plan(4, rows4, sets4()), plan(5, [BENCH, incline, withPosition(SQUAT, 2)], [wset('b5', 'pe-bench', 1), wset('i5', 'pe-incline', 1), wset('q5', 'pe-squat', 1)])]
    renderPlan(5)
    openStructureView()

    const removed = removedLines()
    expect(removed).toHaveLength(1)
    expect(struck(removed[0])).toEqual({ text: 'Row', line: 'line-through', color: 'var(--text-dim)' })
    // Directly above: the very next section is Incline Press's, and it is the highlighted one.
    const newSection = headerOf('Incline Press').parentElement as HTMLElement
    expect(removed[0].nextElementSibling).toBe(newSection)
    expect(exerciseMark('Incline Press')).toBe('added')
    expect(inAccent(screen.getByText('Incline Press'))).toBe(true)
    // ... and below Bench Press, which is unmarked, as is Squat; and nothing moved.
    expect(removed[0].previousElementSibling).toBe(headerOf('Bench Press').parentElement)
    expect(exerciseMark('Bench Press')).toBeNull()
    expect(exerciseMark('Squat')).toBeNull()
    // The old exercise appears once, struck through — not as a live exercise.
    expect(screen.getAllByText('Row')).toHaveLength(1)
    expect(screen.queryByLabelText('Row options')).toBeNull()
    expect(allMarks().filter((m) => m.getAttribute('data-diff') !== 'removed')).toHaveLength(1)
  })

  it('an exercise the source has and the week hasn\'t is a struck-through line after the exercise it followed; at the top when it was first', () => {
    mockState.all = [plan(4, rows4, sets4()), plan(5, [BENCH, withPosition(SQUAT, 1)], [wset('b5', 'pe-bench', 1), wset('q5', 'pe-squat', 1)])]
    renderPlan(5)
    openStructureView()
    const removed = removedLines()
    expect(removed.map((r) => struck(r).text)).toEqual(['Row'])
    expect(removed[0].previousElementSibling).toBe(headerOf('Bench Press').parentElement)
    expect(removed[0].nextElementSibling).toBe(headerOf('Squat').parentElement)
    cleanup()

    // Bench Press was first and is gone: its line is at the top of the card.
    mockState.all = [plan(4, rows4, sets4()), plan(5, [withPosition(ROW, 0), withPosition(SQUAT, 1)], [wset('r5', 'pe-row', 1), wset('q5', 'pe-squat', 1)])]
    renderPlan(5)
    openStructureView()
    const top = removedLines()
    expect(top.map((r) => struck(r).text)).toEqual(['Bench Press'])
    expect(top[0].previousElementSibling).toBeNull()
    expect(top[0].nextElementSibling).toBe(headerOf('Row').parentElement)
  })

  it('a warmup set or a stage added this week is highlighted; one removed is a dim struck-through row in its place; a working set\'s add/remove is not STRUCTURE\'s', () => {
    // Week 4: working 1, working 2 (staged, stages 1 and 2), warmup 3. Week 5: working 1, working 2 (stage 1 and a new stage 3), a new warmup 3 … and one working set fewer/more is SETS'.
    mockState.all = [
      plan(4, [BENCH], [
        wset('a1', 'pe-bench', 1), wset('a2', 'pe-bench', 2, { stageKind: 'dropset' }), stageOf('a2s1', 'a2', 'pe-bench', 1), stageOf('a2s2', 'a2', 'pe-bench', 2),
        wset('a3', 'pe-bench', 3, { isWarmup: true, targetRir: null }),
      ]),
      plan(5, [BENCH], [
        wset('b1', 'pe-bench', 1), wset('b2', 'pe-bench', 2, { stageKind: 'dropset' }), stageOf('b2s1', 'b2', 'pe-bench', 1), stageOf('b2s3', 'b2', 'pe-bench', 3),
        wset('b3', 'pe-bench', 3), wset('b4', 'pe-bench', 4, { isWarmup: true, targetRir: null }),
      ]),
    ]
    renderPlan(5)
    openStructureView()

    // Position 3 is a warmup in week 4 and a working set now (a kind change: a dot); position 4 is a new warmup set.
    expect(mark(wholeRow('04'))).toBe('added')
    expect(inAccent(screen.getByText('04'))).toBe(true)
    expect(mark(wholeRow('03'))).toBeNull() // a working set is not marked here, whatever else differs about it
    expect(dotOf('Options for set 3')).not.toBeNull()
    expect(dotOf('Options for set 1')).toBeNull()
    expect(dotOf('Options for set 2')).toBeNull() // same staged kind
    // Stages: stage 3 is new (highlighted), stage 2 is gone (a struck-through row between 1 and 3).
    const stageRows = screen.getAllByText('↳').map((arrow) => arrow.parentElement as HTMLElement)
    // (a live row's mark is on the wrapper around it; a removed row is its own element)
    expect(stageRows.map((r) => mark(r) ?? mark(r.parentElement))).toEqual([null, 'removed', 'added'])
    expect(struck(stageRows[1]).text).toBe('STAGE')
    expect(removedLines()).toHaveLength(1)
    cleanup()

    // The other way round: a warmup removed leaves a struck-through row; nothing else is marked.
    mockState.all = [
      plan(4, [BENCH], [wset('a1', 'pe-bench', 1), wset('a2', 'pe-bench', 2), wset('a3', 'pe-bench', 3, { isWarmup: true, targetRir: null })]),
      plan(5, [BENCH], [wset('b1', 'pe-bench', 1), wset('b2', 'pe-bench', 2)]),
    ]
    renderPlan(5)
    openStructureView()
    const gone = removedLines()
    expect(gone).toHaveLength(1)
    expect(gone[0].textContent).toBe('03WARMUP')
    expect(struck(gone[0])).toEqual({ text: 'WARMUP', line: 'line-through', color: 'var(--text-dim)' })
    expect(allMarks().filter((m) => m.getAttribute('data-diff') !== 'removed')).toHaveLength(0)
  })

  it('STRUCTURE marks none of the numbers, and a working set removed is not a line here', () => {
    mockState.all = [
      plan(4, [BENCH], workSets('pe-bench', 'b4-', 3)),
      plan(5, [BENCH], workSets('pe-bench', 'b5-', 2, (n) => (n === 1 ? { targetWeight: 99, repMin: 5, repMax: 5, targetRir: 0 } : {}))),
    ]
    renderPlan(5)
    openStructureView()
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
    // The same week in SETS does mark them.
    openSetsView()
    expect(markedCells('01')).toEqual({ weight: 'changed', reps: 'changed', rir: 'changed' })
    expect(removedLines()).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Where each kind of week is compared from
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage — a stable run: sets, structure and reps against the run\'s copy, weight and RIR against last week', () => {
  // The default: Bench Press 3 sets of 8. Last week (4): the user had changed the reps to 10 and the weights up.
  const DEFAULT_ROWS = [BENCH]
  const DEFAULT_SETS = [pset('p1', 'pe-bench', 1), pset('p2', 'pe-bench', 2), pset('p3', 'pe-bench', 3)]
  const lastWeek = () => plan(4, [BENCH], workSets('pe-bench', 'l4-', 3, () => ({ repMin: 10, repMax: 10 })))
  const stable = () => {
    mockState.program = makeProgram({ planningType: 'stable' })
    mockState.runCopy = { 'wd-1': DEFAULT_ROWS }
    mockState.programSets = DEFAULT_SETS
  }

  it('a rep target equal to last week\'s but not the default\'s IS highlighted; one equal to the default\'s but not last week\'s is not', () => {
    stable()
    // Set 1: 10 reps (last week's; the default says 8). Set 2: 8 reps (the default's; last week said 10). Set 3: 10, too.
    mockState.all = [lastWeek(), plan(5, [BENCH], workSets('pe-bench', 'b5-', 3, (n) => ({ repMin: n === 2 ? 8 : 10, repMax: n === 2 ? 8 : 10 })))]
    renderPlan(5)

    expect(markedCells('01').reps).toBe('changed')
    expect(markedCells('02').reps).toBeNull()
    expect(markedCells('03').reps).toBe('changed')
  })

  it('weights and RIR are last week\'s: against the default (which has none) nothing would differ, against last week this does', () => {
    stable()
    mockState.all = [lastWeek(), plan(5, [BENCH], workSets('pe-bench', 'b5-', 3, (n) => ({ repMin: 8, repMax: 8, ...(n === 3 ? { targetWeight: 112.5, targetRir: 1 } : {}) })))]
    renderPlan(5)

    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null }) // the default's 8; weight 100 and RIR 2 as last week
    expect(markedCells('02')).toEqual({ weight: null, reps: null, rir: null })
    expect(markedCells('03')).toEqual({ weight: 'changed', reps: null, rir: 'changed' })
  })

  it('sets and structure are the default\'s: a set more than the default is added; an exercise the default lacks is highlighted; one it has and the week lacks is a line', () => {
    stable()
    mockState.runCopy = { 'wd-1': [BENCH, ROW] }
    mockState.programSets = [...DEFAULT_SETS, pset('p-r1', 'pe-row', 1)]
    const lunge = pe('pe-lunge', EX_LUNGE, 1)
    mockState.all = [lastWeek(), plan(5, [BENCH, lunge], [...workSets('pe-bench', 'b5-', 4, () => ({ repMin: 8, repMax: 8 })), wset('l5', 'pe-lunge', 1)])]
    renderPlan(5)

    expect(mark(wholeRow('04'))).toBe('added') // the default has three sets
    expect(mark(wholeRow('03'))).toBeNull()
    openStructureView()
    expect(exerciseMark('Lunge')).toBe('added')
    expect(removedLines().map((r) => struck(r).text)).toEqual(['Row'])
  })

  it('a stable week with no last week still compares with the default; its weights and RIR show nothing', () => {
    stable()
    mockState.all = [plan(5, [BENCH], workSets('pe-bench', 'b5-', 3, (n) => ({ repMin: n === 1 ? 5 : 8, repMax: n === 1 ? 5 : 8, targetWeight: 1 })))]
    renderPlan(5)
    expect(markedCells('01')).toEqual({ weight: null, reps: 'changed', rir: null })
    expect(markedCells('02')).toEqual({ weight: null, reps: null, rir: null })
  })

  it('the run\'s copy is read only for the rows it has — and the highlighting waits for it: until its sets are read, nothing is marked', () => {
    stable()
    mockState.programSets = undefined
    mockState.all = [lastWeek(), plan(5, [BENCH], workSets('pe-bench', 'b5-', 3, () => ({ repMin: 5, repMax: 5, targetWeight: 1 })))]
    renderPlan(5)
    expect(programSetReads).toContainEqual(['pe-bench'])
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
    cleanup()

    // The run's copy's exercises not read yet: same.
    stable()
    mockState.programSets = DEFAULT_SETS
    mockState.runCopy = { 'wd-1': undefined }
    renderPlan(5)
    expect(allMarks()).toHaveLength(0)
  })
})

describe('PlanPage — a week-dependent run: reps against last week, like weight and RIR', () => {
  it('reps are last week\'s, not the default\'s', () => {
    // The run's copy says 10 reps for set 1 (so the default WOULD NOT flag 10 and WOULD flag 8); last week had 8.
    mockState.runCopy = { 'wd-1': [BENCH] }
    mockState.programSets = [pset('p1', 'pe-bench', 1, { repMin: 10, repMax: 10 })]
    mockState.all = [
      plan(4, [BENCH], [wset('l4', 'pe-bench', 1, { repMin: 8, repMax: 8 })]),
      plan(5, [BENCH], [wset('b5', 'pe-bench', 1, { repMin: 10, repMax: 10, targetWeight: 105, targetRir: 1 })]),
    ]
    renderPlan(5)
    expect(markedCells('01')).toEqual({ weight: 'changed', reps: 'changed', rir: 'changed' }) // 10 ≠ last week's 8

    cleanup()
    mockState.all = [
      plan(4, [BENCH], [wset('l4', 'pe-bench', 1, { repMin: 8, repMax: 8 })]),
      plan(5, [BENCH], [wset('b5', 'pe-bench', 1, { repMin: 8, repMax: 8 })]), // the default's 10 is no source for this week
    ]
    renderPlan(5)
    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null })
    // ... and the run's copy's sets were not even read for it.
    expect(programSetReads).toHaveLength(0)
  })

  it('last week is the last normal, non-empty occurrence: a deload week and an empty one between are skipped', () => {
    mockState.all = [
      plan(2, [BENCH], [wset('w2', 'pe-bench', 1, { targetWeight: 100 })]),
      plan(3, [BENCH], [wset('w3', 'pe-bench', 1, { targetWeight: 70 })], { isDeload: true }),
      plan(4, [BENCH], []), // planned empty
      plan(5, [BENCH], [wset('w5', 'pe-bench', 1, { targetWeight: 100 })]),
    ]
    renderPlan(5)
    expect(markedCells('01').weight).toBeNull() // against week 2's 100 — not the deload's 70, and not an empty week
  })
})

describe('PlanPage — week 1 is compared with the run\'s copy as it is now', () => {
  const copy = () => {
    mockState.runCopy = { 'wd-1': [BENCH, ROW] }
    mockState.programSets = [pset('p1', 'pe-bench', 1, { repMin: 8, repMax: 8 }), pset('p-r1', 'pe-row', 1)]
  }

  it('an exercise the run\'s copy has and week 1 doesn\'t is a struck-through line; a rep target that differs from the copy\'s is highlighted', () => {
    copy()
    // Week 1: Bench Press only (Row dropped), 5 reps where the run's copy says 8.
    mockState.all = [plan(1, [BENCH], [wset('b1', 'pe-bench', 1, { repMin: 5, repMax: 5 })])]
    renderPlan(1)

    expect(markedCells('01')).toEqual({ weight: null, reps: 'changed', rir: null })
    openStructureView()
    expect(removedLines().map((r) => struck(r).text)).toEqual(['Row'])
    expect(removedLines()[0].previousElementSibling).toBe(headerOf('Bench Press').parentElement)
  })

  it('week 1\'s weights and RIR are never marked, whatever they are', () => {
    copy()
    mockState.all = [plan(1, [BENCH], [wset('b1', 'pe-bench', 1, { repMin: 8, repMax: 8, targetWeight: 999, targetRir: 0 }), wset('b2', 'pe-bench', 2, { targetWeight: 1, targetRir: null })])]
    renderPlan(1)
    // Set 1 matches the copy's; set 2 is a set the copy doesn't have (added: marked whole, in SETS) — but set 1's numbers are not.
    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null })
    expect(mark(wholeRow('02'))).toBe('added')
  })

  it('week 1 of a stable run too; and the copy\'s sets that the default dropped (removed_at) are not part of it', () => {
    mockState.program = makeProgram({ planningType: 'stable' })
    mockState.runCopy = { 'wd-1': [BENCH] }
    // Three program sets, the second dropped from the default (removed_at set): the copy is sets 1 and 3.
    mockState.programSets = [pset('p1', 'pe-bench', 1), pset('p2', 'pe-bench', 2, { removedAt: '2026-10-01T00:00:00Z' }), pset('p3', 'pe-bench', 3)]
    mockState.all = [plan(1, [BENCH], workSets('pe-bench', 'b1-', 2))]
    renderPlan(1)
    // Two sets against two: nothing is added, nothing removed. (If the dropped set still counted: a struck-through row 03.)
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
    cleanup()

    // And a week with the third set the default no longer has: it is the one that is added.
    mockState.all = [plan(1, [BENCH], workSets('pe-bench', 'b1-', 3))]
    renderPlan(1)
    expect(mark(wholeRow('03'))).toBe('added')
    expect(mark(wholeRow('02'))).toBeNull()
  })

  it('compared with nothing → compared with something: an empty run copy makes every exercise of week 1 "added" (STRUCTURE) and no exercise is struck through', () => {
    mockState.runCopy = { 'wd-1': [] }
    mockState.all = [plan(1, [BENCH], workSets('pe-bench', 'b1-', 1))]
    renderPlan(1)
    openStructureView()
    expect(exerciseMark('Bench Press')).toBe('added')
    expect(programSetReads.filter((ids) => ids.length === 0)).toHaveLength(0) // nothing to read for an empty copy
  })
})

describe('PlanPage — a week that started empty is compared with nothing (provisional 84)', () => {
  const weeks = () => [
    plan(2, [BENCH], workSets('pe-bench', 'w2-', 3)),
    // Week 3, filled by hand: different in every way.
    plan(3, [SQUAT], [wset('q3', 'pe-squat', 1, { targetWeight: 50, repMin: 15, repMax: 15, targetRir: 4 })]),
  ]

  it('NEW WEEK STARTS = empty: week 3 of a week-dependent run shows no highlighting, in either view', () => {
    useSettingsStore.setState({ weekStart: 'empty' })
    mockState.all = weeks()
    renderPlan(3)
    expect(screen.getByText('Squat')).toBeTruthy()
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
    openStructureView()
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
  })

  it('control: the same weeks with NEW WEEK STARTS = copy are compared with week 2', () => {
    mockState.all = weeks()
    renderPlan(3)
    openStructureView()
    expect(exerciseMark('Squat')).toBe('added')
    expect(removedLines().map((r) => struck(r).text)).toEqual(['Bench Press'])
  })

  it('the setting does not touch week 1, which is built from the run\'s copy either way', () => {
    useSettingsStore.setState({ weekStart: 'empty' })
    mockState.runCopy = { 'wd-1': [BENCH] }
    mockState.programSets = [pset('p1', 'pe-bench', 1)]
    mockState.all = [plan(1, [BENCH], [wset('b1', 'pe-bench', 1, { repMin: 5, repMax: 5 })])]
    renderPlan(1)
    expect(markedCells('01').reps).toBe('changed')
  })

  it('a week with no last week (nothing planned before it) shows none either', () => {
    mockState.all = [plan(3, [SQUAT], [wset('q3', 'pe-squat', 1)])]
    renderPlan(3)
    openStructureView()
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Never highlighted
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage — what is never highlighted', () => {
  it('a deload session shows no highlighting (it differs by design), in either view', () => {
    mockState.all = [
      plan(4, [BENCH, ROW], [...workSets('pe-bench', 'b4-', 3), wset('r4', 'pe-row', 1)]),
      plan(5, [SQUAT, BENCH].map((p, i) => withPosition(p, i)), workSets('pe-bench', 'b5-', 1, () => ({ targetWeight: 60, repMin: 12, repMax: 12 })).concat(wset('q5', 'pe-squat', 1)), { isDeload: true }),
    ]
    renderPlan(5)
    expect(screen.getByLabelText('Unmark this session as deload')).toBeTruthy() // the session is the deload one
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
    openStructureView()
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
    cleanup()

    // ... also week 1 against the run's copy.
    programSetReads.length = 0
    mockState.runCopy = { 'wd-1': [BENCH, ROW] }
    mockState.programSets = [pset('p1', 'pe-bench', 1), pset('p-r1', 'pe-row', 1)]
    mockState.all = [plan(1, [BENCH], [wset('b1', 'pe-bench', 1, { repMin: 3, repMax: 3 })], { isDeload: true })]
    renderPlan(1)
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
    expect(programSetReads).toHaveLength(0) // a deload session reads nothing to compare with
  })

  it('a normal week after a deload week is not compared with it', () => {
    mockState.all = [
      plan(3, [BENCH], [wset('b3', 'pe-bench', 1, { targetWeight: 100 })]),
      plan(4, [BENCH], [wset('b4', 'pe-bench', 1, { targetWeight: 60 })], { isDeload: true }),
      plan(5, [BENCH], [wset('b5', 'pe-bench', 1, { targetWeight: 100 })]),
    ]
    renderPlan(5)
    expect(markedCells('01').weight).toBeNull()
  })

  it('a tag added this week is not highlighted — it is shown as a tag, as always', () => {
    mockState.all = [
      plan(4, [BENCH], workSets('pe-bench', 'b4-', 2)),
      plan(5, [BENCH], workSets('pe-bench', 'b5-', 2, (n) => (n === 2 ? { tags: ['push here', 'custom'] } : {}))),
    ]
    renderPlan(5)
    expect(screen.getByText('push here')).toBeTruthy()
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
    openStructureView()
    expect(allMarks()).toHaveLength(0)
  })

  it('a changed run-wide field is not highlighted: rest, rest after, tempo, unit, superset grouping', () => {
    const asLastWeek = pe('pe-bench', EX_BENCH, 0, { restSeconds: 90, restAfterSeconds: 120, tempo: '3-1-1-0', weightUnit: 'kg', supersetBlockId: null })
    const now = pe('pe-bench', EX_BENCH, 0, { restSeconds: 150, restAfterSeconds: null, tempo: '2-0-2-0', weightUnit: 'lbs', supersetBlockId: 'block-1' })
    const rowNow = pe('pe-row', EX_ROW, 1, { supersetBlockId: 'block-1' })
    mockState.all = [
      plan(4, [asLastWeek, ROW], [wset('b4', 'pe-bench', 1), wset('r4', 'pe-row', 1)]),
      plan(5, [now, rowNow], [wset('b5', 'pe-bench', 1), wset('r5', 'pe-row', 1)]),
    ]
    renderPlan(5)
    expect(screen.getAllByText('SUPERSET', { exact: false })).toHaveLength(2) // the grouping really changed (both members say so)
    expect(allMarks()).toHaveLength(0)
    openStructureView()
    expect(screen.getByText('REST 2min 30s')).toBeTruthy() // the new rest is there, as a plain marker
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
  })

  it('weights are compared as stored: the unit an exercise is shown in neither causes nor hides a difference', () => {
    const lbs = pe('pe-bench', EX_BENCH, 0, { weightUnit: 'lbs' })
    mockState.all = [plan(4, [BENCH], [wset('b4', 'pe-bench', 1, { targetWeight: 100 })]), plan(5, [lbs], [wset('b5', 'pe-bench', 1, { targetWeight: 100 })])]
    renderPlan(5)
    expect(markedCells('01').weight).toBeNull()
    expect(screen.getByText('220.5lbs')).toBeTruthy() // shown in lbs, still the same 100 kg
  })

  it('identical weeks mark nothing at all: no attribute, no line', () => {
    const sets = (suffix: string) => [
      wset(`w${suffix}`, 'pe-bench', 1, { isWarmup: true, targetRir: null }),
      wset(`h${suffix}`, 'pe-bench', 2, { stageKind: 'rest_pause' }),
      stageOf(`hs${suffix}`, `h${suffix}`, 'pe-bench', 1),
      wset(`r${suffix}`, 'pe-row', 1),
    ]
    mockState.all = [plan(4, [BENCH, ROW], sets('4')), plan(5, [BENCH, ROW], sets('5'))]
    renderPlan(5)
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
    openStructureView()
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Sequence runs, past weeks
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage — a sequence run compares each slot with its own source slot', () => {
  // A, B, A: workout A twice, in slots 1 and 3. Cycle 1: A·1 benches 100, A·3 benches 120. Cycle 2 repeats them.
  const A_ROW = pe('pe-a', EX_BENCH, 0, {}, 'wd-1')
  const B_ROW = pe('pe-b', EX_ROW, 0, {}, 'wd-b')
  const items: SequenceItem[] = [
    { id: 'si-0', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-1' },
    { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 1, workoutDayId: 'wd-b' },
    { id: 'si-2', userId: 'user-1', programId: 'prog-1', position: 2, workoutDayId: 'wd-1' },
  ]
  const slotPlan = (cycle: number, position: number, weight: number) => {
    const workoutDayId = position === 1 ? 'wd-b' : 'wd-1'
    const row = position === 1 ? B_ROW : A_ROW
    return plan(cycle, [row], [wset(`s${cycle}-${position}`, row.id, 1, { targetWeight: weight })], { workoutDayId, sequencePosition: position })
  }
  const arrangeSequence = (cycle2: { a0: number; a2: number }) => {
    mockState.program = makeProgram({ scheduleType: 'sequence', schedule: EMPTY_SCHEDULE })
    mockState.days = [workoutDay, workoutDayB]
    mockState.sequenceItems = items
    mockState.all = [
      slotPlan(1, 0, 100), slotPlan(1, 1, 80), slotPlan(1, 2, 120),
      slotPlan(2, 0, cycle2.a0), slotPlan(2, 1, 80), slotPlan(2, 2, cycle2.a2),
    ]
    renderPlan(1)
    fireEvent.click(screen.getByLabelText('Next week')) // cycle 2
  }

  it('each of A\'s slots is compared with the same slot last cycle: equal to its own source → not marked, although it differs from the other slot\'s', () => {
    arrangeSequence({ a0: 100, a2: 120 })
    expect(screen.getByText('CYCLE 2')).toBeTruthy()
    // SLOT 1 (A): 100 now, 100 in cycle 1's slot 1 (cycle 1's slot 3 had 120).
    expect(markedCells('01').weight).toBeNull()
    fireEvent.click(screen.getByText('SLOT 3'))
    // SLOT 3 (A again): 120 now, 120 in cycle 1's slot 3 (cycle 1's slot 1 had 100).
    expect(markedCells('01').weight).toBeNull()
    expect(allMarks()).toHaveLength(0)
  })

  it('a slot that differs from its own source is marked; the other slot, unchanged, is not', () => {
    arrangeSequence({ a0: 100, a2: 125 })
    expect(markedCells('01').weight).toBeNull() // slot 1: 100 = 100
    fireEvent.click(screen.getByText('SLOT 3'))
    expect(markedCells('01').weight).toBe('changed') // slot 3: 125 ≠ its own 120
    fireEvent.click(screen.getByText('SLOT 1'))
    expect(markedCells('01').weight).toBeNull()
  })

  it('a different workout in between does not interfere (slot 2 is workout B, compared with B\'s own slot)', () => {
    arrangeSequence({ a0: 100, a2: 120 })
    fireEvent.click(screen.getByText('SLOT 2'))
    expect(screen.getByText('Row')).toBeTruthy()
    expect(markedCells('01').weight).toBeNull() // 80 = 80
  })
})

describe('PlanPage — past weeks highlight too, compared as they are now', () => {
  it('a past week read-only: its differences from the week before it are marked (cells disabled, a kind change on the spacer where the ⋯ would be)', () => {
    const staged = (kind: WeekPlanSet['stageKind']) => [wset('h', 'pe-bench', 1, { stageKind: kind }), stageOf('hs', 'h', 'pe-bench', 1)]
    mockState.all = [
      plan(2, [BENCH], staged('dropset')),
      plan(3, [BENCH], [...staged('rest_pause').map((s) => (s.id === 'h' ? { ...s, targetWeight: 105 } : s))]),
      plan(5, [BENCH], staged('dropset')),
    ]
    renderPlan(5)
    fireEvent.click(screen.getByLabelText('Previous week'))
    fireEvent.click(screen.getByLabelText('Previous week')) // week 3
    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.getByText('PAST WEEK — READ ONLY')).toBeTruthy()

    const cells = cellsOf(rowOf('01'))
    expect(mark(cells.weight)).toBe('changed')
    expect((cells.weight as HTMLButtonElement).disabled).toBe(true)
    openStructureView()
    expect(screen.queryByLabelText('Options for set 1')).toBeNull() // read-only: no ⋯ ...
    const dots = Array.from(document.querySelectorAll('[data-diff="kind"]'))
    expect(dots).toHaveLength(1) // ... the dot is where it would be
    expect(inAccent(dots[0] as HTMLElement)).toBe(true)
  })

  it('a past week is compared with the weeks before it, never the ones after it', () => {
    mockState.all = [
      plan(1, [BENCH], [wset('w1', 'pe-bench', 1, { targetWeight: 100 })]),
      plan(2, [BENCH], [wset('w2', 'pe-bench', 1, { targetWeight: 110 })]),
      plan(3, [BENCH], [wset('w3', 'pe-bench', 1, { targetWeight: 120 })]),
      plan(5, [BENCH], [wset('w5', 'pe-bench', 1, { targetWeight: 130 })]),
    ]
    renderPlan(5)
    fireEvent.click(screen.getByLabelText('Previous week')) // week 4: not planned
    fireEvent.click(screen.getByLabelText('Previous week')) // week 3
    expect(markedCells('01').weight).toBe('changed') // 120 against week 2's 110 (week 5's 130 is no source of it)
    fireEvent.click(screen.getByLabelText('Previous week')) // week 2
    expect(markedCells('01').weight).toBe('changed') // 110 against week 1's 100
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Several workouts, and the page itself
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage — a week with nothing to flag renders exactly what it did before the highlighting', () => {
  it('a week identical to its source is the very same markup as a week compared with nothing, in both views (no attribute, no style, no element is added)', () => {
    // The week: warmup, a staged set with a stage, a tagged set, on two exercises, in a unit that isn't the
    // Settings one, with run-wide fields set. Week 4 is its source and equal to it; the other render has no
    // week 4, so it is compared with nothing at all.
    const sets = (suffix: string) => [
      wset(`w${suffix}`, 'pe-bench', 1, { isWarmup: true, targetRir: null, targetWeight: 40, repMin: 10, repMax: 10 }),
      wset(`h${suffix}`, 'pe-bench', 2, { stageKind: 'rest_pause', repMin: 8, repMax: 12 }),
      stageOf(`hs${suffix}`, `h${suffix}`, 'pe-bench', 1),
      wset(`t${suffix}`, 'pe-bench', 3, { tags: ['push here'] }),
      wset(`r${suffix}`, 'pe-row', 1, { targetWeight: null, targetRir: null, repMin: null, repMax: null }),
    ]
    const rows = [pe('pe-bench', EX_BENCH, 0, { restSeconds: 120, tempo: '3-1-1-0', weightUnit: 'lbs' }), pe('pe-row', EX_ROW, 1, { supersetBlockId: 'blk' })]
    const markup = (withSource: boolean) => {
      mockState.all = withSource ? [plan(4, rows, sets('4')), plan(5, rows, sets('5'))] : [plan(5, rows, sets('5'))]
      const { container } = renderPlan(5)
      const setsView = container.innerHTML
      openStructureView()
      const structureView = container.innerHTML
      cleanup()
      return { sets: setsView, structure: structureView }
    }
    const compared = markup(true)
    const alone = markup(false)
    expect(compared.sets).toBe(alone.sets)
    expect(compared.structure).toBe(alone.structure)
    expect(compared.sets).toContain('Bench Press')
    expect(compared.structure).toContain('REST 2min 0s')
    expect(compared.sets).not.toContain('data-diff')
    expect(compared.structure).not.toContain('<del')

    // The control: against a source that differs, the same week's markup does change (so the equality above means something).
    mockState.all = [plan(4, rows, sets('4').map((s) => (s.id === 'h4' ? { ...s, targetWeight: 90 } : s))), plan(5, rows, sets('5'))]
    const { container } = renderPlan(5)
    expect(container.innerHTML).not.toBe(alone.sets)
    expect(container.innerHTML).toContain('data-diff="changed"')
  })
})

describe('PlanPage — each workout is compared with its own history', () => {
  it('another workout\'s planned weeks are no source: Pull Day\'s week 4 is not Push Day\'s', () => {
    mockState.program = makeProgram({ schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1', thursday: 'wd-b' } })
    mockState.days = [workoutDay, workoutDayB]
    const pullRow = pe('pe-pull', EX_ROW, 0, {}, 'wd-b')
    mockState.all = [
      plan(4, [BENCH], [wset('b4', 'pe-bench', 1, { targetWeight: 100 })]),
      plan(4, [pullRow], [wset('p4', 'pe-pull', 1, { targetWeight: 50 })], { workoutDayId: 'wd-b' }),
      plan(5, [BENCH], [wset('b5', 'pe-bench', 1, { targetWeight: 100 })]),
      plan(5, [pullRow], [wset('p5', 'pe-pull', 1, { targetWeight: 50 })], { workoutDayId: 'wd-b' }),
    ]
    renderPlan(5)
    expect(markedCells('01').weight).toBeNull() // Bench: 100 = 100 (Pull's 50 is another workout's)
    fireEvent.click(screen.getByText('THU'))
    expect(screen.getByText('Row')).toBeTruthy()
    expect(markedCells('01').weight).toBeNull() // Row: 50 = 50
    expect(allMarks()).toHaveLength(0)
  })

  it('the marks follow the week the page shows: stepping to another week compares that week', () => {
    mockState.all = [
      plan(4, [BENCH], [wset('b4', 'pe-bench', 1, { targetWeight: 100 })]),
      plan(5, [BENCH], [wset('b5', 'pe-bench', 1, { targetWeight: 105 })]),
      plan(6, [BENCH], [wset('b6', 'pe-bench', 1, { targetWeight: 105 })]),
    ]
    renderPlan(5)
    expect(markedCells('01').weight).toBe('changed')
    fireEvent.click(screen.getByLabelText('Next week'))
    expect(screen.getByText('WEEK 6')).toBeTruthy()
    expect(markedCells('01').weight).toBeNull() // 105 = week 5's 105
  })
})
