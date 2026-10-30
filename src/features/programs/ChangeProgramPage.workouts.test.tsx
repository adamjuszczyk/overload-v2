// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { queryClient } from '../../lib/queryClient'
import { pickTempo } from '../../components/pickers/tempoPicker.testutil'
import { useSettingsStore } from '../settings/settingsStore'
import type { Exercise, MuscleGroup, Mesocycle, PlanningType, Program, ScheduleType } from '../../types'
import {
  NOW,
  addExerciseTo,
  applyOpsToDb,
  editExercises,
  editWorkout,
  inputOf,
  patchExercise,
  removeExerciseFrom,
  runCopyOf,
  scheduleRowsOf,
  sessionsOf,
  swapExerciseIn,
  type World,
} from './programChange.testutil'
import { UNEVEN_WORKOUTS, unevenWorkoutsWorld, type UnevenWorkout } from './programChange.worlds.testutil'
import { draftFromRunCopy, planProgramChange, type Op, type ProgramEdit, type RunChangeStatus } from './programChange'
import type { ChangeProgramSource } from './changeProgramService'

// DECISIONS 176 (a tests-only follow-up; Adam, 2026-10-19: "yes, queue those tests as one builder run"): chunk 51a's exercise-level
// writers on CHANGE THE PROGRAM were only ever pressed on the first workout, or on one the tests happened to choose, so a handler that
// wrote to the first workout (or to any one workout, the same each time) instead of the one shown passed every test. Here every writer is pressed on
// each of FOUR workouts, the first, two in the middle and the last (RULES.md, chunk 51b's review: a writer that takes an item's place
// and a selected workout is tested on an item that isn't the last, in a workout that isn't the first), in a world where no two workouts are
// alike (`UNEVEN_WORKOUTS`: how many exercises, where the superset is and how big, how long the routine is, and no two exercises with
// the same rest, rest after, tempo and unit), so a write that lands on another workout, another exercise or another place is a
// different list of ops.
//
// The screen runs as it does in the app (the real hooks, the real exercise picker, the real `planProgramChange` and `applyOps`); what
// is mocked is the edge, as in the 51a test: the reads, the exercise library and the one request SAVE makes. A test that saves holds the
// list that request carried against the list `planProgramChange` makes for the same edit written by hand on chunk 45's draft with plain
// array operations (never with the screen's own draft functions), then reads the run copy's rows that chunk 45's stand-in for
// migration 043 left, so a list that reads right and runs wrong fails too. The orders after each press are written out as literals.

// Each test presses and saves through the real screen: on a slow machine (CI's two CPUs) the heaviest takes seconds, so the file's timeout is
// far above Vitest's 5 s, and a timeout can't be read as a caught break.
vi.setConfig({ testTimeout: 30000 })

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

const GROUP_OF: Record<string, MuscleGroup> = {
  'ex-bench': 'chest',
  'ex-ohp': 'shoulders',
  'ex-lateral': 'shoulders',
  'ex-pushdown': 'triceps',
  'ex-row': 'back',
  'ex-pd': 'back',
  'ex-face': 'shoulders',
  'ex-bcurl': 'biceps',
  'ex-shrug': 'back',
  'ex-squat': 'quads',
  'ex-rdl': 'hamstrings',
  'ex-lcurl': 'hamstrings',
  'ex-calf': 'calves',
  'ex-curl': 'biceps',
  'ex-hammer': 'biceps',
  'ex-dip': 'triceps',
  'ex-skull': 'triceps',
  'ex-wrist': 'forearms',
}

// The library: every exercise the four workouts hold, and six more to add and to swap to (none is in any workout). A swap's picker opens on
// the muscle group of the exercise it replaces, so a swap's new exercise is of that group.
const EXERCISES: Exercise[] = [
  ...UNEVEN_WORKOUTS.flatMap((wk) => wk.exercises.map((x) => ex(x.exerciseId, x.name, GROUP_OF[x.exerciseId]))),
  ex('ex-plank', 'Plank', 'core'),
  ex('ex-fly', 'Cable Fly', 'chest'),
  ex('ex-srow', 'Seated Row', 'back'),
  ex('ex-lpress', 'Leg Press', 'quads'),
  ex('ex-gm', 'Good Morning', 'hamstrings'),
  ex('ex-crunch', 'Cable Crunch', 'core'),
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

function useWorld(w: World, st: Record<string, RunChangeStatus> = {}) {
  world = w
  statuses = st
  h.meso = { id: 'meso', userId: 'u-test', name: 'Four Day', programId: 'prog', status: 'active', startDate, endDate: null, createdAt: '', sourceProgramId: 'saved' }
  const base = { userId: 'u-test', workoutDays: [], createdAt: '', updatedAt: '' }
  h.programs = [
    { ...base, id: 'prog', name: 'Four Day (run)', schedule: w.db.v2_programs[0].schedule as Program['schedule'], kind: 'run', planningType: w.planningType, scheduleType: w.scheduleType },
    { ...base, id: 'saved', name: 'Four Day', schedule: {} as Program['schedule'], kind: 'saved', planningType: w.planningType, scheduleType: w.scheduleType },
  ]
}

// The world of the describe block that is running: its planning and schedule type.
let planning: PlanningType = 'week_dependent'
let schedule: ScheduleType = 'weekday'
const freshWorld = () => useWorld(unevenWorkoutsWorld(planning, schedule))

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
  planning = 'week_dependent'
  schedule = 'weekday'
  freshWorld()
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

async function open() {
  const view = mount()
  await screen.findByRole('heading', { name: 'CHANGE THE PROGRAM' })
  return view
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const dialog = (name: string | RegExp) => screen.getByRole('dialog', { name })
const closeDialog = (name: string | RegExp) => fireEvent.click(within(dialog(name)).getByRole('button', { name: 'Close' }))

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

// A button of a confirm (ConfirmDialog is a plain overlay with no role): found by its title, because CANCEL is also the page's own.
function inConfirm(title: string, label: string) {
  fireEvent.click(within(screen.getByText(title).parentElement!).getByRole('button', { name: label }))
}

async function pickInSheet(title: string, rowName: string) {
  const sheet = await screen.findByRole('dialog', { name: title })
  fireEvent.click(await within(sheet).findByRole('button', { name: rowName }))
}

// The list `planProgramChange` makes for an edit written by hand on chunk 45's draft, from the same world, statuses and ids the screen draws.
type Edit = ProgramEdit
function expectedFor(before: World, edit: (e: Edit) => Edit): Op[] {
  let n = 0
  const input = inputOf(before, edit(draftFromRunCopy(runCopyOf(before.db, before.programId, before.mesocycleId), before.planningType)), {
    statuses,
    newId: () => `id-${++n}`,
  })
  return planProgramChange(input).ops
}

// ─── What the screen shows, and what the rows say ────────────────────────────────────────────────────────────────────────

// The WORKOUTS chips are the buttons that carry `aria-current`; a chip is found by the workout's name alone (a routine item or an exercise
// can start with the same letters: "Push-up plus").
const chips = (): HTMLElement[] => screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-current'))
const chipNamed = (name: string): HTMLElement => {
  const found = chips().find((b) => b.querySelector('span')?.textContent === name)
  if (!found) throw new Error(`no chip named ${name}`)
  return found
}
const goToName = (name: string) => fireEvent.click(chipNamed(name))
const goTo = (wk: UnevenWorkout) => goToName(wk.name)
const isShown = (wk: UnevenWorkout) => chipNamed(wk.name).getAttribute('aria-current') === 'true'
// The cards of the shown workout, top to bottom: the exercise's row id (a new exercise has the draft's own key).
const cardKeys = (): string[] => Array.from(document.querySelectorAll('[data-exercise-key]')).map((n) => (n as HTMLElement).dataset.exerciseKey!.replace(/^e:/, ''))
const cardNames = (): string[] => screen.queryAllByRole('button', { name: /: rest, tempo, unit$/ }).map((b) => (b.getAttribute('aria-label') ?? '').replace(': rest, tempo, unit', ''))
const routineBodies = (): string[] => screen.queryAllByRole('button', { name: /^Edit / }).map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Edit /, ''))
const nameOf = (wk: UnevenWorkout, row: string): string => wk.exercises.find((x) => x.row === row)!.name
const rowsOf = (wk: UnevenWorkout): string[] => wk.exercises.map((x) => x.row)
const namesOf = (wk: UnevenWorkout, rows: readonly string[]): string[] => rows.map((r) => nameOf(wk, r))
const blockHeaders = (): string[] => screen.queryAllByText(/^SUPERSET [A-Z]$/).map((n) => n.textContent ?? '')

// A workout's rows as the run copy holds them, in order: what is on each, and which group of superset members it is in. Two views of the
// same thing: the rows the stand-in left (`shapeOfDb`) and the edit that was meant (`shapeOfEdit`, which looks a kept exercise up in the
// rows the screen opened with).
interface ShapedExercise {
  exerciseId: string
  rest: number | null
  restAfter: number | null
  tempo: string | null
  unit: string | null
  group: string | null
}
interface ShapedWorkout {
  id: string
  name: string
  exercises: ShapedExercise[]
  routine: string[]
}
// A block is told by the places of its first and last member and its two rests, so the same group has the same tag whatever id it holds.
function groupTags(blockOf: (string | null)[], rests: Map<string, [number | null, number | null]>): (string | null)[] {
  return blockOf.map((b) => (b === null ? null : `places ${blockOf.indexOf(b)}-${blockOf.lastIndexOf(b)}, rests ${rests.get(b)?.join('/')}`))
}
function shapeOfDb(w: World): ShapedWorkout[] {
  const rests = new Map<string, [number | null, number | null]>(w.db.v2_program_superset_blocks.map((b) => [b.id, [b.rest_within_round_seconds, b.rest_after_round_seconds]]))
  return [...w.db.v2_workout_days]
    .sort((a, b) => a.position - b.position)
    .map((day) => {
      const live = w.db.v2_program_exercises.filter((r) => r.workout_day_id === day.id && !r.week_only && !r.removed_at).sort((a, b) => a.position - b.position)
      const tags = groupTags(live.map((r) => r.superset_block_id), rests)
      return {
        id: day.id,
        name: day.name,
        exercises: live.map((r, i) => ({ exerciseId: r.exercise_id, rest: r.rest_seconds, restAfter: r.rest_after_seconds, tempo: r.tempo, unit: r.weight_unit, group: tags[i] })),
        routine: w.db.v2_workout_warmup_items.filter((r) => r.workout_day_id === day.id).sort((a, b) => a.position - b.position).map((r) => r.body),
      }
    })
}
function shapeOfEdit(before: World, e: Edit): ShapedWorkout[] {
  const rests = new Map<string, [number | null, number | null]>(e.blocks.map((b) => [b.id, [b.restWithinRoundSeconds, b.restAfterRoundSeconds]]))
  return e.workouts.map((day) => {
    const tags = groupTags(day.exercises.map((x) => x.supersetBlockId), rests)
    return {
      id: day.id,
      name: day.name,
      exercises: day.exercises.map((x, i) => ({
        exerciseId: x.kind === 'kept' ? before.db.v2_program_exercises.find((r) => r.id === x.id)!.exercise_id : x.exerciseId,
        rest: x.restSeconds,
        restAfter: x.restAfterSeconds,
        tempo: x.tempo,
        unit: x.weightUnit,
        group: tags[i],
      })),
      routine: day.routine.map((r) => r.body),
    }
  })
}
const draftOf = (w: World): Edit => draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)

