// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import type { Mesocycle, Program } from '../../types'
import { NOW, applyOpsToDb, runCopyOf, scheduleRowsOf, sessionsOf, type World } from './programChange.testutil'
import { stableWorld } from './programChange.worlds.testutil'
import type { Op } from './programChange'
import type { ChangeProgramSource } from './changeProgramService'
import {
  addRoutineItem,
  addSet,
  renameWorkout,
  setBlockRest,
  setExerciseRest,
  toggleWorkoutDay,
  type DraftState,
} from './changeProgramDraft'

// Chunk 51b (the carry notes of 51a's review): what SAVE makes stale, tested against the app's OWN read hooks. 51a's review broke two entries
// of the invalidation map (the warmup items' key and the superset blocks' key) and no test noticed; the keys "read right against the hooks",
// and nothing pinned them. Here the hooks are the real ones (`usePrograms`, `useWorkoutDays`, `useProgramExercises`, `useProgramSets`,
// `useSupersetBlockRests`, `useWarmupRoutineItems`, `useRunSchedule`), mounted beside `useChangeProgram`, each over a counted read; SAVE runs
// a list that writes each table, and the reads that are asked for again are the proof. A key that is spelt differently from its hook's, or
// dropped from the map, leaves its hook unread. Also here: `weekOfRun` at the Sunday / Monday boundary (a save's `from_week` is that week +
// 1, so a week that is off by one writes the new days from the wrong week) and the map as a table.

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  fetchSource: vi.fn(),
  programs: vi.fn(),
  workoutDays: vi.fn(),
  programExercises: vi.fn(),
  programSets: vi.fn(),
  blocks: vi.fn(),
  warmup: vi.fn(),
  schedule: vi.fn(),
  weekPlans: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => h.rpc(...args),
    // the one table the real `useRunSchedule` reads, answered with the reads' count
    from: (...args: unknown[]) => {
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'order', 'range']) chain[method] = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: h.schedule(...args) ?? [], error: null })
      return chain
    },
  },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-test' }, loading: false, signOut: vi.fn() }) }))
vi.mock('./changeProgramService', () => ({ fetchChangeProgramSource: (...args: unknown[]) => h.fetchSource(...args) }))
vi.mock('./programService', async (original) => ({
  ...(await original<typeof import('./programService')>()),
  fetchPrograms: (...args: unknown[]) => h.programs(...args),
  fetchWorkoutDays: (...args: unknown[]) => h.workoutDays(...args),
  fetchProgramExercises: (...args: unknown[]) => h.programExercises(...args),
  fetchSupersetBlockRests: (...args: unknown[]) => h.blocks(...args),
}))
vi.mock('./warmupRoutineService', async (original) => ({
  ...(await original<typeof import('./warmupRoutineService')>()),
  fetchWarmupItems: (...args: unknown[]) => h.warmup(...args),
}))
vi.mock('../planner/plannerService', async (original) => ({
  ...(await original<typeof import('../planner/plannerService')>()),
  fetchProgramSets: (...args: unknown[]) => h.programSets(...args),
}))

const { useChangeProgram, weekOfRun, queryKeysTouchedBy } = await import('./useChangeProgram')
const { usePrograms, useWorkoutDays, useProgramExercises, useSupersetBlockRests, useWarmupRoutineItems } = await import('./usePrograms')
const { useProgramSets } = await import('../planner/usePlanner')
const { useRunSchedule } = await import('../plan/useRunSchedule')

