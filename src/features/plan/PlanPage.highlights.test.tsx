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
//   the rows   weight, reps and RIR (a stage's and a warmup's too); a working set added or removed
//   (gone)     exercises added, removed, moved; warmup sets and stages added or removed; a set's kind (a dot on its ⋯)
//
// A mark is read through `data-diff` ("changed" | "added" | "moved" | "removed" | "kind") AND through the token it
// draws with (`--accent`; removed: `--text-dim` and line-through), so a mark that is there but not drawn fails too.
//
// Chunk 54a: Plan has one view now (the exercise cards and their set rows), so what was the STRUCTURE view's is gone with it: an
// added, moved, swapped or removed exercise, a warmup or a stage as a structure row, a set's kind (the dot on its ⋯). The set rows keep
// the old marks, drawn through the same CHANGED_CELL class, until chunk 54b draws changes since the source anew; the STRUCTURE
// tests became absence tests ("STRUCTURE's marks are gone"), and a warmup's row is `W` and the working sets count from 01.

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
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: mockState.days, isLoading: false }),
  useProgramExercises: (workoutDayId: string) => ({ data: mockState.runCopy[workoutDayId], isLoading: false }),
  useSequenceItems: () => ({ data: mockState.sequenceItems }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
  // The program sets of the rows asked for (the highlighting asks for the run's copy).
  useProgramSets: (ids: string[]) => {
    programSetReads.push(ids)
    return { data: mockState.programSets === undefined ? undefined : mockState.programSets.filter((ps) => ids.includes(ps.programExerciseId)) }
  },
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../gym/useSession', () => ({ useLastDoneOrSkippedSession: () => ({ data: null }) }))
// Plan reads which sessions are done (useDoneWeekPlanIds); none here.
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() })) // the CHANGE THE PROGRAM button's statuses: none here
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: mockState.all.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.all, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')
const { openWeekTile } = await import('./planMenus.testutil')

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
// A working set's cells: weight, reps and RIR (each a button; a warmup row has no RIR cell, and its third button is the ⋯).
const cellsOf = (row: HTMLElement) => {
  const buttons = buttonsOf(row)
  return { weight: buttons[0], reps: buttons[1], rir: buttons[2] }
}
const mark = (el: Element | null | undefined) => el?.getAttribute('data-diff') ?? null
// Drawn in the accent: the token is on the element's own style, over its text or its edge.
const inAccent = (el: HTMLElement) => (el.getAttribute('style') ?? '').includes('var(--accent)')
const markedCells = (numberText: string, nth = 0) => {
  const c = cellsOf(rowOf(numberText, nth))
  return { weight: mark(c.weight), reps: mark(c.reps), rir: mark(c.rir) }
}
// Every removed (dim, struck-through) element on the page.
const removedLines = () => Array.from(document.querySelectorAll('[data-diff="removed"]')) as HTMLElement[]
const struck = (el: HTMLElement) => {
  const del = el.querySelector('del') as HTMLElement
  return { text: del.textContent, line: del.style.textDecoration, color: del.style.color }
}
// Everything marked, anywhere on the page.
const allMarks = () => Array.from(document.querySelectorAll('[data-diff]'))
const allRemoved = () => Array.from(document.querySelectorAll('del'))

