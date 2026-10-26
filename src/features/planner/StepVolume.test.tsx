// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { Program, ProgramExercise, WorkoutDay } from '../../types'
import { queryClient } from '../../lib/queryClient'
import { createFakeProgramSetsDb, type FakeProgramSetRow } from './fakeProgramSetsDb.testutil'
import { DIPS, FLY, FOUND, INC, LAT, exercise, makeProgram, open, renderStep, settled, textOf, world, worldWorkouts } from './stepVolume.testutil'

// Chunk 67 (TASKS-1.2 "The stepped planner's step 3 on the shared pickers"; SPEC Stepped program planner [1.2]; boards PP3, PP3b, PP6's two volume
// states). What step 3 DRAWS: the PLANNING segment and its line, a card per workout (the first open, the others closed with their weekday), the
// SETS stepper per exercise ("NO SETS YET" in red at 0), an exercise's rows opened (ALL, the REST AFTER column, a number per set, its rep box, the
// staged chip and the stage's own rep box), the states, and what is gone. What each control WRITES is the other StepVolume files' (sets, stageKind,
// warmup). The real step and the real hooks and service, over a stateful stand-in for v2_program_sets (fakeProgramSetsDb.testutil.ts); only the
// program and exercise reads (usePrograms) are mocked, as every planner test does.

let db = createFakeProgramSetsDb({ sets: [] })
let workoutDays: WorkoutDay[] = []
let exercisesByDay: Record<string, ProgramExercise[]> = {}
let loading = { days: false, exercises: false }
const updatePlanningTypeMock = vi.fn()

vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => (db.client.from as (t: string) => unknown)(table) } }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: workoutDays, isLoading: loading.days }),
  useProgramExercises: (id: string) => ({ data: exercisesByDay[id] ?? [], isLoading: loading.exercises }),
  useUpdatePlanningType: () => ({ mutate: updatePlanningTypeMock, isPending: false }),
}))

const { default: StepVolume } = await import('./StepVolume')

afterEach(() => {
  cleanup()
  queryClient.clear()
  updatePlanningTypeMock.mockReset()
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  loading = { days: false, exercises: false }
})

function setup(sets: FakeProgramSetRow[] = world()) {
  db = createFakeProgramSetsDb({ sets })
  const w = worldWorkouts()
  workoutDays = w.workoutDays
  exercisesByDay = w.exercisesByDay
}

function arrange(program: Program = makeProgram(), props: Partial<{ volumeReadOnly: boolean; canChangePlanningType: boolean }> = {}, sets?: FakeProgramSetRow[]) {
  setup(sets)
  return renderStep(StepVolume, { program, ...props })
}

