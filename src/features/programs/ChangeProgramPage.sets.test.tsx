// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { queryClient } from '../../lib/queryClient'
import { captureRender } from '../../testing/captureRender'
import { useSettingsStore } from '../settings/settingsStore'
import type { Exercise, MuscleGroup, Mesocycle, Program } from '../../types'
import {
  NOW,
  addExerciseTo,
  applyOpsToDb,
  editSetsOf,
  inputOf,
  inserts,
  newSet,
  runCopyOf,
  scheduleRowsOf,
  sessionsOf,
  swapExerciseIn,
  weekSetOf,
  withReps,
  type World,
} from './programChange.testutil'
import { sequenceWorld, stableWorld, unevenStableWorld } from './programChange.worlds.testutil'
import { draftFromRunCopy, planProgramChange, type DraftSet, type Op, type RunChangeStatus } from './programChange'
import { kindText, newSetAfter, repTargetOf, repText, restAfterText, withRepTarget, withSetType } from './changeProgramSets'
import type { SetType } from '../../components/pickers/pickerLogic'
import type { RepTarget } from '../../lib/plannerVocabulary'
import type { ChangeProgramSource } from './changeProgramService'

// Chunk 51b: a STABLE run's CHANGE THE PROGRAM draws the default's sets as rows (board PL1b) and edits them: the set number opens the
// set type picker, the rep box the rep target picker (a stage's the stage's), ALL the picker for every set, REST AFTER steps the set's own
// rest, "+ SET" adds one, and an exercise added on a stable run is given its sets here (DECISIONS 171). The screen runs as it does in the
// app (the real hooks, the real pickers, the real `planProgramChange` and `applyOps`); what is mocked is the edge, as in the 51a test:
// the reads, the exercise library and the one request SAVE makes. Each SAVE test hands the list that request carried to chunk 45's
// stand-in for migration 043 and reads the rows that come out, so a list that reads right and runs wrong fails here.
//
// The world is chunk 45's stable run (the seed's staging-stable shape): Full Body on Tuesday and Thursday (one plan row for both) with
// Leg Press 3 x 10-12, Incline Press 2 x 8-10, and the superset Seated Cable Row + Plank; Arms on Saturday with Cable Curl (10-12 and a
// dropset 10-12 with a stage at 8-10) and Dip; weeks 1-3 planned, the run in week 2.

const h = vi.hoisted(() => ({
  meso: null as unknown as Mesocycle,
  programs: [] as Program[],
  fetchSource: vi.fn(),
  rpc: vi.fn(),
  fetchExercises: vi.fn(),
  cycle: 2,
}))

vi.mock('./useMesos', () => ({ useMesos: () => ({ data: [h.meso], isLoading: false }) }))
vi.mock('./usePrograms', () => ({ usePrograms: () => ({ data: h.programs, isLoading: false }) }))
vi.mock('./changeProgramService', () => ({ fetchChangeProgramSource: (...args: unknown[]) => h.fetchSource(...args) }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => h.rpc(...args) } }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-test' }, loading: false, signOut: vi.fn() }) }))
vi.mock('../plan/useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: h.cycle, failed: false }) }))
vi.mock('../library/exerciseService', () => ({
  fetchExercises: (...args: unknown[]) => h.fetchExercises(...args),
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  setExerciseArchived: vi.fn(),
  fetchExerciseCount: vi.fn(),
  seedDefaultExercisesIfEmpty: vi.fn(),
  fetchLostExercises: vi.fn(),
  previewExerciseDelete: vi.fn(),
  deleteExercise: vi.fn(),
  restoreExercise: vi.fn(),
}))

const { default: ChangeProgramPage } = await import('./ChangeProgramPage')

// ─── The world ───────────────────────────────────────────────────────────────────────────────────────────────────────

function ex(id: string, name: string, muscleGroup: MuscleGroup): Exercise {
  return { id, userId: 'u-test', name, muscleGroup, isArchived: false, createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null }
}

const EXERCISES: Exercise[] = [
  ex('ex-leg', 'Leg Press', 'quads'),
  ex('ex-inc', 'Incline Press', 'chest'),
  ex('ex-lat', 'Seated Cable Row', 'back'),
  ex('ex-plank', 'Plank', 'core'),
  ex('ex-curl', 'Cable Curl', 'biceps'),
  ex('ex-dip', 'Dip', 'triceps'),
  ex('ex-squat', 'Back Squat', 'quads'),
  ex('ex-hammer', 'Hammer Curl', 'biceps'),
  ex('ex-bench', 'Bench Press', 'chest'),
]

let world: World
let statuses: Record<string, RunChangeStatus>
let uuid = 0

// The clock stands at the testutil's NOW (Thursday 2026-10-15) and the run began on Monday 2026-10-05: week 2 whatever day the suite runs.
const startDate = '2026-10-05'

function sourceOf(w: World, st: Record<string, RunChangeStatus>): ChangeProgramSource {
  return {
    runCopy: runCopyOf(w.db, w.programId, w.mesocycleId),
    exercises: EXERCISES.filter((e) => w.db.v2_program_exercises.some((r) => r.exercise_id === e.id)),
    sessions: sessionsOf(w.db, w.mesocycleId, st, w.currentWeek),
    scheduleRows: scheduleRowsOf(w.db, w.mesocycleId),
  }
}

function useWorld(w: World, st: Record<string, RunChangeStatus> = { 'p2-fb': 'done' }) {
  world = w
  statuses = st
  h.meso = { id: 'meso', userId: 'u-test', name: 'Full Body', programId: 'prog', status: 'active', startDate, endDate: null, createdAt: '', sourceProgramId: 'saved' }
  const base = { userId: 'u-test', workoutDays: [], createdAt: '', updatedAt: '' }
  h.programs = [
    { ...base, id: 'prog', name: 'Full Body (run)', schedule: w.db.v2_programs[0].schedule as Program['schedule'], kind: 'run', planningType: w.planningType, scheduleType: w.scheduleType },
    { ...base, id: 'saved', name: 'Full Body', schedule: {} as Program['schedule'], kind: 'saved', planningType: w.planningType, scheduleType: w.scheduleType },
  ]
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false } })
  uuid = 0
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `id-${++uuid}` as ReturnType<typeof crypto.randomUUID>)
  h.cycle = 2
  h.fetchSource.mockReset().mockImplementation(async () => sourceOf(world, statuses))
  h.rpc.mockReset().mockImplementation(async (_fn: string, args: { p_ops: Op[] }) => {
    world = { ...world, db: applyOpsToDb(world.db, args.p_ops) }
    return { data: args.p_ops.length, error: null }
  })
  h.fetchExercises.mockReset().mockImplementation(async () => [...EXERCISES])
  useSettingsStore.setState({ weightUnit: 'kg' })
  useWorld(stableWorld())
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ─── Driving it ──────────────────────────────────────────────────────────────────────────────────────────────────────

function mount(entries: string[] = ['/plan', '/plan/change']) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route path="/plan" element={<div>AT PLAN</div>} />
          <Route path="/plan/change" element={<ChangeProgramPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function open(entries?: string[]) {
  const view = mount(entries)
  await screen.findByRole('heading', { name: 'CHANGE THE PROGRAM' })
  return view
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const dialog = (name: string | RegExp) => screen.getByRole('dialog', { name })
const closeDialog = (name: string | RegExp) => fireEvent.click(within(dialog(name)).getByRole('button', { name: 'Close' }))
const press = (name: string | RegExp, times = 1) => {
  for (let i = 0; i < times; i++) click(name)
}

async function save() {
  click('SAVE CHANGES')
  await waitFor(() => expect(h.rpc).toHaveBeenCalled())
}

function sent(): Op[] {
  expect(h.rpc).toHaveBeenCalledTimes(1)
  const [fn, args] = h.rpc.mock.calls[0] as [string, { p_ops: Op[] }]
  expect(fn).toBe('v2_apply_ops')
  return args.p_ops
}

// The list `planProgramChange` makes for an edit written by hand on chunk 45's draft, from the same world, statuses and ids the screen draws.
function expectedFor(before: World, edit: (e: ReturnType<typeof draftFromRunCopy>) => ReturnType<typeof draftFromRunCopy>, statusesNow = statuses): Op[] {
  let n = 0
  const input = inputOf(before, edit(draftFromRunCopy(runCopyOf(before.db, before.programId, before.mesocycleId), before.planningType)), {
    statuses: statusesNow,
    newId: () => `id-${++n}`,
  })
  return planProgramChange(input).ops
}

// The rep target picker, driven the way a user does: a segment, the boxes, whether "Use for all" stays ticked, the footer button.
function pickReps(
  title: string | RegExp,
  how: { segment?: 'NONE' | 'NUMBER' | 'RANGE' | 'AMRAP'; number?: string; from?: string; to?: string; useForAll?: boolean },
  footer: string | RegExp,
) {
  const sheet = dialog(title)
  if (how.segment) fireEvent.click(within(sheet).getByRole('button', { name: how.segment }))
  if (how.number !== undefined) fireEvent.change(within(sheet).getByLabelText('REPS'), { target: { value: how.number } })
  if (how.from !== undefined) fireEvent.change(within(sheet).getByLabelText('From'), { target: { value: how.from } })
  if (how.to !== undefined) fireEvent.change(within(sheet).getByLabelText('To'), { target: { value: how.to } })
  if (how.useForAll !== undefined) {
    const box = within(sheet).getByRole('checkbox')
    if ((box.getAttribute('aria-checked') === 'true') !== how.useForAll) fireEvent.click(box)
  }
  fireEvent.click(within(sheet).getByRole('button', { name: footer }))
}

const setRow = (name: string) => screen.getByRole('button', { name })

// ─── The rows ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('a stable run draws the default’s sets as rows (board PL1b)', () => {
  it('each exercise: an ALL row with REST AFTER over its column, a row per set (number, rep target, REST AFTER), and "+ SET"', async () => {
    await open()
    // Leg Press x3 at 10-12, Incline Press x2 at 8-10: the numbers 01.., the targets, CHAIN until a set has a rest of its own
    expect(screen.getByRole('button', { name: 'All sets of Leg Press: rep target' }).textContent).toBe('10–12')
    expect(screen.getAllByText('REST AFTER').length).toBeGreaterThanOrEqual(4)
    for (const n of ['01', '02', '03']) {
      expect(setRow(`Set ${n} of Leg Press: type`).textContent).toBe(n)
      expect(setRow(`Set ${n} of Leg Press: rep target`).textContent).toBe('10–12')
    }
    expect(screen.getByRole('group', { name: 'Rest after set 01 of Leg Press' }).textContent).toContain('CHAIN')
    expect(screen.queryByRole('button', { name: 'Set 04 of Leg Press: type' })).toBeNull()
    expect(screen.getAllByText('+ SET')).toHaveLength(4)
  })

  it('a superset’s rows are labelled by the member: A1, A2, B1, B2', async () => {
    await open()
    expect(setRow('Set A1 of Seated Cable Row: type').textContent).toBe('A1')
    expect(setRow('Set A2 of Seated Cable Row: type').textContent).toBe('A2')
    expect(setRow('Set B1 of Plank: type').textContent).toBe('B1')
    expect(setRow('Set B2 of Plank: rep target').textContent).toBe('AMRAP')
  })

  it('a staged set says its kind and how many stages, and its stages are rows under it with a rep box of their own', async () => {
    await open()
    click(/^Arms/)
    expect(setRow('Set 02 of Cable Curl: rep target').textContent).toBe('10–12DROPSET · 1')
    expect(setRow('Stage 1 of set 02 of Cable Curl: rep target').textContent).toBe('8–10')
    expect(screen.queryByRole('button', { name: 'Stage 1 of set 01 of Cable Curl: rep target' })).toBeNull()
  })

  it('a week-dependent run draws none of it (it holds no sets)', async () => {
    const { weekDependentWorld } = await import('./programChange.worlds.testutil')
    useWorld(weekDependentWorld(), {})
    await open()
    expect(screen.queryByText('+ SET')).toBeNull()
    expect(screen.queryByText('REST AFTER')).toBeNull()
  })

  it('a stable SEQUENCE run draws the rows too, and no DAYS card', async () => {
    useWorld(sequenceWorld(), {})
    await open()
    expect(screen.getAllByText('+ SET').length).toBe(2)
    expect(screen.queryByText(/DAYS$/)).toBeNull()
  })
})

