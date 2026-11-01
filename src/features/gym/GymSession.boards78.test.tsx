// @vitest-environment jsdom
// Chunk 78 — the render fixtures of the prototype's "Workout" screen on board W1's data: its three DEMO states, "In progress (board W1)", "Warmup up next" and "All sets
// done" (`CAPTURE_RENDER=1 npx vitest run src/features/gym/GymSession.boards78.test.tsx` writes `__fixtures__/workout-in-progress-board-w1.html` … for `npm run shot`, which
// writes `design/1.2.1/built/<state>.png`). Each state is asserted first, then captured: a render that lost an item fails here, not in a picture. The world is the one
// `GymSession.boards.test.tsx` builds for W1 (Pull 1, week 2, Tuesday), with Monday's session of the curl as the prototype's workout fixture has it (item 21), and the items are
// SPEC 1.2.1 [5] (no history icon), [6] (WORKOUT COMPLETE), [12] and [13] (the open warmup's row and its ⋯), [21] ("MON 32.5 × 8 @ 1" beside LAST).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act, fireEvent, within, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { captureRender } from '../../testing/captureRender'
import type { ProgramExercise, ProgramSupersetBlock, Session, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { logOf, referenceSessionOf } from './cardHarness.testutil'
import { useOfflineStore } from '../offline/offlineStore'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
  useOfflineStore.setState({ pendingIds: new Set(), failedIds: new Set() })
})
beforeEach(() => useSettingsStore.setState({ ...DEFAULT_SETTINGS, restTimerEnabled: true, targetRestSeconds: 120 }))

// ─── Board W1's world (GymSession.boards.test.tsx) ─────────────────────────────────────────────────────────────────────────────────────────
const ex = (id: string, name: string, muscleGroup: string) => ({
  id, userId: 'u1', name, muscleGroup, isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
  status: 'active' as const, sourceLibraryId: null, lostAt: null,
}) as never
const pe = (id: string, exerciseId: string, name: string, muscleGroup: string, position: number, extra: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id, workoutDayId: 'wd-1', userId: 'u1', exerciseId, position, weightUnit: null, exercise: ex(exerciseId, name, muscleGroup), ...extra,
})
const set = (id: string, programExerciseId: string, setNumber: number, extra: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
  id, weekPlanId: 'wp-1', userId: 'u1', programExerciseId, setNumber, targetRir: 1, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...extra,
})

const peLat = pe('xe-lat', 'ex-lat', 'Lat Pulldown', 'back', 0)
const peRow = pe('xe-row', 'ex-row', 'Seated Cable Row', 'back', 1, { supersetBlockId: 'block-a' })
const peFace = pe('xe-face', 'ex-face', 'Face Pull', 'rear_delts', 2, { supersetBlockId: 'block-a' })
const peEz = pe('xe-ez', 'ex-ez', 'EZ Bar Curl', 'biceps', 3, { tempo: '3-0-1-0' } as Partial<ProgramExercise>)
const w1Plan: WeekPlan = {
  id: 'wp-1', userId: 'u1', mesocycleId: 'm1', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z',
  exercises: [peLat, peRow, peFace, peEz],
  sets: [
    set('lat-1', 'xe-lat', 1, { targetWeight: 55, repMin: 9, repMax: 9, targetRir: 2 }),
    set('lat-2', 'xe-lat', 2, { targetWeight: 55, repMin: 8, repMax: 8, targetRir: 1 }),
    set('lat-3', 'xe-lat', 3, { targetWeight: 52.5, repMin: 8, repMax: 10, targetRir: 1, stageKind: 'dropset', tags: ['push here'] }),
    set('lat-3-d1', 'xe-lat', 3, { isDropset: true, parentWeekPlanSetId: 'lat-3', stageIndex: 1, targetWeight: 40, isAmrap: true, targetRir: 0 }),
    set('cab-1', 'xe-row', 1, { targetWeight: 60, repMin: 12, repMax: 12, targetRir: 2 }),
    set('cab-2', 'xe-row', 2, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 1, targetRirMax: 2 }),
    set('cab-3', 'xe-row', 3, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 1, targetRirMax: 2 }),
    set('face-1', 'xe-face', 1, { targetWeight: 15, repMin: 18, repMax: 18, targetRir: 1 }),
    set('face-2', 'xe-face', 2, { targetWeight: 17.5, repMin: 15, repMax: 20, targetRir: 1, tags: ['squeeze'] }),
    set('ez-w', 'xe-ez', 1, { isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12, targetRir: null }),
    set('ez-1', 'xe-ez', 1, { targetWeight: 30, repMin: 8, repMax: 8, targetRir: 1 }),
    set('ez-2', 'xe-ez', 2, { targetWeight: 30, isAmrap: true, targetRir: 0, tags: ['cue'] }),
  ],
}

