// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { format, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay } from '../../types'
import { queryClient } from '../../lib/queryClient'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { createFakeWeekSetsDb, fakePlan, fakeSet, fakeStage, type FakeExerciseCard, type FakeSetRow } from './fakeWeekSetsDb.testutil'

// Chunk 54a (TASKS-1.2 "Plan's week view: exercise cards and set rows on the pickers"): every writer of the set rows, END TO END. It mocks
// nothing of Plan's own code: the real PlanPage, the real useWeekPlan.ts hooks (useUpdateSet, useAddSet, useRemoveSet, useChangeSetType, with
// their optimistic patches, their invalidations and their rollbacks) and the real weekPlanService.ts run against a stateful in-memory database
// (fakeWeekSetsDb.testutil.ts) that APPLIES the writes, so the page refetches what a user would see, and ENFORCES the checks and the cascade the
// real table has (the stage-row check, the rep and amrap checks, migration 042's RIR range check, the parent key), with a control that refuses a
// write. The assertions are on the requests that reach the database client, on the rows it holds after, and on what the screen then reads.
//
// What the screen tests with mocked hooks (PlanPage.*.test.tsx) cannot see, this can: that the requests are well formed for the table (a
// number RIR written without clearing the range's old high end is refused by the check; a stage row given a stage_kind is refused), that the
// order of a type change leaves a consistent set when it is cut short, and that a refused write leaves the screen showing the database.
//
// The fixture tells the right data source from the wrong one: Bench Press and Squat repeat set numbers; Bench Press has a warmup, a staged working
// set (two drops), a cued one and a plain one; the stage rows carry numbers of their own.
//
// Break proofs (the report): see the per-writer notes below.

afterEach(() => {
  cleanup()
  queryClient.clear()
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const startDate = format(subWeeks(new Date(), 1), 'yyyy-MM-dd') // the current week is week 2
const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' }, workoutDays: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent',
}

let db = createFakeWeekSetsDb({ plans: [], sets: [], cards: [] })

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => (db.client.from as (t: string) => unknown)(table),
    rpc: (name: string, args: unknown) => db.client.rpc(name, args),
  },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
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
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

// ─── The world ────────────────────────────────────────────────────────────────

const WP = 'wp-2'
const CARDS: FakeExerciseCard[] = [
  { week_plan_id: WP, program_exercise_id: 'pe-bench', position: 0, exercise_id: 'ex-bench', name: 'Bench Press', muscle_group: 'chest' },
  { week_plan_id: WP, program_exercise_id: 'pe-squat', position: 1, exercise_id: 'ex-squat', name: 'Squat', muscle_group: 'quads' },
]
const bench = (id: string, setNumber: number, over: Partial<FakeSetRow> = {}) => fakeSet(WP, id, setNumber, { program_exercise_id: 'pe-bench', ...over })
const benchStage = (id: string, parent: string, setNumber: number, stageIndex: number, over: Partial<FakeSetRow> = {}) =>
  fakeStage(WP, id, parent, setNumber, stageIndex, { program_exercise_id: 'pe-bench', ...over })

// Bench Press: W (warmup 40 × 10, no RIR) · 01 (the staged set, 100 × 8–12 RIR 2, drops 80 and 60) · 02 (100 × 8–12 RIR 3, cued) · 03 (105 × 8–12 RIR 2).
// Squat: 01 (120 × 5, RIR 2) — set numbers repeat across the two exercises.
function world(): FakeSetRow[] {
  return [
    bench('warm', 1, { is_warmup: true, target_weight: 40, rep_min: 10, rep_max: 10 }),
    bench('a', 2, { stage_kind: 'dropset', target_weight: 100, rep_min: 8, rep_max: 12, target_rir: 2 }),
    benchStage('a1', 'a', 2, 1, { target_weight: 80, rep_min: 6, rep_max: 6, target_rir: 1 }),
    benchStage('a2', 'a', 2, 2, { target_weight: 60, rep_min: 6, rep_max: 6, target_rir: 0 }),
    bench('b', 3, { target_weight: 100, rep_min: 8, rep_max: 12, target_rir: 3, tags: ['push here'] }),
    bench('c', 4, { target_weight: 105, rep_min: 8, rep_max: 12, target_rir: 2 }),
    fakeSet(WP, 'q1', 1, { program_exercise_id: 'pe-squat', target_weight: 120, rep_min: 5, rep_max: 5, target_rir: 2 }),
  ]
}

