// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import type { ProgramExercise, WorkoutDay } from '../../types'
import { queryClient } from '../../lib/queryClient'
import { captureRender } from '../../testing/captureRender'
import { createFakeProgramSetsDb, fakeProgramSet, fakeProgramStage, type FakeProgramSetRow } from './fakeProgramSetsDb.testutil'
import { FOUND, makeDay, makeExercise, makeProgram, renderStep, textOf } from './stepVolume.testutil'

// Chunk 67 (TASKS-1.2 "The stepped planner's step 3 on the shared pickers"; boards PP3, PP3b, PP3c, PP3d and PP6's two volume states). The
// render fixtures the 390 px pictures are taken from (`CAPTURE_RENDER=1 npx vitest run src/features/planner/StepVolume.boards.test.tsx`, then
// `npm run build` and `npm run shot`), each with what its board draws asserted beside it: the same elements, in the same order, with the same
// words (a picture is never pixel-matched). The program is the boards' own: "Bulk", Push 1 open with Incline Dumbbell Press, Dips, Pec Deck Fly,
// Lateral Raise and Triceps Pushdown, and Pull 1 (TUE), Push 2 (THU), Pull 2 (FRI) and Legs (SAT) closed. The page chrome around step 3 (the
// back button, the title, the step bar, SAVE and START, the bottom bar) is the planner page's, chunk 68's.
//
// A fixture is written BEFORE its assertions (RULES: a broken rule still writes the fixture a Chromium break then measures).

let db = createFakeProgramSetsDb({ sets: [] })
let workoutDays: WorkoutDay[] = []
let exercisesByDay: Record<string, ProgramExercise[]> = {}
let loading = { days: false, exercises: false }

vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => (db.client.from as (t: string) => unknown)(table) } }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: workoutDays, isLoading: loading.days }),
  useProgramExercises: (id: string) => ({ data: exercisesByDay[id] ?? [], isLoading: loading.exercises }),
  useUpdatePlanningType: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: StepVolume } = await import('./StepVolume')

afterEach(() => {
  cleanup()
  queryClient.clear()
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  loading = { days: false, exercises: false }
})

const INC = 'pe-incline'
const DIPS = 'pe-dips'
const FLY = 'pe-fly'
const LAT = 'pe-lateral'
const PUSH = 'pe-pushdown'

// Incline Dumbbell Press: 01 a warmup at 12, 02 and 03 at 8–12, 04 at 8–12 with 3min 0s after it and one drop (board PP3). Dips has no sets. Pec Deck
// Fly 3, Lateral Raise 4, Triceps Pushdown 3. `incline2` is set 02's target (PP3d draws 8–10 in its picker).
function world(incline2 = { rep_min: 8, rep_max: 12 }): FakeProgramSetRow[] {
  const plain = (id: string, exercise: string, position: number, over: Partial<FakeProgramSetRow> = {}) => fakeProgramSet(id, exercise, position, { rep_min: 8, rep_max: 12, ...over })
  return [
    fakeProgramSet('inc1', INC, 1, { is_warmup: true, rep_min: 12, rep_max: 12 }),
    plain('inc2', INC, 2, incline2),
    plain('inc3', INC, 3),
    plain('inc4', INC, 4, { rest_seconds: 180, stage_kind: 'dropset' }),
    fakeProgramStage('inc4s1', INC, 'inc4', 4, 1),
    ...[1, 2, 3].map((p) => plain(`fly${p}`, FLY, p, { rep_min: 10, rep_max: 12 })),
    ...[1, 2, 3, 4].map((p) => plain(`lat${p}`, LAT, p, { rep_min: 12, rep_max: 15 })),
    ...[1, 2, 3].map((p) => plain(`push${p}`, PUSH, p, { rep_min: 10, rep_max: 12 })),
  ]
}

function arrange(options: { planningType?: 'stable' | 'week_dependent'; sets?: FakeProgramSetRow[]; empty?: boolean } = {}) {
  db = createFakeProgramSetsDb({ sets: options.sets ?? world() })
  workoutDays = options.empty
    ? []
    : [makeDay('wd-1', 'Push 1', 0), makeDay('wd-2', 'Pull 1', 1), makeDay('wd-3', 'Push 2', 2), makeDay('wd-4', 'Pull 2', 3), makeDay('wd-5', 'Legs', 4)]
  exercisesByDay = {
    'wd-1': [
      makeExercise(INC, 'wd-1', 'Incline Dumbbell Press', 0),
      makeExercise(DIPS, 'wd-1', 'Dips', 1),
      makeExercise(FLY, 'wd-1', 'Pec Deck Fly', 2),
      makeExercise(LAT, 'wd-1', 'Lateral Raise', 3),
      makeExercise(PUSH, 'wd-1', 'Triceps Pushdown', 4),
    ],
  }
  const program = makeProgram({
    planningType: options.planningType ?? 'week_dependent',
    schedule: { monday: 'wd-1', tuesday: 'wd-2', wednesday: null, thursday: 'wd-3', friday: 'wd-4', saturday: 'wd-5', sunday: null },
  })
  return renderStep(StepVolume, { program }, { frame: true })
}

