// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { Program, ProgramExercise, WorkoutDay } from '../../types'
import { queryClient } from '../../lib/queryClient'
import { createFakeProgramSetsDb, fakeProgramSet, type FakeProgramSetRow, type FakeWeekSetRow } from './fakeProgramSetsDb.testutil'
import { DIPS, FLY, FOUND, INC, LAT, exercise, makeProgram, open, renderStep, repSheet, settled, textOf, typeSheet, world, worldWorkouts } from './stepVolume.testutil'

// Chunk 67 (TASKS-1.2 "The stepped planner's step 3 on the shared pickers"): the writers of step 3 that are not a set's type, END TO END. It mocks
// nothing of the planner's own code: the real StepVolume, the real usePlanner.ts hooks (with their invalidations) and the real plannerService.ts
// run against a stateful in-memory v2_program_sets (fakeProgramSetsDb.testutil.ts) that APPLIES the writes, so the step refetches what a user would
// see, and ENFORCES the table's checks and the cascade. The assertions are on the requests that reach the database client, on the rows it holds
// after, and on what the screen then reads. The SETS stepper (and DECISIONS 213 (a): + adds after the highest position), ALL, a set's rep box with
// and without "Use for all", a stage's rep box, REST AFTER, REMOVE THIS SET, and that nothing is ever written to a week set.
//
// The fixture tells the right data source from the wrong one (stepVolume.testutil.ts): every exercise's sets are at positions 1, 2, 3 ..., an
// exercise has a warmup and a dropset with a stage, another has none, and week sets are linked to the program sets.

let db = createFakeProgramSetsDb({ sets: [] })
let workoutDays: WorkoutDay[] = []
let exercisesByDay: Record<string, ProgramExercise[]> = {}

vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => (db.client.from as (t: string) => unknown)(table) } }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useProgramExercises: (id: string) => ({ data: exercisesByDay[id] ?? [], isLoading: false }),
  useUpdatePlanningType: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: StepVolume } = await import('./StepVolume')