describe('step 3 — the planning segment (boards PP3, PP3b)', () => {
  it('week-dependent: the segment says so and the line reads "Only week 1 is planned here; later weeks copy forward."', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    expect(screen.getByText('PLANNING')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'WEEK-DEPENDENT' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'STABLE' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('Only week 1 is planned here; later weeks copy forward.')).toBeTruthy()
    expect(screen.queryByText('The sets planned here are the volume for every week.')).toBeNull()
  })

  it('stable: the line reads "The sets planned here are the volume for every week."', async () => {
    arrange(makeProgram({ planningType: 'stable' }))
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    expect(screen.getByRole('button', { name: 'STABLE' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('The sets planned here are the volume for every week.')).toBeTruthy()
    expect(screen.queryByText('Only week 1 is planned here; later weeks copy forward.')).toBeNull()
  })

  it('canChangePlanningType: tapping STABLE asks useUpdatePlanningType for the program', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    fireEvent.click(screen.getByRole('button', { name: 'STABLE' }))
    expect(updatePlanningTypeMock).toHaveBeenCalledWith({ id: 'prog-1', planningType: 'stable' })
  })

  it('the program already has that planning type, or the run does not re-choose it: nothing is asked', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    fireEvent.click(screen.getByRole('button', { name: 'WEEK-DEPENDENT' }))
    expect(updatePlanningTypeMock).not.toHaveBeenCalled()
    cleanup()
    arrange(makeProgram({ planningType: 'stable' }), { canChangePlanningType: false })
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    expect((screen.getByRole('button', { name: 'STABLE' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'WEEK-DEPENDENT' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('step 3 — a card per workout, the first open (board PP3)', () => {
  it('Push 1 is open with its exercises and a SETS stepper each; Pull 1 and Legs are closed cards naming their weekday', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)

    expect(screen.getByText('Push 1')).toBeTruthy()
    expect(screen.getByText('SETS')).toBeTruthy()
    for (const [name, count] of [['Incline Dumbbell Press', '4'], ['Dips', '0'], ['Pec Deck Fly', '3'], ['Lateral Raise', '4']] as const) {
      expect(textOf(screen.getByRole('group', { name: `Sets for ${name}` })), name).toBe(`−${count}+`)
    }

    const pull = screen.getByRole('button', { name: 'Show editor for Pull 1' })
    expect(pull.getAttribute('aria-expanded')).toBe('false')
    expect(textOf(pull)).toContain('Pull 1')
    expect(textOf(pull)).toContain('WED')
    expect(textOf(screen.getByRole('button', { name: 'Show editor for Legs' }))).toContain('FRI')
    // the open workout is not also a closed card, and its own weekday is not drawn on it
    expect(screen.queryByRole('button', { name: 'Show editor for Push 1' })).toBeNull()
    expect(screen.queryByText('MON')).toBeNull()
    // a closed workout reads nothing of its own yet: its exercises are not drawn
    expect(screen.queryByText('Barbell Row')).toBeNull()
  })

  it('opening another workout reads it and closes the first: Push 1 becomes a closed card with its weekday', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)

    fireEvent.click(screen.getByRole('button', { name: 'Show editor for Pull 1' }))

    expect(await screen.findByText('Barbell Row', {}, FOUND)).toBeTruthy()
    expect(textOf(screen.getByRole('group', { name: 'Sets for Barbell Row' }))).toBe('−3+')
    expect(screen.queryByText('Incline Dumbbell Press')).toBeNull()
    expect(textOf(screen.getByRole('button', { name: 'Show editor for Push 1' }))).toContain('MON')
    expect(screen.queryByRole('button', { name: 'Show editor for Pull 1' })).toBeNull()
  })

  it('a sequence program has no weekday to name: its closed cards say none', async () => {
    arrange(makeProgram({ scheduleType: 'sequence', schedule: { monday: 'wd-1', tuesday: null, wednesday: 'wd-2', thursday: null, friday: null, saturday: null, sunday: null } }))
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    expect(textOf(screen.getByRole('button', { name: 'Show editor for Pull 1' }))).toBe('Pull 1')
  })

  it('a workout with no exercises opens to a line that says so', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    fireEvent.click(screen.getByRole('button', { name: 'Show editor for Legs' }))
    expect(await screen.findByText('NO EXERCISES YET', {}, FOUND)).toBeTruthy()
  })

  it('an exercise with no sets says NO SETS YET and has nothing to open; one with sets has', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    expect(screen.getAllByText('NO SETS YET')).toHaveLength(1)
    expect(within(document.querySelector(`[data-exercise="${DIPS}"]`) as HTMLElement).getByText('NO SETS YET')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show set targets for Dips' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show set targets for Pec Deck Fly' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Fewer sets for Dips' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'More sets for Dips' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('step 3 — an exercise opened (board PP3)', () => {
  it('the rows: ALL reads MIXED, each set has its number, rep box and REST AFTER (CHAIN or its own), the warmup its chip, the dropset its chip and its stage', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    open('Incline Dumbbell Press')
    const inc = exercise(INC)

    expect(inc.getByRole('button', { name: 'Hide set targets for Incline Dumbbell Press' }).getAttribute('aria-expanded')).toBe('true')
    expect(textOf(inc.getByRole('button', { name: "Set every set's rep target for Incline Dumbbell Press" }))).toBe('MIXED')
    expect(inc.getByText('REST AFTER')).toBeTruthy()
    const reps = (n: string) => textOf(inc.getByRole('button', { name: `Rep target for set ${n}` }))
    expect([reps('01'), reps('02'), reps('03'), reps('04')]).toEqual(['12WARMUP', '8–12', '8–12', '8–12'])
    expect(inc.getAllByText('WARMUP')).toHaveLength(1)
    for (const n of ['01', '02', '03', '04']) expect(textOf(inc.getByRole('button', { name: `Set ${n}: type` }))).toBe(n)
    const rest = (n: string) => textOf(inc.getByRole('group', { name: `Rest after set ${n}` }))
    expect([rest('01'), rest('02'), rest('03'), rest('04')]).toEqual(['−CHAIN+', '−CHAIN+', '−CHAIN+', '−3min 0s+'])

    // the staged set: a chip that opens the picker, and one stage row with a box of its own
    expect(textOf(inc.getByRole('button', { name: 'Set 04 type: dropset, 1 drop' }))).toBe('DROPSET · 1 DROP')
    expect(textOf(inc.getByRole('button', { name: 'Rep target for the dropset stage' }))).toBe('—')
    expect(inc.getAllByText('↳')).toHaveLength(1)
    // no other set is staged
    expect(inc.queryByRole('button', { name: /Set 0[123] type:/ })).toBeNull()
  })

  it('the chevron hides the rows again, and the exercises stay independent', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    open('Pec Deck Fly')
    open('Incline Dumbbell Press')
    expect(exercise(FLY).getByRole('button', { name: 'Rep target for set 01' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide set targets for Incline Dumbbell Press' }))
    expect(exercise(INC).queryByRole('button', { name: 'Rep target for set 01' })).toBeNull()
    expect(exercise(FLY).getByRole('button', { name: 'Rep target for set 01' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show set targets for Incline Dumbbell Press' }).getAttribute('aria-expanded')).toBe('false')
  })

  it("ALL reads the target every set has (10–12), a dash when none has one, and MIXED when they differ", async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    open('Pec Deck Fly')
    open('Lateral Raise')
    expect(textOf(exercise(FLY).getByRole('button', { name: "Set every set's rep target for Pec Deck Fly" }))).toBe('10–12')
    expect(textOf(exercise(LAT).getByRole('button', { name: "Set every set's rep target for Lateral Raise" }))).toBe('—')
    expect(textOf(exercise(LAT).getByRole('button', { name: 'Rep target for set 03' }))).toBe('—')
  })

  it('a set row is numbered by its rank, not its stored position (a gap in the positions is not drawn)', async () => {
    arrange(makeProgram(), {}, world().filter((s) => s.id !== 'fly2'))
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    open('Pec Deck Fly')
    const fly = exercise(FLY)
    expect(fly.getAllByRole('button', { name: /^Set \d\d: type$/ }).map((b) => textOf(b))).toEqual(['01', '02'])
    expect(textOf(fly.getByRole('group', { name: 'Sets for Pec Deck Fly' }))).toBe('−2+')
  })
})

describe('step 3 — what the old step drew is gone (TASKS 67: the buttons, + ADD STAGE, the stage delete icon, the STAGE REST row, typed rep targets)', () => {
  it('none of it is on a step that would draw all of it: a warmup, a dropset with a stage and sets with targets, every exercise open', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    for (const name of ['Incline Dumbbell Press', 'Pec Deck Fly', 'Lateral Raise']) open(name)

    // it is the step this absence is about: the rows, the staged chip and a stage are there
    expect(exercise(INC).getByRole('button', { name: 'Set 04 type: dropset, 1 drop' })).toBeTruthy()
    expect(exercise(INC).getByRole('button', { name: 'Rep target for the dropset stage' })).toBeTruthy()
    expect(exercise(INC).getAllByText('WARMUP')).toHaveLength(1)

    for (const label of ['ADD STAGE', 'STAGE KIND', 'STAGE REST', 'SET KIND', 'ALL SETS', 'NO TIMER']) expect(screen.queryByText(label), label).toBeNull()
    expect(screen.queryByRole('button', { name: /ADD STAGE/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove stage' })).toBeNull()
    for (const kind of ['DROPSET', 'REST-PAUSE', 'MYO-REPS', 'CLUSTER', 'WARMUP']) expect(screen.queryByRole('button', { name: kind }), kind).toBeNull()
    // the typed rep boxes: nothing to type into until a picker is open
    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.queryByPlaceholderText('8, 8-12, or AMRAP')).toBeNull()
  })

  it('no deload-rules control, whatever the planning type, the volume being read-only or an override stored on the program (chunk 48)', async () => {
    const stored = Object.assign(makeProgram(), { deloadRules: { sets: { mode: 'percent', value: 50, rounding: 'down' } } })
    for (const [program, props] of [
      [makeProgram(), {}],
      [stored, {}],
      [Object.assign(makeProgram({ planningType: 'stable' }), { deloadRules: stored.deloadRules }), { volumeReadOnly: true, canChangePlanningType: false }],
    ] as const) {
      arrange(program, props)
      await screen.findByText('Incline Dumbbell Press', {}, FOUND)
      expect(screen.getByRole('button', { name: 'STABLE' })).toBeTruthy() // the step rendered
      expect(screen.getByLabelText('More sets for Incline Dumbbell Press')).toBeTruthy()
      for (const text of ['DELOAD RULES', 'USE MY DEFAULT', 'CUSTOM', 'PERCENT', 'COUNT', 'ROUNDING', 'VALUE (%)']) expect(screen.queryByText(text), text).toBeNull()
      for (const name of ['Sets', 'Weight', 'Reps', 'RIR']) expect(screen.queryByRole('button', { name }), name).toBeNull()
      cleanup()
      queryClient.clear()
    }
  })
})

describe('step 3 — read only (the volume of a program that cannot change)', () => {
  it('the SETS stepper, the number boxes and the rep boxes are dead; the REST AFTER stepper, a design field, is not', async () => {
    arrange(makeProgram(), { volumeReadOnly: true })
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    open('Incline Dumbbell Press')
    const inc = exercise(INC)

    for (const name of ['Fewer sets for Incline Dumbbell Press', 'More sets for Incline Dumbbell Press']) expect((inc.getByRole('button', { name }) as HTMLButtonElement).disabled, name).toBe(true)
    for (const name of ['Set 01: type', 'Set 04 type: dropset, 1 drop', 'Rep target for set 02', 'Rep target for the dropset stage', "Set every set's rep target for Incline Dumbbell Press"]) {
      expect((inc.getByRole('button', { name }) as HTMLButtonElement).disabled, name).toBe(true)
    }
    expect((inc.getByRole('button', { name: 'More rest after set 02' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(inc.getByRole('button', { name: 'Set 01: type' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(inc.getByRole('button', { name: 'More sets for Incline Dumbbell Press' }))
    await settled()
    expect(db.requests()).toEqual([])
  })
})

describe('step 3 — the volume states (board PP6)', () => {
  it('VOLUME · NO WORKOUTS YET: a program with no workouts says so, with the PLANNING segment above it', () => {
    setup()
    workoutDays = []
    renderStep(StepVolume)
    expect(screen.getByText('NO WORKOUTS YET')).toBeTruthy()
    expect(screen.getByText('PLANNING')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('SETS')).toBeNull()
  })

  it('VOLUME · LOADING A WORKOUT: while its exercises are read the open workout is a card with a spinner (role status, "Loading"), not a list', () => {
    setup()
    loading = { days: false, exercises: true }
    renderStep(StepVolume)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(screen.queryByText('Incline Dumbbell Press')).toBeNull()
    expect(screen.queryByText('NO WORKOUTS YET')).toBeNull()
  })

  it('the workouts themselves still loading: the spinner and not NO WORKOUTS YET', () => {
    setup()
    loading = { days: true, exercises: false }
    workoutDays = []
    renderStep(StepVolume)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(screen.queryByText('NO WORKOUTS YET')).toBeNull()
  })
})

describe('step 3 — 375 px', () => {
  it('no rendered element carries a fixed pixel width wider than 375px, every exercise open', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    for (const name of ['Incline Dumbbell Press', 'Pec Deck Fly', 'Lateral Raise']) open(name)
    const offenders: string[] = []
    for (const el of document.body.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const value = el.style[prop]
        const m = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
