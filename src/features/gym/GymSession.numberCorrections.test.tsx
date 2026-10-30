// @vitest-environment jsdom
// Chunk 58a — DECISIONS 178, 185 (c), 197 and 198 (a), at the screen that writes them. The rules module (chunk 46r) says which logged
// sets hold a number their row doesn't show (`numberCorrections`); the workout screen writes exactly that list, only for an
// in-progress session, through the sync queue's patch item (`queueSetLogPatch`), and the queue is sent at once when the phone is
// online. `useSyncQueue` is the spy here; the queue's own rules (order, retries, the shape of the request) are
// `useSyncQueue.patch.test.ts`.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, cleanup, fireEvent, act, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ExerciseSwap } from './sessionService'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session, SetLog } from '../../types'

afterEach(() => cleanup())

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const exercise = (id: string, name: string) => ({
  id, userId: 'user-1', name, muscleGroup: 'chest' as const, isArchived: false, createdAt: '2026-01-01T00:00:00Z',
  muscleSubgroups: null, movementPattern: null, status: 'active' as const, sourceLibraryId: null, lostAt: null,
})
const pe1: ProgramExercise = { id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null, exercise: exercise('ex-1', 'Bench Press') }
const planSet = (n: number) => ({
  id: `set-${n}`, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: n, targetRir: 2,
  isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
})
const weekPlan = (setCount: number): WeekPlan => ({
  id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1, isDeload: false, notes: null,
  sets: Array.from({ length: setCount }, (_, i) => planSet(i + 1)) as WeekPlan['sets'], exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
})

let session: Session
let sessionSwaps: ExerciseSwap[] = []
let online = true
const queued: Array<{ log: { id: string; sessionId: string; parentSetId?: string | null }; setNumber: number }> = []
const flushed = vi.fn()
const logCalls: Array<Record<string, unknown>> = [] // what LOG asked the server to write

const log =(over: Partial<SetLog> & { id: string }): SetLog => ({
  userId: 'user-1', sessionId: 'session-1', exerciseId: 'ex-1', weekPlanSetId: null, setNumber: 1, weight: 60, reps: 8, rir: null, note: null,
  isDropset: false, parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false,
  loggedAt: '2026-01-05T10:05:00Z', restSeconds: null, formRating: null, stageKind: null, addedPlace: null, ...over,
})
const head = (n: number, over: Partial<SetLog> = {}) => log({ id: `log-${n}`, weekPlanSetId: `set-${n}`, setNumber: n, ...over })

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => online }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 0 }))
vi.mock('./useScrollToCurrentSet', () => ({
  useScrollToCurrentSet: () => ({ containerRef: { current: null }, direction: null, scrollToCurrentSet: () => {} }),
}))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: [] }), useWarmupRoutineItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('../offline/useSyncQueue', () => ({
  queueSetLogPatch: async (l: { id: string; sessionId: string; parentSetId?: string | null }, setNumber: number) => {
    queued.push({ log: l, setNumber })
    return true // added (the queue says false for a patch it already holds: GymSession.numberCorrections.refetch.test.tsx runs the real one)
  },
  flushSyncQueue: () => {
    flushed()
    return Promise.resolve()
  },
}))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({
    mutateAsync: (params: Record<string, unknown>) => {
      logCalls.push(params)
      return Promise.resolve(log({ id: 'unused' }))
    },
  }),
  useLastSessionLogs: () => ({ data: [], isLoading: false }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: sessionSwaps }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')

const jsx = (plan: WeekPlan) => (
  <MemoryRouter>
    <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={plan} weekNumber={1} today="2026-01-05" />
  </MemoryRouter>
)
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
// The number cell of every row, in the order the screen draws them.
const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-row-key]')).map((el) => el.querySelector('span')?.textContent)

beforeEach(() => {
  session = {
    id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
    date: '2026-01-05', status: 'in_progress', note: null, startedAt: '2026-01-05T10:00:00Z', completedAt: null,
    createdAt: '2026-01-05T10:00:00Z', setLogs: [], energyRating: null, pumpRating: null,
  }
  sessionSwaps = []
  online = true
  queued.length = 0
  logCalls.length = 0
  flushed.mockClear()
})

// Bench 01–03 logged, A and B added and logged as 04 and 05, A unlogged, the session finished and continued (DECISIONS 178's own case):
// the card's list and A's draft ended with the session (G46), so B is now the fourth set and its log still holds 5.
const reopened = () => [head(1), head(2), head(3), log({ id: 'log-b', setNumber: 5, addedPlace: 2 })]

