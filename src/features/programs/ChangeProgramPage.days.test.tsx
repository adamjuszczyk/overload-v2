// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { queryClient } from '../../lib/queryClient'
import { captureRender } from '../../testing/captureRender'
import { useSettingsStore } from '../settings/settingsStore'
import type { Exercise, MuscleGroup, Mesocycle, Program } from '../../types'
import {
  NOW,
  USER,
  applyOpsToDb,
  inputOf,
  inserts,
  runCopyOf,
  scheduleRowsOf,
  sessionsOf,
  updates,
  type World,
} from './programChange.testutil'
import { sequenceWorld, stableWorld, weekDependentWorld } from './programChange.worlds.testutil'
import { draftFromRunCopy, planProgramChange, type Op, type RunChangeStatus } from './programChange'
import type { ChangeProgramSource } from './changeProgramService'

// Chunk 51b: the DAYS card of a weekday run's CHANGE THE PROGRAM (board PL1; SPEC Programs and runs [1.2] → "Weekdays (1e)", "Weekdays
// storage"; Defaults 2; DECISIONS 169). The screen runs as in the app (the real hooks, the real `planProgramChange` and `applyOps`); what is
// mocked is the edge: the reads, the exercise library and the one request SAVE makes, whose list goes to chunk 45's stand-in for
// migration 043 and is read back as rows.

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
  ex('ex-bench', 'Bench Press', 'chest'),
  ex('ex-pd', 'Lat Pulldown', 'back'),
  ex('ex-face', 'Face Pull', 'shoulders'),
  ex('ex-squat', 'Back Squat', 'quads'),
  ex('ex-row', 'Barbell Row', 'back'),
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

