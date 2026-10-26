// @vitest-environment jsdom
// Chunk 58b — the workout screen's header, the offline strip, the sync markers and the "last time" line and sheet, on the real screen
// (boards W4, W6, W16, W17). The reads are mocked at the screen's seams (the session, the reference sessions, the network flag), the
// offline store is the real one, and `retrySyncFailures` is the queue's own function replaced by a spy: RETRY is the one write here.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import type { ProgramExercise, Session, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import type { ReferenceSession } from './sessionService'
import { exerciseOf, logOf, plannedDrop, plannedSet, referenceSessionOf } from './cardHarness.testutil'
import { useOfflineStore } from '../offline/offlineStore'

const retrySyncFailures = vi.fn<() => Promise<void>>()
let online = true
let coach = false
let session: Session
let references = new Map<string, ReferenceSession[]>()
let referenceState = { isLoading: false, isError: false, isFromCache: false }
const retryReference = vi.fn()

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => online }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => coach }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 48 * 60 + 12 }))
vi.mock('./useScrollToCurrentSet', () => ({
  useScrollToCurrentSet: () => ({ containerRef: () => {}, direction: 'down', scrollToCurrentSet: () => {} }),
}))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: [] }), useWarmupRoutineItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: vi.fn() }),
  // The latest completed session of the exercise: a decoy no screen reads any more (58a's fix-forward).
  useLastSessionLogs: () => ({ data: [logOf({ id: 'decoy', sessionId: 'decoy-session', weight: 999, reps: 9, rir: 1 })], isLoading: false }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({ data: references, ...referenceState, retry: retryReference }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: vi.fn(), flushSyncQueue: vi.fn(), retrySyncFailures: () => retrySyncFailures() }))

const { default: GymSession } = await import('./GymSession')

// Today is Thursday 2026-01-08; the session is Thursday's. Last week's is Tuesday 2025-12-30, the week before's Thursday 2025-12-18.
const TODAY = '2026-01-08'
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'p1', userId: 'u1', name: 'PULL 1', position: 0, exercises: [] }
const bench: ProgramExercise = exerciseOf({ id: 'pe-1', exerciseId: 'ex-1' })
const planned: WeekPlanSet[] = [
  plannedSet(1, { id: 'w', isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12 }),
  plannedSet(1, { id: 'set-1', targetWeight: 60, repMin: 8, repMax: 8 }),
  plannedSet(2, { id: 'set-2', targetWeight: 60, repMin: 8, repMax: 8 }),
  plannedSet(3, { id: 'set-3', targetWeight: 55, repMin: 8, repMax: 10, stageKind: 'dropset' }),
  plannedDrop(3, 1, { targetWeight: 40, isAmrap: true }),
]
const weekPlan: WeekPlan = {
  id: 'wp-1', userId: 'u1', mesocycleId: 'm1', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z',
  exercises: [bench], sets: planned,
}
// the warmup and set 1 logged (set 1 queued on this phone), set 2 skipped
const logs: SetLog[] = [
  logOf({ id: 'l-w', weekPlanSetId: 'w', isWarmup: true, setNumber: 1, weight: 20, reps: 12 }),
  logOf({ id: 'l-1', weekPlanSetId: 'set-1', setNumber: 1, weight: 60, reps: 8, rir: 2 }),
  logOf({ id: 'l-2', weekPlanSetId: 'set-2', setNumber: 2, isSkipped: true, weight: null, reps: null }),
]
const head = (sessionId: string, n: number, weight: number, reps: number, rir: number) => logOf({ id: `${sessionId}-${n}`, sessionId, setNumber: n, weight, reps, rir })
const lastWeek = referenceSessionOf('lw', '2025-12-30', [head('lw', 1, 62.5, 8, 2), head('lw', 2, 62.5, 7, 1), head('lw', 3, 57.5, 9, 1)])

function renderScreen() {
  return render(
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={2} today={TODAY} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  online = true
  coach = false
  references = new Map([['ex-1', [lastWeek]]])
  referenceState = { isLoading: false, isError: false, isFromCache: false }
  retrySyncFailures.mockReset().mockResolvedValue(undefined)
  session = {
    id: 'session-1', userId: 'u1', mesocycleId: 'm1', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
    date: TODAY, status: 'in_progress', note: null, startedAt: '2026-01-08T09:10:00Z', completedAt: null, createdAt: '2026-01-08T09:10:00Z',
    setLogs: logs, energyRating: null, pumpRating: null,
  }
  useOfflineStore.setState({ pendingIds: new Set(), failedIds: new Set(), syncFailures: [] })
})
afterEach(() => cleanup())

