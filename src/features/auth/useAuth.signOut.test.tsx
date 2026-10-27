// @vitest-environment jsdom
// DECISIONS 234 (Adam, 2026-10-27: "sign-out clears both new phone-side tables"): `wipeOfflineCache` named the six tables of Dexie versions 1 and 2 and left out the two that chunk 63
// added in version 3 (`session_set_drafts`, `session_added_sets`), so a signed-out account's unlogged numbers and added-set lists stayed on the phone. Sign-out now clears every table
// of the database the app declares. This runs the real `signOut` over the real schema (`lib/db.ts`) with each table's `clear` watched; nothing else on sign-out is changed, and the test
// pins what else it does (Supabase's sign-out first, the query cache, then the wipe).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const calls = vi.hoisted(() => ({ order: [] as string[] }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => void calls.order.push('supabase.signOut'),
    },
  },
}))
vi.mock('../../lib/queryClient', () => ({ queryClient: { clear: () => void calls.order.push('queryClient.clear') } }))

const { db } = await import('../../lib/db')
const { AuthProvider, useAuth } = await import('./useAuth')

// Version 1 and 2's six tables and version 3's two (lib/db.ts): the whole database as the app declares it today.
const ALL_TABLES = ['exercises', 'workout_days', 'week_plans', 'sessions', 'set_logs', 'sync_queue', 'session_set_drafts', 'session_added_sets']

beforeEach(() => {
  calls.order.length = 0
  for (const table of db.tables) vi.spyOn(table, 'clear').mockImplementation(async () => void calls.order.push(`clear ${table.name}`))
})

async function signOut() {
  const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => {
    await result.current.signOut()
  })
}

describe('sign-out wipes what the phone keeps for the account (DECISIONS 234)', () => {
  it('the schema is the eight tables this test names: a table added later has to be named here, on purpose', () => {
    expect(db.tables.map((table) => table.name).sort()).toEqual([...ALL_TABLES].sort())
  })

  it('clears every table once, the two chunk-63 tables (the unlog’s drafts and the card’s added sets) among them', async () => {
    await signOut()

    const cleared = calls.order.filter((c) => c.startsWith('clear ')).map((c) => c.slice('clear '.length))
    expect([...cleared].sort()).toEqual([...ALL_TABLES].sort())
    expect(cleared).toContain('session_set_drafts')
    expect(cleared).toContain('session_added_sets')
  })

  it('does nothing else on sign-out: Supabase signs out first, then the query cache is cleared, then the wipe', async () => {
    await signOut()

    expect(calls.order.slice(0, 2)).toEqual(['supabase.signOut', 'queryClient.clear'])
    expect(calls.order.slice(2).every((c) => c.startsWith('clear '))).toBe(true)
  })
})
