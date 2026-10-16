// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { format, subWeeks } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, WeekPlanSet, Exercise } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import type { MakeDefaultResult } from './makeWeekDefault'
import { useToastStore } from '../notifications/toastStore'

// Chunk 32 — "Make this week the new default" ships WITHOUT an "Apply this change to planned
// weeks ahead" offer (taken out after review; recoverable from commit 933f2a1). This file
// proves the ABSENCE all the way through: nothing is mocked but the Supabase-touching leaves
// (makeDefaultService.ts, weekPlanService.ts, useAuth and the other screens' data hooks), so
// the REAL useMakeWeekDefault, the REAL week-plan hooks and the REAL banner component are
// there to be reached, and after a successful make-default with later weeks planned:
//   - no apply-ahead banner is on the screen, and
//   - not one function of weekPlanService.ts that writes was called (every export of the
//     file is a recorded stub, read off the file, so a write added later is recorded too).
// PlanPage.makeDefault.test.tsx proves the same at the screen with the hooks mocked.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  useToastStore.getState().clear()
})

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active',
  startDate: format(subWeeks(new Date(), 2), 'yyyy-MM-dd'), // the current week is 3
  endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
  workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'stable',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

const EX_A: Exercise = {
  id: 'ex-a', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
const bench = (): ProgramExercise => ({ id: 'pe-bench', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0, weightUnit: null, exercise: EX_A })

function planSet(weekNumber: number, id: string, setNumber: number, programSetId: string | null, overrides: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id: `${id}-w${weekNumber}`, weekPlanId: `wp-${weekNumber}`, userId: 'user-1', programExerciseId: 'pe-bench', setNumber, targetRir: null,
    isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId, repMin: 8, repMax: 10, ...overrides,
  }
}

