// @vitest-environment jsdom
// Chunk 58a — the render fixtures of boards W1, W2, W3, W3b and W4 (`CAPTURE_RENDER=1 npx vitest run src/features/gym/GymSession.boards.test.tsx`
// writes `__fixtures__/w1.html` … for `npm run shot`). Each state is asserted first, then captured: a render that lost the state
// the board draws fails here, not in a picture. W1 is the whole screen; W2, W3 and W3b are frames of rows (each board draws its states
// as separate cards of rows); W4 is the rest bar's states.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { captureRender } from '../../testing/captureRender'
import type { ProgramExercise, ProgramSupersetBlock, Session, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { CardRows } from './WorkoutRow'
import { useExerciseCardState } from './useExerciseCardState'
import { useWorkoutRows } from './useWorkoutRows'
import RestBar from './RestBar'
import { exerciseOf, headLogOf, logOf, plannedDrop, plannedSet, referenceSessionOf } from './cardHarness.testutil'
import { useOfflineStore } from '../offline/offlineStore'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { spyWriters } from './setWriters.testutil'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
  useOfflineStore.setState({ pendingIds: new Set(), failedIds: new Set() })
})
beforeEach(() => useSettingsStore.setState({ ...DEFAULT_SETTINGS, restTimerEnabled: true, targetRestSeconds: 120 }))

// ─── W1: the whole screen ────────────────────────────────────────────────────────────────────────
const ex = (id: string, name: string, muscleGroup: ProgramExercise['exercise'] extends infer E ? (E extends { muscleGroup: infer M } ? M : never) : never) => ({
  id, userId: 'u1', name, muscleGroup, isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
  status: 'active' as const, sourceLibraryId: null, lostAt: null,
})
const pe = (id: string, exerciseId: string, name: string, muscleGroup: never, position: number, extra: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id, workoutDayId: 'wd-1', userId: 'u1', exerciseId, position, weightUnit: null, exercise: ex(exerciseId, name, muscleGroup), ...extra,
})
const set = (id: string, programExerciseId: string, setNumber: number, extra: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
  id, weekPlanId: 'wp-1', userId: 'u1', programExerciseId, setNumber, targetRir: 1, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...extra,
})

const peLat = pe('xe-lat', 'ex-lat', 'Lat Pulldown', 'back' as never, 0)
const peRow = pe('xe-row', 'ex-row', 'Seated Cable Row', 'back' as never, 1, { supersetBlockId: 'block-a' })
const peFace = pe('xe-face', 'ex-face', 'Face Pull', 'rear_delts' as never, 2, { supersetBlockId: 'block-a' })
const peEz = pe('xe-ez', 'ex-ez', 'EZ Bar Curl', 'biceps' as never, 3, { tempo: '3-0-1-0' } as Partial<ProgramExercise>)
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
const w1Logs: SetLog[] = [
  logOf({ id: 'l-lat-1', exerciseId: 'ex-lat', weekPlanSetId: 'lat-1', setNumber: 1, weight: 55, reps: 9, rir: 2 }),
  logOf({ id: 'l-lat-2', exerciseId: 'ex-lat', weekPlanSetId: 'lat-2', setNumber: 2, weight: 55, reps: 8, rir: 1 }),
  logOf({ id: 'l-cab-1', exerciseId: 'ex-row', weekPlanSetId: 'cab-1', setNumber: 1, weight: 60, reps: 12, rir: 2 }),
  logOf({ id: 'l-face-1', exerciseId: 'ex-face', weekPlanSetId: 'face-1', setNumber: 1, weight: 15, reps: 18, rir: 1 }),
]
const last = (exerciseId: string, rows: Array<[number, number, number, number]>): SetLog[] =>
  rows.map(([n, weight, reps, rir]) => logOf({ id: `last-${exerciseId}-${n}`, sessionId: 'prev', exerciseId, setNumber: n, weight, reps, rir }))
