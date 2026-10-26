// @vitest-environment jsdom
// Chunk 61 — auto-finish at the workout screen (TASKS-1.2 61 Scope: "`useAutoFinishSession` waits for what the workout's rows say is left, the same view as
// the finish warning (`finishWarning(order, logs, changes)` null), instead of a log on every planned set id"; DECISIONS 166 (a), Adam 2026-10-16). The REAL
// auto-finish hook runs inside GymSession here: what the screen tells it is what is asserted, by whether the session completes. The hook's own rules
// (threshold, grace window, the setting) are `useAutoFinishSession.test.tsx`.
// Retry (61's review 1, F2): the option Adam took for 166 (a) reads "no row of `resolveRows` is open. That covers working sets, drops and planned warmups, with
// deleted sets out and retyped drops in. A set added in the session and never logged doesn't hold it, as today", so the finish warning alone (the planned working
// sets) is not the question: a session with an open planned drop or an open planned warmup completed by itself. The scenarios below run each case beside staging's
// rule (the control: `useAutoFinishSession.ts` at `d7fd9d3` asked for "a log on every planned set id"), so where the screen agrees with it and where 166 (a)
// makes it differ (a deleted set out, a retyped planned set's drops in) is on the page.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProgramExercise, Session, SessionSetChangeRecord, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'

const complete = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 0 }))
vi.mock('./useScrollToCurrentSet', () => ({ useScrollToCurrentSet: () => ({ containerRef: () => {}, direction: null, scrollToCurrentSet: () => {} }) }))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('./WarmupRoutineChecklist', () => ({ default: () => null }))
vi.mock('../offline/SyncFailedNotice', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({ useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: [] }), useWarmupRoutineItems: () => ({ data: [] }) }))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useUpdateSetLog: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useCompleteSession: () => complete,
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: vi.fn().mockResolvedValue(false), flushSyncQueue: vi.fn() }))

const { default: GymSession } = await import('./GymSession')

const MIN = 60_000
const START = new Date('2026-01-06T09:25:00Z').getTime() // the logs below are stamped 09:20 and 09:21
const peLat: ProgramExercise = {
  id: 'xe-lat', workoutDayId: 'wd-1', userId: 'u1', exerciseId: 'ex-lat', position: 0, weightUnit: null,
  exercise: { id: 'ex-lat', userId: 'u1', name: 'Lat Pulldown', muscleGroup: 'back', isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
}
const set = (id: string, setNumber: number): WeekPlanSet => ({ id, weekPlanId: 'wp-1', userId: 'u1', programExerciseId: 'xe-lat', setNumber, targetRir: 1, targetWeight: 55, repMin: 8, repMax: 8, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false })
const plan: WeekPlan = { id: 'wp-1', userId: 'u1', mesocycleId: 'm1', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z', exercises: [peLat], sets: [set('lat-1', 1), set('lat-2', 2), set('lat-3', 3)] }
const log = (id: string, weekPlanSetId: string | null, setNumber: number, loggedAt: string, over: Partial<SetLog> = {}): SetLog => ({
  id, userId: 'u1', sessionId: 'session-1', exerciseId: 'ex-lat', weekPlanSetId, setNumber, weight: 55, reps: 8, rir: 1, note: null, isDropset: false, parentSetId: null,
  stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false, loggedAt, restSeconds: null, formRating: null, stageKind: null, addedPlace: null, ...over,
})
const deleted = (weekPlanSetId: string): SessionSetChangeRecord => ({ id: 'chg-1', userId: 'u1', sessionId: 'session-1', createdAt: '2026-01-06T09:00:00Z', updatedAt: '2026-01-06T09:00:00Z', kind: 'deleted', weekPlanSetId })
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'p1', userId: 'u1', name: 'PULL 1', position: 0, exercises: [] }

let session: Session
let weekPlan: WeekPlan = plan
function mount(logs: SetLog[], setChanges: SessionSetChangeRecord[], sets: WeekPlanSet[] = plan.sets) {
  weekPlan = { ...plan, sets }
  session = {
    id: 'session-1', userId: 'u1', mesocycleId: 'm1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: '2026-01-06', status: 'in_progress', note: null,
    startedAt: '2026-01-06T09:10:00Z', completedAt: null, createdAt: '2026-01-06T09:10:00Z', setLogs: logs, setChanges, energyRating: null, pumpRating: null,
  }
  return render(
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={2} today="2026-01-06" />
    </MemoryRouter>,
  )
}
const advance = (minutes: number) => act(async () => void vi.advanceTimersByTime(minutes * MIN))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(START)
  complete.mutate.mockReset()
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, autoFinishMinutes: 10 })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('auto-finish follows the rows (DECISIONS 166 (a))', () => {
  it('with one planned set deleted and every other set logged, the session completes after the threshold', async () => {
    mount([log('l1', 'lat-1', 1, '2026-01-06T09:20:00Z'), log('l3', 'lat-3', 2, '2026-01-06T09:21:00Z')], [deleted('lat-2')])
    await advance(5)
    expect(complete.mutate).not.toHaveBeenCalled() // the grace window since the screen opened
    await advance(6)
    expect(complete.mutate).toHaveBeenCalledTimes(1)
    expect(complete.mutate.mock.calls[0][0]).toEqual({ id: 'session-1', note: null })
  })

  it('the same session with that set still open (no change row) is not finished: it waits for the set', async () => {
    mount([log('l1', 'lat-1', 1, '2026-01-06T09:20:00Z'), log('l3', 'lat-3', 3, '2026-01-06T09:21:00Z')], [])
    await advance(60)
    expect(complete.mutate).not.toHaveBeenCalled()
  })

  it('a skipped set is settled: every set logged or skipped finishes it, as before', async () => {
    mount([log('l1', 'lat-1', 1, '2026-01-06T09:20:00Z'), { ...log('l2', 'lat-2', 2, '2026-01-06T09:20:30Z'), isSkipped: true, weight: null, reps: null }, log('l3', 'lat-3', 3, '2026-01-06T09:21:00Z')], [])
    await advance(11)
    expect(complete.mutate).toHaveBeenCalledTimes(1)
  })
})

