// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_SETTINGS } from './features/settings/settingsStore'
import { QueueServer } from './features/offline/queueServer.testutil'

// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]: "a queued write refused with the maintenance code stays in the queue ... It is sent when
// maintenance is off."; "When maintenance is off, the app opens where it was."): the two halves in the app's own composition. The REAL shell
// (`AppRoutes`: the gate, and the shell with its `SyncManager` and the REAL queue runner), the REAL gate on the app's `queryClient`, the REAL
// queue and its writes against the queue's test server, which refuses every write `OL001` while maintenance is on. While the screen shows the shell
// is not mounted, so nothing is sent; when the status reads "off" the shell opens, and the pass its runner starts sends what was held, in order.
interface QueueItem {
  id: number
  table: string
  operation: 'upsert' | 'delete' | 'patch'
  payload: Record<string, unknown>
  createdAt: string
  attempts?: number
  gaveUp?: boolean
  sendStarted?: boolean
  sessionId?: string
}
const world = vi.hoisted(() => ({
  queue: [] as unknown[],
  nextId: 1,
  status: { maintenance: true, minVersion: '1.2.1', exemptUserIds: [] as string[], updatedAt: 'now' },
}))
const queue = () => world.queue as QueueItem[]
const server = new QueueServer()

vi.mock('./features/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false, signOut: vi.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('./features/settings/useSettings', () => ({ useSettings: () => ({ data: DEFAULT_SETTINGS }) }))
vi.mock('./features/library/useExercises', () => ({ useSeedDefaultExercisesIfEmpty: () => {} }))
vi.mock('./features/release/appStatusService', () => ({ fetchAppStatus: async () => ({ ...world.status }) }))
vi.mock('./features/release/useQueuedWriteCount', () => ({ useQueuedWriteCount: () => queue().length }))
vi.mock('./lib/db', () => ({
  db: {
    sync_queue: {
      orderBy: () => ({ toArray: async () => structuredClone([...queue()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)) }),
      toArray: async () => structuredClone([...queue()]),
      add: async (item: Omit<QueueItem, 'id'>) => void queue().push({ ...item, id: world.nextId++ }),
      delete: async (id: number) => void (world.queue = queue().filter((q) => q.id !== id)),
      update: async (id: number, patch: Partial<QueueItem>) => void (world.queue = queue().map((q) => (q.id === id ? { ...q, ...patch } : q))),
    },
    set_logs: { delete: async () => {}, update: async () => {}, put: async () => {} },
  },
}))
vi.mock('./lib/supabase', () => ({ supabase: { from: (...args: [string]) => server.query(args[0]) } }))

vi.mock('./features/auth/LoginPage', () => ({ default: () => <div>LOGIN PAGE</div> }))
vi.mock('./features/gym/TodayPage', () => ({ default: () => <div>TODAY PAGE</div> }))
vi.mock('./features/plan/PlanPage', () => ({ default: () => <div>PLAN PAGE</div> }))
vi.mock('./features/plan/PrioritiesEditor', () => ({ default: () => <div>PRIORITIES EDITOR</div> }))
vi.mock('./features/progress/ProgressPage', () => ({ default: () => <div>PROGRESS PAGE</div> }))
vi.mock('./features/history/HistoryPage', () => ({ default: () => <div>HISTORY PAGE</div> }))
vi.mock('./features/history/ExerciseHistoryPage', () => ({ default: () => <div>EXERCISE HISTORY</div> }))
vi.mock('./features/history/SessionTypeHistoryPage', () => ({ default: () => <div>SESSION TYPE HISTORY</div> }))
vi.mock('./features/planner/PlannerPage', () => ({ default: () => <div>PLANNER PAGE</div> }))
vi.mock('./features/programs/ChangeProgramPage', () => ({ default: () => <div>CHANGE PROGRAM</div> }))
vi.mock('./features/programs/FinishedProgramPage', () => ({ default: () => <div>FINISHED PROGRAM</div> }))
vi.mock('./features/programs/FinishedProgramPriorities', () => ({ default: () => <div>FINISHED PROGRAM PRIORITIES</div> }))
vi.mock('./features/coach/MesoPrioritiesPage', () => ({ default: () => <div>MESO PRIORITIES</div> }))
vi.mock('./features/library/LibraryPage', () => ({ default: () => <div>LIBRARY PAGE</div> }))
vi.mock('./features/settings/SettingsPage', () => ({ default: () => <div>SETTINGS PAGE</div> }))
vi.mock('./features/settings/ReleaseNotesPage', () => ({ default: () => <div>RELEASE NOTES PAGE</div> }))
vi.mock('./features/settings/AfterUpdateSheet', () => ({ default: () => null }))
vi.mock('./features/coach/CoachPage', () => ({ default: () => <div>COACH PAGE</div> }))
vi.mock('./components/Nav', () => ({ default: () => <div>NAV</div> }))
vi.mock('./features/pwa/PwaUpdateNotice', () => ({ default: () => null }))
vi.stubGlobal('__APP_VERSION__', '1.2.1')

const { AppRoutes } = await import('./App')
const { queryClient } = await import('./lib/queryClient')
const { APP_STATUS_KEY } = await import('./lib/maintenanceRefusal')
const { useOfflineStore } = await import('./features/offline/offlineStore')

const SCREEN = 'BACK SOON'
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))