function Tree({ children }: { children?: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <MemoryRouter initialEntries={['/plan', '/plan/change']} initialIndex={1}>
        <Routes>
          <Route path="/plan" element={<div>AT PLAN</div>} />
          <Route path="/plan/change" element={<ChangeProgramPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

async function open(probe?: React.ReactNode) {
  const view = render(<Tree>{probe}</Tree>)
  await screen.findByRole('heading', { name: 'CHANGE THE PROGRAM' })
  return view
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const day = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const isOn = (name: string) => day(name).getAttribute('aria-pressed') === 'true'
const card = () => screen.getByRole('region', { name: /: days$/ })

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

function expectedFor(before: World, edit: (e: ReturnType<typeof draftFromRunCopy>) => ReturnType<typeof draftFromRunCopy>, statusesNow = statuses): Op[] {
  let n = 0
  const input = inputOf(before, edit(draftFromRunCopy(runCopyOf(before.db, before.programId, before.mesocycleId), before.planningType)), {
    statuses: statusesNow,
    newId: () => `id-${++n}`,
  })
  return planProgramChange(input).ops
}

const withDays = (schedule: Record<string, string | null>) => (e: ReturnType<typeof draftFromRunCopy>) => ({ ...e, schedule: { ...e.schedule, ...schedule } as typeof e.schedule })

// ─── The card ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the DAYS card of a weekday run (board PL1)', () => {
  it('is the first card, for the selected workout: its name, seven toggles with the days it is on pressed, and the cards after it renumbered', async () => {
    await open()
    expect(within(card()).getByText('1 · FULL BODY · DAYS')).toBeTruthy()
    expect(screen.getByText('2 · WARMUP ROUTINE')).toBeTruthy()
    expect(screen.getByText('3 · EXERCISES · DRAG TO REORDER')).toBeTruthy()
    expect(within(card()).getByRole('group', { name: 'Full Body days' })).toBeTruthy()
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    expect(names.map((n) => isOn(n))).toEqual([false, true, false, true, false, false, false])
    expect(names.map((n) => day(n).textContent).join('')).toBe('MTWTFSS')
    // nothing changed: no line about new days
    expect(screen.queryByText(/New days start in week/)).toBeNull()
  })

  it('RENAME is in the card’s header (PL1), and renames the selected workout', async () => {
    await open()
    fireEvent.click(within(card()).getByRole('button', { name: 'Rename Full Body' }))
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Full Body A' } })
    click('DONE')
    expect(within(card()).getByText('1 · FULL BODY A · DAYS')).toBeTruthy()
    await save()
    expect(sent().map((o) => [o.op, o.table])).toEqual([['update', 'v2_workout_days']])
  })

  it('the WORKOUTS pills show each workout’s days, the draft’s: a toggle is on its pill at once', async () => {
    await open()
    expect(screen.getByRole('button', { name: /^Full BodyTUE · THU$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^ArmsSAT$/ })).toBeTruthy()
    click('Wednesday')
    expect(screen.getByRole('button', { name: /^Full BodyTUE · WED · THU$/ })).toBeTruthy()
    click('Tuesday')
    expect(screen.getByRole('button', { name: /^Full BodyWED · THU$/ })).toBeTruthy()
  })

  it('a day another workout uses is disabled and the card says whose day it is; it can’t be turned on', async () => {
    await open()
    expect(day('Saturday').disabled).toBe(true)
    expect(within(card()).getByText("Sat is Arms's day")).toBeTruthy()
    fireEvent.click(day('Saturday'))
    expect(isOn('Saturday')).toBe(false)
    // the free days are not disabled
    for (const free of ['Monday', 'Wednesday', 'Friday', 'Sunday']) expect(day(free).disabled).toBe(false)
  })

  it('the last day can’t be turned off, and the card says so; Full Body, with two, can give one up', async () => {
    await open()
    expect(screen.queryByText('At least one day stays on.')).toBeNull()
    click('Thursday')
    expect(isOn('Thursday')).toBe(false)
    expect(day('Tuesday').disabled).toBe(true)
    expect(screen.getByText('At least one day stays on.')).toBeTruthy()
    fireEvent.click(day('Tuesday'))
    expect(isOn('Tuesday')).toBe(true)
    // Arms has one day: Saturday is its last
    click(/^Arms/)
    expect(day('Saturday').disabled).toBe(true)
    expect(isOn('Saturday')).toBe(true)
    expect(screen.getByText('At least one day stays on.')).toBeTruthy()
  })

  it('says when the new days start, and what this week does: "Was Tuesday and Thursday. New days start in week 3. …"', async () => {
    await open()
    click('Wednesday')
    expect(
      screen.getByText('Was Tuesday and Thursday. New days start in week 3. This week Full Body stays on Tuesday and Thursday; MOVE THIS SESSION in Plan moves just this week.'),
    ).toBeTruthy()
    click('Wednesday')
    expect(screen.queryByText(/New days start in week/)).toBeNull()
  })

  it('a day this week is on and the edit turns off is struck through', async () => {
    await open()
    click('Tuesday')
    expect(day('Tuesday').style.textDecoration).toBe('line-through')
    expect(day('Thursday').style.textDecoration).toBe('none')
    click('Tuesday')
    expect(day('Tuesday').style.textDecoration).toBe('none')
  })

  it('a day toggled and put back is no change: CANCEL goes straight back, and SAVE sends nothing', async () => {
    await open()
    click('Friday')
    click('Friday')
    click('SAVE CHANGES')
    await waitFor(() => expect(screen.getByText('AT PLAN')).toBeTruthy())
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('a toggle is a change: CANCEL asks before it leaves', async () => {
    await open()
    click('Friday')
    click('CANCEL')
    expect(screen.getByText('Discard your changes?')).toBeTruthy()
    expect(screen.queryByText('AT PLAN')).toBeNull()
  })

  it('the card follows the workout selected: the other workout’s name and days', async () => {
    await open()
    click(/^Arms/)
    expect(within(card()).getByText('1 · ARMS · DAYS')).toBeTruthy()
    expect(isOn('Saturday')).toBe(true)
    expect(isOn('Tuesday')).toBe(false)
    expect(day('Tuesday').disabled).toBe(true)
    expect(within(card()).getByText("Tue is Full Body's day")).toBeTruthy()
    expect(within(card()).getByText("Thu is Full Body's day")).toBeTruthy()
  })

  it('a sequence run has no DAYS card (absence), no days on its pills, and its RENAME stays under the chips; its cards are 1 and 2', async () => {
    useWorld(sequenceWorld(), {})
    await open()
    expect(screen.queryByRole('region', { name: /: days$/ })).toBeNull()
    expect(screen.queryByRole('group', { name: /days$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Monday' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Rotation A$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename Rotation A' })).toBeTruthy()
    expect(screen.getByText('1 · WARMUP ROUTINE')).toBeTruthy()
    expect(screen.getByText('2 · EXERCISES · DRAG TO REORDER')).toBeTruthy()
  })

  it('a week-dependent run has the card too', async () => {
    useWorld(weekDependentWorld(), {})
    await open()
    expect(within(card()).getByText('1 · PUSH · DAYS')).toBeTruthy()
    expect(isOn('Monday')).toBe(true)
    expect(day('Tuesday').disabled).toBe(true)
    expect(within(card()).getByText("Tue is Pull's day")).toBeTruthy()
  })
})

// ─── What SAVE writes (W) ────────────────────────────────────────────────────────────────────────────────────────────────

describe('SAVE with the weekdays changed (W)', () => {
  it('a run with no rows: from_week 1 with the old days, from_week 3 with the new, and the run copy’s schedule; no session row', async () => {
    await open()
    const before = world
    click('Wednesday')
    click('Tuesday')
    await save()
    const ops = sent()
    expect(ops).toEqual(expectedFor(before, withDays({ tuesday: null, wednesday: 'fb' })))
    const rows = inserts(ops, 'v2_run_schedules').map((o) => o.row)
    expect(rows.map((r) => r.from_week)).toEqual([1, 3])
    expect([rows[0].schedule.tuesday, rows[0].schedule.wednesday, rows[0].schedule.thursday]).toEqual(['fb', null, 'fb'])
    expect([rows[1].schedule.tuesday, rows[1].schedule.wednesday, rows[1].schedule.thursday]).toEqual([null, 'fb', 'fb'])
    expect(rows[1].schedule.saturday).toBe('arms')
    expect(updates(ops, 'v2_programs').map((o) => o.patch.schedule?.wednesday)).toEqual(['fb'])
    expect(ops.some((o) => o.table.startsWith('v2_week_plan'))).toBe(false)
    // the rows the list leaves
    const db = world.db
    expect(db.v2_run_schedules.map((r) => [r.mesocycle_id, r.from_week]).sort()).toEqual([['meso', 1], ['meso', 3]])
    expect(db.v2_programs[0].schedule).toMatchObject({ wednesday: 'fb', thursday: 'fb', saturday: 'arms', tuesday: null })
  })

  it('a run that already has rows only gets the new one (the fixture tells the two apart)', async () => {
    const w = stableWorld()
    w.db.v2_run_schedules.push({ id: 'r1', user_id: USER, mesocycle_id: w.mesocycleId, from_week: 1, schedule: { tuesday: 'fb', thursday: 'fb', saturday: 'arms' } })
    useWorld(w)
    await open()
    click('Friday')
    await save()
    const ops = sent()
    expect(inserts(ops, 'v2_run_schedules').map((o) => o.row.from_week)).toEqual([3])
    expect(updates(ops, 'v2_run_schedules')).toEqual([])
    expect(world.db.v2_run_schedules.map((r) => r.from_week).sort()).toEqual([1, 3])
  })

  it('a second change in the same week is written over the first one’s row', async () => {
    const w = stableWorld()
    w.db.v2_programs[0].schedule = { tuesday: 'fb', thursday: 'fb', saturday: 'arms', monday: 'fb' }
    w.db.v2_run_schedules.push(
      { id: 'r1', user_id: USER, mesocycle_id: w.mesocycleId, from_week: 1, schedule: { tuesday: 'fb', thursday: 'fb', saturday: 'arms' } },
      { id: 'r3', user_id: USER, mesocycle_id: w.mesocycleId, from_week: 3, schedule: { monday: 'fb', tuesday: 'fb', thursday: 'fb', saturday: 'arms' } },
    )
    useWorld(w)
    await open()
    // the days in force this week are Tuesday, Thursday; the saved change already puts Monday on from week 3
    expect(isOn('Monday')).toBe(true)
    expect(screen.getByText('Was Tuesday and Thursday. New days start in week 3. This week Full Body stays on Tuesday and Thursday; MOVE THIS SESSION in Plan moves just this week.')).toBeTruthy()
    click('Monday')
    click('Friday')
    await save()
    const ops = sent()
    expect(inserts(ops, 'v2_run_schedules')).toEqual([])
    expect(updates(ops, 'v2_run_schedules').map((o) => [o.id, o.patch.schedule?.monday ?? null, o.patch.schedule?.friday])).toEqual([['r3', null, 'fb']])
  })

  it('two workouts trade days in one save: the day Full Body gives up is Arms’s to take, as the edit stands (DECISIONS 169)', async () => {
    await open()
    const before = world
    // Arms can't take Thursday while Full Body is on it
    click(/^Arms/)
    expect(day('Thursday').disabled).toBe(true)
    click(/^Full Body/)
    click('Thursday')
    click(/^Arms/)
    expect(day('Thursday').disabled).toBe(false)
    click('Thursday')
    expect(isOn('Thursday')).toBe(true)
    // and Full Body can't take it back
    click(/^Full Body/)
    expect(day('Thursday').disabled).toBe(true)
    expect(within(card()).getByText("Thu is Arms's day")).toBeTruthy()
    await save()
    expect(sent()).toEqual(expectedFor(before, withDays({ thursday: 'arms' })))
    expect(world.db.v2_programs[0].schedule).toMatchObject({ tuesday: 'fb', thursday: 'arms', saturday: 'arms' })
    const last = world.db.v2_run_schedules.find((r) => r.from_week === 3)!
    expect(last.schedule).toMatchObject({ tuesday: 'fb', thursday: 'arms', saturday: 'arms' })
  })

  it('a weekday change with a rename and a sets edit lands in the same one request', async () => {
    await open()
    click('Friday')
    fireEvent.click(within(card()).getByRole('button', { name: 'Rename Full Body' }))
    fireEvent.change(screen.getByLabelText('Workout name'), { target: { value: 'Full Body 2' } })
    click('DONE')
    click('Add a set to Incline Press')
    await save()
    const tables = new Set(sent().map((o) => o.table))
    expect([...tables].sort()).toEqual(['v2_program_sets', 'v2_programs', 'v2_run_schedules', 'v2_week_plan_sets', 'v2_workout_days'])
  })

  it('this week’s sessions keep their days: the same plan rows, and the scheduler resolves week 2 to the old days and week 3 to the new', async () => {
    const { scheduleForWeek, WEEKDAYS } = await import('./runSchedule')
    await open()
    const planRowsBefore = JSON.stringify(world.db.v2_week_plans)
    click('Wednesday')
    click('Tuesday')
    await save()
    expect(JSON.stringify(world.db.v2_week_plans)).toBe(planRowsBefore)
    const rows = scheduleRowsOf(world.db, 'meso')
    const daysOf = (week: number) => WEEKDAYS.filter((d) => scheduleForWeek(rows, runCopyOf(world.db, 'prog', 'meso').schedule, week)[d] === 'fb')
    expect(daysOf(1)).toEqual(['tuesday', 'thursday'])
    expect(daysOf(2)).toEqual(['tuesday', 'thursday'])
    expect(daysOf(3)).toEqual(['wednesday', 'thursday'])
    expect(daysOf(4)).toEqual(['wednesday', 'thursday'])
  })
})

// ─── The caches (the carry note from 51a's review) ───────────────────────────────────────────────────────────────────────

describe('SAVE invalidates after the write, and the schedule rows are among what it stales', () => {
  function Probe({ onFetch }: { onFetch: () => unknown }) {
    const q = useQuery({ queryKey: ['v2_programs'], queryFn: async () => onFetch() })
    return <span data-testid="probe">{JSON.stringify(q.data ?? null)}</span>
  }
  function ScheduleProbe({ onFetch }: { onFetch: () => unknown }) {
    const q = useQuery({ queryKey: ['v2_runSchedules', 'meso'], queryFn: async () => onFetch() })
    return <span data-testid="schedule-probe">{JSON.stringify(q.data ?? null)}</span>
  }

  it('nothing the screen watches is refetched before the request lands; once it has, the program and the schedule rows are read again and hold the new days', async () => {
    let release: (() => void) | undefined
    h.rpc.mockReset().mockImplementation(
      (_fn: string, args: { p_ops: Op[] }) =>
        new Promise((resolve) => {
          release = () => {
            world = { ...world, db: applyOpsToDb(world.db, args.p_ops) }
            resolve({ data: args.p_ops.length, error: null })
          }
        }),
    )
    const programReads = vi.fn(() => world.db.v2_programs[0].schedule)
    const scheduleReads = vi.fn(() => world.db.v2_run_schedules.map((r) => r.from_week))
    await open(
      <>
        <Probe onFetch={programReads} />
        <ScheduleProbe onFetch={scheduleReads} />
      </>,
    )
    await waitFor(() => expect(programReads).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(scheduleReads).toHaveBeenCalledTimes(1))
    click('Friday')
    click('SAVE CHANGES')
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    // the write has not landed: neither cache has been touched
    expect(programReads).toHaveBeenCalledTimes(1)
    expect(scheduleReads).toHaveBeenCalledTimes(1)
    await act(async () => {
      release?.()
    })
    await waitFor(() => expect(programReads).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(scheduleReads).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"friday":"fb"'))
    expect(screen.getByTestId('schedule-probe').textContent).toBe('[1,3]')
  })

  it('a save that changes no weekday does not stale the schedule rows', async () => {
    const scheduleReads = vi.fn(() => [] as number[])
    await open(<ScheduleProbe onFetch={scheduleReads} />)
    await waitFor(() => expect(scheduleReads).toHaveBeenCalledTimes(1))
    click('Add a set to Incline Press')
    await save()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(scheduleReads).toHaveBeenCalledTimes(1)
  })
})

// ─── Captured for the 390 px pictures (design/1.2/built) ─────────────────────────────────────────────────────────────────

describe('draws board PL1 (the week-dependent screen with its DAYS card)', () => {
  it('PL1: Pull moves from Tuesday to Wednesday, with its new exercise, a changed marker, a removed one and a superset', async () => {
    useWorld(weekDependentWorld(), {})
    const { container } = await open()
    click(/^Pull/)
    click('Wednesday')
    click('Tuesday')
    click('Link Lat Pulldown with the exercise below')
    click('Remove Face Pull')
    click('REMOVE')
    click('+ ADD EXERCISE')
    const sheet = await screen.findByRole('dialog', { name: 'Add exercise' })
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Add Cable Curl' }))
    click('Cable Curl: rest, tempo, unit')
    fireEvent.change(within(screen.getByRole('dialog', { name: 'Cable Curl' })).getByLabelText('Tempo'), { target: { value: '3-0-1-0' } })
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Cable Curl' })).getByRole('button', { name: 'Close' }))
    captureRender('change-program-days-page', container)
  })

  it('the DAYS card’s states: a day taken by another workout, the last day, and a day struck through', async () => {
    useWorld(weekDependentWorld(), {})
    const { container } = await open()
    click(/^Push/)
    captureRender('change-program-days-last-day', container)
    click(/^Pull/)
    click('Wednesday')
    click('Tuesday')
    captureRender('change-program-days-moved', container)
  })
})