// ─── "Changed in this edit" ──────────────────────────────────────────────────────────────────────────────────────────

const outlined = (name: string) => (screen.getByRole('button', { name }).getAttribute('style') ?? '').includes('border-color: var(--accent)')

describe('a set changed in this edit has the accent outline (board PL1b)', () => {
  it('only the set that changed: its rep target, its type, its rest after; and it goes when the change is put back', async () => {
    await open()
    expect(outlined('Set 01 of Leg Press: rep target')).toBe(false)
    click('Set 02 of Leg Press: rep target')
    pickReps('Rep target', { segment: 'NUMBER', number: '8', useForAll: false }, 'SET 8 REPS')
    expect(outlined('Set 02 of Leg Press: rep target')).toBe(true)
    expect(outlined('Set 01 of Leg Press: rep target')).toBe(false)
    expect(outlined('Set 03 of Leg Press: rep target')).toBe(false)
    click('Set 02 of Leg Press: rep target')
    pickReps('Rep target', { segment: 'RANGE', from: '10', to: '12', useForAll: false }, 'SET 10–12 REPS')
    expect(outlined('Set 02 of Leg Press: rep target')).toBe(false)
    press('More rest after set 03 of Leg Press')
    expect(outlined('Set 03 of Leg Press: rep target')).toBe(true)
    press('Less rest after set 03 of Leg Press')
    expect(outlined('Set 03 of Leg Press: rep target')).toBe(false)
    click('Set 01 of Leg Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Dropset/ }))
    closeDialog('What is this set?')
    expect(outlined('Set 01 of Leg Press: rep target')).toBe(true)
    // its new stage is a new row: outlined too
    expect(outlined('Stage 1 of set 01 of Leg Press: rep target')).toBe(true)
  })

  it('a stage row is outlined for its own target, and the set above it is not', async () => {
    await open()
    click(/^Arms/)
    expect(outlined('Stage 1 of set 02 of Cable Curl: rep target')).toBe(false)
    click('Stage 1 of set 02 of Cable Curl: rep target')
    pickReps('Rep target', { segment: 'AMRAP' }, 'SET AMRAP')
    expect(outlined('Stage 1 of set 02 of Cable Curl: rep target')).toBe(true)
    expect(outlined('Set 02 of Cable Curl: rep target')).toBe(false)
  })

  it('a new exercise’s rows are not outlined one by one: its card carries the mark', async () => {
    await open()
    click('+ ADD EXERCISE')
    const sheet = await screen.findByRole('dialog', { name: 'Add exercise' })
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Add Dip' }))
    press('Add a set to Dip')
    expect(outlined('Set 01 of Dip: rep target')).toBe(false)
    // the card carries the mark on all four sides, each its own longhand: jsdom drops a `border-color` shorthand that a side colour
    // follows, so a captured fixture kept the top edge and lost the other three (RULES.md, jsdom drops some inline declarations)
    const style = screen.getByText('TRICEPS · NEW').closest('[data-exercise-key]')?.getAttribute('style') ?? ''
    for (const side of ['top', 'right', 'bottom', 'left']) expect(style).toContain(`border-${side}-color: var(--accent)`)
    expect(style).toContain('background: var(--accent-muted)')
  })
})

// ─── Rep targets ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('a set’s rep target (W)', () => {
  it('opens on the set’s own target: its segment and its numbers', async () => {
    await open()
    click('Set 02 of Leg Press: rep target')
    const sheet = dialog('Rep target')
    expect(within(sheet).getByRole('button', { name: 'RANGE' }).getAttribute('aria-pressed')).toBe('true')
    expect((within(sheet).getByLabelText('From') as HTMLInputElement).value).toBe('10')
    expect((within(sheet).getByLabelText('To') as HTMLInputElement).value).toBe('12')
    expect(within(sheet).getByText('Leg Press · SET 02')).toBeTruthy()
    closeDialog('Rep target')
    click('Set B2 of Plank: rep target')
    expect(within(dialog('Rep target')).getByRole('button', { name: 'AMRAP' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('set 2 to 10–12 for that set alone lands on the default and on the sessions that still match it, and leaves a THIS WEEK ONLY set (W)', async () => {
    useWorld(stableWorld(), {})
    const thisWeekOnly = weekSetOf(world, 'p3-fb', 'pe-inc-s2')
    thisWeekOnly.rep_min = 6
    thisWeekOnly.rep_max = 8
    await open()
    const before = world
    click('Set 02 of Incline Press: rep target')
    pickReps('Rep target', { segment: 'RANGE', from: '10', to: '12', useForAll: false }, 'SET 10–12 REPS')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setRow('Set 02 of Incline Press: rep target').textContent).toBe('10–12')
    await save()

    const ops = sent()
    expect(ops).toEqual(expectedFor(before, (e) => editSetsOf(e, 'fb', 'pe-inc', (sets) => sets.map((x, i) => (i === 1 ? withReps(x, '10-12') : x)))))
    const db = world.db
    expect(db.v2_program_sets.find((r) => r.id === 'pe-inc-s2')).toMatchObject({ rep_min: 10, rep_max: 12 })
    expect(db.v2_program_sets.find((r) => r.id === 'pe-inc-s1')).toMatchObject({ rep_min: 8, rep_max: 10 })
    expect(weekSetOf(world, 'p2-fb', 'pe-inc-s2')).toMatchObject({ rep_min: 10, rep_max: 12 })
    expect(weekSetOf(world, 'p2-fb', 'pe-inc-s1')).toMatchObject({ rep_min: 8, rep_max: 10 })
    // week 3's set was changed for that week only: left exactly as it is
    expect(weekSetOf(world, 'p3-fb', 'pe-inc-s2')).toMatchObject({ rep_min: 6, rep_max: 8 })
    // weights, RIR and cues on the sets that stay are kept
    expect(weekSetOf(world, 'p2-fb', 'pe-inc-s2')).toMatchObject({ target_weight: 60, target_rir: 2, tags: ['push here'] })
  })

  it('a session that is done or in progress is not written', async () => {
    useWorld(stableWorld(), { 'p2-fb': 'in_progress' })
    await open()
    click('Set 02 of Incline Press: rep target')
    pickReps('Rep target', { segment: 'RANGE', from: '10', to: '12', useForAll: false }, 'SET 10–12 REPS')
    await save()
    const touched = sent().filter((o) => o.table === 'v2_week_plan_sets').map((o) => ('id' in o ? o.id : ''))
    expect(touched).toEqual(['p3-fb-pe-inc-s2'])
    expect(weekSetOf(world, 'p2-fb', 'pe-inc-s2')).toMatchObject({ rep_min: 8, rep_max: 10 })
  })

  it('"Use for all" starts ticked: the target goes to every set of the exercise', async () => {
    await open()
    const before = world
    click('Set 02 of Leg Press: rep target')
    expect(within(dialog('Rep target')).getByRole('checkbox', { name: 'Use for all 3 sets of Leg Press' }).getAttribute('aria-checked')).toBe('true')
    pickReps('Rep target', { segment: 'NUMBER', number: '8' }, 'SET 8 REPS')
    expect(['01', '02', '03'].map((n) => setRow(`Set ${n} of Leg Press: rep target`).textContent)).toEqual(['8', '8', '8'])
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => editSetsOf(e, 'fb', 'pe-leg', (sets) => sets.map((x) => withReps(x, '8')))))
    expect(world.db.v2_program_sets.filter((r) => r.program_exercise_id === 'pe-leg').map((r) => r.rep_min)).toEqual([8, 8, 8])
  })

  it('ALL sets every set, with no "Use for all" to untick; it reads MIXED when the sets differ', async () => {
    await open()
    const before = world
    click('Set 02 of Leg Press: rep target')
    pickReps('Rep target', { segment: 'NUMBER', number: '5', useForAll: false }, 'SET 5 REPS')
    expect(screen.getByRole('button', { name: 'All sets of Leg Press: rep target' }).textContent).toBe('MIXED')
    click('All sets of Leg Press: rep target')
    // it opens on none (the sets differ): no number until a segment is picked, and no "Use for all" row
    const sheet = dialog('Rep target')
    expect(within(sheet).getByRole('button', { name: 'NONE' }).getAttribute('aria-pressed')).toBe('true')
    // the picker has no eyebrow for "all sets": it says set 1's (provisional, D31)
    expect(within(sheet).getByText('Leg Press · SET 01')).toBeTruthy()
    expect(within(sheet).queryByRole('checkbox')).toBeNull()
    pickReps('Rep target', { segment: 'RANGE', from: '6', to: '8' }, 'SET 6–8 REPS')
    expect(screen.getByRole('button', { name: 'All sets of Leg Press: rep target' }).textContent).toBe('6–8')
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => editSetsOf(e, 'fb', 'pe-leg', (sets) => sets.map((x) => withReps(x, '6-8')))))
  })

  it('ALL opens on the target every set has', async () => {
    await open()
    click('All sets of Leg Press: rep target')
    const sheet = dialog('Rep target')
    expect(within(sheet).getByRole('button', { name: 'RANGE' }).getAttribute('aria-pressed')).toBe('true')
    expect((within(sheet).getByLabelText('From') as HTMLInputElement).value).toBe('10')
  })

  it('the rep box on a stage row opens the picker for the stage, with the stage’s own target, and no "Use for all"', async () => {
    useWorld(stableWorld(), {})
    await open()
    const before = world
    click(/^Arms/)
    click('Stage 1 of set 02 of Cable Curl: rep target')
    const sheet = dialog('Rep target')
    expect(within(sheet).getByText('Cable Curl · SET 02')).toBeTruthy()
    expect((within(sheet).getByLabelText('From') as HTMLInputElement).value).toBe('8')
    expect(within(sheet).queryByRole('checkbox')).toBeNull()
    pickReps('Rep target', { segment: 'AMRAP' }, 'SET AMRAP')
    expect(setRow('Stage 1 of set 02 of Cable Curl: rep target').textContent).toBe('AMRAP')
    // the head keeps its own target
    expect(setRow('Set 02 of Cable Curl: rep target').textContent).toBe('10–12DROPSET · 1')
    await save()
    expect(sent()).toEqual(
      expectedFor(before, (e) =>
        editSetsOf(e, 'arms', 'pe-curl', (sets) => sets.map((x, i) => (i === 1 ? { ...x, stages: x.stages.map((st) => ({ ...st, repMin: null, repMax: null, isAmrap: true })) } : x))),
      ),
    )
    expect(world.db.v2_program_sets.find((r) => r.id === 'pe-curl-s2-t1')).toMatchObject({ is_amrap: true, rep_min: null })
    expect(weekSetOf(world, 'p2-arms', 'pe-curl-s2-t1')).toMatchObject({ is_amrap: true })
    expect(weekSetOf(world, 'p3-arms', 'pe-curl-s2-t1')).toMatchObject({ is_amrap: true })
  })

  it('of two stages the rep box of the second opens the second’s picker and writes the second only', async () => {
    useWorld(stableWorld(), {})
    await open()
    click(/^Arms/)
    // Cable Curl's set 02 is a dropset with one stage at 8–10: one more drop is a second stage with no target of its own
    click('Set 02 of Cable Curl: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: 'More drops' }))
    closeDialog('What is this set?')
    expect(setRow('Set 02 of Cable Curl: rep target').textContent).toBe('10–12DROPSET · 2')
    expect(setRow('Stage 1 of set 02 of Cable Curl: rep target').textContent).toBe('8–10')
    expect(setRow('Stage 2 of set 02 of Cable Curl: rep target').textContent).toBe('—')
    click('Stage 2 of set 02 of Cable Curl: rep target')
    // it opens on the second stage's own target (none), not the first one's
    expect(within(dialog('Rep target')).getByRole('button', { name: 'NONE' }).getAttribute('aria-pressed')).toBe('true')
    pickReps('Rep target', { segment: 'NUMBER', number: '5' }, 'SET 5 REPS')
    expect(setRow('Stage 1 of set 02 of Cable Curl: rep target').textContent).toBe('8–10')
    expect(setRow('Stage 2 of set 02 of Cable Curl: rep target').textContent).toBe('5')
    expect(setRow('Set 02 of Cable Curl: rep target').textContent).toBe('10–12DROPSET · 2')
    await save()
    const stages = world.db.v2_program_sets.filter((r) => r.parent_program_set_id === 'pe-curl-s2').sort((a, b) => a.stage_index - b.stage_index)
    expect(stages.map((r) => [r.stage_index, r.rep_min, r.rep_max])).toEqual([
      [1, 8, 10],
      [2, 5, 5],
    ])
  })
})

