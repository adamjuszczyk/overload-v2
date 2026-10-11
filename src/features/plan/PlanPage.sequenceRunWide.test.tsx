// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format } from 'date-fns'
import type {
  Mesocycle, Program, WorkoutDay, ProgramExercise, ProgramSet, WarmupRoutineItem, WeekPlan, WeekPlanSet, Exercise, SequenceItem,
} from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 30 (retry). The STRUCTURE view's run-wide writes on a SEQUENCE run. PlanPage.sequenceCycle.test.tsx walks
// a sequence run's control matrix with idle mutations, so a write keyed to the wrong workout on the sequence
// branch only (its panel is mounted with `SLOT n` where the weekday branch has a weekday) was not seen by any
// test. This file records every write the view's hooks are asked for, and every workout id each hook is keyed by.
//
// The run is A, A, B (a repeated workout in slots 1 and 2, SPEC G8) in cycle 1, the current cycle:
//
//   workout A's run copy:  pe-a1 Bench Press, pe-a2 Row           (one set of rows, shared by both slots)
//   slot 1 (A):  Bench Press, Row, Lunge          Lunge   = pe-a-n0, a week_only row added in THIS slot's plan
//   slot 2 (A):  Bench Press, Row, Incline Press  Incline = pe-a-n1, a week_only row added in THIS slot's plan
//   slot 3 (B):  Squat (pe-b1)
//
// so that the second A's view has exercises, rows and a routine of its own that the first A's view and B's view
// do not, and a write keyed or addressed by the wrong slot, workout or plan lands somewhere this file can see.
// Renders the real PlanPage tree; only the data hooks are mocked (the seam every PlanPage test file uses).

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// ─── Fixture ──────────────────────────────────────────────────────────────────

