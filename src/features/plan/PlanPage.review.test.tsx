// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, SequenceItem, WeekPlan, WeeklySchedule, WorkoutDay } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { pe, plan, wset } from './weekPlanning.testutil'
import { openWeekTile } from './planMenus.testutil'
import type { ReviewReadArgs, ReviewRead } from './useReview'
import type { ReviewGroup } from './review'
import { captureRender } from '../../testing/captureRender'

// Chunk 56 (TASKS-1.2 "REVIEW": "The line appears on the current week and a week planned ahead; never on week 1; hidden while nothing is left
// to decide"; SPEC Review (13): "one line appears in the week view under COPY / VOLUME / WEEK"): where Plan puts the line and what it hands the
// line and the sheet. The line and the sheet are `ReviewSheet.test.tsx`'s, the reads behind them `reviewService.test.ts`'s; here the real line and
// the real sheet draw over a recorded hook (`state.asked` is what the page asked it for, not what it answered).

interface Read<T> { data: T | undefined; isLoading: boolean; isError?: boolean; error?: unknown }
const state = vi.hoisted(() => ({
  meso: null as unknown as Mesocycle,
  program: null as unknown as Program,
  sequence: [] as SequenceItem[],
  days: [] as WorkoutDay[],
  all: null as unknown as Read<WeekPlan[]>,
  week: null as unknown as Read<WeekPlan[]>,
  done: new Set<string>(),
  statuses: new Map<string, 'done' | 'in_progress'>(),
  cycle: 3,
  read: { status: 'ready', groups: [], count: 5, error: null } as ReviewRead,
  asked: [] as ReviewReadArgs[],
  programs: [] as unknown[],
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
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => state.done }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => state.statuses }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: state.cycle, failed: false, error: null }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
vi.mock('./useCopyNumbers', () => ({ useCopyNumbers: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }) }))
vi.mock('./usePlanForward', () => ({
  usePlanForward: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useDefaultHasSets: () => ({ data: true }),
}))
vi.mock('./useVolumeSessions', () => ({ useVolumeSessions: () => ({ data: undefined, isError: false, refetch: () => Promise.resolve() }) }))
vi.mock('./useReview', () => ({
  useReview: (args: ReviewReadArgs) => {
    state.asked.push(args)
    return state.read
  },
  useReviewAction: (program: unknown) => {
    state.programs.push(program)
    return { mutateAsync: vi.fn() }
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
  state.done = new Set()
  state.statuses = new Map()
  state.read = { status: 'ready', groups: [], count: 5, error: null }
  state.asked = []
  state.programs = []
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
})

// ─── The runs ──────────────────────────────────────────────────────────────────

const monday = (weeksAgo: number) => format(startOfWeek(subWeeks(new Date(), weeksAgo), { weekStartsOn: 1 }), 'yyyy-MM-dd')
const wd = (id: string, name: string, position: number): WorkoutDay => ({ id, programId: 'prog-1', userId: 'user-1', name, position, exercises: [] })
const DAYS = [wd('wd-push1', 'Push 1', 0), wd('wd-pull1', 'Pull 1', 1)]
const WEEKDAYS: WeeklySchedule = { ...EMPTY_SCHEDULE, monday: 'wd-push1', thursday: 'wd-pull1' }

const planRow = (workoutDayId: string, week: number, sets = 3, over: Partial<WeekPlan> = {}): WeekPlan => {
  const exercises = [pe(`pe-${workoutDayId}`, `ex-${workoutDayId}`, 0, { workoutDayId })]
  const rows = Array.from({ length: sets }, (_, n) => wset(`s-${workoutDayId}-${week}-${n}`, exercises[0].id, n + 1, { weekPlanId: `wp-${workoutDayId}-${week}` }))
  return plan(week, exercises, rows, { id: `wp-${workoutDayId}-${week}`, workoutDayId, ...over })
}
const weekOf = (week: number, sets = 3) => DAYS.map((d) => planRow(d.id, week, sets))

function weekdayRun(opts: { weeksAgo?: number; weeks?: number[]; planning?: 'stable' | 'week_dependent' } = {}) {
  state.meso = { id: 'meso-1', userId: 'user-1', name: 'Push Pull', programId: 'prog-1', status: 'active', startDate: monday(opts.weeksAgo ?? 1), endDate: null, createdAt: '2026-01-01T00:00:00Z' }
  state.program = { id: 'prog-1', userId: 'user-1', name: 'Push Pull', workoutDays: [], schedule: WEEKDAYS, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: opts.planning ?? 'week_dependent' }
  state.days = DAYS
  state.sequence = []
  const weeks = opts.weeks ?? [1, 2]
  state.all = { data: weeks.flatMap((w) => weekOf(w)), isLoading: false }
  // The open week's own query holds one set more than the every-week list's copy of it: what an edit leaves behind until a later week exists.
  state.week = { data: weeks.flatMap((w) => weekOf(w, w === 2 ? 4 : 3)), isLoading: false }
}

const ITEMS = [['si-0', 'wd-push1'], ['si-1', 'wd-pull1']] as const
function sequenceRun() {
  state.meso = { id: 'meso-1', userId: 'user-1', name: 'Upper Lower', programId: 'prog-1', status: 'active', startDate: monday(0), endDate: null, createdAt: '2026-01-01T00:00:00Z' }
  state.program = { id: 'prog-1', userId: 'user-1', name: 'Upper Lower', workoutDays: [], schedule: EMPTY_SCHEDULE, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent', scheduleType: 'sequence' }
  state.days = DAYS
  state.sequence = ITEMS.map(([id, workoutDayId], position) => ({ id, userId: 'user-1', programId: 'prog-1', position, workoutDayId }))
  state.cycle = 3
  const cycle = (week: number) => ITEMS.map(([, workoutDayId], position) => planRow(workoutDayId, week, 3, { sequencePosition: position }))
  state.all = { data: [...cycle(2), ...cycle(3)], isLoading: false }
  state.week = { data: state.all.data, isLoading: false }
}

const ui = () => (
  <MemoryRouter initialEntries={['/plan']}>
    <PlanPage />
  </MemoryRouter>
)
const reviewLine = () => document.querySelector('[data-review-line]') as HTMLElement | null
const last = () => state.asked[state.asked.length - 1]
const ids = (plans: readonly WeekPlan[]) => plans.map((p) => p.id).sort()

describe('the line, under the action row', () => {
  it('on the current week 2 it sits under COPY, VOLUME, WEEK ⋯ and before the week itself (board 1), and says what the hook counted', () => {
    weekdayRun()
    render(ui())
    const line = reviewLine()!
    expect(line.textContent).toBe('LAST WEEK5 things went differentlyREVIEW →')
    const weekButton = screen.getByLabelText('Week 2 options')
    expect(weekButton.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const chip = screen.getByText(/CHANGED SINCE WEEK|PUSH 1/)
    expect(line.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never on week 1 (nothing before it, and never across programs), and none is asked for there', () => {
    weekdayRun({ weeksAgo: 0, weeks: [1] })
    render(ui())
    expect(reviewLine()).toBeNull()
    expect(state.asked).toEqual([])
  })

  it('is not on a past week (board 1c has no action row), on a week nobody planned, or on PLAN FORWARD’s week', () => {
    weekdayRun({ weeksAgo: 2, weeks: [1, 3] })
    render(ui())
    openWeekTile('WEEK 2')
    expect(reviewLine()).toBeNull()
    openWeekTile('WEEK 4')
    expect(screen.getByText(/PLAN FORWARD/)).toBeTruthy()
    expect(reviewLine()).toBeNull()
    openWeekTile('WEEK 1')
    expect(reviewLine()).toBeNull()
    expect(state.asked.map((a) => a.weekNumber).every((n) => n === 3)).toBe(true)
  })

  it('is not on a past week that was planned (board 1c: read only, no action row), and nothing is asked for it', () => {
    weekdayRun({ weeksAgo: 2, weeks: [1, 2, 3] })
    render(ui())
    expect(state.asked.map((a) => a.weekNumber)).toEqual([3])
    openWeekTile('WEEK 2')
    expect(reviewLine()).toBeNull()
    expect(state.asked.map((a) => a.weekNumber).every((n) => n === 3)).toBe(true)
  })

  it('is on a week planned ahead too, asking for that week against the week before it', () => {
    weekdayRun({ weeks: [1, 2, 3] })
    render(ui())
    openWeekTile('WEEK 3')
    expect(reviewLine()).toBeTruthy()
    expect(last().weekNumber).toBe(3)
    expect(ids(last().lastWeek)).toEqual(ids(weekOf(2)))
    expect(ids(last().thisWeek)).toEqual(ids(weekOf(3)))
  })

  it('draws nothing while the hook has nothing to say: reading, failed, or every item decided', () => {
    weekdayRun()
    for (const read of [{ status: 'loading', groups: [], count: 0, error: null }, { status: 'failed', groups: [], count: 0, error: new Error('x') }, { status: 'ready', groups: [], count: 0, error: null }] as ReviewRead[]) {
      state.read = read
      const { unmount } = render(ui())
      expect(reviewLine()).toBeNull()
      unmount()
    }
  })

  it('a sequence run says LAST CYCLE and hands the cycle’s plan rows', () => {
    sequenceRun()
    render(ui())
    expect(reviewLine()!.textContent).toBe('LAST CYCLE5 things went differentlyREVIEW →')
    expect(last().weekNumber).toBe(3)
    expect(last().lastWeek.map((p) => p.weekNumber)).toEqual([2, 2])
  })
})

describe('what the line and the sheet are handed', () => {
  it('this week is the open week’s own query (an edit shows in it at once), last week is the run’s every-week list’s week before', () => {
    weekdayRun()
    render(ui())
    expect(last().weekNumber).toBe(2)
    expect(last().thisWeek.map((p) => p.sets.length)).toEqual([4, 4])
    expect(last().lastWeek.map((p) => [p.weekNumber, p.sets.length])).toEqual([[1, 3], [1, 3]])
    expect(last().workouts).toEqual([{ id: 'wd-push1', name: 'Push 1' }, { id: 'wd-pull1', name: 'Pull 1' }])
  })

  it('a plan row whose session is done is locked in Plan: it is left out of this week’s rows, so nothing is written into it', () => {
    weekdayRun()
    state.done = new Set(['wp-wd-push1-2'])
    render(ui())
    expect(ids(last().thisWeek)).toEqual(['wp-wd-pull1-2'])
    expect(ids(last().lastWeek)).toEqual(['wp-wd-pull1-1', 'wp-wd-push1-1'])
  })

  it('a plan row whose session is in progress still takes writes (only a finished session is locked)', () => {
    weekdayRun()
    state.statuses = new Map([['wp-wd-push1-2', 'in_progress']])
    render(ui())
    expect(ids(last().thisWeek)).toEqual(['wp-wd-pull1-2', 'wp-wd-push1-2'])
  })

  it('pressing the line opens the sheet on that week, with the program the actions write to, and × closes it', () => {
    weekdayRun({ planning: 'stable' })
    render(ui())
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(reviewLine()!)
    const dialog = screen.getByRole('dialog', { name: 'What went differently' })
    expect(dialog.textContent).toContain('LAST WEEK · 5 THINGS')
    expect(state.programs[state.programs.length - 1]).toEqual({ mesoId: 'meso-1', programId: 'prog-1', planningType: 'stable', scheduleType: 'weekday', currentWeek: 2 })
    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"SWAP FROM WEEK N" names CHANGE THE PROGRAM’s week (the first session not started), not the week the page is on or the current one', () => {
    // Week 2 is current and both its sessions are done, so a change would start in week 3, the week open here.
    weekdayRun({ weeks: [1, 2, 3] })
    state.statuses = new Map([['wp-wd-push1-1', 'done'], ['wp-wd-pull1-1', 'done'], ['wp-wd-push1-2', 'done'], ['wp-wd-pull1-2', 'done']])
    state.read = {
      status: 'ready',
      count: 1,
      error: null,
      groups: [
        {
          sessionId: 's1', weekPlanId: 'wp-wd-push1-3', workoutDayId: 'wd-push1', workoutName: 'Push 1', date: '2026-10-12', heading: 'MON · PUSH 1',
          items: [{ key: 'swap:s1:pe-a', item: { kind: 'swapped', sessionId: 's1', weekPlanId: 'wp-wd-push1-3', programExerciseId: 'pe-a', originalExerciseId: 'ex-a', originalExerciseName: 'Dips', replacementExerciseId: 'ex-b', replacementExerciseName: 'Machine Dips', doneSets: 3, plannedSets: 3, target: { programExerciseId: 'pe-a' } } }],
        },
      ],
    }
    render(ui())
    openWeekTile('WEEK 3')
    fireEvent.click(reviewLine()!)
    expect(screen.getByRole('button', { name: 'SWAP FROM WEEK 3' })).toBeTruthy()
    expect(screen.getByText('Swapping changes the plan from week 3 on.')).toBeTruthy()
    expect(state.programs[state.programs.length - 1]).toMatchObject({ currentWeek: 2 })
  })

  it('the sheet is gone with the week it opened on, as COPY’s and VOLUME’s are', () => {
    weekdayRun()
    const { rerender } = render(ui())
    fireEvent.click(reviewLine()!)
    expect(screen.getByRole('dialog', { name: 'What went differently' })).toBeTruthy()
    state.week = { data: undefined, isLoading: false, isError: true, error: new Error('offline') }
    rerender(ui())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(reviewLine()).toBeNull()
  })
})

// ─── Board 4, and board 1's line over it ───────────────────────────────────────────

// Board 4's own three things: Tuesday's Lat Pulldown set 02 (a number item with its RIR), Tuesday's added Face Pull set, Thursday's swap.
const BOARD_GROUPS: ReviewGroup[] = [
  {
    sessionId: 's-tue', weekPlanId: 'wp-wd-pull1-2', workoutDayId: 'wd-pull1', workoutName: 'Pull 1', date: '2026-10-06', heading: 'TUE · PULL 1',
    items: [
      {
        key: 'num:s-tue:ps-lat',
        item: {
          kind: 'number', sessionId: 's-tue', weekPlanId: 'wp-wd-pull1-2', plannedSetId: 'ps-lat', exerciseId: 'e-lat', exerciseName: 'Lat Pulldown', setNumber: 2, isWarmup: false, unit: 'kg',
          target: { programExerciseId: 'pe-lat', setId: 'w2-lat-2' }, planned: { weight: 55, reps: { type: 'range', min: 8, max: 10 }, rir: 2, rirMax: null },
          done: { weight: 57.5, reps: 11, rir: 1, type: { kind: 'normal' } }, weightDiffers: true, repsDiffer: true,
        },
      },
      {
        key: 'added-set:s-tue:e-face:3',
        item: { kind: 'added_set', sessionId: 's-tue', weekPlanId: 'wp-wd-pull1-2', exerciseId: 'e-face', exerciseName: 'Face Pull', setNumber: 3, place: null, unit: 'kg', done: { weight: 15, reps: 18, rir: 1, type: { kind: 'normal' } }, target: { programExerciseId: 'pe-face' } },
      },
    ],
  },
  {
    sessionId: 's-thu', weekPlanId: 'wp-wd-push1-2', workoutDayId: 'wd-push1', workoutName: 'Push 2', date: '2026-10-08', heading: 'THU · PUSH 2',
    items: [
      {
        key: 'swap:s-thu:pe-dips',
        item: { kind: 'swapped', sessionId: 's-thu', weekPlanId: 'wp-wd-push1-2', programExerciseId: 'pe-dips', originalExerciseId: 'e-dips', originalExerciseName: 'Dips', replacementExerciseId: 'e-mdips', replacementExerciseName: 'Machine Dips', doneSets: 3, plannedSets: 3, target: { programExerciseId: 'pe-dips' } },
      },
    ],
  },
]

describe('board 4 and board 1’s line, as built', () => {
  it('the line under the action row, then the sheet over the page, with the board’s three things in the board’s words', () => {
    weekdayRun()
    state.read = { status: 'ready', groups: BOARD_GROUPS, count: 3, error: null }
    state.statuses = new Map([['wp-wd-push1-1', 'done'], ['wp-wd-pull1-1', 'done']])
    render(ui())
    captureRender('plan-1-review', document.body)
    expect(reviewLine()!.textContent).toBe('LAST WEEK3 things went differentlyREVIEW →')
    fireEvent.click(reviewLine()!)
    captureRender('plan-4', document.body)
    const dialog = screen.getByRole('dialog', { name: 'What went differently' })
    const text = dialog.innerText ?? dialog.textContent ?? ''
    for (const wanted of [
      'LAST WEEK · 3 THINGS', 'What went differently', 'Where last week went differently from its plan. Take it over or leave it.',
      'TUE · PULL 1', 'LAT PULLDOWN · SET 02', 'Did 57.5 kg × 11', 'planned 55 kg × 8–10 · RIR 2 → did RIR 1', 'USE 57.5 × 11',
      'FACE PULL · ADDED A SET', 'Set 03 · 15 kg × 18', 'RIR 1', 'ADD THIS SET',
      'THU · PUSH 2', 'SWAPPED AN EXERCISE', 'Dips → Machine Dips', 'for all 3 sets', 'Swapping changes the plan from week 2 on.', 'SWAP FROM WEEK 2',
    ]) {
      expect(text).toContain(wanted)
    }
    expect(dialog.querySelectorAll('button')).toHaveLength(7) // × and IGNORE + the action, three times
    expect([...dialog.querySelectorAll('button')].filter((b) => b.textContent === 'IGNORE')).toHaveLength(3)
  })
})