// "In progress (board W1)": the four logs of board W1.
const w1Logs: SetLog[] = [
  logOf({ id: 'l-lat-1', exerciseId: 'ex-lat', weekPlanSetId: 'lat-1', setNumber: 1, weight: 55, reps: 9, rir: 2 }),
  logOf({ id: 'l-lat-2', exerciseId: 'ex-lat', weekPlanSetId: 'lat-2', setNumber: 2, weight: 55, reps: 8, rir: 1 }),
  logOf({ id: 'l-cab-1', exerciseId: 'ex-row', weekPlanSetId: 'cab-1', setNumber: 1, weight: 60, reps: 12, rir: 2 }),
  logOf({ id: 'l-face-1', exerciseId: 'ex-face', weekPlanSetId: 'face-1', setNumber: 1, weight: 15, reps: 18, rir: 1 }),
]
// "Warmup up next": everything before the curl is done, so the curl's card is what is left, with its warmup unlogged (items 12, 13).
const warmupOpenLogs: SetLog[] = w1Logs.concat([
  logOf({ id: 'l-lat-3', exerciseId: 'ex-lat', weekPlanSetId: 'lat-3', setNumber: 3, weight: 52.5, reps: 9, rir: 1, stageKind: 'dropset' }),
  logOf({ id: 'l-lat-3d', exerciseId: 'ex-lat', weekPlanSetId: 'lat-3-d1', setNumber: 3, weight: 40, reps: 12, rir: 0, isDropset: true, parentSetId: 'l-lat-3', stageIndex: 1 }),
  logOf({ id: 'l-cab-2', exerciseId: 'ex-row', weekPlanSetId: 'cab-2', setNumber: 2, weight: 60, reps: 11, rir: 1 }),
  logOf({ id: 'l-face-2', exerciseId: 'ex-face', weekPlanSetId: 'face-2', setNumber: 2, weight: 17.5, reps: 16, rir: 1 }),
  logOf({ id: 'l-cab-3', exerciseId: 'ex-row', weekPlanSetId: 'cab-3', setNumber: 3, weight: 60, reps: 10, rir: 1 }),
])
// "All sets done": every planned set logged as planned, except the curl's AMRAP set, skipped (item 6).
const allDoneLogs: SetLog[] = w1Plan.sets.map((s, i) =>
  logOf({
    id: `done-${s.id}`, exerciseId: w1Plan.exercises.find((e) => e.id === s.programExerciseId)!.exerciseId, weekPlanSetId: s.id, setNumber: s.setNumber,
    weight: s.id === 'ez-2' ? null : (s.targetWeight ?? null), reps: s.id === 'ez-2' ? null : (s.repMax ?? 10), rir: s.targetRir ?? null, isWarmup: s.isWarmup, isDropset: s.isDropset,
    parentSetId: s.parentWeekPlanSetId ? `done-${s.parentWeekPlanSetId}` : null, stageIndex: s.stageIndex, isSkipped: s.id === 'ez-2',
    ...(s.stageKind ? { stageKind: s.stageKind } : {}), loggedAt: new Date(Date.UTC(2026, 0, 6, 9, 15 + i)).toISOString(),
  }),
)

const last = (exerciseId: string, rows: Array<[number, number, number, number]>): SetLog[] =>
  rows.map(([n, weight, reps, rir]) => logOf({ id: `last-${exerciseId}-${n}`, sessionId: 'prev', exerciseId, setNumber: n, weight, reps, rir }))