// SAVE, and then: the list sent is the one the planner makes for the intended edit, and the rows left read back as that edit.
async function saveAndExpect(before: World, edit: (e: Edit) => Edit) {
  await save()
  expect(sent()).toEqual(expectedFor(before, edit))
  expect(shapeOfDb(world)).toEqual(shapeOfEdit(before, edit(draftOf(before))))
}

// Plain edits on chunk 45's draft, written the way a test writes them: by the row ids of the world.
const reorderTo = (e: Edit, wkId: string, rows: readonly string[]): Edit =>
  editExercises(e, wkId, (list) => rows.map((r) => list.find((x) => x.kind === 'kept' && x.id === r)!))
const withBlock = (e: Edit, wkId: string, rows: readonly string[], block: string | null): Edit => rows.reduce((acc, r) => patchExercise(acc, wkId, r, { supersetBlockId: block }), e)
const NEW_BLOCK = 'a-new-block'
const withNewBlock = (e: Edit, wkId: string, rows: readonly string[]): Edit =>
  withBlock({ ...e, blocks: [...e.blocks, { id: NEW_BLOCK, restWithinRoundSeconds: null, restAfterRoundSeconds: null }] }, wkId, rows, NEW_BLOCK)
const routineOf = (wk: UnevenWorkout, items: ReadonlyArray<number | string | readonly [number, string]>): Array<{ id: string | null; body: string }> =>
  items.map((it) => (typeof it === 'number' ? { id: `${wk.id}-r${it + 1}`, body: wk.routine[it] } : typeof it === 'string' ? { id: null, body: it } : { id: `${wk.id}-r${it[0] + 1}`, body: it[1] }))
const withRoutine = (e: Edit, wkId: string, items: Array<{ id: string | null; body: string }>): Edit => editWorkout(e, wkId, (w) => ({ ...w, routine: items }))

// ─── The world, as the screen draws it ────────────────────────────────────────────────────────────────────────────────────

const AFTER_ROUND_LINE: Record<string, string | null> = { push: 'Rest 1:30 after each round', pull: 'Rest 2:00 after each round', legs: null, arms: 'Rest 1:00 after each round' }

describe('the world: four workouts, no two alike', () => {
  it('the chips, and for each workout its cards in order, its superset, its routine', async () => {
    await open()
    expect(chips().map((b) => b.textContent)).toEqual(['PushMON', 'PullTUE', 'LegsTHU', 'ArmsSAT'])
    // the screen opens on the first workout
    expect(chips().map((b) => b.getAttribute('aria-current'))).toEqual(['true', 'false', 'false', 'false'])
    expect(cardKeys()).toEqual(rowsOf(UNEVEN_WORKOUTS[0]))
    for (const wk of UNEVEN_WORKOUTS) {
      goTo(wk)
      expect(isShown(wk)).toBe(true)
      expect(cardKeys()).toEqual(rowsOf(wk))
      expect(cardNames()).toEqual(wk.exercises.map((x) => x.name))
      expect(routineBodies()).toEqual([...wk.routine])
      expect(blockHeaders()).toEqual(['SUPERSET A'])
      // the header says its own block's rest after each round, or nothing when the block has none
      const rest = screen.queryByText(/ after each round$/)
      expect(rest ? rest.textContent : null).toBe(AFTER_ROUND_LINE[wk.id])
    }
    // no two workouts alike in how much they hold: 4 exercises and 3 items, 5 and 2, 4 and 4, 5 and 3
    expect(UNEVEN_WORKOUTS.map((wk) => [wk.exercises.length, wk.routine.length])).toEqual([[4, 3], [5, 2], [4, 4], [5, 3]])
    // and no two exercises alike in what an exercise edit writes
    const columns = UNEVEN_WORKOUTS.flatMap((wk) => wk.exercises.map((x) => JSON.stringify([x.rest, x.restAfter, x.tempo, x.unit])))
    expect(new Set(columns).size).toBe(columns.length)
  })
})

// ─── ADD, SWAP and REMOVE, on a week-dependent run and on a stable one ─────────────────────────────────────────────────────────

