// @vitest-environment jsdom
//
// B3 (1 of 5): an online session start had no client-side id, so a re-tap
// after a lost response (the row landed, the reply never came back) inserted
// a second row. The fake server below stores rows by id, assigns its own id
// when the insert carries none (as Postgres' default does), and can lose one
// reply after the row is stored.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

type Row = Record<string, unknown>
const server = { rows: new Map<string, Row>(), loseNextReply: false, nextServerId: 1 }

function fromSessions() {
  let inserted: Row | null = null
  const filters: Record<string, unknown> = {}
  const chain: Record<string, unknown> = {
    insert: (row: Row) => {
      inserted = row
      return chain
    },
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters[col] = val
      return chain
    },
    single: async () => {
      if (inserted) {
        const id = (inserted.id as string | undefined) ?? `server-${server.nextServerId++}`
        if (server.rows.has(id)) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint "v2_sessions_pkey"' },
          }
        }
        const stored = { created_at: '2026-10-11T08:00:00Z', completed_at: null, note: null, ...inserted, id }
        server.rows.set(id, stored)
        if (server.loseNextReply) {
          server.loseNextReply = false
          return { data: null, error: { message: 'TypeError: Failed to fetch' } }
        }
        return { data: stored, error: null }
      }
      const found = server.rows.get(filters.id as string)
      return found ? { data: found, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    },
  }
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (table: string) => (table === 'v2_sessions' ? fromSessions() : {}) },
}))
vi.mock('../../lib/db', () => ({
  db: { sync_queue: { add: vi.fn() }, sessions: { put: vi.fn() } },
}))

const { useCreateSession } = await import('./useSession')

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const params = { mesoId: 'm1', weekPlanId: 'wp1', workoutDayId: 'wd-1', date: '2026-10-11' }

afterEach(() => {
  onlineManager.setOnline(true)
  server.rows.clear()
  server.loseNextReply = false
  server.nextServerId = 1
  queryClient.clear()
})

describe('useCreateSession — online start is idempotent across a lost reply (B3)', () => {
  it('a re-tap after a lost reply returns the row that landed; the server holds one row', async () => {
    server.loseNextReply = true
    const { result } = renderHook(() => useCreateSession(), { wrapper })

    await expect(result.current.mutateAsync(params)).rejects.toBeTruthy()
    expect(server.rows.size).toBe(1)

    const session = await result.current.mutateAsync(params)
    expect(server.rows.size).toBe(1)
    expect(session.id).toBe([...server.rows.keys()][0])
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('sends a client-side id with the insert', async () => {
    const { result } = renderHook(() => useCreateSession(), { wrapper })
    const session = await result.current.mutateAsync(params)
    expect(session.id).not.toMatch(/^server-/)
    expect(server.rows.has(session.id)).toBe(true)
  })

  it('a second start of the same workout after the first succeeded gets its own id', async () => {
    const { result } = renderHook(() => useCreateSession(), { wrapper })
    const first = await result.current.mutateAsync(params)
    const second = await result.current.mutateAsync(params)
    expect(second.id).not.toBe(first.id)
    expect(server.rows.size).toBe(2)
  })

  it('a start of a different workout does not reuse the failed start’s id', async () => {
    server.loseNextReply = true
    const { result } = renderHook(() => useCreateSession(), { wrapper })
    await expect(result.current.mutateAsync(params)).rejects.toBeTruthy()
    const other = await result.current.mutateAsync({ ...params, workoutDayId: 'wd-2' })
    expect(server.rows.size).toBe(2)
    expect(server.rows.get(other.id)?.workout_day_id).toBe('wd-2')
  })
})