function arrange(sets: FakeSetRow[] = world()) {
  db = createFakeWeekSetsDb({ plans: [fakePlan(WP, 2)], sets, cards: CARDS })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const FOUND = { timeout: 5000 }
const row = (id: string) => db.state.sets.find((s) => s.id === id)
const rowsOfBench = () => db.state.sets.filter((s) => s.program_exercise_id === 'pe-bench')
const stagesOf = (id: string) => db.state.sets.filter((s) => s.parent_week_plan_set_id === id).sort((x, y) => x.stage_index - y.stage_index)
const setWrites = () => db.writes.filter((w) => w.table === 'v2_week_plan_sets')
const setWriteSummary = () => setWrites().map((w) => [w.method, w.eq ? (w.eq[0]?.[1] as string) : '(insert)'])
const cardOf = (name: string) => screen.getByText(name).closest('[data-exercise-card]') as HTMLElement
const labelsIn = (card: HTMLElement) =>
  Array.from(card.querySelectorAll('div'))
    .map((div) => div.firstElementChild)
    .filter((first): first is HTMLSpanElement => first?.tagName === 'SPAN' && /^(W|\d\d|↳)$/.test(first.textContent ?? ''))
    .map((first) => first.textContent)
const inBench = () => within(cardOf('Bench Press'))
const rowAt = (label: string, nth = 0) => inBench().getAllByText(label)[nth].parentElement as HTMLElement
const dialog = (name: string) => within(screen.getByRole('dialog', { name }))
const settled = async () => {
  await waitFor(() => expect(queryClient.isMutating() + queryClient.isFetching()).toBe(0), FOUND)
}

async function ready() {
  await screen.findByText('Bench Press', {}, FOUND)
}

// ─── Reps ─────────────────────────────────────────────────────────────────────

describe('end to end — the rep target picker writes rep_min / rep_max / is_amrap to the week sets', () => {
  it('"Use for all" sets every head of Bench Press — the warmup too, never a stage row, never Squat — and the screen reads them back', async () => {
    arrange()
    await ready()

    fireEvent.click(within(rowAt('01')).getByRole('button', { name: '8–12' }))
    expect(dialog('Rep target').getByRole('checkbox', { name: 'Use for all 4 sets of Bench Press' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.change(dialog('Rep target').getByRole('textbox', { name: 'From' }), { target: { value: '4' } })
    fireEvent.change(dialog('Rep target').getByRole('textbox', { name: 'To' }), { target: { value: '6' } })
    fireEvent.click(dialog('Rep target').getByRole('button', { name: 'SET 4–6 REPS' }))
    await settled()

    for (const id of ['warm', 'a', 'b', 'c']) expect([id, row(id)?.rep_min, row(id)?.rep_max, row(id)?.is_amrap]).toEqual([id, 4, 6, false])
    expect([row('a1')?.rep_min, row('a1')?.rep_max]).toEqual([6, 6]) // the drops keep their own
    expect([row('a2')?.rep_min, row('a2')?.rep_max]).toEqual([6, 6])
    expect([row('q1')?.rep_min, row('q1')?.rep_max]).toEqual([5, 5]) // Squat is another exercise
    // exactly one request per head that changed, each naming its columns and nothing else
    expect(setWrites().map((w) => w.args[0])).toEqual([
      { rep_min: 4, rep_max: 6, is_amrap: false },
      { rep_min: 4, rep_max: 6, is_amrap: false },
      { rep_min: 4, rep_max: 6, is_amrap: false },
      { rep_min: 4, rep_max: 6, is_amrap: false },
    ])
    expect(setWrites().map((w) => w.eq?.[0]?.[1])).toEqual(['warm', 'a', 'b', 'c'])
    // the screen reads the new target back from the database
    expect(within(rowAt('W')).getByRole('button', { name: '4–6' })).toBeTruthy()
    expect(within(rowAt('02')).getByRole('button', { name: '4–6' })).toBeTruthy()
    expect(within(rowAt('↳')).getByRole('button', { name: '6' })).toBeTruthy()
  })

  it('AMRAP on a head with no RIR writes RIR 0 in the same request; the database accepts it (is_amrap with no numbers)', async () => {
    arrange([bench('x', 1, { rep_min: 8, rep_max: 8, target_rir: null }), bench('y', 2, { rep_min: 8, rep_max: 8, target_rir: 2 })])
    await ready()

    fireEvent.click(within(rowAt('01')).getByRole('button', { name: '8' }))
    fireEvent.click(dialog('Rep target').getByRole('checkbox', { name: /^Use for all/ })) // this set alone
    fireEvent.click(dialog('Rep target').getByRole('button', { name: 'AMRAP' }))
    fireEvent.click(dialog('Rep target').getByRole('button', { name: 'SET AMRAP' }))
    await settled()

    expect(setWrites().map((w) => w.args[0])).toEqual([{ rep_min: null, rep_max: null, is_amrap: true, target_rir: 0 }])
    expect([row('x')?.rep_min, row('x')?.rep_max, row('x')?.is_amrap, row('x')?.target_rir]).toEqual([null, null, true, 0])
    expect(within(rowAt('01')).getByRole('button', { name: 'AMRAP' })).toBeTruthy()
    expect(within(rowAt('01')).getByRole('button', { name: 'RIR 0' })).toBeTruthy()
    expect([row('y')?.is_amrap, row('y')?.target_rir]).toEqual([false, 2])
  })

  it('a rep target the database refuses is not kept by the screen: the optimistic row goes back to the stored one', async () => {
    arrange([bench('x', 1, { rep_min: 8, rep_max: 8 }), bench('y', 2, { rep_min: 8, rep_max: 8 })])
    await ready()
    db.refuse = (write) => (write.op === 'update' ? 'new row violates row-level security policy for table "v2_week_plan_sets"' : null)

    fireEvent.click(within(rowAt('01')).getByRole('button', { name: '8' }))
    fireEvent.click(dialog('Rep target').getByRole('checkbox', { name: /^Use for all/ }))
    fireEvent.click(dialog('Rep target').getByRole('button', { name: 'RANGE' }))
    fireEvent.click(dialog('Rep target').getByRole('button', { name: 'SET 8–10 REPS' }))
    await settled()

    expect(row('x')?.rep_max).toBe(8)
    expect(within(rowAt('01')).getByRole('button', { name: '8' })).toBeTruthy() // the stored target, not the picked one
    expect(screen.queryByRole('button', { name: '8–10' })).toBeNull()
  })
})

// ─── RIR ──────────────────────────────────────────────────────────────────────

describe('end to end — the RIR picker writes target_rir and target_rir_max together, and the database\'s range check accepts what it writes', () => {
  it('RANGE 1–2 writes (1, 2); then NUMBER 3 writes (3, null) — a 3 written beside the old high end 2 would break the check', async () => {
    arrange()
    await ready()

    fireEvent.click(within(rowAt('02')).getByRole('button', { name: 'RIR 3' }))
    fireEvent.click(dialog('RIR target').getByRole('checkbox', { name: /^Use for all/ })) // this set alone
    fireEvent.click(dialog('RIR target').getByRole('button', { name: 'RANGE' }))
    fireEvent.change(dialog('RIR target').getByRole('textbox', { name: 'From' }), { target: { value: '1' } })
    fireEvent.change(dialog('RIR target').getByRole('textbox', { name: 'To' }), { target: { value: '2' } })
    fireEvent.click(dialog('RIR target').getByRole('button', { name: 'SET RIR 1–2' }))
    await settled()

    expect([row('b')?.target_rir, row('b')?.target_rir_max]).toEqual([1, 2])
    expect(setWrites().map((w) => w.args[0])).toEqual([{ target_rir: 1, target_rir_max: 2 }])
    expect(within(rowAt('02')).getByRole('button', { name: 'RIR 1–2' })).toBeTruthy()

    fireEvent.click(within(rowAt('02')).getByRole('button', { name: 'RIR 1–2' }))
    fireEvent.click(dialog('RIR target').getByRole('checkbox', { name: /^Use for all/ }))
    fireEvent.click(dialog('RIR target').getByRole('button', { name: 'NUMBER' }))
    fireEvent.change(dialog('RIR target').getByRole('textbox', { name: 'REPS IN RESERVE' }), { target: { value: '3' } })
    fireEvent.click(dialog('RIR target').getByRole('button', { name: 'SET RIR 3' }))
    await settled()

    expect([row('b')?.target_rir, row('b')?.target_rir_max]).toEqual([3, null])
    expect(setWrites()[1].args[0]).toEqual({ target_rir: 3, target_rir_max: null })
    expect(within(rowAt('02')).getByRole('button', { name: 'RIR 3' })).toBeTruthy()
  })

  it('"Use for all" never writes the warmup: its row (no RIR) is untouched, as are the drops and Squat', async () => {
    arrange()
    await ready()

    fireEvent.click(within(rowAt('02')).getByRole('button', { name: 'RIR 3' }))
    expect(dialog('RIR target').getByRole('checkbox', { name: 'Use for all 3 sets of Bench Press' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(dialog('RIR target').getByRole('button', { name: 'RANGE' }))
    fireEvent.change(dialog('RIR target').getByRole('textbox', { name: 'From' }), { target: { value: '1' } })
    fireEvent.change(dialog('RIR target').getByRole('textbox', { name: 'To' }), { target: { value: '2' } })
    fireEvent.click(dialog('RIR target').getByRole('button', { name: 'SET RIR 1–2' }))
    await settled()

    for (const id of ['a', 'b', 'c']) expect([id, row(id)?.target_rir, row(id)?.target_rir_max]).toEqual([id, 1, 2])
    expect([row('warm')?.target_rir, row('warm')?.target_rir_max]).toEqual([null, null])
    expect([row('a1')?.target_rir, row('a2')?.target_rir]).toEqual([1, 0])
    expect(row('q1')?.target_rir).toBe(2)
    expect(setWrites().map((w) => w.eq?.[0]?.[1])).toEqual(['a', 'b', 'c'])
  })

  it('NONE clears both ends', async () => {
    arrange([bench('x', 1, { target_rir: 1, target_rir_max: 2 }), bench('y', 2, { target_rir: 1, target_rir_max: 2 })])
    await ready()

    fireEvent.click(within(rowAt('01')).getByRole('button', { name: 'RIR 1–2' }))
    fireEvent.click(dialog('RIR target').getByRole('checkbox', { name: /^Use for all/ }))
    fireEvent.click(dialog('RIR target').getByRole('button', { name: 'NONE' }))
    fireEvent.click(dialog('RIR target').getByRole('button', { name: 'CLEAR TARGET' }))
    await settled()

    expect([row('x')?.target_rir, row('x')?.target_rir_max]).toEqual([null, null])
    expect(within(rowAt('01')).getByRole('button', { name: 'RIR –' })).toBeTruthy()
  })
})

// ─── Weight ───────────────────────────────────────────────────────────────────

describe('end to end — the weight is typed in the exercise\'s unit and stored in kg', () => {
  it('102.5 writes target_weight 102.5; blank clears it; a refused write leaves the screen on the stored weight', async () => {
    arrange([bench('x', 1, { target_weight: 100 })])
    await ready()

    fireEvent.click(within(rowAt('01')).getByRole('button', { name: '100kg' }))
    fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '102.5' } })
    fireEvent.blur(screen.getByLabelText('Weight target'))
    await settled()
    expect(row('x')?.target_weight).toBe(102.5)
    expect(setWrites().map((w) => w.args[0])).toEqual([{ target_weight: 102.5 }])
    expect(within(rowAt('01')).getByRole('button', { name: '102.5kg' })).toBeTruthy()

    fireEvent.click(within(rowAt('01')).getByRole('button', { name: '102.5kg' }))
    fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '' } })
    fireEvent.blur(screen.getByLabelText('Weight target'))
    await settled()
    expect(row('x')?.target_weight).toBeNull()
    expect(within(rowAt('01')).getByRole('button', { name: '—' })).toBeTruthy()

    db.refuse = () => 'new row violates row-level security policy'
    fireEvent.click(within(rowAt('01')).getByRole('button', { name: '—' }))
    fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '90' } })
    fireEvent.blur(screen.getByLabelText('Weight target'))
    await settled()
    expect(row('x')?.target_weight).toBeNull()
    expect(within(rowAt('01')).getByRole('button', { name: '—' })).toBeTruthy() // 90 was not kept
  })
})

