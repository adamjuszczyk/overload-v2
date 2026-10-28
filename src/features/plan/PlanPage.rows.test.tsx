// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise, MuscleGroup } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'

// Chunk 54a (TASKS-1.2 "Plan's week view: exercise cards and set rows on the pickers"; SPEC Screens → Plan screen: "Each exercise: name and
// muscle, no ⋯ (7b). Each set: number, weight, reps, RIR, its type tag and cues"; boards 1, 1a, 9). What the week view DRAWS: one card per
// exercise, the rows in each, and what is no longer on the page. What each control WRITES is PlanPage.sheets.test.tsx's and the end-to-end
// file's. The real PlanPage tree, only the data hooks mocked (the seam every PlanPage test file uses), at 375 px.
//
// Replaces PlanPage.views.test.tsx (the SETS / STRUCTURE views are gone) and keeps what it held for the rows: a past week's rows are drawn
// but dead, a superset's members keep their own add-set and rows (Checks that lied #29: a layout change keeps every per-item action), and
// MOVE THIS SESSION stays above the panel.

afterEach(() => {
  cleanup()
  useSettingsStore.setState(DEFAULT_SETTINGS)
})
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
const EX_LUNGE = ex('ex-lunge', 'Lunge', 'quads')

const pe = (id: string, exercise: Exercise, position: number, over: Partial<ProgramExercise> = {}, workoutDayId = 'wd-1'): ProgramExercise => ({
  id, workoutDayId, userId: 'user-1', exerciseId: exercise.id, position, weightUnit: null, exercise, ...over,
})
const pe1 = pe('pe-1', EX_BENCH, 0)
const pe2 = pe('pe-2', EX_SQUAT, 1)

function setRow(over: Partial<WeekPlanSet>): WeekPlanSet {
  return {
    id: 'x', weekPlanId: 'wp-2', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 2,
    isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null, ...over,
  }
}

// Bench Press: a warmup (set 1: 40 × 10), a staged working set (2: 100 × 8–12, RIR 2, with two stages), a tagged working set (3: 100 × 8, RIR 3).
// Squat: one working set at 120 × 5, RIR 2.
const SETS: WeekPlanSet[] = [
  setRow({ id: 'warm', setNumber: 1, isWarmup: true, targetRir: null, targetWeight: 40, repMin: 10, repMax: 10 }),
  setRow({ id: 'work', setNumber: 2, targetWeight: 100, repMin: 8, repMax: 12, targetRir: 2, stageKind: 'dropset' }),
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

const mockState: { all: WeekPlan[]; program: Program; days: WorkoutDay[]; meso: Mesocycle; runCopy: Record<string, ProgramExercise[]> } = {
  all: [], program: makeProgram(), days: [workoutDay], meso: activeMeso, runCopy: {},
}
const setDeloadMutate = vi.fn()
const addSetMutate = vi.fn()
const updateSetMutate = vi.fn()
const removeSetMutate = vi.fn()
const changeTypeMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [mockState.meso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: mockState.days, isLoading: false }),
  useProgramExercises: (workoutDayId: string) => ({ data: mockState.runCopy[workoutDayId] ?? [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('./useReview', () => ({ useReview: () => ({ status: 'ready', groups: [], count: 0, error: null }) })) // REVIEW's line (chunk 56): nothing differed here
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined })) // the week view's session states (chunk 54b): none here
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: mockState.all.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.all, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: setDeloadMutate }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: addSetMutate, isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: removeSetMutate, isPending: false }),
  useChangeSetType: () => ({ mutate: changeTypeMutate, isPending: false }),
}))
// MoveSessionControl owns its own session reads (every PlanPage test stubs it), so it is stubbed here too, but with a stand-in that RENDERS: an
// empty element carrying its props as attributes, so a test can see whether Plan renders it, where, and what it hands it.
vi.mock('./MoveSessionControl', () => ({
  default: (props: { workoutDay: { id: string }; weekPlan?: { id: string }; mesoId: string; date: string; isCurrentWeek: boolean }) => (
    <div data-testid="move-session-stub" data-workout={props.workoutDay.id} data-plan={props.weekPlan?.id ?? ''} data-meso={props.mesoId} data-current={String(props.isCurrentWeek)} />
  ),
}))

