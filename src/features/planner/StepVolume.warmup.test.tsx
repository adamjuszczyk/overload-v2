// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import type { ProgramExercise, WorkoutDay } from '../../types'
import { queryClient } from '../../lib/queryClient'
import { createFakeProgramSetsDb, fakeProgramSet, fakeProgramStage, type FakeProgramSetRow } from './fakeProgramSetsDb.testutil'
import { FLY, FOUND, INC, exercise, makeProgram, open, renderStep, settled, textOf, typeSheet, world, worldWorkouts } from './stepVolume.testutil'

// Chunk 67 (TASKS-1.2 "The stepped planner's step 3 on the shared pickers"; SPEC Warmup sets [P1] "A set kind, planned in step 3", Set types and staged
// sets [1.2]: "Switching back to Normal or Warmup removes the stages. A warmup can never be staged"). Rewritten from chunk 15's StepVolume.warmup (the
// WARMUP chip a plain set was marked with): the same flag, now made from a set's number on the shared picker, in the order `v2_program_sets_warmup_check`
// allows ("a warmup is never staged": `not is_warmup or (stage_kind is null and parent_program_set_id is null)`).
//
// The real step, hooks and service over a stateful v2_program_sets (fakeProgramSetsDb.testutil.ts) that ENFORCES that check, the stage row's own check and
// the stage cascade, and can refuse a write: so a write made in the wrong order is refused the way the table refuses it, and a change cut short is read back
// from the rows it left. The assertions are the requests in order, the rows after, and what the screen then draws.

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

async function arrange(sets: FakeProgramSetRow[] = world()) {
  db = createFakeProgramSetsDb({ sets })
  ;({ workoutDays, exercisesByDay } = worldWorkouts())
  renderStep(StepVolume, { program: makeProgram() })
  await screen.findByText('Incline Dumbbell Press', {}, FOUND)
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const pickType = (name: RegExp) => fireEvent.click(typeSheet().getByRole('button', { name }))
const kinds = (rows: FakeProgramSetRow[]) => rows.map((r) => [r.id, r.is_warmup, r.stage_kind, r.stage_rest_seconds])

// Incline Dumbbell Press's set 04 as a staged set: two drops, rest-pause, 20 seconds between them, a rest after of 3 minutes and a target of 8–12.
function stagedIncline(overrides: Partial<FakeProgramSetRow> = {}, stageIndexes = [1, 2]): FakeProgramSetRow[] {
  return [
    ...world().filter((s) => s.program_exercise_id !== INC),
    fakeProgramSet('inc1', INC, 1, { is_warmup: true, rep_min: 12, rep_max: 12 }),
    fakeProgramSet('inc2', INC, 2, { rep_min: 8, rep_max: 12 }),
    fakeProgramSet('inc3', INC, 3, { rep_min: 8, rep_max: 12 }),
    fakeProgramSet('inc4', INC, 4, { rep_min: 8, rep_max: 12, rest_seconds: 180, stage_kind: 'rest_pause', stage_rest_seconds: 20, ...overrides }),
    ...stageIndexes.map((i) => fakeProgramStage(`inc4s${i}`, INC, 'inc4', 4, i)),
  ]
}

describe('a warmup is drawn on its rep box, and its picker offers every type', () => {
  it('the first set is a warmup: its rep box carries WARMUP, no other row does, and there is no WARMUP button to tap', async () => {
    await arrange()
    open('Incline Dumbbell Press')
    expect(textOf(exercise(INC).getByRole('button', { name: 'Rep target for set 01' }))).toBe('12WARMUP')
    expect(exercise(INC).getAllByText('WARMUP')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'WARMUP' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'SET KIND' })).toBeNull()

    click('Set 01: type')
    expect(typeSheet().getByRole('button', { name: /^Warmup/ }).getAttribute('aria-pressed')).toBe('true')
    expect(typeSheet().getAllByRole('button', { name: /^(Normal|Warmup|Dropset|Rest-pause|Myo-reps|Cluster)/ })).toHaveLength(6)
    expect(typeSheet().queryByText('DROPS')).toBeNull()
    expect(typeSheet().queryByText('REST BETWEEN')).toBeNull()
  })
})

