// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { queryClient } from '../../lib/queryClient'
import { captureRender } from '../../testing/captureRender'
import { useSettingsStore } from '../settings/settingsStore'
import type { Exercise, MuscleGroup, Mesocycle, Program } from '../../types'
import {
  NOW,
  applyOpsToDb,
  deletes,
  inputOf,
  inserts,
  runCopyOf,
  scheduleRowsOf,
  sessionsOf,
  updates,
  addExerciseTo,
  patchExercise,
  removeExerciseFrom,
  swapExerciseIn,
  type World,
} from './programChange.testutil'
import { stableWorld, weekDependentWorld } from './programChange.worlds.testutil'
import { draftFromRunCopy, planProgramChange, type Op, type RunChangeStatus } from './programChange'
import type { ChangeProgramSource } from './changeProgramService'

// Chunk 51a: the CHANGE THE PROGRAM screen (boards PL1, PL2, PL3, PL7, PL8, PL9 and the picker's PL4-PL6) and its SAVE. The screen runs
// as it does in the app: the real hooks, the real exercise picker, the real `planProgramChange` and `applyOps`. What is mocked is
// the edge: the reads (`fetchChangeProgramSource`, `useMesos`, `usePrograms`), the exercise library, and the one request SAVE makes
// (`supabase.rpc('v2_apply_ops')`). That request is the proof: each test hands the list it carried to chunk 45's stand-in for
// migration 043 (`applyOpsToDb`, which refuses what the tables refuse) and reads the rows that come out, so a list that is right to
// read and wrong to run fails here (Checks that lied #11).
//
// The world is chunk 45's week-dependent run (F1-a's shape): Push (Monday), Pull (Tuesday: Lat Pulldown with a warmup, a working set
// and a dropset; Face Pull x2) and Legs (Thursday); the run is in week 2; weeks 2 and 3 are planned. Monday's session is done and
// Tuesday's is in progress, so what a save may touch is Thursday's and week 3's.

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
  ex('ex-bench', 'Bench Press', 'chest'),
  ex('ex-pd', 'Lat Pulldown', 'back'),
  ex('ex-face', 'Face Pull', 'shoulders'),
  ex('ex-squat', 'Back Squat', 'quads'),
  ex('ex-leg', 'Leg Press', 'quads'),
  ex('ex-inc', 'Incline Press', 'chest'),
  ex('ex-lat', 'Seated Cable Row', 'back'),
  ex('ex-plank', 'Plank', 'core'),
  ex('ex-curl', 'Cable Curl', 'biceps'),
  ex('ex-dip', 'Dip', 'triceps'),
  ex('ex-machine', 'Machine Pulldown', 'back'),
]

let world: World
let statuses: Record<string, RunChangeStatus>
let uuid = 0

// The clock stands at the testutil's NOW (Thursday 2026-10-15), and the run began on Monday 2026-10-05: this is week 2 whatever day
// the suite runs, and the `removed_at` / `created_at` stamps of a save are NOW, as in the expected lists below.
const startDate = '2026-10-05'

function sourceOf(w: World, st: Record<string, RunChangeStatus>): ChangeProgramSource {
  return {
    runCopy: runCopyOf(w.db, w.programId, w.mesocycleId),
    exercises: EXERCISES.filter((e) => w.db.v2_program_exercises.some((r) => r.exercise_id === e.id)),
    sessions: sessionsOf(w.db, w.mesocycleId, st, w.currentWeek),
    scheduleRows: scheduleRowsOf(w.db, w.mesocycleId),
  }
}

