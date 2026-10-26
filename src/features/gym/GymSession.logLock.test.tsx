// @vitest-environment jsdom
// Chunk 60 — the log lock and the current set at the workout screen (TASKS-1.2 60; SPEC [1.2] "Log lock (18a)", "Current set", G54; board
// W7b). The screen is GymSession on the board W1 session (Lat Pulldown 03 is the current set, a superset's round 2 is open after it, a curl
// has a warmup), with the data hooks mocked at their boundary and `useLogSet`'s `mutateAsync` the spy: what it receives is what the screen
// writes. `CAPTURE_RENDER=1 npx vitest run src/features/gym/GymSession.logLock.test.tsx` writes `__fixtures__/w7b.html` for `npm run shot`.
//
// The store is the lock's switch (`logInOrder`, default true), so a test that needs the lock off sets `false` (a value the default can't be
// mistaken for), and the two settings are held against each other. Every writer here is proven by what it stores: what LOG sends after the
// question, with the number the row shows, and that it sends nothing before.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { captureRender } from '../../testing/captureRender'
import type { ProgramExercise, ProgramSupersetBlock, Session, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'

afterEach(() => {
  cleanup()
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
})
beforeEach(() => {
  writes = []
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, logInOrder: true, restTimerEnabled: true, targetRestSeconds: 120 })
})

// ─── The session: board W1 / W7b's ───────────────────────────────────────────────────────────────
const ex = (id: string, name: string, muscleGroup: string) => ({
  id, userId: 'u1', name, muscleGroup: muscleGroup as never, isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null,
  movementPattern: null, status: 'active' as const, sourceLibraryId: null, lostAt: null,
})
const pe = (id: string, exerciseId: string, name: string, muscleGroup: string, position: number, extra: Partial<ProgramExercise> = {}): ProgramExercise => ({
  id, workoutDayId: 'wd-1', userId: 'u1', exerciseId, position, weightUnit: null, exercise: ex(exerciseId, name, muscleGroup), ...extra,
})
const set = (id: string, programExerciseId: string, setNumber: number, extra: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
  id, weekPlanId: 'wp-1', userId: 'u1', programExerciseId, setNumber, targetRir: 1, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...extra,
})
const logOf = (over: Partial<SetLog> & { id: string }): SetLog => ({
  userId: 'u1', sessionId: 'session-1', exerciseId: 'ex-lat', weekPlanSetId: null, setNumber: 1, weight: 55, reps: 9, rir: 2, note: null,
  isDropset: false, parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false,
  loggedAt: '2026-01-06T09:20:00Z', restSeconds: null, formRating: null, stageKind: null, addedPlace: null, ...over,
})
const planOf = (exercises: ProgramExercise[], sets: WeekPlanSet[]): WeekPlan => ({
  id: 'wp-1', userId: 'u1', mesocycleId: 'm1', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z', exercises, sets,
})