// ─── What holds it besides the planned working sets (61's review 1, F2) ───────────────────────────────────────────────────────────────────
const dropsetHead = (id: string, setNumber: number): WeekPlanSet => ({ ...set(id, setNumber), stageKind: 'dropset' })
const planDrop = (id: string, head: string, setNumber: number, index: number): WeekPlanSet => ({ ...set(id, setNumber), isDropset: true, parentWeekPlanSetId: head, stageIndex: index, targetRir: 0, isAmrap: true })
const planWarmup = (id: string, setNumber: number): WeekPlanSet => ({ ...set(id, setNumber), isWarmup: true })
const AT = (minute: number) => `2026-01-06T09:${String(minute).padStart(2, '0')}:00Z`
const retypedRecord = (weekPlanSetId: string, type: Extract<SessionSetChangeRecord, { kind: 'retyped' }>['type']): SessionSetChangeRecord => ({
  id: 'chg-r', userId: 'u1', sessionId: 'session-1', createdAt: AT(0), updatedAt: AT(0), kind: 'retyped', weekPlanSetId, type,
})
const pendingRecord = (setLogId: string, stageCount: number): SessionSetChangeRecord => ({
  id: 'chg-p', userId: 'u1', sessionId: 'session-1', createdAt: AT(0), updatedAt: AT(0), kind: 'pending_stages', setLogId, stageKind: 'dropset', stageCount,
})
/** Staging's rule, the control (`useAutoFinishSession.ts` at `d7fd9d3`, `allLogged`): a log on every planned set id of the week plan, drops and warmups included. */
const stagingFinishes = (sets: WeekPlanSet[], logs: SetLog[]) => sets.every((planned) => logs.some((l) => l.weekPlanSetId === planned.id))
/** The rows the screen draws as still to do: the current set, the upcoming and locked ones, an unticked warmup. */
const openRows = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-row-key]')]
    .filter((el) => el.getAttribute('data-current-set') === 'true' || ['upcoming', 'locked', 'unlogged'].includes(el.getAttribute('data-row-state') ?? ''))
    .map((el) => (el.getAttribute('data-row-key') ?? '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, '<id>'))

const DROPSET_PLAN = [set('lat-1', 1), set('lat-2', 2), dropsetHead('lat-3', 3), planDrop('lat-3-d1', 'lat-3', 3, 1)]
const WARMUP_PLAN = [planWarmup('lat-w1', 1), set('lat-1', 1), set('lat-2', 2)]
const WORKING = [log('l1', 'lat-1', 1, AT(19)), log('l2', 'lat-2', 2, AT(20))]
const HEAD3 = log('l3', 'lat-3', 3, AT(21), { stageKind: 'dropset' })
const DROP1 = log('l3d1', 'lat-3-d1', 3, AT(22), { parentSetId: 'l3', stageIndex: 1, isDropset: true })
const skip = (l: SetLog): SetLog => ({ ...l, isSkipped: true, weight: null, reps: null })

interface Scenario {
  name: string
  sets: WeekPlanSet[]
  logs: SetLog[]
  changes?: SessionSetChangeRecord[]
  /** Does the session complete by itself after the threshold? */
  finishes: boolean
  /** The rows still open on the screen (proves the fixture draws what it says). */
  open: string[]
  tick?: boolean
  addSet?: boolean
}
const SCENARIOS: Scenario[] = [
  { name: 'a planned dropset logged, its planned drop open: it waits (PA1)', sets: DROPSET_PLAN, logs: [...WORKING, HEAD3], finishes: false, open: ['set:lat-3:stage:1'] },
  { name: 'the same with the drop logged: it finishes', sets: DROPSET_PLAN, logs: [...WORKING, HEAD3, DROP1], finishes: true, open: [] },
  { name: 'the same with the drop skipped: a skipped drop is settled', sets: DROPSET_PLAN, logs: [...WORKING, HEAD3, skip(DROP1)], finishes: true, open: [] },
  { name: 'a planned dropset skipped with no log for its drop: the rows draw no drop for a skipped head, so nothing is open', sets: DROPSET_PLAN, logs: [...WORKING, skip(HEAD3)], finishes: true, open: [] },
  { name: 'every working set logged, a planned warmup open: it waits (PA2)', sets: WARMUP_PLAN, logs: WORKING, finishes: false, open: ['set:lat-w1'] },
  { name: 'the same with warmups as a tick list: an unticked planned warmup still holds it', sets: WARMUP_PLAN, logs: WORKING, tick: true, finishes: false, open: ['set:lat-w1'] },
  { name: 'the same with the warmup logged: it finishes', sets: WARMUP_PLAN, logs: [log('lw', 'lat-w1', 1, AT(18), { isWarmup: true }), ...WORKING], finishes: true, open: [] },
  { name: 'the same with the warmup skipped: it finishes', sets: WARMUP_PLAN, logs: [skip(log('lw', 'lat-w1', 1, AT(18), { isWarmup: true })), ...WORKING], finishes: true, open: [] },
  { name: 'everything logged: it finishes (the harness\'s control, PA3)', sets: DROPSET_PLAN, logs: [...WORKING, HEAD3, DROP1], finishes: true, open: [] },
  {
    name: 'a planned set retyped to a dropset with two drops, logged, its drops open: the retyped drops are in, so it waits',
    sets: [set('lat-1', 1), set('lat-2', 2), set('lat-3', 3)],
    logs: [...WORKING, HEAD3],
    changes: [retypedRecord('lat-3', { kind: 'staged', stageKind: 'dropset', stageCount: 2 })],
    finishes: false,
    open: ['set:lat-3:stage:1', 'set:lat-3:stage:2'],
  },
  {
    name: 'the same with both drops logged: it finishes',
    sets: [set('lat-1', 1), set('lat-2', 2), set('lat-3', 3)],
    logs: [...WORKING, HEAD3, log('r1', null, 3, AT(22), { parentSetId: 'l3', stageIndex: 1, isDropset: true }), log('r2', null, 3, AT(23), { parentSetId: 'l3', stageIndex: 2, isDropset: true })],
    changes: [retypedRecord('lat-3', { kind: 'staged', stageKind: 'dropset', stageCount: 2 })],
    finishes: true,
    open: [],
  },
  {
    name: 'a set deleted during the workout is out of the rows: the rest logged, it finishes (what staging\'s rule never allows)',
    sets: [set('lat-1', 1), set('lat-2', 2), set('lat-3', 3)],
    logs: [WORKING[0], log('l3', 'lat-3', 2, AT(21))],
    changes: [deleted('lat-2')],
    finishes: true,
    open: [],
  },
  { name: 'a planned working set still open: it waits (the finish warning\'s own)', sets: [set('lat-1', 1), set('lat-2', 2), set('lat-3', 3)], logs: [WORKING[0], log('l3', 'lat-3', 3, AT(21))], finishes: false, open: ['set:lat-2'] },
  { name: 'a set added in the session and never logged does not hold it, as today', sets: [set('lat-1', 1), set('lat-2', 2)], logs: WORKING, addSet: true, finishes: true, open: ['added:xe-lat:<id>'] },
  {
    name: 'an added dropset, logged, its drop open, does not hold it either',
    sets: [set('lat-1', 1), set('lat-2', 2)],
    logs: [...WORKING, log('la1', null, 3, AT(21), { stageKind: 'dropset', addedPlace: 1 })],
    changes: [pendingRecord('la1', 1)],
    finishes: true,
    open: ['added:xe-lat:la1:stage:1'],
  },
]

describe('auto-finish also waits for an open planned drop and an open planned warmup (DECISIONS 166 (a); 61\'s review 1, F2)', () => {
  it.each(SCENARIOS)('$name', async (scenario) => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, autoFinishMinutes: 10, ...(scenario.tick ? { warmupDisplay: 'tick' as const } : {}) })
    const { container } = mount(scenario.logs, scenario.changes ?? [], scenario.sets)
    if (scenario.addSet) fireEvent.click(screen.getByText(/ADD SET/))
    expect(openRows(container)).toEqual(scenario.open)
    await advance(60)
    expect(complete.mutate).toHaveBeenCalledTimes(scenario.finishes ? 1 : 0)
  })

  // The control, on the same fixtures: where staging's rule and the screen differ is exactly what 166 (a) changes. A retyped planned set's drops are in (staging
  // finished without them), a deleted set is out (staging never finished), a skipped head's drops are dead (staging waited for a log the rows no longer ask for);
  // everywhere else they agree, so a plain session finishes exactly as today.
  it('staging\'s rule agrees with the screen on every case that is not one of those three', () => {
    const differ = SCENARIOS.filter((scenario) => stagingFinishes(scenario.sets, scenario.logs) !== scenario.finishes).map((scenario) => scenario.name.split(':')[0])
    expect(differ).toEqual([
      'a planned dropset skipped with no log for its drop',
      'a planned set retyped to a dropset with two drops, logged, its drops open',
      'a set deleted during the workout is out of the rows',
    ])
  })
})