describe.each([
  ['a week-dependent run', 'week_dependent'],
  ['a stable run', 'stable'],
] as const)('%s: ADD, SWAP and REMOVE land on the workout shown', (_label, type) => {
  beforeEach(() => {
    planning = type
    freshWorld()
  })

  it.each(UNEVEN_WORKOUTS)('ADD in $name: the exercise goes to the end of this workout and to no other, and the picker is this workout’s', async (wk) => {
    await open()
    const before = world
    goTo(wk)
    click('+ ADD EXERCISE')
    const sheet = await screen.findByRole('dialog', { name: 'Add exercise' })
    await within(sheet).findByRole('button', { name: 'Add Plank' })
    // the eyebrow names this workout; the picker offers no exercise the workout has, and does offer the others' exercises
    expect(within(sheet).getByText(`${wk.name.toUpperCase()} · FROM WEEK 2`)).toBeTruthy()
    for (const x of wk.exercises) expect(within(sheet).queryByRole('button', { name: `Add ${x.name}` })).toBeNull()
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) expect(within(sheet).getByRole('button', { name: `Add ${other.exercises[0].name}` })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add Plank' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(cardNames()).toEqual([...wk.exercises.map((x) => x.name), 'Plank'])
    expect(screen.getByText('CORE · NEW')).toBeTruthy()
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) {
      goTo(other)
      expect(cardNames()).toEqual(other.exercises.map((x) => x.name))
    }
    await saveAndExpect(before, (e) => addExerciseTo(e, wk.id, { exerciseId: 'ex-plank', weightUnit: 'kg' }))
    // the new row is in this workout, last, and in the sessions of this workout alone
    const created = sent().filter((o) => o.op === 'insert' && o.table === 'v2_program_exercises')
    expect(created.map((o) => (o.op === 'insert' ? (o.row as { workout_day_id: string }).workout_day_id : ''))).toEqual([wk.id])
  })

  // The exercise swapped is the second one or the one before the last: neither the first nor the last of its workout. The picker opens on
  // its muscle group, so `same` are the other exercises of that group the workout holds (never offered) and `to` one of another workout or
  // of the library (offered).
  const SWAPS: Record<string, { row: string; to: string; toName: string; same: string[] }> = {
    push: { row: 'pe-ohp', to: 'ex-face', toName: 'Face Pull', same: ['pe-lateral'] },
    pull: { row: 'pe-pd', to: 'ex-srow', toName: 'Seated Row', same: ['pe-row', 'pe-shrug'] },
    legs: { row: 'pe-rdl', to: 'ex-gm', toName: 'Good Morning', same: ['pe-lcurl'] },
    arms: { row: 'pe-dip', to: 'ex-pushdown', toName: 'Triceps Pushdown', same: ['pe-skull'] },
  }
  it.each(UNEVEN_WORKOUTS)('SWAP in $name: the exercise swapped is the one pressed, in its place, and the picker is this workout’s', async (wk) => {
    const { row, to, toName, same } = SWAPS[wk.id]
    const name = nameOf(wk, row)
    await open()
    const before = world
    goTo(wk)
    click(`Swap ${name}`)
    const sheet = await screen.findByRole('dialog', { name: `Swap ${name}` })
    await within(sheet).findByRole('button', { name: `Swap to ${toName}` })
    expect(within(sheet).getByText(`${wk.name.toUpperCase()} · FROM WEEK 2`)).toBeTruthy()
    // never the exercise it replaces nor any other of this workout's
    expect(within(sheet).queryByRole('button', { name: `Swap to ${name}` })).toBeNull()
    for (const r of same) expect(within(sheet).queryByRole('button', { name: `Swap to ${nameOf(wk, r)}` })).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: `Swap to ${toName}` }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // in the same place, tagged, and the other workouts as they were
    expect(cardNames()).toEqual(wk.exercises.map((x) => (x.row === row ? toName : x.name)))
    expect(screen.getAllByText(/ · SWAPPED$/)).toHaveLength(1)
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) {
      goTo(other)
      expect(cardNames()).toEqual(other.exercises.map((x) => x.name))
    }
    await saveAndExpect(before, (e) => swapExerciseIn(e, wk.id, row, to))
    const made = sent().filter((o) => o.op === 'insert' && o.table === 'v2_program_exercises')
    expect(made.map((o) => (o.op === 'insert' ? (o.row as { workout_day_id: string; replaces_program_exercise_id: string }).workout_day_id : ''))).toEqual([wk.id])
  })

  // REMOVE: the second exercise of each workout.
  it.each(UNEVEN_WORKOUTS)('REMOVE in $name: the exercise pressed is struck through here and nowhere else, and SAVE removes it', async (wk) => {
    const gone = wk.exercises[1]
    await open()
    const before = world
    goTo(wk)
    click(`Remove ${gone.name}`)
    expect(screen.getByText(`Remove ${gone.name} from week 2?`)).toBeTruthy()
    // the confirm's CANCEL takes it away and removes nothing
    inConfirm(`Remove ${gone.name} from week 2?`, 'CANCEL')
    expect(screen.queryByText(`Remove ${gone.name} from week 2?`)).toBeNull()
    expect(cardNames()).toEqual(wk.exercises.map((x) => x.name))
    expect(screen.queryByText('REMOVED FROM WEEK 2')).toBeNull()
    click(`Remove ${gone.name}`)
    click('REMOVE')
    expect(screen.queryByText(`Remove ${gone.name} from week 2?`)).toBeNull()
    expect(screen.getByText('REMOVED FROM WEEK 2')).toBeTruthy()
    expect(cardNames()).toEqual(wk.exercises.filter((x) => x.row !== gone.row).map((x) => x.name))
    // the struck-through line belongs to this workout: the others show none, and this one shows it again when it is back
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) {
      goTo(other)
      expect(screen.queryByText('REMOVED FROM WEEK 2')).toBeNull()
      expect(cardNames()).toEqual(other.exercises.map((x) => x.name))
    }
    goTo(wk)
    expect(screen.getAllByText('REMOVED FROM WEEK 2')).toHaveLength(1)
    await saveAndExpect(before, (e) => removeExerciseFrom(e, wk.id, gone.row))
  })

  // Two single exercises removed (never a superset's member, which UNDO puts next to the rest of its block) and put back in the other order.
  // A single exercise put back where a superset stands now is the next group of tests (chunk 51c; DECISIONS 191).
  const UNDOS: Record<string, [string, string]> = {
    push: ['pe-bench', 'pe-pushdown'],
    pull: ['pe-bcurl', 'pe-shrug'],
    legs: ['pe-rdl', 'pe-squat'],
    arms: ['pe-curl', 'pe-wrist'],
  }
  it.each(UNEVEN_WORKOUTS)('UNDO in $name: the line undone last-removed first, then the other; each comes back to its place and nothing is sent', async (wk) => {
    const [firstRow, secondRow] = UNDOS[wk.id]
    const first = wk.exercises.find((x) => x.row === firstRow)!
    const second = wk.exercises.find((x) => x.row === secondRow)!
    await open()
    goTo(wk)
    click(`Remove ${first.name}`)
    click('REMOVE')
    click(`Remove ${second.name}`)
    click('REMOVE')
    expect(screen.getAllByText('REMOVED FROM WEEK 2')).toHaveLength(2)
    expect(cardNames()).toEqual(wk.exercises.filter((x) => x.row !== firstRow && x.row !== secondRow).map((x) => x.name))
    // the other workouts show none of it
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) {
      goTo(other)
      expect(screen.queryByText('REMOVED FROM WEEK 2')).toBeNull()
    }
    goTo(wk)
    click(`Undo removing ${second.name}`)
    expect(cardNames()).toEqual(wk.exercises.filter((x) => x.row !== firstRow).map((x) => x.name))
    expect(screen.getAllByText('REMOVED FROM WEEK 2')).toHaveLength(1)
    click(`Undo removing ${first.name}`)
    expect(cardNames()).toEqual(wk.exercises.map((x) => x.name))
    expect(screen.queryByText('REMOVED FROM WEEK 2')).toBeNull()
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(h.rpc).not.toHaveBeenCalled()
  })

  // A superset's first member is put back before the rest of its block and its last member after it: the place it stood. (A member from the
  // middle of a bigger block is put back next to the others, last in its block: pinned in Pull's test of the 51c group below.)
  const ENDS: Record<string, [string, string]> = {
    push: ['pe-ohp', 'pe-lateral'],
    pull: ['pe-row', 'pe-face'],
    legs: ['pe-lcurl', 'pe-calf'],
    arms: ['pe-hammer', 'pe-dip'],
  }
  it.each(UNEVEN_WORKOUTS)('UNDO in $name puts the first and the last member of its superset back before and after the rest of it', async (wk) => {
    const [firstRow, lastRow] = ENDS[wk.id]
    await open()
    goTo(wk)
    for (const row of [firstRow, lastRow]) {
      const name = nameOf(wk, row)
      click(`Remove ${name}`)
      click('REMOVE')
      expect(cardNames()).not.toContain(name)
      click(`Undo removing ${name}`)
      expect(cardNames()).toEqual(wk.exercises.map((x) => x.name))
      expect(blockHeaders()).toEqual(['SUPERSET A'])
    }
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(h.rpc).not.toHaveBeenCalled()
  })

  // A whole superset removed member by member and put back in the reverse order (the last removed first) is where it was, member by member.
  it.each(UNEVEN_WORKOUTS)('UNDO in $name puts a superset removed member by member back, last removed first, where it stood', async (wk) => {
    const members = wk.exercises.filter((x) => x.block)
    await open()
    goTo(wk)
    for (const m of members) {
      click(`Remove ${m.name}`)
      click('REMOVE')
    }
    expect(cardNames()).toEqual(wk.exercises.filter((x) => !x.block).map((x) => x.name))
    expect(blockHeaders()).toEqual([])
    for (const m of [...members].reverse()) click(`Undo removing ${m.name}`)
    expect(cardNames()).toEqual(wk.exercises.map((x) => x.name))
    expect(blockHeaders()).toEqual(['SUPERSET A'])
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(h.rpc).not.toHaveBeenCalled()
  })

  // Either line can be undone first, and the one pressed is the one that comes back. (Where it comes back is not pinned here: the draft
  // remembers the place an exercise stood in the list at the moment it was removed.)
  it.each(UNEVEN_WORKOUTS)('UNDO in $name: the line pressed is the exercise that comes back, whichever was removed first', async (wk) => {
    const [firstRow, secondRow] = UNDOS[wk.id]
    const first = wk.exercises.find((x) => x.row === firstRow)!
    const second = wk.exercises.find((x) => x.row === secondRow)!
    await open()
    goTo(wk)
    click(`Remove ${first.name}`)
    click('REMOVE')
    click(`Remove ${second.name}`)
    click('REMOVE')
    click(`Undo removing ${first.name}`)
    expect(cardNames()).toContain(first.name)
    expect(cardNames()).not.toContain(second.name)
    expect(screen.queryByRole('button', { name: `Undo removing ${first.name}` })).toBeNull()
    expect(screen.getByRole('button', { name: `Undo removing ${second.name}` })).toBeTruthy()
    click(`Undo removing ${second.name}`)
    expect([...cardNames()].sort()).toEqual(wk.exercises.map((x) => x.name).sort())
    expect(screen.queryByText('REMOVED FROM WEEK 2')).toBeNull()
  })

  // ── UNDO never puts an exercise inside a superset (chunk 51c; DECISIONS 191) ──
  // UNDO puts an exercise back at the place it stood in the list when it was removed. When the exercises before it have come back first
  // (recipe 1), or a superset has grown over that place (recipe 2), that place is now between two members of a superset: the old draft
  // put the exercise there, the superset's header went and SAVE said "Couldn't save the changes." with the planner's own message under it
  // and sent nothing. Now the exercise comes back after the superset. Each workout has its own shape: Push and Arms have an exercise above
  // the pair and one below it; Legs gets its pair grown by SUPERSET on the exercise above; Pull's trio is moved below the exercise that
  // follows it. The letters are the first text on a card: a superset's member wears its letter, a single exercise its name.
  const firstTexts = (): string[] => Array.from(document.querySelectorAll('[data-exercise-key]')).map((n) => n.querySelector('span')?.textContent ?? '')
  type Press = readonly ['remove' | 'undo' | 'link', string] | readonly ['move the superset down']
  function press(steps: readonly Press[]) {
    for (const step of steps) {
      if (step[0] === 'remove') {
        click(`Remove ${step[1]}`)
        click('REMOVE')
      } else if (step[0] === 'undo') click(`Undo removing ${step[1]}`)
      else if (step[0] === 'link') click(`Link ${step[1]} with the exercise below`)
      else expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder superset A' }), { key: 'ArrowDown' })).toBe(false)
    }
  }
  interface Undone {
    wk: string
    title: string
    steps: readonly Press[]
    rows: readonly string[] // the order of the cards after the steps, by the run copy's rows
    letters: readonly string[] // the first text on each card after them
    save: ((e: Edit) => Edit) | null // null: the list is the original, and SAVE has nothing to send
  }
  const UNDONE: readonly Undone[] = [
    {
      wk: 'push',
      title: 'recipe 1: the exercise above the pair and the one below it removed and put back in the order removed',
      steps: [['remove', 'Bench Press'], ['remove', 'Triceps Pushdown'], ['undo', 'Bench Press'], ['undo', 'Triceps Pushdown']],
      rows: ['pe-bench', 'pe-ohp', 'pe-lateral', 'pe-pushdown'],
      letters: ['Bench Press', 'A', 'B', 'Triceps Pushdown'],
      save: null,
    },
    {
      wk: 'arms',
      title: 'the exercise above the pair and the one below it removed and put back in the order removed',
      steps: [['remove', 'Cable Curl'], ['remove', 'Skull Crusher'], ['undo', 'Cable Curl'], ['undo', 'Skull Crusher']],
      rows: ['pe-curl', 'pe-hammer', 'pe-dip', 'pe-skull', 'pe-wrist'],
      letters: ['Cable Curl', 'A', 'B', 'Skull Crusher', 'Wrist Curl'],
      save: null,
    },
    {
      wk: 'legs',
      title: 'recipe 2: an exercise removed, SUPERSET on the one above it (it joins the pair below), the exercise put back',
      steps: [['remove', 'Romanian Deadlift'], ['link', 'Back Squat'], ['undo', 'Romanian Deadlift']],
      rows: ['pe-squat', 'pe-lcurl', 'pe-calf', 'pe-rdl'],
      letters: ['A', 'B', 'C', 'Romanian Deadlift'],
      save: (e) => withBlock(reorderTo(e, 'legs', ['pe-squat', 'pe-lcurl', 'pe-calf', 'pe-rdl']), 'legs', ['pe-squat'], 'blk-legs'),
    },
    {
      wk: 'pull',
      title: 'an exercise removed, the trio moved below the exercise that follows it, the exercise put back',
      steps: [['remove', 'Biceps Curl'], ['move the superset down'], ['undo', 'Biceps Curl']],
      rows: ['pe-shrug', 'pe-row', 'pe-pd', 'pe-face', 'pe-bcurl'],
      letters: ['Shrug', 'A', 'B', 'C', 'Biceps Curl'],
      save: (e) => reorderTo(e, 'pull', ['pe-shrug', 'pe-row', 'pe-pd', 'pe-face', 'pe-bcurl']),
    },
  ]
  it.each(UNDONE)('UNDO in $wk, $title: the superset stays in one piece and SAVE is accepted', async ({ wk: wkId, steps, rows, letters, save: saveAs }) => {
    const wk = UNEVEN_WORKOUTS.find((x) => x.id === wkId)!
    await open()
    const before = world
    goTo(wk)
    press(steps)
    expect(cardKeys()).toEqual(rows)
    expect(firstTexts()).toEqual(letters)
    expect(blockHeaders()).toEqual(['SUPERSET A'])
    expect(screen.queryByText('REMOVED FROM WEEK 2')).toBeNull()
    // the other workouts keep their own lists and their superset
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) {
      goTo(other)
      expect(cardKeys()).toEqual(rowsOf(other))
      expect(blockHeaders()).toEqual(['SUPERSET A'])
    }
    goTo(wk)
    if (saveAs === null) {
      click('SAVE CHANGES')
      await screen.findByText('AT PLAN')
      expect(h.rpc).not.toHaveBeenCalled()
    } else {
      await saveAndExpect(before, saveAs)
    }
  })

  // The control: the same removals put back in stack order (the last removed first) are back where they were, as before the change.
  const CONTROLS: ReadonlyArray<{ wk: string; steps: readonly Press[] }> = [
    { wk: 'push', steps: [['remove', 'Bench Press'], ['remove', 'Triceps Pushdown'], ['undo', 'Triceps Pushdown'], ['undo', 'Bench Press']] },
    { wk: 'arms', steps: [['remove', 'Cable Curl'], ['remove', 'Skull Crusher'], ['undo', 'Skull Crusher'], ['undo', 'Cable Curl']] },
  ]
  it.each(CONTROLS)('UNDO in $wk in stack order puts the same removals back where they were, and SAVE has nothing to send', async ({ wk: wkId, steps }) => {
    const wk = UNEVEN_WORKOUTS.find((x) => x.id === wkId)!
    await open()
    goTo(wk)
    press(steps)
    expect(cardKeys()).toEqual(rowsOf(wk))
    expect(blockHeaders()).toEqual(['SUPERSET A'])
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(h.rpc).not.toHaveBeenCalled()
  })

  // Recipe 1 and then a real change: the list the four exercises end on is the original, so SAVE sends the new exercise and nothing that moves one
  // of the four (the request is held against the planner's list for that one edit, and the rows it left are read back).
  it.each(['push', 'arms'])('UNDO in %s (the exercise above the pair and the one below it put back in the order removed) and then ADD EXERCISE: SAVE sends only the new exercise', async (wkId) => {
    const wk = UNEVEN_WORKOUTS.find((x) => x.id === wkId)!
    const recipe = UNDONE.find((u) => u.wk === wkId && u.save === null)!
    await open()
    const before = world
    goTo(wk)
    press(recipe.steps)
    click('+ ADD EXERCISE')
    const sheet = await screen.findByRole('dialog', { name: 'Add exercise' })
    await within(sheet).findByRole('button', { name: 'Add Plank' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add Plank' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(cardNames()).toEqual([...wk.exercises.map((x) => x.name), 'Plank'])
    expect(blockHeaders()).toEqual(['SUPERSET A'])
    await saveAndExpect(before, (e) => addExerciseTo(e, wk.id, { exerciseId: 'ex-plank', weightUnit: 'kg' }))
    // no exercise of the run copy is moved, and the superset is as it was
    expect(sent().filter((o) => o.op === 'update' && o.table === 'v2_program_exercises')).toEqual([])
  })

  // As it always was: the middle member of a trio comes back last in its block (the first goes back before the others, the last after).
  it('UNDO in Pull puts the middle member of the trio back last in its block, and SAVE sends the new order', async () => {
    const wk = UNEVEN_WORKOUTS[1]
    await open()
    const before = world
    goTo(wk)
    press([['remove', 'Lat Pulldown'], ['undo', 'Lat Pulldown']])
    expect(cardKeys()).toEqual(['pe-row', 'pe-face', 'pe-pd', 'pe-bcurl', 'pe-shrug'])
    expect(firstTexts()).toEqual(['A', 'B', 'C', 'Biceps Curl', 'Shrug'])
    expect(blockHeaders()).toEqual(['SUPERSET A'])
    await saveAndExpect(before, (e) => reorderTo(e, 'pull', ['pe-row', 'pe-face', 'pe-pd', 'pe-bcurl', 'pe-shrug']))
  })
})