const { default: PlanPage } = await import('./PlanPage')
const { openWeekTile, openSessionMenu, sessionMenuButton, sessionToggle } = await import('./planMenus.testutil')

afterEach(() => {
  mockState.program = makeProgram()
  mockState.days = [workoutDay]
  mockState.meso = activeMeso
  mockState.runCopy = {}
  for (const mock of [setDeloadMutate, addSetMutate, updateSetMutate, removeSetMutate, changeTypeMutate]) mock.mockClear()
})

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

// Week 2 (viewed) has the sets above.
function arrange(sets: WeekPlanSet[] = SETS, exercises: ProgramExercise[] = [pe1, pe2]) {
  mockState.all = [plan(2, sets, exercises)]
  return renderPlanPage()
}

// The row whose number text is `label`: the nth such row on the page (the number is a direct child of the row).
const rowOf = (label: string, nth = 0) => screen.getAllByText(label)[nth].parentElement as HTMLElement
const buttonsOf = (row: HTMLElement) => Array.from(row.querySelectorAll('button'))
const squash = (text: string | null) => (text ?? '').replace(/\s/g, '')
const cardOf = (name: string) => screen.getByText(name).closest('[data-exercise-card]') as HTMLElement
// The numbers a card draws, top to bottom: `W`, `01` ... and a stage row's `↳` (the number is the first child of its row).
const labelsIn = (card: HTMLElement) =>
  Array.from(card.querySelectorAll('div'))
    .map((div) => div.firstElementChild)
    .filter((first): first is HTMLSpanElement => first?.tagName === 'SPAN' && /^(W|\d\d|↳)$/.test(first.textContent ?? ''))
    .map((first) => first.textContent)

// ─── The exercise card (board 1) ──────────────────────────────────────────────

describe('PlanPage — an exercise\'s card (board 1)', () => {
  it('draws the exercise\'s name and muscle, an "add set" button and its rows — and no ⋯ of its own (7b)', () => {
    arrange()

    for (const [name, muscle] of [['Bench Press', 'CHEST'], ['Squat', 'QUADS']]) {
      const card = cardOf(name)
      expect(within(card).getByText(muscle)).toBeTruthy()
      expect(within(card).getByLabelText(`Add set to ${name}`)).toBeTruthy()
      // The only ⋯ buttons in a card are its sets': the exercise has none, and nothing of a ⋯ is called "<name> options".
      expect(within(card).queryByLabelText(`${name} options`)).toBeNull()
      for (const button of within(card).getAllByRole('button')) {
        expect(button.getAttribute('aria-label') ?? '').not.toMatch(/options$/)
      }
    }
  })

  it('one card per exercise, in the week\'s order', () => {
    arrange()
    const cards = Array.from(document.querySelectorAll('[data-exercise-card]'))
    expect(cards.map((c) => c.querySelector('span')?.textContent)).toEqual(['Bench Press', 'Squat'])
  })

  it('a workout with no exercises says so', () => {
    mockState.all = [plan(2, [], [])]
    renderPlanPage()
    expect(screen.getByText('No exercises in this day')).toBeTruthy() // board 10's wording
    expect(document.querySelectorAll('[data-exercise-card]')).toHaveLength(0)
  })

  describe('SUPERSET A · 1', () => {
    const pe1Blocked = { ...pe1, supersetBlockId: 'blk-1' }
    const pe2Blocked = { ...pe2, supersetBlockId: 'blk-1' }
    const pe3 = pe('pe-3', EX_DIPS, 2)
    const one = (id: string, programExerciseId: string) => setRow({ id, programExerciseId, setNumber: 1, targetWeight: 50, repMin: 8, repMax: 8 })

    it('the members carry the superset\'s letter and their own place, and an exercise in none carries nothing', () => {
      arrange([one('a1', 'pe-1'), one('b1', 'pe-2'), one('c1', 'pe-3')], [pe1Blocked, pe2Blocked, pe3])
      expect(within(cardOf('Bench Press')).getByText('SUPERSET A · 1')).toBeTruthy()
      expect(within(cardOf('Squat')).getByText('SUPERSET A · 2')).toBeTruthy()
      expect(within(cardOf('Dips')).queryByText(/SUPERSET/)).toBeNull()
      expect(screen.getAllByText(/SUPERSET/)).toHaveLength(2)
    })

    it('a second superset is B', () => {
      const pe4 = pe('pe-4', EX_LUNGE, 3, { supersetBlockId: 'blk-2' })
      const pe3b = { ...pe3, supersetBlockId: 'blk-2' }
      arrange([one('a1', 'pe-1'), one('b1', 'pe-2'), one('c1', 'pe-3'), one('d1', 'pe-4')], [pe1Blocked, pe2Blocked, pe3b, pe4])
      expect(within(cardOf('Dips')).getByText('SUPERSET B · 1')).toBeTruthy()
      expect(within(cardOf('Lunge')).getByText('SUPERSET B · 2')).toBeTruthy()
    })

    it('each member keeps its own add-set and its own rows (a layout change keeps every per-item action)', () => {
      arrange([one('a1', 'pe-1'), one('b1', 'pe-2'), one('c1', 'pe-3')], [pe1Blocked, pe2Blocked, pe3])
      for (const name of ['Bench Press', 'Squat', 'Dips']) {
        expect(within(cardOf(name)).getByLabelText(`Add set to ${name}`)).toBeTruthy()
        expect(within(cardOf(name)).getByLabelText('Options for set 1')).toBeTruthy()
      }
    })
  })
})