// ─── The set type ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the set type picker, opened from a set’s number (W)', () => {
  it('is the picker of this screen: REMOVE THIS SET and, under a staged kind, REST BETWEEN; no rest-after row and no Cues', async () => {
    await open()
    click('Set 02 of Leg Press: type')
    let sheet = dialog('What is this set?')
    expect(within(sheet).getByText('Leg Press · SET 02')).toBeTruthy()
    expect(within(sheet).getByText('REMOVE THIS SET')).toBeTruthy()
    expect(within(sheet).queryByText('REST BETWEEN')).toBeNull()
    expect(within(sheet).queryByText('Rest after this set')).toBeNull()
    expect(within(sheet).queryByText('Cues')).toBeNull()
    // a Normal set is the one picked
    expect(within(sheet).getByRole('button', { name: /^Normal/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(sheet).getByRole('button', { name: /^Dropset/ }))
    sheet = dialog('What is this set?')
    expect(within(sheet).getByText('DROPS')).toBeTruthy()
    expect(within(sheet).getByText('REST BETWEEN')).toBeTruthy()
    expect(within(sheet).queryByText('Rest after this set')).toBeNull()
    expect(within(sheet).queryByText('Cues')).toBeNull()
  })

  it('opens on the set’s own type: a staged set with its kind and how many stages', async () => {
    await open()
    click(/^Arms/)
    click('Set 02 of Cable Curl: type')
    const sheet = dialog('What is this set?')
    expect(within(sheet).getByRole('button', { name: /^Dropset/ }).getAttribute('aria-pressed')).toBe('true')
    expect(within(sheet).getByText('DROPS')).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'More drops' })).toBeTruthy()
  })

  it('Normal to Dropset, with 2 drops and a rest between them: the default’s set, its stage rows, and the sessions that still match (W)', async () => {
    useWorld(stableWorld(), {})
    await open()
    const before = world
    click('Set 02 of Incline Press: type')
    const sheet = dialog('What is this set?')
    fireEvent.click(within(sheet).getByRole('button', { name: /^Dropset/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'More drops' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Rest between: more' }))
    closeDialog('What is this set?')
    expect(setRow('Set 02 of Incline Press: rep target').textContent).toBe('8–10DROPSET · 2')
    expect(setRow('Stage 1 of set 02 of Incline Press: rep target').textContent).toBe('—')
    expect(setRow('Stage 2 of set 02 of Incline Press: rep target').textContent).toBe('—')
    await save()

    expect(sent()).toEqual(
      expectedFor(before, (e) =>
        editSetsOf(e, 'fb', 'pe-inc', (sets) =>
          sets.map((x, i) =>
            i === 1
              ? { ...x, stageKind: 'dropset' as const, stageRestSeconds: 15, stages: [{ id: null, repMin: null, repMax: null, isAmrap: false }, { id: null, repMin: null, repMax: null, isAmrap: false }] }
              : x,
          ),
        ),
      ),
    )
    const db = world.db
    expect(db.v2_program_sets.find((r) => r.id === 'pe-inc-s2')).toMatchObject({ stage_kind: 'dropset', stage_rest_seconds: 15 })
    expect(db.v2_program_sets.filter((r) => r.parent_program_set_id === 'pe-inc-s2').map((r) => r.stage_index)).toEqual([1, 2])
    for (const plan of ['p2-fb', 'p3-fb']) {
      const head = weekSetOf(world, plan, 'pe-inc-s2')
      expect(head).toMatchObject({ stage_kind: 'dropset', target_weight: 60 })
      expect(db.v2_week_plan_sets.filter((r) => r.parent_week_plan_set_id === head.id).map((r) => [r.stage_index, r.is_dropset])).toEqual([[1, true], [2, true]])
    }
  })

  it('Dropset back to Normal removes its stage rows from the default (soft) and from the sessions that still match it', async () => {
    useWorld(stableWorld(), {})
    await open()
    click(/^Arms/)
    click('Set 02 of Cable Curl: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Normal/ }))
    closeDialog('What is this set?')
    expect(screen.queryByRole('button', { name: 'Stage 1 of set 02 of Cable Curl: rep target' })).toBeNull()
    await save()
    const db = world.db
    expect(db.v2_program_sets.find((r) => r.id === 'pe-curl-s2-t1')!.removed_at).not.toBeNull()
    expect(db.v2_program_sets.find((r) => r.id === 'pe-curl-s2')).toMatchObject({ stage_kind: null })
    for (const plan of ['p2-arms', 'p3-arms']) expect(db.v2_week_plan_sets.some((r) => r.week_plan_id === plan && r.parent_week_plan_set_id !== null)).toBe(false)
  })

  it('Warmup: the row says W and WARMUP, the later working sets are numbered from 01, and the flag reaches the sessions', async () => {
    useWorld(stableWorld(), {})
    await open()
    const before = world
    click('Set 01 of Leg Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Warmup/ }))
    closeDialog('What is this set?')
    expect(setRow('Set W of Leg Press: type').textContent).toBe('W')
    expect(setRow('Set W of Leg Press: rep target').textContent).toBe('10–12WARMUP')
    expect(setRow('Set 01 of Leg Press: type').textContent).toBe('01')
    expect(setRow('Set 02 of Leg Press: type').textContent).toBe('02')
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => editSetsOf(e, 'fb', 'pe-leg', (sets) => sets.map((x, i) => (i === 0 ? { ...x, isWarmup: true } : x)))))
    expect(weekSetOf(world, 'p3-fb', 'pe-leg-s1').is_warmup).toBe(true)
  })

  it('the eyebrow of both pickers numbers the working sets apart from the warmups, as the rows do', async () => {
    await open()
    click('Set 01 of Leg Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Warmup/ }))
    closeDialog('What is this set?')
    // the rows are W, 01, 02 now: the second row of the list is the first working set
    click('Set 01 of Leg Press: type')
    expect(within(dialog('What is this set?')).getByText('Leg Press · SET 01')).toBeTruthy()
    closeDialog('What is this set?')
    click('Set 01 of Leg Press: rep target')
    expect(within(dialog('Rep target')).getByText('Leg Press · SET 01')).toBeTruthy()
    closeDialog('Rep target')
    click('Set 02 of Leg Press: type')
    expect(within(dialog('What is this set?')).getByText('Leg Press · SET 02')).toBeTruthy()
  })

  it('a pick of a set that is removed meanwhile draws nothing (REMOVE THIS SET closes the sheet)', async () => {
    await open()
    click('Set 03 of Leg Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByText('REMOVE THIS SET'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Set 03 of Leg Press: type' })).toBeNull()
  })
})

// ─── REST AFTER, "+ SET", REMOVE THIS SET ──────────────────────────────────────────────────────────────────────────────

