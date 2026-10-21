// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, SequenceItem, WeekPlan, WeeklySchedule, WorkoutDay } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import type { VolumeSessionsRead } from './useVolumeSessions'
import { pe, plan, wset } from './weekPlanning.testutil'
import { openWeekTile } from './planMenus.testutil'

// Chunk 55 (TASKS-1.2 "VOLUME"; SPEC Screens → Plan screen → Under the header; board 1): the VOLUME button in Plan's action row, and what Plan hands
// the sheet it opens: the open week's own plan rows, last week's out of the run's every-week list, the schedule in force in each of the two weeks,
// whether last week is over. The sheet itself is `VolumeSheet.test.tsx`'s and the read behind it `useVolumeSessions.test.ts`'s; here the
// real sheet draws over a recorded read (`state.asked` is the plan rows it was asked about, not what it answered).

interface Read<T> { data: T | undefined; isLoading: boolean; isError?: boolean; error?: unknown }
interface ScheduleRow { id: string; userId: string; mesocycleId: string; fromWeek: number; schedule: WeeklySchedule; createdAt: string }
const state = vi.hoisted(() => ({
  meso: null as unknown as Mesocycle,
  program: null as unknown as Program,
  sequence: [] as SequenceItem[],
  days: [] as WorkoutDay[],
  all: null as unknown as Read<WeekPlan[]>,
  week: null as unknown as Read<WeekPlan[]>,
  schedule: [] as ScheduleRow[],
  cycle: 3,
  read: { data: undefined, isError: false, refetch: () => Promise.resolve() } as { data: VolumeSessionsRead | undefined; isError: boolean; refetch: () => Promise<unknown> },
  asked: [] as string[][],
}))

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [state.meso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  usePrograms: () => ({ data: [state.program], isLoading: false }),
  useWorkoutDays: () => ({ data: state.days, isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: state.sequence }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined }))
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: state.schedule }) }))
vi.mock('./useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: state.cycle, failed: false, error: null }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
vi.mock('./useCopyNumbers', () => ({ useCopyNumbers: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }) }))
vi.mock('./usePlanForward', () => ({
  usePlanForward: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useDefaultHasSets: () => ({ data: true }),
}))
vi.mock('./useVolumeSessions', () => ({
  useVolumeSessions: (ids: readonly string[]) => {
    state.asked.push([...ids])
    return state.read
  },
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => (state.week.data ? { ...state.week, data: state.week.data.filter((p) => p.weekNumber === weekNumber) } : state.week),
  useAllWeekPlans: () => state.all,
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null, variables: undefined }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')

afterEach(() => {
  cleanup()
  useSettingsStore.setState(DEFAULT_SETTINGS)
  state.schedule = []
  state.read = { data: undefined, isError: false, refetch: () => Promise.resolve() }
  state.asked = []
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
})

// ─── The runs ──────────────────────────────────────────────────────────────────

const monday = (weeksAgo: number) => format(startOfWeek(subWeeks(new Date(), weeksAgo), { weekStartsOn: 1 }), 'yyyy-MM-dd')
const wd = (id: string, name: string, position: number): WorkoutDay => ({ id, programId: 'prog-1', userId: 'user-1', name, position, exercises: [] })
const DAYS = [wd('wd-push1', 'Push 1', 0), wd('wd-pull1', 'Pull 1', 1), wd('wd-push2', 'Push 2', 2), wd('wd-pull2', 'Pull 2', 3), wd('wd-legs', 'Legs', 4)]
const WEEKDAYS: WeeklySchedule = { ...EMPTY_SCHEDULE, monday: 'wd-push1', tuesday: 'wd-pull1', thursday: 'wd-push2', friday: 'wd-pull2', saturday: 'wd-legs' }

// Every exercise of `pe` is a chest exercise, so a week's volume reads on the one Chest row: sets × sessions, which is what these tests count.
const SETS_OF: Record<string, number> = { 'wd-push1': 3, 'wd-pull1': 6, 'wd-push2': 3, 'wd-pull2': 3, 'wd-legs': 3 } // pull 1 holds two exercises
const planRow = (workoutDayId: string, week: number, extraSets = 0, over: Partial<WeekPlan> = {}): WeekPlan => {
  const rows = workoutDayId === 'wd-pull1' ? ['a', 'b'] : ['a']
  const exercises = rows.map((r, i) => ({ ...pe(`pe-${workoutDayId}-${r}`, `ex-${workoutDayId}-${r}`, i, { workoutDayId }) }))
  const sets = exercises.flatMap((e, i) => Array.from({ length: 3 + (i === 0 ? extraSets : 0) }, (_, n) => wset(`s-${workoutDayId}-${week}-${e.id}-${n}`, e.id, n + 1, { weekPlanId: `wp-${workoutDayId}-${week}` })))
  return plan(week, exercises, sets, { id: `wp-${workoutDayId}-${week}`, workoutDayId, ...over })
}
const weekOf = (week: number, extra: Partial<Record<string, number>> = {}) => DAYS.map((d) => planRow(d.id, week, extra[d.id] ?? 0))
const ids = (week: number) => DAYS.map((d) => `wp-${d.id}-${week}`)

function weekdayRun(opts: { weeksAgo?: number; weeks?: number[]; schedule?: WeeklySchedule } = {}) {
  state.meso = { id: 'meso-1', userId: 'user-1', name: 'Push Pull Legs', programId: 'prog-1', status: 'active', startDate: monday(opts.weeksAgo ?? 1), endDate: null, createdAt: '2026-01-01T00:00:00Z' }
  state.program = { id: 'prog-1', userId: 'user-1', name: 'Push Pull Legs', workoutDays: [], schedule: opts.schedule ?? WEEKDAYS, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent' }
  state.days = DAYS
  state.sequence = []
  state.all = { data: (opts.weeks ?? [1, 2]).flatMap((w) => weekOf(w)), isLoading: false }
  state.week = { data: state.all.data, isLoading: false }
}

const ITEMS = [['si-0', 'wd-push1'], ['si-1', 'wd-legs']] as const
function sequenceRun() {
  state.meso = { id: 'meso-1', userId: 'user-1', name: 'Upper Lower', programId: 'prog-1', status: 'active', startDate: monday(0), endDate: null, createdAt: '2026-01-01T00:00:00Z' }
  state.program = { id: 'prog-1', userId: 'user-1', name: 'Upper Lower', workoutDays: [], schedule: EMPTY_SCHEDULE, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent', scheduleType: 'sequence' }
  state.days = DAYS
  state.sequence = ITEMS.map(([id, workoutDayId], position) => ({ id, userId: 'user-1', programId: 'prog-1', position, workoutDayId }))
  state.cycle = 3
  const cycle = (week: number) => ITEMS.map(([, workoutDayId], position) => planRow(workoutDayId, week, 0, { sequencePosition: position }))
  state.all = { data: [...cycle(2), ...cycle(3)], isLoading: false }
  state.week = { data: state.all.data, isLoading: false }
}

const ui = () => (
  <MemoryRouter initialEntries={['/plan']}>
    <PlanPage />
  </MemoryRouter>
)
const volumeButton = () => screen.queryByRole('button', { name: 'VOLUME' })
const openVolume = () => fireEvent.click(screen.getByRole('button', { name: 'VOLUME' }))
const chest = () => {
  const row = screen.getAllByRole('row').find((r) => r.getAttribute('data-muscle') === 'chest')!
  const cells = within(row).getAllByRole('cell').map((c) => c.textContent)
  return [...cells, [...row.querySelectorAll('span')].find((s) => s.textContent?.startsWith('YOU PLANNED'))?.textContent ?? '']
}

// ─── The button ────────────────────────────────────────────────────────────────

describe('the VOLUME button, under the header', () => {
  it('on the current week 2: COPY, VOLUME, WEEK ⋯, in that order (board 1)', () => {
    weekdayRun()
    render(ui())
    const row = screen.getByText('COPY').closest('div')!
    expect([...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent)).toEqual(['COPY', 'VOLUME', 'Week 2 options'])
  })

  it('on week 1 (nothing before it) there is no COPY and no VOLUME (P1.2-1), only WEEK ⋯', () => {
    weekdayRun({ weeksAgo: 0, weeks: [1] })
    render(ui())
    expect(screen.getByLabelText('Week 1 options')).toBeTruthy()
    expect(volumeButton()).toBeNull()
    expect(screen.queryByText('COPY')).toBeNull()
  })

  it('on a past week (board 1c) there is no action row at all', () => {
    weekdayRun()
    render(ui())
    openWeekTile('WEEK 1')
    expect(volumeButton()).toBeNull()
  })

  it('on a week nobody planned that passed (read only, empty: DECISIONS 131) there is none, and on PLAN FORWARD\'s week none either', () => {
    weekdayRun({ weeksAgo: 2, weeks: [1, 3] })
    render(ui())
    openWeekTile('WEEK 2')
    expect(volumeButton()).toBeNull()
    openWeekTile('WEEK 4')
    expect(screen.getByText(/PLAN FORWARD/)).toBeTruthy()
    expect(volumeButton()).toBeNull()
  })

  it('a sequence run has it on its current cycle (CYCLE ⋯ beside it)', () => {
    sequenceRun()
    render(ui())
    expect(volumeButton()).toBeTruthy()
    expect(screen.getByLabelText('Cycle 3 options')).toBeTruthy()
  })

  it('is a button and nothing more: the week carries no volume until it is opened (SPEC 14), and no sheet is open', () => {
    weekdayRun()
    render(ui())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/SETS PER MUSCLE/)).toBeNull()
    expect(document.querySelector('[data-muscle]')).toBeNull()
    expect(state.asked).toEqual([]) // the read is made when the sheet opens, not by the page
  })
})

// ─── What Plan hands the sheet ─────────────────────────────────────────────────

describe('what the sheet is handed', () => {
  it('opens the sheet on the week the page shows, named for it, and × closes it', () => {
    weekdayRun()
    render(ui())
    openVolume()
    expect(screen.getByRole('dialog', { name: 'Volume' })).toBeTruthy()
    expect(screen.getByText('WEEK 2 · SETS PER MUSCLE')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks for the sessions of last week\'s plan rows: week 1\'s on week 2, and week 2\'s on week 3 planned ahead', () => {
    weekdayRun({ weeks: [1, 2, 3] })
    render(ui())
    openVolume()
    expect(state.asked.at(-1)).toEqual(ids(1))
    fireEvent.click(screen.getByLabelText('Close'))
    openWeekTile('WEEK 3')
    openVolume()
    expect(state.asked.at(-1)).toEqual(ids(2))
    expect(screen.getByText('WEEK 3 · SETS PER MUSCLE')).toBeTruthy()
  })

  it('this week is the open week\'s own query, never the every-week list\'s copy, which an edit leaves as it was until a later week exists', () => {
    weekdayRun()
    // The week's own query holds Push 1 with a fourth set typed a moment ago; the every-week list still holds the three it read.
    state.week = { data: [...weekOf(1), ...weekOf(2, { 'wd-push1': 1 })], isLoading: false }
    state.read = { ...state.read, data: { sessions: [], exercises: [] } }
    render(ui())
    openVolume()
    expect(chest()[2]).toBe('19') // 18 + the fourth set; the stale copy would read 18
  })

  it('last week\'s rows are week N−1\'s of the every-week list, and nothing of the week\'s own query (an older copy of week 1 there doesn\'t count)', () => {
    weekdayRun()
    state.week = { data: [...weekOf(1, { 'wd-legs': 2 }), ...weekOf(2)], isLoading: false } // the week query's week 1 isn't the list's
    state.read = { ...state.read, data: { sessions: [], exercises: [] } }
    render(ui())
    openVolume()
    // No session read for week 1: Plan is on the current week, so last week is over and a workout never done counts 0; the plan is the list's 18.
    expect(chest()).toEqual(['Chest', '0', '18', '+18', 'YOU PLANNED 18 LAST WEEK · DID 0'])
  })

  it('last week is over on the current week (a workout never done counts 0) and still running on a week planned ahead (it counts its plan)', () => {
    weekdayRun({ weeks: [1, 2, 3] })
    state.read = { ...state.read, data: { sessions: [], exercises: [] } }
    render(ui())
    openVolume()
    expect(chest()).toEqual(['Chest', '0', '18', '+18', 'YOU PLANNED 18 LAST WEEK · DID 0'])
    fireEvent.click(screen.getByLabelText('Close'))
    openWeekTile('WEEK 3')
    openVolume()
    expect(chest()).toEqual(['Chest', '18', '18', '', ''])
  })

  it('a workout on two weekdays counts twice in the week whose schedule holds it twice: week 2\'s days, not the run copy\'s and not week 1\'s', () => {
    weekdayRun()
    const row = (fromWeek: number, schedule: WeeklySchedule): ScheduleRow => ({ id: `r${fromWeek}`, userId: 'user-1', mesocycleId: 'meso-1', fromWeek, schedule, createdAt: '2026-01-01T00:00:00Z' })
    // Week 1 had Push 1 on Monday; from week 2 it is on Monday and Wednesday (one shared plan row, two sessions). The run copy's schedule (WEEKDAYS) has it once.
    state.schedule = [row(1, WEEKDAYS), row(2, { ...WEEKDAYS, wednesday: 'wd-push1' })]
    state.read = { ...state.read, data: { sessions: [], exercises: [] } }
    render(ui())
    openVolume()
    expect(chest()).toEqual(['Chest', '0', '21', '+21', 'YOU PLANNED 18 LAST WEEK · DID 0']) // this week 18 + Push 1's 3 again; last week's plan 18
  })

  it('a missed last week is a week with nothing in it: dashes for every muscle (P1.2-2), nothing read', () => {
    weekdayRun({ weeksAgo: 2, weeks: [1, 3] })
    render(ui())
    openVolume()
    expect(screen.getByText('WEEK 3 · SETS PER MUSCLE')).toBeTruthy()
    expect(chest()).toEqual(['Chest', '—', '18', '', ''])
    expect(state.asked.at(-1)).toEqual([])
  })

  it('a sequence run: CYCLE 3 · SETS PER MUSCLE, every slot once', () => {
    sequenceRun()
    state.read = { ...state.read, data: { sessions: [], exercises: [] } }
    render(ui())
    openVolume()
    expect(screen.getByText('CYCLE 3 · SETS PER MUSCLE')).toBeTruthy()
    expect(chest()).toEqual(['Chest', '0', '6', '+6', 'YOU PLANNED 6 LAST WEEK · DID 0']) // Push 1 (3) and Legs (3), once each
    expect(state.asked.at(-1)).toEqual(['wp-wd-push1-2', 'wp-wd-legs-2'])
  })
})