// ─── The set rows (boards 1 and 9) ────────────────────────────────────────────

describe('PlanPage — a set row (boards 1 and 9)', () => {
  it('a working set: its number, the weight in the exercise\'s unit, ×, the reps and "RIR n", and a ⋯', () => {
    arrange()

    // Bench Press's first working set is the staged one (100 kg × 8–12, RIR 2), under the warmup.
    const row = rowOf('01')
    expect(squash(row.textContent)).toBe(squash('01100kg × 8–12 RIR 2'))
    // weight, reps, RIR and the ⋯: four buttons, and no input until the weight is tapped
    expect(buttonsOf(row)).toHaveLength(4)
    expect(row.querySelector('input')).toBeNull()
    expect(within(row).getByLabelText('Options for set 1')).toBeTruthy()
  })

  it('warmups are W and the working sets are numbered from 01 over the working sets alone (board 1: W, 01, 02), a stage row ↳ under its head', () => {
    arrange()
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['W', '01', '↳', '↳', '02'])
    expect(labelsIn(cardOf('Squat'))).toEqual(['01'])
    // numbered by place on the card: W, 01 (staged), 02 (tagged)
    expect(squash(rowOf('01', 0).textContent)).toContain('100kg×8–12')
    expect(squash(rowOf('02', 0).textContent)).toContain('100kg×8RIR3')
  })

  it('numbers follow the sets\' own order, not the order the rows came in, and not their raw set numbers (a gap is not a number)', () => {
    const at = (id: string, setNumber: number, targetWeight: number) => setRow({ id, setNumber, targetWeight, repMin: 8, repMax: 8 })
    arrange([at('late', 7, 70), at('early', 1, 10), at('mid', 3, 30)], [pe1])
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['01', '02', '03'])
    expect(['01', '02', '03'].map((n) => squash(rowOf(n).textContent))).toEqual([
      squash('0110kg × 8 RIR 2'),
      squash('0230kg × 8 RIR 2'),
      squash('0370kg × 8 RIR 2'),
    ])
  })

  it('a set with nothing set shows a dash in each cell and "RIR –" (board 9, NOTHING SET)', () => {
    arrange([setRow({ id: 's', setNumber: 4, targetRir: null, targetWeight: null })], [pe1])
    const row = rowOf('01')
    expect(squash(row.textContent)).toBe(squash('01— × — RIR –'))
    expect(within(row).getByRole('button', { name: 'Set rep target' })).toBeTruthy()
  })

  it('a RIR range is "RIR 1–2" (board 1), AMRAP is "AMRAP", a range of reps an en dash', () => {
    arrange([setRow({ id: 's', setNumber: 1, targetRir: 1, targetRirMax: 2, repMin: null, repMax: null, isAmrap: true, targetWeight: 60 })], [pe1])
    expect(squash(rowOf('01').textContent)).toBe(squash('0160kg × AMRAP RIR 1–2'))
  })

  it('shows the weight in the exercise\'s own unit: 100 kg stored, lbs for an exercise set to lbs', () => {
    const lbs = pe('pe-1', EX_BENCH, 0, { weightUnit: 'lbs' })
    arrange([setRow({ id: 's', setNumber: 1, targetWeight: 100 })], [lbs])
    expect(within(rowOf('01')).getByRole('button', { name: '220.5lbs' })).toBeTruthy()
  })

  describe('a staged set', () => {
    it('has its kind chip over the head ("DROPSET · 2 DROPS") and a stage row under it per stage, each with its own numbers and no ⋯ (G55)', () => {
      arrange()
      expect(within(cardOf('Bench Press')).getByText('DROPSET · 2 DROPS')).toBeTruthy()
      const stage1 = rowOf('↳', 0)
      const stage2 = rowOf('↳', 1)
      expect(squash(stage1.textContent)).toBe(squash('↳80kg × 6 RIR 1'))
      expect(squash(stage2.textContent)).toBe(squash('↳60kg × 6 RIR 0'))
      expect(within(stage1).queryByLabelText(/^Options for /)).toBeNull()
      expect(within(stage2).queryByLabelText(/^Options for /)).toBeNull()
      expect(buttonsOf(stage1)).toHaveLength(3) // weight, reps, RIR
    })

    it('a legacy head with no stage_kind and stage rows reads as a dropset', () => {
      arrange(SETS.map((s) => (s.id === 'work' ? { ...s, stageKind: null } : s)), [pe1, pe2])
      expect(screen.getByText('DROPSET · 2 DROPS')).toBeTruthy()
    })

    it('shows each kind in its own noun, and one stage in the singular', () => {
      arrange([
        setRow({ id: 'h1', setNumber: 1, stageKind: 'rest_pause' }),
        setRow({ id: 'h1s', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'h1', stageIndex: 1 }),
        setRow({ id: 'h2', setNumber: 2, stageKind: 'myo_reps' }),
        setRow({ id: 'h2a', setNumber: 2, parentWeekPlanSetId: 'h2', stageIndex: 1 }),
        setRow({ id: 'h2b', setNumber: 2, parentWeekPlanSetId: 'h2', stageIndex: 2 }),
        setRow({ id: 'h3', setNumber: 3, stageKind: 'cluster' }),
        setRow({ id: 'h3s', setNumber: 3, parentWeekPlanSetId: 'h3', stageIndex: 1 }),
      ], [pe1])
      expect(screen.getByText('REST-PAUSE · 1 PAUSE')).toBeTruthy()
      expect(screen.getByText('MYO-REPS · 2 MINI-SETS')).toBeTruthy()
      expect(screen.getByText('CLUSTER · 1 CLUSTER')).toBeTruthy()
    })

    it('a plain set, and a warmup, have no kind chip', () => {
      arrange()
      expect(within(rowOf('02').parentElement as HTMLElement).queryByText(/·/)).toBeNull()
      expect(screen.getAllByText(/DROPSET|REST-PAUSE|MYO|CLUSTER|WARMUP/)).toHaveLength(1)
    })
  })

  describe('a warmup', () => {
    it('is W, has its weight and reps and no RIR cell (G49), and still has its ⋯', () => {
      arrange()
      const row = rowOf('W')
      expect(squash(row.textContent)).toBe(squash('W40kg × 10'))
      expect(within(row).queryByText(/RIR/)).toBeNull()
      expect(buttonsOf(row)).toHaveLength(3) // weight, reps, ⋯
      expect(within(row).getByLabelText('Options for warmup set 1')).toBeTruthy()
    })

    it('no row of a warmup draws a RIR cell, however many warmups there are', () => {
      arrange([
        setRow({ id: 'w1', setNumber: 1, isWarmup: true, targetRir: 3 }),
        setRow({ id: 'w2', setNumber: 2, isWarmup: true, targetRir: 3 }),
        setRow({ id: 'a', setNumber: 3 }),
      ], [pe1])
      expect(screen.getAllByText(/^RIR/)).toHaveLength(1)
    })
  })

  describe('cues', () => {
    it('a set that has a cue shows it as a chip under the row, as the cue\'s label (board 1: "Push here")', () => {
      arrange()
      expect(within(cardOf('Bench Press')).getAllByText('Push here')).toHaveLength(1)
    })

    it('every cue of a set is a chip of its own; a set with none shows nothing', () => {
      arrange([setRow({ id: 's', setNumber: 1, tags: ['push here', 'heavy day'] }), setRow({ id: 't', setNumber: 2 })], [pe1])
      expect(screen.getByText('Push here')).toBeTruthy()
      expect(screen.getByText('Heavy day')).toBeTruthy()
      expect(screen.getAllByText(/here|day/)).toHaveLength(2)
    })

    it('a stage row shows no cue', () => {
      arrange([
        setRow({ id: 'h', setNumber: 1, stageKind: 'dropset' }),
        setRow({ id: 's', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'h', stageIndex: 1, tags: ['push here'] }),
      ], [pe1])
      expect(screen.queryByText('Push here')).toBeNull()
    })
  })
})

