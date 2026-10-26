// @vitest-environment jsdom
// Chunk 64 — what COMPLETE writes into the session row (SPEC [1.2] "Finishing (11, C6)"; TASKS 64: "COMPLETE → `useCompleteSession` unchanged … the writes are today's"). The one place this
// chunk's screen writes data, so it is run through the REAL `useCompleteSession` and the real `completeSession` over a stand-in for the tables, as `useSession.completeSession.test.tsx`
// does for the hook alone: a note typed and two chips tapped on the screen end as the `v2_sessions` patch (online), as the queued upsert (offline), a session whose every set was
// skipped still completes as `skipped`, and the success clears what the phone kept for the session (63, G46). The screen's parity with the old one's payload is `FinishScreen.test.tsx`'s.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import type { Session } from '../../types'

afterEach(() => cleanup())

const world = vi.hoisted(() => ({
  online: true,
  queue: [] as Array<{ id: number; table: string; operation: string; payload: Record<string, unknown>; createdAt: string; recomputeFinish?: boolean }>,
  serverLogs: [] as Array<Record<string, unknown>>,
  sessionUpdates: [] as Array<Record<string, unknown>>,
  cleared: [] as string[],
  nextQueueId: 1,
}))

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => world.online }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../components/ExercisePickerSheet', () => ({ default: () => null }))
vi.mock('./sessionDrafts', () => ({ clearSessionDrafts: async (id: string) => void world.cleared.push(id) }))
vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      orderBy: () => ({ toArray: async () => [...world.queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }),
      toArray: async () => [...world.queue],
      add: async (item: Record<string, unknown>) => void world.queue.push({ ...item, id: world.nextQueueId++ } as (typeof world.queue)[number]),
      delete: async (id: number) => void (world.queue = world.queue.filter((q) => q.id !== id)),
      update: async (id: number, patch: Record<string, unknown>) => void (world.queue = world.queue.map((q) => (q.id === id ? { ...q, ...patch } : q))),
    },
    set_logs: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
    sessions: { put: vi.fn() },
  },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      let patch: Record<string, unknown> | null = null
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (p: Record<string, unknown>) => {
          patch = p
          return chain
        },
        eq: () => chain,
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          if (patch) {
            world.sessionUpdates.push(patch)
            return Promise.resolve({ error: null }).then(resolve, reject)
          }
          return Promise.resolve({ data: world.serverLogs, error: null }).then(resolve, reject)
        },
      }
      return chain
    },
  },
}))

let session: Session
vi.mock('./useSession', async (importOriginal) => ({ ...(await importOriginal<typeof import('./useSession')>()), useActiveSession: () => ({ data: session }) }))

const { default: FinishScreen } = await import('./FinishScreen')

const base: Session = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: '2026-01-06', status: 'in_progress', note: null,
  startedAt: '2026-01-06T10:00:00Z', completedAt: null, createdAt: '2026-01-06T10:00:00Z', setLogs: [], energyRating: null, pumpRating: null,
}
const serverLog = (id: string, loggedAt: string, isSkipped: boolean) => ({ id, session_id: 'session-1', logged_at: loggedAt, is_skipped: isSkipped })

function screen() {
  return render(
    <QueryClientProvider client={queryClient}>
      <FinishScreen sessionId="session-1" eyebrow="WEEK 2 · TUESDAY · 52:40" workoutName="Pull 1" warning={null} onBack={() => {}} onGoBack={() => {}} />
    </QueryClientProvider>,
  )
}
const chip = (c: HTMLElement, group: string, text: string) => within(within(c).getByRole('group', { name: group })).getByRole('button', { name: text })

beforeEach(() => {
  session = { ...base }
  world.online = true
  world.queue = []
  world.serverLogs = []
  world.sessionUpdates = []
  world.cleared = []
  world.nextQueueId = 1
})
afterEach(() => queryClient.clear())