const lastByExercise: Record<string, SetLog[]> = {
  'ex-lat': last('ex-lat', [[1, 55, 8, 2], [2, 55, 8, 1], [3, 52.5, 10, 1]]),
  'ex-row': last('ex-row', [[1, 60, 11, 2], [2, 60, 11, 2], [3, 60, 10, 2]]),
  'ex-face': last('ex-face', [[1, 15, 17, 1], [2, 15, 17, 1]]),
  'ex-ez': last('ex-ez', [[1, 30, 8, 1], [2, 30, 9, 0]]),
}
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
  // The exercises' last sessions (last week's Tuesday), as the batched read hands them: the line on each card and the LAST line under each row read these.
  useExerciseReferenceSessions: () => ({
    data: new Map(Object.entries(lastByExercise).map(([exerciseId, logs]) => [exerciseId, [referenceSessionOf('prev', '2025-12-30', logs)]])),
    isLoading: false, isError: false, isFromCache: false, retry: vi.fn(),
  }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: vi.fn(), flushSyncQueue: vi.fn() }))

const { default: GymSession } = await import('./GymSession')
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'p1', userId: 'u1', name: 'PULL 1', position: 0, exercises: [] }

describe('W1 — the workout in progress', () => {
  it('the rows, a superset as rounds, a warmup row, the pinned rest bar with its jump button', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-06T10:00:00Z'))
    session = {
      id: 'session-1', userId: 'u1', mesocycleId: 'm1', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
      date: '2026-01-06', status: 'in_progress', note: null, startedAt: '2026-01-06T09:10:00Z', completedAt: null, createdAt: '2026-01-06T09:10:00Z',
      setLogs: w1Logs, energyRating: null, pumpRating: null,
    }
    useOfflineStore.setState({ pendingIds: new Set(['l-lat-2']) }) // the second set is still on this phone only: SYNC
    useRestTimerStore.setState({ startedAt: Date.now() - 72_000, isVisible: true, anchorId: null, targetSeconds: 120 })
    const { container } = render(
      <MemoryRouter>
        <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={w1Plan} weekNumber={2} today="2026-01-06" />
      </MemoryRouter>,
    )
    const text = container.textContent ?? ''
    // the current set is Lat Pulldown 03, the dropset head, with its cue and last time; its drop waits
    expect((container.querySelector('[data-current-set]') as HTMLElement).dataset.rowKey).toBe('set:lat-3')
    expect(text).toContain('DROPSET · 1 DROP')
    expect(text).toContain('PUSH HERE')
    expect(text).toContain('AFTER SET 03')
    expect(text).toContain('SYNC')
    // the header (board W4): the week and weekday, the workout, the clock, and the logged sets against the working sets planned (warmup out)
    for (const word of ['WEEK 2 · TUESDAY', 'PULL 1', 'IN PROGRESS', '48:12', '4 OF 11 SETS']) expect(text).toContain(word)
    // each card's line, and the LAST line under the open rows, read last week's session (tests owed, 58a: this fixture lost its LAST lines)
    expect(Array.from(container.querySelectorAll('[data-last-line]')).map((el) => el.textContent)).toEqual(Array(4).fill('LAST = LAST WEEK, TUE'))
    expect((container.querySelector('[data-current-set]') as HTMLElement).textContent).toContain('LAST 52.5 × 10 @ 1')
    expect(text).toContain('LAST 60 × 11 @ 2')
    expect(text).toContain('LAST 15 × 17 @ 1')
    expect(text).toContain('LAST 30 × 8 @ 1')
    // the superset: round headers, A1 and B1 logged, A2 typable next, "+ ADD ROUND"
    expect(text).toContain('SUPERSET A · REST 1:30 AFTER EACH ROUND')
    for (const round of ['ROUND 1', 'ROUND 2', 'ROUND 3']) expect(text).toContain(round)
    expect(text).toContain('ADD ROUND')
    // the warmup row and the working rows of the curl
    expect(container.querySelector('[data-row-key="set:ez-w"]')).not.toBeNull()
    // the pinned bar: REST 1:12 / 2:00, and the jump to the current set
    expect(text).toContain('1:12')
    expect(text).toContain('/ 2:00')
    expect(container.querySelector('[data-rest-bar]')!.textContent).toContain('SET 03')
    captureRender('w1', container)
  })
})