// ─── What is gone (Checks that lied #32: test what must be absent) ───────────

describe('PlanPage — the week view has no exercise-level actions, no Sets / Structure views and no apply-ahead banner', () => {
  it('none of their words or labels is on the page, whatever a week holds', () => {
    arrange()
    const text = document.body.textContent ?? ''
    for (const gone of ['STRUCTURE', 'SWAP', 'MOVE UP', 'MOVE DOWN', 'REMOVE FROM THIS WEEK', 'ADD EXERCISE', 'ADD WARMUP SETS', 'ADD STAGE', 'STAGE KIND', 'MAKE THIS WEEK', 'APPLY THIS CHANGE', 'WARMUP ROUTINE', 'EVERY WEEK', 'COMPACT']) {
      expect(text).not.toContain(gone)
    }
    expect(screen.queryByText('SETS')).toBeNull()
    for (const label of [/^Swap /, /^Move (up|down)$/, /^Remove .* from this week$/, 'Add warmup sets', 'Add stage', 'Delete set', 'Delete stage', /^Mark this week/i]) {
      expect(screen.queryByLabelText(label)).toBeNull()
    }
    // The page's actions that stay: COPY, WEEK ⋯, the session's DELOAD toggle.
    expect(screen.getByLabelText('Week 2 options')).toBeTruthy()
  })

  it('opening every ⋯ of every row shows no exercise-level action either (those are CHANGE THE PROGRAM\'s)', () => {
    arrange()
    for (const button of screen.getAllByLabelText(/^Options for /)) {
      fireEvent.click(button)
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).queryByText(/swap|reorder|move up|add exercise|add warmup/i)).toBeNull()
      fireEvent.click(screen.getByLabelText('Close'))
    }
  })
})