// A planned week: Bench Press, two sets at 8–10 naming the run copy's program sets.
function week(weekNumber: number, overrides: Partial<WeekPlan> = {}): WeekPlan {
  return {
    id: `wp-${weekNumber}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber, isDeload: false, notes: null,
    exercises: [bench()], sets: [planSet(weekNumber, 's1', 1, 'ps-1'), planSet(weekNumber, 's2', 2, 'ps-2')],
    createdAt: '2026-01-01T00:00:00Z', ...overrides,
  }
}

let allPlans: WeekPlan[] = []

const answer = (skipped: MakeDefaultResult['skipped'] = []): MakeDefaultResult => ({ mesocycleId: 'meso-1', weekNumber: 3, skipped })
const makeWeekDefaultMock = vi.fn()

// Every function weekPlanService.ts exports, read off the file. The three reads answer from `allPlans`; every
// other export is a stub that records its name (and answers what its callers need), so ANY write to a week,
// by any path, is seen, including one that does not exist yet.
const WEEK_PLAN_SERVICE_EXPORTS = [...readFileSync(resolve(process.cwd(), 'src/features/plan/weekPlanService.ts'), 'utf8').matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1])
const READS = new Set(['fetchWeekPlans', 'fetchAllWeekPlansForMeso', 'fetchWeekPlanById'])
// Not a write to a week's content: the page plans the week it opens (v2_plan_week leaves rows that exist as
// they are), whenever a week is viewed, with or without this action.
const OPENING_A_WEEK = new Set(['planWeek'])
const serviceCalls: string[] = []

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', async () => ({
  ...(await import('./structureHooks.testutil')).quietProgramsHooks,
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./structureHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
// The service's only export is the call itself (a factory mock throws for any other name asked of it).
vi.mock('./makeDefaultService', () => ({
  makeWeekDefault: (...args: unknown[]) => makeWeekDefaultMock(...args),
}))
vi.mock('./weekPlanService', () => {
  const mod: Record<string, unknown> = {
    fetchWeekPlans: async (_mesoId: string, weekNumber: number) => allPlans.filter((p) => p.weekNumber === weekNumber),
    fetchAllWeekPlansForMeso: async () => allPlans,
    fetchWeekPlanById: async () => null,
  }
  for (const name of WEEK_PLAN_SERVICE_EXPORTS) {
    if (READS.has(name)) continue
    mod[name] = async () => {
      serviceCalls.push(name)
      return name === 'createWeekPlan' ? { id: 'wp-new' } : name === 'planWeek' ? 0 : undefined
    }
  }
  return mod
})

const { default: PlanPage } = await import('./PlanPage')

afterEach(() => {
  makeWeekDefaultMock.mockReset()
  serviceCalls.length = 0
})

function renderPlanPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
const ACTION = 'MAKE THIS WEEK THE NEW DEFAULT'

// Opens the page, lets it settle, taps the action and CONFIRM. What the page did to mount is not what is asked
// about, so the record starts at the tap.
async function confirmMakeDefault() {
  renderPlanPage()
  fireEvent.click(await screen.findByText(ACTION))
  await settle()
  serviceCalls.length = 0
  fireEvent.click(screen.getByText('MAKE DEFAULT'))
}

// What was written to a week since the tap: every call of the service that is not a read.
const writesToWeeks = () => serviceCalls.filter((name) => !OPENING_A_WEEK.has(name))

describe('the proof can fail: the recorder sees what it is meant to see', () => {
  it('knows the service\'s reads and its writes, and records a write made through it', async () => {
    expect(WEEK_PLAN_SERVICE_EXPORTS).toEqual(expect.arrayContaining(['fetchWeekPlans', 'fetchAllWeekPlansForMeso', 'updateSet', 'removeSet', 'addSet', 'swapWeekExercise', 'repointWeekExercise', 'addWeekExercise', 'removeWeekExercise', 'reorderWeekExercises', 'copyFromPreviousWeek', 'markWeekDeload']))
    const service = await import('./weekPlanService')
    await service.updateSet('s1-w4', { repMin: 5 })
    await service.removeWeekExercise('wp-4', 'pe-bench')
    expect(writesToWeeks()).toEqual(['updateSet', 'removeWeekExercise'])
    await expect(service.fetchWeekPlans('meso-1', 3)).resolves.toEqual([])
    expect(writesToWeeks()).toHaveLength(2) // a read is not recorded
  })
})

describe('PlanPage — make this week the default: nothing follows it (real hooks)', () => {
  // Week 3 is the source; 4 and 5 hold exactly what the run's copy had, 6 is a deload session, 7 has a rep target of
  // its own. The offer that used to follow would have rewritten parts of 4, 5 and 7.
  const laterWeeks = () => [
    week(3),
    week(4),
    week(5),
    week(6, { isDeload: true }),
    week(7, { sets: [planSet(7, 's1', 1, 'ps-1'), planSet(7, 's2', 2, 'ps-2', { repMin: 12, repMax: 12 })] }),
  ]

  it('confirm calls the function with the run and the week, once', async () => {
    allPlans = laterWeeks()
    makeWeekDefaultMock.mockResolvedValue(answer())
    await confirmMakeDefault()
    await waitFor(() => expect(makeWeekDefaultMock).toHaveBeenCalledTimes(1))
    expect(makeWeekDefaultMock).toHaveBeenCalledWith('meso-1', 3)
  })

  // Break: show an offer again after a success: the banner, a hand-over to apply-ahead (useApplyAhead), or any
  // write to a week -> the banner is on the screen, or a write is recorded, and this fails.
  it('a success with later weeks planned: the toast, no banner, and not one write to any week', async () => {
    allPlans = laterWeeks()
    makeWeekDefaultMock.mockResolvedValue(answer())
    await confirmMakeDefault()
    await waitFor(() => expect(useToastStore.getState().message).toBe('Week 3 is now the default.'))
    // The mutation stays pending until the caches have refetched: wait for the button to be live again.
    await screen.findByText(ACTION)
    await settle()

    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(screen.queryByText(/AHEAD\?/)).toBeNull()
    expect(screen.queryByText('APPLY')).toBeNull()
    expect(screen.queryByLabelText('Dismiss')).toBeNull()
    expect(writesToWeeks()).toEqual([])
    expect(makeWeekDefaultMock).toHaveBeenCalledTimes(1)
  })

  it('...also when the function reports workouts it left alone: the toast says so, nothing else follows', async () => {
    allPlans = laterWeeks()
    makeWeekDefaultMock.mockResolvedValue(answer([{ workoutDayId: 'wd-2', reason: 'deload' }]))
    await confirmMakeDefault()
    await waitFor(() => expect(useToastStore.getState().message).toBe('Week 3 is now the default. Deload or empty sessions kept the current default.'))
    await screen.findByText(ACTION)
    await settle()

    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(screen.queryByText('APPLY')).toBeNull()
    expect(writesToWeeks()).toEqual([])
  })

  it('...and a later week opened afterwards is as the run left it: still no offer, still no write', async () => {
    allPlans = laterWeeks()
    makeWeekDefaultMock.mockResolvedValue(answer())
    await confirmMakeDefault()
    await waitFor(() => expect(useToastStore.getState().message).toBe('Week 3 is now the default.'))
    await screen.findByText(ACTION)
    fireEvent.click(screen.getByLabelText('Next week'))
    await screen.findByText('WEEK 4')
    await settle()

    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(writesToWeeks()).toEqual([])
  })
})

describe('PlanPage — make this week the default, when the call fails (real hooks)', () => {
  it('an error toast, no offer, and nothing written', async () => {
    allPlans = [week(3), week(4)]
    makeWeekDefaultMock.mockRejectedValue(new Error('v2_make_week_default: every session of week 3 of mesocycle meso-1 is deload or empty; there is nothing to make the default'))
    await confirmMakeDefault()
    await waitFor(() => expect(useToastStore.getState().message).toBe('v2_make_week_default: every session of week 3 of mesocycle meso-1 is deload or empty; there is nothing to make the default'))
    expect(screen.queryByText('Make week 3 the new default?')).toBeNull()
    expect(screen.queryByText(/PLANNED WEEKS? AHEAD\?/)).toBeNull()
    expect(writesToWeeks()).toEqual([])
  })

  it('offline it fails (the call rejects) instead of hanging on the confirm', async () => {
    allPlans = [week(3)]
    makeWeekDefaultMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await confirmMakeDefault()
    await waitFor(() => expect(useToastStore.getState().message).toBe('Failed to fetch'))
    expect(screen.queryByText('Make week 3 the new default?')).toBeNull()
    expect(screen.getByText(ACTION)).toBeTruthy()
  })
})
