// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise, MuscleGroup } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import type { ChangeRecord } from './applyAhead'

// Chunk 29 (TASKS-1.1 "Plan shows one week in two views"; SPEC Plan screen
// [P1.1], G16/G17; the standing UI rule). The week panel has a SETS view and a
// STRUCTURE view behind a switch that is the WEEKS/PROGRAM bar's own pattern.
//
//   SETS       the `+` ADD SET; each set row's weight, reps and RIR (a stage's
//              too; a warmup's without RIR); tag markers; a set's ⋯ with its
//              tags and, on a working set, DELETE SET.
//   STRUCTURE  the exercise ⋯ (swap, move up/down, add warmup sets, remove);
//              ADD EXERCISE; each set's kind: a working set's ADD STAGE and
//              STAGE KIND, a stage's DELETE STAGE, a warmup's DELETE SET.
//   Above both the per-session DELOAD toggle, the apply-ahead banner and COPY
//   THIS WORKOUT (and, above the panel, COPY WEEK / MARK WEEK AS DELOAD).
//   COMPACT is gone.
//
// Every expected argument below is what MASTER's PlanPage hands the same
// mutation for the same tap (f5fe217, before this chunk): they were recorded by
// driving master's tree and this one through one characterization (30 flows:
// every moved control, plus the apply-ahead record each one offers) and
// diffing the two; the files were byte-identical. Past weeks are read-only in
// both views; the sequence run's cycle gates are walked in both views by
// PlanPage.sequenceCycle.test.tsx.
//
// Renders the real PlanPage tree; only the data hooks are mocked (the seam
// every PlanPage test file uses). Checked at 375px (window.innerWidth).

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// ─── Fixture ──────────────────────────────────────────────────────────────────

// A meso that started a week ago, so the viewed (current) week is week 2.
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
const EX_NEW = ex('ex-new', 'Incline Press', 'chest')
const EX_LUNGE = ex('ex-lunge', 'Lunge', 'quads')

const pe = (id: string, exercise: Exercise, position: number, workoutDayId = 'wd-1'): ProgramExercise => ({
  id, workoutDayId, userId: 'user-1', exerciseId: exercise.id, position, weightUnit: null, exercise,
})
const pe1 = pe('pe-1', EX_BENCH, 0)
const pe2 = pe('pe-2', EX_SQUAT, 1)

function setRow(over: Partial<WeekPlanSet>): WeekPlanSet {
  return {
    id: 'x', weekPlanId: 'wp-2', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 2,
    isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null, ...over,
  }
}

// Bench Press: a warmup (set 1), a staged working set (2: weight 100, 8–12 reps,
// RIR 2, with two stages), a tagged working set (3). Squat: one working set.
const SETS: WeekPlanSet[] = [
  setRow({ id: 'warm', setNumber: 1, isWarmup: true, targetRir: null, targetWeight: 40, repMin: 10, repMax: 10 }),
  setRow({ id: 'work', setNumber: 2, targetWeight: 100, repMin: 8, repMax: 12, targetRir: 2 }),
  setRow({ id: 'stage1', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'work', stageIndex: 1, targetWeight: 80, repMin: 6, repMax: 6, targetRir: 1 }),
  setRow({ id: 'stage2', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'work', stageIndex: 2, targetWeight: 60, repMin: 6, repMax: 6, targetRir: 0 }),
  setRow({ id: 'tagged', setNumber: 3, targetWeight: 100, repMin: 8, repMax: 8, targetRir: 3, tags: ['push here'] }),
  setRow({ id: 'sq1', programExerciseId: 'pe-2', setNumber: 1, targetWeight: 120, repMin: 5, repMax: 5, targetRir: 2 }),
]