const peLat = pe('xe-lat', 'ex-lat', 'Lat Pulldown', 'back', 0)
const peRow = pe('xe-row', 'ex-row', 'Seated Cable Row', 'back', 1, { supersetBlockId: 'block-a' })
const peFace = pe('xe-face', 'ex-face', 'Face Pull', 'rear_delts', 2, { supersetBlockId: 'block-a' })
const peEz = pe('xe-ez', 'ex-ez', 'EZ Bar Curl', 'biceps', 3)
// W1: Lat Pulldown 01–02 logged and 03 (a dropset head, reps 8–10) the current set; the superset's round 1 logged, rounds 2 and 3 open; the curl's
// warmup and two working sets open.
const w1Plan = planOf(
  [peLat, peRow, peFace, peEz],
  [
    set('lat-1', 'xe-lat', 1, { targetWeight: 55, repMin: 9, repMax: 9, targetRir: 2 }),
    set('lat-2', 'xe-lat', 2, { targetWeight: 55, repMin: 8, repMax: 8, targetRir: 1 }),
    set('lat-3', 'xe-lat', 3, { targetWeight: 52.5, repMin: 8, repMax: 10, targetRir: 1, stageKind: 'dropset' }),
    set('lat-3-d1', 'xe-lat', 3, { isDropset: true, parentWeekPlanSetId: 'lat-3', stageIndex: 1, targetWeight: 40, isAmrap: true, targetRir: 0 }),
    set('cab-1', 'xe-row', 1, { targetWeight: 60, repMin: 12, repMax: 12, targetRir: 2 }),
    set('cab-2', 'xe-row', 2, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 1, targetRirMax: 2 }),
    set('cab-3', 'xe-row', 3, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 1, targetRirMax: 2 }),
    set('face-1', 'xe-face', 1, { targetWeight: 15, repMin: 18, repMax: 18, targetRir: 1 }),
    set('face-2', 'xe-face', 2, { targetWeight: 17.5, repMin: 15, repMax: 20, targetRir: 1 }),
    set('ez-w', 'xe-ez', 1, { isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12, targetRir: null }),
    set('ez-1', 'xe-ez', 1, { targetWeight: 30, repMin: 8, repMax: 8, targetRir: 1 }),
    set('ez-2', 'xe-ez', 2, { targetWeight: 30, repMin: 8, repMax: 8, targetRir: 1 }),
  ],
)
const w1Logs = (): SetLog[] => [
  logOf({ id: 'l-lat-1', exerciseId: 'ex-lat', weekPlanSetId: 'lat-1', setNumber: 1, weight: 55, reps: 9, rir: 2 }),
  logOf({ id: 'l-lat-2', exerciseId: 'ex-lat', weekPlanSetId: 'lat-2', setNumber: 2, weight: 55, reps: 8, rir: 1 }),
  logOf({ id: 'l-cab-1', exerciseId: 'ex-row', weekPlanSetId: 'cab-1', setNumber: 1, weight: 60, reps: 12, rir: 2 }),
  logOf({ id: 'l-face-1', exerciseId: 'ex-face', weekPlanSetId: 'face-1', setNumber: 1, weight: 15, reps: 18, rir: 1 }),
]

let session: Session
let writes: Array<Record<string, unknown>> = []
const blocks: ProgramSupersetBlock[] = [{ id: 'block-a', restAfterRoundSeconds: 90, restWithinRoundSeconds: null } as unknown as ProgramSupersetBlock]

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 0 }))
vi.mock('./useScrollToCurrentSet', () => ({
  useScrollToCurrentSet: () => ({ containerRef: () => {}, direction: null, scrollToCurrentSet: () => {} }),
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
  // What the screen writes: the payload is recorded as it arrives, and the log it makes is the session's from the next render on.
  useLogSet: () => ({
    mutateAsync: (params: Record<string, unknown>) => {
      writes.push(params)
      const log = logOf({
        id: (params.id as string | undefined) ?? `new-${writes.length}`,
        exerciseId: params.exerciseId as string,
        weekPlanSetId: params.weekPlanSetId as string | null,
        setNumber: params.setNumber as number,
        weight: (params.weight as number | null) ?? null,
        reps: (params.reps as number | null) ?? null,
        rir: (params.rir as number | null) ?? null,
        isWarmup: (params.isWarmup as boolean | undefined) ?? false,
        isSkipped: (params.isSkipped as boolean | undefined) ?? false,
        isDropset: (params.isDropset as boolean | undefined) ?? false,
        parentSetId: (params.parentSetId as string | null) ?? null,
        stageIndex: (params.stageIndex as number | undefined) ?? 0,
        stageKind: (params.stageKind as SetLog['stageKind'] | undefined) ?? null,
        addedPlace: (params.addedPlace as number | null | undefined) ?? null,
      })
      session = { ...session, setLogs: [...(session.setLogs ?? []), log] }
      return Promise.resolve(log)
    },
  }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: vi.fn(), flushSyncQueue: vi.fn() }))

const { default: GymSession } = await import('./GymSession')
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'p1', userId: 'u1', name: 'PULL 1', position: 0, exercises: [] }