function useWorld(w: World, st: Record<string, RunChangeStatus> = { 'p2-push': 'done', 'p2-pull': 'in_progress' }) {
  world = w
  statuses = st
  h.meso = {
    id: 'meso',
    userId: 'u-test',
    name: 'Push Pull Legs',
    programId: 'prog',
    status: 'active',
    startDate,
    endDate: null,
    createdAt: '',
    sourceProgramId: 'saved',
  }
  const base = { userId: 'u-test', workoutDays: [], createdAt: '', updatedAt: '' }
  h.programs = [
    { ...base, id: 'prog', name: 'Push Pull Legs (run)', schedule: world.db.v2_programs[0].schedule as Program['schedule'], kind: 'run', planningType: w.planningType, scheduleType: w.scheduleType },
    { ...base, id: 'saved', name: 'Push Pull Legs', schedule: {} as Program['schedule'], kind: 'saved', planningType: w.planningType, scheduleType: w.scheduleType },
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
  useWorld(weekDependentWorld())
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
const chooseWorkout = (name: RegExp) => click(name)
const dialog = (name: string) => screen.getByRole('dialog', { name })

async function save() {
  click('SAVE CHANGES')
  await waitFor(() => expect(h.rpc).toHaveBeenCalled())
}

// A button of a confirm (ConfirmDialog is a plain overlay with no role): found by its title, because CANCEL is also the page's own.
function inConfirm(title: string, label: string) {
  fireEvent.click(within(screen.getByText(title).parentElement!).getByRole('button', { name: label }))
}

function sent(): Op[] {
  expect(h.rpc).toHaveBeenCalledTimes(1)
  const [fn, args] = h.rpc.mock.calls[0] as [string, { p_ops: Op[] }]
  expect(fn).toBe('v2_apply_ops')
  return args.p_ops
}

async function pickInSheet(title: string, rowName: string) {
  const sheet = await screen.findByRole('dialog', { name: title })
  fireEvent.click(await within(sheet).findByRole('button', { name: rowName }))
}

// The list `planProgramChange` makes for an edit, from the same world, statuses and ids the screen draws (id-1, id-2, …).
function expectedFor(before: World, edit: (e: ReturnType<typeof draftFromRunCopy>) => ReturnType<typeof draftFromRunCopy>, statusesNow = statuses): Op[] {
  const input = inputOf(before, edit(draftFromRunCopy(runCopyOf(before.db, before.programId, before.mesocycleId), before.planningType)), {
    statuses: statusesNow,
    newId: counter(),
  })
  return planProgramChange(input).ops
}
function counter(): () => string {
  let n = 0
  return () => `id-${++n}`
}

// ─── What SAVE sends ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('SAVE sends exactly the op list planProgramChange returns for the draft (W)', () => {
  it("TASKS' own edit: swap Lat Pulldown for Machine Pulldown, remove Face Pull, add Cable Curl at the end with a rest of 2:00, rename Pull", async () => {
    await open()
    const before = world // the rows as the screen read them; the stand-in for 043 changes `world` when SAVE runs
    chooseWorkout(/^Pull/)
    click('Swap Lat Pulldown')
    await pickInSheet('Swap Lat Pulldown', 'Swap to Machine Pulldown')
    click('Remove Face Pull')
    expect(screen.getByText('Remove Face Pull from week 2?')).toBeTruthy()
    expect(screen.getByText('This deletes its planned sets from week 2 on.')).toBeTruthy()
    click('REMOVE')
    click('+ ADD EXERCISE')
    await pickInSheet('Add exercise', 'Add Cable Curl')
    click('Cable Curl: rest, tempo, unit')
    for (let i = 0; i < 8; i++) fireEvent.click(within(dialog('Cable Curl')).getByRole('button', { name: 'Rest: more' }))
    fireEvent.click(within(dialog('Cable Curl')).getByRole('button', { name: 'Close' }))
    click('Rename Pull')
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Pull A' } })
    click('DONE')
    await save()

    const ops = sent()
    // The independent expectation: the same edit written by hand on chunk 45's draft, the same ids.
    const expected = expectedFor(before, (e) => {
      let next = swapExerciseIn(e, 'pull', 'pe-pd', 'ex-machine')
      next = removeExerciseFrom(next, 'pull', 'pe-face')
      next = addExerciseTo(next, 'pull', { exerciseId: 'ex-curl', weightUnit: 'kg', restSeconds: 120 })
      return { ...next, workouts: next.workouts.map((w) => (w.id === 'pull' ? { ...w, name: 'Pull A' } : w)) }
    })
    expect(ops).toEqual(expected)

    // And what the rows say after the list runs (the stand-in for 043 refuses what the tables refuse).
    const db = world.db
    expect(db.v2_workout_days.find((w) => w.id === 'pull')!.name).toBe('Pull A')
    const live = db.v2_program_exercises.filter((r) => r.workout_day_id === 'pull' && !r.removed_at).sort((a, b) => a.position - b.position)
    expect(live.map((r) => r.exercise_id)).toEqual(['ex-machine', 'ex-curl'])
    expect(live[1].rest_seconds).toBe(120)
    // Monday's (done) and Tuesday's (in progress) rows are not touched; week 3's Pull holds the change with no Face Pull.
    const tuesday = db.v2_week_plan_exercises.filter((r) => r.week_plan_id === 'p2-pull').map((r) => r.program_exercise_id)
    expect(tuesday.sort()).toEqual(['pe-face', 'pe-pd'])
    const week3 = db.v2_week_plan_exercises.filter((r) => r.week_plan_id === 'p3-pull').sort((a, b) => a.position - b.position)
    expect(week3.map((r) => db.v2_program_exercises.find((p) => p.id === r.program_exercise_id)!.exercise_id)).toEqual(['ex-machine', 'ex-curl'])
    expect(db.v2_week_plan_sets.filter((s) => s.week_plan_id === 'p3-pull' && s.program_exercise_id === live[1].id)).toEqual([])
    expect(ops.some((o) => 'id' in o && (o.id === 'p2-pull' || o.id === 'p2-push'))).toBe(false)
  })

  it('a list it carries is a list the tables take: it is sent once, under p_ops, to v2_apply_ops', async () => {
    await open()
    chooseWorkout(/^Legs/)
    click('Swap Back Squat')
    await pickInSheet('Swap Back Squat', 'Swap to Leg Press')
    await save()
    const [fn, args] = h.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('v2_apply_ops')
    expect(Object.keys(args)).toEqual(['p_ops'])
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })

  it('ADD: a new exercise lands in the not-done sessions of its workout with no sets, and its unit is the Settings unit as a literal', async () => {
    useSettingsStore.setState({ weightUnit: 'lbs' })
    await open()
    chooseWorkout(/^Legs/)
    click('+ ADD EXERCISE')
    await pickInSheet('Add exercise', 'Add Cable Curl')
    expect(screen.getByText('New. It lands in week 2 with no sets; add them in Plan.')).toBeTruthy()
    await save()
    const ops = sent()
    const created = inserts(ops, 'v2_program_exercises')
    expect(created).toHaveLength(1)
    expect(created[0].row).toMatchObject({ workout_day_id: 'legs', exercise_id: 'ex-curl', position: 1, weight_unit: 'lbs', replaces_program_exercise_id: null, user_id: 'u-test' })
    expect(inserts(ops, 'v2_week_plan_exercises').map((o) => o.row.week_plan_id).sort()).toEqual(['p2-legs', 'p3-legs'])
    expect(inserts(ops, 'v2_week_plan_sets')).toEqual([])
    expect(inserts(ops, 'v2_program_sets')).toEqual([])
  })

  it('SWAP: the new exercise takes the old one’s place and sets in the not-done sessions, weights cleared, and names the row it replaces', async () => {
    await open()
    chooseWorkout(/^Legs/)
    click('Swap Back Squat')
    await pickInSheet('Swap Back Squat', 'Swap to Leg Press')
    expect(screen.getByText('Leg Press')).toBeTruthy()
    expect(screen.getByText('QUADS · SWAPPED')).toBeTruthy()
    await save()
    const ops = sent()
    const row = inserts(ops, 'v2_program_exercises')[0].row
    expect(row).toMatchObject({ exercise_id: 'ex-leg', replaces_program_exercise_id: 'pe-squat', position: 0, rest_seconds: null, tempo: null })
    expect(updates(ops, 'v2_program_exercises').find((o) => o.id === 'pe-squat')!.patch).toHaveProperty('removed_at')
    const db = world.db
    for (const plan of ['p2-legs', 'p3-legs']) {
      const sets = db.v2_week_plan_sets.filter((s) => s.week_plan_id === plan)
      expect(sets).toHaveLength(3)
      expect(sets.every((s) => s.program_exercise_id === row.id && s.target_weight === null && s.target_rir === null)).toBe(true)
    }
  })

  it('REMOVE: the exercise is struck through with UNDO until SAVE, and SAVE removes it from the run copy and the not-done sessions', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('Remove Face Pull')
    click('REMOVE')
    expect(screen.getByText('REMOVED FROM WEEK 2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove Face Pull' })).toBeNull()
    await save()
    const ops = sent()
    expect(updates(ops, 'v2_program_exercises').find((o) => o.id === 'pe-face')!.patch).toHaveProperty('removed_at')
    expect(deletes(ops, 'v2_week_plan_exercises').map((o) => o.id)).toEqual(['p3-pull-x-pe-face'])
    expect(deletes(ops, 'v2_week_plan_sets').length).toBe(2)
    expect(world.db.v2_week_plan_exercises.some((r) => r.week_plan_id === 'p2-pull' && r.program_exercise_id === 'pe-face')).toBe(true)
  })

  it('REMOVE can be undone: nothing is sent', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('Remove Face Pull')
    click('REMOVE')
    click('Undo removing Face Pull')
    expect(screen.getByRole('button', { name: 'Remove Face Pull' })).toBeTruthy()
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it("the remove confirm's CANCEL removes nothing", async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('Remove Face Pull')
    inConfirm('Remove Face Pull from week 2?', 'CANCEL')
    expect(screen.getByRole('button', { name: 'Remove Face Pull' })).toBeTruthy()
    expect(screen.queryByText('REMOVED FROM WEEK 2')).toBeNull()
  })

  it('REST, REST AFTER, TEMPO and UNIT of an exercise go to its run-copy row, and to no session', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('Lat Pulldown: rest, tempo, unit')
    const sheet = dialog('Lat Pulldown')
    for (let i = 0; i < 6; i++) fireEvent.click(within(sheet).getByRole('button', { name: 'Rest: more' })) // 1:30
    for (let i = 0; i < 3; i++) fireEvent.click(within(sheet).getByRole('button', { name: 'Rest after: more' })) // 0:45
    fireEvent.change(within(sheet).getByLabelText('Tempo'), { target: { value: '3-0-1-0' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'LBS' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(screen.getByText('REST 1:30')).toBeTruthy()
    expect(screen.getByText('REST AFTER 0:45')).toBeTruthy()
    expect(screen.getByText('TEMPO 3-0-1-0')).toBeTruthy()
    expect(screen.getByText('UNIT LBS')).toBeTruthy()
    await save()
    const ops = sent()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'update', table: 'v2_program_exercises', id: 'pe-pd', patch: { rest_seconds: 90, rest_after_seconds: 45, tempo: '3-0-1-0', weight_unit: 'lbs' } })
  })

  it('SUPERSET links an exercise with the one below, and the round rests are the block’s', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('Link Lat Pulldown with the exercise below')
    expect(screen.getByText('SUPERSET A')).toBeTruthy()
    click('Lat Pulldown: rest, tempo, unit')
    const sheet = dialog('Lat Pulldown')
    for (let i = 0; i < 6; i++) fireEvent.click(within(sheet).getByRole('button', { name: 'After round: more' })) // 1:30
    expect(within(sheet).getByText('The two rests belong to superset A, so they change it for Face Pull too. Changes start in week 2.')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Rest 1:30 after each round')).toBeTruthy()
    await save()
    const ops = sent()
    const block = inserts(ops, 'v2_program_superset_blocks')
    expect(block).toHaveLength(1)
    expect(block[0].row).toMatchObject({ workout_day_id: 'pull', rest_after_round_seconds: 90, rest_within_round_seconds: null })
    const members = updates(ops, 'v2_program_exercises').filter((o) => o.id === 'pe-pd' || o.id === 'pe-face')
    expect(members.map((o) => (o.patch as { superset_block_id: string }).superset_block_id)).toEqual([block[0].row.id, block[0].row.id])
  })

  it('UNLINK and the toggle between members split a superset', async () => {
    useWorld(stableWorld(), {})
    h.cycle = 2
    await open()
    // Full Body: leg, inc, [lat, plank]: SUPERSET A. Join inc into it, then split it after inc with the toggle, then unlink the rest.
    click('Link Incline Press with the exercise below')
    expect(screen.getAllByText(/^SUPERSET A$/)).toHaveLength(1)
    fireEvent.click(screen.getAllByRole('button', { name: /SUPERSET — TAP TO UNLINK/ })[0])
    // inc is free again; lat and plank are still one superset.
    expect(screen.getByRole('button', { name: 'Link Incline Press with the exercise below' })).toBeTruthy()
    click('Unlink superset A')
    expect(screen.queryByText('SUPERSET A')).toBeNull()
    await save()
    const ops = sent()
    const members = updates(ops, 'v2_program_exercises')
    expect(members.map((o) => [o.id, (o.patch as { superset_block_id: string | null }).superset_block_id]).sort()).toEqual([['pe-lat', null], ['pe-plank', null]])
  })

  it('the warmup routine: add, edit in place, move and remove (with its confirm) reach the routine rows', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('+ ADD ITEM')
    fireEvent.change(screen.getByLabelText('New warmup item'), { target: { value: 'Dead hang, 30 s' } })
    click('ADD')
    click('Edit Band pull-aparts')
    fireEvent.change(screen.getByLabelText('Warmup item'), { target: { value: 'Band pull-aparts, 2 × 15' } })
    fireEvent.keyDown(screen.getByLabelText('Warmup item'), { key: 'Enter' })
    expect(screen.getByText('2 × 15')).toBeTruthy()
    click('Dead hang, 30 s: options')
    click('MOVE UP')
    click('REMOVE')
    expect(screen.getByText('Remove this item?')).toBeTruthy()
    expect(screen.getByText('"Dead hang, 30 s" leaves the routine for every week. This can\'t be undone.')).toBeTruthy()
    inConfirm('Remove this item?', 'CANCEL')
    expect(screen.getByText('Dead hang')).toBeTruthy()
    click('Dead hang, 30 s: options')
    click('REMOVE')
    inConfirm('Remove this item?', 'REMOVE')
    await save()
    const ops = sent()
    const routine = ops.filter((o) => o.table === 'v2_workout_warmup_items')
    expect(routine.map((o) => o.op)).toContain('update')
    const rows = world.db.v2_workout_warmup_items.filter((r) => r.workout_day_id === 'pull')
    expect(rows.map((r) => r.body)).toEqual(['Band pull-aparts, 2 × 15'])
  })

  it('a rename sends the workout’s new name, trimmed, and nothing else', async () => {
    await open()
    chooseWorkout(/^Legs/)
    click('Rename Legs')
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: '  Leg Day  ' } })
    fireEvent.keyDown(screen.getByLabelText('Workout name'), { key: 'Enter' })
    await save()
    expect(sent()).toEqual([{ op: 'update', table: 'v2_workout_days', id: 'legs', patch: { name: 'Leg Day' } }])
  })
})

