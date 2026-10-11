// @vitest-environment jsdom
//
// B3 (2 of 5): an offline finish decided 'skipped' (and completed_at) from
// Dexie's copy of the session's logs, which only holds sets logged offline.
// A session with real sets logged online and one skipped set logged offline
// was queued as 'skipped'. The finish must look at everything the device
// knows of the session, and ask the replay to re-derive from the server.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'
import type { Session, SetLog } from '../../types'

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => false }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))

const dexieLogs: Array<Record<string, unknown>> = []
const queued: Array<Record<string, unknown>> = []
vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: { add: async (item: Record<string, unknown>) => void queued.push(item) },
    set_logs: { where: () => ({ equals: () => ({ toArray: async () => dexieLogs }) }) },
  },
}))

const { useCompleteSession } = await import('./useSession')

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const log = (id: string, loggedAt: string, isSkipped: boolean) => ({ id, sessionId: 's1', loggedAt, isSkipped })

function seedSession(logs: Array<ReturnType<typeof log>>) {
  queryClient.setQueryData<Session>(['v2_session', 's1'], {
    id: 's1', userId: 'user-1', mesocycleId: 'm1', weekPlanId: null, workoutDayId: 'wd', date: '2026-10-11',
    status: 'in_progress', note: null, startedAt: '2026-10-11T08:00:00Z', completedAt: null,
    createdAt: '2026-10-11T08:00:00Z', setLogs: logs as unknown as SetLog[],
    energyRating: null, pumpRating: null, movedToDate: null,
  })
}

afterEach(() => {
  dexieLogs.length = 0
  queued.length = 0
  queryClient.clear()
})

describe('useCompleteSession offline — classifies and times from every log the device knows (B3)', () => {
  it('real sets logged online + one skipped set logged offline is completed, not skipped', async () => {
    seedSession([
      log('a', '2026-10-11T08:10:00Z', false),
      log('b', '2026-10-11T08:20:00Z', false),
      log('c', '2026-10-11T08:30:00Z', true),
    ])
    dexieLogs.push(log('c', '2026-10-11T08:30:00Z', true))
    const { result } = renderHook(() => useCompleteSession(), { wrapper })

    const out = await result.current.mutateAsync({ id: 's1', note: null })

    expect(out.status).toBe('completed')
    expect(queued).toHaveLength(1)
    const payload = queued[0].payload as Record<string, unknown>
    expect(payload.status).toBe('completed')
    expect(payload.completed_at).toBe('2026-10-11T08:30:00Z')
  })

  it('completed_at is the latest of the online and offline sets', async () => {
    seedSession([log('a', '2026-10-11T08:50:00Z', false)])
    dexieLogs.push(log('b', '2026-10-11T08:40:00Z', false))
    const { result } = renderHook(() => useCompleteSession(), { wrapper })

    await result.current.mutateAsync({ id: 's1', note: null })

    expect((queued[0].payload as Record<string, unknown>).completed_at).toBe('2026-10-11T08:50:00Z')
  })

  it('every known set skipped is still skipped', async () => {
    seedSession([log('a', '2026-10-11T08:10:00Z', true)])
    dexieLogs.push(log('b', '2026-10-11T08:20:00Z', true))
    const { result } = renderHook(() => useCompleteSession(), { wrapper })

    const out = await result.current.mutateAsync({ id: 's1', note: null })

    expect(out.status).toBe('skipped')
  })

  it('the queued finish is flagged so the replay re-derives it from the server', async () => {
    seedSession([log('a', '2026-10-11T08:10:00Z', false)])
    const { result } = renderHook(() => useCompleteSession(), { wrapper })

    await result.current.mutateAsync({ id: 's1', note: null })

    expect(queued[0].recomputeFinish).toBe(true)
  })
})