let plan: WeekPlan = w1Plan
const jsx = () => (
  <MemoryRouter>
    <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={plan} weekNumber={2} today="2026-01-06" />
  </MemoryRouter>
)
function open(weekPlan: WeekPlan, logs: SetLog[]) {
  plan = weekPlan
  session = {
    id: 'session-1', userId: 'u1', mesocycleId: 'm1', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
    date: '2026-01-06', status: 'in_progress', note: null, startedAt: '2026-01-06T09:10:00Z', completedAt: null, createdAt: '2026-01-06T09:10:00Z',
    setLogs: logs, energyRating: null, pumpRating: null,
  }
  const view = render(jsx())
  // The session is read at each render, so a write shows once the screen draws again, as it does when the query's cache changes.
  const refresh = () => act(async () => view.rerender(jsx()))
  return { ...view, refresh }
}
const press = (el: Element) =>
  act(async () => {
    fireEvent.click(el)
    for (let i = 0; i < 12; i++) await Promise.resolve()
  })
const rowOf = (container: HTMLElement, key: string) => container.querySelector(`[data-row-key="${key}"]`) as HTMLElement
const typeInto = (scope: HTMLElement, label: 'Weight' | 'Reps' | 'RIR', value: string) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } })
const currentKey = (container: HTMLElement) => (container.querySelector('[data-current-set]') as HTMLElement | null)?.dataset.rowKey
const label = (el: Element) => el.querySelector('span')?.textContent
const dialog = () => screen.queryByRole('dialog')
/** The row's LOG button, whichever kind of row it is. */
const logButton = (row: HTMLElement) => within(row).getByRole('button', { name: 'LOG' })