// ─── W2, W3, W3b: frames of rows ─────────────────────────────────────────────────────────────────
interface FrameProps {
  caption: string
  plannedSets: WeekPlanSet[]
  logs: SetLog[]
  /** The logs of the exercise's last session: the reference's primary one, last week's (today is Monday 2026-01-05). */
  lastLogs?: SetLog[]
  /** The exercise's reference is still being read (board W3b). */
  lastLogsLoading?: boolean
  addSet?: boolean
}
function Frame({ caption, plannedSets, logs, lastLogs = [], lastLogsLoading = false, addSet = false }: FrameProps) {
  const programExercise = exerciseOf()
  const workout = useWorkoutRows({ cards: [{ key: programExercise.id, programExercise, plannedSets }], blocks: [], logs })
  const state = useExerciseCardState({
    cardKey: programExercise.id, programExercise, plannedSets, workout, logs,
    referenceSessions: lastLogs.length > 0 ? [referenceSessionOf('prev', '2025-12-31', lastLogs)] : [], referenceLoading: lastLogsLoading,
    referenceMesocycleId: null, referenceIsError: false, referenceIsFromCache: false, onRetryReference: () => {}, today: '2026-01-05',
    onLog: () => Promise.resolve({} as SetLog), onUpdateSet: () => {}, onDeleteSet: async () => {}, writers: spyWriters(), onSwap: async () => {},
  })
  return (
    <section data-frame={caption} style={{ margin: '0 16px 18px' }}>
      <p style={{ fontSize: 10, letterSpacing: '0.14em', fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', margin: '0 0 8px' }}>{caption}</p>
      <div className="space-y-1.5" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--base)' }}>
        <CardRows state={state} rows={state.cardRows} current={workout.current} />
        {addSet && (
          <button onClick={state.handleAddSet} className="w-full text-xs font-bold" style={{ minHeight: 44, border: '1px dashed var(--border)', color: 'var(--text-muted)', borderRadius: 8 }}>
            + ADD SET
          </button>
        )}
      </div>
    </section>
  )
}
const Page = ({ children }: { children: ReactNode }) => <MemoryRouter><div style={{ paddingTop: 16 }}>{children}</div></MemoryRouter>
const inFrame = (container: HTMLElement, caption: string) => container.querySelector(`[data-frame="${caption}"]`) as HTMLElement

describe('W2 — row states', () => {
  it('just logged, measure set time before and during, and the other states (skipped, a warmup to tick, nothing typed)', () => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, measureSetTime: true, warmupDisplay: 'tick' })
    const sets = [plannedSet(1, { targetWeight: 55, repMin: 9, repMax: 9 }), plannedSet(2, { targetWeight: 52.5, repMin: 10, repMax: 10 })]
    const { container } = render(
      <Page>
        <Frame caption="JUST LOGGED · TAP THE ROW TO CHANGE ITS TYPE" plannedSets={sets.slice(0, 1)} logs={[headLogOf(1, { weight: 55, reps: 9, rir: 2 })]} />
        <Frame caption="MEASURE SET TIME ON · BEFORE AND DURING" plannedSets={sets.slice(0, 1)} logs={[]} />
        <Frame caption="MEASURE SET TIME ON · DURING" plannedSets={sets.slice(0, 1)} logs={[]} />
      </Page>,
    )
    expect(inFrame(container, 'JUST LOGGED · TAP THE ROW TO CHANGE ITS TYPE').textContent).toContain('@ RIR 2')
    // measure set time: before = START SET beside the weight and reps boxes; during = TIMING in place of the boxes
    const before = inFrame(container, 'MEASURE SET TIME ON · BEFORE AND DURING')
    expect(before.textContent).toContain('START SET')
    expect(before.querySelector('input[aria-label="RIR"]')).toBeNull()
    const during = inFrame(container, 'MEASURE SET TIME ON · DURING')
    act(() => void fireEvent.click(Array.from(during.querySelectorAll('button')).find((b) => b.textContent === 'START SET')!))
    expect(during.textContent).toContain('TIMING')
    expect(during.querySelector('input')).toBeNull()
    const measureHtml = container.innerHTML
    cleanup()
    // the other states (measure set time off): SKIPPED, the warmup as a tick row, and what LOG says with nothing typed
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, warmupDisplay: 'tick' })
    const rest = render(
      <Page>
        <Frame
          caption="OTHER STATES"
          plannedSets={[plannedSet(1, { id: 'w', isWarmup: true }), plannedSet(1, { id: 'set-1' }), plannedSet(2, { id: 'set-2' })]}
          logs={[logOf({ id: 'sk', weekPlanSetId: 'set-1', setNumber: 1, isSkipped: true, weight: null, reps: null })]}
        />
      </Page>,
    )
    const other = inFrame(rest.container, 'OTHER STATES')
    expect(other.textContent).toContain('SKIPPED')
    expect(other.textContent).toContain('WARMUP · TAP WHEN DONE')
    act(() => void fireEvent.click(Array.from(other.querySelectorAll('button')).find((b) => b.textContent === 'LOG')!))
    expect(other.textContent).toContain('Enter weight and reps, or skip the set from ⋮.')
    captureRender('w2', { innerHTML: measureHtml + rest.container.innerHTML })
  })

  it('warmups as rows and as a tick list (W2b\'s two boards)', () => {
    const plan = [plannedSet(1, { id: 'w1', isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12 }), plannedSet(2, { id: 'w2', isWarmup: true, targetWeight: 25, repMin: 10, repMax: 10 }), plannedSet(1, { id: 'set-1', targetWeight: 30, repMin: 8, repMax: 8, targetRir: 1 })]
    const logs = [logOf({ id: 'lw1', weekPlanSetId: 'w1', isWarmup: true, setNumber: 1, weight: 20, reps: 12 })]
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, warmupDisplay: 'rows' })
    const rows = render(<Page><Frame caption="WARMUPS AS ROWS" plannedSets={plan} logs={logs} lastLogs={[logOf({ id: 'l', sessionId: 'prev', weight: 30, reps: 8, rir: 1 })]} /></Page>)
    expect(rows.container.textContent).toContain('LAST')
    expect(rows.container.querySelectorAll('input[aria-label="Weight"]')).toHaveLength(2) // the open warmup and the current set
    const rowsHtml = rows.container.innerHTML
    cleanup()
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, warmupDisplay: 'tick' })
    const ticks = render(<Page><Frame caption="WARMUPS AS A TICK LIST" plannedSets={plan.slice(0, 2)} logs={logs} /></Page>)
    expect(ticks.container.textContent).toContain('WARMUP · DONE')
    expect(ticks.container.textContent).toContain('WARMUP · TAP WHEN DONE')
    expect(ticks.container.querySelector('input')).toBeNull()
    captureRender('w2b', { innerHTML: rowsHtml + ticks.container.innerHTML })
  })
})

