// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { Program, ProgramExercise, WorkoutDay } from '../../types'
import { queryClient } from '../../lib/queryClient'
import { createFakeProgramSetsDb, fakeProgramSet, fakeProgramStage, type FakeProgramSetRow } from './fakeProgramSetsDb.testutil'
import { FLY, FOUND, INC, exercise, makeProgram, open, renderStep, settled, textOf, typeSheet, world, worldWorkouts } from './stepVolume.testutil'

// Chunk 67 (TASKS-1.2 "The stepped planner's step 3 on the shared pickers"; SPEC Set types and staged sets [1.2]: "Picking a staged kind adds its first
// stage; a stepper sets how many"; boards PP3, PP3c). Rewritten from chunk 14's StepVolume.stageKind (the DROPSET / REST-PAUSE / MYO-REPS / CLUSTER
// chips, ADD STAGE, the stage's delete icon, the STAGE REST row): the same writes, now made from a set's number, or its "DROPSET · 1 DROP" chip, on the
// shared set type picker. The real step, hooks and service over a stateful v2_program_sets (fakeProgramSetsDb.testutil.ts), which enforces the table's
// checks and the stage cascade; the assertions are the requests the database client got, in order, and the rows after.
//
// What the old buttons wrote, and what a pick writes now (the call parity TASKS 67 asks for): the STAGE KIND chip wrote `{ stage_kind }` to the head, ADD
// STAGE inserted a stage row at the head's position with the next stage index (`addProgramSetStage`: user, exercise, position, is_warmup false, the parent
// and the index), the STAGE REST stepper wrote `{ stage_rest_seconds }` to the head.

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