// ═══════════════════════════════════════════════════════════════════════════════
// SETS
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage rows — the numbers that differ from last week (a week-dependent run)', () => {
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
    expect(inAccent(cellsOf(rowOf('02')).rir)).toBe(true) // the RIR cell's edge and text
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

  it('a set removed in week 5 shows what it held, in the exercise\'s own unit (lbs here); one that held only a rep target shows only that', () => {
    const lbs = pe('pe-bench', EX_BENCH, 0, { weightUnit: 'lbs' })
    mockState.all = [
      plan(4, [lbs], [wset('a1', 'pe-bench', 1), wset('a2', 'pe-bench', 2, { targetWeight: 100, repMin: 6, repMax: 6, targetRir: 3 })]),
      plan(5, [lbs], [wset('b1', 'pe-bench', 1)]),
    ]
    renderPlan(5)
    expect(removedLines().map((r) => r.textContent)).toEqual(['02220.5lbs × 6  RIR 3'])
    cleanup()

    // A removed set that held only a rep target shows that and nothing else (no empty placeholders).
    mockState.all = [
      plan(4, [BENCH], [wset('a1', 'pe-bench', 1), wset('a2', 'pe-bench', 2, { targetWeight: null, targetRir: null, repMin: 10, repMax: 12 })]),
      plan(5, [BENCH], [wset('b1', 'pe-bench', 1)]),
    ]
    renderPlan(5)
    expect(removedLines().map((r) => r.textContent)).toEqual(['0210–12'])
  })

  it('a working set added in week 5 is marked: its number, its reps, and its weight and RIR too, since last week has no fourth set for them to equal', () => {
    mockState.all = [week4(), plan(5, [BENCH, SQUAT], [...workSets('pe-bench', 'b5-', 4), wset('q5-1', 'pe-squat', 1, { targetWeight: 120 })])]
    renderPlan(5)

    expect(mark(wholeRow('04'))).toBe('added')
    expect(inAccent(screen.getByText('04'))).toBe(true)
    expect(markedCells('04')).toEqual({ weight: 'changed', reps: 'changed', rir: 'changed' })
    expect(mark(wholeRow('03'))).toBeNull()
    expect(markedCells('03')).toEqual({ weight: null, reps: null, rir: null })
    expect(removedLines()).toHaveLength(0)
  })

  it('a staged working set added in week 5 is marked with its stages', () => {
    const staged = [wset('h', 'pe-bench', 2, { stageKind: 'dropset' }), stageOf('hs1', 'h', 'pe-bench', 1), stageOf('hs2', 'h', 'pe-bench', 2)]
    mockState.all = [plan(4, [BENCH], workSets('pe-bench', 'b4-', 1)), plan(5, [BENCH], [...workSets('pe-bench', 'b5-', 1), ...staged])]
    renderPlan(5)

    expect(mark(wholeRow('02'))).toBe('added')
    expect(markedCells('02')).toEqual({ weight: 'changed', reps: 'changed', rir: 'changed' }) // last week has no second set
    // Its two stage rows: every number on them too (last week has no stages there), though a stage's newness is not a mark of its own.
    const stageRows = screen.getAllByText('↳').map((arrow) => arrow.parentElement as HTMLElement)
    expect(stageRows).toHaveLength(2)
    for (const row of stageRows) {
      const c = cellsOf(row)
      expect([mark(c.weight), mark(c.reps), mark(c.rir)]).toEqual(['changed', 'changed', 'changed'])
      expect(mark(row.parentElement)).toBeNull() // no row-level mark on a stage
    }
    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null })
  })

  it('the stages of a working set removed in week 5 go with it: one dim row, none of their own', () => {
    const staged = [wset('h', 'pe-bench', 2, { stageKind: 'dropset' }), stageOf('hs1', 'h', 'pe-bench', 1), stageOf('hs2', 'h', 'pe-bench', 2)]
    mockState.all = [plan(4, [BENCH], [...workSets('pe-bench', 'b4-', 1), ...staged]), plan(5, [BENCH], workSets('pe-bench', 'b5-', 1))]
    renderPlan(5)
    expect(removedLines().map((r) => r.textContent)).toEqual(['02100kg × 8  RIR 2'])
    expect(allRemoved()).toHaveLength(1) // not a row of the stages' own
    expect(allMarks().filter((m) => m.getAttribute('data-diff') !== 'removed')).toHaveLength(0)
  })

  it('a stage\'s and a warmup\'s numbers are marked where they differ from their counterpart\'s', () => {
    const base = (warmW: number, stageW: number) => [
      wset('w', 'pe-bench', 1, { isWarmup: true, targetRir: null, targetWeight: warmW, repMin: 10, repMax: 10 }),
      wset('h', 'pe-bench', 2, { stageKind: 'dropset' }),
      stageOf('hs', 'h', 'pe-bench', 1, { targetWeight: stageW }),
    ]
    mockState.all = [plan(4, [BENCH], base(40, 80)), plan(5, [BENCH], base(45, 75))]
    renderPlan(5)

    // The warmup (W): weight differs; reps the same; it has no RIR to mark.
    const warm = buttonsOf(rowOf('W'))
    expect([mark(warm[0]), mark(warm[1])]).toEqual(['changed', null])
    expect(within(rowOf('W')).queryByText(/RIR/)).toBeNull()
    // The working set (01 — a warmup is not counted in the working sets' numbers) is the same.
    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null })
    // The stage row (↳): its weight differs.
    const stageRow = screen.getByText('↳').parentElement as HTMLElement
    const stage = cellsOf(stageRow)
    expect([mark(stage.weight), mark(stage.reps), mark(stage.rir)]).toEqual(['changed', null, null])
  })

  it('a stage\'s reps alone, and a stage\'s RIR alone, are each marked on the stage row — on that cell, and on nothing else', () => {
    // stageOf's stage: 80 kg, 6 reps, RIR 0. Its head (01) and everything else is the same in both weeks.
    const staged = (over: Partial<WeekPlanSet> = {}) => [wset('h', 'pe-bench', 1, { stageKind: 'dropset' }), stageOf('hs', 'h', 'pe-bench', 1, over)]
    const stageCells = () => {
      const c = cellsOf(screen.getByText('↳').parentElement as HTMLElement)
      return { weight: mark(c.weight), reps: mark(c.reps), rir: mark(c.rir), accent: { reps: inAccent(c.reps), rir: inAccent(c.rir) } }
    }

    mockState.all = [plan(4, [BENCH], staged()), plan(5, [BENCH], staged({ repMin: 8, repMax: 10 }))]
    renderPlan(5)
    expect(stageCells()).toEqual({ weight: null, reps: 'changed', rir: null, accent: { reps: true, rir: false } })
    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null })
    expect(allMarks()).toHaveLength(1)
    cleanup()

    mockState.all = [plan(4, [BENCH], staged()), plan(5, [BENCH], staged({ targetRir: 2 }))]
    renderPlan(5)
    expect(stageCells()).toEqual({ weight: null, reps: null, rir: 'changed', accent: { reps: false, rir: true } })
    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null })
    expect(allMarks()).toHaveLength(1)
  })

  it('a warmup new this week is not a row mark of its own (it is a set kind); the working sets\' added/removed are', () => {
    const warm = wset('w', 'pe-bench', 3, { isWarmup: true, targetRir: null })
    mockState.all = [plan(4, [BENCH], workSets('pe-bench', 'b4-', 2)), plan(5, [BENCH], [...workSets('pe-bench', 'b5-', 2), warm])]
    renderPlan(5)
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
  })

  it('no exercise is marked: an added, moved, swapped or removed exercise leaves no mark and no line (those were STRUCTURE\'s, which went with the view in chunk 54a)', () => {
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
    cleanup()

    // A swap (Row for Incline Press, the same place): the old exercise is no struck-through line above the new one, and the new one is no accent.
    const incline = pe('pe-incline', EX_INCLINE, 1)
    mockState.all = [
      plan(4, [BENCH, ROW, SQUAT], [wset('b4', 'pe-bench', 1), wset('r4', 'pe-row', 1), wset('q4', 'pe-squat', 1)]),
      plan(5, [BENCH, incline, withPosition(SQUAT, 2)], [wset('b5', 'pe-bench', 1), wset('i5', 'pe-incline', 1), wset('q5', 'pe-squat', 1)]),
    ]
    renderPlan(5)
    expect(screen.getByText('Incline Press')).toBeTruthy()
    expect(screen.queryByText('Row')).toBeNull()
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
    expect(inAccent(screen.getByText('Incline Press'))).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// What was STRUCTURE's is gone (chunk 54a; Checks that lied #32: test what must be absent)
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage — the STRUCTURE view\'s marks went with the view: a set\'s kind, a warmup or a stage, an exercise\'s place', () => {
  it('a changed stage kind puts no dot anywhere (it shows in the kind chip, unmarked), and a null kind on a staged set is a dropset as before', () => {
    const staged = (kind: WeekPlanSet['stageKind']) => [
      wset('h1', 'pe-bench', 1), wset('h2', 'pe-bench', 2, { stageKind: kind }), stageOf('h2s', 'h2', 'pe-bench', 1), wset('h3', 'pe-bench', 3),
    ]
    mockState.all = [plan(4, [BENCH], staged('dropset')), plan(5, [BENCH], staged('rest_pause'))]
    renderPlan(5)

    expect(screen.getByText('REST-PAUSE · 1 PAUSE')).toBeTruthy() // the new kind, as the chip says it
    expect(document.querySelectorAll('[data-diff="kind"]')).toHaveLength(0)
    expect(screen.queryByLabelText('Options for set 2')?.querySelector('[data-diff]') ?? null).toBeNull()
    expect(allMarks()).toHaveLength(0)
    cleanup()

    const one = (kind: WeekPlanSet['stageKind']) => [wset('h2', 'pe-bench', 1, { stageKind: kind }), stageOf('h2s', 'h2', 'pe-bench', 1)]
    mockState.all = [plan(4, [BENCH], one('dropset')), plan(5, [BENCH], one(null))]
    renderPlan(5)
    expect(screen.getByText('DROPSET · 1 DROP')).toBeTruthy()
    expect(allMarks()).toHaveLength(0)
  })

  it('a warmup removed, or a stage removed, leaves no struck-through row (the working sets\' removals do)', () => {
    mockState.all = [
      plan(4, [BENCH], [
        wset('a1', 'pe-bench', 1), wset('a2', 'pe-bench', 2, { stageKind: 'dropset' }), stageOf('a2s1', 'a2', 'pe-bench', 1), stageOf('a2s2', 'a2', 'pe-bench', 2),
        wset('a3', 'pe-bench', 3, { isWarmup: true, targetRir: null }),
      ]),
      plan(5, [BENCH], [wset('b1', 'pe-bench', 1), wset('b2', 'pe-bench', 2, { stageKind: 'dropset' }), stageOf('b2s1', 'b2', 'pe-bench', 1)]),
    ]
    renderPlan(5)

    expect(removedLines().map((r) => r.textContent)).toEqual([]) // no 'WARMUP' row, no 'STAGE' row
    expect(allRemoved()).toHaveLength(0)
  })

  it('a stage or a warmup added, and two exercises that traded places, leave no mark at all: only a number that differs from its counterpart\'s is marked', () => {
    // Week 5 adds a warmup (after the working set, as the old marks pair sets by their number) and a second stage, and swaps the two exercises'
    // places; the numbers of what both weeks have are equal.
    mockState.all = [
      plan(4, [BENCH, ROW], [wset('a1', 'pe-bench', 1, { stageKind: 'dropset' }), stageOf('a1s1', 'a1', 'pe-bench', 1), wset('r4', 'pe-row', 1)]),
      plan(5, [withPosition(ROW, 0), withPosition(BENCH, 1)], [
        wset('b1', 'pe-bench', 1, { stageKind: 'dropset' }), stageOf('b1s1', 'b1', 'pe-bench', 1), stageOf('b1s2', 'b1', 'pe-bench', 2),
        wset('b3', 'pe-bench', 3, { isWarmup: true, targetRir: null }), wset('r5', 'pe-row', 1),
      ]),
    ]
    renderPlan(5)

    // The second stage and the warmup are new, which was STRUCTURE's mark ('added' on the row): no 'added' row, no 'moved' exercise, and the
    // new stage has no counterpart whose numbers it could differ from.
    expect(screen.getAllByText('↳')).toHaveLength(2)
    expect(allMarks()).toHaveLength(0)
    expect(removedLines()).toHaveLength(0)
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

  it('sets are the default\'s: a set more than the default is added (and the exercises the default has or lacks leave no mark: STRUCTURE\'s, gone)', () => {
    stable()
    mockState.runCopy = { 'wd-1': [BENCH, ROW] }
    mockState.programSets = [...DEFAULT_SETS, pset('p-r1', 'pe-row', 1)]
    const lunge = pe('pe-lunge', EX_LUNGE, 1)
    mockState.all = [lastWeek(), plan(5, [BENCH, lunge], [...workSets('pe-bench', 'b5-', 4, () => ({ repMin: 8, repMax: 8 })), wset('l5', 'pe-lunge', 1)])]
    renderPlan(5)

    // The run's copy was read for ITS rows (Bench Press, Row — in its own order), not the week's.
    expect(programSetReads).toContainEqual(['pe-bench', 'pe-row'])
    expect(mark(wholeRow('04'))).toBe('added') // the default has three sets
    expect(mark(wholeRow('03'))).toBeNull()
    // Last week (three sets) had no fourth set either: its weight and RIR differ from it as well as its reps from the default's.
    expect(markedCells('04')).toEqual({ weight: 'changed', reps: 'changed', rir: 'changed' })
    // The exercises are the default's too, but their marks were STRUCTURE's (chunk 54a): Lunge, which the default lacks, is no accent
    // and Row, which it has and the week lacks, is no struck-through line. The one added mark is the fourth set's.
    expect(allMarks().filter((m) => m.getAttribute('data-diff') === 'added')).toHaveLength(1)
    expect(removedLines()).toHaveLength(0)
    expect(screen.queryByText('Row')).toBeNull()
  })

  it('a set beyond the default that equals last week\'s set at that position: its number and reps are marked, its weight and RIR are not', () => {
    stable() // the default has three sets of 8
    // Last week had four sets (100 / 105 / 110 / 115, RIR 2, 8 reps) and this week has the same four.
    const four = (prefix: string) => workSets('pe-bench', prefix, 4, () => ({ repMin: 8, repMax: 8 }))
    mockState.all = [plan(4, [BENCH], four('l4-')), plan(5, [BENCH], four('b5-'))]
    renderPlan(5)

    expect(mark(wholeRow('04'))).toBe('added') // beyond the default
    expect(inAccent(screen.getByText('04'))).toBe(true)
    expect(markedCells('04')).toEqual({ weight: null, reps: 'changed', rir: null }) // reps are the default's to say; weight and RIR are last week's
    expect(inAccent(cellsOf(rowOf('04')).reps)).toBe(true)
    expect(inAccent(cellsOf(rowOf('04')).weight)).toBe(false)
    expect(inAccent(cellsOf(rowOf('04')).rir)).toBe(false)
    // The three the default has: nothing.
    for (const n of ['01', '02', '03']) expect(markedCells(n), n).toEqual({ weight: null, reps: null, rir: null })
    expect(allMarks().filter((m) => m.getAttribute('data-diff') === 'changed')).toHaveLength(1)
  })

  it('... and where last week\'s set at that position differs, its weight and RIR are marked on their own; where last week has none, both are', () => {
    stable()
    const four = (prefix: string, fourth: Partial<WeekPlanSet> = {}) => workSets('pe-bench', prefix, 4, (n) => ({ repMin: 8, repMax: 8, ...(n === 4 ? fourth : {}) }))
    const weekFive = plan(5, [BENCH], four('b5-')) // the fourth: 115, RIR 2
    const cellsOfFourth = () => markedCells('04')

    mockState.all = [plan(4, [BENCH], four('l4-', { targetWeight: 100 })), weekFive]
    renderPlan(5)
    expect(cellsOfFourth()).toEqual({ weight: 'changed', reps: 'changed', rir: null })
    cleanup()

    mockState.all = [plan(4, [BENCH], four('l4-', { targetRir: 3 })), weekFive]
    renderPlan(5)
    expect(cellsOfFourth()).toEqual({ weight: null, reps: 'changed', rir: 'changed' })
    cleanup()

    mockState.all = [plan(4, [BENCH], workSets('pe-bench', 'l4-', 3, () => ({ repMin: 8, repMax: 8 }))), weekFive]
    renderPlan(5)
    expect(cellsOfFourth()).toEqual({ weight: 'changed', reps: 'changed', rir: 'changed' })
  })

  it('a staged set beyond the default that equals last week\'s: its number, its reps and its stages\' reps are marked — no weight, no RIR', () => {
    stable()
    const withStaged = (prefix: string) => [
      ...workSets('pe-bench', prefix, 3, () => ({ repMin: 8, repMax: 8 })),
      wset(`${prefix}h`, 'pe-bench', 4, { stageKind: 'dropset', repMin: 8, repMax: 8 }),
      stageOf(`${prefix}s1`, `${prefix}h`, 'pe-bench', 1),
      stageOf(`${prefix}s2`, `${prefix}h`, 'pe-bench', 2),
    ]
    mockState.all = [plan(4, [BENCH], withStaged('l4-')), plan(5, [BENCH], withStaged('b5-'))]
    renderPlan(5)

    expect(mark(wholeRow('04'))).toBe('added')
    expect(markedCells('04')).toEqual({ weight: null, reps: 'changed', rir: null })
    const stageRows = screen.getAllByText('↳').map((arrow) => arrow.parentElement as HTMLElement)
    expect(stageRows).toHaveLength(2)
    for (const row of stageRows) {
      const c = cellsOf(row)
      expect([mark(c.weight), mark(c.reps), mark(c.rir)]).toEqual([null, 'changed', null])
    }
  })

  it('weights and RIR are last week\'s — the last NORMAL week: a deload week between is skipped', () => {
    stable()
    mockState.programSets = [pset('p1', 'pe-bench', 1)]
    const weekAt = (n: number, weight: number, rir: number, over: Partial<WeekPlan> = {}) =>
      plan(n, [BENCH], [wset(`w${n}`, 'pe-bench', 1, { targetWeight: weight, targetRir: rir })], over)
    // Week 2: 100 / RIR 2. Week 3: a deload session, 60 / RIR 4. Week 4 is the one viewed.
    const history = [weekAt(2, 100, 2), weekAt(3, 60, 4, { isDeload: true })]

    mockState.all = [...history, weekAt(4, 100, 2)]
    renderPlan(4)
    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null }) // against week 2, not the deload week
    cleanup()

    mockState.all = [...history, weekAt(4, 105, 1)]
    renderPlan(4)
    expect(markedCells('01')).toEqual({ weight: 'changed', reps: null, rir: 'changed' }) // a real difference from week 2
  })

  it.each([
    ['planned empty, its exercises listed', [BENCH]],
    ['planned with nothing at all', [] as ProgramExercise[]],
  ])('weights and RIR are last week\'s — the last NON-EMPTY week: an empty week between (%s) is skipped', (_name, emptyWeekExercises) => {
    stable()
    mockState.programSets = [pset('p1', 'pe-bench', 1)]
    const weekAt = (n: number, weight: number, rir: number) => plan(n, [BENCH], [wset(`w${n}`, 'pe-bench', 1, { targetWeight: weight, targetRir: rir })])
    const history = [weekAt(2, 100, 2), plan(3, emptyWeekExercises, [])]

    mockState.all = [...history, weekAt(4, 100, 2)]
    renderPlan(4)
    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null }) // against week 2 — an empty week is no source
    cleanup()

    mockState.all = [...history, weekAt(4, 105, 1)]
    renderPlan(4)
    expect(markedCells('01')).toEqual({ weight: 'changed', reps: null, rir: 'changed' })
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

  it('a rep target that differs from the copy\'s is highlighted; an exercise the copy has and week 1 doesn\'t leaves no line (STRUCTURE\'s, gone)', () => {
    copy()
    // Week 1: Bench Press only (Row dropped), 5 reps where the run's copy says 8.
    mockState.all = [plan(1, [BENCH], [wset('b1', 'pe-bench', 1, { repMin: 5, repMax: 5 })])]
    renderPlan(1)

    expect(markedCells('01')).toEqual({ weight: null, reps: 'changed', rir: null })
    expect(removedLines()).toHaveLength(0)
    expect(screen.queryByText('Row')).toBeNull()
  })

  it('week 1\'s weights and RIR are never marked, whatever they are — on a set the copy lacks just as on one it has', () => {
    copy()
    mockState.all = [plan(1, [BENCH], [wset('b1', 'pe-bench', 1, { repMin: 8, repMax: 8, targetWeight: 999, targetRir: 0 }), wset('b2', 'pe-bench', 2, { targetWeight: 1, targetRir: null })])]
    renderPlan(1)
    // Set 1 matches the copy's, and its 999 kg / RIR 0 are not marked.
    expect(markedCells('01')).toEqual({ weight: null, reps: null, rir: null })
    // Set 2 is a set the copy doesn't have: its number and its reps are marked (new against the copy) — its weight and RIR are NOT.
    expect(mark(wholeRow('02'))).toBe('added')
    expect(inAccent(screen.getByText('02'))).toBe(true)
    expect(markedCells('02')).toEqual({ weight: null, reps: 'changed', rir: null })
    expect(inAccent(cellsOf(rowOf('02')).reps)).toBe(true)
    expect(inAccent(cellsOf(rowOf('02')).weight)).toBe(false)
    expect(inAccent(cellsOf(rowOf('02')).rir)).toBe(false)
  })

  it('week 1: the stages of a set the copy lacks carry that set\'s reps mark, and no weight or RIR mark', () => {
    copy()
    const staged = [wset('h', 'pe-bench', 2, { stageKind: 'dropset' }), stageOf('hs1', 'h', 'pe-bench', 1), stageOf('hs2', 'h', 'pe-bench', 2)]
    mockState.all = [plan(1, [BENCH], [wset('b1', 'pe-bench', 1), ...staged])]
    renderPlan(1)
    expect(markedCells('02')).toEqual({ weight: null, reps: 'changed', rir: null })
    const stageRows = screen.getAllByText('↳').map((arrow) => arrow.parentElement as HTMLElement)
    expect(stageRows).toHaveLength(2)
    for (const row of stageRows) {
      const c = cellsOf(row)
      expect([mark(c.weight), mark(c.reps), mark(c.rir)]).toEqual([null, 'changed', null])
    }
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

  it('an empty run copy: week 1 has nothing to be compared with, so it marks nothing (the exercise being new was STRUCTURE\'s mark, gone in chunk 54a)', () => {
    mockState.runCopy = { 'wd-1': [] }
    mockState.all = [plan(1, [BENCH], workSets('pe-bench', 'b1-', 1))]
    renderPlan(1)
    expect(screen.getByText('Bench Press')).toBeTruthy()
    expect(allMarks()).toHaveLength(0)
    expect(programSetReads.filter((ids) => ids.length === 0)).toHaveLength(0) // nothing to read for an empty copy
  })
})

describe('PlanPage — a week that started empty is compared with nothing (provisional 84)', () => {
  const weeks = () => [
    plan(2, [BENCH], workSets('pe-bench', 'w2-', 3)),
    // Week 3, filled by hand: different in every number, with two sets fewer.
    plan(3, [BENCH], [wset('b3', 'pe-bench', 1, { targetWeight: 50, repMin: 15, repMax: 15, targetRir: 4 })]),
  ]

  it('NEW WEEK STARTS = empty: week 3 of a week-dependent run shows no highlighting', () => {
    useSettingsStore.setState({ weekStart: 'empty' })
    mockState.all = weeks()
    renderPlan(3)
    expect(screen.getByText('Bench Press')).toBeTruthy()
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
  })

  it('control: the same weeks with NEW WEEK STARTS = copy are compared with week 2', () => {
    mockState.all = weeks()
    renderPlan(3)
    expect(markedCells('01')).toEqual({ weight: 'changed', reps: 'changed', rir: 'changed' })
    expect(removedLines().map((r) => r.textContent)).toEqual(['02105kg × 8  RIR 2', '03110kg × 8  RIR 2'])
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
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Never highlighted
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage — what is never highlighted', () => {
  it('a deload session shows no highlighting (it differs by design)', () => {
    mockState.all = [
      plan(4, [BENCH, ROW], [...workSets('pe-bench', 'b4-', 3), wset('r4', 'pe-row', 1)]),
      plan(5, [SQUAT, BENCH].map((p, i) => withPosition(p, i)), workSets('pe-bench', 'b5-', 1, () => ({ targetWeight: 60, repMin: 12, repMax: 12 })).concat(wset('q5', 'pe-squat', 1)), { isDeload: true }),
    ]
    renderPlan(5)
    expect(screen.getByLabelText('Unmark this session as deload')).toBeTruthy() // the session is the deload one
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

  it('a week with one deload session: the normal session is compared as usual, and only the deload session shows nothing', () => {
    mockState.program = makeProgram({ schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1', thursday: 'wd-b' } })
    mockState.days = [workoutDay, workoutDayB]
    const pullRow = pe('pe-pull', EX_ROW, 0, {}, 'wd-b')
    mockState.all = [
      // Week 4: Push 100 kg (normal); Pull 40 kg, a deload session. Week 5: Push 105 kg (a change); Pull 30 kg, a deload session again.
      plan(4, [BENCH], [wset('b4', 'pe-bench', 1, { targetWeight: 100 })]),
      plan(4, [pullRow], [wset('p4', 'pe-pull', 1, { targetWeight: 40 })], { workoutDayId: 'wd-b', isDeload: true }),
      plan(5, [BENCH], [wset('b5', 'pe-bench', 1, { targetWeight: 105 })]),
      plan(5, [pullRow], [wset('p5', 'pe-pull', 1, { targetWeight: 30 })], { workoutDayId: 'wd-b', isDeload: true }),
    ]
    renderPlan(5)

    // Push is a normal session: its change is marked, against week 4's Push (a normal session, although Pull is a deload one that week).
    expect(screen.queryByLabelText('Unmark this session as deload')).toBeNull()
    expect(markedCells('01')).toEqual({ weight: 'changed', reps: null, rir: null })
    expect(allMarks()).toHaveLength(1)
    // Pull is the deload session: it shows nothing.
    fireEvent.click(screen.getByText('THU'))
    expect(screen.getByLabelText('Unmark this session as deload')).toBeTruthy()
    expect(screen.getByText('Row')).toBeTruthy()
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
  })

  it('a tag added this week is not highlighted — it is shown as a tag, as always', () => {
    mockState.all = [
      plan(4, [BENCH], workSets('pe-bench', 'b4-', 2)),
      plan(5, [BENCH], workSets('pe-bench', 'b5-', 2, (n) => (n === 2 ? { tags: ['push here', 'custom'] } : {}))),
    ]
    renderPlan(5)
    expect(screen.getByText('Push here')).toBeTruthy() // the cue's label, as a chip under its set's row
    expect(screen.getByText('Custom')).toBeTruthy()
    expect(allMarks()).toHaveLength(0)
    expect(allRemoved()).toHaveLength(0)
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
    expect(allRemoved()).toHaveLength(0)
  })

  it('weights are compared as stored: the unit an exercise is shown in neither causes nor hides a difference', () => {
    const lbs = pe('pe-bench', EX_BENCH, 0, { weightUnit: 'lbs' })
    mockState.all = [plan(4, [BENCH], [wset('b4', 'pe-bench', 1, { targetWeight: 100 })]), plan(5, [lbs], [wset('b5', 'pe-bench', 1, { targetWeight: 100 })])]
    renderPlan(5)
    expect(markedCells('01').weight).toBeNull()
    expect(screen.getByRole('button', { name: '220.5lbs' })).toBeTruthy() // shown in lbs, still the same 100 kg
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
  const slotPlan = (cycle: number, position: number, weight: number, reps = 8) => {
    const workoutDayId = position === 1 ? 'wd-b' : 'wd-1'
    const row = position === 1 ? B_ROW : A_ROW
    return plan(cycle, [row], [wset(`s${cycle}-${position}`, row.id, 1, { targetWeight: weight, repMin: reps, repMax: reps })], { workoutDayId, sequencePosition: position })
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
    openWeekTile('CYCLE 2')
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

  it('cycle 1 is compared with the run\'s copy of each slot\'s OWN workout: the two A slots with A\'s copy, B with B\'s', () => {
    mockState.program = makeProgram({ scheduleType: 'sequence', schedule: EMPTY_SCHEDULE })
    mockState.days = [workoutDay, workoutDayB]
    mockState.sequenceItems = items
    // A's copy says 8 reps; B's says 12.
    mockState.runCopy = { 'wd-1': [A_ROW], 'wd-b': [B_ROW] }
    mockState.programSets = [pset('pa', 'pe-a', 1, { repMin: 8, repMax: 8 }), pset('pb', 'pe-b', 1, { repMin: 12, repMax: 12 })]
    // Slot 1 (A): 5 reps. Slot 2 (B): 12 reps (as its copy). Slot 3 (A): 8 reps (as its copy).
    mockState.all = [slotPlan(1, 0, 100, 5), slotPlan(1, 1, 80, 12), slotPlan(1, 2, 120, 8)]
    renderPlan(1)

    expect(screen.getByText('CYCLE 1')).toBeTruthy()
    expect(markedCells('01').reps).toBe('changed') // slot 1: 5 against A's 8
    fireEvent.click(screen.getByText('SLOT 2'))
    expect(markedCells('01').reps).toBeNull() // slot 2 (B): 12 against B's 12 (A's 8 would differ)
    fireEvent.click(screen.getByText('SLOT 3'))
    expect(markedCells('01').reps).toBeNull() // slot 3 (A): 8 against A's 8
    // Each workout's own copy was read, for its own rows.
    expect(programSetReads).toContainEqual(['pe-a'])
    expect(programSetReads).toContainEqual(['pe-b'])
  })

  it('a different workout in between does not interfere (slot 2 is workout B, compared with B\'s own slot)', () => {
    arrangeSequence({ a0: 100, a2: 120 })
    fireEvent.click(screen.getByText('SLOT 2'))
    expect(screen.getByText('Row')).toBeTruthy()
    expect(markedCells('01').weight).toBeNull() // 80 = 80
  })
})

describe('PlanPage — past weeks highlight too, compared as they are now', () => {
  it('a past week read-only: its differences from the week before it are marked (cells disabled); a kind change leaves no dot (STRUCTURE\'s, gone)', () => {
    const staged = (kind: WeekPlanSet['stageKind']) => [wset('h', 'pe-bench', 1, { stageKind: kind }), stageOf('hs', 'h', 'pe-bench', 1)]
    mockState.all = [
      plan(2, [BENCH], staged('dropset')),
      plan(3, [BENCH], [...staged('rest_pause').map((s) => (s.id === 'h' ? { ...s, targetWeight: 105 } : s))]),
      plan(5, [BENCH], staged('dropset')),
    ]
    renderPlan(5)
    openWeekTile('WEEK 3')
    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()

    const cells = cellsOf(rowOf('01'))
    expect(mark(cells.weight)).toBe('changed')
    expect((cells.weight as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByLabelText('Options for set 1')).toBeNull() // read-only: no ⋯ ...
    expect(document.querySelectorAll('[data-diff="kind"]')).toHaveLength(0) // ... and no dot where it would be
    expect(screen.getByText('REST-PAUSE · 1 PAUSE')).toBeTruthy() // the kind is there, unmarked
  })

  it('a past week is compared with the weeks before it, never the ones after it', () => {
    mockState.all = [
      plan(1, [BENCH], [wset('w1', 'pe-bench', 1, { targetWeight: 100 })]),
      plan(2, [BENCH], [wset('w2', 'pe-bench', 1, { targetWeight: 110 })]),
      plan(3, [BENCH], [wset('w3', 'pe-bench', 1, { targetWeight: 120 })]),
      plan(5, [BENCH], [wset('w5', 'pe-bench', 1, { targetWeight: 130 })]),
    ]
    renderPlan(5)
    openWeekTile('WEEK 3') // (week 4 was never planned: a tile that draws no weights)
    expect(markedCells('01').weight).toBe('changed') // 120 against week 2's 110 (week 5's 130 is no source of it)
    openWeekTile('WEEK 2')
    expect(markedCells('01').weight).toBe('changed') // 110 against week 1's 100
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Several workouts, and the page itself
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage — a week with nothing to flag renders exactly what it did before the highlighting', () => {
  it('a week identical to its source is the very same markup as a week compared with nothing (no attribute, no style, no element is added)', () => {
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
    // The tile strip is taken out of both: which weeks have a plan decides its tiles (week 4 is DONE in one render and NOT PLANNED in
    // the other, by construction), and it is the header's, not the week panel's whose markup this compares.
    const htmlOf = (container: HTMLElement) => {
      const strip = container.querySelector('[aria-label="Weeks of this program"]')
      return strip ? container.innerHTML.replace(strip.outerHTML, '') : container.innerHTML
    }
    const markup = (withSource: boolean) => {
      mockState.all = withSource ? [plan(4, rows, sets('4')), plan(5, rows, sets('5'))] : [plan(5, rows, sets('5'))]
      const { container } = renderPlan(5)
      const html = htmlOf(container)
      cleanup()
      return html
    }
    const compared = markup(true)
    const alone = markup(false)
    expect(compared).toBe(alone)
    expect(compared).toContain('Bench Press')
    expect(compared).toContain('REST-PAUSE · 1 PAUSE')
    expect(compared).not.toContain('data-diff')
    expect(compared).not.toContain('<del')

    // The control: against a source that differs, the same week's markup does change (so the equality above means something).
    mockState.all = [plan(4, rows, sets('4').map((s) => (s.id === 'h4' ? { ...s, targetWeight: 90 } : s))), plan(5, rows, sets('5'))]
    const { container } = renderPlan(5)
    expect(htmlOf(container)).not.toBe(alone)
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
    openWeekTile('WEEK 6')
    expect(screen.getByText('WEEK 6')).toBeTruthy()
    expect(markedCells('01').weight).toBeNull() // 105 = week 5's 105
  })
})