describe('with "Log sets in order" on, LOG on a row that is not the current set asks first (board W7b)', () => {
  it('LOG on A2 while Lat Pulldown 03 is current asks "Log A2 before set 03?", writes nothing yet, and logs A2 with LOG A2', async () => {
    useSettingsStore.setState({ logInOrder: true })
    const { container, refresh } = open(w1Plan, w1Logs())
    expect(currentKey(container)).toBe('set:lat-3')
    const a2 = rowOf(container, 'set:cab-2')
    expect(label(a2)).toBe('A2')
    typeInto(a2, 'Reps', '11')
    await press(logButton(a2))

    // the question: the board's words, with the names 46r's `lockDecision` gives
    const sheet = screen.getByRole('dialog', { name: 'Log A2 before set 03?' })
    const text = sheet.textContent ?? ''
    for (const words of [
      'SEATED CABLE ROW · A2',
      'Log A2 before set 03?',
      'The next set is Lat Pulldown 03. Logging A2 now leaves it for later — it stays open until you log or skip it.',
      'CANCEL',
      'LOG A2',
      'DON\'T WANT THIS QUESTION? TURN OFF "LOG SETS IN ORDER" IN SETTINGS.',
    ]) {
      expect(text).toContain(words)
    }
    expect(within(sheet).getByText('Lat Pulldown 03').tagName).toBe('STRONG')
    // nothing is written until it is answered (a build that logs on the tap writes here)
    expect(writes).toEqual([])
    captureRender('w7b', document.body) // after the assertions: a render that lost the question fails above and leaves the committed fixture alone

    await press(within(sheet).getByRole('button', { name: 'LOG A2' }))
    // A2 is logged as the number its row shows, with what was typed and the plan's weight; the question is gone
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ exerciseId: 'ex-row', weekPlanSetId: 'cab-2', setNumber: 2, weight: 60, reps: 11, isSkipped: false, isDropset: false })
    expect(dialog()).toBeNull()
    await refresh()
    expect(rowOf(container, 'set:cab-2').dataset.rowState).toBe('logged')
    // logging it left the current set where it was: Lat Pulldown 03 "stays open until you log or skip it"
    expect(currentKey(container)).toBe('set:lat-3')
  })

  it('a LOG that lacks its numbers is refused by the row first: its own message, no question, nothing written', async () => {
    const { container } = open(w1Plan, w1Logs())
    const a2 = rowOf(container, 'set:cab-2') // the plan's 10–12 is a placeholder, so LOG needs reps typed
    await press(logButton(a2))
    expect(dialog()).toBeNull()
    expect(a2.textContent).toContain('Enter weight and reps, or skip the set from ⋮.')
    expect(writes).toEqual([])
  })

  it('CANCEL, the close button and Escape write nothing and leave what was typed in the row', async () => {
    const { container } = open(w1Plan, w1Logs())
    const a2 = rowOf(container, 'set:cab-2')
    typeInto(a2, 'Reps', '11')
    for (const answer of ['cancel', 'close', 'escape'] as const) {
      await press(logButton(a2))
      const sheet = screen.getByRole('dialog', { name: 'Log A2 before set 03?' })
      if (answer === 'cancel') await press(within(sheet).getByRole('button', { name: 'CANCEL' }))
      else if (answer === 'close') await press(within(sheet).getByRole('button', { name: 'Close' }))
      else await act(async () => void fireEvent.keyDown(document, { key: 'Escape' }))
      expect(dialog()).toBeNull()
      expect(writes).toEqual([])
      expect((within(a2).getByLabelText('Reps') as HTMLInputElement).value).toBe('11') // the row keeps its numbers
      expect(a2.dataset.rowState).toBe('upcoming')
    }
  })

  it('LOG on the current row logs at once: no question, and the number is the row\'s', async () => {
    const { container } = open(w1Plan, w1Logs())
    const current = rowOf(container, 'set:lat-3')
    expect(current.hasAttribute('data-current-set')).toBe(true)
    typeInto(current, 'Reps', '9')
    await press(logButton(current))
    expect(dialog()).toBeNull()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ exerciseId: 'ex-lat', weekPlanSetId: 'lat-3', setNumber: 3, weight: 52.5, reps: 9 })
  })

  it('a row outside a superset is named "set 01": the eyebrow, the title and the button say so', async () => {
    const { container } = open(w1Plan, w1Logs())
    const ez1 = rowOf(container, 'set:ez-1')
    await press(logButton(ez1)) // the plan's 30 kg × 8 stand untouched, so this LOG has what it needs
    const sheet = screen.getByRole('dialog', { name: 'Log set 01 before set 03?' })
    expect(sheet.textContent).toContain('EZ BAR CURL · SET 01')
    expect(sheet.textContent).toContain('The next set is Lat Pulldown 03. Logging set 01 now leaves it for later')
    expect(within(sheet).getByRole('button', { name: 'LOG SET 01' })).toBeTruthy()
    expect(writes).toEqual([])
    await press(within(sheet).getByRole('button', { name: 'LOG SET 01' }))
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ exerciseId: 'ex-ez', weekPlanSetId: 'ez-1', setNumber: 1, weight: 30, reps: 8 })
  })
})

describe('with "Log sets in order" off, every LOG logs at once', () => {
  it('LOG on A2 writes at once and asks nothing (the fixture\'s `false` is not the default)', async () => {
    expect(DEFAULT_SETTINGS.logInOrder).toBe(true)
    useSettingsStore.setState({ logInOrder: false })
    const { container } = open(w1Plan, w1Logs())
    expect(currentKey(container)).toBe('set:lat-3')
    const a2 = rowOf(container, 'set:cab-2')
    typeInto(a2, 'Reps', '11')
    await press(logButton(a2))
    expect(dialog()).toBeNull()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ exerciseId: 'ex-row', weekPlanSetId: 'cab-2', setNumber: 2, reps: 11 })
  })
})