function plan(weekNumber: number, sets: WeekPlanSet[], exercises: ProgramExercise[], workoutDayId = 'wd-1'): WeekPlan {
  return {
    id: workoutDayId === 'wd-1' ? `wp-${weekNumber}` : `wp-${weekNumber}-${workoutDayId}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId, weekNumber,
    isDeload: false, notes: null, sets, exercises, createdAt: '2026-01-01T00:00:00Z',
  }
}

function makeProgram(schedule: Program['schedule'] = { ...EMPTY_SCHEDULE, monday: 'wd-1' }): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule, workoutDays: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent',
  }
}

const mockState: { all: WeekPlan[]; program: Program; days: WorkoutDay[]; meso: Mesocycle } = {
  all: [], program: makeProgram(), days: [workoutDay], meso: activeMeso,
}

const addSetMutate = vi.fn()
const addStageMutate = vi.fn()
const addWarmupMutate = vi.fn()
const updateSetMutate = vi.fn()
const removeSetMutate = vi.fn()
const swapMutate = vi.fn().mockResolvedValue({ id: 'swap-result-row' })
const addExerciseMutate = vi.fn()
const removeExerciseMutate = vi.fn()
const reorderMutate = vi.fn()
const copyWorkoutMutate = vi.fn()
const copyWeekMutate = vi.fn()
const setDeloadMutate = vi.fn()
let applyAheadLast: { changes: ChangeRecord[]; weeks: WeekPlan[] } | null = null
const applyAheadMutate = vi.fn((vars: { changes: ChangeRecord[]; weeks: WeekPlan[] }) => {
  applyAheadLast = vars
})

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [mockState.meso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  ...(await import('./structureHooks.testutil')).quietProgramsHooks,
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: mockState.days, isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
// Chunk 30: the STRUCTURE view's run-wide fields call these hooks (StructureFields.tsx); this
// file's tests open the view for other reasons, so they get quiet stand-ins (no program sets).
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./structureHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [EX_NEW] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: mockState.all.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.all, isLoading: false }),
  useApplyAhead: () => ({ mutate: applyAheadMutate, isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: setDeloadMutate }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: addSetMutate, isPending: false }),
  useAddStage: () => ({ mutate: addStageMutate }),
  useAddWarmupSet: () => ({ mutate: addWarmupMutate, isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: removeSetMutate, isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: copyWeekMutate, isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: copyWorkoutMutate, isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: swapMutate, isPending: false }),
  useAddWeekExercise: () => ({ mutate: addExerciseMutate, isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: removeExerciseMutate, isPending: false }),
  useReorderWeekExercises: () => ({ mutate: reorderMutate, isPending: false }),
}))
// MoveSessionControl owns its own session reads (every PlanPage test stubs it), so it is stubbed here too, but
// with a stand-in that RENDERS: an empty element (no text, so no text assertion sees it) carrying its props as
// attributes. A test can then see whether Plan renders it, where, and what it hands it.
vi.mock('./MoveSessionControl', () => ({
  default: (props: { workoutDay: { id: string }; weekPlan?: { id: string }; mesoId: string; date: string; isCurrentWeek: boolean }) => (
    <div
      data-testid="move-session-stub"
      data-workout={props.workoutDay.id}
      data-plan={props.weekPlan?.id ?? ''}
      data-meso={props.mesoId}
      data-date={props.date}
      data-current={String(props.isCurrentWeek)}
    />
  ),
}))

const { default: PlanPage } = await import('./PlanPage')
const { openSetsView, openStructureView, openExerciseMenu, openStageMenu } = await import('./planMenus.testutil')

afterEach(() => {
  for (const m of [addSetMutate, addStageMutate, addWarmupMutate, updateSetMutate, removeSetMutate, addExerciseMutate, removeExerciseMutate, reorderMutate, copyWorkoutMutate, copyWeekMutate, setDeloadMutate, applyAheadMutate]) m.mockClear()
  swapMutate.mockReset().mockResolvedValue({ id: 'swap-result-row' })
  applyAheadLast = null
  mockState.program = makeProgram()
  mockState.days = [workoutDay]
  mockState.meso = activeMeso
})

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

// Week 2 (viewed) has the sets above; week 3 is planned (so an edit is offered ahead).
function arrange() {
  mockState.all = [plan(2, SETS, [pe1, pe2]), plan(3, [], [])]
  return renderPlanPage()
}

// Two exercises can both have a "set 1", so the set ⋯ is found among all of them (Bench Press comes first).
const openSetMenu = (setNumber: number) => fireEvent.click(screen.getAllByLabelText(`Options for set ${setNumber}`)[0])
const rowOf = (numberText: string, index = 0) => screen.getAllByText(numberText)[index].parentElement as HTMLElement
const buttonsOf = (row: HTMLElement) => Array.from(row.querySelectorAll('button'))
const squash = (text: string | null) => (text ?? '').replace(/\s/g, '')
const MINUS = '−'

function expectBefore(a: HTMLElement, b: HTMLElement) {
  expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

async function applyAheadChanges(): Promise<ChangeRecord[]> {
  await act(async () => {
    fireEvent.click(screen.getByText('APPLY'))
  })
  return applyAheadLast?.changes ?? []
}

// ─── The switch ───────────────────────────────────────────────────────────────

describe('PlanPage — the SETS / STRUCTURE switch', () => {
  it('opens on SETS; the switch is the WEEKS/PROGRAM bar\'s own markup, so it adds no new visual language', () => {
    arrange()

    const sets = screen.getByText('SETS')
    const structure = screen.getByText('STRUCTURE')
    const weeks = screen.getByText('WEEKS')
    const program = screen.getByText('PROGRAM')

    // SETS is showing: its `+` is on the page, the exercise ⋯ is not.
    expect(sets.style.background).toBe('var(--accent)')
    expect(structure.style.background).toBe('var(--surface)')
    expect(screen.getByLabelText('Add set to Bench Press')).toBeTruthy()
    expect(screen.queryByLabelText('Bench Press options')).toBeNull()

    // The same buttons, style for style: the active one and the idle one.
    expect(sets.style.cssText).toBe(weeks.style.cssText)
    expect(structure.style.cssText).toBe(program.style.cssText)
    // ... in the same container, whose only difference is where its margin is.
    const strip = (el: HTMLElement) => {
      const c = el.cloneNode(false) as HTMLElement
      c.style.removeProperty('margin-top')
      c.style.removeProperty('margin-bottom')
      return c.style.cssText
    }
    expect(strip(sets.parentElement as HTMLElement)).toBe(strip(weeks.parentElement as HTMLElement))

    // Tapping STRUCTURE moves the fill, and the page.
    openStructureView()
    expect(screen.getByText('STRUCTURE').style.background).toBe('var(--accent)')
    expect(screen.getByText('SETS').style.background).toBe('var(--surface)')
    expect(screen.getByLabelText('Bench Press options')).toBeTruthy()
    expect(screen.queryByLabelText('Add set to Bench Press')).toBeNull()
  })

  it('the view you chose stays when you step to another week or switch workout (a display-only choice, provisional)', () => {
    mockState.program = makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1', thursday: 'wd-2' })
    mockState.days = [workoutDay, workoutDay2]
    const lunge = pe('pe-l', EX_LUNGE, 0, 'wd-2')
    mockState.all = [
      plan(2, SETS, [pe1, pe2]), plan(2, [], [lunge], 'wd-2'),
      plan(3, SETS, [pe1, pe2]), plan(3, [], [lunge], 'wd-2'),
    ]
    renderPlanPage()
    expect(screen.getByText('WEEK 2')).toBeTruthy()

    openStructureView()
    fireEvent.click(screen.getByLabelText('Next week'))
    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.getByText('STRUCTURE').style.background).toBe('var(--accent)')
    expect(screen.getByLabelText('Bench Press options')).toBeTruthy()

    fireEvent.click(screen.getByText('THU'))
    expect(screen.getByText('STRUCTURE').style.background).toBe('var(--accent)')
    expect(screen.getByLabelText('Lunge options')).toBeTruthy()
    expect(screen.queryByLabelText('Add set to Lunge')).toBeNull()

    // ... and the same the other way round.
    openSetsView()
    fireEvent.click(screen.getByText('MON'))
    fireEvent.click(screen.getByLabelText('Previous week'))
    expect(screen.getByText('SETS').style.background).toBe('var(--accent)')
    expect(screen.getByLabelText('Add set to Bench Press')).toBeTruthy()
  })

  it('switching views closes every open ⋯ menu: nothing from one view is carried into the other', () => {
    arrange()

    openStructureView()
    openExerciseMenu('Bench Press')
    openSetMenu(2)
    expect(screen.getByLabelText('Swap Bench Press')).toBeTruthy()
    expect(screen.getByLabelText('Add stage')).toBeTruthy()
    openSetsView()
    openStructureView()
    expect(screen.queryByLabelText('Swap Bench Press')).toBeNull()
    expect(screen.queryByLabelText('Add stage')).toBeNull()

    openSetsView()
    openSetMenu(3)
    expect(screen.getByText('TAGS')).toBeTruthy()
    openStructureView()
    openSetsView()
    expect(screen.queryByText('TAGS')).toBeNull()
  })

  it('COMPACT is absent in both views: no toggle, and no REMOVE LAST SET it carried', () => {
    const { container } = arrange()

    for (const open of [openSetsView, openStructureView]) {
      open()
      expect(screen.queryByText('COMPACT')).toBeNull()
      expect(screen.queryByText(/compact/i)).toBeNull()
      expect(screen.queryByLabelText('Remove last set')).toBeNull()
      expect((container.textContent ?? '').toLowerCase()).not.toContain('compact')
    }
  })
})

// ─── SETS ─────────────────────────────────────────────────────────────────────

describe('PlanPage — SETS view', () => {
  it('a working set row shows number, weight, reps and RIR; its ⋯ offers tags and DELETE SET, and no ADD STAGE / STAGE KIND', () => {
    arrange()

    // Set 2 (a staged working set): number 02, 100kg, 8–12 reps, RIR 2, and a ⋯.
    const menuButton = screen.getAllByLabelText('Options for set 2')[0]
    const row = menuButton.parentElement as HTMLElement
    expect(squash(row.textContent)).toBe(squash('02100kg × 8–12 − RIR 2 +'))
    expect(buttonsOf(row)).toHaveLength(5) // weight, reps, RIR −, RIR +, ⋯

    fireEvent.click(menuButton)
    expect(screen.getByText('TAGS')).toBeTruthy()
    expect(screen.getByLabelText('Delete set')).toBeTruthy()
    // The set's kind is the other view's (absence, Checks that lied #32).
    expect(screen.queryByLabelText('Add stage')).toBeNull()
    expect(screen.queryByText('ADD STAGE')).toBeNull()
    expect(screen.queryByText('STAGE KIND')).toBeNull()
    // (the head's own DROPSET is a marker, not a button; no chip row is in the menu)
    for (const kind of ['DROPSET', 'REST-PAUSE', 'MYO-REPS', 'CLUSTER']) {
      expect(screen.queryByRole('button', { name: kind })).toBeNull()
    }
  })

  it('shows the kind marker on a staged or warmup head and the tag chip on a tagged one — and nothing on a plain set', () => {
    arrange()
    expect(screen.getAllByText('WARMUP')).toHaveLength(1)
    expect(screen.getAllByText('DROPSET')).toHaveLength(1)
    expect(screen.getAllByText('push here')).toHaveLength(1) // set 3's tag marker; no menu is open
    expect(screen.queryByText('TAGS')).toBeNull()
  })

  it('`+` calls useAddSet with the same arguments as before: the next head number (stages don\'t count), this week\'s plan row', () => {
    arrange()

    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    expect(addSetMutate).toHaveBeenCalledTimes(1)
    // Bench Press has three heads (the warmup, set 2 with its two stages, set 3): the new one is 4.
    expect(addSetMutate).toHaveBeenCalledWith({ workoutDayId: 'wd-1', weekPlanId: 'wp-2', programExerciseId: 'pe-1', setNumber: 4 })

    fireEvent.click(screen.getByLabelText('Add set to Squat'))
    expect(addSetMutate).toHaveBeenLastCalledWith({ workoutDayId: 'wd-1', weekPlanId: 'wp-2', programExerciseId: 'pe-2', setNumber: 2 })
  })

  it('a stage row\'s weight, reps and RIR editors call useUpdateSet with THAT stage\'s id — and it has no ⋯ here', () => {
    arrange()

    const stage1 = rowOf('↳', 0) // the first stage of set 2: 80kg × 6, RIR 1
    const stage2 = rowOf('↳', 1) // 60kg × 6, RIR 0
    expect(squash(stage1.textContent)).toBe(squash('↳80kg × 6 − RIR 1 +'))
    expect(squash(stage2.textContent)).toBe(squash('↳60kg × 6 − RIR 0 +'))
    expect(within(stage1).queryByLabelText(/^Options for /)).toBeNull()
    expect(screen.queryAllByLabelText('Options for stage')).toHaveLength(0)

    // weight
    fireEvent.click(within(stage1).getByRole('button', { name: '80kg' }))
    fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '85' } })
    fireEvent.blur(screen.getByLabelText('Weight target'))
    expect(updateSetMutate).toHaveBeenLastCalledWith({ id: 'stage1', changes: { targetWeight: 85 } })
    // reps
    fireEvent.click(within(stage1).getByRole('button', { name: '6' }))
    fireEvent.change(screen.getByLabelText('Rep target'), { target: { value: '8-10' } })
    fireEvent.blur(screen.getByLabelText('Rep target'))
    expect(updateSetMutate).toHaveBeenLastCalledWith({ id: 'stage1', changes: { repMin: 8, repMax: 10, isAmrap: false } })
    // RIR, on each stage: its own id, never the head's
    fireEvent.click(within(stage2).getByRole('button', { name: '+' }))
    expect(updateSetMutate).toHaveBeenLastCalledWith({ id: 'stage2', changes: { targetRir: 1 } })
    fireEvent.click(within(stage1).getByRole('button', { name: MINUS }))
    expect(updateSetMutate).toHaveBeenLastCalledWith({ id: 'stage1', changes: { targetRir: 0 } })
    expect(updateSetMutate).toHaveBeenCalledTimes(4)
  })

  it('a warmup set shows its numbers and no RIR stepper; its ⋯ offers tags only — its DELETE is the STRUCTURE view\'s', () => {
    arrange()

    const warmupRow = rowOf('01', 0)
    expect(squash(warmupRow.textContent)).toBe(squash('0140kg × 10'))
    expect(within(warmupRow).queryByText(/RIR/)).toBeNull()
    expect(within(warmupRow).queryByRole('button', { name: '+' })).toBeNull()
    expect(within(warmupRow).queryByRole('button', { name: MINUS })).toBeNull()

    // Its weight and reps edit the warmup's own set.
    fireEvent.click(within(warmupRow).getByRole('button', { name: '40kg' }))
    fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '45' } })
    fireEvent.blur(screen.getByLabelText('Weight target'))
    expect(updateSetMutate).toHaveBeenLastCalledWith({ id: 'warm', changes: { targetWeight: 45 } })

    fireEvent.click(within(warmupRow).getByLabelText('Options for set 1'))
    expect(screen.getByText('TAGS')).toBeTruthy()
    expect(screen.queryByLabelText('Delete set')).toBeNull()
    expect(screen.queryByText('DELETE SET')).toBeNull()
  })

  // A head that has stages is still ONE set: its tags are its own. (Independent-review break T2: the tags editor
  // writing to `stages[0]?.id ?? head.id` passed every test, because every tagged fixture head had no stages.)
  it('a tag written on a head that HAS stages is that head\'s own, never a stage\'s: preset and custom, each offered ahead as the head\'s tags', async () => {
    arrange() // set 2 ('work') has two stages and no tags

    openSetMenu(2)
    fireEvent.click(screen.getByRole('button', { name: 'push here' }))
    expect(updateSetMutate).toHaveBeenLastCalledWith({ id: 'work', changes: { tags: ['push here'] } })
    fireEvent.click(screen.getByText('+ CUSTOM'))
    fireEvent.change(screen.getByLabelText('Custom tag'), { target: { value: 'heavy day' } })
    fireEvent.blur(screen.getByLabelText('Custom tag'))
    expect(updateSetMutate).toHaveBeenLastCalledWith({ id: 'work', changes: { tags: ['heavy day'] } })
    // Two writes, both to the head: neither stage was touched.
    expect(updateSetMutate.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['work', 'work'])
    // The offer ahead is the head's tags record (a stage has no tags record at all).
    expect(await applyAheadChanges()).toEqual([
      { editType: 'tags', slotId: 'pe-1', exerciseId: 'ex-bench', setPosition: { headOrdinal: 2, stageIndex: null }, oldValue: null, newValue: ['heavy day'] },
    ])
  })

  it('removing the last tag from a head that has stages writes the head, collapsing to null', () => {
    mockState.all = [plan(2, SETS.map((row) => (row.id === 'work' ? { ...row, tags: ['push here'] } : row)), [pe1, pe2]), plan(3, [], [])]
    renderPlanPage()

    openSetMenu(2)
    fireEvent.click(screen.getByRole('button', { name: 'push here' }))
    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    expect(updateSetMutate).toHaveBeenCalledWith({ id: 'work', changes: { tags: null } })
  })

  it('has none of the STRUCTURE view\'s controls: no exercise ⋯, no ADD EXERCISE, no ADD WARMUP SETS, no stage or kind controls', () => {
    arrange()

    expect(screen.queryByLabelText(/ options$/)).toBeNull()
    expect(screen.queryByText('ADD EXERCISE')).toBeNull()
    expect(screen.queryByLabelText('Add warmup sets')).toBeNull()
    expect(screen.queryByText('ADD WARMUP SETS')).toBeNull()
    // Open every set menu there is: none of them holds a kind control or a warmup's DELETE.
    for (const label of screen.getAllByLabelText(/^Options for set /)) {
      fireEvent.click(label)
    }
    expect(screen.queryByLabelText('Add stage')).toBeNull()
    expect(screen.queryByText('STAGE KIND')).toBeNull()
    expect(screen.queryByLabelText('Delete stage')).toBeNull()
    // Four working/warmup heads are open: DELETE SET is on the three working ones, not the warmup.
    expect(screen.getAllByLabelText('Delete set')).toHaveLength(3)
  })
})

// ─── STRUCTURE ────────────────────────────────────────────────────────────────

describe('PlanPage — STRUCTURE view', () => {
  it('each exercise ⋯ action calls the same mutation with the same arguments as on master', async () => {
    arrange()
    openStructureView()

    // SWAP EXERCISE -> the picker -> swapWeekExercise
    openExerciseMenu('Bench Press')
    fireEvent.click(screen.getByLabelText('Swap Bench Press'))
    await act(async () => {
      fireEvent.click(screen.getByText('Incline Press'))
    })
    expect(swapMutate).toHaveBeenCalledWith({ weekPlanId: 'wp-2', programExerciseId: 'pe-1', replacementExerciseId: 'ex-new' })

    // MOVE UP / MOVE DOWN -> reorderWeekExercises (both exercises' positions, in one call)
    const swapped = { weekPlanId: 'wp-2', moves: [{ programExerciseId: 'pe-1', oldPosition: 0, newPosition: 1 }, { programExerciseId: 'pe-2', oldPosition: 1, newPosition: 0 }] }
    openExerciseMenu('Squat')
    fireEvent.click(screen.getByLabelText('Move up'))
    expect(reorderMutate).toHaveBeenLastCalledWith(swapped)
    openExerciseMenu('Bench Press')
    fireEvent.click(screen.getByLabelText('Move down'))
    expect(reorderMutate).toHaveBeenLastCalledWith(swapped)
    expect(reorderMutate).toHaveBeenCalledTimes(2)

    // ADD WARMUP SETS -> addWarmupSet
    openExerciseMenu('Squat')
    fireEvent.click(screen.getByLabelText('Add warmup sets'))
    expect(addWarmupMutate).toHaveBeenCalledWith({ workoutDayId: 'wd-1', weekPlanId: 'wp-2', programExerciseId: 'pe-2' })

    // REMOVE FROM THIS WEEK -> confirm -> removeWeekExercise
    openExerciseMenu('Bench Press')
    fireEvent.click(screen.getByLabelText('Remove Bench Press from this week'))
    expect(removeExerciseMutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('REMOVE'))
    expect(removeExerciseMutate).toHaveBeenCalledWith({ weekPlanId: 'wp-2', programExerciseId: 'pe-1' })

    // ADD EXERCISE -> the picker -> addWeekExercise (at the next position)
    fireEvent.click(screen.getByText('ADD EXERCISE'))
    fireEvent.click(screen.getByText('Incline Press'))
    expect(addExerciseMutate).toHaveBeenCalledWith({ weekPlanId: 'wp-2', workoutDayId: 'wd-1', exerciseId: 'ex-new', position: 2 })
  })

  it('each kind control calls the same mutation with the same arguments as on master', () => {
    arrange()
    openStructureView()

    // ADD STAGE on a plain working set: its first stage
    openSetMenu(3)
    fireEvent.click(screen.getByLabelText('Add stage'))
    expect(addStageMutate).toHaveBeenLastCalledWith({ weekPlanId: 'wp-2', programExerciseId: 'pe-1', parentId: 'tagged', setNumber: 3, stageIndex: 1 })
    openSetMenu(3) // close it (ADD STAGE leaves the menu open)

    // ADD STAGE on a staged one: after the highest stage index there is
    openSetMenu(2)
    fireEvent.click(screen.getByLabelText('Add stage'))
    expect(addStageMutate).toHaveBeenLastCalledWith({ weekPlanId: 'wp-2', programExerciseId: 'pe-1', parentId: 'work', setNumber: 2, stageIndex: 3 })
    // ... whose STAGE KIND chips write the head's own stage kind
    fireEvent.click(screen.getByRole('button', { name: 'CLUSTER' }))
    expect(updateSetMutate).toHaveBeenLastCalledWith({ id: 'work', changes: { stageKind: 'cluster' } })
    fireEvent.click(screen.getByRole('button', { name: 'REST-PAUSE' }))
    expect(updateSetMutate).toHaveBeenLastCalledWith({ id: 'work', changes: { stageKind: 'rest_pause' } })
    openSetMenu(2)

    // DELETE STAGE removes that stage's own row
    openStageMenu(0)
    fireEvent.click(screen.getByLabelText('Delete stage'))
    expect(removeSetMutate).toHaveBeenLastCalledWith('stage1')
    openStageMenu(1)
    fireEvent.click(screen.getByLabelText('Delete stage'))
    expect(removeSetMutate).toHaveBeenLastCalledWith('stage2')

    // A warmup set's DELETE removes the warmup
    openSetMenu(1)
    fireEvent.click(screen.getByLabelText('Delete set'))
    expect(removeSetMutate).toHaveBeenLastCalledWith('warm')

    expect(addStageMutate).toHaveBeenCalledTimes(2)
    expect(updateSetMutate).toHaveBeenCalledTimes(2)
    expect(removeSetMutate).toHaveBeenCalledTimes(3)
  })

  it('a working set\'s ⋯ here holds ADD STAGE (and STAGE KIND once staged) — not tags, not DELETE SET; a warmup\'s holds only DELETE', () => {
    arrange()
    openStructureView()

    openSetMenu(3) // plain working set
    expect(screen.getByLabelText('Add stage')).toBeTruthy()
    expect(screen.queryByText('STAGE KIND')).toBeNull() // no stage yet
    expect(screen.queryByText('TAGS')).toBeNull()
    expect(screen.queryByLabelText('Delete set')).toBeNull()
    openSetMenu(3)

    openSetMenu(2) // staged
    expect(screen.getByLabelText('Add stage')).toBeTruthy()
    expect(screen.getByText('STAGE KIND')).toBeTruthy()
    expect(screen.queryByText('TAGS')).toBeNull()
    expect(screen.queryByLabelText('Delete set')).toBeNull()
    openSetMenu(2)

    openSetMenu(1) // the warmup
    expect(screen.getByLabelText('Delete set')).toBeTruthy()
    expect(screen.queryByLabelText('Add stage')).toBeNull() // a warmup is never staged
    expect(screen.queryByText('STAGE KIND')).toBeNull()
    expect(screen.queryByText('TAGS')).toBeNull()
  })

  it('ADD WARMUP SETS and a warmup\'s DELETE are only here', () => {
    arrange()

    // SETS: neither exists.
    expect(screen.queryByLabelText('Add warmup sets')).toBeNull()
    openSetMenu(1)
    expect(screen.queryByLabelText('Delete set')).toBeNull()

    // STRUCTURE: both do.
    openStructureView()
    openExerciseMenu('Bench Press')
    expect(screen.getByLabelText('Add warmup sets')).toBeTruthy()
    openSetMenu(1)
    expect(screen.getByLabelText('Delete set')).toBeTruthy()
  })

  it('the set rows carry kinds, not numbers: a number, its marker and a ⋯ — no weight, reps, RIR, tags or `+`', () => {
    arrange()
    openStructureView()

    const row2 = rowOf('02')
    expect(squash(row2.textContent)).toBe('02')
    expect(buttonsOf(row2)).toHaveLength(1) // the ⋯ alone
    expect(squash(rowOf('01', 0).textContent)).toBe('01') // the warmup
    expect(squash(rowOf('↳', 0).textContent)).toBe('↳')
    // The page has no number from the SETS view anywhere.
    const text = document.body.textContent ?? ''
    for (const gone of ['100kg', '80kg', '40kg', '8–12', 'RIR', 'push here', 'TAGS']) expect(text).not.toContain(gone)
    expect(screen.queryByLabelText(/^Add set to /)).toBeNull()
    expect(screen.queryByRole('button', { name: MINUS })).toBeNull()
    // The kind markers stay: they are what a set's kind looks like.
    expect(screen.getAllByText('WARMUP')).toHaveLength(1)
    expect(screen.getAllByText('DROPSET')).toHaveLength(1)
  })

  it('nothing here is on the page until a ⋯ is opened (the standing UI rule): no swap, move, remove, stage or delete', () => {
    arrange()
    openStructureView()

    const text = document.body.textContent ?? ''
    for (const word of ['SWAP', 'MOVE', 'REMOVE FROM', 'ADD STAGE', 'STAGE KIND', 'DELETE', 'ADD WARMUP']) expect(text).not.toContain(word)
    expect(screen.queryByLabelText(/^Swap /)).toBeNull()
    expect(screen.queryByLabelText('Delete set')).toBeNull()
  })
})

// ─── Page-level actions ───────────────────────────────────────────────────────

describe('PlanPage — page-level actions render above the switch\'s content, in both views (G17)', () => {
  it('COPY THIS WORKOUT, the apply-ahead banner and the session DELOAD toggle sit above the switch and the card; COPY WEEK and MARK WEEK AS DELOAD above the panel', () => {
    // Week 2 is empty, so both copy buttons are offered; week 1 is the source; week 3 is
    // planned, so adding an exercise offers "apply ahead".
    mockState.all = [plan(1, SETS, [pe1, pe2]), plan(2, [], []), plan(3, [], [])]
    renderPlanPage()
    expect(screen.getByText('WEEK 2')).toBeTruthy()

    openStructureView()
    fireEvent.click(screen.getByText('ADD EXERCISE'))
    fireEvent.click(screen.getByText('Incline Press'))
    expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()

    for (const open of [openStructureView, openSetsView]) {
      open()
      const copyWeek = screen.getByText('COPY WEEK')
      const markWeek = screen.getByText('MARK WEEK AS DELOAD')
      const sessionDeload = screen.getByLabelText('Mark this session as deload')
      const banner = screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')
      const copyWorkout = screen.getByText('COPY THIS WORKOUT')
      const switchBar = screen.getByText('SETS').parentElement as HTMLElement
      const card = screen.getByText('NO EXERCISES IN THIS DAY')

      // The page's actions, above the panel (its header, where the session toggle is) ...
      expectBefore(copyWeek, sessionDeload)
      expectBefore(markWeek, sessionDeload)
      // ... the panel's own actions, above the switch ...
      expectBefore(sessionDeload, switchBar)
      expectBefore(banner, switchBar)
      expectBefore(copyWorkout, switchBar)
      // ... and the switch above the view's content.
      expectBefore(switchBar, card)
    }
  })

  it('and they are live in either view: COPY THIS WORKOUT and the session toggle act the same from SETS and from STRUCTURE', () => {
    mockState.all = [plan(1, SETS, [pe1, pe2]), plan(2, [], []), plan(3, [], [])]
    renderPlanPage()

    for (const open of [openSetsView, openStructureView]) {
      open()
      copyWorkoutMutate.mockClear()
      fireEvent.click(screen.getByText('COPY THIS WORKOUT'))
      expect(copyWorkoutMutate).toHaveBeenCalledWith({ workoutDayId: 'wd-1', weekPlanId: 'wp-2', sequencePosition: null })
      setDeloadMutate.mockClear()
      fireEvent.click(screen.getByLabelText('Mark this session as deload'))
      expect(setDeloadMutate).toHaveBeenCalledTimes(1)
      expect((setDeloadMutate.mock.calls[0][0] as { weekPlanId: string }).weekPlanId).toBe('wp-2')
    }
  })

  it('an edit made in one view leaves its offer above both: the banner stays when the view changes, and APPLY acts on that edit', async () => {
    arrange()

    fireEvent.click(screen.getByLabelText('Add set to Squat')) // SETS
    expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()
    openStructureView()
    const banner = screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')
    expectBefore(banner, screen.getByText('STRUCTURE').parentElement as HTMLElement)
    expect(await applyAheadChanges()).toEqual([{ editType: 'addSet', slotId: 'pe-2', exerciseId: 'ex-squat' }])
  })
})

// ─── MOVE THIS SESSION ────────────────────────────────────────────────────────

// G17: MOVE THIS SESSION sits above the panel, "as today": it is the page's, not a view's. (Independent-review break
// V9: rendering it in the SETS view only passed every test, because this file stubbed it to nothing.)
describe('PlanPage — MOVE THIS SESSION sits above the panel, in both views (G17)', () => {
  it('is on the page in SETS and in STRUCTURE, after the workout chips and before the panel (its header, the switch, the card)', () => {
    arrange() // week 2 is this meso's current week

    for (const open of [openSetsView, openStructureView, openSetsView]) {
      open()
      const stubs = screen.getAllByTestId('move-session-stub')
      expect(stubs).toHaveLength(1)
      const stub = stubs[0]
      expectBefore(screen.getByText('MON'), stub)
      expectBefore(stub, screen.getByLabelText('Mark this session as deload'))
      expectBefore(stub, screen.getByText('SETS').parentElement as HTMLElement)
      expect(stub.getAttribute('data-workout')).toBe('wd-1')
      expect(stub.getAttribute('data-plan')).toBe('wp-2')
      expect(stub.getAttribute('data-meso')).toBe('meso-1')
      expect(stub.getAttribute('data-current')).toBe('true')
    }
  })

  it('is handed the selected workout and the viewed week, in both views', () => {
    mockState.program = makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1', thursday: 'wd-2' })
    mockState.days = [workoutDay, workoutDay2]
    const lunge = pe('pe-l', EX_LUNGE, 0, 'wd-2')
    mockState.all = [
      plan(2, SETS, [pe1, pe2]), plan(2, [], [lunge], 'wd-2'),
      plan(3, SETS, [pe1, pe2]), plan(3, [], [lunge], 'wd-2'),
    ]
    renderPlanPage()
    const stub = () => screen.getByTestId('move-session-stub')

    for (const open of [openSetsView, openStructureView]) {
      open()
      fireEvent.click(screen.getByText('MON'))
      expect(stub().getAttribute('data-workout')).toBe('wd-1')
      expect(stub().getAttribute('data-plan')).toBe('wp-2')
      fireEvent.click(screen.getByText('THU'))
      expect(stub().getAttribute('data-workout')).toBe('wd-2')
      expect(stub().getAttribute('data-plan')).toBe('wp-2-wd-2')
      // A later week is not the current one (the real control then renders nothing).
      fireEvent.click(screen.getByLabelText('Next week'))
      expect(screen.getByText('WEEK 3')).toBeTruthy()
      expect(stub().getAttribute('data-plan')).toBe('wp-3-wd-2')
      expect(stub().getAttribute('data-current')).toBe('false')
      fireEvent.click(screen.getByLabelText('Previous week'))
      expect(stub().getAttribute('data-current')).toBe('true')
    }
  })
})

// ─── Supersets ────────────────────────────────────────────────────────────────

// Checks that lied #29: a grouping/layout change must keep every per-item action
// the item already had. A superset's members keep their ADD SET and set rows in
// SETS and their ⋯ (swap, add warmup sets, remove) in STRUCTURE; MOVE UP/DOWN stay
// on the block's first member only, as before.
describe('PlanPage — supersets keep every per-item action in both views', () => {
  const pe1Blocked: ProgramExercise = { ...pe1, supersetBlockId: 'blk-1' }
  const pe2Blocked: ProgramExercise = { ...pe2, supersetBlockId: 'blk-1' }
  const pe3 = pe('pe-3', EX_DIPS, 2)
  const sq = (id: string, programExerciseId: string) => setRow({ id, programExerciseId, setNumber: 1, targetWeight: 50, repMin: 8, repMax: 8 })

  function arrangeSuperset() {
    mockState.all = [plan(2, [sq('a1', 'pe-1'), sq('b1', 'pe-2'), sq('c1', 'pe-3')], [pe1Blocked, pe2Blocked, pe3]), plan(3, [], [])]
    return renderPlanPage()
  }

  it('SETS: every member has its own ADD SET and its own set rows, and both members read SUPERSET', () => {
    arrangeSuperset()

    for (const name of ['Bench Press', 'Squat', 'Dips']) expect(screen.getByLabelText(`Add set to ${name}`)).toBeTruthy()
    expect(screen.getAllByText(/SUPERSET/)).toHaveLength(2) // the two members, not the plain exercise
    expect(screen.getAllByLabelText('Options for set 1')).toHaveLength(3)

    // Each member's ADD SET writes that member's own row.
    fireEvent.click(screen.getByLabelText('Add set to Squat'))
    expect(addSetMutate).toHaveBeenLastCalledWith({ workoutDayId: 'wd-1', weekPlanId: 'wp-2', programExerciseId: 'pe-2', setNumber: 2 })
    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    expect(addSetMutate).toHaveBeenLastCalledWith({ workoutDayId: 'wd-1', weekPlanId: 'wp-2', programExerciseId: 'pe-1', setNumber: 2 })
  })

  it('STRUCTURE: every member has its ⋯ with swap, add warmup sets and remove; only the block\'s first member can move it', () => {
    arrangeSuperset()
    openStructureView()

    // The marker is on the two members, not on the plain exercise. (Chunk 30: the view now also holds
    // the link toggles and the block's rests, whose text says SUPERSET too, so this counts the marker itself.)
    expect(screen.getAllByText('· SUPERSET')).toHaveLength(2)
    for (const name of ['Bench Press', 'Squat', 'Dips']) openExerciseMenu(name)
    for (const name of ['Bench Press', 'Squat', 'Dips']) {
      expect(screen.getByLabelText(`Swap ${name}`)).toBeTruthy()
      expect(screen.getByLabelText(`Remove ${name} from this week`)).toBeTruthy()
    }
    expect(screen.getAllByLabelText('Add warmup sets')).toHaveLength(3)
    // Two units (the block, and Dips): two pairs, not one per exercise.
    expect(screen.getAllByLabelText('Move up')).toHaveLength(2)
    expect(screen.getAllByLabelText('Move down')).toHaveLength(2)

    // The second member's actions write the second member's own row (menus are in page order: Bench, Squat, Dips).
    fireEvent.click(screen.getAllByLabelText('Add warmup sets')[1])
    expect(addWarmupMutate).toHaveBeenCalledWith({ workoutDayId: 'wd-1', weekPlanId: 'wp-2', programExerciseId: 'pe-2' })
    openExerciseMenu('Squat') // (each action closes the menu it was taken from)
    fireEvent.click(screen.getByLabelText('Remove Squat from this week'))
    fireEvent.click(screen.getByText('REMOVE'))
    expect(removeExerciseMutate).toHaveBeenCalledWith({ weekPlanId: 'wp-2', programExerciseId: 'pe-2' })
  })

  it('STRUCTURE: the block moves as one unit — both members\' positions in one call', () => {
    arrangeSuperset()
    openStructureView()

    openExerciseMenu('Bench Press')
    fireEvent.click(screen.getByLabelText('Move down'))
    expect(reorderMutate).toHaveBeenCalledWith({
      weekPlanId: 'wp-2',
      moves: [
        { programExerciseId: 'pe-1', oldPosition: 0, newPosition: 1 },
        { programExerciseId: 'pe-2', oldPosition: 1, newPosition: 2 },
        { programExerciseId: 'pe-3', oldPosition: 2, newPosition: 0 },
      ],
    })
  })

  // Independent-review breaks S1/S3: SWAP on the block's second member targeted the unit's first member (or the other
  // one), and no test tapped "Swap Squat". The picker is titled for the member tapped; the swap writes ITS row.
  it('STRUCTURE: SWAP on each member, the second included, opens the picker for THAT member and swaps its own row', async () => {
    arrangeSuperset()
    openStructureView()

    for (const [name, rowId] of [['Bench Press', 'pe-1'], ['Squat', 'pe-2'], ['Dips', 'pe-3']] as const) {
      swapMutate.mockClear()
      openExerciseMenu(name)
      fireEvent.click(screen.getByLabelText(`Swap ${name}`))
      expect(screen.getByText(`SWAP ${name}`)).toBeTruthy()
      await act(async () => {
        fireEvent.click(screen.getByText('Incline Press'))
      })
      expect(swapMutate).toHaveBeenCalledTimes(1)
      expect(swapMutate).toHaveBeenCalledWith({ weekPlanId: 'wp-2', programExerciseId: rowId, replacementExerciseId: 'ex-new' })
      if (name === 'Squat') {
        // ... and it is offered ahead as the second member's own edit (its slot, its exercise).
        expect(await applyAheadChanges()).toEqual([
          { editType: 'swapExercise', slotId: 'pe-2', exerciseId: 'ex-squat', newExerciseId: 'ex-new', resultingProgramExerciseId: 'swap-result-row' },
        ])
      }
    }
  })

  // Independent-review break SS4: `isPast={isPast || !showMoveControls}` on the STRUCTURE set rows took the second
  // member's set ⋯ away, and passed every test (they only opened a plain exercise's).
  it('STRUCTURE: every member\'s set ⋯ works: the second member\'s ADD STAGE writes that member\'s own head as the parent', () => {
    arrangeSuperset()
    openStructureView()

    // One set each (Bench Press, Squat, Dips): three set ⋯ buttons, the block's second member's among them.
    expect(screen.getAllByLabelText('Options for set 1')).toHaveLength(3)
    for (const [i, rowId, parentId] of [[0, 'pe-1', 'a1'], [1, 'pe-2', 'b1'], [2, 'pe-3', 'c1']] as const) {
      addStageMutate.mockClear()
      fireEvent.click(screen.getAllByLabelText('Options for set 1')[i])
      fireEvent.click(screen.getByLabelText('Add stage'))
      expect(addStageMutate).toHaveBeenCalledTimes(1)
      expect(addStageMutate).toHaveBeenCalledWith({ weekPlanId: 'wp-2', programExerciseId: rowId, parentId, setNumber: 1, stageIndex: 1 })
      fireEvent.click(screen.getAllByLabelText('Options for set 1')[i]) // ADD STAGE leaves its menu open: close it
    }
  })

  it('SETS: the second member\'s own cells and set ⋯ write that member\'s own set', () => {
    arrangeSuperset()

    const squatRow = rowOf('01', 1) // the three "01" rows are Bench Press's, Squat's and Dips's
    fireEvent.click(within(squatRow).getByRole('button', { name: '50kg' }))
    fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '55' } })
    fireEvent.blur(screen.getByLabelText('Weight target'))
    expect(updateSetMutate).toHaveBeenLastCalledWith({ id: 'b1', changes: { targetWeight: 55 } })
    fireEvent.click(within(squatRow).getByLabelText('Options for set 1'))
    fireEvent.click(screen.getByLabelText('Delete set'))
    expect(removeSetMutate).toHaveBeenLastCalledWith('b1')
  })
})

// ─── "Apply to all sets" stays inside its own exercise ────────────────────────

// Independent-review break T8: handing the tags handler the FIRST exercise's sets, whichever exercise applied the tag,
// passed every test, because every apply-to-all fixture had one exercise.
describe('PlanPage — "apply to all sets" stays inside its own exercise', () => {
  const mk = (id: string, programExerciseId: string, setNumber: number, over: Partial<WeekPlanSet> = {}) =>
    setRow({ id, programExerciseId, setNumber, targetWeight: 50, repMin: 8, repMax: 8, ...over })
  // Bench Press: two working sets, the first tagged. Squat: a warmup, then three working sets (the first tagged, the
  // second staged). Set numbers repeat across the two exercises, so a set ⋯ is picked by its place on the page.
  const twoExercises = [
    mk('a1', 'pe-1', 1, { tags: ['push here'] }),
    mk('a2', 'pe-1', 2),
    mk('bw', 'pe-2', 1, { isWarmup: true, targetRir: null }),
    mk('b1', 'pe-2', 2, { tags: ['push here'] }),
    mk('b2', 'pe-2', 3),
    mk('b2s', 'pe-2', 3, { isDropset: true, parentWeekPlanSetId: 'b2', stageIndex: 1 }),
    mk('b3', 'pe-2', 4),
  ]
  const written = () => updateSetMutate.mock.calls.map((c) => c[0] as { id: string; changes: unknown })

  it('applying a tag from the second exercise writes only ITS other working sets: not the warmup, not a stage, none of the first exercise\'s', () => {
    mockState.all = [plan(2, twoExercises, [pe1, pe2]), plan(3, [], [])]
    renderPlanPage()

    fireEvent.click(screen.getAllByLabelText('Options for set 2')[1]) // Squat's tagged set (Bench Press's is the first "set 2")
    fireEvent.click(screen.getByLabelText('Apply "push here" to all sets'))

    expect(written().map((w) => w.id)).toEqual(['b2', 'b3'])
    for (const w of written()) expect(w.changes).toEqual({ tags: ['push here'] })
    // Never offered ahead (it writes several sets in one action).
    expect(screen.queryByText(/PLANNED WEEK/)).toBeNull()
  })

  it('and from the first exercise writes only ITS other working sets, none of the second\'s', () => {
    mockState.all = [plan(2, twoExercises, [pe1, pe2]), plan(3, [], [])]
    renderPlanPage()

    fireEvent.click(screen.getAllByLabelText('Options for set 1')[0]) // Bench Press's tagged set
    fireEvent.click(screen.getByLabelText('Apply "push here" to all sets'))

    expect(written().map((w) => w.id)).toEqual(['a2'])
    expect(written()[0].changes).toEqual({ tags: ['push here'] })
  })
})

// ─── Past weeks ───────────────────────────────────────────────────────────────

describe('PlanPage — a past week is read-only in both views', () => {
  function arrangePast() {
    // Started three weeks ago: the current week is 4. Week 1 is then past.
    mockState.meso = { ...activeMeso, startDate: format(subWeeks(new Date(), 3), 'yyyy-MM-dd') }
    mockState.all = [plan(1, SETS, [pe1, pe2]), plan(4, SETS, [pe1, pe2])]
    renderPlanPage()
    expect(screen.getByText('WEEK 4')).toBeTruthy()
    // On the current week every control is there ...
    expect(screen.getByLabelText('Add set to Bench Press')).toBeTruthy()
    openStructureView()
    expect(screen.getByLabelText('Bench Press options')).toBeTruthy()
    expect(screen.getByText('ADD EXERCISE')).toBeTruthy()
    openSetsView()
    // ... then step back to week 1.
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByLabelText('Previous week'))
    expect(screen.getByText('PAST WEEK — READ ONLY')).toBeTruthy()
  }

  it('SETS: the numbers are drawn but dead, with no `+` and no ⋯', () => {
    arrangePast()
    openSetsView()

    expect(screen.queryByLabelText(/^Add set to /)).toBeNull()
    expect(screen.queryAllByLabelText(/^Options for /)).toHaveLength(0)
    expect(screen.queryAllByLabelText(/ options$/)).toHaveLength(0)
    // The rows are there, each cell disabled.
    expect(squash(rowOf('02').textContent)).toBe(squash('02100kg × 8–12 − RIR 2 +'))
    for (const cell of buttonsOf(rowOf('02'))) expect((cell as HTMLButtonElement).disabled).toBe(true)
    for (const cell of buttonsOf(rowOf('↳', 0))) expect((cell as HTMLButtonElement).disabled).toBe(true)
    updateSetMutate.mockClear()
    fireEvent.click(within(rowOf('02')).getByRole('button', { name: '100kg' }))
    expect(screen.queryByLabelText('Weight target')).toBeNull()
    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  it('STRUCTURE: no exercise ⋯, no ADD EXERCISE and no set ⋯ — the structure is drawn, not editable', () => {
    arrangePast()
    openStructureView()

    expect(screen.queryAllByLabelText(/ options$/)).toHaveLength(0)
    expect(screen.queryAllByLabelText(/^Options for /)).toHaveLength(0)
    expect(screen.queryByText('ADD EXERCISE')).toBeNull()
    for (const label of ['Swap Bench Press', 'Move up', 'Move down', 'Add warmup sets', 'Add stage', 'Delete set', 'Delete stage']) {
      expect(screen.queryByLabelText(label)).toBeNull()
    }
    // The structure itself is on the page: every set's number and the kind markers.
    expect(screen.getAllByText('01')).toHaveLength(2)
    expect(screen.getByText('02')).toBeTruthy()
    expect(screen.getAllByText('↳')).toHaveLength(2)
    expect(screen.getAllByText('WARMUP')).toHaveLength(1)
    expect(screen.getAllByText('DROPSET')).toHaveLength(1)
  })
})

// ─── Apply-ahead, from every moved control ────────────────────────────────────

// Checks that lied #29 again: a control that moved has to keep what it did. Each
// one still offers its edit to the planned weeks ahead, from the view it now lives in
// (the full records are PlanPage.applyAhead.test.tsx's; this walks them all, once).
describe('PlanPage — every moved control still offers its edit ahead', () => {
  type Flow = [name: string, editType: string, run: () => void | Promise<void>]
  const flows: Flow[] = [
    ['SETS  `+` ADD SET', 'addSet', () => { openSetsView(); fireEvent.click(screen.getByLabelText('Add set to Squat')) }],
    ['SETS  set ⋯ DELETE SET (a working set)', 'removeHeadSet', () => { openSetsView(); openSetMenu(3); fireEvent.click(screen.getByLabelText('Delete set')) }],
    ['SETS  set ⋯ tag', 'tags', () => { openSetsView(); openSetMenu(3); fireEvent.click(screen.getByRole('button', { name: 'push back' })) }],
    ['SETS  stage weight', 'weightTarget', () => {
      openSetsView()
      fireEvent.click(within(rowOf('↳', 0)).getByRole('button', { name: '80kg' }))
      fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '85' } })
      fireEvent.blur(screen.getByLabelText('Weight target'))
    }],
    ['SETS  stage RIR', 'rir', () => { openSetsView(); fireEvent.click(within(rowOf('↳', 1)).getByRole('button', { name: '+' })) }],
    ['STRUCTURE  set ⋯ ADD STAGE', 'addStage', () => { openStructureView(); openSetMenu(3); fireEvent.click(screen.getByLabelText('Add stage')) }],
    ['STRUCTURE  set ⋯ STAGE KIND', 'stageKind', () => { openStructureView(); openSetMenu(2); fireEvent.click(screen.getByRole('button', { name: 'CLUSTER' })) }],
    ['STRUCTURE  stage ⋯ DELETE STAGE', 'removeStage', () => { openStructureView(); openStageMenu(0); fireEvent.click(screen.getByLabelText('Delete stage')) }],
    ['STRUCTURE  warmup ⋯ DELETE SET', 'removeHeadSet', () => { openStructureView(); openSetMenu(1); fireEvent.click(screen.getByLabelText('Delete set')) }],
    ['STRUCTURE  exercise ⋯ ADD WARMUP SETS', 'addWarmupSet', () => { openStructureView(); openExerciseMenu('Squat'); fireEvent.click(screen.getByLabelText('Add warmup sets')) }],
    ['STRUCTURE  exercise ⋯ SWAP EXERCISE', 'swapExercise', async () => {
      openStructureView(); openExerciseMenu('Bench Press'); fireEvent.click(screen.getByLabelText('Swap Bench Press'))
      await act(async () => { fireEvent.click(screen.getByText('Incline Press')) })
    }],
    ['STRUCTURE  exercise ⋯ MOVE UP', 'reorderExercise', () => { openStructureView(); openExerciseMenu('Squat'); fireEvent.click(screen.getByLabelText('Move up')) }],
    ['STRUCTURE  exercise ⋯ REMOVE FROM THIS WEEK', 'removeExercise', () => {
      openStructureView(); openExerciseMenu('Bench Press'); fireEvent.click(screen.getByLabelText('Remove Bench Press from this week')); fireEvent.click(screen.getByText('REMOVE'))
    }],
    ['STRUCTURE  ADD EXERCISE', 'addExercise', () => { openStructureView(); fireEvent.click(screen.getByText('ADD EXERCISE')); fireEvent.click(screen.getByText('Incline Press')) }],
  ]

  for (const [name, editType, run] of flows) {
    it(`${name} offers "${editType}" to the later planned week`, async () => {
      arrange()
      expect(screen.queryByText(/PLANNED WEEK/)).toBeNull() // nothing is offered before the edit
      await run()
      expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()
      const changes = await applyAheadChanges()
      expect(changes.map((c) => c.editType)).toEqual([editType])
      expect(applyAheadLast?.weeks.map((w) => w.weekNumber)).toEqual([3])
    })
  }
})