// ─── Past weeks (read only) ───────────────────────────────────────────────────

describe('PlanPage — a past week\'s rows are drawn but dead', () => {
  function arrangePast() {
    // Started three weeks ago: the current week is 4. Week 1 is then past.
    mockState.meso = { ...activeMeso, startDate: format(subWeeks(new Date(), 3), 'yyyy-MM-dd') }
    mockState.all = [plan(1, SETS, [pe1, pe2]), plan(4, SETS, [pe1, pe2])]
    renderPlanPage()
    expect(screen.getByText('WEEK 4')).toBeTruthy()
    // On the current week every control is there ...
    expect(screen.getByLabelText('Add set to Bench Press')).toBeTruthy()
    expect(screen.getAllByLabelText(/^Options for /).length).toBeGreaterThan(0)
    // ... then open week 1's tile.
    openWeekTile('WEEK 1')
    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()
  }

  it('the numbers are there, every cell is disabled, and there is no "add set" and no ⋯', () => {
    arrangePast()

    expect(screen.queryByLabelText(/^Add set to /)).toBeNull()
    expect(screen.queryAllByLabelText(/^Options for /)).toHaveLength(0)
    expect(squash(rowOf('01').textContent)).toBe(squash('01100kg × 8–12 RIR 2'))
    for (const cell of buttonsOf(rowOf('01'))) expect((cell as HTMLButtonElement).disabled).toBe(true)
    for (const cell of buttonsOf(rowOf('↳', 0))) expect((cell as HTMLButtonElement).disabled).toBe(true)
    for (const cell of buttonsOf(rowOf('W'))) expect((cell as HTMLButtonElement).disabled).toBe(true)
    expect(buttonsOf(rowOf('01'))).toHaveLength(3) // weight, reps, RIR: no ⋯
  })

  it('a tap on a number opens nothing: no input, no sheet', () => {
    arrangePast()
    fireEvent.click(within(rowOf('01')).getByRole('button', { name: '100kg' }))
    fireEvent.click(within(rowOf('01')).getByRole('button', { name: '8–12' }))
    fireEvent.click(within(rowOf('01')).getByRole('button', { name: /^RIR/ }))
    expect(screen.queryByLabelText('Weight target')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the kind chip is dead too', () => {
    arrangePast()
    const chip = screen.getByText('DROPSET · 2 DROPS') as HTMLButtonElement
    expect(chip.disabled).toBe(true)
    fireEvent.click(chip)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// ─── Where a workout's row is, and what it is handed ──────────────────────────

describe('PlanPage — MOVE THIS SESSION is a row of the session ⋯\'s menu (chunk 54b, board 10)', () => {
  it('is not on the page until the menu is open; then it is given the workout, its plan row, the run and the week', () => {
    arrange()
    expect(screen.queryByTestId('move-session-stub')).toBeNull() // the button above the panel is gone
    openSessionMenu()
    const stub = screen.getByTestId('move-session-stub')
    expect(stub.getAttribute('data-workout')).toBe('wd-1')
    expect(stub.getAttribute('data-plan')).toBe('wp-2')
    expect(stub.getAttribute('data-meso')).toBe('meso-1')
    expect(stub.getAttribute('data-current')).toBe('true')
  })

  it('and the chips switch the workout whose cards are drawn, and whose menu opens', () => {
    mockState.program = makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1', thursday: 'wd-2' })
    mockState.days = [workoutDay, workoutDay2]
    const lunge = pe('pe-l', EX_LUNGE, 0, {}, 'wd-2')
    mockState.all = [
      plan(2, SETS, [pe1, pe2]), plan(2, [setRow({ id: 'l1', programExerciseId: 'pe-l', setNumber: 1, targetWeight: 30 })], [lunge], 'wd-2'),
    ]
    renderPlanPage()
    expect(screen.getByText('Bench Press')).toBeTruthy()
    expect(screen.queryByText('Lunge')).toBeNull()

    fireEvent.click(screen.getByText('THU'))
    expect(screen.getByText('Lunge')).toBeTruthy()
    expect(screen.queryByText('Bench Press')).toBeNull()
    openSessionMenu()
    expect(screen.getByTestId('move-session-stub').getAttribute('data-plan')).toBe('wp-2-wd-2')
  })
})

// ─── The page's own actions, above the cards (G17) ────────────────────────────

const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

describe('PlanPage — the page\'s actions sit above the cards, as the exercise cards replaced the two views (G17)', () => {
  it('COPY and WEEK ⋯ are above the workout chips, and the session ⋯ is above the first card', () => {
    mockState.all = [plan(1, SETS, [pe1, pe2]), plan(2, SETS, [pe1, pe2]), plan(3, [], [])]
    renderPlanPage()

    const copy = screen.getByText('COPY')
    const weekMenu = screen.getByLabelText('Week 2 options')
    const sessionMenu = sessionMenuButton() as HTMLElement

    expect(follows(copy, screen.getByText('MON'))).toBe(true)
    expect(follows(weekMenu, screen.getByText('MON'))).toBe(true)
    expect(follows(screen.getByText('MON'), sessionMenu)).toBe(true)
    expect(follows(sessionMenu, cardOf('Bench Press'))).toBe(true)
    // The page-level buttons the header replaced are gone.
    for (const gone of ['COPY WEEK', 'COPY THIS WORKOUT', 'MARK WEEK AS DELOAD']) expect(screen.queryByText(gone)).toBeNull()
  })

  it('the session menu\'s deload row marks the viewed workout\'s own plan row', () => {
    mockState.all = [plan(1, SETS, [pe1, pe2]), plan(2, SETS, [pe1, pe2]), plan(3, [], [])]
    renderPlanPage()

    fireEvent.click(sessionToggle())

    expect(setDeloadMutate).toHaveBeenCalledTimes(1)
    expect((setDeloadMutate.mock.calls[0][0] as { weekPlanId: string }).weekPlanId).toBe('wp-2')
  })
})

// ─── No apply-ahead (Checks that lied #32) ────────────────────────────────────

// The banner "APPLY THIS CHANGE TO N PLANNED WEEKS AHEAD?" followed every edit made on a week that had later weeks planned; it is gone with
// ApplyAheadOffer (chunk 54a; exercise-level changes and anything run-wide are CHANGE THE PROGRAM's). This walks every writer a set row has,
// on a week with week 3 planned ahead, and reads the page after each.
describe('PlanPage — an edit offers nothing to apply to the weeks planned ahead', () => {
  it('weight, reps, RIR, a type pick, a cue, "+" and REMOVE THIS SET: no banner, no APPLY, no "planned week" wording', () => {
    mockState.all = [plan(2, SETS, [pe1, pe2]), plan(3, SETS.map((s) => ({ ...s, weekPlanId: 'wp-3' })), [pe1, pe2])]
    renderPlanPage()
    const nothingOffered = () => {
      expect(screen.queryByText(/APPLY THIS CHANGE/)).toBeNull()
      expect(screen.queryByText('APPLY')).toBeNull()
      expect(screen.queryByText(/PLANNED WEEK/)).toBeNull()
      expect(screen.queryByLabelText('Dismiss')).toBeNull()
    }
    const picker = (name: string) => within(screen.getByRole('dialog', { name }))

    // weight (Squat's set, typed)
    fireEvent.click(within(cardOf('Squat')).getByRole('button', { name: '120kg' }))
    fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '125' } })
    fireEvent.blur(screen.getByLabelText('Weight target'))
    expect(updateSetMutate).toHaveBeenCalledTimes(1)
    nothingOffered()

    // reps
    fireEvent.click(within(cardOf('Squat')).getByRole('button', { name: '5' }))
    fireEvent.click(picker('Rep target').getByRole('button', { name: 'AMRAP' }))
    fireEvent.click(picker('Rep target').getByRole('button', { name: 'SET AMRAP' }))
    expect(updateSetMutate).toHaveBeenCalledTimes(2)
    nothingOffered()

    // RIR
    fireEvent.click(within(cardOf('Squat')).getByRole('button', { name: 'RIR 2' }))
    fireEvent.click(picker('RIR target').getByRole('button', { name: 'NONE' }))
    fireEvent.click(picker('RIR target').getByRole('button', { name: 'CLEAR TARGET' }))
    expect(updateSetMutate).toHaveBeenCalledTimes(3)
    nothingOffered()

    // a type pick, a cue, and the removal, from the set type picker
    fireEvent.click(within(cardOf('Squat')).getByLabelText('Options for set 1'))
    fireEvent.click(picker('What is this set?').getByRole('button', { name: /^Dropset/ }))
    expect(changeTypeMutate).toHaveBeenCalledTimes(1)
    nothingOffered()
    fireEvent.click(picker('What is this set?').getByText('Cues'))
    fireEvent.click(picker('Cues for this set').getByRole('checkbox', { name: 'Push here' }))
    fireEvent.click(picker('Cues for this set').getByRole('button', { name: 'DONE' }))
    expect(updateSetMutate).toHaveBeenCalledTimes(4)
    nothingOffered()
    fireEvent.click(picker('What is this set?').getByText('REMOVE THIS SET'))
    expect(removeSetMutate).toHaveBeenCalledTimes(1)
    nothingOffered()

    // "+"
    fireEvent.click(screen.getByLabelText('Add set to Squat'))
    expect(addSetMutate).toHaveBeenCalledTimes(1)
    nothingOffered()
  })
})

// ─── A workout with no plan row this week ────────────────────────────────────

describe('PlanPage — a workout that has no plan row this week draws its exercises and nothing to press', () => {
  it('Thursday\'s Lunge comes from the run\'s copy: its card is there with no "+", and nothing is written for a week it has no row in', () => {
    mockState.program = makeProgram({ ...EMPTY_SCHEDULE, monday: 'wd-1', thursday: 'wd-2' })
    mockState.days = [workoutDay, workoutDay2]
    mockState.runCopy = { 'wd-2': [pe('pe-l', EX_LUNGE, 0, {}, 'wd-2')] }
    mockState.all = [plan(2, SETS, [pe1, pe2])] // Monday's plan only: Thursday has none this week
    renderPlanPage()

    fireEvent.click(screen.getByText('THU'))

    expect(screen.getByText('Lunge')).toBeTruthy()
    expect(screen.queryByLabelText('Add set to Lunge')).toBeNull()
    expect(screen.queryAllByLabelText(/^Options for /)).toHaveLength(0)
    expect(sessionMenuButton()).toBeNull() // the session toggle needs a row too
    expect(addSetMutate).not.toHaveBeenCalled()
  })
})