// ─── The cards: SUPERSET, UNLINK and the toggle between members ────────────────────────────────────────────────────────────────

describe('SUPERSET, UNLINK and the toggle between two members', () => {
  // The exercises that offer SUPERSET are the single ones that have an exercise below them and, since 1.2.1 (item 18, DECISIONS 246 (a)), the last member
  // of a superset that has one: Lateral Raise, Face Pull and Dip. No other member has it, and nothing at the foot of the list (Calf Raise).
  const LINKS: ReadonlyArray<{ wk: string; press: string; fresh?: string[]; joins?: string; offered: string[] }> = [
    { wk: 'push', press: 'pe-bench', joins: 'blk-push', offered: ['pe-bench', 'pe-lateral'] },
    { wk: 'pull', press: 'pe-bcurl', fresh: ['pe-bcurl', 'pe-shrug'], offered: ['pe-face', 'pe-bcurl'] },
    { wk: 'legs', press: 'pe-squat', fresh: ['pe-squat', 'pe-rdl'], offered: ['pe-squat', 'pe-rdl'] },
    { wk: 'legs', press: 'pe-rdl', joins: 'blk-legs', offered: ['pe-squat', 'pe-rdl'] },
    { wk: 'arms', press: 'pe-curl', joins: 'blk-arms', offered: ['pe-curl', 'pe-dip', 'pe-skull'] },
    { wk: 'arms', press: 'pe-skull', fresh: ['pe-skull', 'pe-wrist'], offered: ['pe-curl', 'pe-dip', 'pe-skull'] },
  ]
  it.each(LINKS)('SUPERSET on $press in $wk links it with the one below', async ({ wk: wkId, press: row, fresh, joins, offered }) => {
    const wk = UNEVEN_WORKOUTS.find((w) => w.id === wkId)!
    await open()
    const before = world
    goTo(wk)
    // the buttons the cards offer: single exercises with something below them, and the last member of a superset with something below it
    const offers = screen.queryAllByRole('button', { name: /^Link .* with the exercise below$/ }).map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Link (.*) with the exercise below$/, '$1'))
    expect(offers).toEqual(namesOf(wk, offered))
    click(`Link ${nameOf(wk, row)} with the exercise below`)
    if (fresh) {
      expect(blockHeaders()).toEqual(['SUPERSET A', 'SUPERSET B'])
      await saveAndExpect(before, (e) => withNewBlock(e, wk.id, fresh))
    } else {
      // it joins the block below it: one header still, one member more
      const block = wk.exercises.filter((x) => x.block === joins).map((x) => x.row)
      expect(blockHeaders()).toEqual(['SUPERSET A'])
      await saveAndExpect(before, (e) => withBlock(e, wk.id, [row, ...block], joins!))
    }
  })

  // The last member of a superset links the exercise below into it (1.2.1 item 18): the block gains one member, keeps its id and its two rests, and
  // the exercise joined is the only row SAVE writes.
  const LAST_MEMBERS: ReadonlyArray<{ wk: string; press: string; below: string; block: string }> = [
    { wk: 'push', press: 'pe-lateral', below: 'pe-pushdown', block: 'blk-push' },
    { wk: 'pull', press: 'pe-face', below: 'pe-bcurl', block: 'blk-pull' },
    { wk: 'arms', press: 'pe-dip', below: 'pe-skull', block: 'blk-arms' },
  ]
  it.each(LAST_MEMBERS)('SUPERSET on $press, the last member of the superset in $wk, links $below into it', async ({ wk: wkId, press: row, below, block }) => {
    const wk = UNEVEN_WORKOUTS.find((w) => w.id === wkId)!
    await open()
    const before = world
    goTo(wk)
    click(`Link ${nameOf(wk, row)} with the exercise below`)
    // one superset still, one member more, in the same order
    expect(blockHeaders()).toEqual(['SUPERSET A'])
    expect(cardKeys()).toEqual(rowsOf(wk))
    const members = [...wk.exercises.filter((x) => x.block === block).map((x) => x.row), below]
    await saveAndExpect(before, (e) => withBlock(e, wk.id, members, block))
    // the rows say the same: the superset's rests are the block's own, and the joined exercise carries its block
    const rows = world.db.v2_program_exercises
    expect(members.map((m) => rows.find((r) => r.id === m)!.superset_block_id)).toEqual(members.map(() => block))
    const updatedRows = sent().filter((o) => o.op === 'update' && o.table === 'v2_program_exercises').map((o) => o.id)
    expect(updatedRows).toEqual([below])
  })

  // With a superset right below, the last member's SUPERSET joins the two (`planLinkToggle`, as the planner's link between two supersets does): the
  // upper superset keeps its id and its two rests, and the lower one's members take them. Pull: Biceps Curl and Shrug make a superset of their own first.
  it('SUPERSET on the last member of a superset with another superset right below it merges the two into the upper one, which keeps its id and its rests', async () => {
    const wk = UNEVEN_WORKOUTS.find((w) => w.id === 'pull')!
    await open()
    const before = world
    goTo(wk)
    click('Link Biceps Curl with the exercise below')
    expect(blockHeaders()).toEqual(['SUPERSET A', 'SUPERSET B'])
    click('Link Face Pull with the exercise below')
    expect(blockHeaders()).toEqual(['SUPERSET A'])
    expect(cardKeys()).toEqual(rowsOf(wk))
    await saveAndExpect(before, (e) => withBlock(e, wk.id, rowsOf(wk), 'blk-pull'))
    // the two rows that joined are the only ones written, and the block's own rests are untouched
    expect(sent().filter((o) => o.op === 'update' && o.table === 'v2_program_exercises').map((o) => o.id)).toEqual(['pe-bcurl', 'pe-shrug'])
    expect(sent().filter((o) => o.table === 'v2_program_superset_blocks')).toEqual([])
  })

  it('a superset split before SAVE is joined again from the part above it, and SAVE has nothing to send: Row and Pulldown, then Face Pull, are the trio again', async () => {
    const wk = UNEVEN_WORKOUTS.find((w) => w.id === 'pull')!
    await open()
    goTo(wk)
    // the second toggle splits Face Pull off the end of the trio: Row + Pulldown stay a superset, Face Pull is on its own
    fireEvent.click(screen.getAllByRole('button', { name: /SUPERSET — TAP TO UNLINK/ })[1])
    expect(blockHeaders()).toEqual(['SUPERSET A'])
    expect(screen.queryAllByRole('button', { name: /SUPERSET — TAP TO UNLINK/ })).toHaveLength(1)
    // nothing before this offered the part above the split a way back; its last member does
    expect(screen.queryByRole('button', { name: 'Link Barbell Row with the exercise below' })).toBeNull()
    click('Link Lat Pulldown with the exercise below')
    expect(blockHeaders()).toEqual(['SUPERSET A'])
    expect(screen.queryAllByRole('button', { name: /SUPERSET — TAP TO UNLINK/ })).toHaveLength(2)
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('no superset offers SUPERSET on a member with another member below it, and nothing at the foot of the list offers it', async () => {
    await open()
    for (const wk of UNEVEN_WORKOUTS) {
      goTo(wk)
      wk.exercises.forEach((x, i) => {
        // offered when there is an exercise below that is not already in this exercise's superset
        const below = wk.exercises[i + 1]
        const expectOffer = below !== undefined && !(x.block && below.block === x.block)
        const offered = screen.queryByRole('button', { name: `Link ${x.name} with the exercise below` }) !== null
        expect({ wk: wk.id, row: x.row, offered }).toEqual({ wk: wk.id, row: x.row, offered: expectOffer })
      })
    }
  })

  it('the ⋯ of an exercise left alone in its superset is a single exercise’s: no WITHIN ROUND, no AFTER ROUND', async () => {
    await open()
    const wk = UNEVEN_WORKOUTS[0]
    goTo(wk)
    click('Overhead Press: rest, tempo, unit')
    // a member's sheet: its workout and superset in the eyebrow, and the two rests of the block
    const member = dialog('Overhead Press')
    expect(within(member).getByText('PUSH · SUPERSET A')).toBeTruthy()
    expect(within(member).getByRole('button', { name: 'Within round: more' })).toBeTruthy()
    closeDialog('Overhead Press')
    click('Remove Overhead Press')
    click('REMOVE')
    // left alone, it is drawn as a single exercise: no superset header, no UNLINK, and it offers SUPERSET again
    expect(blockHeaders()).toEqual([])
    expect(screen.queryByRole('button', { name: /^Unlink superset/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Link Lateral Raise with the exercise below' })).toBeTruthy()
    click('Lateral Raise: rest, tempo, unit')
    const alone = dialog('Lateral Raise')
    expect(within(alone).getByText('PUSH')).toBeTruthy()
    expect(within(alone).queryByRole('button', { name: 'Within round: more' })).toBeNull()
    expect(within(alone).queryByRole('button', { name: 'After round: more' })).toBeNull()
    expect(within(alone).getByText(/Swap, superset and remove are on the exercise card\./)).toBeTruthy()
  })

  it('a second superset in a workout is SUPERSET B, in its header, its ⋯ and its UNLINK, and UNLINK B frees its members alone', async () => {
    const wk = UNEVEN_WORKOUTS[2]
    await open()
    const before = world
    goTo(wk)
    click('Link Back Squat with the exercise below')
    // the new block is the first in the list, the old one (Leg Curl and Calf Raise) the second
    expect(blockHeaders()).toEqual(['SUPERSET A', 'SUPERSET B'])
    click('Leg Curl: rest, tempo, unit')
    const sheet = dialog('Leg Curl')
    expect(within(sheet).getByText('LEGS · SUPERSET B')).toBeTruthy()
    expect(within(sheet).getByText(/^The two rests belong to superset B, so they change it for Calf Raise too\./)).toBeTruthy()
    closeDialog('Leg Curl')
    click('Unlink superset B')
    expect(blockHeaders()).toEqual(['SUPERSET A'])
    await saveAndExpect(before, (e) => withBlock(withNewBlock(e, wk.id, ['pe-squat', 'pe-rdl']), wk.id, ['pe-lcurl', 'pe-calf'], null))
  })

  it.each(UNEVEN_WORKOUTS)('the members of the superset in $name wear the letters A, B (and C) and a single exercise wears none', async (wk) => {
    await open()
    goTo(wk)
    // the first text on a card is the member's letter badge; a single exercise's card starts with its name
    const firstText = (el: Element) => el.querySelector('span')?.textContent
    let member = 0
    expect(Array.from(document.querySelectorAll('[data-exercise-key]')).map(firstText)).toEqual(wk.exercises.map((x) => (x.block ? String.fromCharCode(65 + member++) : x.name)))
  })

  it.each(UNEVEN_WORKOUTS)('UNLINK in $name frees every member of its superset, in this workout alone', async (wk) => {
    const members = wk.exercises.filter((x) => x.block).map((x) => x.row)
    await open()
    const before = world
    goTo(wk)
    click('Unlink superset A')
    expect(blockHeaders()).toEqual([])
    // every member now offers SUPERSET again (but the last exercise of the workout)
    expect(screen.queryAllByRole('button', { name: /^Link .* with the exercise below$/ })).toHaveLength(wk.exercises.length - 1)
    // another workout keeps its superset
    const other = UNEVEN_WORKOUTS.find((o) => o.id !== wk.id)!
    goTo(other)
    expect(blockHeaders()).toEqual(['SUPERSET A'])
    await saveAndExpect(before, (e) => withBlock(e, wk.id, members, null))
  })

  // The toggle between two members splits there: the left side keeps the block when it still has two, else the right side does.
  const SPLITS: ReadonlyArray<{ wk: string; toggle: number; place: string; free: string[]; keep: string[] }> = [
    { wk: 'push', toggle: 0, place: 'first', free: ['pe-ohp', 'pe-lateral'], keep: [] },
    { wk: 'pull', toggle: 0, place: 'first', free: ['pe-row'], keep: ['pe-pd', 'pe-face'] },
    { wk: 'pull', toggle: 1, place: 'second', free: ['pe-face'], keep: ['pe-row', 'pe-pd'] },
    { wk: 'legs', toggle: 0, place: 'first', free: ['pe-lcurl', 'pe-calf'], keep: [] },
    { wk: 'arms', toggle: 0, place: 'first', free: ['pe-hammer', 'pe-dip'], keep: [] },
  ]
  it.each(SPLITS)('the $place toggle of the superset in $wk splits it there', async ({ wk: wkId, toggle, free, keep }) => {
    const wk = UNEVEN_WORKOUTS.find((w) => w.id === wkId)!
    await open()
    const before = world
    goTo(wk)
    const members = wk.exercises.filter((x) => x.block).length
    const toggles = screen.getAllByRole('button', { name: /SUPERSET — TAP TO UNLINK/ })
    expect(toggles).toHaveLength(members - 1)
    fireEvent.click(toggles[toggle])
    expect(blockHeaders()).toEqual(keep.length > 0 ? ['SUPERSET A'] : [])
    await saveAndExpect(before, (e) => withBlock(withBlock(e, wk.id, free, null), wk.id, keep, wk.block.id))
  })
})

// ─── Order: the grip's arrow keys, a drag, and MOVE UP / MOVE DOWN in an exercise's ⋯ ─────────────────────────────────────────────

// The units stack with 10 px between them and are not all the same height (a superset's card is taller than a single exercise's): 60 px for the
// even places and 140 px for the odd ones. The drag goes by where a unit's centre is, so a centre taken from the height wrongly shows.
const UNIT_HEIGHT = (i: number): number => (i % 2 === 0 ? 60 : 140)
const unitTop = (i: number): number => Array.from({ length: i }, (_, j) => UNIT_HEIGHT(j) + 10).reduce((a, b) => a + b, 0)
const unitCentre = (i: number): number => unitTop(i) + UNIT_HEIGHT(i) / 2
function stubRects() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const i = this.dataset?.unitIndex
    return i === undefined
      ? ({ top: 0, height: 0, bottom: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
      : ({ top: unitTop(Number(i)), height: UNIT_HEIGHT(Number(i)), bottom: unitTop(Number(i)) + UNIT_HEIGHT(Number(i)), left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
  })
}
const pointer = (type: string, clientY: number) => new MouseEvent(type, { bubbles: true, button: 0, clientY })

// The order of the rows after each press, written out. A superset moves as one block.
interface Step {
  grip: string // the grip's name: `Reorder <exercise>` or `Reorder superset A`
  key: 'ArrowUp' | 'ArrowDown'
  order: string[]
}
const ARROWS: Record<string, { steps: Step[]; edge: Step }> = {
  push: {
    steps: [
      { grip: 'Reorder Bench Press', key: 'ArrowDown', order: ['pe-ohp', 'pe-lateral', 'pe-bench', 'pe-pushdown'] },
      { grip: 'Reorder Triceps Pushdown', key: 'ArrowUp', order: ['pe-ohp', 'pe-lateral', 'pe-pushdown', 'pe-bench'] },
      { grip: 'Reorder superset A', key: 'ArrowDown', order: ['pe-pushdown', 'pe-ohp', 'pe-lateral', 'pe-bench'] },
    ],
    edge: { grip: 'Reorder Triceps Pushdown', key: 'ArrowUp', order: ['pe-pushdown', 'pe-ohp', 'pe-lateral', 'pe-bench'] },
  },
  pull: {
    steps: [
      { grip: 'Reorder superset A', key: 'ArrowDown', order: ['pe-bcurl', 'pe-row', 'pe-pd', 'pe-face', 'pe-shrug'] },
      { grip: 'Reorder Shrug', key: 'ArrowUp', order: ['pe-bcurl', 'pe-shrug', 'pe-row', 'pe-pd', 'pe-face'] },
      { grip: 'Reorder Biceps Curl', key: 'ArrowDown', order: ['pe-shrug', 'pe-bcurl', 'pe-row', 'pe-pd', 'pe-face'] },
    ],
    edge: { grip: 'Reorder superset A', key: 'ArrowDown', order: ['pe-shrug', 'pe-bcurl', 'pe-row', 'pe-pd', 'pe-face'] },
  },
  legs: {
    steps: [
      { grip: 'Reorder Back Squat', key: 'ArrowDown', order: ['pe-rdl', 'pe-squat', 'pe-lcurl', 'pe-calf'] },
      { grip: 'Reorder superset A', key: 'ArrowUp', order: ['pe-rdl', 'pe-lcurl', 'pe-calf', 'pe-squat'] },
      { grip: 'Reorder superset A', key: 'ArrowUp', order: ['pe-lcurl', 'pe-calf', 'pe-rdl', 'pe-squat'] },
    ],
    edge: { grip: 'Reorder superset A', key: 'ArrowUp', order: ['pe-lcurl', 'pe-calf', 'pe-rdl', 'pe-squat'] },
  },
  arms: {
    steps: [
      { grip: 'Reorder Cable Curl', key: 'ArrowDown', order: ['pe-hammer', 'pe-dip', 'pe-curl', 'pe-skull', 'pe-wrist'] },
      { grip: 'Reorder Wrist Curl', key: 'ArrowUp', order: ['pe-hammer', 'pe-dip', 'pe-curl', 'pe-wrist', 'pe-skull'] },
      { grip: 'Reorder superset A', key: 'ArrowDown', order: ['pe-curl', 'pe-hammer', 'pe-dip', 'pe-wrist', 'pe-skull'] },
    ],
    edge: { grip: 'Reorder Skull Crusher', key: 'ArrowDown', order: ['pe-curl', 'pe-hammer', 'pe-dip', 'pe-wrist', 'pe-skull'] },
  },
}

describe('order', () => {
  beforeEach(() => {
    stubRects()
  })

  it.each(UNEVEN_WORKOUTS)('the grip’s arrow keys in $name: a unit moves one place, a superset as one block, and at the end of the list nothing moves', async (wk) => {
    const { steps, edge } = ARROWS[wk.id]
    await open()
    const before = world
    goTo(wk)
    for (const step of steps) {
      // an arrow key the grip answers is taken (the page behind it doesn't scroll): fireEvent returns false for a prevented event
      const notTaken = fireEvent.keyDown(screen.getByRole('button', { name: step.grip }), { key: step.key })
      expect(notTaken).toBe(false)
      expect({ step: step.grip, order: cardKeys() }).toEqual({ step: step.grip, order: step.order })
    }
    expect(fireEvent.keyDown(screen.getByRole('button', { name: edge.grip }), { key: edge.key })).toBe(false)
    expect(cardKeys()).toEqual(edge.order)
    // any other key is left alone
    expect(fireEvent.keyDown(screen.getByRole('button', { name: edge.grip }), { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(screen.getByRole('button', { name: edge.grip }), { key: 'a' })).toBe(true)
    expect(cardKeys()).toEqual(edge.order)
    // the other workouts keep their orders
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) {
      goTo(other)
      expect(cardKeys()).toEqual(rowsOf(other))
    }
    await saveAndExpect(before, (e) => reorderTo(e, wk.id, steps[steps.length - 1].order))
  })

  // A drag by the grip, by pointer events: a unit from one place to another, twice.
  interface Drag {
    from: number
    to: number
    order: string[]
  }
  const DRAGS: Record<string, [Drag, Drag]> = {
    push: [
      { from: 2, to: 0, order: ['pe-pushdown', 'pe-bench', 'pe-ohp', 'pe-lateral'] },
      { from: 1, to: 2, order: ['pe-pushdown', 'pe-ohp', 'pe-lateral', 'pe-bench'] },
    ],
    pull: [
      { from: 2, to: 0, order: ['pe-shrug', 'pe-row', 'pe-pd', 'pe-face', 'pe-bcurl'] },
      { from: 1, to: 2, order: ['pe-shrug', 'pe-bcurl', 'pe-row', 'pe-pd', 'pe-face'] },
    ],
    legs: [
      { from: 2, to: 0, order: ['pe-lcurl', 'pe-calf', 'pe-squat', 'pe-rdl'] },
      { from: 1, to: 2, order: ['pe-lcurl', 'pe-calf', 'pe-rdl', 'pe-squat'] },
    ],
    arms: [
      { from: 3, to: 1, order: ['pe-curl', 'pe-wrist', 'pe-hammer', 'pe-dip', 'pe-skull'] },
      { from: 2, to: 0, order: ['pe-hammer', 'pe-dip', 'pe-curl', 'pe-wrist', 'pe-skull'] },
    ],
  }
  it.each(UNEVEN_WORKOUTS)('a drag in $name: the unit dragged lands where it is let go, in this workout, and SAVE sends the new positions', async (wk) => {
    await open()
    const before = world
    goTo(wk)
    for (const { from, to, order } of DRAGS[wk.id]) {
      // the grip of the unit in place `from`, by what the screen draws now
      const unit = document.querySelectorAll('[data-unit-key]')[from] as HTMLElement
      const grip = within(unit).getAllByRole('button', { name: /^Reorder / })[0]
      const y = (i: number, nudge: number) => unitCentre(i) + nudge
      const dragged = unit.dataset.unitKey
      await act(async () => {
        grip.dispatchEvent(pointer('pointerdown', y(from, 0)))
      })
      // pressed, not moved yet: the unit is already the one held
      const held = Array.from(document.querySelectorAll('[style*="translateY"]')) as HTMLElement[]
      expect(held.map((n) => n.querySelector('[data-unit-key]')?.getAttribute('data-unit-key'))).toEqual([dragged])
      expect(held[0].style.transform).toBe('translateY(0px)')
      await act(async () => {
        window.dispatchEvent(pointer('pointermove', y(to, to < from ? -5 : 5)))
      })
      // while it is held, the unit follows the pointer by what the pointer has moved, and it is the only one that does
      const following = Array.from(document.querySelectorAll('[style*="translateY"]')) as HTMLElement[]
      expect(following.map((n) => n.querySelector('[data-unit-key]')?.getAttribute('data-unit-key'))).toEqual([dragged])
      expect(following[0].style.transform).toBe(`translateY(${y(to, to < from ? -5 : 5) - y(from, 0)}px)`)
      await act(async () => {
        window.dispatchEvent(pointer('pointerup', y(to, to < from ? -5 : 5)))
      })
      expect({ from, to, order: cardKeys() }).toEqual({ from, to, order })
    }
    // a drag that has ended is over: a pointer event after it moves nothing and no card follows the pointer
    await act(async () => {
      window.dispatchEvent(pointer('pointermove', 900))
      window.dispatchEvent(pointer('pointerup', 900))
    })
    expect(cardKeys()).toEqual(DRAGS[wk.id][1].order)
    expect(document.querySelectorAll('[style*="translateY"]')).toHaveLength(0)
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) {
      goTo(other)
      expect(cardKeys()).toEqual(rowsOf(other))
    }
    await saveAndExpect(before, (e) => reorderTo(e, wk.id, DRAGS[wk.id][1].order))
  })

  // A drag the system takes away (the pointer is cancelled) changes nothing and is over: the card lets go, and nothing that follows moves it.
  it.each(UNEVEN_WORKOUTS)('a cancelled drag in $name changes nothing and is over', async (wk) => {
    await open()
    goTo(wk)
    const last = document.querySelectorAll('[data-unit-key]').length - 1
    const grip = within(document.querySelectorAll('[data-unit-key]')[last] as HTMLElement).getAllByRole('button', { name: /^Reorder / })[0]
    await act(async () => {
      grip.dispatchEvent(pointer('pointerdown', unitCentre(last)))
      window.dispatchEvent(pointer('pointermove', 5))
    })
    expect(document.querySelectorAll('[style*="translateY"]')).toHaveLength(1)
    await act(async () => {
      window.dispatchEvent(pointer('pointercancel', 5))
    })
    expect(document.querySelectorAll('[style*="translateY"]')).toHaveLength(0)
    expect(cardKeys()).toEqual(rowsOf(wk))
    // nothing that comes after moves the card or commits a move
    await act(async () => {
      window.dispatchEvent(pointer('pointermove', 5))
      window.dispatchEvent(pointer('pointerup', 5))
    })
    expect(document.querySelectorAll('[style*="translateY"]')).toHaveLength(0)
    expect(cardKeys()).toEqual(rowsOf(wk))
    click('CANCEL')
    expect(screen.queryByText('Discard your changes?')).toBeNull()
  })

  // What a drag puts on the window (it listens for the pointer moving, being let go and being cancelled) is taken off again however it ended.
  it('a drag leaves nothing listening on the window once it is over: let go, or cancelled', async () => {
    const types = ['pointermove', 'pointerup', 'pointercancel']
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const pairs = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.filter((c) => types.includes(c[0] as string)).map((c) => ({ type: c[0] as string, handler: c[1] }))
    const stillListening = () => pairs(added).filter((a) => !pairs(removed).some((r) => r.type === a.type && r.handler === a.handler)).map((a) => a.type)
    try {
      await open()
      goTo(UNEVEN_WORKOUTS[1])
      const grip = () => within(document.querySelectorAll('[data-unit-key]')[0] as HTMLElement).getAllByRole('button', { name: /^Reorder / })[0]
      await act(async () => {
        grip().dispatchEvent(pointer('pointerdown', unitCentre(0)))
      })
      expect(stillListening().sort()).toEqual(['pointercancel', 'pointermove', 'pointerup'])
      await act(async () => {
        window.dispatchEvent(pointer('pointerup', unitCentre(0)))
      })
      expect(stillListening()).toEqual([])
      await act(async () => {
        grip().dispatchEvent(pointer('pointerdown', unitCentre(0)))
      })
      expect(stillListening().sort()).toEqual(['pointercancel', 'pointermove', 'pointerup'])
      await act(async () => {
        window.dispatchEvent(pointer('pointercancel', unitCentre(0)))
      })
      expect(stillListening()).toEqual([])
      expect(pairs(added)).toHaveLength(6)
    } finally {
      added.mockRestore()
      removed.mockRestore()
    }
  })

  it.each(UNEVEN_WORKOUTS)('a press of $name’s grip with a button other than the main one starts no drag', async (wk) => {
    await open()
    goTo(wk)
    const grip = within(document.querySelectorAll('[data-unit-key]')[0] as HTMLElement).getAllByRole('button', { name: /^Reorder / })[0]
    await act(async () => {
      grip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2, clientY: unitCentre(0) }))
      window.dispatchEvent(pointer('pointermove', 340))
    })
    expect(document.querySelectorAll('[style*="translateY"]')).toHaveLength(0)
    await act(async () => {
      window.dispatchEvent(pointer('pointerup', 340))
    })
    expect(cardKeys()).toEqual(rowsOf(wk))
    click('CANCEL')
    expect(screen.queryByText('Discard your changes?')).toBeNull()
  })

  // MOVE UP / MOVE DOWN in the exercise's ⋯: one press of one, two of the other, and the button at the end of the list is disabled.
  const SHEET_MOVES: Record<string, { row: string; first: 'MOVE UP' | 'MOVE DOWN'; afterFirst: string[]; afterSecond: string[]; endButton: 'MOVE UP' | 'MOVE DOWN' }> = {
    push: { row: 'pe-ohp', first: 'MOVE DOWN', afterFirst: ['pe-bench', 'pe-pushdown', 'pe-ohp', 'pe-lateral'], afterSecond: ['pe-ohp', 'pe-lateral', 'pe-bench', 'pe-pushdown'], endButton: 'MOVE UP' },
    pull: { row: 'pe-bcurl', first: 'MOVE UP', afterFirst: ['pe-bcurl', 'pe-row', 'pe-pd', 'pe-face', 'pe-shrug'], afterSecond: ['pe-row', 'pe-pd', 'pe-face', 'pe-shrug', 'pe-bcurl'], endButton: 'MOVE DOWN' },
    legs: { row: 'pe-rdl', first: 'MOVE DOWN', afterFirst: ['pe-squat', 'pe-lcurl', 'pe-calf', 'pe-rdl'], afterSecond: ['pe-rdl', 'pe-squat', 'pe-lcurl', 'pe-calf'], endButton: 'MOVE UP' },
    arms: { row: 'pe-skull', first: 'MOVE UP', afterFirst: ['pe-curl', 'pe-skull', 'pe-hammer', 'pe-dip', 'pe-wrist'], afterSecond: ['pe-curl', 'pe-hammer', 'pe-dip', 'pe-wrist', 'pe-skull'], endButton: 'MOVE DOWN' },
  }
  it.each(UNEVEN_WORKOUTS)('MOVE UP and MOVE DOWN in $name’s exercise ⋯ move its unit, and the end of the list disables one', async (wk) => {
    const { row, first, afterFirst, afterSecond, endButton } = SHEET_MOVES[wk.id]
    const other = first === 'MOVE UP' ? 'MOVE DOWN' : 'MOVE UP'
    await open()
    const before = world
    goTo(wk)
    click(`${nameOf(wk, row)}: rest, tempo, unit`)
    const sheet = dialog(nameOf(wk, row))
    const move = (name: string) => fireEvent.click(within(sheet).getByRole('button', { name }))
    const disabled = (name: string) => (within(sheet).getByRole('button', { name }) as HTMLButtonElement).disabled
    // it stands between two units: both buttons work
    expect(disabled('MOVE UP')).toBe(false)
    expect(disabled('MOVE DOWN')).toBe(false)
    move(first)
    expect(cardKeys()).toEqual(afterFirst)
    move(other)
    move(other)
    expect(cardKeys()).toEqual(afterSecond)
    expect(disabled(endButton)).toBe(true)
    expect(disabled(endButton === 'MOVE UP' ? 'MOVE DOWN' : 'MOVE UP')).toBe(false)
    // a press at the end changes nothing
    move(endButton)
    expect(cardKeys()).toEqual(afterSecond)
    closeDialog(nameOf(wk, row))
    expect(screen.queryByRole('dialog')).toBeNull()
    for (const o of UNEVEN_WORKOUTS.filter((x) => x.id !== wk.id)) {
      goTo(o)
      expect(cardKeys()).toEqual(rowsOf(o))
    }
    await saveAndExpect(before, (e) => reorderTo(e, wk.id, afterSecond))
  })
})

// ─── An exercise's ⋯: REST, REST AFTER, TEMPO, UNIT, and a superset's two rests ─────────────────────────────────────────────────

describe('an exercise’s ⋯ writes to the exercise it was opened on', () => {
  interface Change {
    row: string
    rest: [number, number | null] // presses of more (+) or less (-), and the rest it ends on
    restAfter: [number, number | null]
    tempo: string // picked in the tempo picker (SET and the four boxes); '' is NONE
    unit: 'DEFAULT' | 'KG' | 'LBS'
  }
  // The first and the last exercise of each workout, each with its own presses. Starting values are the world's (UNEVEN_WORKOUTS).
  const CHANGES: Record<string, [Change, Change]> = {
    push: [
      { row: 'pe-bench', rest: [2, 180], restAfter: [3, 45], tempo: '3-1-1-0', unit: 'KG' },
      { row: 'pe-pushdown', rest: [-1, 60], restAfter: [1, 60], tempo: '2-0-2-0', unit: 'LBS' },
    ],
    pull: [
      { row: 'pe-row', rest: [1, 150], restAfter: [2, 30], tempo: '', unit: 'LBS' },
      { row: 'pe-shrug', rest: [4, 60], restAfter: [1, 15], tempo: '1-1-1-1', unit: 'KG' },
    ],
    legs: [
      { row: 'pe-squat', rest: [-2, 150], restAfter: [-1, 45], tempo: '5-0-1-0', unit: 'LBS' },
      { row: 'pe-calf', rest: [-4, null], restAfter: [3, 45], tempo: '2-0-1-0', unit: 'DEFAULT' },
    ],
    arms: [
      { row: 'pe-curl', rest: [3, 135], restAfter: [-1, null], tempo: '3-0-3-0', unit: 'KG' },
      { row: 'pe-wrist', rest: [1, 60], restAfter: [2, 90], tempo: '4-0-2-0', unit: 'LBS' },
    ],
  }
  it.each(UNEVEN_WORKOUTS)('REST, REST AFTER, TEMPO and UNIT in $name: the first and the last exercise each take their own', async (wk) => {
    await open()
    const before = world
    goTo(wk)
    const unitValue = { DEFAULT: null, KG: 'kg', LBS: 'lbs' } as const
    for (const c of CHANGES[wk.id]) {
      const x = wk.exercises.find((y) => y.row === c.row)!
      click(`${x.name}: rest, tempo, unit`)
      const sheet = dialog(x.name)
      // a member's sheet says which superset it belongs to; a single exercise's says the workout alone
      expect(within(sheet).getByText(x.block ? `${wk.name.toUpperCase()} · SUPERSET A` : wk.name.toUpperCase())).toBeTruthy()
      for (let i = 0; i < Math.abs(c.rest[0]); i++) fireEvent.click(within(sheet).getByRole('button', { name: c.rest[0] > 0 ? 'Rest: more' : 'Rest: less' }))
      for (let i = 0; i < Math.abs(c.restAfter[0]); i++) fireEvent.click(within(sheet).getByRole('button', { name: c.restAfter[0] > 0 ? 'Rest after: more' : 'Rest after: less' }))
      // the tempo picker (1.2.1 item 3): the row opens it, NONE or SET with the four boxes, the footer writes it into the draft
      fireEvent.click(within(sheet).getByRole('button', { name: `Tempo for ${x.name}` }))
      pickTempo(dialog('Tempo'), c.tempo)
      fireEvent.click(within(sheet).getByRole('button', { name: c.unit }))
      closeDialog(x.name)
    }
    // the cards say it (the first exercise of the Push list ends on 3:00 and 0:45)
    if (wk.id === 'push') {
      expect(screen.getByText('REST 3:00')).toBeTruthy()
      expect(screen.getByText('REST AFTER 0:45')).toBeTruthy()
    }
    await saveAndExpect(before, (e) =>
      CHANGES[wk.id].reduce(
        (acc, c) =>
          patchExercise(acc, wk.id, c.row, { restSeconds: c.rest[1], restAfterSeconds: c.restAfter[1], tempo: c.tempo === '' ? null : c.tempo, weightUnit: unitValue[c.unit] }),
        e,
      ),
    )
    // the exercises of the other workouts keep what they had
    const now = world.db.v2_program_exercises
    for (const o of UNEVEN_WORKOUTS.filter((x) => x.id !== wk.id)) {
      for (const x of o.exercises) {
        const r = now.find((y) => y.id === x.row)!
        expect([r.rest_seconds, r.rest_after_seconds, r.tempo, r.weight_unit]).toEqual([x.rest, x.restAfter, x.tempo, x.unit])
      }
    }
  })

  // The markers on a card say what is set on the exercise; one drawn in the accent is changed in this edit (CHANGED IN THIS EDIT), against the
  // run copy's row of that workout. Each workout's markers are as the world has them, so none is changed until the exercise is edited.
  const MARKERS: Record<string, { all: string[]; edit: { row: string; from: string; to: string } }> = {
    push: { all: ['REST 2:30', 'REST 1:45', 'REST AFTER 0:30', 'TEMPO 3-0-1-0', 'UNIT LBS', 'REST 1:15', 'REST AFTER 0:45'], edit: { row: 'pe-bench', from: 'REST 2:30', to: 'REST 2:45' } },
    pull: { all: ['REST 2:15', 'TEMPO 2-1-1-0', 'REST AFTER 1:00', 'UNIT LBS', 'REST 0:45', 'REST 1:30', 'REST AFTER 0:15', 'TEMPO 4-0-1-0'], edit: { row: 'pe-row', from: 'REST 2:15', to: 'REST 2:30' } },
    legs: { all: ['REST 3:00', 'REST AFTER 1:00', 'REST 2:00', 'TEMPO 3-1-1-0', 'REST AFTER 0:30', 'REST 1:00', 'UNIT LBS'], edit: { row: 'pe-squat', from: 'REST 3:00', to: 'REST 3:15' } },
    arms: { all: ['REST 1:30', 'REST AFTER 0:15', 'TEMPO 3-0-1-1', 'UNIT LBS', 'REST 1:15', 'REST AFTER 0:30', 'REST 2:00', 'REST 0:45', 'REST AFTER 1:00', 'TEMPO 2-0-2-0'], edit: { row: 'pe-curl', from: 'REST 1:30', to: 'REST 1:45' } },
  }
  const drawnChanged = (label: string): boolean => screen.getByText(label).style.color === 'var(--accent)'
  it.each(UNEVEN_WORKOUTS)('the markers in $name are changed only where the exercise was edited', async (wk) => {
    const { all, edit } = MARKERS[wk.id]
    await open()
    goTo(wk)
    for (const label of all) expect({ label, changed: drawnChanged(label) }).toEqual({ label, changed: false })
    const x = wk.exercises.find((y) => y.row === edit.row)!
    click(`${x.name}: rest, tempo, unit`)
    fireEvent.click(within(dialog(x.name)).getByRole('button', { name: 'Rest: more' }))
    closeDialog(x.name)
    // the edited exercise's rest is the one marker in the accent; the others, its own tempo and rest after included, are not
    expect(screen.queryByText(edit.from)).toBeNull()
    expect(drawnChanged(edit.to)).toBe(true)
    for (const label of all.filter((l) => l !== edit.from)) expect({ label, changed: drawnChanged(label) }).toEqual({ label, changed: false })
  })

  // A superset's rests belong to its block: they are changed from any member's sheet and written to that block alone.
  const BLOCK_RESTS: Record<string, { within: { member: number; presses: number; ends: number | null }; after: { member: number; presses: number; ends: number | null } }> = {
    push: { within: { member: 1, presses: 1, ends: 30 }, after: { member: 2, presses: 2, ends: 120 } },
    pull: { within: { member: 0, presses: 3, ends: 45 }, after: { member: 2, presses: -1, ends: 105 } },
    legs: { within: { member: 2, presses: -1, ends: 15 }, after: { member: 3, presses: 2, ends: 30 } },
    arms: { within: { member: 1, presses: 2, ends: 60 }, after: { member: 2, presses: -2, ends: 30 } },
  }
  it.each(UNEVEN_WORKOUTS)('a superset’s rests in $name: written to its block, from the first member and from the last', async (wk) => {
    const { within: w, after: a } = BLOCK_RESTS[wk.id]
    await open()
    const before = world
    goTo(wk)
    const step = (member: number, label: string, presses: number) => {
      const x = wk.exercises[member]
      click(`${x.name}: rest, tempo, unit`)
      const sheet = dialog(x.name)
      for (let i = 0; i < Math.abs(presses); i++) fireEvent.click(within(sheet).getByRole('button', { name: `${label}: ${presses > 0 ? 'more' : 'less'}` }))
      return sheet
    }
    // the first press names the other members of this block, in this workout
    const sheet = step(w.member, 'Within round', w.presses)
    const others = wk.exercises.filter((x) => x.block && x.row !== wk.exercises[w.member].row).map((x) => x.name)
    expect(within(sheet).getByText(new RegExp(`^The two rests belong to superset A, so they change it for ${others.length === 1 ? others[0] : `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}`} too\\.`))).toBeTruthy()
    closeDialog(wk.exercises[w.member].name)
    step(a.member, 'After round', a.presses)
    closeDialog(wk.exercises[a.member].name)
    await saveAndExpect(before, (e) => ({
      ...e,
      blocks: e.blocks.map((b) => (b.id === wk.block.id ? { ...b, restWithinRoundSeconds: w.ends, restAfterRoundSeconds: a.ends } : b)),
    }))
    // the other workouts' blocks are as they were
    for (const o of UNEVEN_WORKOUTS.filter((x) => x.id !== wk.id)) {
      const row = world.db.v2_program_superset_blocks.find((b) => b.id === o.block.id)!
      expect([row.rest_within_round_seconds, row.rest_after_round_seconds]).toEqual([o.block.within, o.block.after])
    }
  })
})

