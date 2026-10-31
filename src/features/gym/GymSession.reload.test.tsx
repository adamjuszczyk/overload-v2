// @vitest-environment jsdom
// Chunk 63 — the workout screen reads what the phone kept (G46 (a); DECISIONS 170, 174, 178, 185 (c)): the card's list of the sets added in the session and the draft of an
// unlogged one come back after a reload, and the number corrections (58a) wait until they have, so a stored number is never "corrected" to a picture that lacks a set only
// this phone's list names. The same harness as `GymSession.numberCorrections.test.tsx`; the phone's copy is `draftStore.testutil.ts`, one tick away.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, cleanup, act, within } from '@testing-library/react'
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

const phone = vi.hoisted(() => ({ world: { drafts: new Map(), lists: null, log: [] } as import('./draftStore.testutil').DraftWorld }))
vi.mock('./sessionDrafts', async (importOriginal) => {
  const { fakeDraftStore } = await import('./draftStore.testutil')
  return { ...(await importOriginal<typeof import('./sessionDrafts')>()), dexieDraftStore: () => fakeDraftStore(phone.world) }
})

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
  phone.world.drafts.clear()
  phone.world.lists = null
  phone.world.log = []
})


const NORMAL = { kind: 'normal' } as const
const rowEl = (c: HTMLElement, key: string) => c.querySelector(`[data-row-key="${key}"]`) as HTMLElement
const box = (c: HTMLElement, key: string, label: string) => (within(rowEl(c, key)).getByLabelText(label) as HTMLInputElement).value

// Bench 01–03 logged, A and B added and logged as 04 and 05, A unlogged: the session is still in progress, so the phone still holds the card's list and A's draft.
// B's log holds 5, and so it should: A is open at 04. Without the phone's copy B would be the fourth set, and 58a's correction would write 5 -> 4.
describe('the workout screen after a reload, with the phone\'s list and draft (chunk 63)', () => {
  const setup = () => {
    session = { ...session, setLogs: [head(1), head(2), head(3), log({ id: 'log-b', weekPlanSetId: null, setNumber: 5, addedPlace: 2, weight: 40, reps: 8 })] }
    phone.world.lists = { 'pe-1': [{ localId: 'a1', logId: null, type: NORMAL, place: 1 }, { localId: 'b1', logId: 'log-b', type: NORMAL, place: 2 }] }
    const key = { sessionId: 'session-1', localId: 'a1', exerciseId: 'ex-1', position: 4 }
    phone.world.drafts.set('session-1|a:a1', {
      id: 'session-1|a:a1', sessionId: 'session-1', key,
      values: { weight: 50, reps: 10, rir: null, formRating: null, enteredUnit: null, type: NORMAL, place: 1, loggedAt: '2026-01-05T10:04:00Z' },
    })
  }

  it('draws the unlogged set at its place with its draft\'s numbers and writes no number correction (break: the screen not handed the phone\'s store; break: the corrections not waiting for it)', async () => {
    setup()
    const { container } = render(jsx(weekPlan(3)))
    await settle()
    await act(async () => { for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
    expect(labels(container)).toEqual(['01', '02', '03', '04', '05'])
    expect(rowEl(container, 'added:pe-1:a1').getAttribute('data-draft')).toBe('true')
    expect([box(container, 'added:pe-1:a1', 'Weight'), box(container, 'added:pe-1:a1', 'Reps')]).toEqual(['50', '10'])
    expect(queued).toEqual([]) // B's stored 5 is the number its row shows
    expect(flushed).not.toHaveBeenCalled()
  })

  it('without the phone\'s copy (a different phone) B is the fourth set and its number is corrected, as 58a does: the control for the test above', async () => {
    setup()
    phone.world.lists = null
    phone.world.drafts.clear()
    render(jsx(weekPlan(3)))
    await settle()
    await act(async () => { for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
    expect(queued.map((q) => [q.log.id, q.setNumber])).toEqual([['log-b', 4]])
  })
})