// ─── weekOfRun ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('weekOfRun: the calendar week, Monday-anchored (RULES.md: meso week numbers)', () => {
  afterEach(() => vi.useRealTimers())
  const at = (y: number, month: number, day: number, hour = 12, minute = 0) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(y, month - 1, day, hour, minute)) // local time, whatever the machine's zone
  }

  it.each([
    ['Monday 00:00 of week 1', [2026, 10, 5, 0, 0], 1],
    ['Sunday 23:59 of week 1', [2026, 10, 11, 23, 59], 1],
    ['Monday 00:00 of week 2', [2026, 10, 12, 0, 0], 2],
    ['Thursday of week 2', [2026, 10, 15, 12, 0], 2],
    ['Sunday 23:59 of week 2', [2026, 10, 18, 23, 59], 2],
    ['Monday 00:00 of week 3', [2026, 10, 19, 0, 0], 3],
    ['Sunday 23:59 of week 3', [2026, 10, 25, 23, 59], 3],
    ['Monday 00:00 of week 4', [2026, 10, 26, 0, 0], 4],
  ] as const)('a run that began on Monday 2026-10-05: %s is week %i', (_name, when, week) => {
    at(...(when as [number, number, number, number, number]))
    expect(weekOfRun('2026-10-05')).toBe(week)
  })

  it('a run that began mid-week has its week 2 from the next Monday, not seven days after it began', () => {
    at(2026, 10, 11, 23, 59) // Sunday
    expect(weekOfRun('2026-10-07')).toBe(1) // began on a Wednesday
    at(2026, 10, 12, 0, 0) // Monday
    expect(weekOfRun('2026-10-07')).toBe(2)
    at(2026, 10, 14, 12, 0) // the Wednesday seven days after it began is still week 2
    expect(weekOfRun('2026-10-07')).toBe(2)
  })

  it('a run whose start date is still ahead is in week 1', () => {
    at(2026, 10, 12)
    expect(weekOfRun('2026-10-26')).toBe(1)
  })
})

// ─── queryKeysTouchedBy, as a table ──────────────────────────────────────────────────────────────────────────────────────

const op = (table: Op['table']): Op => ({ op: 'delete', table, id: 'x' }) as Op
const keysOf = (...tables: Op['table'][]) => queryKeysTouchedBy(tables.map(op)).map((k) => k[0]).sort()

describe('queryKeysTouchedBy: which caches a list makes stale', () => {
  it.each([
    ['v2_programs', ['v2_programs', 'v2_workoutDays']],
    ['v2_workout_days', ['v2_programs', 'v2_workoutDays']],
    ['v2_program_exercises', ['v2_allWeekPlans', 'v2_programExercises', 'v2_programSets', 'v2_weekPlan', 'v2_weekPlans']],
    ['v2_program_sets', ['v2_allWeekPlans', 'v2_programExercises', 'v2_programSets', 'v2_weekPlan', 'v2_weekPlans']],
    ['v2_program_superset_blocks', ['v2_allWeekPlans', 'v2_programSupersetBlocks', 'v2_weekPlan', 'v2_weekPlans']],
    ['v2_workout_warmup_items', ['v2_workoutWarmupItems']],
    ['v2_run_schedules', ['v2_runSchedules']],
    ['v2_week_plans', ['v2_allWeekPlans', 'v2_weekPlan', 'v2_weekPlans']],
    ['v2_week_plan_exercises', ['v2_allWeekPlans', 'v2_weekPlan', 'v2_weekPlans']],
    ['v2_week_plan_sets', ['v2_allWeekPlans', 'v2_weekPlan', 'v2_weekPlans']],
  ] as const)('%s', (table, keys) => {
    expect(keysOf(table)).toEqual([...keys])
  })

  it('an empty list stales nothing, and a list is the union of its tables', () => {
    expect(queryKeysTouchedBy([])).toEqual([])
    expect(keysOf('v2_workout_warmup_items', 'v2_run_schedules')).toEqual(['v2_runSchedules', 'v2_workoutWarmupItems'])
  })
})

// ─── The map against the app's own hooks ──────────────────────────────────────────────────────────────────────────────────

let world: World
let statuses: Record<string, 'done' | 'in_progress' | 'not_started'>
let screen: ReturnType<typeof useChangeProgram>

const meso: Mesocycle = { id: 'meso', userId: 'u-test', name: 'Full Body', programId: 'prog', status: 'active', startDate: '2026-10-05', endDate: null, createdAt: '', sourceProgramId: 'saved' }
const program: Program = { id: 'prog', userId: 'u-test', name: 'Full Body (run)', schedule: {} as Program['schedule'], workoutDays: [], createdAt: '', updatedAt: '', kind: 'run', planningType: 'stable', scheduleType: 'weekday' }

function sourceOf(w: World): ChangeProgramSource {
  return {
    runCopy: runCopyOf(w.db, w.programId, w.mesocycleId),
    exercises: [],
    sessions: sessionsOf(w.db, w.mesocycleId, statuses, w.currentWeek),
    scheduleRows: scheduleRowsOf(w.db, w.mesocycleId),
  }
}