// ─── The warmup routine of the workout shown ────────────────────────────────────────────────────────────────────────────────

describe('the warmup routine writes to the workout shown', () => {
  it.each(UNEVEN_WORKOUTS)('ADD ITEM in $name appends to its routine and to no other', async (wk) => {
    await open()
    const before = world
    goTo(wk)
    click('+ ADD ITEM')
    fireEvent.change(screen.getByLabelText('New warmup item'), { target: { value: `Cat-cow, ${wk.routine.length}` } })
    click('ADD')
    expect(routineBodies()).toEqual([...wk.routine, `Cat-cow, ${wk.routine.length}`])
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) {
      goTo(other)
      expect(routineBodies()).toEqual([...other.routine])
    }
    await saveAndExpect(before, (e) => withRoutine(e, wk.id, routineOf(wk, [...wk.routine.map((_, i) => i), `Cat-cow, ${wk.routine.length}`])))
  })

  // The item edited: the second one in Push and Pull, the third in Legs, the first in Arms.
  const EDITS: Record<string, { at: number; body: string }> = {
    push: { at: 1, body: 'Band dislocates, 15' },
    pull: { at: 1, body: 'Scap pull-ups, 10' },
    legs: { at: 2, body: 'Hip airplanes, 8' },
    arms: { at: 0, body: 'Band curls, 20' },
  }
  it.each(UNEVEN_WORKOUTS)('editing an item in $name changes that item of that routine', async (wk) => {
    const { at, body } = EDITS[wk.id]
    await open()
    const before = world
    goTo(wk)
    click(`Edit ${wk.routine[at]}`)
    fireEvent.change(screen.getByLabelText('Warmup item'), { target: { value: body } })
    fireEvent.keyDown(screen.getByLabelText('Warmup item'), { key: 'Enter' })
    expect(routineBodies()).toEqual(wk.routine.map((r, i) => (i === at ? body : r)))
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) {
      goTo(other)
      expect(routineBodies()).toEqual([...other.routine])
    }
    await saveAndExpect(before, (e) => withRoutine(e, wk.id, routineOf(wk, wk.routine.map((_, i) => (i === at ? ([i, body] as const) : i)))))
  })

  it('tapping an item to edit it closes its open ⋯: the menu is not there when the edit is done', async () => {
    await open()
    const wk = UNEVEN_WORKOUTS[2]
    goTo(wk)
    click(`${wk.routine[1]}: options`)
    expect(screen.getByRole('button', { name: 'MOVE UP' })).toBeTruthy()
    click(`Edit ${wk.routine[1]}`)
    expect(screen.queryByRole('button', { name: 'MOVE UP' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Warmup item'), { target: { value: 'Bodyweight squat, 12' } })
    fireEvent.keyDown(screen.getByLabelText('Warmup item'), { key: 'Enter' })
    expect(routineBodies()).toEqual(wk.routine.map((r, i) => (i === 1 ? 'Bodyweight squat, 12' : r)))
    expect(screen.queryByRole('button', { name: 'MOVE UP' })).toBeNull()
  })

  // MOVE DOWN on one item and MOVE UP on another, from the item's ⋯; the bodies after each press are written out.
  interface Move {
    item: string
    press: 'MOVE UP' | 'MOVE DOWN'
    order: string[]
  }
  const MOVES: Record<string, Move[]> = {
    push: [
      { item: 'Arm circles, 30 s', press: 'MOVE DOWN', order: ['Band dislocates, 10', 'Arm circles, 30 s', 'Push-up plus, 8'] },
      { item: 'Push-up plus, 8', press: 'MOVE UP', order: ['Band dislocates, 10', 'Push-up plus, 8', 'Arm circles, 30 s'] },
    ],
    pull: [{ item: 'Dead hang, 30 s', press: 'MOVE DOWN', order: ['Scap pull-ups, 8', 'Dead hang, 30 s'] }],
    legs: [
      { item: 'Bodyweight squat, 10', press: 'MOVE DOWN', order: ['Bike, 5 min', 'Hip airplanes, 6', 'Bodyweight squat, 10', 'Glute bridge, 12'] },
      { item: 'Glute bridge, 12', press: 'MOVE UP', order: ['Bike, 5 min', 'Hip airplanes, 6', 'Glute bridge, 12', 'Bodyweight squat, 10'] },
    ],
    arms: [
      { item: 'Triceps stretch, 20 s', press: 'MOVE DOWN', order: ['Band curls, 15', 'Wrist circles, 10', 'Triceps stretch, 20 s'] },
      { item: 'Wrist circles, 10', press: 'MOVE UP', order: ['Wrist circles, 10', 'Band curls, 15', 'Triceps stretch, 20 s'] },
    ],
  }
  it.each(UNEVEN_WORKOUTS)('MOVE UP and MOVE DOWN in $name’s routine reorder that routine', async (wk) => {
    const moves = MOVES[wk.id]
    await open()
    const before = world
    goTo(wk)
    for (const m of moves) {
      click(`${m.item}: options`)
      click(m.press)
      expect({ item: m.item, order: routineBodies() }).toEqual({ item: m.item, order: m.order })
    }
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) {
      goTo(other)
      expect(routineBodies()).toEqual([...other.routine])
    }
    const last = moves[moves.length - 1].order
    await saveAndExpect(before, (e) => withRoutine(e, wk.id, routineOf(wk, last.map((b) => wk.routine.indexOf(b)))))
  })

  const REMOVES: Record<string, number> = { push: 1, pull: 1, legs: 1, arms: 2 }
  it.each(UNEVEN_WORKOUTS)('REMOVE in $name’s routine (with its confirm) takes that item out of that routine', async (wk) => {
    const at = REMOVES[wk.id]
    await open()
    const before = world
    goTo(wk)
    click(`${wk.routine[at]}: options`)
    click('REMOVE')
    expect(screen.getByText('Remove this item?')).toBeTruthy()
    // CANCEL keeps it; the second REMOVE takes it out
    inConfirm('Remove this item?', 'CANCEL')
    expect(screen.queryByText('Remove this item?')).toBeNull()
    expect(routineBodies()).toEqual([...wk.routine])
    click(`${wk.routine[at]}: options`)
    click('REMOVE')
    inConfirm('Remove this item?', 'REMOVE')
    expect(screen.queryByText('Remove this item?')).toBeNull()
    expect(routineBodies()).toEqual(wk.routine.filter((_, i) => i !== at))
    for (const other of UNEVEN_WORKOUTS.filter((o) => o.id !== wk.id)) {
      goTo(other)
      expect(routineBodies()).toEqual([...other.routine])
    }
    await saveAndExpect(before, (e) => withRoutine(e, wk.id, routineOf(wk, wk.routine.map((_, i) => i).filter((i) => i !== at))))
  })
})