describe('GymSession — number correction (DECISIONS 178, Adam 2026-10-19)', () => {
  it('a session ended with an unlogged added set, then reopened, gets exactly one correction write for the logged set whose number differs, and the queue is sent', async () => {
    session = { ...session, setLogs: reopened() }
    const { container } = render(jsx(weekPlan(3)))
    await settle()
    expect(labels(container)).toEqual(['01', '02', '03', '04']) // B shows 04
    expect(queued).toEqual([{ log: { id: 'log-b', sessionId: 'session-1', parentSetId: null }, setNumber: 4 }])
    expect(flushed).toHaveBeenCalledTimes(1)
  })

  it('a second draw of the same session writes nothing — once the stored numbers are the rows\' (a refetch that returns them)', async () => {
    session = { ...session, setLogs: reopened() }
    const { rerender } = render(jsx(weekPlan(3)))
    await settle()
    expect(queued).toHaveLength(1)
    session = { ...session, setLogs: [head(1), head(2), head(3), log({ id: 'log-b', setNumber: 4, addedPlace: 2 })] } // the server's answer after the write
    rerender(jsx(weekPlan(3)))
    rerender(jsx(weekPlan(3)))
    await settle()
    expect(queued).toHaveLength(1)
    expect(flushed).toHaveBeenCalledTimes(1)
  })

  it('a session whose numbers are all the rows\' writes nothing on its first draw', async () => {
    session = { ...session, setLogs: [head(1), head(2), head(3)] }
    render(jsx(weekPlan(3)))
    await settle()
    expect(queued).toEqual([])
    expect(flushed).not.toHaveBeenCalled()
  })

  it('a stage log is corrected with its head: it shows the head\'s number, and the patch names its head', async () => {
    const dropPlan = weekPlan(2)
    dropPlan.sets = [...dropPlan.sets, { ...planSet(2), id: 'set-2-drop', isDropset: true, parentWeekPlanSetId: 'set-2', stageIndex: 1 } as WeekPlan['sets'][number]]
    // set 1 was deleted on another phone and its log is gone: set 2 is now 01, its log (and its drop's) still hold 2
    session = {
      ...session,
      setLogs: [head(2, { setNumber: 2, stageKind: 'dropset' }), log({ id: 'log-2-drop', weekPlanSetId: 'set-2-drop', setNumber: 2, parentSetId: 'log-2', stageIndex: 1, isDropset: true })],
    }
    render(jsx({ ...dropPlan, sets: dropPlan.sets.filter((s) => s.id !== 'set-1') }))
    await settle()
    expect(queued.map((q) => [q.log.id, q.log.parentSetId, q.setNumber]).sort()).toEqual([
      ['log-2', null, 1],
      ['log-2-drop', 'log-2', 1],
    ])
  })

  it('offline, each correction is queued and nothing is sent until the phone is back (the queue sends it on reconnect)', async () => {
    online = false
    session = { ...session, setLogs: reopened() }
    render(jsx(weekPlan(3)))
    await settle()
    expect(queued).toHaveLength(1)
    expect(flushed).not.toHaveBeenCalled()
  })

  it('a session that is not in progress (a finished one, drawn read-only) writes nothing', async () => {
    session = { ...session, status: 'completed', setLogs: reopened() }
    render(jsx(weekPlan(3)))
    await settle()
    expect(queued).toEqual([])
    expect(flushed).not.toHaveBeenCalled()
  })
})

describe('GymSession — two phones (DECISIONS 185 (c), Adam 2026-10-20)', () => {
  // Phone 1 added a set and has not logged it; phone 2 logged one of its own in the same place. Both read the same logs.
  const phone1Logs = () => [head(1), head(2), log({ id: 'b-log', setNumber: 3, addedPlace: 1 })]

  it('the phone that holds an open added set corrects no log after it', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('a-open-set-0000-0000-0000-000000000000')
    session = { ...session, setLogs: [head(1), head(2)] }
    const { container, rerender } = render(jsx(weekPlan(2)))
    fireEvent.click(screen.getByText('ADD SET')) // the open set X, place 1
    session = { ...session, setLogs: phone1Logs() } // a refetch brings the other phone's set into the same place
    rerender(jsx(weekPlan(2)))
    await settle()
    // X comes first (its id sorts before the log's), so B is shown as 04 although its log holds 3; this phone leaves it alone
    expect(labels(container)).toEqual(['01', '02', '03', '04'])
    expect(queued).toEqual([])
    vi.restoreAllMocks()
  })

  it('the other phone, which doesn\'t hold it, corrects each log once', async () => {
    session = { ...session, setLogs: [head(1), head(2), log({ id: 'b-log', setNumber: 4, addedPlace: 1 })] } // what the first phone wrote
    const { container } = render(jsx(weekPlan(2)))
    await settle()
    expect(labels(container)).toEqual(['01', '02', '03'])
    expect(queued).toEqual([{ log: { id: 'b-log', sessionId: 'session-1', parentSetId: null }, setNumber: 3 }])
  })
})