const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('board PP3 — 3 volume, week-dependent: Push 1 open, Incline Dumbbell Press opened', () => {
  it('the planning segment and its line, the workout card with SETS, the exercises with their steppers, the opened exercise\'s rows, and the closed workouts with their days', async () => {
    const { container } = arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    fireEvent.click(screen.getByRole('button', { name: 'Show set targets for Incline Dumbbell Press' }))
    await screen.findByRole('group', { name: 'Rest after set 04' }, FOUND)
    captureRender('step-volume-pp3', container)

    const dump = text(container)
    // in the board's order: PLANNING, the segment, the line, the card (name, SETS), the opened exercise, the others, the closed workouts
    const inOrder = ['PLANNING', 'STABLE', 'WEEK-DEPENDENT', 'Only week 1 is planned here; later weeks copy forward.', 'Push 1', 'SETS', 'Incline Dumbbell Press', 'ALL', 'MIXED', 'REST AFTER', '01', '12', 'WARMUP', '02', '8–12', 'CHAIN', '04', '3min 0s', 'DROPSET · 1 DROP', '↳', 'Dips', 'NO SETS YET', 'Pec Deck Fly', 'Lateral Raise', 'Triceps Pushdown', 'Pull 1', 'TUE', 'Push 2', 'THU', 'Pull 2', 'FRI', 'Legs', 'SAT']
    let at = 0
    for (const word of inOrder) {
      const found = dump.indexOf(word, at)
      expect(found, `"${word}" after position ${at} in: ${dump}`).toBeGreaterThanOrEqual(at)
      at = found + word.length
    }
    expect(screen.getByRole('button', { name: "Set every set's rep target for Incline Dumbbell Press" }).textContent).toBe('MIXED')
    expect(textOf(screen.getByRole('group', { name: 'Sets for Incline Dumbbell Press' }))).toBe('−4+')
    expect(textOf(screen.getByRole('group', { name: 'Sets for Dips' }))).toBe('−0+')
    expect(textOf(screen.getByRole('group', { name: 'Sets for Pec Deck Fly' }))).toBe('−3+')
    expect(textOf(screen.getByRole('group', { name: 'Sets for Lateral Raise' }))).toBe('−4+')
    expect(textOf(screen.getByRole('group', { name: 'Sets for Triceps Pushdown' }))).toBe('−3+')
    expect(screen.getAllByRole('button', { name: /^Show editor for / }).map((b) => text(b))).toEqual(['Pull 1TUE', 'Push 2THU', 'Pull 2FRI', 'LegsSAT'])
    expect(text(screen.getByRole('button', { name: 'Rep target for set 04' }))).toBe('8–12')
    expect(text(screen.getByRole('button', { name: 'Rep target for the dropset stage' }))).toBe('—')
    // what the board does not draw on this screen: the old chips and rows
    for (const gone of ['ADD STAGE', 'STAGE KIND', 'STAGE REST', 'SET KIND', 'DELOAD']) expect(dump, gone).not.toContain(gone)
  })
})

describe('board PP3b — 3 volume, stable: the same card with every exercise closed', () => {
  it('the STABLE segment is on, the line says the sets are the volume for every week, and no exercise is opened', async () => {
    const { container } = arrange({ planningType: 'stable' })
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    captureRender('step-volume-pp3b', container)

    const dump = text(container)
    expect(screen.getByRole('button', { name: 'STABLE' }).getAttribute('aria-pressed')).toBe('true')
    expect(dump).toContain('The sets planned here are the volume for every week.')
    const inOrder = ['PLANNING', 'STABLE', 'WEEK-DEPENDENT', 'Push 1', 'SETS', 'Incline Dumbbell Press', 'Dips', 'NO SETS YET', 'Pec Deck Fly', 'Lateral Raise', 'Triceps Pushdown', 'Pull 1', 'TUE', 'Push 2', 'THU', 'Pull 2', 'FRI', 'Legs', 'SAT']
    let at = 0
    for (const word of inOrder) {
      const found = dump.indexOf(word, at)
      expect(found, `"${word}" after position ${at}`).toBeGreaterThanOrEqual(at)
      at = found + word.length
    }
    expect(screen.queryByText('REST AFTER')).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Show set targets for / })).toHaveLength(4)
  })
})