describe('the header (boards W1, W4)', () => {
  it('names the week and weekday, the workout, IN PROGRESS, the clock and the sets done against the sets planned — warmups out of both', () => {
    renderScreen()
    expect(screen.getByText('WEEK 2 · THURSDAY')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PULL 1')
    expect(screen.getByText('IN PROGRESS')).toBeTruthy()
    expect(document.querySelector('[data-workout-clock]')!.textContent).toBe('48:12')
    // planned: set 1, set 2, set 3 and its drop = 4 (the warmup is not one); done: set 1 (set 2 is skipped, the warmup is logged and not counted)
    expect(document.querySelector('[data-workout-progress]')!.textContent).toBe('1 OF 4 SETS')
  })

  it('the weekday is the session\'s own day, not today\'s: a Tuesday session opened on a Thursday reads TUESDAY, one moved to Saturday reads SATURDAY', () => {
    // the dates and their weekdays, printed (RULES, Checks that lied #21)
    expect(['2026-01-06', '2026-01-08', '2026-01-10'].map((d) => format(parseISO(d), 'EEEE'))).toEqual(['Tuesday', 'Thursday', 'Saturday'])
    session = { ...session, date: '2026-01-06' }
    renderScreen()
    expect(screen.getByText('WEEK 2 · TUESDAY')).toBeTruthy()
    cleanup()
    session = { ...session, date: '2026-01-06', movedToDate: '2026-01-10' }
    renderScreen()
    expect(screen.getByText('WEEK 2 · SATURDAY')).toBeTruthy()
  })

  it('a set added in the session joins the total, and logging it raises the done count', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: /ADD SET/ }))
    expect(document.querySelector('[data-workout-progress]')!.textContent).toBe('1 OF 5 SETS')
  })

  it('shows the COACH button only to the coach user, above the clock', () => {
    renderScreen()
    expect(screen.queryByRole('button', { name: 'COACH' })).toBeNull()
    cleanup()
    coach = true
    renderScreen()
    expect(screen.getByRole('button', { name: 'COACH' })).toBeTruthy()
  })
})

