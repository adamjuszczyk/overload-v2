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
import { sequenceWorld, stableWorld } from './programChange.worlds.testutil'
import { draftFromRunCopy, planProgramChange, type DraftSet, type Op, type RunChangeStatus } from './programChange'
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