describe('GymSession — two phones over one database (DECISIONS 185 (c): across refetches a stored number changes once)', () => {
  // Two screens read one set of logs; the queue's writes go to that database and the next refetch brings them back, as on staging.
  it('an open added set on phone 1 and a log in its place from phone 2: nobody writes; once phone 1 logs its set, one number moves once and every number is its own', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('a-open-set-0000-0000-0000-000000000000')
    let db: SetLog[] = [head(1), head(2), log({ id: 'b-log', setNumber: 3, addedPlace: 1 })] // B: phone 2's own added set, logged as 3
    const held: Record<string, number[]> = {} // every number a log has held, in order: the fake database counts the changes
    const refetch = () => {
      for (const l of db) {
        const numbers = (held[l.id] ??= [])
        if (numbers[numbers.length - 1] !== l.setNumber) numbers.push(l.setNumber)
      }
      session = { ...session, setLogs: db.map((l) => ({ ...l })) }
    }
    const databaseTakesTheQueue = () => {
      for (const w of queued.splice(0)) db = db.map((l) => (l.id === w.log.id ? { ...l, setNumber: w.setNumber } : l))
    }

    session = { ...session, setLogs: [head(1), head(2)] }
    const phone1 = render(jsx(weekPlan(2)))
    fireEvent.click(within(phone1.container).getByText('ADD SET')) // phone 1: the open set, place 1
    refetch()
    phone1.rerender(jsx(weekPlan(2)))
    const phone2 = render(jsx(weekPlan(2))) // phone 2 holds no open set
    await settle()
    expect(queued).toEqual([]) // phone 1 leaves B alone (an open added set comes first), and phone 2 shows B as stored

    // phone 1 logs its set: the row shows 03, so 03 is what the log stores
    fireEvent.change(within(phone1.container).getByLabelText('Weight'), { target: { value: '60' } })
    fireEvent.change(within(phone1.container).getByLabelText('Reps'), { target: { value: '8' } })
    fireEvent.click(within(phone1.container).getByText('LOG'))
    await settle()
    expect(logCalls).toHaveLength(1)
    expect(logCalls[0]).toMatchObject({ setNumber: 3, addedPlace: 1 })
    db = [...db, log({ id: logCalls[0].id as string, setNumber: 3, addedPlace: 1 })]
    for (let round = 0; round < 3; round += 1) {
      refetch()
      phone1.rerender(jsx(weekPlan(2)))
      phone2.rerender(jsx(weekPlan(2)))
      await settle()
      databaseTakesTheQueue()
    }
    refetch()

    // the two logs that share place 1 end on 3 and 4, and no log's number changed more than once on the way
    for (const [id, numbers] of Object.entries(held)) expect(numbers.length, id).toBeLessThanOrEqual(2)
    expect(db.map((l) => l.setNumber).sort()).toEqual([1, 2, 3, 4])
    // both phones agree now: another draw writes nothing
    phone1.rerender(jsx(weekPlan(2)))
    phone2.rerender(jsx(weekPlan(2)))
    await settle()
    expect(queued).toEqual([])
    vi.restoreAllMocks()
  })
})

describe('GymSession — a swap with no record (DECISIONS 198 (a))', () => {
  // The seed's week-1 shape: a swap row from before 047 has no record of which sets moved. The slot is two cards, each numbered on its
  // own as 1.1 stored it; nothing is inferred from the logs, and drawing the session writes nothing.
  it('draws the original and the replacement as two cards, numbers the replacement\'s logs as stored (1, 2), and writes no correction', async () => {
    sessionSwaps = [
      {
        id: 'swap-1', sessionId: 'session-1', programExerciseId: 'pe-1', originalExerciseId: 'ex-1', originalExerciseName: 'Bench Press',
        replacementExerciseId: 'ex-2', replacementExerciseName: 'Incline Press', createdAt: '2026-01-05T10:10:00Z',
      },
    ]
    session = {
      ...session,
      setLogs: [
        head(1, { weight: 60 }),
        head(2, { isSkipped: true, weight: null, reps: null }), // the swap skipped the original's remaining set
        log({ id: 'r-1', exerciseId: 'ex-2', setNumber: 1, loggedAt: '2026-01-05T10:11:00Z' }),
        log({ id: 'r-2', exerciseId: 'ex-2', setNumber: 2, loggedAt: '2026-01-05T10:12:00Z' }),
      ],
    }
    const { container } = render(jsx(weekPlan(2)))
    await settle()
    expect(container.textContent).toContain('Bench Press')
    expect(container.textContent).toContain('Incline Press')
    expect(labels(container)).toEqual(['01', '02', '01', '02']) // the replacement counts from 1, not from the original's 3
    expect(queued).toEqual([])
    // neither card of the slot offers a second swap (025's unique index refuses one): "Swap for today" is in neither card's ⋯
    const options = screen.getAllByLabelText('Exercise options')
    expect(options).toHaveLength(2)
    for (const button of options) {
      fireEvent.click(button)
      expect(screen.getByText('Exercise history')).toBeTruthy() // the sheet is open
      expect(screen.queryByText('Swap for today')).toBeNull()
      fireEvent.click(screen.getByLabelText('Close'))
    }
  })
})