describe('REST AFTER, "+ SET" and REMOVE THIS SET (W)', () => {
  it('REST AFTER steps a quarter-minute at a time from CHAIN, back to CHAIN, and is one value on the default’s set for every session', async () => {
    await open()
    const before = world
    const more = 'More rest after set 02 of Leg Press'
    const less = 'Less rest after set 02 of Leg Press'
    expect((setRow(less) as HTMLButtonElement).disabled).toBe(true)
    press(more)
    expect(screen.getByRole('group', { name: 'Rest after set 02 of Leg Press' }).textContent).toContain('0:15')
    press(more, 7)
    expect(screen.getByRole('group', { name: 'Rest after set 02 of Leg Press' }).textContent).toContain('2:00')
    press(less)
    press(less, 7)
    expect(screen.getByRole('group', { name: 'Rest after set 02 of Leg Press' }).textContent).toContain('CHAIN')
    press(more, 8)
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => editSetsOf(e, 'fb', 'pe-leg', (sets) => sets.map((x, i) => (i === 1 ? { ...x, restSeconds: 120 } : x)))))
    // run-wide: only the default's row; no session row is written
    expect(sent().map((o) => o.table)).toEqual(['v2_program_sets'])
    expect(world.db.v2_program_sets.find((r) => r.id === 'pe-leg-s2')!.rest_seconds).toBe(120)
  })

  it('REST AFTER stops at 10:00', async () => {
    await open()
    press('More rest after set 01 of Incline Press', 40)
    expect(screen.getByRole('group', { name: 'Rest after set 01 of Incline Press' }).textContent).toContain('10:00')
    expect((setRow('More rest after set 01 of Incline Press') as HTMLButtonElement).disabled).toBe(true)
  })

  it('"+ SET" adds a set with the last set’s rep target; SAVE writes it to the default and to each session that still has the default’s count (W)', async () => {
    await open()
    const before = world
    press('Add a set to Incline Press')
    expect(setRow('Set 03 of Incline Press: rep target').textContent).toBe('8–10')
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => editSetsOf(e, 'fb', 'pe-inc', (sets) => [...sets, newSet('8-10')])))
    const added = world.db.v2_program_sets.filter((r) => r.program_exercise_id === 'pe-inc' && r.parent_program_set_id === null)
    expect(added).toHaveLength(3)
    expect(world.db.v2_week_plan_sets.filter((r) => r.week_plan_id === 'p3-fb' && r.program_exercise_id === 'pe-inc' && r.parent_week_plan_set_id === null)).toHaveLength(3)
    // week 2's Full Body is done: it keeps its two
    expect(world.db.v2_week_plan_sets.filter((r) => r.week_plan_id === 'p2-fb' && r.program_exercise_id === 'pe-inc')).toHaveLength(2)
  })

  it('REMOVE THIS SET: the set leaves the default (soft) and each session that still matches', async () => {
    await open()
    const before = world
    click('Set 03 of Leg Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByText('REMOVE THIS SET'))
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => editSetsOf(e, 'fb', 'pe-leg', (sets) => sets.slice(0, 2))))
    expect(world.db.v2_program_sets.find((r) => r.id === 'pe-leg-s3')!.removed_at).not.toBeNull()
    expect(world.db.v2_week_plan_sets.some((r) => r.week_plan_id === 'p3-fb' && r.program_set_id === 'pe-leg-s3')).toBe(false)
    expect(world.db.v2_week_plan_sets.some((r) => r.week_plan_id === 'p2-fb' && r.program_set_id === 'pe-leg-s3')).toBe(true)
  })

  it('a set added and removed again is no change: CANCEL goes straight back and SAVE sends nothing', async () => {
    await open()
    press('Add a set to Incline Press')
    click('Set 03 of Incline Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByText('REMOVE THIS SET'))
    click('SAVE CHANGES')
    await waitFor(() => expect(screen.getByText('AT PLAN')).toBeTruthy())
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

// ─── An exercise added on a stable run ───────────────────────────────────────────────────────────────────────────────────

describe('an exercise added on a stable run gets set rows like any other (DECISIONS 171) (W)', () => {
  async function addDip() {
    click('+ ADD EXERCISE')
    const sheet = await screen.findByRole('dialog', { name: 'Add exercise' })
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Add Dip' }))
  }

  it('its card starts with none and says so; "+ SET" builds its default; the second set made a range', async () => {
    await open()
    await addDip()
    expect(screen.getByText('TRICEPS · NEW')).toBeTruthy()
    expect(screen.getByText('NO SETS YET')).toBeTruthy()
    // a stable run's new exercise carries none of the week-dependent note, and no ALL row until it has a set to be ALL of
    expect(screen.queryByText(/It lands in week/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'All sets of Dip: rep target' })).toBeNull()
    press('Add a set to Dip')
    expect(screen.queryByText('NO SETS YET')).toBeNull()
    expect(setRow('Set 01 of Dip: rep target').textContent).toBe('—')
    press('Add a set to Dip')
    click('Set 02 of Dip: rep target')
    pickReps('Rep target', { segment: 'RANGE', from: '10', to: '12', useForAll: false }, 'SET 10–12 REPS')
    expect(setRow('Set 01 of Dip: rep target').textContent).toBe('—')
    expect(setRow('Set 02 of Dip: rep target').textContent).toBe('10–12')
  })

  it('SAVE sends its program-set rows and, in each session of the workout that has not started, its set rows; none in a session in progress (W)', async () => {
    useWorld(stableWorld(), { 'p2-fb': 'in_progress' })
    await open()
    const before = world
    await addDip()
    press('Add a set to Dip', 2)
    click('Set 02 of Dip: rep target')
    pickReps('Rep target', { segment: 'RANGE', from: '10', to: '12', useForAll: false }, 'SET 10–12 REPS')
    await save()

    const ops = sent()
    expect(ops).toEqual(
      expectedFor(before, (e) => addExerciseTo(e, 'fb', { exerciseId: 'ex-dip', weightUnit: 'kg', sets: [newSet(''), newSet('10-12')] })),
    )
    const exercise = inserts(ops, 'v2_program_exercises')[0].row
    const program = inserts(ops, 'v2_program_sets').map((o) => o.row)
    expect(program.map((r) => [r.program_exercise_id, r.position, r.rep_min, r.rep_max])).toEqual([
      [exercise.id, 1, null, null],
      [exercise.id, 2, 10, 12],
    ])
    const db = world.db
    const rowsIn = (plan: string) => db.v2_week_plan_sets.filter((r) => r.week_plan_id === plan && r.program_exercise_id === exercise.id)
    expect(rowsIn('p3-fb').map((r) => [r.set_number, r.program_set_id, r.rep_min, r.rep_max, r.target_weight])).toEqual([
      [1, program[0].id, null, null, null],
      [2, program[1].id, 10, 12, null],
    ])
    // week 2's Full Body is in progress: it is left exactly as it is, the new exercise included
    expect(rowsIn('p2-fb')).toEqual([])
    expect(db.v2_week_plan_exercises.some((r) => r.week_plan_id === 'p2-fb' && r.program_exercise_id === exercise.id)).toBe(false)
    expect(db.v2_week_plan_exercises.some((r) => r.week_plan_id === 'p3-fb' && r.program_exercise_id === exercise.id)).toBe(true)
    // the other workout is not touched
    expect(db.v2_week_plan_exercises.filter((r) => r.week_plan_id === 'p3-arms')).toHaveLength(2)
  })

  it('with the sessions of both weeks not started, both get the sets', async () => {
    useWorld(stableWorld(), {})
    await open()
    await addDip()
    press('Add a set to Dip', 2)
    await save()
    const exercise = inserts(sent(), 'v2_program_exercises')[0].row
    for (const plan of ['p2-fb', 'p3-fb']) {
      expect(world.db.v2_week_plan_sets.filter((r) => r.week_plan_id === plan && r.program_exercise_id === exercise.id)).toHaveLength(2)
    }
    // and it is last in each
    for (const plan of ['p2-fb', 'p3-fb']) {
      const last = world.db.v2_week_plan_exercises.filter((r) => r.week_plan_id === plan).sort((a, b) => a.position - b.position).pop()!
      expect(last.program_exercise_id).toBe(exercise.id)
    }
  })

  it('an exercise added and given no set lands with none: the row is the exercise alone', async () => {
    useWorld(stableWorld(), {})
    await open()
    await addDip()
    await save()
    expect(inserts(sent(), 'v2_program_sets')).toEqual([])
    expect(inserts(sent(), 'v2_week_plan_sets')).toEqual([])
  })
})

describe('a swapped exercise on a stable run', () => {
  it('shows the old exercise’s sets (count, kinds, stages, rep targets) and edits them; the new default is fresh rows, the sessions keep their numbers cleared', async () => {
    useWorld(stableWorld(), {})
    await open()
    const before = world
    click(/^Arms/)
    click('Swap Cable Curl')
    const sheet = await screen.findByRole('dialog', { name: 'Swap Cable Curl' })
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Swap to Hammer Curl' }))
    expect(screen.getByText('BICEPS · SWAPPED')).toBeTruthy()
    expect(setRow('Set 02 of Hammer Curl: rep target').textContent).toBe('10–12DROPSET · 1')
    expect(setRow('Stage 1 of set 02 of Hammer Curl: rep target').textContent).toBe('8–10')
    click('Set 01 of Hammer Curl: rep target')
    pickReps('Rep target', { segment: 'NUMBER', number: '6', useForAll: false }, 'SET 6 REPS')
    await save()
    expect(sent()).toEqual(
      expectedFor(before, (e) => swapExerciseIn(e, 'arms', 'pe-curl', 'ex-hammer', { sets: draftSetsWith(before, 'pe-curl', (x, i) => (i === 0 ? withReps(x, '6') : x)) })),
    )
    // the swapped-in exercise's default has the old one's sets, the first at 6; the session's sets point at them and carry no weight
    const row = world.db.v2_program_exercises.find((r) => r.replaces_program_exercise_id === 'pe-curl')!
    const defaults = world.db.v2_program_sets.filter((r) => r.program_exercise_id === row.id && r.parent_program_set_id === null).sort((a, b) => a.position - b.position)
    expect(defaults.map((r) => [r.rep_min, r.rep_max])).toEqual([[6, 6], [10, 12]])
    const sessionSets = world.db.v2_week_plan_sets.filter((r) => r.week_plan_id === 'p3-arms' && r.program_exercise_id === row.id)
    expect(sessionSets.every((r) => r.target_weight === null && r.target_rir === null)).toBe(true)
  })
})

describe('SAVE reads the run copy again first (a stable run’s default sets are part of what it compares)', () => {
  it('a default set changed elsewhere since the screen opened is never written back over: the save refuses and sends nothing', async () => {
    await open()
    press('Add a set to Leg Press')
    // another device gave Incline Press's first set a new rep target in the meantime
    world = { ...world, db: { ...world.db, v2_program_sets: world.db.v2_program_sets.map((r) => (r.id === 'pe-inc-s1' ? { ...r, rep_min: 12, rep_max: 12 } : r)) } }
    click('SAVE CHANGES')
    await screen.findByText("Couldn't save the changes.")
    expect(screen.getByText('The program changed since you opened this screen. Go back and open it again to see it.')).toBeTruthy()
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

function draftSetsWith(w: World, rowId: string, fn: (s: DraftSet, i: number) => DraftSet): DraftSet[] {
  const d = draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)
  const sets = d.workouts.flatMap((x) => x.exercises).find((e) => e.kind === 'kept' && e.id === rowId)!.sets!
  return sets.map(fn)
}

// ─── The route's #<exerciseId> (chunk 54b's "CHANGE EVERY WEEK →") ────────────────────────────────────────────────────────

describe('/plan/change#<exerciseId> scrolls to that exercise’s card', () => {
  it('selects the workout it is in and scrolls its card into view', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    await open(['/plan', '/plan/change#ex-curl'])
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
    const card = scroll.mock.contexts[0] as HTMLElement
    expect(card.getAttribute('data-exercise-key')).toBe('e:pe-curl')
    expect(card.textContent).toContain('Cable Curl')
    // Arms was selected for it
    expect(screen.getByRole('button', { name: /^Arms/ }).getAttribute('aria-current')).toBe('true')
  })

  it('an exercise of the first workout scrolls there too, and an id no card has scrolls nowhere', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    await open(['/plan', '/plan/change#ex-inc'])
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
    expect((scroll.mock.contexts[0] as HTMLElement).getAttribute('data-exercise-key')).toBe('e:pe-inc')
    cleanup()
    scroll.mockClear()
    await open(['/plan', '/plan/change#nothing-here'])
    await new Promise((r) => setTimeout(r, 20))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('once followed, the hash does not pull the screen back: the workout picked after it stays picked through an edit', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    await open(['/plan', '/plan/change#ex-curl'])
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
    click(/^Full Body/)
    press('Add a set to Incline Press')
    expect(screen.getByRole('button', { name: /^Full Body/ }).getAttribute('aria-current')).toBe('true')
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('a malformed hash is ignored', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    await open(['/plan', '/plan/change#%E0%A4%A'])
    await new Promise((r) => setTimeout(r, 20))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('with no hash nothing scrolls', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    await open()
    await new Promise((r) => setTimeout(r, 20))
    expect(scroll).not.toHaveBeenCalled()
  })
})

// ─── Captured for the 390 px pictures (design/1.2/built) ─────────────────────────────────────────────────────────────────

describe('draws board PL1b (the stable screen)', () => {
  it('PL1b: the rows, a changed set, a staged set with its stage row, a warmup, a superset’s A/B labels, a new exercise with its sets', async () => {
    useWorld(stableWorld(), {})
    const { container } = await open()
    click('Set 02 of Incline Press: rep target')
    pickReps('Rep target', { segment: 'RANGE', from: '10', to: '12', useForAll: false }, 'SET 10–12 REPS')
    click('Set 02 of Incline Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Dropset/ }))
    closeDialog('What is this set?')
    click('Set 01 of Leg Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Warmup/ }))
    closeDialog('What is this set?')
    press('More rest after set 02 of Leg Press', 8)
    click('+ ADD EXERCISE')
    const sheet = await screen.findByRole('dialog', { name: 'Add exercise' })
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Add Dip' }))
    press('Add a set to Dip', 2)
    click('All sets of Dip: rep target')
    pickReps('Rep target', { segment: 'RANGE', from: '15', to: '20' }, 'SET 15–20 REPS')
    captureRender('change-program-stable-page', container)
  })

  it('the widest rep boxes (for the 375 px check): the longest kind with the most stages, a warmup, a rest of two minutes', async () => {
    useWorld(stableWorld(), {})
    const { container } = await open()
    click('Set 02 of Leg Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Rest-pause/ }))
    press('More pauses', 9)
    closeDialog('What is this set?')
    click('Set 03 of Leg Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Myo-reps/ }))
    press('More mini-sets', 2)
    closeDialog('What is this set?')
    click('Set 01 of Leg Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Warmup/ }))
    closeDialog('What is this set?')
    press('More rest after set 02 of Leg Press', 8)
    captureRender('change-program-stable-widest', container)
  }, 20000)

  it('the pickers as this screen opens them', async () => {
    await open()
    click('Set 02 of Incline Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Rest-pause/ }))
    captureRender('change-program-set-type-sheet', document.body)
    closeDialog('What is this set?')
    click('Set 02 of Incline Press: rep target')
    captureRender('change-program-rep-sheet', document.body)
  })
})

// ─── The review's probes (chunk 51b review 1: S1-S6) ─────────────────────────────────────────────────────────────────────
// Six breaks passed every test above: "+ SET", REST AFTER and ALL were only ever pressed on the first workout (Full Body), REMOVE THIS SET
// only on an exercise's last set, and a stage's rep target only on the last set. These are the review's probes as tests, on the world above.

describe('a set-row writer writes to the workout shown and the set pressed (review 1: S1-S6)', () => {
  it('S1: "+ SET" on a workout that is not the first writes that workout (Arms, Dip)', async () => {
    useWorld(stableWorld(), {})
    await open()
    const before = world
    click(/^Arms/)
    press('Add a set to Dip')
    expect(setRow('Set 03 of Dip: rep target').textContent).toBe('8–12')
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => editSetsOf(e, 'arms', 'pe-dip', (sets) => [...sets, newSet('8-12')])))
    expect(world.db.v2_program_sets.filter((r) => r.program_exercise_id === 'pe-dip' && !r.removed_at)).toHaveLength(3)
    expect(world.db.v2_program_sets.filter((r) => r.program_exercise_id === 'pe-inc' && !r.removed_at)).toHaveLength(2)
  })

  it('S2: REST AFTER on a workout that is not the first writes that workout (Arms, Dip set 01 to 1:00)', async () => {
    useWorld(stableWorld(), {})
    await open()
    const before = world
    click(/^Arms/)
    press('More rest after set 01 of Dip', 4)
    expect(screen.getByRole('group', { name: 'Rest after set 01 of Dip' }).textContent).toContain('1:00')
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => editSetsOf(e, 'arms', 'pe-dip', (sets) => sets.map((x, i) => (i === 0 ? { ...x, restSeconds: 60 } : x)))))
    expect(world.db.v2_program_sets.find((r) => r.id === 'pe-dip-s1')!.rest_seconds).toBe(60)
    expect(world.db.v2_program_sets.find((r) => r.id === 'pe-dip-s2')!.rest_seconds).toBeNull()
  })

  it('S3: ALL on a workout that is not the first writes that workout (Arms, Dip to 6–8)', async () => {
    useWorld(stableWorld(), {})
    await open()
    const before = world
    click(/^Arms/)
    click('All sets of Dip: rep target')
    pickReps('Rep target', { segment: 'RANGE', from: '6', to: '8' }, 'SET 6–8 REPS')
    expect(setRow('All sets of Dip: rep target').textContent).toBe('6–8')
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => editSetsOf(e, 'arms', 'pe-dip', (sets) => sets.map((x) => withReps(x, '6-8')))))
    expect(world.db.v2_program_sets.filter((r) => r.program_exercise_id === 'pe-dip').map((r) => [r.rep_min, r.rep_max])).toEqual([[6, 8], [6, 8]])
  })

  it('S4: REMOVE THIS SET on the FIRST of three removes that one (Leg Press set 01)', async () => {
    useWorld(stableWorld(), {})
    await open()
    const before = world
    click('Set 01 of Leg Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByText('REMOVE THIS SET'))
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => editSetsOf(e, 'fb', 'pe-leg', (sets) => sets.slice(1))))
    expect(world.db.v2_program_sets.find((r) => r.id === 'pe-leg-s1')!.removed_at).not.toBeNull()
    expect(world.db.v2_program_sets.find((r) => r.id === 'pe-leg-s2')!.removed_at).toBeNull()
    expect(world.db.v2_program_sets.find((r) => r.id === 'pe-leg-s3')!.removed_at).toBeNull()
  })

  it('S5: REMOVE THIS SET on the MIDDLE of three removes that one, and the sessions keep the places of the others (Leg Press set 02)', async () => {
    useWorld(stableWorld(), {})
    await open()
    const before = world
    click('Set 02 of Leg Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByText('REMOVE THIS SET'))
    // the rows left are the first and the third, renumbered 01 and 02 on the screen
    expect(['01', '02'].map((n) => setRow(`Set ${n} of Leg Press: type`).textContent)).toEqual(['01', '02'])
    expect(screen.queryByRole('button', { name: 'Set 03 of Leg Press: type' })).toBeNull()
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => editSetsOf(e, 'fb', 'pe-leg', (sets) => sets.filter((_, i) => i !== 1))))
    expect(world.db.v2_program_sets.find((r) => r.id === 'pe-leg-s2')!.removed_at).not.toBeNull()
    expect(world.db.v2_program_sets.find((r) => r.id === 'pe-leg-s3')!.removed_at).toBeNull()
    const w3 = world.db.v2_week_plan_sets.filter((r) => r.week_plan_id === 'p3-fb' && r.program_exercise_id === 'pe-leg').sort((a, b) => a.set_number - b.set_number)
    expect(w3.map((r) => [r.set_number, r.program_set_id])).toEqual([
      [1, 'pe-leg-s1'],
      [3, 'pe-leg-s3'], // the gap stays: chunk 45's placeInOrder, and 1.1's Plan delete leaves one too
    ])
  })

  it("S6: a stage's rep target on a set that is not the last writes that set's stage (Incline Press set 01 made a dropset)", async () => {
    useWorld(stableWorld(), {})
    await open()
    const before = world
    click('Set 01 of Incline Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Dropset/ }))
    closeDialog('What is this set?')
    click('Stage 1 of set 01 of Incline Press: rep target')
    pickReps('Rep target', { segment: 'AMRAP' }, 'SET AMRAP')
    expect(setRow('Stage 1 of set 01 of Incline Press: rep target').textContent).toBe('AMRAP')
    await save()
    expect(sent()).toEqual(
      expectedFor(before, (e) =>
        editSetsOf(e, 'fb', 'pe-inc', (sets) =>
          sets.map((x, i) => (i === 0 ? { ...x, stageKind: 'dropset' as const, stageRestSeconds: null, stages: [{ id: null, repMin: null, repMax: null, isAmrap: true }] } : x)),
        ),
      ),
    )
  })
})

// ─── Which set, which exercise, which workout (chunk 51b review 1) ─────────────────────────────────────────────────────────
// The probes above are six places the first tests never pressed. This is every set-row writer pressed on both workouts, on both exercises of
// each, and on the first, a middle and the last set of each (RULES.md: "A writer that takes an item's place and a selected container is
// tested on an item that isn't the last, in a container that isn't the first"). The world has no two sets alike, so a write that lands on
// another set, another exercise or the other workout is a different list of ops. Each test holds the list SAVE sends against the one
// `planProgramChange` makes for the same edit written by hand on chunk 45's draft (`SetEdit`: plain array operations), then reads the
// rows the stand-in left back as the screen reads the run copy, so a list that reads right and runs wrong fails too.

type WorkoutId = 'fb' | 'arms'
interface Ex {
  workout: WorkoutId
  name: string
  row: string
}
const LEG: Ex = { workout: 'fb', name: 'Leg Press', row: 'pe-leg' }
const INC: Ex = { workout: 'fb', name: 'Incline Press', row: 'pe-inc' }
const CURL: Ex = { workout: 'arms', name: 'Cable Curl', row: 'pe-curl' }
const DIP: Ex = { workout: 'arms', name: 'Dip', row: 'pe-dip' }
const EXERCISES_OF: Record<WorkoutId, readonly [Ex, Ex]> = { fb: [LEG, INC], arms: [CURL, DIP] }
const TAB: Record<WorkoutId, RegExp> = { fb: /^Full Body/, arms: /^Arms/ }
const WORKOUTS: readonly WorkoutId[] = ['fb', 'arms']
const PLACES = [0, 1, 2] as const
const n2 = (i: number): string => String(i + 1).padStart(2, '0') // a set's number as its row says it, with no warmup before it

type Edit = ReturnType<typeof draftFromRunCopy>
type SetEdit = readonly [Ex, (sets: readonly DraftSet[]) => readonly DraftSet[]]
const applyEdits = (e: Edit, list: readonly SetEdit[]): Edit => list.reduce((acc, [x, fn]) => editSetsOf(acc, x.workout, x.row, fn), e)
const draftOf = (w: World): Edit => draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)
const setsIn = (e: Edit, x: Ex): readonly DraftSet[] => e.workouts.find((w) => w.id === x.workout)!.exercises.find((en) => en.kind === 'kept' && en.id === x.row)!.sets!
const at = (sets: readonly DraftSet[], i: number, fn: (s: DraftSet) => DraftSet): DraftSet[] => sets.map((s, j) => (j === i ? fn(s) : s))

// What a draft says about its default sets, without ids: the reading of the rows a save leaves.
function shapeOf(e: Edit) {
  return e.workouts.map((w) => ({
    id: w.id,
    exercises: w.exercises.map((en) => ({
      exercise: en.kind === 'kept' ? en.id : en.exerciseId,
      sets: (en.sets ?? []).map((s) => ({
        warmup: s.isWarmup,
        kind: s.stages.length > 0 ? (s.stageKind ?? 'dropset') : null,
        reps: repText(repTargetOf(s)),
        rest: s.restSeconds,
        stageRest: s.stages.length > 0 ? s.stageRestSeconds : null,
        stages: s.stages.map((st) => repText(repTargetOf(st))),
      })),
    })),
  }))
}

// SAVE, and then: the list sent is the one the planner makes for the intended edit, and the rows left read back as that edit.
async function saveAndExpect(before: World, edits: readonly SetEdit[]) {
  await save()
  expect(sent()).toEqual(expectedFor(before, (e) => applyEdits(e, edits)))
  expect(shapeOf(draftOf(world))).toEqual(shapeOf(applyEdits(draftOf(before), edits)))
}

// The rep boxes and rests of an exercise as the screen draws them now, in order.
const repBoxes = (x: Ex): string[] => screen.getAllByRole('button', { name: new RegExp(`^Set \\S+ of ${x.name}: rep target$`) }).map((b) => b.textContent ?? '')
const restBoxes = (x: Ex): string[] => screen.getAllByRole('group', { name: new RegExp(`^Rest after set \\S+ of ${x.name}$`) }).map((g) => g.textContent ?? '')
const boxTextOf = (s: DraftSet): string => `${repText(repTargetOf(s))}${kindText(s) ?? ''}`
function expectRowsOf(x: Ex, sets: readonly DraftSet[]) {
  expect({ x: x.name, boxes: repBoxes(x) }).toEqual({ x: x.name, boxes: sets.map(boxTextOf) })
  restBoxes(x).forEach((text, i) => expect({ x: x.name, i, rest: text.includes(restAfterText(sets[i].restSeconds)) }).toEqual({ x: x.name, i, rest: true }))
}

// The rep target picker as it opened: its segment and numbers, like the set's own target.
function pickerReads(): string {
  const sheet = dialog('Rep target')
  const pressed = ['NONE', 'NUMBER', 'RANGE', 'AMRAP'].find((s) => within(sheet).getByRole('button', { name: s }).getAttribute('aria-pressed') === 'true')
  const value = (label: string) => (within(sheet).getByLabelText(label) as HTMLInputElement).value
  return pressed === 'NUMBER' ? `NUMBER ${value('REPS')}` : pressed === 'RANGE' ? `RANGE ${value('From')}–${value('To')}` : (pressed ?? 'nothing pressed')
}
function readsOf(s: DraftSet): string {
  const t = repTargetOf(s)
  return t.type === 'none' ? 'NONE' : t.type === 'amrap' ? 'AMRAP' : t.type === 'number' ? `NUMBER ${t.value}` : `RANGE ${t.min}–${t.max}`
}
function answerReps(target: RepTarget, useForAll: boolean | undefined) {
  const how =
    target.type === 'number'
      ? { segment: 'NUMBER' as const, number: String(target.value) }
      : target.type === 'range'
        ? { segment: 'RANGE' as const, from: String(target.min), to: String(target.max) }
        : { segment: 'AMRAP' as const }
  pickReps('Rep target', { ...how, useForAll }, /^SET /)
}

// A set's rep box: opened, held against the set's own target and its eyebrow, answered, and the box now says the answer.
function repBoxAnswer(x: Ex, i: number, was: DraftSet, target: RepTarget, useForAll: boolean) {
  click(`Set ${n2(i)} of ${x.name}: rep target`)
  expect({ x: x.name, i, opened: pickerReads() }).toEqual({ x: x.name, i, opened: readsOf(was) })
  expect(within(dialog('Rep target')).getByText(`${x.name} · SET ${n2(i)}`)).toBeTruthy()
  answerReps(target, useForAll)
}

const withSetTypeAt = (sets: readonly DraftSet[], i: number, answer: 'warmup'): DraftSet[] => at(sets, i, (s) => withSetType(s, TYPE_OF[answer]))

type TypeAnswer = 'dropset 1' | 'dropset 2' | 'dropset 3' | 'rest-pause 1' | 'rest-pause 2' | 'cluster 1' | 'normal' | 'warmup'
const TYPE_OF: Record<TypeAnswer, SetType> = {
  'dropset 1': { kind: 'staged', stageKind: 'dropset', stageCount: 1, stageRestSeconds: null },
  'dropset 2': { kind: 'staged', stageKind: 'dropset', stageCount: 2, stageRestSeconds: null },
  'dropset 3': { kind: 'staged', stageKind: 'dropset', stageCount: 3, stageRestSeconds: null },
  'rest-pause 1': { kind: 'staged', stageKind: 'rest_pause', stageCount: 1, stageRestSeconds: null },
  'rest-pause 2': { kind: 'staged', stageKind: 'rest_pause', stageCount: 2, stageRestSeconds: null },
  'cluster 1': { kind: 'staged', stageKind: 'cluster', stageCount: 1, stageRestSeconds: null },
  normal: { kind: 'normal' },
  warmup: { kind: 'warmup' },
}
// A set's number opens the set type picker; the answer is a row of its list and, for a staged kind, more of its stepper.
function typeAnswer(x: Ex, i: number, answer: TypeAnswer, row: { label: string; eyebrow: string } = { label: n2(i), eyebrow: n2(i) }) {
  click(`Set ${row.label} of ${x.name}: type`)
  expect(within(dialog('What is this set?')).getByText(`${x.name} · SET ${row.eyebrow}`)).toBeTruthy()
  const [kind, count] = answer.split(' ')
  const option = kind === 'normal' ? /^Normal/ : kind === 'warmup' ? /^Warmup/ : kind === 'dropset' ? /^Dropset/ : kind === 'cluster' ? /^Cluster/ : /^Rest-pause/
  fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: option }))
  const more = kind === 'dropset' ? 'More drops' : 'More pauses'
  for (let n = 1; n < Number(count ?? 1); n++) fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: more }))
  closeDialog('What is this set?')
}

