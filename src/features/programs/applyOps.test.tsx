// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PostgrestError } from '@supabase/postgrest-js'
import type { ReactNode } from 'react'
import type { Op } from './applyOps'

// Chunk 47 — the client of `v2_apply_ops` (applyOps.ts): the call it makes (the function, its one parameter, the list exactly as
// given), what it answers, the server's own message when the request is refused, and the hook's networkMode. The function itself
// is proven on the replayed database by scripts/apply-ops-proof.mjs; this file proves the TypeScript that calls it.
//
// supabase.ts throws at load without env vars, so it is replaced, with `rpc` mocked directly (runService.test.ts's precedent):
// the exact function name and argument shape can then be read off the call instead of inferred.

const rpcMock = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args) } }))

const { applyOps, useApplyOps } = await import('./applyOps')

afterEach(() => {
  onlineManager.setOnline(true)
  rpcMock.mockReset()
})

// A realistic list over three tables: a swap's new row with its link, a planned set's weight, a week row's delete.
const LIST: Op[] = [
  {
    op: 'insert',
    table: 'v2_program_exercises',
    row: {
      id: 'pe-new',
      user_id: 'u-1',
      workout_day_id: 'wd-pull',
      exercise_id: 'ex-cable-row',
      position: 1,
      weight_unit: null,
      superset_block_id: null,
      rest_seconds: null,
      rest_after_seconds: null,
      tempo: null,
      week_only: false,
      removed_at: null,
      replaces_program_exercise_id: 'pe-pd',
    },
  },
  { op: 'update', table: 'v2_week_plan_sets', id: 'ws-1', patch: { target_weight: 52.5, tags: null } },
  { op: 'delete', table: 'v2_week_plan_exercises', id: 'wpe-3' },
]
const OTHER: Op[] = [
  { op: 'update', table: 'v2_week_plans', id: 'wp-3', patch: { deload_restore: null } },
  { op: 'update', table: 'v2_programs', id: 'prog-1', patch: { schedule: { monday: 'wd-push', tuesday: null, wednesday: null, thursday: 'wd-pull', friday: null, saturday: null, sunday: null } } },
]

const answer = (n: number) => rpcMock.mockResolvedValue({ data: n, error: null })

// ─── the call ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('applyOps — the call', () => {
  it('calls the function v2_apply_ops with the list as its one parameter, p_ops', async () => {
    answer(3)
    await applyOps(LIST)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('v2_apply_ops', { p_ops: LIST })
    // exactly one named argument: the function has no other parameter
    expect(Object.keys(rpcMock.mock.calls[0][1])).toEqual(['p_ops'])
  })

  it('sends the list exactly as given: every op, in the caller\'s order, nothing added, merged or dropped', async () => {
    answer(2)
    await applyOps(OTHER)
    const sent = rpcMock.mock.calls[0][1].p_ops as Op[]
    expect(sent).toEqual(OTHER)
    expect(sent).toHaveLength(2)
    // and a different list is a different call: nothing in the wrapper is fixed to one list
    answer(3)
    await applyOps(LIST)
    expect(rpcMock.mock.calls[1][1].p_ops).toEqual(LIST)
    // the caller's list was not changed on the way
    expect(LIST).toHaveLength(3)
    expect(LIST.map((o) => o.op)).toEqual(['insert', 'update', 'delete'])
  })

  it('sends a list in reverse order as reverse: the order is the caller\'s (the function runs them in order)', async () => {
    answer(3)
    await applyOps([...LIST].reverse())
    expect((rpcMock.mock.calls[0][1].p_ops as Op[]).map((o) => o.op)).toEqual(['delete', 'update', 'insert'])
  })

  it('sends an empty list too (the function answers 0), rather than deciding for the caller that there is nothing to do', async () => {
    answer(0)
    const n = await applyOps([])
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('v2_apply_ops', { p_ops: [] })
    expect(n).toBe(0)
  })

  it('answers with the number of ops the server applied', async () => {
    answer(3)
    expect(await applyOps(LIST)).toBe(3)
    answer(12)
    expect(await applyOps(LIST)).toBe(12)
  })
})

// ─── the server refuses ──────────────────────────────────────────────────────────────────────────────────────────────