// The app's own read hooks over counted reads, beside `useChangeProgram`.
function Screen() {
  screen = useChangeProgram({ meso, program, savedName: 'Full Body', currentWeek: 2, onDone: () => undefined })
  usePrograms()
  useWorkoutDays('prog')
  useProgramExercises('fb')
  useProgramSets(['pe-leg'])
  useSupersetBlockRests('fb')
  useWarmupRoutineItems('fb')
  useRunSchedule('meso')
  useQuery({ queryKey: ['v2_weekPlans', 'meso', 2], queryFn: async () => h.weekPlans() })
  useQuery({ queryKey: ['v2_allWeekPlans', 'meso'], queryFn: async () => h.weekPlans() })
  useQuery({ queryKey: ['v2_weekPlan', 'p2-fb'], queryFn: async () => h.weekPlans() })
  return null
}

const READS = ['programs', 'workoutDays', 'programExercises', 'programSets', 'blocks', 'warmup', 'schedule', 'weekPlans'] as const
const counts = () => Object.fromEntries(READS.map((r) => [r, h[r].mock.calls.length])) as Record<(typeof READS)[number], number>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false } })
  world = stableWorld()
  statuses = {}
  h.rpc.mockReset().mockImplementation(async (_fn: string, args: { p_ops: Op[] }) => {
    world = { ...world, db: applyOpsToDb(world.db, args.p_ops) }
    return { data: args.p_ops.length, error: null }
  })
  h.fetchSource.mockReset().mockImplementation(async () => sourceOf(world))
  for (const r of READS) h[r].mockReset().mockImplementation(async () => [])
  let n = 0
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `id-${++n}` as ReturnType<typeof crypto.randomUUID>)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function mountAndRead() {
  render(
    <QueryClientProvider client={queryClient}>
      <Screen />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.draft).not.toBeNull())
  await waitFor(() => expect(READS.every((r) => h[r].mock.calls.length >= 1)).toBe(true))
  return counts()
}

async function saveAfter(edit: (s: DraftState) => DraftState) {
  act(() => screen.update(edit))
  await act(async () => {
    await screen.save()
  })
  expect(screen.saveError).toBeNull()
  expect(h.rpc).toHaveBeenCalledTimes(1)
}

// Which reads were asked for again, by name. `weekPlans` is three hooks' keys (the week, the weeks, all weeks) over one count.
const AGAIN: Partial<Record<(typeof READS)[number], number>> = { weekPlans: 3 }
async function reread(before: ReturnType<typeof counts>, expected: ReadonlyArray<(typeof READS)[number]>) {
  await waitFor(() => {
    const now = counts()
    for (const r of expected) expect(now[r], `${r} was read again`).toBe(before[r] + (AGAIN[r] ?? 1))
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
  const now = counts()
  for (const r of READS) if (!expected.includes(r)) expect(now[r], `${r} was not read again`).toBe(before[r])
}

describe('SAVE reads again what its list touched, through the keys the app’s own hooks use', () => {
  it('the warmup routine’s items: a routine edit rereads them (and only them)', async () => {
    const before = await mountAndRead()
    await saveAfter((s) => addRoutineItem(s, 'fb', 'Arm circles'))
    await reread(before, ['warmup'])
  })

  it('the superset blocks: a round rest rereads them and the cached weeks', async () => {
    const before = await mountAndRead()
    const blockId = 'blk'
    await saveAfter((s) => setBlockRest(s, blockId, 'restAfterRoundSeconds', 120))
    await reread(before, ['blocks', 'weekPlans'])
  })

  it('the run copy’s exercises, its sets and the cached weeks: a rest edit', async () => {
    const before = await mountAndRead()
    await saveAfter((s) => setExerciseRest(s, 'fb', 'e:pe-leg', 'restSeconds', 90))
    await reread(before, ['programExercises', 'programSets', 'weekPlans'])
  })

  it('and a set edit (a stable run’s default sets)', async () => {
    const before = await mountAndRead()
    await saveAfter((s) => addSet(s, 'fb', 'e:pe-inc'))
    await reread(before, ['programExercises', 'programSets', 'weekPlans'])
  })

  it('a rename: the workouts and the programs, not the weeks', async () => {
    const before = await mountAndRead()
    await saveAfter((s) => renameWorkout(s, 'fb', 'Full Body 2'))
    await reread(before, ['workoutDays', 'programs'])
  })

  it('a weekday change: the programs, the workouts and the schedule rows (chunk 50’s key), not the weeks', async () => {
    const before = await mountAndRead()
    await saveAfter((s) => toggleWorkoutDay(s, 'fb', 'friday', true))
    await reread(before, ['programs', 'workoutDays', 'schedule'])
  })
})