// ─── CANCEL ──────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('CANCEL leaves nothing behind', () => {
  it('with no change it goes straight back and sends nothing', async () => {
    await open()
    click('CANCEL')
    expect(screen.getByText('AT PLAN')).toBeTruthy()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('with a change it asks, DISCARD goes back, and nothing is sent', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('Remove Face Pull')
    click('REMOVE')
    click('CANCEL')
    expect(screen.getByText('Discard your changes?')).toBeTruthy()
    click('DISCARD')
    expect(screen.getByText('AT PLAN')).toBeTruthy()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('the confirm’s own CANCEL keeps the draft', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('Remove Face Pull')
    click('REMOVE')
    click('CANCEL')
    inConfirm('Discard your changes?', 'CANCEL') // the dialog's own: stay
    expect(screen.queryByText('AT PLAN')).toBeNull()
    expect(screen.getByText('REMOVED FROM WEEK 2')).toBeTruthy()
  })

  it('the back arrow is the same as CANCEL', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('Remove Face Pull')
    click('REMOVE')
    click('Back to Plan')
    expect(screen.getByText('Discard your changes?')).toBeTruthy()
  })

  it('a change made and put back is no change', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('Remove Face Pull')
    click('REMOVE')
    click('Undo removing Face Pull')
    click('CANCEL')
    expect(screen.getByText('AT PLAN')).toBeTruthy()
  })

  it('opened with no history it goes to Plan', async () => {
    await open(['/plan/change'])
    click('CANCEL')
    expect(screen.getByText('AT PLAN')).toBeTruthy()
  })
})