// ─── Set type ─────────────────────────────────────────────────────────────────

describe('end to end — the set type picker\'s writes, in order, against the stage-row check and the cascade', () => {
  const openPicker = (setNumber: string) => fireEvent.click(within(rowAt(setNumber)).getByLabelText(/^Options for /))
  const pick = (name: string) => fireEvent.click(dialog('What is this set?').getByRole('button', { name: new RegExp(`^${name}`) }))

  it('Dropset on a plain set writes stage_kind "dropset" on the head, then inserts one stage row under it, numbered as the head, index 1', async () => {
    arrange()
    await ready()

    openPicker('03')
    pick('Dropset')
    await settled()

    expect(row('c')?.stage_kind).toBe('dropset')
    const stages = stagesOf('c')
    expect(stages.map((s) => [s.stage_index, s.set_number, s.is_dropset, s.stage_kind, s.program_exercise_id, s.week_plan_id])).toEqual([[1, 4, true, null, 'pe-bench', WP]])
    expect(setWriteSummary()).toEqual([['update', 'c'], ['insert', '(insert)']])
    expect(setWrites()[0].args[0]).toEqual({ stage_kind: 'dropset' })
    expect(setWrites()[1].args[0]).toEqual({
      week_plan_id: WP, user_id: 'user-1', program_exercise_id: 'pe-bench', set_number: 4, target_rir: null, is_dropset: true, parent_week_plan_set_id: 'c', stage_index: 1,
    })
    // the screen: the kind chip over the head and a drop row under it
    expect(inBench().getByText('DROPSET · 1 DROP')).toBeTruthy()
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['W', '01', '↳', '↳', '02', '03', '↳'])
  })

  it('the stepper adds a drop after the last (index 3 after 2) and removes the last; the head\'s kind is not rewritten', async () => {
    arrange()
    await ready()

    openPicker('01')
    fireEvent.click(dialog('What is this set?').getByRole('button', { name: 'More drops' }))
    await settled()
    expect(stagesOf('a').map((s) => s.stage_index)).toEqual([1, 2, 3])
    expect(setWriteSummary()).toEqual([['insert', '(insert)']])
    expect(inBench().getByText('DROPSET · 3 DROPS')).toBeTruthy()

    db.writes.length = 0
    fireEvent.click(dialog('What is this set?').getByRole('button', { name: 'Fewer drops' }))
    await settled()
    expect(stagesOf('a').map((s) => s.stage_index)).toEqual([1, 2])
    expect(setWriteSummary()).toEqual([['delete', expect.stringMatching(/^new-/)]]) // the added drop, the highest, goes
    expect(inBench().getByText('DROPSET · 2 DROPS')).toBeTruthy()
  })

  it('another staged kind on a staged head rewrites the head\'s kind and keeps its drops', async () => {
    arrange()
    await ready()

    openPicker('01')
    pick('Rest-pause')
    await settled()

    expect(row('a')?.stage_kind).toBe('rest_pause')
    expect(stagesOf('a').map((s) => s.id)).toEqual(['a1', 'a2'])
    expect(setWriteSummary()).toEqual([['update', 'a']])
    expect(setWrites()[0].args[0]).toEqual({ stage_kind: 'rest_pause' })
    expect(inBench().getByText('REST-PAUSE · 2 PAUSES')).toBeTruthy()
  })

  it('Warmup on a staged head removes the stages first — the last first — then marks the head, and clears its kind; the screen shows a W with no drops', async () => {
    arrange()
    await ready()

    openPicker('01')
    pick('Warmup')
    await settled()

    expect(setWriteSummary()).toEqual([['delete', 'a2'], ['delete', 'a1'], ['update', 'a']])
    expect(setWrites()[2].args[0]).toEqual({ is_warmup: true, stage_kind: null })
    expect(stagesOf('a')).toEqual([])
    expect([row('a')?.is_warmup, row('a')?.stage_kind]).toEqual([true, null])
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['W', 'W', '01', '02'])
    expect(screen.queryByText(/DROP/)).toBeNull()
  })

  it('Normal on a staged head removes its stages and clears its kind (and leaves is_warmup alone)', async () => {
    arrange()
    await ready()

    openPicker('01')
    pick('Normal')
    await settled()

    expect(setWriteSummary()).toEqual([['delete', 'a2'], ['delete', 'a1'], ['update', 'a']])
    expect(setWrites()[2].args[0]).toEqual({ stage_kind: null })
    expect([row('a')?.is_warmup, row('a')?.stage_kind]).toEqual([false, null])
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['W', '01', '02', '03'])
  })

  it('Normal on a warmup writes is_warmup false; the row gets its RIR cell back and is counted in the working sets', async () => {
    arrange()
    await ready()

    fireEvent.click(within(rowAt('W')).getByLabelText('Options for warmup set 1'))
    expect(within(dialog('What is this set?').getByRole('group', { name: 'Set type' })).getAllByRole('button')).toHaveLength(2) // Normal, Warmup
    pick('Normal')
    await settled()

    expect(setWriteSummary()).toEqual([['update', 'warm']])
    expect(setWrites()[0].args[0]).toEqual({ is_warmup: false })
    expect(row('warm')?.is_warmup).toBe(false)
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['01', '02', '↳', '↳', '03', '04'])
    expect(within(rowAt('01')).getByRole('button', { name: 'RIR –' })).toBeTruthy()
  })

  it('a change that is cut short leaves a consistent set: Warmup on a staged head whose final write is refused leaves a plain head with no drops, and the screen says so', async () => {
    arrange()
    await ready()
    db.refuse = (write) => (write.op === 'update' ? 'new row violates row-level security policy' : null)

    openPicker('01')
    pick('Warmup')
    await settled()

    // the drops went first, the head's own write was refused: the set is a plain working set now, not a warmup that kept its drops
    expect(setWriteSummary()).toEqual([['delete', 'a2'], ['delete', 'a1'], ['update', 'a']])
    expect(stagesOf('a')).toEqual([])
    expect([row('a')?.is_warmup, row('a')?.stage_kind]).toEqual([false, 'dropset'])
    // the screen shows the database: W, then the head (01, no drops), and the picker reads what the head is
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['W', '01', '02', '03'])
    expect(dialog('What is this set?').getByRole('button', { name: /^Normal/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('a stage row is never given a kind, and the database would refuse it: the stage inserted for a kind change carries none', async () => {
    arrange()
    await ready()

    openPicker('03')
    pick('Myo-reps')
    await settled()

    expect(stagesOf('c').every((s) => s.stage_kind === null)).toBe(true)
    expect(row('c')?.stage_kind).toBe('myo_reps')
    expect(inBench().getByText('MYO-REPS · 1 MINI-SET')).toBeTruthy()
  })
})

// ─── REMOVE THIS SET ──────────────────────────────────────────────────────────

describe('end to end — REMOVE THIS SET removes the stage rows from the highest first, then the set', () => {
  const remove = (setNumber: string) => {
    fireEvent.click(within(rowAt(setNumber)).getByLabelText(/^Options for /))
    fireEvent.click(dialog('What is this set?').getByText('REMOVE THIS SET'))
  }

  it('a staged set: one request per row, the drops from the highest index, then the head; the rows after it renumber on the screen', async () => {
    arrange()
    await ready()

    remove('01')
    await settled()

    expect(setWriteSummary()).toEqual([['delete', 'a2'], ['delete', 'a1'], ['delete', 'a']])
    expect(rowsOfBench().map((s) => s.id)).toEqual(['warm', 'b', 'c'])
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['W', '01', '02'])
    expect(row('q1')).toBeTruthy() // Squat's first set shares the number and is another set
  })

  it('a plain set: that set alone', async () => {
    arrange()
    await ready()

    remove('02')
    await settled()

    expect(setWriteSummary()).toEqual([['delete', 'b']])
    expect(rowsOfBench().map((s) => s.id)).toEqual(['warm', 'a', 'a1', 'a2', 'c'])
  })

  it('a removal cut short after the drops leaves the head without them (no head pointing at drops that were removed, nothing orphaned)', async () => {
    arrange()
    await ready()
    db.refuse = (write) => (write.op === 'delete' && write.id === 'a' ? 'new row violates row-level security policy' : null)

    remove('01')
    await settled()

    expect(setWriteSummary()).toEqual([['delete', 'a2'], ['delete', 'a1'], ['delete', 'a']])
    expect(row('a')).toBeTruthy()
    expect(stagesOf('a')).toEqual([])
    expect(db.state.sets.filter((s) => s.parent_week_plan_set_id !== null && !db.state.sets.some((p) => p.id === s.parent_week_plan_set_id))).toEqual([])
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['W', '01', '02', '03']) // the head is still there, a plain set again (its kind chip needs drops)
  })
})