let clock = 0
function put(item: Omit<QueueItem, 'id' | 'createdAt'>) {
  queue().push({ ...item, id: world.nextId++, createdAt: `2026-10-30T10:00:${String(clock++).padStart(2, '0')}Z` })
}
const logRow = (id: string) => ({ id, user_id: 'u1', session_id: 's1', exercise_id: 'bench', week_plan_set_id: null, parent_set_id: null, set_number: 1, weight: 60, reps: 8, logged_at: '2026-10-30T10:00:00Z' })

beforeEach(() => {
  world.queue = []
  world.nextId = 1
  clock = 0
  world.status = { maintenance: true, minVersion: '1.2.1', exemptUserIds: [], updatedAt: 'now' }
  server.reset()
  queryClient.clear()
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  server.put('exercises', { id: 'bench' })
  server.put('v2_sessions', { id: 's1', status: 'in_progress' })
  server.put('v2_set_logs', { ...logRow('l2'), set_number: 2 })
  server.put('v2_set_logs', { ...logRow('l3'), set_number: 3 })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  onlineManager.setOnline(true)
  queryClient.clear()
})

describe('the held writes and the screen, in the real shell', () => {
  it('maintenance on: the screen shows and the held writes wait (at most the one refused attempt made before the answer was in); maintenance off: the app opens where it was and the queue is sent, in order', async () => {
    put({ table: 'v2_set_logs', operation: 'upsert', payload: logRow('l1') })
    put({ table: 'v2_set_logs', operation: 'patch', payload: { id: 'l2', set_number: 5 }, sessionId: 's1' })
    put({ table: 'v2_set_logs', operation: 'delete', payload: { id: 'l3' }, sessionId: 's1' })
    server.maintenance = true

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/library']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(SCREEN)).toBeTruthy()
    await tick()
    const whileTheScreenShows = [...server.requests]
    expect(whileTheScreenShows.length, 'at most the one attempt the shell made before the status was read').toBeLessThanOrEqual(1)
    for (const request of whileTheScreenShows) expect(request).toBe('upsert v2_set_logs:l1 -> OL001')
    await tick(100)
    expect(server.requests, 'nothing more is sent while the screen shows').toEqual(whileTheScreenShows)
    expect(queue().length, 'all three are still held').toBe(3)
    expect(queue().every((item) => item.attempts === undefined && item.gaveUp === undefined), 'none is counted').toBe(true)
    expect(useOfflineStore.getState().syncFailures).toEqual([])

    // maintenance ends: the next read of the status says so, and the shell opens at the address the phone was on
    server.maintenance = false
    world.status = { ...world.status, maintenance: false }
    server.requests.length = 0
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: APP_STATUS_KEY })
    })
    await waitFor(() => expect(screen.queryByText(SCREEN)).toBeNull())
    expect(screen.getByText('LIBRARY PAGE')).toBeTruthy()
    expect(screen.getByText('NAV')).toBeTruthy()

    await waitFor(() => expect(queue()).toEqual([]))
    expect(server.requests.map((request) => request.split(' ').slice(0, 2).join(' '))).toEqual(['upsert v2_set_logs:l1', 'patch v2_set_logs:l2', 'delete v2_set_logs:l3'])
    expect(server.has('v2_set_logs', 'l1')).toBe(true)
    expect(server.get('v2_set_logs', 'l2')!.set_number).toBe(5)
    expect(server.has('v2_set_logs', 'l3')).toBe(false)
  })
})
