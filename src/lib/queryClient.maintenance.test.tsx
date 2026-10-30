// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider, useMutation } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]; DECISIONS 271). The flag is read at start, in the foreground, every hour and every minute
// while a screen shows; a write the database refuses for maintenance (`OL001`) must not wait for the hour to bring the screen up. The app's own
// `queryClient` has one `MutationCache.onError` that reads `['v2_appStatus']` again at once for any mutation refused that way. The writers here
// are real `useMutation`s on the app's client, as every writer in the app is (`networkMode: 'always'`, as the offline-capable ones are); the status is
// read by the real `useAppStatus`, so an answer that changes is what the screen would draw.
const world = vi.hoisted(() => ({ reads: 0, status: { maintenance: false, minVersion: '1.2.1', exemptUserIds: [] as string[], updatedAt: 'x' } }))
vi.mock('../features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false, signOut: vi.fn() }) }))
vi.mock('../features/release/appStatusService', () => ({
  fetchAppStatus: async () => {
    world.reads += 1
    return { ...world.status }
  },
}))

const { queryClient } = await import('./queryClient')
const { useAppStatus } = await import('../features/release/useAppStatus')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

const maintenanceRefusal = { code: 'OL001', message: 'Overload is being updated. Writes are refused until maintenance is off.', details: null, hint: 'maintenance' }

/** A mutation as a writer in the app makes one, run once with whatever it throws (or nothing). */
async function runWriter(thrown?: unknown) {
  const writer = renderHook(
    () =>
      useMutation({
        networkMode: 'always',
        mutationFn: async () => {
          if (thrown !== undefined) throw thrown
          return 'saved'
        },
      }),
    { wrapper },
  )
  await act(async () => {
    await writer.result.current.mutateAsync().catch(() => {})
  })
  return writer
}

beforeEach(() => {
  world.reads = 0
  world.status = { maintenance: false, minVersion: '1.2.1', exemptUserIds: [], updatedAt: 'x' }
  queryClient.clear()
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})

describe('a mutation refused OL001 reads the status again at once', () => {
  it('and the answer it brings is what the screen draws: the app read "off" at start, maintenance is turned on, the next write is refused, and the flag reads "on" with no timer', async () => {
    const status = renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(status.result.current.data?.maintenance).toBe(false))
    expect(world.reads).toBe(1)

    world.status = { ...world.status, maintenance: true }
    await runWriter(maintenanceRefusal)

    await waitFor(() => expect(status.result.current.data?.maintenance).toBe(true))
    expect(world.reads, 'one read, made by the refusal').toBe(2)
  })

  it('every refused mutation reads it (a second refusal reads again), whichever writer it is', async () => {
    renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(world.reads).toBe(1))
    await runWriter(maintenanceRefusal)
    await waitFor(() => expect(world.reads).toBe(2))
    await runWriter(maintenanceRefusal)
    await waitFor(() => expect(world.reads).toBe(3))
  })

  it('what a mutation is refused with is read from `code`: any other refusal, a plain error, a message that says the same thing, and a success read nothing', async () => {
    renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(world.reads).toBe(1))
    const notMaintenance: unknown[] = [
      { code: '23503', message: 'insert or update on table "v2_set_logs" violates foreign key constraint "x"' },
      { code: 'OL002', message: 'a program with a running program cannot be deleted: finish it first' },
      { code: '42501', message: 'permission denied for table v2_app_status' },
      new Error('Failed to fetch'),
      { message: 'Overload is being updated. Writes are refused until maintenance is off.', hint: 'maintenance' },
      new Error('OL001'),
    ]
    for (const thrown of notMaintenance) await runWriter(thrown)
    await runWriter() // saved
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(world.reads, 'nothing read it again').toBe(1)
  })

  it('does nothing to the writer itself: the mutation still fails with what it was refused with, for its own caller to handle', async () => {
    const writer = renderHook(
      () =>
        useMutation({
          networkMode: 'always',
          mutationFn: async () => {
            throw maintenanceRefusal
          },
        }),
      { wrapper },
    )
    let caught: unknown
    await act(async () => {
      caught = await writer.result.current.mutateAsync().catch((error: unknown) => error)
    })
    expect(caught).toBe(maintenanceRefusal)
    await waitFor(() => expect(writer.result.current.error).toBe(maintenanceRefusal))
  })
})
