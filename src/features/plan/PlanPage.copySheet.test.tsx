// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { queryClient } from '../../lib/queryClient'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { pe, plan, wset } from './weekPlanning.testutil'

// Chunk 52 (TASKS-1.2 "Plan's header" → CopySheet; SPEC Weeks and copying [1.2] → COPY (2c); G53; Defaults 7; board 2). What COPY's sheet
// sends, at the screen that sends it: the ops `copyNumbers` returns for the ticked fields and the ticked workouts, in one request, through
// the real `useCopyNumbers` into `applyOps` (stood in for by a spy: the request that would reach `v2_apply_ops`).
//
// The fixture tells the right data source from the wrong one: three workouts in week 3, whose sources are week 2's plans and carry
// different numbers (Push 60 / 62.5, Pull 80, Legs 100), so a copy from the wrong workout or the wrong week names another number; one
// set in week 3 already holds a typed weight (55), so "overwrite off" and "overwrite on" give different lists; Legs is done, and its
// source has numbers a copy would take; the same data is a stable run in one test and a week-dependent one in the next, so the rep
// columns are there or not by the planning type alone.
// Break proofs (chunk 52's report): a done workout copied into; REPS offered on a stable run; a ticked field or workout ignored; overwrite
// ignored; a column name wrong in the op; a second press while the first is out.

afterEach(() => {
  cleanup()
  queryClient.clear()
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  applyOpsMock.mockReset()
})

const wd = (id: string, name: string, position: number): WorkoutDay => ({ id, programId: 'prog-1', userId: 'user-1', name, position, exercises: [] })
const PUSH = wd('wd-push', 'Push Day', 0)
const PULL = wd('wd-pull', 'Pull Day', 1)
const LEGS = wd('wd-legs', 'Leg Day', 2)

const state = vi.hoisted(() => ({
  program: null as unknown as Program,
  plans: [] as WeekPlan[],
  done: new Set<string>(),
}))
const applyOpsMock = vi.hoisted(() => vi.fn())