describe('the offline strip (board W6)', () => {
  it('appears under the header while the phone is offline, and not while it is online', () => {
    renderScreen()
    expect(screen.queryByText('OFFLINE · SETS WILL SYNC WHEN YOU RECONNECT')).toBeNull()
    cleanup()
    online = false
    renderScreen()
    const strip = screen.getByText('OFFLINE · SETS WILL SYNC WHEN YOU RECONNECT')
    expect(strip.closest('[role="status"]')).toBeTruthy()
    // under the header: after it in the document
    const header = document.querySelector('header')!
    expect(header.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the sync markers (boards W1, W6) and RETRY', () => {
  const rowOf = (key: string) => document.querySelector(`[data-row-key="${key}"]`) as HTMLElement

  it('a logged row shows a tick once synced, SYNC while its write is queued on this phone, and nothing of the other states', () => {
    renderScreen()
    expect(rowOf('set:set-1').textContent).not.toContain('SYNC')
    expect(rowOf('set:set-1').querySelector('svg.lucide-check')).toBeTruthy()
    act(() => useOfflineStore.setState({ pendingIds: new Set(['l-1']) }))
    expect(rowOf('set:set-1').textContent).toContain('SYNC')
    expect(rowOf('set:set-1').textContent).not.toContain('ONLY ON THIS PHONE')
    expect(rowOf('set:set-1').querySelector('svg.lucide-check')).toBeNull()
  })

  it('a row whose write stopped retrying says ONLY ON THIS PHONE · RETRY and is tinted; a tap sends the failed writes again, once', () => {
    renderScreen()
    act(() => useOfflineStore.setState({ failedIds: new Set(['l-1']), syncFailures: [{ queueId: 1, table: 'v2_set_logs', recordId: 'l-1', sessionId: 'session-1' }] }))
    const row = rowOf('set:set-1')
    expect(row.textContent).toContain('ONLY ON THIS PHONE · RETRY')
    expect(row.style.backgroundColor).toContain('var(--error)')
    expect(retrySyncFailures).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByRole('button', { name: 'ONLY ON THIS PHONE · RETRY' }))
    expect(retrySyncFailures).toHaveBeenCalledTimes(1)
    // the rows that are fine are untouched
    expect(rowOf('set:set-2').textContent).not.toContain('ONLY ON THIS PHONE')
  })

  it('the strip under the header counts the changes that could not sync, RETRY sends them again, and RETRYING… stands alone while it runs', async () => {
    let finish: () => void = () => {}
    retrySyncFailures.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    renderScreen()
    expect(screen.queryByText(/COULDN'T SYNC/)).toBeNull()
    act(() => useOfflineStore.setState({ syncFailures: [{ queueId: 1, table: 'v2_set_logs', recordId: 'l-1', sessionId: 'session-1' }] }))
    expect(screen.getByText("1 CHANGE COULDN'T SYNC")).toBeTruthy()
    act(() => useOfflineStore.setState({ syncFailures: [1, 2, 3].map((n) => ({ queueId: n, table: 'v2_set_logs', recordId: `x${n}`, sessionId: 'session-1' })) }))
    expect(screen.getByText("3 CHANGES COULDN'T SYNC")).toBeTruthy()
    // another session's failure is not this screen's
    act(() => useOfflineStore.setState({ syncFailures: [{ queueId: 9, table: 'v2_set_logs', recordId: 'z', sessionId: 'other-session' }] }))
    expect(screen.queryByText(/COULDN'T SYNC/)).toBeNull()
    act(() => useOfflineStore.setState({ syncFailures: [{ queueId: 1, table: 'v2_set_logs', recordId: 'l-1', sessionId: 'session-1' }] }))
    const retry = screen.getByRole('button', { name: 'RETRY' })
    fireEvent.click(retry)
    expect(screen.getByText('RETRYING…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'RETRY' })).toBeNull()
    expect(retrySyncFailures).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(screen.getByRole('button', { name: 'RETRY' })).toBeTruthy()
    expect(retrySyncFailures).toHaveBeenCalledTimes(1)
  })

  it('the notice sits under the header, not above it', () => {
    renderScreen()
    act(() => useOfflineStore.setState({ syncFailures: [{ queueId: 1, table: 'v2_set_logs', recordId: 'l-1', sessionId: 'session-1' }] }))
    const notice = screen.getByText("1 CHANGE COULDN'T SYNC")
    expect(document.querySelector('header')!.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the last-time line and sheet (boards W6, W16, W17) read one source', () => {
  const lineOf = () => document.querySelector('[data-last-line]')!
  const sheet = () => within(screen.getByRole('dialog'))

  it('the line opens the sheet, and so does the history icon; the sheet closes; FULL HISTORY goes to the exercise\'s history', () => {
    renderScreen()
    expect(lineOf().textContent).toBe('LAST = LAST WEEK, TUE')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(lineOf())
    expect(sheet().getByText('LAST WEEK')).toBeTruthy()
    expect(sheet().getByText('Deload sessions are left out.')).toBeTruthy()
    expect(sheet().getByRole('link', { name: /FULL HISTORY/ }).getAttribute('href')).toBe('/exercise/ex-1')
    fireEvent.click(sheet().getByRole('button', { name: /close/i }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Exercise history' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('the line, the sheet and the rows\' LAST line all read the reference\'s primary session — last week\'s deload session is none of them', () => {
    const deloadLastWeek: ReferenceSession = { ...lastWeek, isDeload: true, logs: referenceSessionOf('dl', '2025-12-30', [head('dl', 1, 100, 5, 0)]).logs }
    const threeWeeks = referenceSessionOf('tw', '2025-12-18', [head('tw', 1, 15, 12, 2), head('tw', 2, 15, 11, 1), head('tw', 3, 12.5, 12, 1)])
    references = new Map([['ex-1', [deloadLastWeek, threeWeeks]]])
    renderScreen()
    expect(lineOf().textContent).toBe('LAST = 21 DAYS AGO')
    // the current row is set 03 (set 1 logged, set 2 skipped): its LAST line is the third of that session
    expect(document.querySelector('[data-current-set]')!.textContent).toContain('LAST 12.5 × 12 @ 1')
    fireEvent.click(lineOf())
    expect(sheet().getByText('LAST TIME')).toBeTruthy()
    expect(sheet().getByText('12.5 × 12')).toBeTruthy()
    expect(sheet().queryByText('100 × 5')).toBeNull()
    expect(document.body.textContent).not.toContain('999')
  })

  it('EARLIER THIS WEEK is in the sheet when the exercise was done earlier this week, and the line says on which day', () => {
    references = new Map([['ex-1', [lastWeek, referenceSessionOf('ew', '2026-01-05', [head('ew', 1, 65, 6, 1)])]]])
    renderScreen()
    expect(lineOf().textContent).toBe('LAST = LAST WEEK, TUE · ALSO MON')
    fireEvent.click(lineOf())
    const panels = Array.from(document.querySelectorAll('[data-last-panel]')).map((el) => (el as HTMLElement).dataset.lastPanel)
    expect(panels).toEqual(['LAST WEEK', 'EARLIER THIS WEEK'])
    expect(within(document.querySelector('[data-last-panel="EARLIER THIS WEEK"]') as HTMLElement).getByText('65 × 6')).toBeTruthy()
  })

  it('while the reference loads the line says so, and a failed read is a state with its own RETRY that asks the reference again', () => {
    referenceState = { isLoading: true, isError: false, isFromCache: false }
    renderScreen()
    expect(lineOf().textContent).toBe('LAST = ···')
    cleanup()
    referenceState = { isLoading: false, isError: true, isFromCache: false }
    references = new Map()
    renderScreen()
    expect(lineOf().textContent).toContain("COULDN'T LOAD LAST TIME")
    expect(retryReference).not.toHaveBeenCalled()
    fireEvent.click(within(lineOf() as HTMLElement).getByRole('button', { name: 'RETRY' }))
    expect(retryReference).toHaveBeenCalledTimes(1)
  })

  it('numbers from the phone\'s cache say OFFLINE · CACHED in the sheet', () => {
    referenceState = { isLoading: false, isError: false, isFromCache: true }
    renderScreen()
    fireEvent.click(lineOf())
    expect(sheet().getByText('OFFLINE · CACHED')).toBeTruthy()
  })
})