describe('board PP3c — set type, from a set number', () => {
  it('the picker over the step for set 04 of Incline Dumbbell Press: the six types, Dropset picked with DROPS and REST BETWEEN, REMOVE THIS SET', async () => {
    arrange()
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    fireEvent.click(screen.getByRole('button', { name: 'Show set targets for Incline Dumbbell Press' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Set 04 type: dropset, 1 drop' }, FOUND))
    captureRender('step-volume-pp3c', document.body)

    const sheet = screen.getByRole('dialog', { name: 'What is this set?' })
    const dump = text(sheet)
    const inOrder = ['Incline Dumbbell Press · SET 04', 'What is this set?', 'Normal', 'A straight working set.', 'Warmup', 'Lighter, not counted as volume. Usually the first sets.', 'Dropset', 'Straight into a lighter weight, no rest.', 'DROPS', '1', 'REST BETWEEN', 'NO TIMER', 'Rest-pause', 'Same weight, a few breaths, more reps.', 'Myo-reps', 'An activation set, then short mini-sets.', 'Cluster', 'The reps split by short rests inside the set.', 'REMOVE THIS SET']
    let at = 0
    for (const word of inOrder) {
      const found = dump.indexOf(word, at)
      expect(found, `"${word}" after position ${at} in: ${dump}`).toBeGreaterThanOrEqual(at)
      at = found + word.length
    }
    // a planner picker has no Cues row, no "Rest after this set" and no workout note
    for (const gone of ['Cues', 'Rest after this set', 'Changes this workout only']) expect(dump, gone).not.toContain(gone)
  })
})

describe('board PP3d — rep target, from a set', () => {
  it('the picker over the step for set 02: the segments, FROM and TO, "Use for all 4 sets of Incline Dumbbell Press" and the footer', async () => {
    arrange({ sets: world({ rep_min: 8, rep_max: 10 }) })
    await screen.findByText('Incline Dumbbell Press', {}, FOUND)
    fireEvent.click(screen.getByRole('button', { name: 'Show set targets for Incline Dumbbell Press' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rep target for set 02' }, FOUND))
    captureRender('step-volume-pp3d', document.body)

    const sheet = screen.getByRole('dialog', { name: 'Rep target' })
    const dump = text(sheet)
    const inOrder = ['Incline Dumbbell Press · SET 02', 'Rep target', 'NONE', 'NUMBER', 'RANGE', 'AMRAP', 'FROM', 'TO', 'Use for all 4 sets of Incline Dumbbell Press', 'SET 8–10 REPS']
    let at = 0
    for (const word of inOrder) {
      const found = dump.indexOf(word, at)
      expect(found, `"${word}" after position ${at} in: ${dump}`).toBeGreaterThanOrEqual(at)
      at = found + word.length
    }
  })
})

describe('long names (RULES: a name the person typed wraps, checked in Chromium at 375 px with 80 letters that have no break opportunity)', () => {
  it('an 80-letter workout name, an 80-letter exercise name and an 80-letter closed workout wrap inside their cards', async () => {
    const long = (letter: string) => letter.repeat(80)
    db = createFakeProgramSetsDb({ sets: world() })
    workoutDays = [makeDay('wd-1', long('B'), 0), makeDay('wd-2', long('C'), 1)]
    exercisesByDay = { 'wd-1': [makeExercise(INC, 'wd-1', long('A'), 0), makeExercise(DIPS, 'wd-1', 'Dips', 1)] }
    const { container } = renderStep(StepVolume, { program: makeProgram({ schedule: { monday: 'wd-1', tuesday: 'wd-2', wednesday: null, thursday: null, friday: null, saturday: null, sunday: null } }) }, { frame: true })
    fireEvent.click(await screen.findByRole('button', { name: `Show set targets for ${long('A')}` }, FOUND))
    captureRender('step-volume-long-names', container)

    expect(text(container)).toContain(long('A'))
    expect(text(container)).toContain(long('B'))
    expect(screen.getByRole('button', { name: `Show editor for ${long('C')}` })).toBeTruthy()
  })
})

describe('board PP6 — the volume states', () => {
  it('VOLUME · NO WORKOUTS YET: the card says NO WORKOUTS YET', () => {
    const { container } = arrange({ empty: true })
    captureRender('step-volume-pp6-no-workouts', container)
    expect(text(container)).toContain('NO WORKOUTS YET')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('SETS')).toBeNull()
  })

  it('VOLUME · LOADING A WORKOUT: a card with a spinner (role status, "Loading") and nothing of the workout', () => {
    loading = { days: false, exercises: true }
    const { container } = arrange()
    captureRender('step-volume-pp6-loading', container)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(text(container)).not.toContain('Incline Dumbbell Press')
    expect(text(container)).not.toContain('NO WORKOUTS YET')
  })
})