const lastByExercise: Record<string, SetLog[]> = {
  'ex-lat': last('ex-lat', [[1, 55, 8, 2], [2, 55, 8, 1], [3, 52.5, 10, 1]]),
  'ex-row': last('ex-row', [[1, 60, 11, 2], [2, 60, 11, 2], [3, 60, 10, 2]]),
  'ex-face': last('ex-face', [[1, 15, 17, 1], [2, 15, 17, 1]]),
  'ex-ez': last('ex-ez', [[1, 30, 8, 1], [2, 30, 9, 0]]),
}
// Monday's session this week (item 21): the curl was done then too, 32.5 × 8 @ 1 and 32.5 × 7 @ 0.
const mondayCurl = [
  logOf({ id: 'mon-ez-1', sessionId: 'mon', exerciseId: 'ex-ez', setNumber: 1, weight: 32.5, reps: 8, rir: 1 }),
  logOf({ id: 'mon-ez-2', sessionId: 'mon', exerciseId: 'ex-ez', setNumber: 2, weight: 32.5, reps: 7, rir: 0 }),
]
let session: Session
const blocks: ProgramSupersetBlock[] = [{ id: 'block-a', restAfterRoundSeconds: 90, restWithinRoundSeconds: null } as unknown as ProgramSupersetBlock]

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 48 * 60 + 12 }))
vi.mock('./useScrollToCurrentSet', () => ({
  useScrollToCurrentSet: () => ({ containerRef: () => {}, direction: 'down', scrollToCurrentSet: () => {} }),
}))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('./WarmupRoutineChecklist', () => ({ default: () => null }))
vi.mock('../offline/SyncFailedNotice', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: blocks }), useWarmupRoutineItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: vi.fn() }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  // Each exercise's last session (last week's Tuesday), and the curl's Monday of this week, as the batched read hands them.
  useExerciseReferenceSessions: () => ({
    data: new Map(
      Object.entries(lastByExercise).map(([exerciseId, logs]) => [
        exerciseId,
        exerciseId === 'ex-ez' ? [referenceSessionOf('mon', '2026-01-05', mondayCurl), referenceSessionOf('prev', '2025-12-30', logs)] : [referenceSessionOf('prev', '2025-12-30', logs)],
      ]),
    ),
    isLoading: false, isError: false, isFromCache: false, retry: vi.fn(),
  }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: vi.fn(), flushSyncQueue: vi.fn() }))

const { default: GymSession } = await import('./GymSession')
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'p1', userId: 'u1', name: 'PULL 1', position: 0, exercises: [] }

/** Mount the screen on Tuesday 2026-01-06 with `logs`, the rest timer running for `rest` seconds against a target of 2:00, and the phone's list read. */
async function mountState(logs: SetLog[], rest: number) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-06T10:00:00Z'))
  session = {
    id: 'session-1', userId: 'u1', mesocycleId: 'm1', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
    date: '2026-01-06', status: 'in_progress', note: null, startedAt: '2026-01-06T09:10:00Z', completedAt: null, createdAt: '2026-01-06T09:10:00Z',
    setLogs: logs, energyRating: null, pumpRating: null,
  }
  useRestTimerStore.setState({ startedAt: Date.now() - rest * 1000, isVisible: true, anchorId: null, targetSeconds: 120 })
  const view = render(
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={w1Plan} weekNumber={2} today="2026-01-06" />
    </MemoryRouter>,
  )
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve()
  })
  return view.container
}
const styleOf = (el: Element | null) => el?.getAttribute('style') ?? ''
const rowOf = (c: HTMLElement, key: string) => c.querySelector(`[data-row-key="${key}"]`) as HTMLElement
const alsoOf = (c: HTMLElement, key: string) => rowOf(c, key).querySelector('[data-also-line]')?.textContent ?? null

/** What every state of the workout has now: no history icon beside any ⋯ (item 5), the LAST line of each card and the ⋯ still there. */
function expectNoHistoryIcon(container: HTMLElement) {
  expect(container.querySelectorAll('svg.lucide-history')).toHaveLength(0)
  expect(screen.queryAllByRole('button', { name: /exercise history/i })).toHaveLength(0)
  expect(container.querySelectorAll('[aria-label="Exercise options"]')).toHaveLength(4)
  expect(container.querySelectorAll('[data-last-line]')).toHaveLength(4)
}