// ─── RENAME ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe.each([
  ['a weekday run (the DAYS card’s RENAME)', 'weekday'],
  ['a sequence run (the row under the chips)', 'sequence'],
] as const)('%s: RENAME', (_label, kind) => {
  beforeEach(() => {
    schedule = kind
    planning = kind === 'sequence' ? 'stable' : 'week_dependent'
    freshWorld()
  })

  const NAMES: Record<string, string> = { push: 'Push A', pull: 'Pull B', legs: 'Leg Day', arms: 'Arm Day' }
  it.each(UNEVEN_WORKOUTS)('RENAME in $name renames that workout, trimmed, and no other', async (wk) => {
    await open()
    goTo(wk)
    click(`Rename ${wk.name}`)
    // the box opens on this workout's own name, ready to type in
    expect((screen.getByLabelText('Workout name') as HTMLInputElement).value).toBe(wk.name)
    expect(document.activeElement).toBe(screen.getByLabelText('Workout name'))
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: `  ${NAMES[wk.id]}  ` } })
    fireEvent.keyDown(screen.getByLabelText('Workout name'), { key: 'Enter' })
    expect(screen.queryByLabelText('Workout name')).toBeNull()
    // the chips: the new name on this workout's, the old on the others'
    const days = (o: UnevenWorkout) => (kind === 'weekday' ? o.day.slice(0, 3).toUpperCase() : '')
    expect(chips().map((b) => b.textContent)).toEqual(UNEVEN_WORKOUTS.map((o) => `${o.id === wk.id ? NAMES[wk.id] : o.name}${days(o)}`))
    await save()
    expect(sent()).toEqual([{ op: 'update', table: 'v2_workout_days', id: wk.id, patch: { name: NAMES[wk.id] } }])
    expect(world.db.v2_workout_days.map((d) => d.name)).toEqual(UNEVEN_WORKOUTS.map((o) => (o.id === wk.id ? NAMES[wk.id] : o.name)))
  })

  // A rename to the name another workout has (the first, the last, the second) is still a rename: it is only a rename to the workout's own name that is none.
  it.each([
    [1, 0],
    [1, 3],
    [2, 1],
    [3, 0],
  ])('a workout can take the name another workout has: workout %i renamed to workout %i’s name', async (renamed, other) => {
    await open()
    const wk = UNEVEN_WORKOUTS[renamed]
    const to = UNEVEN_WORKOUTS[other].name
    goTo(wk)
    click(`Rename ${wk.name}`)
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: to } })
    fireEvent.keyDown(screen.getByLabelText('Workout name'), { key: 'Enter' })
    expect(chips().map((b) => b.querySelector('span')?.textContent)).toEqual(UNEVEN_WORKOUTS.map((o) => (o.id === wk.id ? to : o.name)))
    await save()
    expect(sent()).toEqual([{ op: 'update', table: 'v2_workout_days', id: wk.id, patch: { name: to } }])
  })

  it('Escape, and a blank name, leave the workout as it is', async () => {
    await open()
    const wk = UNEVEN_WORKOUTS[2]
    const chipsBefore = chips().map((b) => b.textContent)
    goTo(wk)
    click(`Rename ${wk.name}`)
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Typed' } })
    fireEvent.keyDown(screen.getByLabelText('Workout name'), { key: 'Escape' })
    expect(screen.queryByLabelText('Workout name')).toBeNull()
    expect(chips().map((b) => b.textContent)).toEqual(chipsBefore)
    click(`Rename ${wk.name}`)
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: '   ' } })
    expect((screen.getByRole('button', { name: 'DONE' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByLabelText('Workout name'), { key: 'Enter' })
    expect(screen.queryByLabelText('Workout name')).toBeNull()
    expect(chips().map((b) => b.textContent)).toEqual(chipsBefore)
    click('CANCEL')
    expect(screen.queryByText('Discard your changes?')).toBeNull()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('switching workouts closes an open RENAME: the name box is not carried to another workout', async () => {
    await open()
    const [a, b] = [UNEVEN_WORKOUTS[1], UNEVEN_WORKOUTS[2]]
    goTo(a)
    click(`Rename ${a.name}`)
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Half typed' } })
    goTo(b)
    expect(screen.queryByLabelText('Workout name')).toBeNull()
    expect(screen.getByRole('button', { name: `Rename ${b.name}` })).toBeTruthy()
    goTo(a)
    expect(screen.queryByLabelText('Workout name')).toBeNull()
    click('CANCEL')
    expect(screen.queryByText('Discard your changes?')).toBeNull()
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

// ─── What a card keeps while the workout shown changes ─────────────────────────────────────────────────────────────────────────────

describe('the warmup routine card starts afresh in each workout', () => {
  it('a new item half typed, an item being edited and an open ⋯ do not follow the user to another workout, nor wait for them there', async () => {
    await open()
    const [a, b] = [UNEVEN_WORKOUTS[1], UNEVEN_WORKOUTS[2]]
    goTo(a)
    click('+ ADD ITEM')
    fireEvent.change(screen.getByLabelText('New warmup item'), { target: { value: 'Half typed' } })
    goTo(b)
    expect(screen.queryByLabelText('New warmup item')).toBeNull()
    expect(screen.getByRole('button', { name: '+ ADD ITEM' })).toBeTruthy()
    goTo(a)
    expect(screen.queryByLabelText('New warmup item')).toBeNull()
    // an item being edited
    click(`Edit ${a.routine[0]}`)
    expect(screen.getByLabelText('Warmup item')).toBeTruthy()
    goTo(b)
    goTo(a)
    expect(screen.queryByLabelText('Warmup item')).toBeNull()
    // an open ⋯
    click(`${a.routine[1]}: options`)
    expect(screen.getByRole('button', { name: 'MOVE UP' })).toBeTruthy()
    goTo(b)
    goTo(a)
    expect(screen.queryByRole('button', { name: 'MOVE UP' })).toBeNull()
    // nothing of it was written
    expect(routineBodies()).toEqual([...a.routine])
    click('CANCEL')
    expect(screen.queryByText('Discard your changes?')).toBeNull()
  })
})

// ─── CANCEL and a change in any workout ───────────────────────────────────────────────────────────────────────────────────────────

describe('CANCEL asks when any workout was changed, and not when the change was put back', () => {
  it.each(UNEVEN_WORKOUTS)('a change in $name: CANCEL asks, DISCARD leaves and nothing is sent', async (wk) => {
    await open()
    goTo(wk)
    click('+ ADD ITEM')
    fireEvent.change(screen.getByLabelText('New warmup item'), { target: { value: 'Cat-cow, 10' } })
    click('ADD')
    goTo(UNEVEN_WORKOUTS.find((o) => o.id !== wk.id)!)
    click('CANCEL')
    expect(screen.getByText('Discard your changes?')).toBeTruthy()
    inConfirm('Discard your changes?', 'DISCARD')
    await screen.findByText('AT PLAN')
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it.each(UNEVEN_WORKOUTS)('a rename of $name put back is no change: CANCEL goes straight back and SAVE sends nothing', async (wk) => {
    await open()
    goTo(wk)
    for (const to of ['Zed', wk.name]) {
      click(`Rename ${to === 'Zed' ? wk.name : 'Zed'}`)
      fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: to } })
      fireEvent.keyDown(screen.getByLabelText('Workout name'), { key: 'Enter' })
    }
    click('SAVE CHANGES')
    await screen.findByText('AT PLAN')
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

// ─── Edits on every workout, in a mixed order, in one save ──────────────────────────────────────────────────────────────────────────

describe('edits on all four workouts in one save', () => {
  it('each lands on its own workout whichever order the workouts were visited in, and nothing else moves', async () => {
    await open()
    const before = world
    const [push, pull, legs, arms] = UNEVEN_WORKOUTS
    // Arms: rename, and swap Dip for Triceps Pushdown (which Push has too)
    goTo(arms)
    click('Rename Arms')
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Arm Day' } })
    fireEvent.keyDown(screen.getByLabelText('Workout name'), { key: 'Enter' })
    click('Swap Dip')
    await pickInSheet('Swap Dip', 'Swap to Triceps Pushdown')
    // Push: remove Overhead Press and move the superset's remaining member and Bench Press by the grip
    goTo(push)
    click('Remove Overhead Press')
    click('REMOVE')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Bench Press' }), { key: 'ArrowDown' })
    // Legs: SUPERSET on Back Squat, and the last routine item out
    goTo(legs)
    click('Link Back Squat with the exercise below')
    click(`${legs.routine[3]}: options`)
    click('REMOVE')
    inConfirm('Remove this item?', 'REMOVE')
    // Pull: add Plank, MOVE UP on Biceps Curl in its ⋯, a routine item added
    goTo(pull)
    click('+ ADD EXERCISE')
    await pickInSheet('Add exercise', 'Add Plank')
    click('Biceps Curl: rest, tempo, unit')
    fireEvent.click(within(dialog('Biceps Curl')).getByRole('button', { name: 'MOVE UP' }))
    closeDialog('Biceps Curl')
    click('+ ADD ITEM')
    fireEvent.change(screen.getByLabelText('New warmup item'), { target: { value: 'Cat-cow, 10' } })
    click('ADD')
    // back through the others: each still shows its own edits
    goToName('Arm Day')
    expect(cardNames()).toEqual(['Cable Curl', 'Hammer Curl', 'Triceps Pushdown', 'Skull Crusher', 'Wrist Curl'])
    goTo(push)
    expect(cardNames()).toEqual(['Lateral Raise', 'Bench Press', 'Triceps Pushdown'])
    expect(screen.getAllByText('REMOVED FROM WEEK 2')).toHaveLength(1)
    await save()
    const expected = expectedFor(before, (e) => {
      let next = editWorkout(e, 'arms', (w) => ({ ...w, name: 'Arm Day' }))
      next = swapExerciseIn(next, 'arms', 'pe-dip', 'ex-pushdown')
      next = removeExerciseFrom(next, 'push', 'pe-ohp')
      next = reorderTo(next, 'push', ['pe-lateral', 'pe-bench', 'pe-pushdown'])
      next = withNewBlock(next, 'legs', ['pe-squat', 'pe-rdl'])
      next = withRoutine(next, 'legs', routineOf(legs, [0, 1, 2]))
      next = reorderTo(next, 'pull', ['pe-bcurl', 'pe-row', 'pe-pd', 'pe-face', 'pe-shrug'])
      next = addExerciseTo(next, 'pull', { exerciseId: 'ex-plank', weightUnit: 'kg' })
      return withRoutine(next, 'pull', routineOf(pull, [0, 1, 'Cat-cow, 10']))
    })
    expect(sent()).toEqual(expected)
  })
})