describe('the current set follows the log, in zigzag order through a superset', () => {
  it('A1 → B1 → A2 → B2: each LOG moves the accent frame and the jump target to the next row of the round, and one row has it at a time', async () => {
    const supersetPlan = planOf(
      [peRow, peFace],
      [
        set('cab-1', 'xe-row', 1, { targetWeight: 60, repMin: 12, repMax: 12 }),
        set('cab-2', 'xe-row', 2, { targetWeight: 60, repMin: 10, repMax: 10 }),
        set('face-1', 'xe-face', 1, { targetWeight: 15, repMin: 18, repMax: 18 }),
        set('face-2', 'xe-face', 2, { targetWeight: 17.5, repMin: 15, repMax: 15 }),
      ],
    )
    const { container, refresh } = open(supersetPlan, [])
    const order: Array<string | undefined> = []
    for (const key of ['set:cab-1', 'set:face-1', 'set:cab-2', 'set:face-2']) {
      expect(container.querySelectorAll('[data-current-set]')).toHaveLength(1)
      order.push(label(container.querySelector('[data-current-set]') as HTMLElement))
      expect(currentKey(container)).toBe(key)
      await press(logButton(rowOf(container, key))) // the current row: logs at once, with no question
      expect(dialog()).toBeNull()
      await refresh()
    }
    expect(order).toEqual(['A1', 'B1', 'A2', 'B2'])
    expect(container.querySelector('[data-current-set]')).toBeNull() // everything is logged
    expect(writes.map((w) => w.weekPlanSetId)).toEqual(['cab-1', 'face-1', 'cab-2', 'face-2'])
  })

  it('what was typed into B1 before it became the current set is still in its boxes when it is, and logs as typed', async () => {
    const supersetPlan = planOf(
      [peRow, peFace],
      [
        set('cab-1', 'xe-row', 1, { targetWeight: 60, repMin: 12, repMax: 12 }),
        set('face-1', 'xe-face', 1, { targetWeight: 15, repMin: 15, repMax: 20 }),
      ],
    )
    const { container, refresh } = open(supersetPlan, [])
    typeInto(rowOf(container, 'set:face-1'), 'Reps', '17')
    typeInto(rowOf(container, 'set:face-1'), 'Weight', '16.5')
    await press(logButton(rowOf(container, 'set:cab-1')))
    await refresh()
    const b1 = rowOf(container, 'set:face-1')
    expect(currentKey(container)).toBe('set:face-1')
    expect((within(b1).getByLabelText('Reps') as HTMLInputElement).value).toBe('17')
    expect((within(b1).getByLabelText('Weight') as HTMLInputElement).value).toBe('16.5')
    await press(logButton(b1))
    expect(dialog()).toBeNull()
    expect(writes[1]).toMatchObject({ weekPlanSetId: 'face-1', setNumber: 1, weight: 16.5, reps: 17 })
  })

  it('while A1 is current, LOG on B1 asks, and after A1 is logged B1 is the current row and logs at once', async () => {
    const supersetPlan = planOf(
      [peRow, peFace],
      [
        set('cab-1', 'xe-row', 1, { targetWeight: 60, repMin: 12, repMax: 12 }),
        set('face-1', 'xe-face', 1, { targetWeight: 15, repMin: 18, repMax: 18 }),
      ],
    )
    const { container, refresh } = open(supersetPlan, [])
    await press(logButton(rowOf(container, 'set:face-1')))
    expect(screen.getByRole('dialog', { name: 'Log B1 before A1?' }).textContent).toContain('The next set is Seated Cable Row 01.')
    await press(screen.getByRole('button', { name: 'CANCEL' }))
    await press(logButton(rowOf(container, 'set:cab-1')))
    await refresh()
    expect(currentKey(container)).toBe('set:face-1')
    await press(logButton(rowOf(container, 'set:face-1')))
    expect(dialog()).toBeNull()
    expect(writes.map((w) => w.weekPlanSetId)).toEqual(['cab-1', 'face-1'])
  })
})