describe('applyOps — errors', () => {
  const refusal = (message: string, code = 'P0001') => new PostgrestError({ message, details: '', hint: '', code })

  it('throws the server\'s own error, message intact, whatever the refusal (the caller shows the message)', async () => {
    for (const message of [
      'table not allowed',
      'row not found: v2_week_plan_sets/ws-9',
      'patch sets a protected column',
      'insert not allowed on v2_week_plans',
      'insert or update on table "v2_week_plan_exercises" violates foreign key constraint "v2_week_plan_exercises_week_plan_id_fkey"',
    ]) {
      const error = refusal(message)
      rpcMock.mockResolvedValue({ data: null, error })
      await expect(applyOps(LIST)).rejects.toBe(error)
      await expect(applyOps(LIST)).rejects.toThrow(message)
    }
  })

  it('a refusal is never an answer: no count comes back for a call that failed', async () => {
    rpcMock.mockResolvedValue({ data: null, error: refusal('table not allowed') })
    const settled = await applyOps(LIST).then(
      (n) => ({ n }),
      (e: Error) => ({ message: e.message }),
    )
    expect(settled).toEqual({ message: 'table not allowed' })
  })

  it('a request that never reached the server (no network) fails the call as it failed', async () => {
    rpcMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(applyOps(LIST)).rejects.toThrow('Failed to fetch')
  })
})

// ─── the hook ────────────────────────────────────────────────────────────────────────────────────────────────────────

function setup() {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, ...renderHook(() => useApplyOps(), { wrapper }) }
}

describe('useApplyOps', () => {
  it('passes the list through to the function unchanged and answers with its count', async () => {
    answer(3)
    const { result } = setup()
    let n: number | undefined
    await act(async () => {
      n = await result.current.mutateAsync(LIST)
    })
    expect(rpcMock).toHaveBeenCalledWith('v2_apply_ops', { p_ops: LIST })
    expect(rpcMock.mock.calls[0][1].p_ops).toEqual(LIST)
    expect(n).toBe(3)
  })

  it('rethrows the server\'s message as the mutation\'s error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new PostgrestError({ message: 'row not found: v2_programs/p-2', details: '', hint: '', code: 'P0001' }) })
    const { result } = setup()
    await act(async () => {
      await expect(result.current.mutateAsync(LIST)).rejects.toThrow('row not found: v2_programs/p-2')
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('row not found: v2_programs/p-2')
  })

  it('networkMode "always": while TanStack thinks it is offline the call is still made, not paused', async () => {
    answer(3)
    const { result } = setup()
    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate(LIST)
    })
    // Under the default networkMode ('online') the mutation would be paused until back online and a save's button would sit on its
    // pending state for good. Break: drop `networkMode: 'always'` -> isPaused stays true and the call is never made.
    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('offline, a call that fails settles as an error (it does not hang)', async () => {
    rpcMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = setup()
    onlineManager.setOnline(false)
    await act(async () => {
      await expect(result.current.mutateAsync(LIST)).rejects.toThrow('Failed to fetch')
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('invalidates nothing: which caches a list makes stale depends on the tables in it, and the caller knows them', async () => {
    answer(3)
    const { result, client } = setup()
    const spy = vi.spyOn(client, 'invalidateQueries')
    await act(async () => {
      await result.current.mutateAsync(LIST)
    })
    expect(spy).not.toHaveBeenCalled()
  })
})

// ─── types ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Checked by `npm run typecheck` (tsc), never by Vitest: what the function refuses does not compile here. Each line below is an
// op the function would refuse at run time (scripts/apply-ops-proof.mjs proves the refusals), so a client that can't build one
// can't send one. Break: widen `applyOps`'s parameter to `readonly unknown[]` -> every @ts-expect-error below is unused (TS2578).
export function typeChecks(): void {
  // @ts-expect-error a table the function refuses
  void applyOps([{ op: 'delete', table: 'v2_set_logs', id: 'x' }])
  // @ts-expect-error a column the table hasn't got
  void applyOps([{ op: 'update', table: 'v2_programs', id: 'p', patch: { no_such_column: 1 } }])
  // @ts-expect-error v2_week_plans takes deload_restore and nothing else
  void applyOps([{ op: 'update', table: 'v2_week_plans', id: 'p', patch: { is_deload: true } }])
  // @ts-expect-error no insert into v2_programs
  void applyOps([{ op: 'insert', table: 'v2_programs', row: { id: 'p', user_id: 'u', schedule: {} } }])
  // @ts-expect-error no delete of a v2_week_plans row
  void applyOps([{ op: 'delete', table: 'v2_week_plans', id: 'p' }])
  // @ts-expect-error an op is insert, update or delete
  void applyOps([{ op: 'upsert', table: 'v2_programs', id: 'p', patch: {} }])
  // @ts-expect-error the list is the argument, not a JSON string
  void applyOps(JSON.stringify(LIST))
}