// ─── + ADD SET ────────────────────────────────────────────────────────────────

describe('end to end — "+ ADD SET" inserts a Normal set with the previous set\'s rep target and no weight or RIR', () => {
  it('inserts set 5 (one past the highest head number) with 8–12 reps and null weight, RIR and RIR range; the screen shows it as 04 with dashes', async () => {
    arrange()
    await ready()

    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    await settled()

    expect(setWrites()).toHaveLength(1)
    expect(setWrites()[0].method).toBe('insert')
    expect(setWrites()[0].args[0]).toEqual({
      week_plan_id: WP, user_id: 'user-1', program_exercise_id: 'pe-bench', set_number: 5, is_dropset: false, is_warmup: false, stage_kind: null,
      rep_min: 8, rep_max: 12, is_amrap: false, target_weight: null, target_rir: null,
    })
    const added = db.state.sets.find((s) => s.id.startsWith('new-'))
    expect(added).toMatchObject({ set_number: 5, rep_min: 8, rep_max: 12, target_weight: null, target_rir: null, target_rir_max: null, is_warmup: false, stage_kind: null, parent_week_plan_set_id: null })
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['W', '01', '↳', '↳', '02', '03', '04'])
    const addedRow = rowAt('04')
    expect(within(addedRow).getByRole('button', { name: '—' })).toBeTruthy() // no weight
    expect(within(addedRow).getByRole('button', { name: '8–12' })).toBeTruthy() // the previous set's reps
    expect(within(addedRow).getByRole('button', { name: 'RIR –' })).toBeTruthy() // no RIR
  })

  it('then REMOVE THIS SET on the added set removes it; the exercise is as it was', async () => {
    arrange()
    await ready()
    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    await settled()
    db.writes.length = 0

    fireEvent.click(within(rowAt('04')).getByLabelText(/^Options for /))
    fireEvent.click(dialog('What is this set?').getByText('REMOVE THIS SET'))
    await settled()

    expect(setWriteSummary()).toEqual([['delete', expect.stringMatching(/^new-/)]])
    expect(rowsOfBench().map((s) => s.id)).toEqual(['warm', 'a', 'a1', 'a2', 'b', 'c'])
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['W', '01', '↳', '↳', '02', '03'])
  })

  it('Squat\'s "+" adds to Squat, numbered from its own sets (set numbers repeat across exercises)', async () => {
    arrange()
    await ready()

    fireEvent.click(screen.getByLabelText('Add set to Squat'))
    await settled()

    const added = db.state.sets.find((s) => s.id.startsWith('new-'))
    expect(added).toMatchObject({ program_exercise_id: 'pe-squat', set_number: 2, rep_min: 5, rep_max: 5, target_weight: null, target_rir: null })
  })

  it('a refused add leaves the screen on the rows the database holds', async () => {
    arrange()
    await ready()
    db.refuse = (write) => (write.op === 'insert' ? 'new row violates row-level security policy' : null)

    fireEvent.click(screen.getByLabelText('Add set to Bench Press'))
    await settled()

    expect(db.state.sets.some((s) => s.id.startsWith('new-'))).toBe(false)
    expect(labelsIn(cardOf('Bench Press'))).toEqual(['W', '01', '↳', '↳', '02', '03'])
    expect((screen.getByLabelText('Add set to Bench Press') as HTMLButtonElement).disabled).toBe(false) // and the "+" is usable again
  })
})