vi.mock('../programs/applyOps', () => ({ applyOps: (ops: unknown) => applyOpsMock(ops) }))
vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({
    data: [{
      id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active',
      startDate: format(startOfWeek(subWeeks(new Date(), 2), { weekStartsOn: 1 }), 'yyyy-MM-dd'), // week 3 is the current week
      endDate: null, createdAt: '2026-01-01T00:00:00Z',
    } satisfies Mesocycle],
    isLoading: false,
  }),
}))
vi.mock('../programs/usePrograms', async () => ({
  ...(await import('./structureHooks.testutil')).quietProgramsHooks,
  usePrograms: () => ({ data: [state.program], isLoading: false }),
  useWorkoutDays: () => ({ data: [PUSH, PULL, LEGS], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./structureHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => state.done }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
vi.mock('./MakeWeekDefault', () => ({ default: () => null }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: state.plans.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: state.plans, isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')

// ─── The run ──────────────────────────────────────────────────────────────────

const EXERCISE = { push: pe('pe-push', 'bench', 0, { workoutDayId: 'wd-push' }), pull: pe('pe-pull', 'row', 0, { workoutDayId: 'wd-pull' }), legs: pe('pe-legs', 'squat', 0, { workoutDayId: 'wd-legs' }) }
const EMPTY_BOX: Partial<WeekPlanSet> = { targetWeight: null, repMin: null, repMax: null, targetRir: null }

/** A workout's plan for a week; `sets` are given by the test (a source's numbers, a target's empty boxes). */
function session(slot: 'push' | 'pull' | 'legs', week: number, sets: WeekPlanSet[], over: Partial<WeekPlan> = {}): WeekPlan {
  return plan(week, [EXERCISE[slot]], sets, { id: `wp-${slot}-${week}`, workoutDayId: `wd-${slot}`, ...over })
}
const set = (slot: 'push' | 'pull' | 'legs', week: number, n: number, over: Partial<WeekPlanSet>) => wset(`s-${slot}-${week}-${n}`, EXERCISE[slot].id, n, { weekPlanId: `wp-${slot}-${week}`, ...over })

/**
 * Week 2 holds the numbers; week 3 (the current week) has the boxes. Push's second set already has a typed weight (55); Legs is done.
 * Sources: Push 60 and 62.5 at 8–10 reps RIR 2; Pull 80 at 6 reps RIR 1; Legs 100 at AMRAP RIR 0.
 */
function world(planningType: Program['planningType']) {
  state.program = {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', workoutDays: [],
    schedule: { ...EMPTY_SCHEDULE, monday: 'wd-push', wednesday: 'wd-pull', friday: 'wd-legs' },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType,
  }
  state.plans = [
    session('push', 2, [set('push', 2, 1, { targetWeight: 60, repMin: 8, repMax: 10, targetRir: 2 }), set('push', 2, 2, { targetWeight: 62.5, repMin: 8, repMax: 10, targetRir: 2 })]),
    session('pull', 2, [set('pull', 2, 1, { targetWeight: 80, repMin: 6, repMax: 6, targetRir: 1 })]),
    session('legs', 2, [set('legs', 2, 1, { targetWeight: 100, repMin: null, repMax: null, isAmrap: true, targetRir: 0 })]),
    session('push', 3, [set('push', 3, 1, EMPTY_BOX), set('push', 3, 2, { ...EMPTY_BOX, targetWeight: 55 })]),
    session('pull', 3, [set('pull', 3, 1, EMPTY_BOX)]),
    session('legs', 3, [set('legs', 3, 1, EMPTY_BOX)]),
  ]
  state.done = new Set(['wp-legs-3'])
}

function renderPlan() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function openSheet() {
  renderPlan()
  fireEvent.click(screen.getByText('COPY'))
  return within(screen.getByRole('dialog', { name: "Copy last week's numbers" }))
}

const chip = (sheet: ReturnType<typeof within>, name: 'WEIGHT' | 'REPS' | 'RIR') => sheet.getByRole('checkbox', { name })
const row = (sheet: ReturnType<typeof within>, name: string) => sheet.getByText(name).closest('button') as HTMLButtonElement
const sentOps = () => applyOpsMock.mock.calls.map((call) => call[0] as Array<{ op: string; table: string; id: string; patch: Record<string, unknown> }>)
const patchOf = (ops: ReturnType<typeof sentOps>[number], id: string) => ops.find((o) => o.id === id)?.patch

// ─── What the sheet shows ─────────────────────────────────────────────────────

describe('the COPY sheet (board 2)', () => {
  it('week 3 of a week-dependent run: eyebrow, title, WEIGHT / REPS / RIR ticked, every open workout ticked, Legs locked as DONE, overwrite off', () => {
    world('week_dependent')
    const sheet = openSheet()

    expect(screen.getByText("WEEK 3 · FROM WEEK 2'S PLAN")).toBeTruthy()
    for (const name of ['WEIGHT', 'REPS', 'RIR'] as const) expect(chip(sheet, name).getAttribute('aria-checked')).toBe('true')
    expect(row(sheet, 'Push Day').getAttribute('aria-checked')).toBe('true')
    expect(row(sheet, 'Pull Day').getAttribute('aria-checked')).toBe('true')
    const legs = row(sheet, 'Leg Day')
    expect(legs.getAttribute('aria-checked')).toBe('false')
    expect(legs.getAttribute('aria-disabled')).toBe('true')
    expect(within(legs).getByText('DONE')).toBeTruthy()
    const overwrite = sheet.getByRole('switch')
    expect(overwrite.getAttribute('aria-checked')).toBe('false')
    expect(within(overwrite).getByText("Overwrite what's already there")).toBeTruthy()
    expect(within(overwrite).getByText('Off: only empty boxes get filled.')).toBeTruthy()
    expect(sheet.getByText('COPY INTO 2 WORKOUTS')).toBeTruthy()
    // the rows read in the week's order, with their days
    expect(row(sheet, 'Push Day').textContent).toContain('MON')
    expect(row(sheet, 'Pull Day').textContent).toContain('WED')
    expect(legs.textContent).toContain('FRI')
  })

  it('a past week (week 2, planned) has no COPY and no WEEK ⋯ (board 1c), though week 3 has both', () => {
    world('week_dependent')
    renderPlan()
    expect(screen.getByText('COPY')).toBeTruthy()
    expect(screen.getByLabelText('Week 3 options')).toBeTruthy()
    fireEvent.click(screen.getByText('WEEK 2').closest('button') as HTMLButtonElement)
    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()
    expect(screen.queryByText('COPY')).toBeNull()
    expect(screen.queryByLabelText('Week 2 options')).toBeNull()
  })

  it('nothing is sent by opening it, and none of its three ways out sends anything (×, the scrim, Escape)', () => {
    world('week_dependent')
    openSheet()
    expect(applyOpsMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByText('COPY'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(applyOpsMock).not.toHaveBeenCalled()
  })
})

// ─── What it sends ────────────────────────────────────────────────────────────

describe('COPY INTO N WORKOUTS sends the ops copyNumbers returns for the ticked fields and workouts, in one request', () => {
  it('all three fields, Push and Pull ticked, overwrite off: one request; Legs (done) is not in it; Push\'s typed weight (55) is left, its empty boxes are filled', async () => {
    world('week_dependent')
    applyOpsMock.mockResolvedValue(3)
    const sheet = openSheet()
    fireEvent.click(sheet.getByText('COPY INTO 2 WORKOUTS'))

    await waitFor(() => expect(applyOpsMock).toHaveBeenCalledTimes(1))
    const ops = sentOps()[0]
    const RUNS = { rep_min: 8, rep_max: 10, is_amrap: false, target_rir: 2, target_rir_max: null }
    expect(ops).toEqual([
      { op: 'update', table: 'v2_week_plan_sets', id: 's-push-3-1', patch: { target_weight: 60, ...RUNS } },
      // typed 55: overwrite is off, so no weight; the empty reps and RIR boxes are filled
      { op: 'update', table: 'v2_week_plan_sets', id: 's-push-3-2', patch: RUNS },
      { op: 'update', table: 'v2_week_plan_sets', id: 's-pull-3-1', patch: { target_weight: 80, rep_min: 6, rep_max: 6, is_amrap: false, target_rir: 1, target_rir_max: null } },
    ])
    // a done workout is never written, whatever its source holds
    expect(ops.map((o) => o.id)).not.toContain('s-legs-3-1')
    // the sheet closes on the numbers it wrote
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('overwrite on replaces the typed weight with the source\'s (62.5, from Push\'s own second source set), and says so', async () => {
    world('week_dependent')
    applyOpsMock.mockResolvedValue(3)
    const sheet = openSheet()
    fireEvent.click(sheet.getByRole('switch'))
    expect(sheet.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(sheet.getByText('On: numbers you already typed get replaced.')).toBeTruthy()
    fireEvent.click(sheet.getByText('COPY INTO 2 WORKOUTS'))

    await waitFor(() => expect(applyOpsMock).toHaveBeenCalledTimes(1))
    expect(patchOf(sentOps()[0], 's-push-3-2')).toEqual({ target_weight: 62.5, rep_min: 8, rep_max: 10, is_amrap: false, target_rir: 2, target_rir_max: null })
    expect(patchOf(sentOps()[0], 's-push-3-1')).toMatchObject({ target_weight: 60 })
  })

  it('only WEIGHT ticked: the ops carry target_weight and no rep or RIR column', async () => {
    world('week_dependent')
    applyOpsMock.mockResolvedValue(2)
    const sheet = openSheet()
    fireEvent.click(chip(sheet, 'REPS'))
    fireEvent.click(chip(sheet, 'RIR'))
    expect(chip(sheet, 'WEIGHT').getAttribute('aria-checked')).toBe('true')
    expect(chip(sheet, 'REPS').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sheet.getByText('COPY INTO 2 WORKOUTS'))

    await waitFor(() => expect(applyOpsMock).toHaveBeenCalledTimes(1))
    expect(sentOps()[0]).toEqual([
      { op: 'update', table: 'v2_week_plan_sets', id: 's-push-3-1', patch: { target_weight: 60 } },
      { op: 'update', table: 'v2_week_plan_sets', id: 's-pull-3-1', patch: { target_weight: 80 } },
    ])
  })

  it('only RIR ticked: RIR alone; only REPS ticked: the rep target alone (AMRAP counts as a target, but Legs is done)', async () => {
    world('week_dependent')
    applyOpsMock.mockResolvedValue(2)
    let sheet = openSheet()
    fireEvent.click(chip(sheet, 'WEIGHT'))
    fireEvent.click(chip(sheet, 'REPS'))
    fireEvent.click(sheet.getByText('COPY INTO 2 WORKOUTS'))
    await waitFor(() => expect(applyOpsMock).toHaveBeenCalledTimes(1))
    expect(sentOps()[0].every((o) => Object.keys(o.patch).every((key) => key === 'target_rir' || key === 'target_rir_max'))).toBe(true)
    expect(sentOps()[0]).toHaveLength(3)

    cleanup()
    applyOpsMock.mockClear()
    sheet = openSheet()
    fireEvent.click(chip(sheet, 'WEIGHT'))
    fireEvent.click(chip(sheet, 'RIR'))
    fireEvent.click(sheet.getByText('COPY INTO 2 WORKOUTS'))
    await waitFor(() => expect(applyOpsMock).toHaveBeenCalledTimes(1))
    expect(sentOps()[0].every((o) => Object.keys(o.patch).every((key) => ['rep_min', 'rep_max', 'is_amrap'].includes(key)))).toBe(true)
    expect(sentOps()[0]).toHaveLength(3)
  })

  it('a workout unticked is left alone: Pull only (Push unticked), and the button counts one', async () => {
    world('week_dependent')
    applyOpsMock.mockResolvedValue(1)
    const sheet = openSheet()
    fireEvent.click(row(sheet, 'Push Day'))
    expect(row(sheet, 'Push Day').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sheet.getByText('COPY INTO 1 WORKOUT'))

    await waitFor(() => expect(applyOpsMock).toHaveBeenCalledTimes(1))
    expect(sentOps()[0].map((o) => o.id)).toEqual(['s-pull-3-1'])
  })

  it('a done workout cannot be ticked: tapping it changes nothing, and it stays out of the request', async () => {
    world('week_dependent')
    applyOpsMock.mockResolvedValue(3)
    const sheet = openSheet()
    fireEvent.click(row(sheet, 'Leg Day'))
    expect(row(sheet, 'Leg Day').getAttribute('aria-checked')).toBe('false')
    expect(sheet.getByText('COPY INTO 2 WORKOUTS')).toBeTruthy()
    fireEvent.click(sheet.getByText('COPY INTO 2 WORKOUTS'))
    await waitFor(() => expect(applyOpsMock).toHaveBeenCalledTimes(1))
    expect(sentOps()[0].map((o) => o.id)).not.toContain('s-legs-3-1')
  })

  it('with nothing ticked the button says why and is disabled: no field, no workout, nothing to copy', () => {
    world('week_dependent')
    const sheet = openSheet()
    for (const name of ['WEIGHT', 'REPS', 'RIR'] as const) fireEvent.click(chip(sheet, name))
    const noField = sheet.getByText('PICK WHAT TO COPY').closest('button') as HTMLButtonElement
    expect(noField.disabled).toBe(true)
    fireEvent.click(noField)
    expect(applyOpsMock).not.toHaveBeenCalled()

    for (const name of ['WEIGHT', 'REPS', 'RIR'] as const) fireEvent.click(chip(sheet, name))
    fireEvent.click(row(sheet, 'Push Day'))
    fireEvent.click(row(sheet, 'Pull Day'))
    const noWorkout = sheet.getByText('PICK A WORKOUT').closest('button') as HTMLButtonElement
    expect(noWorkout.disabled).toBe(true)
    fireEvent.click(noWorkout)
    expect(applyOpsMock).not.toHaveBeenCalled()
  })

  it('the numbers already there leave nothing to copy: NOTHING TO COPY, disabled', () => {
    world('week_dependent')
    // week 3's boxes already equal week 2's
    state.plans = state.plans.map((p) => {
      if (p.weekNumber !== 3) return p
      const source = state.plans.find((q) => q.weekNumber === 2 && q.workoutDayId === p.workoutDayId)!
      return { ...p, sets: source.sets.map((s) => ({ ...s, id: s.id.replace('-2-', '-3-'), weekPlanId: p.id })) }
    })
    const sheet = openSheet()
    const button = sheet.getByText('NOTHING TO COPY').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})

// ─── G53 ──────────────────────────────────────────────────────────────────────

describe('G53: a stable run copies Weight and RIR only (the default owns the rep targets)', () => {
  it('the same data on a stable run: no REPS chip, and the ops carry no rep-target column; on a week-dependent run they do', async () => {
    world('stable')
    applyOpsMock.mockResolvedValue(3)
    let sheet = openSheet()
    expect(sheet.getByRole('checkbox', { name: 'WEIGHT' })).toBeTruthy()
    expect(sheet.getByRole('checkbox', { name: 'RIR' })).toBeTruthy()
    expect(sheet.queryByRole('checkbox', { name: 'REPS' })).toBeNull()
    expect(sheet.queryByText('REPS')).toBeNull()
    fireEvent.click(sheet.getByText('COPY INTO 2 WORKOUTS'))
    await waitFor(() => expect(applyOpsMock).toHaveBeenCalledTimes(1))
    const stableOps = sentOps()[0]
    expect(stableOps).toEqual([
      { op: 'update', table: 'v2_week_plan_sets', id: 's-push-3-1', patch: { target_weight: 60, target_rir: 2, target_rir_max: null } },
      { op: 'update', table: 'v2_week_plan_sets', id: 's-push-3-2', patch: { target_rir: 2, target_rir_max: null } },
      { op: 'update', table: 'v2_week_plan_sets', id: 's-pull-3-1', patch: { target_weight: 80, target_rir: 1, target_rir_max: null } },
    ])
    for (const op of stableOps) for (const column of ['rep_min', 'rep_max', 'is_amrap']) expect(Object.keys(op.patch)).not.toContain(column)

    cleanup()
    applyOpsMock.mockClear()
    world('week_dependent')
    sheet = openSheet()
    expect(sheet.getByRole('checkbox', { name: 'REPS' })).toBeTruthy()
    fireEvent.click(sheet.getByText('COPY INTO 2 WORKOUTS'))
    await waitFor(() => expect(applyOpsMock).toHaveBeenCalledTimes(1))
    expect(Object.keys(sentOps()[0][0].patch)).toContain('rep_min')
  })
})

// ─── Pending, failure, double press ───────────────────────────────────────────

describe('while it writes, and when it fails', () => {
  it('two presses in one instant send one request; the button reads COPYING… and is disabled until the answer, and the sheet then closes', async () => {
    world('week_dependent')
    let answer: (count: number) => void = () => {}
    applyOpsMock.mockImplementation(() => new Promise<number>((resolve) => (answer = resolve)))
    const sheet = openSheet()
    const button = sheet.getByText('COPY INTO 2 WORKOUTS').closest('button') as HTMLButtonElement

    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    await waitFor(() => expect(applyOpsMock).toHaveBeenCalledTimes(1))
    const pending = await screen.findByText('COPYING…')
    expect((pending.closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('dialog')).toBeTruthy()

    await act(async () => {
      answer(3)
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(applyOpsMock).toHaveBeenCalledTimes(1)
  })

  it('a failure keeps the sheet and its choices, shows "Couldn\'t copy the numbers." with the server\'s own message, and the button sends the same list again', async () => {
    world('week_dependent')
    applyOpsMock.mockRejectedValueOnce({ message: 'row not found: v2_week_plan_sets/s-pull-3-1', code: 'P0001' })
    const sheet = openSheet()
    fireEvent.click(chip(sheet, 'REPS')) // a choice the failure must keep
    fireEvent.click(sheet.getByText('COPY INTO 2 WORKOUTS'))

    await screen.findByText("Couldn't copy the numbers.")
    expect(screen.getByText('row not found: v2_week_plan_sets/s-pull-3-1')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(chip(sheet, 'REPS').getAttribute('aria-checked')).toBe('false')
    const button = sheet.getByText('COPY INTO 2 WORKOUTS').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(false)

    applyOpsMock.mockResolvedValueOnce(3)
    fireEvent.click(button)
    await waitFor(() => expect(applyOpsMock).toHaveBeenCalledTimes(2))
    expect(sentOps()[1]).toEqual(sentOps()[0]) // the same list, untouched by the failure
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a failure with no message says "Something went wrong."; with none and the phone offline, "You may be offline."', async () => {
    world('week_dependent')
    applyOpsMock.mockRejectedValue({ message: '' })
    const sheet = openSheet()
    fireEvent.click(sheet.getByText('COPY INTO 2 WORKOUTS'))
    await screen.findByText("Couldn't copy the numbers.")
    expect(screen.getByText('Something went wrong.')).toBeTruthy()

    cleanup()
    queryClient.clear()
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      const again = openSheet()
      fireEvent.click(again.getByText('COPY INTO 2 WORKOUTS'))
      await screen.findByText("Couldn't copy the numbers.")
      expect(screen.getByText('You may be offline.')).toBeTruthy()
      expect(screen.queryByText('Something went wrong.')).toBeNull()
    } finally {
      online.mockRestore()
    }
  })
})
