// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 54a (TASKS-1.2 "Plan's week view": "RIR → RirTargetPicker (writes target_rir + target_rir_max; 'Use for all' skips warmups; AMRAP's RIR 0
// default kept)"; SPEC Targets [1.2]: "RIR is a number or a range"; G49: a warmup row has no RIR). The RIR cell opens the RIR target picker, which
// writes nothing: its footer returns a target and whether "Use for all" was ticked, and this is where that becomes week set writes. Through the
// real PlanPage tree with the data hooks mocked (the seam every PlanPage test file uses); what each pick reaches `useUpdateSet` with is asserted.
//
// Break proofs (the report): the range writes only the low end; a number leaves the old high end (no `targetRirMax: null`); "Use for all"
// includes a warmup; "Use for all" includes the stage rows; the stage row's picker is given the heads.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const startDate = format(subWeeks(new Date(), 1), 'yyyy-MM-dd')
const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const EX_BENCH: Exercise = {
  id: 'ex-bench', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '',
  muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
const PE_BENCH: ProgramExercise = { id: 'pe-bench', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-bench', position: 0, weightUnit: null, exercise: EX_BENCH }
const PE_ROW: ProgramExercise = { ...PE_BENCH, id: 'pe-row', position: 1, exercise: { ...EX_BENCH, id: 'ex-row', name: 'Row', muscleGroup: 'back' } }

function setRow(over: Partial<WeekPlanSet>): WeekPlanSet {
  return {
    id: 'x', weekPlanId: 'wp-2', userId: 'user-1', programExerciseId: 'pe-bench', setNumber: 1, targetRir: 2,
    isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null, ...over,
  }
}
const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' }, workoutDays: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent',
}
const mockState: { all: WeekPlan[] } = { all: [] }
const updateSetMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
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
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

afterEach(() => {
  mockState.all = []
  updateSetMutate.mockClear()
})

function arrange(sets: WeekPlanSet[], exercises: ProgramExercise[] = [PE_BENCH]) {
  mockState.all = [{
    id: 'wp-2', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2,
    isDeload: false, notes: null, sets, exercises, createdAt: '2026-01-01T00:00:00Z',
  }]
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

const picker = () => within(screen.getByRole('dialog', { name: 'RIR target' }))
const segment = (name: string) => picker().getByRole('button', { name })
const pressed = () => Array.from(picker().getByRole('group', { name: 'Kind of target' }).querySelectorAll('button[aria-pressed="true"]')).map((b) => b.textContent)
const box = (name: string) => picker().getByRole('textbox', { name }) as HTMLInputElement
const typeInto = (name: string, value: string) => fireEvent.change(box(name), { target: { value } })
const useForAll = () => picker().queryByRole('checkbox', { name: /^Use for all/ })
const submit = (name: string) => fireEvent.click(picker().getByRole('button', { name }))
const rirCell = (nth = 0) => screen.getAllByRole('button', { name: /^RIR/ })[nth]
const written = () => updateSetMutate.mock.calls.map(([vars]) => vars as { id: string; changes: Record<string, unknown> })

describe('PlanPage — the RIR cell opens the RIR target picker, on the set\'s own target', () => {
  it('a number opens on NUMBER with its value, a range on RANGE with both ends, no target on NONE', () => {
    arrange([
      setRow({ id: 'n', setNumber: 1, targetRir: 3 }),
      setRow({ id: 'r', setNumber: 2, targetRir: 1, targetRirMax: 2 }),
      setRow({ id: 'z', setNumber: 3, targetRir: null }),
    ])

    fireEvent.click(rirCell(0))
    expect(pressed()).toEqual(['NUMBER'])
    expect(box('REPS IN RESERVE').value).toBe('3')
    fireEvent.click(screen.getByLabelText('Close'))

    fireEvent.click(rirCell(1))
    expect(pressed()).toEqual(['RANGE'])
    expect([box('From').value, box('To').value]).toEqual(['1', '2'])
    fireEvent.click(screen.getByLabelText('Close'))

    fireEvent.click(rirCell(2))
    expect(pressed()).toEqual(['NONE'])
  })

  it('the cell reads the range as "RIR 1–2" and a set with none as "RIR –"', () => {
    arrange([setRow({ id: 'r', setNumber: 1, targetRir: 1, targetRirMax: 2 }), setRow({ id: 'z', setNumber: 2, targetRir: null })])
    expect(screen.getByRole('button', { name: 'RIR 1–2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'RIR –' })).toBeTruthy()
  })

  it('the eyebrow names the exercise, the set by its number on the page (the first working set after a warmup is SET 01) and the week', () => {
    arrange([setRow({ id: 'w', setNumber: 1, isWarmup: true, targetRir: null }), setRow({ id: 'a', setNumber: 2 })])
    fireEvent.click(rirCell(0))
    expect(picker().getByText('Bench Press · SET 01 · WEEK 2')).toBeTruthy()
  })

  it('closing it any other way than the footer button writes nothing', () => {
    arrange([setRow({ id: 'a', setNumber: 1, targetRir: 2 })])
    fireEvent.click(rirCell(0))
    fireEvent.click(segment('NONE'))
    fireEvent.click(screen.getByLabelText('Close'))
    expect(updateSetMutate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'RIR 2' })).toBeTruthy()
  })
})

describe('PlanPage — the RIR picker writes target_rir and target_rir_max together (042; SPEC Targets [1.2]: a number or a range)', () => {
  it('RANGE writes { targetRir: 1, targetRirMax: 2 }', () => {
    arrange([setRow({ id: 'a', setNumber: 1, targetRir: 3 })])

    fireEvent.click(rirCell())
    fireEvent.click(segment('RANGE'))
    typeInto('From', '1')
    typeInto('To', '2')
    submit('SET RIR 1–2')

    expect(written()).toEqual([{ id: 'a', changes: { targetRir: 1, targetRirMax: 2 } }])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('NUMBER writes the number with targetRirMax: null — a range it replaces does not keep its old high end', () => {
    arrange([setRow({ id: 'a', setNumber: 1, targetRir: 1, targetRirMax: 2 })])

    fireEvent.click(rirCell())
    fireEvent.click(segment('NUMBER'))
    typeInto('REPS IN RESERVE', '3')
    submit('SET RIR 3')

    expect(written()).toEqual([{ id: 'a', changes: { targetRir: 3, targetRirMax: null } }])
    // the key is named, with null: `'targetRirMax' in changes` is what makes the service write the column
    expect('targetRirMax' in written()[0].changes).toBe(true)
  })

  it('NONE clears both ends', () => {
    arrange([setRow({ id: 'a', setNumber: 1, targetRir: 1, targetRirMax: 2 })])

    fireEvent.click(rirCell())
    fireEvent.click(segment('NONE'))
    submit('CLEAR TARGET')

    expect(written()).toEqual([{ id: 'a', changes: { targetRir: null, targetRirMax: null } }])
  })

  it('picking the target the set already holds writes nothing (a number 2 is not a range, and 1–2 is not 1)', () => {
    arrange([setRow({ id: 'a', setNumber: 1, targetRir: 1, targetRirMax: 2 })])
    fireEvent.click(rirCell())
    submit('SET RIR 1–2')
    expect(updateSetMutate).not.toHaveBeenCalled()
  })

  // Chunk 54a's review (R54-I1): the test above holds the whole target (1–2 to 1–2); a set that differs in its high end only is the case that tells
  // a check on both ends from a check on the low one.
  it('a range that differs from the set\'s only in its high end is written: 1–3 picked to 1–2 writes both ends (break: the "already holds it" check compares the low end only)', () => {
    arrange([setRow({ id: 'a', setNumber: 1, targetRir: 1, targetRirMax: 3 })])

    fireEvent.click(rirCell())
    expect(pressed()).toEqual(['RANGE'])
    expect([box('From').value, box('To').value]).toEqual(['1', '3'])
    typeInto('To', '2')
    submit('SET RIR 1–2')

    expect(written()).toEqual([{ id: 'a', changes: { targetRir: 1, targetRirMax: 2 } }])
  })

  it('RIR 0 is a target like any other: a number 0 is written, not read as none', () => {
    arrange([setRow({ id: 'a', setNumber: 1, targetRir: null })])
    fireEvent.click(rirCell())
    fireEvent.click(segment('NUMBER'))
    typeInto('REPS IN RESERVE', '0')
    submit('SET RIR 0')
    expect(written()).toEqual([{ id: 'a', changes: { targetRir: 0, targetRirMax: null } }])
  })
})

describe('PlanPage — "Use for all" on the RIR picker (G49: a warmup has no RIR target)', () => {
  const week = () => [
    setRow({ id: 'warm', setNumber: 1, isWarmup: true, targetRir: null }),
    setRow({ id: 'a', setNumber: 2, targetRir: 3 }),
    setRow({ id: 'a-stage', setNumber: 2, isDropset: true, parentWeekPlanSetId: 'a', stageIndex: 1, targetRir: 0 }),
    setRow({ id: 'b', setNumber: 3, targetRir: 3 }),
    setRow({ id: 'c', setNumber: 4, targetRir: 1, targetRirMax: 2 }),
  ]

  it('starts ticked, counts the working sets alone, and writes every working head — never the warmup, never a stage — except one that already holds the target', () => {
    arrange(week())

    fireEvent.click(rirCell(0)) // set 01: the first working set (the warmup has no RIR cell)
    expect(useForAll()?.getAttribute('aria-checked')).toBe('true')
    expect(useForAll()?.textContent).toContain('Use for all 3 sets of Bench Press')
    fireEvent.click(segment('RANGE'))
    typeInto('From', '1')
    typeInto('To', '2')
    submit('SET RIR 1–2')

    expect(written()).toEqual([
      { id: 'a', changes: { targetRir: 1, targetRirMax: 2 } },
      { id: 'b', changes: { targetRir: 1, targetRirMax: 2 } },
      // not 'c' (1–2 already), not 'warm' (no RIR target), not 'a-stage'
    ])
  })

  it('a warmup with a stale RIR is not written either, whatever it holds', () => {
    arrange([setRow({ id: 'warm', setNumber: 1, isWarmup: true, targetRir: 4 }), setRow({ id: 'a', setNumber: 2 }), setRow({ id: 'b', setNumber: 3 })])

    fireEvent.click(rirCell(0))
    fireEvent.click(segment('NONE'))
    submit('CLEAR TARGET')

    expect(written().map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('unticked, it writes this set alone', () => {
    arrange(week())

    fireEvent.click(rirCell(2)) // set 02, 'b' (the cells: a, a's stage, b, c)
    fireEvent.click(useForAll() as HTMLElement)
    fireEvent.click(segment('NONE'))
    submit('CLEAR TARGET')

    expect(written()).toEqual([{ id: 'b', changes: { targetRir: null, targetRirMax: null } }])
  })

  it('is not drawn where it has nowhere to go: one working set beside a warmup', () => {
    arrange([setRow({ id: 'warm', setNumber: 1, isWarmup: true, targetRir: null }), setRow({ id: 'a', setNumber: 2 })])
    fireEvent.click(rirCell(0))
    expect(useForAll()).toBeNull()
  })

  it('stays inside its own exercise: the second exercise\'s sets are written only from the second exercise\'s picker', () => {
    arrange(
      [
        setRow({ id: 'a1', setNumber: 1, targetRir: 3 }), setRow({ id: 'a2', setNumber: 2, targetRir: 3 }),
        setRow({ id: 'r1', programExerciseId: 'pe-row', setNumber: 1, targetRir: 3 }), setRow({ id: 'r2', programExerciseId: 'pe-row', setNumber: 2, targetRir: 3 }),
        setRow({ id: 'r3', programExerciseId: 'pe-row', setNumber: 3, targetRir: 3 }),
      ],
      [PE_BENCH, PE_ROW],
    )

    fireEvent.click(rirCell(2)) // Row's first set (Bench Press has two RIR cells before it)
    expect(useForAll()?.textContent).toContain('Use for all 3 sets of Row')
    fireEvent.click(segment('NONE'))
    submit('CLEAR TARGET')

    expect(written().map((w) => w.id)).toEqual(['r1', 'r2', 'r3'])
  })
})

describe('PlanPage — a stage row\'s RIR, and a warmup row\'s absence of one', () => {
  it('a stage row has its own RIR cell and picker: it writes that stage alone and offers no "Use for all"', () => {
    arrange([
      setRow({ id: 'h', setNumber: 1, stageKind: 'dropset', targetRir: 2 }),
      setRow({ id: 'h1', setNumber: 1, isDropset: true, parentWeekPlanSetId: 'h', stageIndex: 1, targetRir: 0 }),
      setRow({ id: 'g', setNumber: 2, targetRir: 2 }),
    ])

    const stageRow = screen.getByText('↳').parentElement as HTMLElement
    fireEvent.click(within(stageRow).getByRole('button', { name: 'RIR 0' }))
    expect(useForAll()).toBeNull()
    expect(picker().getByText('Bench Press · SET 01 · WEEK 2')).toBeTruthy() // the stage belongs to set 01
    fireEvent.click(segment('NUMBER'))
    typeInto('REPS IN RESERVE', '1')
    submit('SET RIR 1')

    expect(written()).toEqual([{ id: 'h1', changes: { targetRir: 1, targetRirMax: null } }])
  })

  it('a warmup row has no RIR cell (G49), so no RIR picker to open from it — only the working sets\' cells open one', () => {
    arrange([setRow({ id: 'warm', setNumber: 1, isWarmup: true, targetRir: 3 }), setRow({ id: 'a', setNumber: 2 })])

    const warmRow = screen.getByText('W').parentElement as HTMLElement
    expect(within(warmRow).queryByRole('button', { name: /^RIR/ })).toBeNull()
    expect(within(warmRow).queryByText('RIR')).toBeNull()
    expect(screen.getAllByRole('button', { name: /^RIR/ })).toHaveLength(1)
  })
})
