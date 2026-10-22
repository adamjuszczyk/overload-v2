// @vitest-environment jsdom
// Chunk 58b — the render fixtures of boards W4 (the header states), W6 (offline and sync failed), W16 (the last-time sheet) and W17 (its
// states): `CAPTURE_RENDER=1 npx vitest run src/features/gym/GymSession.boards58b.test.tsx` writes `__fixtures__/w4h.html` … for `npm run
// shot`. Each state is asserted first, then captured, so a render that lost what the board draws fails here and not in a picture.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { captureRender } from '../../testing/captureRender'
import type { ProgramExercise, Session, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import type { ReferenceSession } from './sessionService'
import { exerciseOf, logOf, plannedDrop, plannedSet, referenceSessionOf } from './cardHarness.testutil'
import { useOfflineStore } from '../offline/offlineStore'
import WorkoutHeader from './WorkoutHeader'
import SyncFailedNotice from '../offline/SyncFailedNotice'
import { LastTimeStates } from './LastTimeSheet'
import { lastTimeView } from './lastTimeView'
import { headerEyebrow, setsLabel } from './workoutHeaderLogic'

let online = true
let session: Session
let references = new Map<string, ReferenceSession[]>()
const retrySyncFailures = vi.fn<() => Promise<void>>()

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => online }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 14 * 60 + 5 }))
vi.mock('./useScrollToCurrentSet', () => ({ useScrollToCurrentSet: () => ({ containerRef: () => {}, direction: null, scrollToCurrentSet: () => {} }) }))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('./SwapExerciseSheet', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: [] }), useWarmupRoutineItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: vi.fn() }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({ data: references, isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: vi.fn(), flushSyncQueue: vi.fn(), retrySyncFailures: () => retrySyncFailures() }))

const { default: GymSession } = await import('./GymSession')

beforeEach(() => {
  online = true
  retrySyncFailures.mockReset().mockResolvedValue(undefined)
  useOfflineStore.setState({ pendingIds: new Set(), failedIds: new Set(), syncFailures: [] })
})
afterEach(() => cleanup())

const frame = (caption: string, children: ReactNode) => (
  <section data-frame={caption} style={{ margin: '0 16px 18px' }}>
    <p style={{ fontSize: 10, letterSpacing: '0.14em', fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', margin: '0 0 8px' }}>{caption}</p>
    {children}
  </section>
)
const box = { border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--base)' } as const
const text = (container: HTMLElement, caption: string) => (container.querySelector(`[data-frame="${caption}"]`) as HTMLElement).textContent ?? ''

// ─── W4: the header states ───────────────────────────────────────────────────────────────────────
describe('W4 — the header states', () => {
  it('a deload session, a sequence run, a change that could not sync and the retry running', () => {
    const header = (eyebrow: string, clock: string, done: number, total: number) => (
      <WorkoutHeader eyebrow={eyebrow} name="PULL 1" clock={clock} progress={setsLabel({ done, total })} />
    )
    useOfflineStore.setState({ syncFailures: [{ queueId: 1, table: 'v2_set_logs', recordId: 'l-1', sessionId: 's1' }] })
    let finish: () => void = () => {}
    const weekday = { scheduleType: 'weekday' as const, weekNumber: 2, slot: null, date: '2026-01-06' } // a Tuesday
    const { container } = render(
      <MemoryRouter>
        <div style={{ paddingTop: 16 }}>
          {frame('DELOAD WEEK', <div style={box}>{header(headerEyebrow({ ...weekday, isDeload: true }), '6:30', 2, 9)}</div>)}
          {frame(
            'SEQUENCE PROGRAM',
            <div style={box}>{header(headerEyebrow({ scheduleType: 'sequence', weekNumber: 3, isDeload: false, date: '2026-01-06', slot: 2 }), '21:04', 5, 13)}</div>,
          )}
          {frame(
            "CHANGES THAT COULDN'T SYNC",
            <div style={box}>
              {header(headerEyebrow({ ...weekday, isDeload: false }), '48:12', 6, 15)}
              <SyncFailedNotice sessionId="s1" variant="strip" />
            </div>,
          )}
        </div>
      </MemoryRouter>,
    )
    expect(text(container, 'DELOAD WEEK')).toContain('DELOAD · WEEK 2 · TUESDAY')
    expect(text(container, 'DELOAD WEEK')).toContain('2 OF 9 SETS')
    expect(text(container, 'SEQUENCE PROGRAM')).toContain('CYCLE 3 · SLOT 2')
    expect(text(container, 'SEQUENCE PROGRAM')).toContain('5 OF 13 SETS')
    const failed = text(container, "CHANGES THAT COULDN'T SYNC")
    for (const word of ['WEEK 2 · TUESDAY', 'PULL 1', 'IN PROGRESS', '48:12', '6 OF 15 SETS', "1 CHANGE COULDN'T SYNC", 'RETRY']) expect(failed).toContain(word)
    const html = container.innerHTML
    // the retry running: RETRYING… alone, no button
    retrySyncFailures.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'RETRY' })))
    expect(text(container, "CHANGES THAT COULDN'T SYNC")).toContain('RETRYING…')
    expect(screen.queryByRole('button', { name: 'RETRY' })).toBeNull()
    const retrying = (container.querySelector('[data-frame="' + "CHANGES THAT COULDN'T SYNC" + '"] [role="status"]') as HTMLElement).outerHTML
    act(() => finish())
    captureRender('w4h', { innerHTML: html + `<div style="margin:0 16px 18px"><p style="font-size:10px;letter-spacing:0.14em;font-weight:700;color:var(--text-muted);font-family:var(--font-mono);margin:0 0 8px">RETRYING</p><div style="border:1px solid var(--border);border-radius:12px;overflow:hidden">${retrying}</div></div>` })
  })
})