describe('warmups never take part in the current set or the lock (G54)', () => {
  const curlPlan = () => planOf([peEz], [
    set('ez-w', 'xe-ez', 1, { isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12, targetRir: null }),
    set('ez-1', 'xe-ez', 1, { targetWeight: 30, repMin: 8, repMax: 8 }),
    set('ez-2', 'xe-ez', 2, { targetWeight: 30, repMin: 8, repMax: 8 }),
  ])

  it('rows: with the warmup unlogged, working set 01 is the current set, and LOG on 01 and LOG on the warmup both log at once', async () => {
    useSettingsStore.setState({ logInOrder: true, warmupDisplay: 'rows' })
    const first = open(curlPlan(), [])
    expect(currentKey(first.container)).toBe('set:ez-1')
    expect(rowOf(first.container, 'set:ez-w').hasAttribute('data-current-set')).toBe(false)
    await press(logButton(rowOf(first.container, 'set:ez-1')))
    expect(dialog()).toBeNull()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ weekPlanSetId: 'ez-1', setNumber: 1 })
    expect(writes[0].isWarmup).toBeFalsy()
    first.unmount()
    writes = []

    const second = open(curlPlan(), [])
    expect(currentKey(second.container)).toBe('set:ez-1') // a warmup still unlogged: working set 01 is the current one
    await press(logButton(rowOf(second.container, 'set:ez-w')))
    expect(dialog()).toBeNull()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ weekPlanSetId: 'ez-w', setNumber: 1, isWarmup: true })
  })

  it('tick display: the same, the warmup\'s tap logs at once while 01 is the current set', async () => {
    useSettingsStore.setState({ logInOrder: true, warmupDisplay: 'tick' })
    const first = open(curlPlan(), [])
    expect(currentKey(first.container)).toBe('set:ez-1')
    expect(rowOf(first.container, 'set:ez-w').textContent).toContain('WARMUP · TAP WHEN DONE')
    await press(logButton(rowOf(first.container, 'set:ez-1')))
    expect(dialog()).toBeNull()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ weekPlanSetId: 'ez-1', setNumber: 1 })
    first.unmount()
    writes = []

    const second = open(curlPlan(), [])
    expect(currentKey(second.container)).toBe('set:ez-1')
    await press(rowOf(second.container, 'set:ez-w'))
    expect(dialog()).toBeNull()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ weekPlanSetId: 'ez-w', setNumber: 1, isWarmup: true })
  })
})

describe('what LOG stores for a row logged out of order is the number the row shows (DECISIONS 151, 170)', () => {
  const latPlan = () => planOf([peLat], [1, 2, 3, 4].map((n) => set(`lat-${n}`, 'xe-lat', n, { targetWeight: 55, repMin: 8, repMax: 8 })))
  const oneLogged = () => [logOf({ id: 'l-lat-1', exerciseId: 'ex-lat', weekPlanSetId: 'lat-1', setNumber: 1 })]

  it('lock off, 01 logged and 02 open: LOG on 03 stores set_number 3 (not the logged sets + 1, which is 2)', async () => {
    useSettingsStore.setState({ logInOrder: false })
    const { container } = open(latPlan(), oneLogged())
    expect(Array.from(container.querySelectorAll('[data-row-key]')).map(label)).toEqual(['01', '02', '03', '04'])
    expect(currentKey(container)).toBe('set:lat-2')
    await press(logButton(rowOf(container, 'set:lat-3')))
    expect(dialog()).toBeNull()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ weekPlanSetId: 'lat-3', setNumber: 3, weight: 55, reps: 8 })
  })

  it('lock on: the same LOG asks "Log set 03 before set 02?", and LOG SET 03 stores 3', async () => {
    const { container } = open(latPlan(), oneLogged())
    await press(logButton(rowOf(container, 'set:lat-3')))
    expect(screen.getByRole('dialog', { name: 'Log set 03 before set 02?' })).toBeTruthy()
    expect(writes).toEqual([])
    await press(screen.getByRole('button', { name: 'LOG SET 03' }))
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ weekPlanSetId: 'lat-3', setNumber: 3 })
  })
})