const startDate = format(new Date(), 'yyyy-MM-dd')
const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDayA: WorkoutDay = { id: 'wd-a', programId: 'prog-1', userId: 'user-1', name: 'Workout A', position: 0, exercises: [] }
const workoutDayB: WorkoutDay = { id: 'wd-b', programId: 'prog-1', userId: 'user-1', name: 'Workout B', position: 1, exercises: [] }
const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Sequence Program', schedule: EMPTY_SCHEDULE,
  workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  kind: 'run', planningType: 'week_dependent', scheduleType: 'sequence',
}
const sequenceItems: SequenceItem[] = [
  { id: 'si-0', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-a' },
  { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 1, workoutDayId: 'wd-a' },
  { id: 'si-2', userId: 'user-1', programId: 'prog-1', position: 2, workoutDayId: 'wd-b' },
]

const ex = (id: string, name: string, muscleGroup: Exercise['muscleGroup']): Exercise => ({
  id, userId: 'user-1', name, muscleGroup, isArchived: false, createdAt: '', muscleSubgroups: null,
  movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
})
const pe = (id: string, exercise: Exercise, workoutDayId: string, position: number): ProgramExercise => ({
  id, workoutDayId, userId: 'user-1', exerciseId: exercise.id, position, weightUnit: null, exercise,
})
const PE_BENCH = pe('pe-a1', ex('ex-bench', 'Bench Press', 'chest'), 'wd-a', 0)
const PE_ROW = pe('pe-a2', ex('ex-row', 'Row', 'back'), 'wd-a', 1)
const PE_LUNGE = pe('pe-a-n0', ex('ex-lunge', 'Lunge', 'quads'), 'wd-a', 2) // week_only, slot 1's plan only
const PE_INCLINE = pe('pe-a-n1', ex('ex-incline', 'Incline Press', 'chest'), 'wd-a', 2) // week_only, slot 2's plan only
const PE_SQUAT = pe('pe-b1', ex('ex-squat', 'Squat', 'quads'), 'wd-b', 0)
const RUN_COPY: Record<string, ProgramExercise[]> = { 'wd-a': [PE_BENCH, PE_ROW], 'wd-b': [PE_SQUAT] }

const set = (id: string, weekPlanId: string, programExerciseId: string, programSetId: string | null): WeekPlanSet => ({
  id, weekPlanId, userId: 'user-1', programExerciseId, setNumber: 1, targetRir: 2, isDropset: false,
  parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: 100, repMin: 8, repMax: 8, programSetId,
})
const plan = (id: string, workoutDayId: string, sequencePosition: number, exercises: ProgramExercise[], sets: WeekPlanSet[]): WeekPlan => ({
  id, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId, weekNumber: 1, sequencePosition, isDeload: false, notes: null,
  exercises, sets, createdAt: '2026-01-01T00:00:00Z',
})
const allPlans: WeekPlan[] = [
  plan('wp-1-s0', 'wd-a', 0, [PE_BENCH, PE_ROW, PE_LUNGE], [
    set('s0-bench', 'wp-1-s0', 'pe-a1', 'ps-a1'), set('s0-row', 'wp-1-s0', 'pe-a2', 'ps-a2'), set('s0-lunge', 'wp-1-s0', 'pe-a-n0', null),
  ]),
  plan('wp-1-s1', 'wd-a', 1, [PE_BENCH, PE_ROW, PE_INCLINE], [
    set('s1-bench', 'wp-1-s1', 'pe-a1', 'ps-a1'), set('s1-row', 'wp-1-s1', 'pe-a2', 'ps-a2'), set('s1-incline', 'wp-1-s1', 'pe-a-n1', null),
  ]),
  plan('wp-1-s2', 'wd-b', 2, [PE_SQUAT], [set('s2-squat', 'wp-1-s2', 'pe-b1', 'ps-b1')]),
]

const pset = (id: string, programExerciseId: string, restSeconds: number | null): ProgramSet => ({
  id, userId: 'user-1', programExerciseId, position: 0, isWarmup: false, stageKind: null, stageRestSeconds: null,
  parentProgramSetId: null, stageIndex: 0, repMin: 8, repMax: 8, isAmrap: false, restSeconds, createdAt: '',
})
const PROGRAM_SETS = [pset('ps-a1', 'pe-a1', 60), pset('ps-a2', 'pe-a2', null), pset('ps-b1', 'pe-b1', 90)]

const item = (id: string, position: number, body: string, workoutDayId: string): WarmupRoutineItem => ({ id, userId: 'user-1', workoutDayId, position, body })
const ROUTINES: Record<string, WarmupRoutineItem[]> = {
  'wd-a': [item('wi-a1', 0, 'Bike 5 min', 'wd-a'), item('wi-a2', 1, 'Band pull-aparts', 'wd-a')],
  'wd-b': [item('wi-b1', 0, 'Leg swings', 'wd-b')],
}

// ─── What the hooks are asked ─────────────────────────────────────────────────

// Every write any of the STRUCTURE view's hooks is handed, in order ...
const writes: Array<[string, unknown]> = []
const write = (name: string) => (arg: unknown) => { writes.push([name, arg]) }
// ... and every workout id each of them was keyed by (and the rows the program sets were read for).
const keys: Record<string, string[]> = {}
const keyed = (hook: string, workoutDayId: string) => { (keys[hook] ??= []).push(workoutDayId) }
const programSetReads: string[][] = []

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDayA, workoutDayB], isLoading: false }),
  useProgramExercises: (workoutDayId: string) => ({ data: RUN_COPY[workoutDayId] ?? [], isLoading: false }),
  useSequenceItems: () => ({ data: sequenceItems, isLoading: false }),
  useUpdateProgramExerciseRest: (workoutDayId: string) => { keyed('rest', workoutDayId); return { mutate: write('rest'), isPending: false } },
  useUpdateProgramExerciseTempo: (workoutDayId: string) => { keyed('tempo', workoutDayId); return { mutate: write('tempo'), isPending: false } },
  useUpdateProgramExerciseWeightUnit: (workoutDayId: string) => { keyed('unit', workoutDayId); return { mutate: write('unit'), isPending: false } },
  useToggleSupersetLink: (workoutDayId: string) => { keyed('link', workoutDayId); return { mutate: write('link'), isPending: false } },
  useUpdateSupersetBlockRest: (workoutDayId: string) => { keyed('blockRest', workoutDayId); return { mutate: write('blockRest'), isPending: false } },
  useSupersetBlockRests: (workoutDayId: string) => { keyed('blocks', workoutDayId); return { data: [] } },
  useWarmupRoutineItems: (workoutDayId: string) => { keyed('routine', workoutDayId); return { data: ROUTINES[workoutDayId] ?? [], isLoading: false } },
  useAddWarmupItem: (workoutDayId: string) => { keyed('addItem', workoutDayId); return { mutateAsync: async (arg: unknown) => write('addItem')(arg), isPending: false } },
  useUpdateWarmupItemBody: (workoutDayId: string) => { keyed('updateItem', workoutDayId); return { mutate: write('updateItem'), isPending: false } },
  useRemoveWarmupItem: (workoutDayId: string) => { keyed('removeItem', workoutDayId); return { mutate: write('removeItem'), isPending: false } },
  useReorderWarmupItems: (workoutDayId: string) => { keyed('reorderItems', workoutDayId); return { mutate: write('reorderItems'), isPending: false } },
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  // The program sets of the rows asked for, no others.
  useProgramSets: (ids: string[]) => { programSetReads.push(ids); return { data: PROGRAM_SETS.filter((ps) => ids.includes(ps.programExerciseId)) } },
  useUpdateProgramSetRest: () => ({ mutate: write('setRest'), isPending: false }),
  useUpdateProgramSetStageRest: () => ({ mutate: write('stageRest'), isPending: false }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
// Nothing is done yet, so the current cycle is cycle 1: the one viewed.
vi.mock('../gym/useSession', () => ({ useLastDoneOrSkippedSession: () => ({ data: null }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: allPlans.filter((w) => w.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: allPlans, isLoading: false }),
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
const { openStructureView, openExerciseMenu } = await import('./planMenus.testutil')

afterEach(() => {
  writes.length = 0
  programSetReads.length = 0
  for (const hook of Object.keys(keys)) delete keys[hook]
})

function renderPlan() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

const more = (label: string) => fireEvent.click(screen.getByLabelText(`More ${label}`))
const toggles = () => screen.getAllByRole('button', { name: /LINK AS SUPERSET|TAP TO UNLINK/ })
const card = () => within(screen.getByRole('group', { name: 'Warmup routine' }))
const editRoutineItem = (from: string, to: string) => {
  fireEvent.click(screen.getByText(from))
  fireEvent.change(screen.getByLabelText('Warmup item text'), { target: { value: to } })
  fireEvent.blur(screen.getByLabelText('Warmup item text'))
}
// The distinct workout ids a hook was keyed by across every render.
const keyedBy = (hook: string) => Array.from(new Set(keys[hook] ?? []))
const EVERY_HOOK = ['rest', 'tempo', 'unit', 'link', 'blockRest', 'blocks', 'routine', 'addItem', 'updateItem', 'removeItem', 'reorderItems']

describe('PlanPage STRUCTURE on a sequence run — the run-wide writes are the viewed slot\'s workout\'s own, never another slot\'s, plan\'s or workout\'s', () => {
  it('SLOT 2 (the second A): the routine and every field write workout A\'s own routine, rows and program sets — and nothing else', async () => {
    renderPlan()
    // The slot is chosen in the SETS view, so no hook of the STRUCTURE view has been called for any other slot's panel.
    fireEvent.click(screen.getByText('SLOT 2'))
    for (const hook of EVERY_HOOK) expect(keys[hook], hook).toBeUndefined()
    openStructureView()

    // Control: this is the second A's plan — its own added exercise, not the first A's — and A's routine, not B's.
    expect(screen.getAllByText('SLOT 2')).toHaveLength(2) // the chip and the panel's header
    expect(screen.getByText('Incline Press')).toBeTruthy()
    expect(screen.queryByText('Lunge')).toBeNull()
    expect(screen.queryByText('Squat')).toBeNull()
    expect(card().getByText('Bike 5 min')).toBeTruthy()
    expect(card().getByText('Band pull-aparts')).toBeTruthy()
    expect(screen.queryByText('Leg swings')).toBeNull()

    // The routine: add (at the end), edit, reorder, remove.
    fireEvent.click(screen.getByText('ADD ITEM'))
    fireEvent.change(screen.getByLabelText('New warmup item'), { target: { value: 'Jumping jacks' } })
    await act(async () => { fireEvent.click(screen.getByText('ADD')) })
    editRoutineItem('Band pull-aparts', 'Face pulls')
    fireEvent.click(screen.getByLabelText('Options for warmup item 2'))
    fireEvent.click(screen.getByLabelText('Move warmup item 2 up'))
    fireEvent.click(screen.getByLabelText('Options for warmup item 1'))
    fireEvent.click(screen.getByLabelText('Remove warmup item 1'))
    fireEvent.click(screen.getByText('REMOVE'))

    // The slot's exercises: REST on its own added row, REST AFTER on a run-copy row both A slots share, TEMPO, unit.
    openExerciseMenu('Incline Press')
    more('rest for Incline Press')
    fireEvent.click(within(screen.getByRole('group', { name: 'Weight unit' })).getByRole('button', { name: 'LBS' }))
    openExerciseMenu('Incline Press')
    openExerciseMenu('Bench Press')
    more('rest after for Bench Press')
    openExerciseMenu('Bench Press')
    openExerciseMenu('Row')
    fireEvent.click(screen.getByText('—'))
    fireEvent.change(screen.getByLabelText('Tempo'), { target: { value: '2-0-2-0' } })
    fireEvent.blur(screen.getByLabelText('Tempo'))
    openExerciseMenu('Row')

    // A set's own REST: Bench Press's set 1 (a program set of the run copy's row) ...
    fireEvent.click(screen.getAllByLabelText('Options for set 1')[0])
    more('rest of set 1 for Bench Press')
    fireEvent.click(screen.getAllByLabelText('Options for set 1')[0])
    // ... and the link between Row and Incline Press, neighbours in THIS slot's order.
    expect(toggles()).toHaveLength(2)
    fireEvent.click(toggles()[1])

    expect(writes).toEqual([
      ['addItem', { body: 'Jumping jacks', position: 2 }],
      ['updateItem', { id: 'wi-a2', body: 'Face pulls' }],
      ['reorderItems', [{ id: 'wi-a2', position: 0 }, { id: 'wi-a1', position: 1 }]],
      ['removeItem', 'wi-a1'],
      ['rest', { id: 'pe-a-n1', changes: { restSeconds: 15 } }],
      ['unit', { id: 'pe-a-n1', weightUnit: 'lbs' }],
      ['rest', { id: 'pe-a1', changes: { restAfterSeconds: 15 } }],
      ['tempo', { id: 'pe-a2', tempo: '2-0-2-0' }],
      ['setRest', { id: 'ps-a1', restSeconds: 75 }],
      ['link', [{ ids: ['pe-a2', 'pe-a-n1'], blockId: null, needsNewBlock: true }]],
    ])
    // Every hook the view adds was keyed by workout A's id and by no other (not the slot's, the plan's or B's) ...
    for (const hook of EVERY_HOOK) expect(keyedBy(hook), hook).toEqual(['wd-a'])
    // ... and the program sets were read for this slot's own rows.
    expect(programSetReads.every((ids) => ids.join() === 'pe-a1,pe-a2,pe-a-n1')).toBe(true)
    expect(programSetReads.length).toBeGreaterThan(0)
  })

  // The first A and B, lighter: the same four kinds of write, each addressed by its own slot's rows.
  it.each([
    { slot: 'SLOT 1', workout: 'wd-a', own: 'Lunge', ownRow: 'pe-a-n0', absent: ['Incline Press', 'Squat', 'Leg swings'], routineItem: ['Bike 5 min', 'wi-a1'], setRow: 'ps-a1', setOf: 'Bench Press', programRows: 'pe-a1,pe-a2,pe-a-n0' },
    { slot: 'SLOT 3', workout: 'wd-b', own: 'Squat', ownRow: 'pe-b1', absent: ['Incline Press', 'Lunge', 'Bike 5 min'], routineItem: ['Leg swings', 'wi-b1'], setRow: 'ps-b1', setOf: 'Squat', programRows: 'pe-b1' },
  ])('$slot ($workout): its routine item, its own exercise ($own), its set — each addressed by $workout\'s own ids', ({ slot, workout, own, ownRow, absent, routineItem, setRow, setOf, programRows }) => {
    renderPlan()
    if (slot !== 'SLOT 1') fireEvent.click(screen.getByText(slot)) // (in the SETS view: the STRUCTURE view's hooks are not called yet)
    openStructureView()
    for (const text of absent) expect(screen.queryByText(text), `${text} is another slot's`).toBeNull()
    expect(screen.getByText(own)).toBeTruthy()

    editRoutineItem(routineItem[0], 'Edited')
    openExerciseMenu(own)
    more(`rest for ${own}`)
    openExerciseMenu(own)
    fireEvent.click(screen.getAllByLabelText('Options for set 1')[0])
    more(`rest of set 1 for ${setOf}`)

    expect(writes.map(([name]) => name)).toEqual(['updateItem', 'rest', 'setRest'])
    expect(writes[0]).toEqual(['updateItem', { id: routineItem[1], body: 'Edited' }])
    expect(writes[1]).toEqual(['rest', { id: ownRow, changes: { restSeconds: 15 } }])
    expect(writes[2][1]).toMatchObject({ id: setRow })
    for (const hook of ['rest', 'routine', 'updateItem', 'blocks', 'link']) expect(keyedBy(hook), hook).toEqual([workout])
    expect(programSetReads.every((ids) => ids.join() === programRows)).toBe(true)
  })
})