describe('every set-row writer, on both workouts, both exercises and the first, a middle and the last set (review 1)', () => {
  beforeEach(() => {
    useWorld(unevenStableWorld(), {})
  })

  it('the world: two workouts of two exercises of three sets, no two sets of an exercise alike, and the screen draws them all', async () => {
    await open()
    const d = draftOf(world)
    for (const wk of WORKOUTS) {
      click(TAB[wk])
      for (const x of EXERCISES_OF[wk]) {
        const sets = setsIn(d, x)
        expect(sets).toHaveLength(3)
        expect(new Set(sets.map((s) => JSON.stringify([s.repMin, s.repMax, s.isAmrap, s.restSeconds, s.stages.length, s.stageKind]))).size).toBe(3)
        expectRowsOf(x, sets)
      }
    }
  }, 20000)

  // REST AFTER: a press of the stepper on one set writes that set's rest and no other. The three sets of an exercise end on three different rests.
  const RESTS: ReadonlyArray<{ x: Ex; presses: ReadonlyArray<readonly ['more' | 'less', number]>; seconds: readonly number[] }> = [
    { x: LEG, presses: [['more', 1], ['more', 3], ['less', 1]], seconds: [15, 45, 135] }, // the third set had 2:30
    { x: INC, presses: [['more', 2], ['more', 1], ['more', 4]], seconds: [30, 15, 150] }, // the third had 1:30
    { x: CURL, presses: [['more', 4], ['less', 2], ['more', 1]], seconds: [60, 30, 15] }, // the second had 1:00
    { x: DIP, presses: [['more', 2], ['more', 3], ['more', 1]], seconds: [30, 45, 15] },
  ]
  it.each(WORKOUTS)('REST AFTER, in %s: each set takes its own presses', async (wk) => {
    await open()
    const before = world
    click(TAB[wk])
    const edits: SetEdit[] = []
    for (const { x, presses, seconds } of RESTS.filter((r) => r.x.workout === wk)) {
      presses.forEach(([direction, times], i) => press(`${direction === 'more' ? 'More' : 'Less'} rest after set ${n2(i)} of ${x.name}`, times))
      edits.push([x, (sets) => sets.map((s, i) => ({ ...s, restSeconds: seconds[i] }))])
      expectRowsOf(x, applyEdits(draftOf(before), [[x, (sets) => sets.map((s, i) => ({ ...s, restSeconds: seconds[i] }))]]).workouts.flatMap((w) => w.exercises).filter((en) => en.kind === 'kept' && en.id === x.row)[0].sets!)
    }
    await saveAndExpect(before, edits)
  }, 20000)

  // The set type: the number of a set opens the picker for that set. Every set of the world ends on its own answer.
  const TYPES_OF: Record<string, readonly [TypeAnswer, TypeAnswer, TypeAnswer]> = {
    [LEG.row]: ['dropset 1', 'dropset 2', 'warmup'],
    [INC.row]: ['rest-pause 1', 'normal', 'warmup'], // its second set was a dropset: Normal takes the stage away
    [CURL.row]: ['dropset 2', 'rest-pause 1', 'warmup'],
    [DIP.row]: ['rest-pause 1', 'dropset 1', 'normal'], // its third set was a rest-pause with a stage
  }
  it.each(WORKOUTS)('the set type, in %s: the number of each set opens the picker for that set and the answer is written to it', async (wk) => {
    await open()
    const before = world
    click(TAB[wk])
    const edits: SetEdit[] = []
    for (const x of EXERCISES_OF[wk]) {
      const answers = TYPES_OF[x.row]
      // the last set first: a warmup there leaves the numbers of the sets before it as they are
      for (const i of [2, 1, 0]) typeAnswer(x, i, answers[i])
      edits.push([x, (sets) => sets.map((s, i) => withSetType(s, TYPE_OF[answers[i]]))])
      const want = applyEdits(draftOf(before), [[x, (sets) => sets.map((s, i) => withSetType(s, TYPE_OF[answers[i]]))]])
      expect({ x: x.name, boxes: repBoxes(x) }).toEqual({ x: x.name, boxes: setsIn(want, x).map(boxTextOf) })
    }
    await saveAndExpect(before, edits)
  }, 20000)

  // REMOVE THIS SET: the first, a middle and the last set of the first exercise, and (the other way round) the last, a middle and the first of the second.
  const PLACE_NAME = ['first', 'middle', 'last'] as const
  const REMOVALS = WORKOUTS.flatMap((workout) => PLACES.map((p) => ({ workout, p, q: 2 - p, title: `the ${PLACE_NAME[p]} set of the first exercise and the ${PLACE_NAME[2 - p]} set of the second` })))
  it.each(REMOVALS)('REMOVE THIS SET in $workout: $title', async ({ workout, p, q }) => {
    await open()
    const before = world
    click(TAB[workout])
    const [a, b] = EXERCISES_OF[workout]
    const removeVia = (x: Ex, i: number) => {
      click(`Set ${n2(i)} of ${x.name}: type`)
      expect(within(dialog('What is this set?')).getByText(`${x.name} · SET ${n2(i)}`)).toBeTruthy()
      fireEvent.click(within(dialog('What is this set?')).getByText('REMOVE THIS SET'))
      expect(screen.queryByRole('dialog')).toBeNull()
    }
    removeVia(a, p)
    removeVia(b, q)
    const without = (i: number) => (sets: readonly DraftSet[]) => [...sets.slice(0, i), ...sets.slice(i + 1)]
    const want = applyEdits(draftOf(before), [[a, without(p)], [b, without(q)]])
    expectRowsOf(a, setsIn(want, a))
    expectRowsOf(b, setsIn(want, b))
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => applyEdits(e, [[a, without(p)], [b, without(q)]])))
    // the default: those two rows are soft-removed and the others are live; the sessions that matched lose those two and keep the places of the rest
    const gone = [`${a.row}-s${p + 1}`, `${b.row}-s${q + 1}`]
    const live = (x: Ex) => world.db.v2_program_sets.filter((r) => r.program_exercise_id === x.row && r.parent_program_set_id === null && !r.removed_at).map((r) => r.id)
    expect(live(a)).toEqual([1, 2, 3].map((n) => `${a.row}-s${n}`).filter((id) => id !== gone[0]))
    expect(live(b)).toEqual([1, 2, 3].map((n) => `${b.row}-s${n}`).filter((id) => id !== gone[1]))
    for (const [x, g] of [[a, p + 1], [b, q + 1]] as const) {
      for (const plan of [`p2-${workout}`, `p3-${workout}`]) {
        const rows = world.db.v2_week_plan_sets.filter((r) => r.week_plan_id === plan && r.program_exercise_id === x.row && r.parent_week_plan_set_id === null).sort((m, n) => m.set_number - n.set_number)
        expect({ plan, x: x.name, rows: rows.map((r) => [r.set_number, r.program_set_id]) }).toEqual({ plan, x: x.name, rows: [1, 2, 3].filter((n) => n !== g).map((n) => [n, `${x.row}-s${n}`]) })
      }
    }
    expect(shapeOf(draftOf(world))).toEqual(shapeOf(applyEdits(draftOf(before), [[a, without(p)], [b, without(q)]])))
  }, 20000)

  // A set's rep box (Use for all unticked): the picker opens on that set's own target, and the answer is written to that set.
  const REPS: Record<string, readonly [RepTarget, RepTarget, RepTarget]> = {
    [LEG.row]: [{ type: 'number', value: 5 }, { type: 'range', min: 8, max: 9 }, { type: 'amrap' }],
    [INC.row]: [{ type: 'range', min: 6, max: 8 }, { type: 'number', value: 12 }, { type: 'range', min: 8, max: 12 }],
    [CURL.row]: [{ type: 'range', min: 12, max: 14 }, { type: 'amrap' }, { type: 'number', value: 9 }],
    [DIP.row]: [{ type: 'number', value: 7 }, { type: 'range', min: 4, max: 6 }, { type: 'amrap' }],
  }
  it.each(WORKOUTS)('a set’s rep target, in %s: the picker opens on that set’s own target and its answer is written to that set alone', async (wk) => {
    await open()
    const before = world
    click(TAB[wk])
    const edits: SetEdit[] = []
    for (const x of EXERCISES_OF[wk]) {
      const answers = REPS[x.row]
      const was = setsIn(draftOf(before), x)
      // the last set first, then back: the order of the presses is not the order of the sets
      for (const i of [2, 0, 1]) repBoxAnswer(x, i, was[i], answers[i], false)
      edits.push([x, (sets) => sets.map((s, i) => withRepTarget(s, answers[i]))])
      expectRowsOf(x, setsIn(applyEdits(draftOf(before), [[x, (sets) => sets.map((s, i) => withRepTarget(s, answers[i]))]]), x))
    }
    await saveAndExpect(before, edits)
  }, 20000)

  // "Use for all" (ticked, as it starts): the answer goes to every set of the exercise, from whichever set the box was pressed on.
  it.each(WORKOUTS)('"Use for all N sets", in %s: from a middle set of one exercise and the last of the other, every set of that exercise takes the answer', async (wk) => {
    await open()
    const before = world
    click(TAB[wk])
    const [a, b] = EXERCISES_OF[wk]
    const answerA: RepTarget = { type: 'range', min: 6, max: 8 }
    const answerB: RepTarget = { type: 'number', value: 10 }
    click(`Set 02 of ${a.name}: rep target`)
    expect(within(dialog('Rep target')).getByRole('checkbox', { name: `Use for all 3 sets of ${a.name}` }).getAttribute('aria-checked')).toBe('true')
    answerReps(answerA, true)
    click(`Set 03 of ${b.name}: rep target`)
    expect(within(dialog('Rep target')).getByRole('checkbox', { name: `Use for all 3 sets of ${b.name}` }).getAttribute('aria-checked')).toBe('true')
    answerReps(answerB, true)
    const edits: SetEdit[] = [[a, (sets) => sets.map((s) => withRepTarget(s, answerA))], [b, (sets) => sets.map((s) => withRepTarget(s, answerB))]]
    expect(repBoxes(a).map((t) => t.replace(/DROPSET.*|REST-PAUSE.*/, ''))).toEqual(['6–8', '6–8', '6–8'])
    expect(repBoxes(b).map((t) => t.replace(/DROPSET.*|REST-PAUSE.*/, ''))).toEqual(['10', '10', '10'])
    await saveAndExpect(before, edits)
  }, 20000)

  // ALL: the row over an exercise's sets; it reads MIXED while they differ and its answer goes to that exercise's sets alone.
  const ALLS: Record<string, RepTarget> = {
    [LEG.row]: { type: 'range', min: 6, max: 8 },
    [INC.row]: { type: 'number', value: 10 },
    [CURL.row]: { type: 'amrap' },
    [DIP.row]: { type: 'range', min: 15, max: 20 },
  }
  it.each(WORKOUTS)('ALL, in %s: both exercises read MIXED, open on no target, and the answer goes to the exercise pressed', async (wk) => {
    await open()
    const before = world
    click(TAB[wk])
    const edits: SetEdit[] = []
    for (const x of EXERCISES_OF[wk]) {
      expect(setRow(`All sets of ${x.name}: rep target`).textContent).toBe('MIXED')
      click(`All sets of ${x.name}: rep target`)
      expect(pickerReads()).toBe('NONE')
      expect(within(dialog('Rep target')).queryByRole('checkbox')).toBeNull()
      answerReps(ALLS[x.row], undefined)
      edits.push([x, (sets) => sets.map((s) => withRepTarget(s, ALLS[x.row]))])
      expect(setRow(`All sets of ${x.name}: rep target`).textContent).toBe(repText(ALLS[x.row]))
    }
    // the exercises of the workout that was not pressed are as they were
    const other = EXERCISES_OF[wk === 'fb' ? 'arms' : 'fb']
    click(TAB[wk === 'fb' ? 'arms' : 'fb'])
    for (const x of other) expect(setRow(`All sets of ${x.name}: rep target`).textContent).toBe('MIXED')
    await saveAndExpect(before, edits)
  }, 20000)

  // A stage's rep box: the picker for that stage of that set. LEG and CURL get three staged sets (three stages, one and two stages) and
  // every stage a target of its own; INC and DIP already have one staged set each.
  it.each(WORKOUTS)('a stage’s rep target, in %s: the stage pressed of the set pressed, on the first, a middle and the last set', async (wk) => {
    await open()
    const before = world
    click(TAB[wk])
    const [a, b] = EXERCISES_OF[wk]
    // a: set 01 a dropset of three drops, set 02 a cluster, set 03 a rest-pause of two pauses
    typeAnswer(a, 2, 'rest-pause 2')
    typeAnswer(a, 1, 'cluster 1')
    typeAnswer(a, 0, 'dropset 3')
    const stageTargets: ReadonlyArray<readonly [number, number, RepTarget]> = [
      [0, 2, { type: 'range', min: 8, max: 10 }],
      [2, 1, { type: 'number', value: 3 }],
      [0, 0, { type: 'amrap' }],
      [1, 0, { type: 'range', min: 12, max: 15 }],
      [0, 1, { type: 'number', value: 5 }],
      [2, 0, { type: 'number', value: 4 }],
    ]
    for (const [i, s, target] of stageTargets) {
      click(`Stage ${s + 1} of set ${n2(i)} of ${a.name}: rep target`)
      // a stage has no siblings to share its target with
      expect(within(dialog('Rep target')).queryByRole('checkbox')).toBeNull()
      expect(within(dialog('Rep target')).getByText(`${a.name} · SET ${n2(i)}`)).toBeTruthy()
      answerReps(target, undefined)
    }
    // b: its one staged set (INC set 02 has a stage at 6–8, DIP set 03 one at 3)
    const staged = wk === 'fb' ? 1 : 2
    const stageB: RepTarget = wk === 'fb' ? { type: 'range', min: 4, max: 6 } : { type: 'number', value: 2 }
    click(`Stage 1 of set ${n2(staged)} of ${b.name}: rep target`)
    expect(pickerReads()).toBe(wk === 'fb' ? 'RANGE 6–8' : 'NUMBER 3')
    answerReps(stageB, undefined)

    const typed = (sets: readonly DraftSet[]) => sets.map((s, i) => withSetType(s, TYPE_OF[(['dropset 3', 'cluster 1', 'rest-pause 2'] as const)[i]]))
    const staging = (sets: readonly DraftSet[]) => {
      let out = typed(sets)
      for (const [i, s, target] of stageTargets) out = at(out, i, (x) => ({ ...x, stages: x.stages.map((g, k) => (k === s ? withRepTarget(g, target) : g)) }))
      return out
    }
    const edits: SetEdit[] = [
      [a, staging],
      [b, (sets) => at(sets, staged, (x) => ({ ...x, stages: x.stages.map((g) => withRepTarget(g, stageB)) }))],
    ]
    // the screen's stage rows say what was answered
    expect(setRow(`Stage 3 of set 01 of ${a.name}: rep target`).textContent).toBe('8–10')
    expect(setRow(`Stage 1 of set 01 of ${a.name}: rep target`).textContent).toBe('AMRAP')
    expect(setRow(`Stage 2 of set 01 of ${a.name}: rep target`).textContent).toBe('5')
    expect(setRow(`Stage 1 of set 02 of ${a.name}: rep target`).textContent).toBe('12–15')
    expect(setRow(`Stage 1 of set 03 of ${a.name}: rep target`).textContent).toBe('4')
    expect(setRow(`Stage 2 of set 03 of ${a.name}: rep target`).textContent).toBe('3')
    expect(setRow(`Stage 1 of set ${n2(staged)} of ${b.name}: rep target`).textContent).toBe(repText(stageB))
    await saveAndExpect(before, edits)
  }, 20000)

  // "+ SET": the exercise pressed gets a Normal set with the rep target of its last set (a staged last set gives its own).
  it.each(WORKOUTS)('"+ SET", in %s: each exercise gets a fourth set after its own last set, with that set’s target', async (wk) => {
    await open()
    const before = world
    click(TAB[wk])
    const [a, b] = EXERCISES_OF[wk]
    press(`Add a set to ${a.name}`)
    press(`Add a set to ${b.name}`, 2)
    const edits: SetEdit[] = [
      [a, (sets) => [...sets, newSetAfter(sets[sets.length - 1])]],
      [b, (sets) => [...sets, newSetAfter(sets[sets.length - 1]), newSetAfter(sets[sets.length - 1])]],
    ]
    const want = applyEdits(draftOf(before), edits)
    expectRowsOf(a, setsIn(want, a))
    expectRowsOf(b, setsIn(want, b))
    const last = (x: Ex) => repText(repTargetOf(setsIn(draftOf(before), x)[2]))
    expect(repBoxes(a)[3]).toBe(last(a))
    expect(repBoxes(b).slice(3)).toEqual([last(b), last(b)])
    await saveAndExpect(before, edits)
  }, 20000)

  // Both workouts in one save, in the order a user works: a change in one, a look at the other, and back.
  it('edits made on both workouts, switching between them, all land in the one save, each on its own workout', async () => {
    await open()
    const before = world
    // Full Body
    press('More rest after set 02 of Leg Press', 2)
    click('Set 01 of Incline Press: type')
    fireEvent.click(within(dialog('What is this set?')).getByText('REMOVE THIS SET'))
    // Arms
    click(TAB.arms)
    press('Add a set to Dip')
    click('Set 02 of Cable Curl: rep target')
    answerReps({ type: 'number', value: 7 }, false)
    // back to Full Body
    click(TAB.fb)
    click('All sets of Leg Press: rep target')
    answerReps({ type: 'range', min: 6, max: 8 }, undefined)
    click('Set 02 of Incline Press: rep target') // the second set is now the first one's neighbour: Incline Press has two sets left
    answerReps({ type: 'amrap' }, false)
    // and Arms once more
    click(TAB.arms)
    click('Set 03 of Dip: type')
    fireEvent.click(within(dialog('What is this set?')).getByRole('button', { name: /^Normal/ }))
    closeDialog('What is this set?')
    press('Less rest after set 02 of Cable Curl', 1)
    const edits: SetEdit[] = [
      [LEG, (sets) => at(sets, 1, (s) => ({ ...s, restSeconds: 30 })).map((s) => withRepTarget(s, { type: 'range', min: 6, max: 8 }))],
      [INC, (sets) => at([...sets.slice(1)], 1, (s) => withRepTarget(s, { type: 'amrap' }))],
      [DIP, (sets) => [...at(sets, 2, (s) => withSetType(s, { kind: 'normal' })), newSetAfter(withSetType(sets[2], { kind: 'normal' }))]],
      [CURL, (sets) => at(sets, 1, (s) => ({ ...withRepTarget(s, { type: 'number', value: 7 }), restSeconds: 45 }))],
    ]
    await saveAndExpect(before, edits)
  }, 20000)

  // After a warmup the rows read W, 01, 02 and the set called 01 is the SECOND of the list: a writer goes by the place in the list, not by the number on the row.
  it.each([
    { label: 'W', place: 0, nth: 'first' },
    { label: '01', place: 1, nth: 'second' },
    { label: '02', place: 2, nth: 'third' },
  ])('after a warmup: REMOVE THIS SET on the row called $label removes the $nth set of the list', async ({ label, place }) => {
    await open()
    const before = world
    typeAnswer(LEG, 0, 'warmup')
    expect(['W', '01', '02'].map((l) => setRow(`Set ${l} of Leg Press: type`).textContent)).toEqual(['W', '01', '02'])
    click(`Set ${label} of Leg Press: type`)
    // the eyebrow numbers the working sets apart from the warmups
    expect(within(dialog('What is this set?')).getByText(`Leg Press · SET ${label === 'W' ? '01' : label}`)).toBeTruthy()
    fireEvent.click(within(dialog('What is this set?')).getByText('REMOVE THIS SET'))
    const edits: SetEdit[] = [
      [
        LEG,
        (sets) => {
          const warm = withSetTypeAt(sets, 0, 'warmup')
          return [...warm.slice(0, place), ...warm.slice(place + 1)]
        },
      ],
    ]
    expectRowsOf(LEG, setsIn(applyEdits(draftOf(before), edits), LEG))
    await save()
    expect(sent()).toEqual(expectedFor(before, (e) => applyEdits(e, edits)))
    const gone = `pe-leg-s${place + 1}`
    expect(world.db.v2_program_sets.filter((r) => r.program_exercise_id === 'pe-leg' && !r.removed_at).map((r) => r.id)).toEqual(['pe-leg-s1', 'pe-leg-s2', 'pe-leg-s3'].filter((id) => id !== gone))
    expect(shapeOf(draftOf(world))).toEqual(shapeOf(applyEdits(draftOf(before), edits)))
  }, 20000)

  it('after a warmup: REST AFTER, the rep box, the type and "+ SET" go to the set at the place of the row pressed (W, 01, 02)', async () => {
    await open()
    const before = world
    typeAnswer(LEG, 0, 'warmup')
    press('More rest after set W of Leg Press', 1)
    press('More rest after set 01 of Leg Press', 2)
    press('More rest after set 02 of Leg Press', 3)
    expect(restBoxes(LEG).map((t) => t.replace(/[−+]/g, ''))).toEqual(['0:15', '0:30', '3:15']) // the third set had 2:30
    click('Set 01 of Leg Press: rep target')
    expect(pickerReads()).toBe('RANGE 10–12')
    expect(within(dialog('Rep target')).getByText('Leg Press · SET 01')).toBeTruthy()
    answerReps({ type: 'number', value: 5 }, false)
    click('Set W of Leg Press: rep target')
    expect(pickerReads()).toBe('RANGE 12–15')
    answerReps({ type: 'amrap' }, false)
    typeAnswer(LEG, 2, 'rest-pause 1', { label: '02', eyebrow: '02' })
    click('Set 01 of Leg Press: type')
    expect(within(dialog('What is this set?')).getByRole('button', { name: /^Normal/ }).getAttribute('aria-pressed')).toBe('true')
    closeDialog('What is this set?')
    press('Add a set to Leg Press')
    const edits: SetEdit[] = [
      [
        LEG,
        (sets) => [
          ...[
            { ...withSetType(withRepTarget(sets[0], { type: 'amrap' }), { kind: 'warmup' }), restSeconds: 15 },
            { ...withRepTarget(sets[1], { type: 'number', value: 5 }), restSeconds: 30 },
            { ...withSetType(sets[2], TYPE_OF['rest-pause 1']), restSeconds: 150 + 45 },
          ],
          newSetAfter(sets[2]),
        ],
      ],
    ]
    await saveAndExpect(before, edits)
  }, 20000)
})