describe('COMPLETE on the finish screen, through the real hook and service', () => {
  it('online: a trimmed note and the two chosen ratings are the one `v2_sessions` patch, with the status and the end time the logs give (W; break: swap the ratings; break: the note untrimmed; break: drop the note)', async () => {
    world.serverLogs = [serverLog('a', '2026-01-06T10:05:00Z', false), serverLog('b', '2026-01-06T10:40:00Z', false)]
    const { container } = screen()
    fireEvent.change(container.querySelector('textarea')!, { target: { value: '  Grip went on the last curl set.  ' } })
    fireEvent.click(chip(container, 'ENERGY', 'HIGH'))
    fireEvent.click(chip(container, 'PUMP', 'GOOD'))
    fireEvent.click(within(container).getByRole('button', { name: 'COMPLETE' }))
    await waitFor(() => expect(world.sessionUpdates).toHaveLength(1))
    expect(world.sessionUpdates[0]).toEqual({
      status: 'completed',
      completed_at: '2026-01-06T10:40:00Z',
      note: 'Grip went on the last curl set.',
      energy_rating: 'high',
      pump_rating: 'good',
    })
  })

  it('pressing COMPLETE with nothing typed writes nulls, not empty strings: note, energy and pump are all null (the "not rated" state)', async () => {
    world.serverLogs = [serverLog('a', '2026-01-06T10:05:00Z', false)]
    const { container } = screen()
    fireEvent.click(within(container).getByRole('button', { name: 'COMPLETE' }))
    await waitFor(() => expect(world.sessionUpdates).toHaveLength(1))
    expect(world.sessionUpdates[0]).toEqual({ status: 'completed', completed_at: '2026-01-06T10:05:00Z', note: null, energy_rating: null, pump_rating: null })
  })

  it('a session whose every set was skipped still completes as skipped, with what was typed on it (the classification is the service\'s, unchanged)', async () => {
    world.serverLogs = [serverLog('a', '2026-01-06T10:05:00Z', true), serverLog('b', '2026-01-06T10:06:00Z', true)]
    const { container } = screen()
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'Felt off.' } })
    fireEvent.click(chip(container, 'ENERGY', 'LOW'))
    fireEvent.click(within(container).getByRole('button', { name: 'COMPLETE' }))
    await waitFor(() => expect(world.sessionUpdates).toHaveLength(1))
    expect(world.sessionUpdates[0]).toEqual({ status: 'skipped', completed_at: '2026-01-06T10:06:00Z', note: 'Felt off.', energy_rating: 'low', pump_rating: null })
  })

  it('offline: the same finish is one queued upsert of the session row, flagged to be derived again from the server\'s logs (W; break: drop a rating from the queued payload)', async () => {
    world.online = false
    const { container } = screen()
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'Grip went.' } })
    fireEvent.click(chip(container, 'ENERGY', 'HIGH'))
    fireEvent.click(chip(container, 'PUMP', 'GOOD'))
    fireEvent.click(within(container).getByRole('button', { name: 'COMPLETE' }))
    await waitFor(() => expect(world.queue).toHaveLength(1))
    expect(world.queue[0]).toMatchObject({
      table: 'v2_sessions',
      operation: 'upsert',
      recomputeFinish: true,
      payload: { id: 'session-1', status: 'completed', completed_at: null, note: 'Grip went.', energy_rating: 'high', pump_rating: 'good' },
    })
    expect(world.sessionUpdates).toEqual([])
  })

  it('its success clears what the phone kept for the session, once (63, G46: "COMPLETE stays useCompleteSession": the call is kept)', async () => {
    world.serverLogs = [serverLog('a', '2026-01-06T10:05:00Z', false)]
    const { container } = screen()
    expect(world.cleared).toEqual([])
    fireEvent.click(within(container).getByRole('button', { name: 'COMPLETE' }))
    await waitFor(() => expect(world.cleared).toEqual(['session-1']))
  })

  it('a reopened session pressed with nothing changed writes back what it already held', async () => {
    session = { ...base, note: 'Grip went on the last curl set.', energyRating: 'high', pumpRating: 'good' }
    world.serverLogs = [serverLog('a', '2026-01-06T10:05:00Z', false)]
    const { container } = screen()
    fireEvent.click(within(container).getByRole('button', { name: 'COMPLETE' }))
    await waitFor(() => expect(world.sessionUpdates).toHaveLength(1))
    expect(world.sessionUpdates[0]).toEqual({
      status: 'completed',
      completed_at: '2026-01-06T10:05:00Z',
      note: 'Grip went on the last curl set.',
      energy_rating: 'high',
      pump_rating: 'good',
    })
  })
})