// ─── W6: offline and sync failed ─────────────────────────────────────────────────────────────────
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'p1', userId: 'u1', name: 'PULL 1', position: 0, exercises: [] }
const lat: ProgramExercise = exerciseOf({ id: 'pe-lat', exerciseId: 'ex-lat', position: 0, exercise: { ...exerciseOf().exercise!, id: 'ex-lat', name: 'Lat Pulldown', muscleGroup: 'back' } })
const row: ProgramExercise = exerciseOf({ id: 'pe-row', exerciseId: 'ex-row', position: 1, exercise: { ...exerciseOf().exercise!, id: 'ex-row', name: 'Seated Cable Row', muscleGroup: 'back' } })
const forLat = (n: number, over: Partial<WeekPlanSet> = {}) => plannedSet(n, { id: `lat-${n}`, programExerciseId: 'pe-lat', ...over })
const forRow = (n: number, over: Partial<WeekPlanSet> = {}) => plannedSet(n, { id: `row-${n}`, programExerciseId: 'pe-row', ...over })
const sets: WeekPlanSet[] = [
  forLat(1, { targetWeight: 55, repMin: 9, repMax: 9, targetRir: 2 }),
  forLat(2, { targetWeight: 55, repMin: 8, repMax: 8, targetRir: 1 }),
  forLat(3, { targetWeight: 52.5, repMin: 10, repMax: 10, targetRir: 1, stageKind: 'dropset' }),
  plannedDrop(3, 1, { id: 'lat-3-d1', programExerciseId: 'pe-lat', parentWeekPlanSetId: 'lat-3', targetWeight: 40, isAmrap: true }),
  forRow(1, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 2 }),
  forRow(2, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 2 }),
]
const plan: WeekPlan = { id: 'wp-1', userId: 'u1', mesocycleId: 'm1', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z', exercises: [lat, row], sets }
const head = (sessionId: string, exerciseId: string, n: number, weight: number, reps: number, rir: number, date = '2025-12-30') =>
  logOf({ id: `${sessionId}-${n}`, sessionId, exerciseId, setNumber: n, weight, reps, rir, loggedAt: `${date}T10:00:00Z` })
const TODAY = '2026-01-06' // a Tuesday
function setSession(logs: SetLog[]) {
  session = {
    id: 'session-1', userId: 'u1', mesocycleId: 'm1', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
    date: TODAY, status: 'in_progress', note: null, startedAt: '2026-01-06T09:10:00Z', completedAt: null, createdAt: '2026-01-06T09:10:00Z',
    setLogs: logs, energyRating: null, pumpRating: null,
  }
}
const lastWeekLat = referenceSessionOf('lw-lat', '2025-12-30', [head('lw-lat', 'ex-lat', 1, 52.5, 10, 2), head('lw-lat', 'ex-lat', 2, 52.5, 9, 1), head('lw-lat', 'ex-lat', 3, 50, 10, 1)])
const lastWeekRow = referenceSessionOf('lw-row', '2025-12-30', [head('lw-row', 'ex-row', 1, 60, 11, 2), head('lw-row', 'ex-row', 2, 60, 10, 2)])
const screen390 = (children: ReactNode) => <MemoryRouter>{children}</MemoryRouter>

describe('W6 — offline, a row that could not sync, a row waiting to sync', () => {
  it('the offline strip under the header, the failed row (tinted, ONLY ON THIS PHONE · RETRY), the queued row (SYNC), and each exercise\'s line', () => {
    online = false
    references = new Map([['ex-lat', [lastWeekLat]], ['ex-row', [lastWeekRow]]])
    setSession([
      head('s', 'ex-lat', 1, 55, 9, 2, TODAY),
      logOf({ id: 'failed-log', exerciseId: 'ex-lat', weekPlanSetId: 'lat-2', setNumber: 2, weight: 55, reps: 8, rir: null }),
      logOf({ id: 'queued-log', exerciseId: 'ex-lat', weekPlanSetId: 'lat-3', setNumber: 3, weight: 52.5, reps: 10, rir: 1, stageKind: 'dropset' }),
    ].map((log, i) => (i === 0 ? { ...log, id: 'synced-log', weekPlanSetId: 'lat-1' } : log)))
    // the row that stopped retrying (the board draws no top notice in this frame, so syncFailures stays empty)
    useOfflineStore.setState({ pendingIds: new Set(['queued-log']), failedIds: new Set(['failed-log']) })
    const { container } = render(screen390(<GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={plan} weekNumber={2} today={TODAY} />))
    const body = container.textContent ?? ''
    for (const word of ['WEEK 2 · TUESDAY', 'PULL 1', 'IN PROGRESS', '14:05', '3 OF 6 SETS', 'OFFLINE · SETS WILL SYNC WHEN YOU RECONNECT', 'Lat Pulldown', 'Seated Cable Row', 'ONLY ON THIS PHONE · RETRY', 'SYNC']) {
      expect(body).toContain(word)
    }
    expect(Array.from(container.querySelectorAll('[data-last-line]')).map((el) => el.textContent)).toEqual(['LAST = LAST WEEK, TUE', 'LAST = LAST WEEK, TUE'])
    expect(container.querySelector('[data-row-key="set:lat-3"]')!.textContent).toContain('SYNC')
    expect(container.querySelector('[data-row-key="set:lat-1"] svg.lucide-check')).toBeTruthy()
    captureRender('w6', container)
  })
})

// ─── W16: the sheet ──────────────────────────────────────────────────────────────────────────────
describe('W16 — last time', () => {
  it('LAST WEEK and EARLIER THIS WEEK over the screen, with the deload note and FULL HISTORY', () => {
    references = new Map([
      ['ex-lat', [referenceSessionOf('lw', '2025-12-30', [head('lw', 'ex-lat', 1, 15, 18, 1), head('lw', 'ex-lat', 2, 15, 17, 1)]), referenceSessionOf('ew', '2026-01-05', [head('ew', 'ex-lat', 1, 15, 20, 1), head('ew', 'ex-lat', 2, 17.5, 15, 1)])]],
      ['ex-row', [lastWeekRow]],
    ])
    setSession([])
    const { container } = render(screen390(<GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={plan} weekNumber={2} today={TODAY} />))
    expect(container.querySelector('[data-last-line]')!.textContent).toBe('LAST = LAST WEEK, TUE · ALSO MON')
    fireEvent.click(container.querySelector('[data-last-line]')!)
    const dialog = screen.getByRole('dialog')
    for (const word of ['LAT PULLDOWN', 'Last time', 'LAST WEEK', 'TUE 30 DEC', 'EARLIER THIS WEEK', 'MON 5 JAN', '15 × 18', '17.5 × 15', 'Deload sessions are left out.', 'FULL HISTORY']) {
      expect(dialog.textContent).toContain(word)
    }
    captureRender('w16', document.body)
  })
})

// ─── W17: its states ─────────────────────────────────────────────────────────────────────────────
describe('W17 — the last-time states', () => {
  it('loading, last week with a dropset, not done last week, a sequence run, never done, all skipped (reaching back, every time), offline and failed', () => {
    const today = '2026-01-08' // a Thursday: last week is 29 Dec to 4 Jan
    const h = (id: string, n: number, weight: number, reps: number, rir: number) => logOf({ id: `${id}-${n}`, sessionId: id, setNumber: n, weight, reps, rir })
    const drop = (id: string, n: number, weight: number, reps: number) => logOf({ id: `${id}-${n}-d`, sessionId: id, setNumber: n, parentSetId: `${id}-${n}`, stageIndex: 1, isDropset: true, weight, reps, rir: null })
    const skip = (id: string, n: number) => logOf({ id: `${id}-${n}`, sessionId: id, setNumber: n, isSkipped: true, weight: null, reps: null })
    const lastWeek = referenceSessionOf('lw', '2025-12-30', [h('lw', 1, 52.5, 10, 2), h('lw', 2, 52.5, 9, 1), h('lw', 3, 50, 10, 1), drop('lw', 3, 37.5, 9)])
    const monthAgo = referenceSessionOf('ma', '2025-12-01', [h('ma', 1, 25, 12, 2), h('ma', 2, 25, 11, 2)])
    const threeDays = referenceSessionOf('td', '2026-01-05', [h('td', 1, 52.5, 10, 2), h('td', 2, 52.5, 9, 1), h('td', 3, 50, 10, 1), drop('td', 3, 37.5, 9)])
    const skippedWeek = referenceSessionOf('sk', '2025-12-29', [skip('sk', 1), skip('sk', 2), skip('sk', 3)])
    const reachBack = referenceSessionOf('rb', '2025-12-18', [h('rb', 1, 15, 12, 2), h('rb', 2, 15, 11, 1), h('rb', 3, 12.5, 12, 1)])
    const states: Array<[string, string, Parameters<typeof lastTimeView>[0]['sessions'], Partial<Parameters<typeof lastTimeView>[0]>]> = [
      ['LOADING', 'LAT PULLDOWN', [], { isLoading: true }],
      ['LAST WEEK · WITH A DROPSET', 'LAT PULLDOWN', [lastWeek], {}],
      ['NOT DONE LAST WEEK', 'STRAIGHT-ARM PULLDOWN', [monthAgo], {}],
      ['SEQUENCE PROGRAM · NOTHING EARLIER THIS CYCLE', 'LAT PULLDOWN', [lastWeek, threeDays], { scheduleType: 'sequence' }],
      ['NEVER DONE', 'KNEELING PULLDOWN', [], {}],
      ['ALL SKIPPED LAST WEEK · REACHES BACK', 'PEC DECK FLY', [skippedWeek, reachBack], {}],
      ['ALL SKIPPED · EVERY TIME', 'PEC DECK FLY', [skippedWeek], {}],
      ['OFFLINE', 'LAT PULLDOWN', [lastWeek], { isFromCache: true }],
      ['COULDN\'T LOAD', 'LAT PULLDOWN', [], { isError: true }],
    ]
    const { container } = render(
      <div style={{ paddingTop: 16 }}>
        {states.map(([caption, name, sessions, over]) =>
          frame(
            caption,
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>{name}</span>
              <LastTimeStates view={lastTimeView({ today, scheduleType: 'weekday', sessions, isLoading: false, isError: false, isFromCache: false, unit: 'kg', ...over })} onRetry={() => {}} />
            </div>,
          ),
        )}
      </div>,
    )
    expect(text(container, 'LOADING')).toContain('···')
    const withDrop = text(container, 'LAST WEEK · WITH A DROPSET')
    for (const word of ['LAST WEEK', 'TUE 30 DEC', '52.5 × 10', '@ 2', '50 × 10', '37.5 × 9', 'DROP']) expect(withDrop).toContain(word)
    expect(text(container, 'NOT DONE LAST WEEK')).toContain('LAST TIME')
    expect(text(container, 'NOT DONE LAST WEEK')).toContain('ABOUT 1 MONTH AGO')
    expect(text(container, 'SEQUENCE PROGRAM · NOTHING EARLIER THIS CYCLE')).toContain('3 DAYS AGO')
    expect(text(container, 'SEQUENCE PROGRAM · NOTHING EARLIER THIS CYCLE')).not.toContain('EARLIER THIS WEEK')
    expect(text(container, 'NEVER DONE')).toContain('FIRST TIME')
    const reached = text(container, 'ALL SKIPPED LAST WEEK · REACHES BACK')
    for (const word of ['LAST WEEK', 'SKIPPED', 'LAST TRAINED', '21 DAYS AGO', '15 × 12']) expect(reached).toContain(word)
    expect(text(container, 'ALL SKIPPED · EVERY TIME')).toContain('Skipped every time on record.')
    expect(text(container, 'OFFLINE')).toContain('OFFLINE · CACHED')
    expect(text(container, "COULDN'T LOAD")).toContain("COULDN'T LOAD LAST TIME")
    expect(text(container, "COULDN'T LOAD")).toContain('RETRY')
    captureRender('w17', container)
  })
})