// ─── Cues ─────────────────────────────────────────────────────────────────────

describe('end to end — the cues sheet writes the set\'s tags, and "Use for all" the working heads\' missing cues', () => {
  const openCues = (setNumber: string) => {
    fireEvent.click(within(rowAt(setNumber)).getByLabelText(/^Options for /))
    fireEvent.click(dialog('What is this set?').getByText('Cues'))
  }

  it('ticking "Maintain strength" on set 03 writes tags ["maintain strength"]; the chip appears under the row', async () => {
    arrange()
    await ready()

    openCues('03')
    fireEvent.click(dialog('Cues for this set').getByRole('checkbox', { name: 'Maintain strength' }))
    fireEvent.click(dialog('Cues for this set').getByRole('button', { name: 'DONE' }))
    await settled()

    expect(row('c')?.tags).toEqual(['maintain strength'])
    expect(setWrites().map((w) => w.args[0])).toEqual([{ tags: ['maintain strength'] }])
    expect(inBench().getByText('Maintain strength')).toBeTruthy()
  })

  it('"Use for all" from the cued set 02 gives its cue to the other working heads only: not the warmup, not the drops, not Squat', async () => {
    arrange()
    await ready()

    openCues('02')
    fireEvent.click(dialog('Cues for this set').getByRole('checkbox', { name: 'Use for all 3 sets of Bench Press' }))
    fireEvent.click(dialog('Cues for this set').getByRole('button', { name: 'DONE' }))
    await settled()

    expect(setWrites().map((w) => w.eq?.[0]?.[1])).toEqual(['a', 'c'])
    expect(row('a')?.tags).toEqual(['push here'])
    expect(row('c')?.tags).toEqual(['push here'])
    expect(row('warm')?.tags).toBeNull()
    expect([row('a1')?.tags, row('a2')?.tags, row('q1')?.tags]).toEqual([null, null, null])
    expect(inBench().getAllByText('Push here')).toHaveLength(3)
  })

  it('removing the only cue stores null, not an empty list', async () => {
    arrange()
    await ready()

    openCues('02')
    fireEvent.click(dialog('Cues for this set').getByRole('checkbox', { name: 'Push here' }))
    fireEvent.click(dialog('Cues for this set').getByRole('button', { name: 'DONE' }))
    await settled()

    expect(row('b')?.tags).toBeNull()
    expect(inBench().queryByText('Push here')).toBeNull()
  })
})