afterEach(() => {
  cleanup()
  queryClient.clear()
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// The week sets copied from the program's sets: the step must never touch them (a week's numbers are Plan's).
const WEEK_SETS: FakeWeekSetRow[] = [
  { id: 'w-fly1', program_set_id: 'fly1', rep_min: 10, rep_max: 12, stage_kind: null, is_warmup: false },
  { id: 'w-fly2', program_set_id: 'fly2', rep_min: 10, rep_max: 12, stage_kind: null, is_warmup: false },
  { id: 'w-inc4', program_set_id: 'inc4', rep_min: 8, rep_max: 12, stage_kind: 'dropset', is_warmup: false },
]

async function arrange(sets: FakeProgramSetRow[] = world(), program: Program = makeProgram()) {
  db = createFakeProgramSetsDb({ sets, weekSets: WEEK_SETS })
  ;({ workoutDays, exercisesByDay } = worldWorkouts())
  const rendered = renderStep(StepVolume, { program })
  await screen.findByText('Incline Dumbbell Press', {}, FOUND)
  return rendered
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const stepper = (name: string) => textOf(screen.getByRole('group', { name: `Sets for ${name}` }))
const positions = (programExerciseId: string) => db.rowsOf(programExerciseId).filter((r) => r.parent_program_set_id === null).map((r) => r.position)

// ─── The SETS stepper ─────────────────────────────────────────────────────────────────────────────────────

describe('the SETS stepper writes the exercise\'s own heads (the one required value)', () => {
  it('+ adds one set after the highest position, with the last set\'s rep target; no other exercise is touched', async () => {
    await arrange()
    click('More sets for Pec Deck Fly')
    await settled()

    expect(db.requests()).toEqual([
      ['insert', null, [{ user_id: 'user-1', program_exercise_id: FLY, position: 4, is_warmup: false, rep_min: 10, rep_max: 12, is_amrap: false }]],
    ])
    expect(stepper('Pec Deck Fly')).toBe('−4+')
    expect(positions(LAT)).toEqual([1, 2, 3, 4])
    expect(positions(INC)).toEqual([1, 2, 3, 4])
  })

  it('+ on an exercise with no sets adds the first, with no target to copy, and the exercise can then be opened', async () => {
    await arrange()
    expect(screen.queryByRole('button', { name: 'Show set targets for Dips' })).toBeNull()
    click('More sets for Dips')
    await settled()

    expect(db.requests()).toEqual([
      ['insert', null, [{ user_id: 'user-1', program_exercise_id: DIPS, position: 1, is_warmup: false, rep_min: null, rep_max: null, is_amrap: false }]],
    ])
    expect(stepper('Dips')).toBe('−1+')
    expect(screen.queryByText('NO SETS YET')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show set targets for Dips' })).toBeTruthy()
  })

  it('− removes the last set (the highest position) and keeps every other row as it was', async () => {
    await arrange()
    click('Fewer sets for Pec Deck Fly')
    await settled()

    expect(db.requests()).toEqual([['delete', ['fly3'], null]])
    expect(db.rowsOf(FLY).map((r) => r.id)).toEqual(['fly1', 'fly2'])
    expect(stepper('Pec Deck Fly')).toBe('−2+')
    expect(db.rowsOf(LAT)).toHaveLength(4)
  })

  it('− on an exercise whose last set is staged removes the set and, with it, its stage (the cascade); the count drops by one, not two', async () => {
    await arrange()
    click('Fewer sets for Incline Dumbbell Press')
    await settled()

    expect(db.requests()).toEqual([['delete', ['inc4'], null]])
    expect(db.row('inc4s1')).toBeUndefined()
    expect(stepper('Incline Dumbbell Press')).toBe('−3+')
  })

  it('a stage is never counted as a set', async () => {
    await arrange()
    expect(stepper('Incline Dumbbell Press')).toBe('−4+')
    expect(db.rowsOf(INC)).toHaveLength(5)
  })

  // DECISIONS 213 (a), Adam 2026-10-22: "+ always adds after the highest position". REMOVE THIS SET leaves its position empty.
  it('213: REMOVE THIS SET on set 2 of positions 1–3 leaves the gap, and + then writes position 4, never 3 again', async () => {
    await arrange()
    open('Pec Deck Fly')
    click('Set 02: type')
    fireEvent.click(typeSheet().getByRole('button', { name: 'REMOVE THIS SET' }))
    await settled()

    expect(db.requests()).toEqual([['delete', 'fly2', null]])
    expect(positions(FLY)).toEqual([1, 3])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(exercise(FLY).getAllByRole('button', { name: /^Set \d\d: type$/ }).map((b) => textOf(b))).toEqual(['01', '02'])

    click('More sets for Pec Deck Fly')
    await settled()

    expect(db.requests()[1]).toEqual(['insert', null, [{ user_id: 'user-1', program_exercise_id: FLY, position: 4, is_warmup: false, rep_min: 10, rep_max: 12, is_amrap: false }]])
    expect(positions(FLY)).toEqual([1, 3, 4])
    expect(exercise(FLY).getAllByRole('button', { name: /^Set \d\d: type$/ }).map((b) => textOf(b))).toEqual(['01', '02', '03'])
  })

  it('while the sets are being read again after a write, a second + asks for nothing (it would be worked out from the old rows)', async () => {
    await arrange()
    let release: () => void = () => undefined
    db.gate = new Promise<void>((resolve) => (release = resolve))
    try {
      click('More sets for Pec Deck Fly')
      await vi.waitFor(() => expect(db.requests()).toHaveLength(1), FOUND)
      // the write is answered, the read that follows is held: the stepper is still busy
      await vi.waitFor(() => expect((screen.getByRole('button', { name: 'More sets for Pec Deck Fly' }) as HTMLButtonElement).disabled).toBe(true), FOUND)
      click('More sets for Pec Deck Fly')
      click('Fewer sets for Pec Deck Fly')
      expect(db.requests()).toHaveLength(1)
    } finally {
      db.gate = null
      await act(async () => release())
    }
    await settled()
    expect(db.requests()).toHaveLength(1)
    expect(positions(FLY)).toEqual([1, 2, 3, 4])
    expect(stepper('Pec Deck Fly')).toBe('−4+')
    expect((screen.getByRole('button', { name: 'More sets for Pec Deck Fly' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

// ─── ALL, and a set's rep box ──────────────────────────────────────────────────────────────────────────

describe('ALL opens the rep target picker for every set of the exercise, and offers no "Use for all"', () => {
  it('on a set of targets that agree it opens on that target; the new target is written to every head in one request, and to no other exercise', async () => {
    await arrange()
    open('Pec Deck Fly')
    click("Set every set's rep target for Pec Deck Fly")

    expect(repSheet().getByRole('button', { name: 'RANGE' }).getAttribute('aria-pressed')).toBe('true')
    expect(repSheet().getByRole('textbox', { name: 'From' })).toHaveProperty('value', '10')
    expect(repSheet().getByRole('textbox', { name: 'To' })).toHaveProperty('value', '12')
    expect(repSheet().queryByRole('checkbox')).toBeNull()
    fireEvent.change(repSheet().getByRole('textbox', { name: 'From' }), { target: { value: '6' } })
    fireEvent.change(repSheet().getByRole('textbox', { name: 'To' }), { target: { value: '8' } })
    fireEvent.click(repSheet().getByRole('button', { name: 'SET 6–8 REPS' }))
    await settled()

    expect(db.requests()).toEqual([['update', ['fly1', 'fly2', 'fly3'], { rep_min: 6, rep_max: 8, is_amrap: false }]])
    expect(db.rowsOf(FLY).map((r) => [r.rep_min, r.rep_max])).toEqual([[6, 8], [6, 8], [6, 8]])
    expect(db.rowsOf(LAT).map((r) => r.rep_min)).toEqual([null, null, null, null])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(textOf(exercise(FLY).getByRole('button', { name: "Set every set's rep target for Pec Deck Fly" }))).toBe('6–8')
  })

  it('on sets that differ it opens on NONE with no number; AMRAP goes to every head, a warmup too, and never to a stage row', async () => {
    await arrange()
    open('Incline Dumbbell Press')
    click("Set every set's rep target for Incline Dumbbell Press")

    expect(repSheet().getByRole('button', { name: 'NONE' }).getAttribute('aria-pressed')).toBe('true')
    expect(repSheet().queryByRole('checkbox')).toBeNull()
    fireEvent.click(repSheet().getByRole('button', { name: 'AMRAP' }))
    fireEvent.click(repSheet().getByRole('button', { name: 'SET AMRAP' }))
    await settled()

    expect(db.requests()).toEqual([['update', ['inc1', 'inc2', 'inc3', 'inc4'], { rep_min: null, rep_max: null, is_amrap: true }]])
    expect(db.rowsOf(INC).map((r) => [r.id, r.is_amrap])).toEqual([['inc1', true], ['inc2', true], ['inc3', true], ['inc4', true], ['inc4s1', false]])
    expect(textOf(exercise(INC).getByRole('button', { name: "Set every set's rep target for Incline Dumbbell Press" }))).toBe('AMRAP')
  })

  it('on a target every set already has, SET writes nothing', async () => {
    await arrange()
    open('Pec Deck Fly')
    click("Set every set's rep target for Pec Deck Fly")
    fireEvent.click(repSheet().getByRole('button', { name: 'SET 10–12 REPS' }))
    await settled()
    expect(db.requests()).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('NONE clears every set\'s target', async () => {
    await arrange()
    open('Pec Deck Fly')
    click("Set every set's rep target for Pec Deck Fly")
    fireEvent.click(repSheet().getByRole('button', { name: 'NONE' }))
    fireEvent.click(repSheet().getByRole('button', { name: 'CLEAR TARGET' }))
    await settled()
    expect(db.requests()).toEqual([['update', ['fly1', 'fly2', 'fly3'], { rep_min: null, rep_max: null, is_amrap: false }]])
    expect(textOf(exercise(FLY).getByRole('button', { name: "Set every set's rep target for Pec Deck Fly" }))).toBe('—')
  })
})

describe("a set's rep box opens the rep target picker for that set", () => {
  it('it opens on the set\'s own target, and "Use for all N sets" starts ticked: the target goes to every head of that exercise only, a warmup included', async () => {
    await arrange()
    open('Incline Dumbbell Press')
    click('Rep target for set 02')

    expect(repSheet().getByRole('textbox', { name: 'From' })).toHaveProperty('value', '8')
    expect(repSheet().getByRole('checkbox', { name: 'Use for all 4 sets of Incline Dumbbell Press' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.change(repSheet().getByRole('textbox', { name: 'From' }), { target: { value: '5' } })
    fireEvent.change(repSheet().getByRole('textbox', { name: 'To' }), { target: { value: '7' } })
    fireEvent.click(repSheet().getByRole('button', { name: 'SET 5–7 REPS' }))
    await settled()

    expect(db.requests()).toEqual([['update', ['inc1', 'inc2', 'inc3', 'inc4'], { rep_min: 5, rep_max: 7, is_amrap: false }]])
    expect(db.rowsOf(INC).filter((r) => r.parent_program_set_id === null).map((r) => [r.rep_min, r.rep_max])).toEqual([[5, 7], [5, 7], [5, 7], [5, 7]])
    expect(db.row('inc4s1')?.rep_min).toBeNull()
    expect(db.rowsOf(FLY).map((r) => r.rep_min)).toEqual([10, 10, 10])
  })

  it('unticked, only that set is written; the other sets keep their targets', async () => {
    await arrange()
    open('Pec Deck Fly')
    click('Rep target for set 02')
    fireEvent.click(repSheet().getByRole('checkbox', { name: 'Use for all 3 sets of Pec Deck Fly' }))
    fireEvent.change(repSheet().getByRole('textbox', { name: 'From' }), { target: { value: '15' } })
    fireEvent.change(repSheet().getByRole('textbox', { name: 'To' }), { target: { value: '20' } })
    fireEvent.click(repSheet().getByRole('button', { name: 'SET 15–20 REPS' }))
    await settled()

    expect(db.requests()).toEqual([['update', 'fly2', { rep_min: 15, rep_max: 20, is_amrap: false }]])
    expect(db.rowsOf(FLY).map((r) => [r.id, r.rep_min, r.rep_max])).toEqual([['fly1', 10, 12], ['fly2', 15, 20], ['fly3', 10, 12]])
  })

  it('a set with no target opens on NONE; a target it already has is not written again', async () => {
    await arrange()
    open('Lateral Raise')
    click('Rep target for set 03')
    expect(repSheet().getByRole('button', { name: 'NONE' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(repSheet().getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    open('Pec Deck Fly')
    fireEvent.click(exercise(FLY).getByRole('button', { name: 'Rep target for set 01' }))
    fireEvent.click(repSheet().getByRole('checkbox', { name: 'Use for all 3 sets of Pec Deck Fly' }))
    fireEvent.click(repSheet().getByRole('button', { name: 'SET 10–12 REPS' }))
    await settled()
    expect(db.requests()).toEqual([])

    // ticked, on a target all three heads hold: nothing to write
    fireEvent.click(exercise(FLY).getByRole('button', { name: 'Rep target for set 02' }))
    expect(repSheet().getByRole('checkbox', { name: 'Use for all 3 sets of Pec Deck Fly' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(repSheet().getByRole('button', { name: 'SET 10–12 REPS' }))
    await settled()
    expect(db.requests()).toEqual([])
  })

  it("a stage's rep box writes that stage only: the picker offers no \"Use for all\" and the head and the other sets keep their targets", async () => {
    await arrange()
    open('Incline Dumbbell Press')
    click('Rep target for the dropset stage')

    expect(repSheet().getByRole('button', { name: 'NONE' }).getAttribute('aria-pressed')).toBe('true')
    expect(repSheet().queryByRole('checkbox')).toBeNull()
    fireEvent.click(repSheet().getByRole('button', { name: 'RANGE' }))
    fireEvent.click(repSheet().getByRole('button', { name: 'SET 8–10 REPS' }))
    await settled()

    expect(db.requests()).toEqual([['update', 'inc4s1', { rep_min: 8, rep_max: 10, is_amrap: false }]])
    expect(db.row('inc4')).toMatchObject({ rep_min: 8, rep_max: 12 })
    expect(db.rowsOf(INC).filter((r) => r.parent_program_set_id === null).map((r) => [r.rep_min, r.rep_max])).toEqual([[12, 12], [8, 12], [8, 12], [8, 12]])
    expect(textOf(exercise(INC).getByRole('button', { name: 'Rep target for the dropset stage' }))).toBe('8–10')

    // the same target again is nothing to write
    click('Rep target for the dropset stage')
    fireEvent.click(repSheet().getByRole('button', { name: 'SET 8–10 REPS' }))
    await settled()
    expect(db.requests()).toHaveLength(1)
  })
})

// A rep picker or the ALL picker is open on sets that are then removed on another phone: it closes, and it does not come back when sets are added again.
describe('a picker whose sets have gone closes, and stays closed', () => {
  it('ALL opened on Pec Deck Fly, the exercise\'s sets removed elsewhere and read again: no picker; sets added again later: still none', async () => {
    await arrange()
    open('Pec Deck Fly')
    click("Set every set's rep target for Pec Deck Fly")
    expect(screen.getByRole('dialog', { name: 'Rep target' })).toBeTruthy()

    db.state.sets = db.state.sets.filter((s) => s.program_exercise_id !== FLY)
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2_programSets'] })
    })
    await vi.waitFor(() => expect(stepper('Pec Deck Fly')).toBe('−0+'), FOUND)
    expect(screen.queryByRole('dialog')).toBeNull()

    db.state.sets.push(fakeProgramSet('fly9', FLY, 1, { rep_min: 10, rep_max: 12 }))
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['v2_programSets'] })
    })
    await vi.waitFor(() => expect(stepper('Pec Deck Fly')).toBe('−1+'), FOUND)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('REMOVE THIS SET asked while a type change is still out asks for nothing: the set stays and the picker stays open', async () => {
    await arrange()
    open('Pec Deck Fly')
    click('Set 02: type')
    let release: () => void = () => undefined
    db.gate = new Promise<void>((resolve) => (release = resolve))
    try {
      fireEvent.click(typeSheet().getByRole('button', { name: /^Dropset/ }))
      await vi.waitFor(() => expect(db.requests()).toHaveLength(2), FOUND)
      fireEvent.click(typeSheet().getByRole('button', { name: 'REMOVE THIS SET' }))
      expect(db.requests()).toHaveLength(2)
      expect(screen.getByRole('dialog', { name: 'What is this set?' })).toBeTruthy()
    } finally {
      db.gate = null
      await act(async () => release())
    }
    await settled()
    expect(db.row('fly2')).toBeDefined()
    expect(db.requests().map((r) => r[0])).toEqual(['update', 'insert'])
  })
})

// ─── REST AFTER ───────────────────────────────────────────────────────────────────────────────────────

describe("a set's REST AFTER stepper writes that head's rest_seconds", () => {
  it('+ from CHAIN starts at 15 s; the next + is 30 s; − at the first step clears back to CHAIN; each writes only that set', async () => {
    await arrange()
    open('Incline Dumbbell Press')
    click('More rest after set 02')
    await settled()
    expect(textOf(screen.getByRole('group', { name: 'Rest after set 02' }))).toBe('−15s+')
    click('More rest after set 02')
    await settled()
    expect(textOf(screen.getByRole('group', { name: 'Rest after set 02' }))).toBe('−30s+')
    click('Less rest after set 02')
    await settled()
    expect(textOf(screen.getByRole('group', { name: 'Rest after set 02' }))).toBe('−15s+')
    click('Less rest after set 02')
    await settled()
    expect(textOf(screen.getByRole('group', { name: 'Rest after set 02' }))).toBe('−CHAIN+')

    expect(db.requests()).toEqual([
      ['update', 'inc2', { rest_seconds: 15 }],
      ['update', 'inc2', { rest_seconds: 30 }],
      ['update', 'inc2', { rest_seconds: 15 }],
      ['update', 'inc2', { rest_seconds: null }],
    ])
    expect(db.rowsOf(INC).map((r) => [r.id, r.rest_seconds])).toEqual([['inc1', null], ['inc2', null], ['inc3', null], ['inc4', 180], ['inc4s1', null]])
  })

  it('a set with a rest of its own shows it in minutes and seconds, and its stage row has no stepper of its own', async () => {
    await arrange()
    open('Incline Dumbbell Press')
    expect(textOf(screen.getByRole('group', { name: 'Rest after set 04' }))).toBe('−3min 0s+')
    click('Less rest after set 04')
    await settled()
    expect(db.requests()).toEqual([['update', 'inc4', { rest_seconds: 165 }]])
    expect(exercise(INC).getAllByRole('group', { name: /^Rest after set/ })).toHaveLength(4)
  })

  it('it stops at ten minutes', async () => {
    const sets = world().map((s) => (s.id === 'fly1' ? { ...s, rest_seconds: 600 } : s))
    await arrange(sets)
    open('Pec Deck Fly')
    expect((screen.getByRole('button', { name: 'More rest after set 01' }) as HTMLButtonElement).disabled).toBe(true)
    expect(textOf(screen.getByRole('group', { name: 'Rest after set 01' }))).toBe('−10min 0s+')
  })
})

// ─── What is never written ─────────────────────────────────────────────────────────────────────────────

describe('the step writes v2_program_sets of the saved program, never a week set', () => {
  it('a run of every kind of write leaves the week sets linked to those program sets as they were, and every request names v2_program_sets', async () => {
    await arrange()
    open('Pec Deck Fly')
    click('More sets for Pec Deck Fly')
    await settled()
    click('Rep target for set 01')
    fireEvent.change(repSheet().getByRole('textbox', { name: 'From' }), { target: { value: '4' } })
    fireEvent.change(repSheet().getByRole('textbox', { name: 'To' }), { target: { value: '6' } })
    fireEvent.click(repSheet().getByRole('button', { name: 'SET 4–6 REPS' }))
    await settled()
    click('More rest after set 02')
    await settled()
    click('Set 03: type')
    fireEvent.click(typeSheet().getByRole('button', { name: /^Dropset/ }))
    await settled()
    fireEvent.click(typeSheet().getByRole('button', { name: /^Warmup/ }))
    await settled()
    fireEvent.click(typeSheet().getByRole('button', { name: 'REMOVE THIS SET' }))
    await settled()

    expect(db.requests().length).toBeGreaterThanOrEqual(6)
    expect(db.writes.every((w) => w.table === 'v2_program_sets')).toBe(true)
    expect(db.requests('v2_week_plan_sets')).toEqual([])
    expect(db.state.weekSets).toEqual(WEEK_SETS)
    // the program's rows did change: it was not a vacuous run
    expect(db.row('fly1')).toMatchObject({ rep_min: 4, rep_max: 6 })
    expect(db.row('fly2')).toMatchObject({ rest_seconds: 15 })
    expect(db.row('fly3')).toBeUndefined()
  })
})