describe('W3 — stage rows', () => {
  it('a planned dropset with its head next, the next drop opening, rest-pause carrying its weight, and logged stages marked by kind', () => {
    const dropset = [plannedSet(3, { stageKind: 'dropset', targetWeight: 52.5, repMin: 8, repMax: 10, targetRir: 1 }), plannedDrop(3, 1, { targetWeight: 40, isAmrap: true }), plannedDrop(3, 2, { targetWeight: 30, isAmrap: true })]
    const head = headLogOf(3, { stageKind: 'dropset', weight: 52.5, reps: 10, rir: 1 })
    const beforeIt = [plannedSet(1), plannedSet(2)]
    const byKind = [
      { n: 1, kind: 'rest_pause', weight: 35, reps: 10, stageWeight: 35, stageReps: 4 },
      { n: 2, kind: 'myo_reps', weight: 10, reps: 15, stageWeight: 10, stageReps: 5 },
      { n: 3, kind: 'cluster', weight: 25, reps: 4, stageWeight: 25, stageReps: 4 },
    ] as const
    const restPause = [plannedSet(1, { stageKind: 'rest_pause', targetWeight: 35, repMin: 10, repMax: 10, targetRir: 1 }), plannedDrop(1, 1, { targetWeight: 35, repMin: 4, repMax: 4 }), plannedDrop(1, 2, { targetWeight: 35, repMin: 4, repMax: 4 })]
    const { container } = render(
      <Page>
        <Frame caption="PLANNED DROPSET · HEAD IS NEXT" plannedSets={[plannedSet(1), plannedSet(2), ...dropset]} logs={[headLogOf(1), headLogOf(2)]} lastLogs={[logOf({ id: 'l1', sessionId: 'prev', setNumber: 1 }), logOf({ id: 'l2', sessionId: 'prev', setNumber: 2 }), logOf({ id: 'l3', sessionId: 'prev', setNumber: 3, weight: 52.5, reps: 10, rir: 1 })]} />
        <Frame caption="HEAD LOGGED · THE NEXT DROP OPENS" plannedSets={[...beforeIt, ...dropset]} logs={[headLogOf(1), headLogOf(2), head]} />
        <Frame caption="REST-PAUSE · THE WEIGHT CARRIES OVER" plannedSets={restPause} logs={[headLogOf(1, { id: 'rp-head', stageKind: 'rest_pause', weight: 35, reps: 10, rir: 1 })]} />
        <Frame
          caption="LOGGED STAGES · MARKED BY KIND"
          plannedSets={[plannedSet(3, { stageKind: 'dropset' }), plannedDrop(3, 1), plannedDrop(3, 2)]}
          logs={[
            head,
            logOf({ id: 'd1', setNumber: 3, parentSetId: 'log-3', stageIndex: 1, isDropset: true, weight: 40, reps: 8 }),
            logOf({ id: 'd2', setNumber: 3, parentSetId: 'log-3', stageIndex: 2, isDropset: true, weight: 30, reps: 7 }),
          ]}
        />
        <Frame
          caption="LOGGED STAGES · REST-PAUSE, MYO-REPS AND CLUSTER"
          plannedSets={byKind.flatMap(({ n, kind }) => [plannedSet(n, { stageKind: kind }), plannedDrop(n, 1)])}
          logs={byKind.flatMap(({ n, kind, weight, reps, stageWeight, stageReps }) => [
            headLogOf(n, { stageKind: kind, weight, reps, rir: n === 3 ? 2 : 1 }),
            logOf({ id: `st-${n}`, setNumber: n, parentSetId: `log-${n}`, stageIndex: 1, isDropset: true, weight: stageWeight, reps: stageReps }),
          ])}
        />
      </Page>,
    )
    const frames = ['PLANNED DROPSET · HEAD IS NEXT', 'HEAD LOGGED · THE NEXT DROP OPENS', 'REST-PAUSE · THE WEIGHT CARRIES OVER'].map((c) => inFrame(container, c))
    expect(frames[0].textContent).toContain('DROPSET · 2 DROPS')
    expect(frames[0].textContent).toContain('AFTER SET 03')
    expect(frames[0].textContent).toContain('AFTER DROP 1')
    expect(frames[1].querySelector('[data-current-set]')!.querySelector('span')!.textContent).toBe('↳')
    expect(frames[2].textContent).toContain('REST-PAUSE · 2 STAGES')
    expect((frames[2].querySelector('[data-current-set] input[aria-label="Weight"]') as HTMLInputElement).value).toBe('35')
    // a finished group draws no chip above its head (nothing is coming); its stage rows say which kind they are
    const finished = inFrame(container, 'LOGGED STAGES · MARKED BY KIND').textContent!
    expect(finished).toContain('DROP')
    expect(finished).not.toContain('DROPSET · ')
    const byKindText = inFrame(container, 'LOGGED STAGES · REST-PAUSE, MYO-REPS AND CLUSTER').textContent!
    for (const word of ['REST-PAUSE', 'MYO-REPS', 'CLUSTER']) expect(byKindText).toContain(word)
    expect(byKindText).not.toMatch(/· \d STAGE/)
    captureRender('w3', container)
  })
})