// ─── SAVE: pending, failing, a retry ─────────────────────────────────────────────────────────────────────────────────

describe('SAVE', () => {
  it('says SAVING… while the request is out, once, and goes back when it lands', async () => {
    let release: (v: { data: number; error: null }) => void = () => undefined
    h.rpc.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    await open()
    chooseWorkout(/^Legs/)
    click('Rename Legs')
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Leg Day' } })
    click('DONE')
    click('SAVE CHANGES')
    await screen.findByRole('button', { name: 'SAVING…' })
    expect((screen.getByRole('button', { name: 'SAVING…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'SAVING…' }))
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1))
    await act(async () => release({ data: 1, error: null }))
    await screen.findByText('AT PLAN')
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })

  it('a failed save shows the server’s message under "Couldn\'t save the changes." and keeps the draft; a retry builds a new list from a new read', async () => {
    h.rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'row not found: v2_week_plan_sets/zz' } }))
    await open()
    chooseWorkout(/^Pull/)
    click('Remove Face Pull')
    click('REMOVE')
    click('SAVE CHANGES')
    await screen.findByText("Couldn't save the changes.")
    expect(screen.getByText('row not found: v2_week_plan_sets/zz')).toBeTruthy()
    expect(screen.queryByText('AT PLAN')).toBeNull()
    // The draft is kept.
    expect(screen.getByText('REMOVED FROM WEEK 2')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'SAVE CHANGES' }) as HTMLButtonElement).disabled).toBe(false)
    expect(h.fetchSource).toHaveBeenCalledTimes(2) // opened, saved
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(h.rpc).toHaveBeenCalledTimes(2)
    expect(h.fetchSource).toHaveBeenCalledTimes(3) // and read again for the retry
  })

  it('an error with no message says so plainly (SPEC Errors (15))', async () => {
    h.rpc.mockImplementationOnce(async () => ({ data: null, error: {} }))
    await open()
    click('Rename Push')
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Push A' } })
    click('DONE')
    click('SAVE CHANGES')
    await screen.findByText("Couldn't save the changes.")
    expect(screen.getByText('Something went wrong.')).toBeTruthy()
  })

  it('reads the sessions again: one that started after the screen opened is left as it is', async () => {
    await open()
    chooseWorkout(/^Legs/)
    click('Swap Back Squat')
    await pickInSheet('Swap Back Squat', 'Swap to Leg Press')
    // Between opening and saving the user started Thursday's session on another phone.
    statuses = { ...statuses, 'p2-legs': 'in_progress' }
    await save()
    const ops = sent()
    const sessionRows = ops.filter((o) => o.table === 'v2_week_plan_exercises' || o.table === 'v2_week_plan_sets')
    expect(sessionRows.length).toBeGreaterThan(0)
    expect(sessionRows.every((o) => (o.op === 'insert' ? o.row.week_plan_id !== 'p2-legs' : !String(o.id).startsWith('p2-legs')))).toBe(true)
    expect(world.db.v2_week_plan_exercises.filter((r) => r.week_plan_id === 'p2-legs').map((r) => r.program_exercise_id)).toEqual(['pe-squat'])
    expect(world.db.v2_week_plan_exercises.filter((r) => r.week_plan_id === 'p3-legs').map((r) => r.program_exercise_id)).not.toContain('pe-squat')
  })

  it('refuses to write over a run copy that changed since the screen opened, and sends nothing', async () => {
    await open()
    chooseWorkout(/^Legs/)
    click('Rename Legs')
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Leg Day' } })
    click('DONE')
    // Another phone gave Lat Pulldown a rest in the meantime.
    const copy = { ...world, db: { ...world.db, v2_program_exercises: world.db.v2_program_exercises.map((r) => (r.id === 'pe-pd' ? { ...r, rest_seconds: 150 } : r)) } }
    world = copy
    click('SAVE CHANGES')
    await screen.findByText("Couldn't save the changes.")
    expect(screen.getByText('The program changed since you opened this screen. Go back and open it again to see it.')).toBeTruthy()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('writes the weekdays the run copy has now, not the ones the screen opened with', async () => {
    await open()
    chooseWorkout(/^Legs/)
    click('Rename Legs')
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Leg Day' } })
    click('DONE')
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(sent().some((o) => o.table === 'v2_programs' || o.table === 'v2_run_schedules')).toBe(false)
  })

  it('invalidates what its list touched: the run copy and the week plans', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    await open()
    chooseWorkout(/^Legs/)
    click('Swap Back Squat')
    await pickInSheet('Swap Back Squat', 'Swap to Leg Press')
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey))
    for (const k of ['v2_programExercises', 'v2_programSets', 'v2_weekPlans', 'v2_allWeekPlans', 'v2_weekPlan']) expect(keys).toContain(JSON.stringify([k]))
    expect(keys).not.toContain(JSON.stringify(['v2_runSchedules']))
  })

  it('a rename invalidates the workouts and programs, a routine edit its own rows', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    await open()
    chooseWorkout(/^Legs/)
    click('Rename Legs')
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Leg Day' } })
    click('DONE')
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey))
    expect(keys).toContain(JSON.stringify(['v2_workoutDays']))
    expect(keys).toContain(JSON.stringify(['v2_programs']))
    expect(keys).not.toContain(JSON.stringify(['v2_weekPlans']))
  })

  it('SAVE with nothing to save sends no request', async () => {
    await open()
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

// ─── The rule box and what the screen says ───────────────────────────────────────────────────────────────────────────

describe('the rule box (SPEC: "Week N is the week of the next session that isn’t done")', () => {
  it('names the first session that has not started, and which sessions keep their plan', async () => {
    await open()
    expect(screen.getByText('Changes start in week 2. Sets are planned in each week, in Plan.')).toBeTruthy()
    expect(
      screen.getByText("Monday's Push is done, so it keeps its plan. Tuesday's Pull is in progress, so it stays as it is. Your saved program, Push Pull Legs, doesn't change."),
    ).toBeTruthy()
  })

  it('with this week all done or started, it is next week (the fixture tells the week plans from the run copy)', async () => {
    useWorld(weekDependentWorld(), { 'p2-push': 'done', 'p2-pull': 'done', 'p2-legs': 'in_progress' })
    await open()
    expect(screen.getByText('Changes start in week 3. Sets are planned in each week, in Plan.')).toBeTruthy()
  })

  it('a stable run says "Every week from then on copies this."', async () => {
    useWorld(stableWorld(), { 'p2-fb': 'done' })
    await open()
    expect(screen.getByText('Changes start in week 2. Every week from then on copies this.')).toBeTruthy()
    // 51a draws a stable run without set rows and without the "no sets" note.
    expect(screen.queryByText(/with no sets/)).toBeNull()
    expect(screen.queryByText('+ SET')).toBeNull()
  })

  it('a sequence run speaks of cycles', async () => {
    const w = weekDependentWorld()
    w.scheduleType = 'sequence'
    w.db.v2_programs[0].schedule_type = 'sequence'
    useWorld(w, {})
    h.cycle = 2
    await open()
    expect(screen.getByText('Changes start in cycle 2. Sets are planned in each cycle, in Plan.')).toBeTruthy()
    expect(screen.getByText('EVERY CYCLE')).toBeTruthy()
    expect(screen.queryByText('MON')).toBeNull()
    chooseWorkout(/^Pull/)
    click('Remove Face Pull')
    expect(screen.getByText('Remove Face Pull from cycle 2?')).toBeTruthy()
  })

  it('the eyebrow names the run and its planning type, the WORKOUTS chips the days in force', async () => {
    await open()
    expect(screen.getByText('PUSH PULL LEGS · WEEK-DEPENDENT')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^PushMON$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^PullTUE$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^LegsTHU$/ })).toBeTruthy()
    expect(screen.getByText('CHANGED IN THIS EDIT')).toBeTruthy()
  })
})