describe('Normal and Warmup on a plain set write the flag, and only the flag', () => {
  it('Normal to Warmup: { is_warmup: true } on that head; the target, the rest after and the other sets stay', async () => {
    await arrange(world().map((s) => (s.id === 'fly2' ? { ...s, rest_seconds: 45 } : s)))
    open('Pec Deck Fly')
    click('Set 02: type')
    pickType(/^Warmup/)
    await settled()

    expect(db.requests()).toEqual([['update', 'fly2', { is_warmup: true }]])
    expect(db.row('fly2')).toMatchObject({ is_warmup: true, rep_min: 10, rep_max: 12, rest_seconds: 45, stage_kind: null })
    expect(db.rowsOf(FLY).map((r) => r.is_warmup)).toEqual([false, true, false])
    expect(textOf(exercise(FLY).getByRole('button', { name: 'Rep target for set 02' }))).toBe('10–12WARMUP')
    expect(typeSheet().getByRole('button', { name: /^Warmup/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('Warmup to Normal: { is_warmup: false }', async () => {
    await arrange()
    open('Incline Dumbbell Press')
    click('Set 01: type')
    pickType(/^Normal/)
    await settled()

    expect(db.requests()).toEqual([['update', 'inc1', { is_warmup: false }]])
    expect(exercise(INC).queryByText('WARMUP')).toBeNull()
  })

  it('a plain set that an old STAGE KIND chip left a kind on (no stages) has the kind cleared before it becomes a warmup, or the table would refuse it', async () => {
    await arrange(world().map((s) => (s.id === 'fly2' ? { ...s, stage_kind: 'cluster' } : s)))
    open('Pec Deck Fly')
    click('Set 02: type')
    expect(typeSheet().getByRole('button', { name: /^Normal/ }).getAttribute('aria-pressed')).toBe('true')
    pickType(/^Warmup/)
    await settled()

    expect(db.requests()).toEqual([
      ['update', 'fly2', { stage_kind: null }],
      ['update', 'fly2', { is_warmup: true }],
    ])
    expect(db.row('fly2')).toMatchObject({ is_warmup: true, stage_kind: null })
  })
})

describe('Warmup or Normal on a staged set: the stages go first, then the kind and the rest between them are cleared, then the flag', () => {
  it('Warmup on two drops of a rest-pause set with 20 s between them', async () => {
    await arrange(stagedIncline())
    open('Incline Dumbbell Press')
    click('Set 04 type: rest-pause, 2 pauses')
    pickType(/^Warmup/)
    await settled()

    expect(db.requests()).toEqual([
      ['delete', 'inc4s2', null],
      ['delete', 'inc4s1', null],
      ['update', 'inc4', { stage_kind: null }],
      ['update', 'inc4', { stage_rest_seconds: null }],
      ['update', 'inc4', { is_warmup: true }],
    ])
    expect(db.row('inc4')).toMatchObject({ is_warmup: true, stage_kind: null, stage_rest_seconds: null, rep_min: 8, rep_max: 12, rest_seconds: 180 })
    expect(db.stagesOf('inc4')).toEqual([])
    expect(textOf(exercise(INC).getByRole('button', { name: 'Rep target for set 04' }))).toBe('8–12WARMUP')
    expect(exercise(INC).queryByRole('button', { name: /^Set 04 type:/ })).toBeNull()
    expect(exercise(INC).queryByText('↳')).toBeNull()
  })

  it('Normal on the same set: the same three steps with no flag to write', async () => {
    await arrange(stagedIncline())
    open('Incline Dumbbell Press')
    click('Set 04 type: rest-pause, 2 pauses')
    pickType(/^Normal/)
    await settled()

    expect(db.requests()).toEqual([
      ['delete', 'inc4s2', null],
      ['delete', 'inc4s1', null],
      ['update', 'inc4', { stage_kind: null }],
      ['update', 'inc4', { stage_rest_seconds: null }],
    ])
    expect(db.row('inc4')).toMatchObject({ is_warmup: false, stage_kind: null, stage_rest_seconds: null })
    expect(db.stagesOf('inc4')).toEqual([])
  })

  it('a dropset whose head kind was never written (null) has no kind to clear: stages, then the flag', async () => {
    await arrange(stagedIncline({ stage_kind: null, stage_rest_seconds: null }, [1]))
    open('Incline Dumbbell Press')
    click('Set 04 type: dropset, 1 drop')
    pickType(/^Warmup/)
    await settled()

    expect(db.requests()).toEqual([
      ['delete', 'inc4s1', null],
      ['update', 'inc4', { is_warmup: true }],
    ])
    expect(db.row('inc4')).toMatchObject({ is_warmup: true, stage_kind: null })
  })
})

describe('a staged kind on a warmup: it stops being a warmup first, then takes the kind, then its first stage', () => {
  it('Dropset on set 01 of Incline Dumbbell Press (a warmup at 12)', async () => {
    await arrange()
    open('Incline Dumbbell Press')
    click('Set 01: type')
    pickType(/^Dropset/)
    await settled()

    expect(db.requests()).toEqual([
      ['update', 'inc1', { is_warmup: false }],
      ['update', 'inc1', { stage_kind: 'dropset' }],
      ['insert', null, { user_id: 'user-1', program_exercise_id: INC, position: 1, is_warmup: false, parent_program_set_id: 'inc1', stage_index: 1 }],
    ])
    expect(db.row('inc1')).toMatchObject({ is_warmup: false, stage_kind: 'dropset', rep_min: 12, rep_max: 12 })
    expect(db.stagesOf('inc1')).toHaveLength(1)
    expect(textOf(exercise(INC).getByRole('button', { name: 'Set 01 type: dropset, 1 drop' }))).toBe('DROPSET · 1 DROP')
    expect(textOf(exercise(INC).getByRole('button', { name: 'Rep target for set 01' }))).toBe('12')
    // the stage is on the head's row, not on a warmup: the table's check holds
    expect(db.rowsOf(INC).filter((r) => r.is_warmup).map((r) => r.id)).toEqual([])
  })
})

describe('a change that is cut short leaves a set the table accepts: never a warmup with a kind or stages', () => {
  it('the flag refused after the stages and the kind are gone: a plain Normal set, which the picker then reads', async () => {
    await arrange(stagedIncline())
    db.refuse = (write) => (write.op === 'update' && 'is_warmup' in write.patch ? 'warmup refused' : null)
    open('Incline Dumbbell Press')
    click('Set 04 type: rest-pause, 2 pauses')
    pickType(/^Warmup/)
    await settled()

    expect(db.requests().map((r) => r[0])).toEqual(['delete', 'delete', 'update', 'update', 'update'])
    expect(kinds(db.rowsOf(INC).filter((r) => r.id.startsWith('inc4')))).toEqual([['inc4', false, null, null]])
    expect(typeSheet().getByRole('button', { name: /^Normal/ }).getAttribute('aria-pressed')).toBe('true')
    expect(exercise(INC).queryByText('↳')).toBeNull()
  })

  it('the second stage\'s removal refused: the first is gone and the set is still staged with the one left, a kind and no warmup flag', async () => {
    await arrange(stagedIncline())
    db.refuse = (write) => (write.op === 'delete' && write.id === 'inc4s1' ? 'stage refused' : null)
    open('Incline Dumbbell Press')
    click('Set 04 type: rest-pause, 2 pauses')
    pickType(/^Warmup/)
    await settled()

    // the highest index goes first, so the stop leaves stage 1 under its head: fewer stages, nothing orphaned
    expect(db.requests().map((r) => [r[0], r[1]])).toEqual([['delete', 'inc4s2'], ['delete', 'inc4s1']])
    expect(db.row('inc4')).toMatchObject({ is_warmup: false, stage_kind: 'rest_pause', stage_rest_seconds: 20 })
    expect(db.stagesOf('inc4').map((s) => s.id)).toEqual(['inc4s1'])
    expect(textOf(exercise(INC).getByRole('button', { name: /^Set 04 type:/ }))).toBe('REST-PAUSE · 1 PAUSE')
  })

  it('a warmup picked as Dropset with the stage insert refused: a working set with a kind and no stage, which reads Normal', async () => {
    await arrange()
    db.refuse = (write) => (write.op === 'insert' ? 'stage refused' : null)
    open('Incline Dumbbell Press')
    click('Set 01: type')
    pickType(/^Dropset/)
    await settled()

    expect(kinds(db.rowsOf(INC).filter((r) => r.id === 'inc1'))).toEqual([['inc1', false, 'dropset', null]])
    expect(db.stagesOf('inc1')).toEqual([])
    expect(typeSheet().getByRole('button', { name: /^Normal/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('the control: the same refusal on a write the order does not need changes nothing (the stand-in does not refuse everything)', async () => {
    await arrange()
    db.refuse = (write) => (write.op === 'update' && 'stage_rest_seconds' in write.patch ? 'never asked' : null)
    open('Incline Dumbbell Press')
    click('Set 01: type')
    pickType(/^Normal/)
    await settled()
    expect(db.requests()).toEqual([['update', 'inc1', { is_warmup: false }]])
    expect(db.row('inc1')?.is_warmup).toBe(false)
  })
})