async function arrange(sets: FakeProgramSetRow[] = world(), program: Program = makeProgram()) {
  db = createFakeProgramSetsDb({ sets })
  ;({ workoutDays, exercisesByDay } = worldWorkouts())
  renderStep(StepVolume, { program })
  await screen.findByText('Incline Dumbbell Press', {}, FOUND)
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const pickType = (name: RegExp) => fireEvent.click(typeSheet().getByRole('button', { name }))
const stagesOf = (id: string) => db.stagesOf(id)

// Incline Dumbbell Press's set 04 as a staged set with the drops and the rest between them a test names.
function incline(overrides: Partial<FakeProgramSetRow>, stageIndexes: number[]): FakeProgramSetRow[] {
  return [
    ...world().filter((s) => s.program_exercise_id !== INC),
    fakeProgramSet('inc1', INC, 1, { rep_min: 8, rep_max: 12 }),
    fakeProgramSet('inc2', INC, 2, { rep_min: 8, rep_max: 12 }),
    fakeProgramSet('inc3', INC, 3, { rep_min: 8, rep_max: 12 }),
    fakeProgramSet('inc4', INC, 4, { rep_min: 8, rep_max: 12, ...overrides }),
    ...stageIndexes.map((i) => fakeProgramStage(`inc4s${i}`, INC, 'inc4', 4, i)),
  ]
}

const KINDS = [
  { id: 'dropset', row: /^Dropset/, chip: 'DROPSET · 1 DROP', stepper: 'drops', stage: 'dropset' },
  { id: 'rest_pause', row: /^Rest-pause/, chip: 'REST-PAUSE · 1 PAUSE', stepper: 'pauses', stage: 'rest-pause' },
  { id: 'myo_reps', row: /^Myo-reps/, chip: 'MYO-REPS · 1 MINI-SET', stepper: 'mini-sets', stage: 'myo-reps' },
  { id: 'cluster', row: /^Cluster/, chip: 'CLUSTER · 1 CLUSTER', stepper: 'clusters', stage: 'cluster' },
] as const

describe("a set's number opens the set type picker (planner variant: type, the stage stepper, REST BETWEEN, REMOVE THIS SET)", () => {
  it('Set 02 of Pec Deck Fly: the eyebrow names the exercise and the set, Normal is picked, and the rows are the planner\'s', async () => {
    await arrange()
    open('Pec Deck Fly')
    click('Set 02: type')

    const sheet = typeSheet()
    expect(sheet.getByText(/Pec Deck Fly · SET 02/i)).toBeTruthy()
    expect(sheet.getByRole('button', { name: /^Normal/ }).getAttribute('aria-pressed')).toBe('true')
    expect(sheet.getByRole('button', { name: /^Dropset/ }).getAttribute('aria-pressed')).toBe('false')
    expect(sheet.getAllByRole('button', { name: /^(Normal|Warmup|Dropset|Rest-pause|Myo-reps|Cluster)/ })).toHaveLength(6)
    // a plain set has no stage stepper and no REST BETWEEN; the planner draws no Cues row, no "Rest after this set", no workout note
    expect(sheet.queryByText('REST BETWEEN')).toBeNull()
    expect(sheet.queryByText('DROPS')).toBeNull()
    expect(sheet.queryByText('Cues')).toBeNull()
    expect(sheet.queryByText('Rest after this set')).toBeNull()
    expect(sheet.getByRole('button', { name: 'REMOVE THIS SET' })).toBeTruthy()
    expect(db.requests()).toEqual([])
  })

  it('the DROPSET · 1 DROP chip opens the same picker for that set, on Dropset with one drop and the dropset\'s REST BETWEEN', async () => {
    await arrange()
    open('Incline Dumbbell Press')
    click('Set 04 type: dropset, 1 drop')

    const sheet = typeSheet()
    expect(sheet.getByText(/Incline Dumbbell Press · SET 04/i)).toBeTruthy()
    expect(sheet.getByRole('button', { name: /^Dropset/ }).getAttribute('aria-pressed')).toBe('true')
    expect(sheet.getByText('DROPS')).toBeTruthy()
    expect(sheet.getByText('REST BETWEEN')).toBeTruthy()
    expect(sheet.getByText('NO TIMER')).toBeTruthy()
    expect((sheet.getByRole('button', { name: 'Fewer drops' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('stable programs use the same picker, REST BETWEEN included (the stepped planner edits the program itself)', async () => {
    await arrange(world(), makeProgram({ planningType: 'stable' }))
    open('Incline Dumbbell Press')
    click('Set 04 type: dropset, 1 drop')
    expect(typeSheet().getByText('REST BETWEEN')).toBeTruthy()
  })

  it('closing it writes nothing', async () => {
    await arrange()
    open('Pec Deck Fly')
    click('Set 02: type')
    fireEvent.click(typeSheet().getByRole('button', { name: 'Close' }))
    await settled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(db.requests()).toEqual([])
  })
})

describe('picking a staged kind on a plain set: the kind, then its first stage, exactly as the old chip and ADD STAGE wrote them', () => {
  it.each(KINDS)('$id: writes { stage_kind } to the head, then inserts one stage row at the head\'s position, index 1; the row then reads "$chip"', async ({ id, row, chip, stage, stepper }) => {
    await arrange()
    open('Pec Deck Fly')
    click('Set 02: type')
    pickType(row)
    await settled()

    expect(db.requests()).toEqual([
      ['update', 'fly2', { stage_kind: id }],
      ['insert', null, { user_id: 'user-1', program_exercise_id: FLY, position: 2, is_warmup: false, parent_program_set_id: 'fly2', stage_index: 1 }],
    ])
    expect(db.row('fly2')).toMatchObject({ stage_kind: id, is_warmup: false, stage_rest_seconds: null })
    expect(stagesOf('fly2')).toHaveLength(1)
    expect(stagesOf('fly2')[0]).toMatchObject({ position: 2, stage_index: 1, stage_kind: null, stage_rest_seconds: null, is_warmup: false, rep_min: null, rep_max: null })
    // the screen reads it back: the chip, the stage row named for the kind, and the picker on the picked row
    expect(textOf(exercise(FLY).getByRole('button', { name: new RegExp(`^Set 02 type: ${stage}`) }))).toBe(chip)
    expect(exercise(FLY).getByRole('button', { name: `Rep target for the ${stage} stage` })).toBeTruthy()
    expect(typeSheet().getByRole('button', { name: row }).getAttribute('aria-pressed')).toBe('true')
    expect(typeSheet().getByRole('button', { name: `More ${stepper}` })).toBeTruthy()
    // no other set of the exercise, and no other exercise, was written
    expect(db.rowsOf(FLY).filter((r) => r.id !== 'fly2' && r.id !== stagesOf('fly2')[0].id).every((r) => r.stage_kind === null)).toBe(true)
    expect(db.rowsOf(INC).map((r) => r.id)).toEqual(['inc1', 'inc2', 'inc3', 'inc4', 'inc4s1'])
  })

  it('the head\'s own rep target stays on it, the new stage starts with none, and the set number rows do not move', async () => {
    await arrange()
    open('Pec Deck Fly')
    click('Set 02: type')
    pickType(/^Dropset/)
    await settled()
    expect(db.row('fly2')).toMatchObject({ rep_min: 10, rep_max: 12 })
    expect(textOf(exercise(FLY).getByRole('button', { name: 'Rep target for set 02' }))).toBe('10–12')
    expect(textOf(exercise(FLY).getByRole('button', { name: 'Rep target for the dropset stage' }))).toBe('—')
    expect(exercise(FLY).getAllByRole('button', { name: /^Set \d\d: type$/ }).map((b) => textOf(b))).toEqual(['01', '02', '03'])
  })
})

describe('changing the kind of a staged set keeps its stages and its rest between them', () => {
  it('Dropset to Rest-pause on one drop: only { stage_kind } is written; the chip and the stage row follow', async () => {
    await arrange()
    open('Incline Dumbbell Press')
    click('Set 04 type: dropset, 1 drop')
    pickType(/^Rest-pause/)
    await settled()

    expect(db.requests()).toEqual([['update', 'inc4', { stage_kind: 'rest_pause' }]])
    expect(stagesOf('inc4').map((s) => s.id)).toEqual(['inc4s1'])
    expect(textOf(exercise(INC).getByRole('button', { name: /^Set 04 type: rest-pause/ }))).toBe('REST-PAUSE · 1 PAUSE')
    expect(exercise(INC).getByRole('button', { name: 'Rep target for the rest-pause stage' })).toBeTruthy()
  })

  it('two drops with 20 seconds between them: the kind changes, the two stages and the 20 seconds stay', async () => {
    await arrange(incline({ stage_kind: 'dropset', stage_rest_seconds: 20 }, [1, 2]))
    open('Incline Dumbbell Press')
    click('Set 04 type: dropset, 2 drops')
    pickType(/^Cluster/)
    await settled()

    expect(db.requests()).toEqual([['update', 'inc4', { stage_kind: 'cluster' }]])
    expect(stagesOf('inc4').map((s) => s.stage_index)).toEqual([1, 2])
    expect(db.row('inc4')).toMatchObject({ stage_kind: 'cluster', stage_rest_seconds: 20 })
    expect(typeSheet().getByText('0:20')).toBeTruthy()
    expect(textOf(exercise(INC).getByRole('button', { name: /^Set 04 type: cluster/ }))).toBe('CLUSTER · 2 CLUSTERS')
  })

  it('a dropset whose head has no kind (an old ADD STAGE left it null) reads as Dropset: picking Dropset is nothing, the stepper adds a stage and leaves the kind alone', async () => {
    await arrange(incline({ stage_kind: null }, [1]))
    open('Incline Dumbbell Press')
    click('Set 04 type: dropset, 1 drop')
    expect(typeSheet().getByRole('button', { name: /^Dropset/ }).getAttribute('aria-pressed')).toBe('true')
    pickType(/^Dropset/)
    await settled()
    expect(db.requests()).toEqual([])

    fireEvent.click(typeSheet().getByRole('button', { name: 'More drops' }))
    await settled()
    expect(db.requests()).toEqual([['insert', null, { user_id: 'user-1', program_exercise_id: INC, position: 4, is_warmup: false, parent_program_set_id: 'inc4', stage_index: 2 }]])
    expect(db.row('inc4')?.stage_kind).toBeNull()
    expect(stagesOf('inc4')).toHaveLength(2)
  })
})

describe('the stage stepper (DROPS, PAUSES, MINI-SETS, CLUSTERS) adds and removes the stage rows', () => {
  it('More adds a stage one past the highest stage index (not the count + 1) at the head\'s position; Fewer removes the highest index', async () => {
    // a drop deleted earlier left the indexes 1 and 3
    await arrange(incline({ stage_kind: 'dropset' }, [1, 3]))
    open('Incline Dumbbell Press')
    click('Set 04 type: dropset, 2 drops')

    fireEvent.click(typeSheet().getByRole('button', { name: 'More drops' }))
    await settled()
    expect(db.requests()).toEqual([['insert', null, { user_id: 'user-1', program_exercise_id: INC, position: 4, is_warmup: false, parent_program_set_id: 'inc4', stage_index: 4 }]])
    expect(stagesOf('inc4').map((s) => s.stage_index)).toEqual([1, 3, 4])

    fireEvent.click(typeSheet().getByRole('button', { name: 'Fewer drops' }))
    await settled()
    // the stage just added is the one with the highest index; it goes, by its own id
    expect(db.requests()[1]).toEqual(['delete', 'new-1', null])
    expect(stagesOf('inc4').map((s) => s.stage_index)).toEqual([1, 3])
    expect(db.row('inc4s3')).toBeDefined()
    expect(textOf(exercise(INC).getByRole('button', { name: /^Set 04 type: dropset/ }))).toBe('DROPSET · 2 DROPS')
  })

  it('Fewer removes the stage with the highest index by its own id, and the head and the other stages stay', async () => {
    await arrange(incline({ stage_kind: 'rest_pause' }, [1, 2, 3]))
    open('Incline Dumbbell Press')
    click('Set 04 type: rest-pause, 3 pauses')
    fireEvent.click(typeSheet().getByRole('button', { name: 'Fewer pauses' }))
    await settled()
    expect(db.requests()).toEqual([['delete', 'inc4s3', null]])
    expect(stagesOf('inc4').map((s) => s.id)).toEqual(['inc4s1', 'inc4s2'])
    expect(db.row('inc4')).toBeDefined()
  })

  it('the lowest count is one, the highest ten, as the picker holds them', async () => {
    await arrange(incline({ stage_kind: 'dropset' }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    open('Incline Dumbbell Press')
    click('Set 04 type: dropset, 10 drops')
    expect((typeSheet().getByRole('button', { name: 'More drops' }) as HTMLButtonElement).disabled).toBe(true)
    expect((typeSheet().getByRole('button', { name: 'Fewer drops' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('REST BETWEEN is the head\'s stage_rest_seconds (the old STAGE REST row)', () => {
  it('a dropset has no timer by default; + starts at 15 s and writes { stage_rest_seconds: 15 } to the head only; − at the first step goes back to the kind\'s own (null)', async () => {
    await arrange()
    open('Incline Dumbbell Press')
    click('Set 04 type: dropset, 1 drop')
    expect(typeSheet().getByText('NO TIMER')).toBeTruthy()

    fireEvent.click(typeSheet().getByRole('button', { name: 'Rest between: more' }))
    await settled()
    expect(db.requests()).toEqual([['update', 'inc4', { stage_rest_seconds: 15 }]])
    expect(typeSheet().getByText('0:15')).toBeTruthy()
    fireEvent.click(typeSheet().getByRole('button', { name: 'Rest between: less' }))
    await settled()
    expect(db.requests()[1]).toEqual(['update', 'inc4', { stage_rest_seconds: null }])
    expect(typeSheet().getByText('NO TIMER')).toBeTruthy()
    expect(db.stagesOf('inc4')[0]).toMatchObject({ stage_rest_seconds: null })
  })

  it('a rest-pause set starts from its own 15 s: + goes to 30 s', async () => {
    await arrange(incline({ stage_kind: 'rest_pause' }, [1]))
    open('Incline Dumbbell Press')
    click('Set 04 type: rest-pause, 1 pause')
    expect(typeSheet().getByText('0:15')).toBeTruthy()
    fireEvent.click(typeSheet().getByRole('button', { name: 'Rest between: more' }))
    await settled()
    expect(db.requests()).toEqual([['update', 'inc4', { stage_rest_seconds: 30 }]])
  })
})

describe('what a pick that is cut short leaves, and a pick while another is out', () => {
  it('the kind written and the stage insert refused: the set is a plain set (a kind with no stage reads Normal), never stages under the wrong kind', async () => {
    await arrange()
    db.refuse = (write) => (write.op === 'insert' ? 'stage refused' : null)
    open('Pec Deck Fly')
    click('Set 02: type')
    pickType(/^Myo-reps/)
    await settled()

    expect(db.requests().map((r) => r[0])).toEqual(['update', 'insert'])
    expect(db.row('fly2')?.stage_kind).toBe('myo_reps')
    expect(stagesOf('fly2')).toEqual([])
    // the picker reads the database: Normal, no chip
    expect(typeSheet().getByRole('button', { name: /^Normal/ }).getAttribute('aria-pressed')).toBe('true')
    expect(exercise(FLY).queryByRole('button', { name: /^Set 02 type:/ })).toBeNull()
  })

  it('a pick that arrives while the previous one is still being read back asks for nothing', async () => {
    await arrange()
    open('Pec Deck Fly')
    click('Set 02: type')
    let release: () => void = () => undefined
    db.gate = new Promise<void>((resolve) => (release = resolve))
    try {
      pickType(/^Dropset/)
      await vi.waitFor(() => expect(db.requests()).toHaveLength(2), FOUND)
      // both writes are answered, the read is held: this tap would be worked out from a set that still reads Normal
      pickType(/^Cluster/)
      expect(db.requests()).toHaveLength(2)
    } finally {
      db.gate = null
      await act(async () => release())
    }
    await settled()
    expect(db.requests()).toHaveLength(2)
    expect(stagesOf('fly2')).toHaveLength(1)
    expect(db.row('fly2')?.stage_kind).toBe('dropset')
  })
})