describe('W3b — skipped and added sets', () => {
  it('a skipped set and its drop, an added set while last time loads, and added sets with no plan behind them', () => {
    const skipped = [plannedSet(2, { id: 'set-2', stageKind: 'dropset' }), plannedDrop(2, 1), plannedSet(3, { id: 'set-3' })]
    const { container } = render(
      <Page>
        <Frame
          caption="SKIPPED SET AND ITS DROP"
          plannedSets={[plannedSet(1), ...skipped.slice(0, 2)]}
          logs={[headLogOf(1, { weight: 55, reps: 8, rir: 1 }), logOf({ id: 'sk', weekPlanSetId: 'set-2', setNumber: 2, isSkipped: true, weight: null, reps: null, stageKind: 'dropset' }), logOf({ id: 'skd', weekPlanSetId: 'set-2-drop-1', parentSetId: 'sk', stageIndex: 1, setNumber: 2, isSkipped: true, weight: null, reps: null })]}
        />
        <Frame caption="ADDED SET · LOADING LAST TIME" plannedSets={[plannedSet(3)]} logs={[headLogOf(3, { weight: 52.5, reps: 10, rir: 1 })]} lastLogsLoading addSet />
        <Frame caption="ADDED SETS · NO PLAN BEHIND THEM" plannedSets={[plannedSet(3)]} logs={[headLogOf(3, { weight: 52.5, reps: 10, rir: 1 })]} lastLogs={[logOf({ id: 'l1', sessionId: 'prev', setNumber: 1 }), logOf({ id: 'l2', sessionId: 'prev', setNumber: 2, weight: 50, reps: 9, rir: 1 })]} addSet />
      </Page>,
    )
    // add one set to the second frame and two to the third, as the board draws them
    const add = (caption: string) => fireEvent.click(Array.from(inFrame(container, caption).querySelectorAll('button')).find((b) => b.textContent === '+ ADD SET')!)
    add('ADDED SET · LOADING LAST TIME')
    add('ADDED SETS · NO PLAN BEHIND THEM')
    add('ADDED SETS · NO PLAN BEHIND THEM')
    expect(inFrame(container, 'SKIPPED SET AND ITS DROP').textContent).toContain('SKIPPED')
    expect(inFrame(container, 'ADDED SET · LOADING LAST TIME').textContent).toContain('LOADING LAST TIME…')
    expect(inFrame(container, 'ADDED SETS · NO PLAN BEHIND THEM').textContent).toContain('LAST')
    captureRender('w3b', container)
  })
})