// ─── The exercise picker ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the exercise picker (PL4-PL6)', () => {
  it('the add sheet leaves out the exercises already in the workout, and lists ones from other workouts', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('+ ADD EXERCISE')
    const sheet = await screen.findByRole('dialog', { name: 'Add exercise' })
    await within(sheet).findByRole('button', { name: 'Add Cable Curl' })
    expect(within(sheet).queryByRole('button', { name: 'Add Lat Pulldown' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Add Face Pull' })).toBeNull()
    expect(within(sheet).getByRole('button', { name: 'Add Bench Press' })).toBeTruthy()
    expect(within(sheet).getByText('PULL · FROM WEEK 2')).toBeTruthy()
  })

  it('the swap sheet never lists the exercise it replaces or the others in the workout, and a tap swaps at once', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('Swap Lat Pulldown')
    const sheet = await screen.findByRole('dialog', { name: 'Swap Lat Pulldown' })
    await within(sheet).findByRole('button', { name: 'Swap to Machine Pulldown' })
    expect(within(sheet).queryByRole('button', { name: 'Swap to Lat Pulldown' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: 'Swap to Face Pull' })).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Swap to Machine Pulldown' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Swap Lat Pulldown' })).toBeNull())
    expect(screen.getByText('Machine Pulldown')).toBeTruthy()
  })

  it('an exercise added and then removed again is simply gone: nothing struck through, nothing sent', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('+ ADD EXERCISE')
    await pickInSheet('Add exercise', 'Add Cable Curl')
    click('Remove Cable Curl')
    click('REMOVE')
    expect(screen.queryByText('REMOVED FROM WEEK 2')).toBeNull()
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

// ─── Order: drag, and the ⋯ fallback ─────────────────────────────────────────────────────────────────────────────────

function stubRects() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const i = this.dataset?.unitIndex
    return i === undefined ? ({ top: 0, height: 0, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect) : ({ top: Number(i) * 100, height: 80, bottom: Number(i) * 100 + 80, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
  })
}

const pointer = (type: string, clientY: number) => new MouseEvent(type, { bubbles: true, button: 0, clientY })
const names = () => Array.from(document.querySelectorAll('[data-unit-key]')).map((n) => (n as HTMLElement).dataset.unitKey)

describe('order (W)', () => {
  beforeEach(() => {
    useWorld(stableWorld(), {})
    stubRects()
  })

  it('dragging an exercise by its grip moves it where it is let go, and SAVE sends the new positions', async () => {
    await open()
    // Full Body: Leg Press, Incline Press, [Seated Cable Row, Plank]
    expect(names()).toEqual(['e:pe-leg', 'e:pe-inc', 'e:pe-lat'])
    const grip = screen.getByRole('button', { name: 'Reorder Leg Press' })
    await act(async () => {
      grip.dispatchEvent(pointer('pointerdown', 40))
      window.dispatchEvent(pointer('pointermove', 150))
      window.dispatchEvent(pointer('pointermove', 250))
      window.dispatchEvent(pointer('pointerup', 250))
    })
    expect(names()).toEqual(['e:pe-inc', 'e:pe-lat', 'e:pe-leg'])
    await save()
    const moved = updates(sent(), 'v2_program_exercises').map((o) => [o.id, (o.patch as { position: number }).position]).sort()
    expect(moved).toEqual([['pe-inc', 0], ['pe-lat', 1], ['pe-leg', 3], ['pe-plank', 2]])
  })

  it('a superset is dragged as one block', async () => {
    await open()
    const grip = screen.getByRole('button', { name: 'Reorder superset A' })
    await act(async () => {
      grip.dispatchEvent(pointer('pointerdown', 240))
      window.dispatchEvent(pointer('pointermove', 100))
      window.dispatchEvent(pointer('pointermove', -50))
      window.dispatchEvent(pointer('pointerup', -50))
    })
    expect(names()).toEqual(['e:pe-lat', 'e:pe-leg', 'e:pe-inc'])
    await save()
    const moved = updates(sent(), 'v2_program_exercises').map((o) => [o.id, (o.patch as { position: number }).position]).sort()
    expect(moved).toEqual([['pe-inc', 3], ['pe-lat', 0], ['pe-leg', 2], ['pe-plank', 1]])
  })

  it('a drag that ends where it began changes nothing', async () => {
    await open()
    const grip = screen.getByRole('button', { name: 'Reorder Incline Press' })
    await act(async () => {
      grip.dispatchEvent(pointer('pointerdown', 140))
      window.dispatchEvent(pointer('pointermove', 160))
      window.dispatchEvent(pointer('pointerup', 160))
    })
    expect(names()).toEqual(['e:pe-leg', 'e:pe-inc', 'e:pe-lat'])
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('a cancelled drag (the pointer is taken away) changes nothing', async () => {
    await open()
    const grip = screen.getByRole('button', { name: 'Reorder Leg Press' })
    await act(async () => {
      grip.dispatchEvent(pointer('pointerdown', 40))
      window.dispatchEvent(pointer('pointermove', 250))
      window.dispatchEvent(pointer('pointercancel', 250))
    })
    expect(names()).toEqual(['e:pe-leg', 'e:pe-inc', 'e:pe-lat'])
  })

  it('MOVE UP / MOVE DOWN in the exercise’s ⋯ do the same, a place at a time, a superset as a block', async () => {
    await open()
    click('Incline Press: rest, tempo, unit')
    let sheet = dialog('Incline Press')
    fireEvent.click(within(sheet).getByRole('button', { name: 'MOVE DOWN' }))
    expect(names()).toEqual(['e:pe-leg', 'e:pe-lat', 'e:pe-inc'])
    expect((within(sheet).getByRole('button', { name: 'MOVE DOWN' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(sheet).getByRole('button', { name: 'MOVE UP' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'MOVE UP' }))
    expect(names()).toEqual(['e:pe-inc', 'e:pe-leg', 'e:pe-lat'])
    expect((within(sheet).getByRole('button', { name: 'MOVE UP' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    // A member's ⋯ moves the whole superset.
    click('Seated Cable Row: rest, tempo, unit')
    sheet = dialog('Seated Cable Row')
    fireEvent.click(within(sheet).getByRole('button', { name: 'MOVE UP' }))
    expect(names()).toEqual(['e:pe-inc', 'e:pe-lat', 'e:pe-leg'])
    await save()
    const moved = updates(sent(), 'v2_program_exercises').map((o) => [o.id, (o.patch as { position: number }).position]).sort()
    expect(moved).toEqual([['pe-inc', 0], ['pe-lat', 1], ['pe-leg', 3], ['pe-plank', 2]])
  })

  it('the grip answers the arrow keys too', async () => {
    await open()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Incline Press' }), { key: 'ArrowUp' })
    expect(names()).toEqual(['e:pe-inc', 'e:pe-leg', 'e:pe-lat'])
  })
})

// ─── Captured for the 390 px screenshots (design/1.2/built) ──────────────────────────────────────────────────────────

describe('draws boards PL1, PL2, PL3, PL7, PL8 and PL9', () => {
  it('PL1: the screen with a new exercise, a changed marker, a removed one and a superset', async () => {
    useWorld(stableWorld(), {})
    const { container } = await open()
    click('Link Incline Press with the exercise below')
    click('Remove Leg Press')
    click('REMOVE')
    click('+ ADD EXERCISE')
    await pickInSheet('Add exercise', 'Add Cable Curl')
    click('Cable Curl: rest, tempo, unit')
    fireEvent.change(within(dialog('Cable Curl')).getByLabelText('Tempo'), { target: { value: '3-0-1-0' } })
    fireEvent.click(within(dialog('Cable Curl')).getByRole('button', { name: 'Close' }))
    captureRender('change-program-page', container)
  })

  it('PL2 and PL3: the sheets', async () => {
    useWorld(stableWorld(), {})
    await open()
    click('Incline Press: rest, tempo, unit')
    captureRender('change-program-exercise-sheet', document.body)
    fireEvent.click(within(dialog('Incline Press')).getByRole('button', { name: 'Close' }))
    click('Seated Cable Row: rest, tempo, unit')
    captureRender('change-program-member-sheet', document.body)
  })

  it('PL7 and PL8: the confirms', async () => {
    await open()
    chooseWorkout(/^Pull/)
    click('Remove Lat Pulldown')
    captureRender('change-program-remove-confirm', document.body)
    inConfirm('Remove Lat Pulldown from week 2?', 'CANCEL')
    click('Band pull-aparts: options')
    click('REMOVE')
    captureRender('change-program-remove-warmup-confirm', document.body)
  })
})