describe('Workout — In progress (board W1)', () => {
  it('no history icon on any of the four cards; the curl\'s open warmup is a muted W with an outlined LOG and a ⋯; the curl\'s rows add Monday\'s sets after LAST; the bar is the timer and the jump', async () => {
    const container = await mountState(w1Logs, 72)
    expectNoHistoryIcon(container)
    // the card\'s line names Monday too, and the sheet behind it is what the icon used to open
    const curlLine = Array.from(container.querySelectorAll('[data-last-line]')).map((el) => el.textContent)[3]
    expect(curlLine).toBe('LAST = LAST WEEK, TUE · ALSO MON')
    // items 12 and 13: the warmup row (open) is not the current set, like any other open row
    expect((container.querySelector('[data-current-set]') as HTMLElement).dataset.rowKey).toBe('set:lat-3')
    const warmup = rowOf(container, 'set:ez-w')
    expect(warmup.getAttribute('data-row-state')).toBe('unlogged')
    expect(styleOf(within(warmup).getByText('W'))).toContain('color: var(--text-muted)')
    expect(styleOf(within(warmup).getByText('LOG'))).toContain('box-shadow: inset 0 0 0 1px var(--border-strong)')
    expect(styleOf(within(warmup).getByText('LOG'))).not.toContain('var(--accent)')
    expect(within(warmup).getByLabelText('Set options')).toBeTruthy()
    // item 21: "LAST 30 × 8 @ 1   MON 32.5 × 8 @ 1" on the curl\'s 01, and its 02 (the AMRAP set) with Monday\'s second
    expect(rowOf(container, 'set:ez-1').textContent).toContain('LAST 30 × 8 @ 1')
    expect(alsoOf(container, 'set:ez-1')).toBe('MON 32.5 × 8 @ 1')
    expect(alsoOf(container, 'set:ez-2')).toBe('MON 32.5 × 7 @ 0')
    // the other exercises were not done on Monday: LAST alone, no earlier-this-week
    expect(alsoOf(container, 'set:lat-3')).toBeNull()
    expect(rowOf(container, 'set:lat-3').textContent).toContain('LAST 52.5 × 10 @ 1')
    // the bar: the timer (72 s of 2:00) and the jump to the current set, not WORKOUT COMPLETE
    const bar = container.querySelector('[data-rest-bar]') as HTMLElement
    expect(bar.hasAttribute('data-workout-complete')).toBe(false)
    for (const word of ['REST', '1:12', '/ 2:00', 'SET 03']) expect(bar.textContent).toContain(word)
    expect(container.textContent).not.toContain('WORKOUT COMPLETE')
    captureRender('workout-in-progress-board-w1', container)
  })
})

describe('Workout — Warmup up next', () => {
  it('everything before the curl is done: its warmup row is open and not the current set (curl 01 is), with the muted W, the outlined LOG and the ⋯ whose sheet holds SET TYPE and DELETE SET only', async () => {
    const container = await mountState(warmupOpenLogs, 40)
    expectNoHistoryIcon(container)
    expect((container.querySelector('[data-current-set]') as HTMLElement).dataset.rowKey).toBe('set:ez-1')
    const warmup = rowOf(container, 'set:ez-w')
    expect(warmup.hasAttribute('data-current-set')).toBe(false)
    expect(styleOf(within(warmup).getByText('W'))).toContain('color: var(--text-muted)')
    expect(styleOf(within(warmup).getByText('LOG'))).toContain('background-color: var(--surface)')
    expect(alsoOf(container, 'set:ez-1')).toBe('MON 32.5 × 8 @ 1')
    expect(container.querySelector('[data-rest-bar]')!.textContent).toContain('0:40')
    expect(container.textContent).not.toContain('WORKOUT COMPLETE')
    // the sheet of the warmup\'s ⋯ (opened and closed before the capture, which is the screen behind it)
    fireEvent.click(within(warmup).getByLabelText('Set options'))
    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByText('EZ BAR CURL · WARMUP')).toBeTruthy()
    expect(sheet.getByText('SET TYPE')).toBeTruthy()
    expect(sheet.getByText('DELETE SET')).toBeTruthy()
    for (const absent of ['CUES', 'FORM', 'SKIP THIS SET']) expect(sheet.queryByText(absent)).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    captureRender('workout-warmup-options-sheet', document.body) // the sheet is a portal: its fixture is the body, for the 375 px check inside a sheet (check-sheet-overflow.mjs)
    fireEvent.click(sheet.getByLabelText('Close'))
    expect(screen.queryByRole('dialog')).toBeNull()
    captureRender('workout-warmup-up-next', container)
  })
})

describe('Workout — All sets done', () => {
  it('every planned set logged and the curl\'s AMRAP set skipped: the bar says WORKOUT COMPLETE with FINISH, the timer and the jump are gone, FINISH SESSION stays at the foot', async () => {
    const container = await mountState(allDoneLogs, 20)
    expectNoHistoryIcon(container)
    expect(container.querySelector('[data-current-set]')).toBeNull()
    expect(rowOf(container, 'set:ez-2').getAttribute('data-row-state')).toBe('skipped')
    const bar = container.querySelector('[data-rest-bar]') as HTMLElement
    expect(bar.hasAttribute('data-workout-complete')).toBe(true)
    expect(bar.textContent).toBe('WORKOUT COMPLETEFINISH')
    expect(container.textContent).not.toContain('0:20') // the rest is timed underneath, not drawn
    expect(screen.getByText('FINISH SESSION')).toBeTruthy()
    captureRender('workout-all-sets-done', container)
  })
})