describe('W4 — the rest bar and the jump button', () => {
  const frames: Array<{ caption: string; rest: 'past' | 'hidden' | 'hiddenPast' | 'running' | 'off'; jump: 'up' | 'down' | null }> = [
    { caption: 'REST · PAST TARGET', rest: 'past', jump: null },
    { caption: 'REST · HIDDEN', rest: 'hidden', jump: null },
    { caption: 'REST · HIDDEN, PAST TARGET', rest: 'hiddenPast', jump: null },
    { caption: 'CURRENT SET BELOW · REST TIMER OFF', rest: 'off', jump: 'down' },
    { caption: 'CURRENT SET ABOVE · REST RUNNING', rest: 'running', jump: 'up' },
  ]
  it('past target, hidden, hidden and past target, the jump button with the timer off and with a rest running', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-05T10:00:00Z'))
    const seconds = { past: 134, hidden: 48, hiddenPast: 134, running: 36, off: 0 }
    const html: string[] = []
    const text: Record<string, string> = {}
    for (const f of frames) {
      const { container } = render(<Bar {...f} elapsed={seconds[f.rest]} />)
      html.push(container.innerHTML)
      text[f.caption] = container.textContent ?? ''
      cleanup()
    }
    expect(text['REST · PAST TARGET']).toContain('2:14')
    expect(text['REST · PAST TARGET']).toContain('/ 2:00')
    expect(text['REST · PAST TARGET']).toContain('GO')
    expect(text['REST · HIDDEN']).toContain('0:48')
    expect(text['REST · HIDDEN']).not.toContain('/ 2:00')
    expect(text['REST · HIDDEN, PAST TARGET']).toContain('GO')
    expect(text['CURRENT SET BELOW · REST TIMER OFF']).toBe('CURRENT SET BELOW · REST TIMER OFFSET 03')
    expect(text['CURRENT SET ABOVE · REST RUNNING']).toContain('SET 03')
    expect(text['CURRENT SET ABOVE · REST RUNNING']).toContain('0:36')
    captureRender('w4', { innerHTML: `<div style="padding-top:16px">${html.join('')}</div>` })
  })
})

// The bar draws from the stores; a frame sets them before it renders and the state it needs is kept in the element's own copy.
function Bar({ caption, rest, jump, elapsed }: { caption: string; rest: string; jump: 'up' | 'down' | null; elapsed: number }) {
  useSettingsStore.setState({ restTimerEnabled: rest !== 'off', targetRestSeconds: 120 })
  useRestTimerStore.setState({ startedAt: rest === 'off' ? null : Date.now() - elapsed * 1000, isVisible: rest !== 'hidden' && rest !== 'hiddenPast', targetSeconds: 120 })
  return (
    <section data-frame={caption} style={{ margin: '0 16px 18px' }}>
      <p style={{ fontSize: 10, letterSpacing: '0.14em', fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', margin: '0 0 8px' }}>{caption}</p>
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <RestBar jump={{ direction: jump, label: jump ? 'SET 03' : null, onJump: () => {} }} />
      </div>
    </section>
  )
}
