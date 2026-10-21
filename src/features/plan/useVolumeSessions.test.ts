// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { fakePostgrest, type FakePostgrest, type Row } from '../programs/fakePostgrest.testutil'

// Chunk 55: the one read the VOLUME sheet makes (`useVolumeSessions.ts`): last week's sessions with their logs, their `deleted` changes and
// the muscle groups of the exercises the logs name. The sheet's tests mock this module, so what it reads, from which rows, is proven here: a
// stand-in for PostgREST (`fakePostgrest.testutil.ts`: filters filter, `.select()` projects, embeds resolve through a declared relationship,
// one answer is capped at 1000 rows, every request is logged) holds last week's sessions beside rows that belong elsewhere: a session of
// this week's plan row, of another run, with no plan row at all.

const h = vi.hoisted(() => ({ client: null as unknown }))
// (Spread arguments, not a named table: scripts/verify-rls-tables.test.mjs lists the calls of the table reader that name their table by a variable.)
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: [string]) => (h.client as FakePostgrest['client']).from(...args) },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const { fetchVolumeSessions, useVolumeSessions } = await import('./useVolumeSessions')
const { DONE_WEEK_PLANS_KEY } = await import('./useDoneWeekPlanIds')

const U = 'user-1'
const session = (id: string, planId: string | null, status = 'completed', over: Row = {}): Row => ({ id, user_id: U, mesocycle_id: 'meso-1', week_plan_id: planId, status, ...over })
const log = (id: string, sessionId: string, exerciseId: string, over: Row = {}): Row => ({
  id, user_id: U, session_id: sessionId, exercise_id: exerciseId, week_plan_set_id: null, set_number: 1, weight: 50, reps: 10, parent_set_id: null,
  is_warmup: false, is_skipped: false, note: 'a note nobody reads', ...over,
})
const exercise = (id: string, group: string | null, over: Row = {}): Row => ({ id, user_id: U, name: id, muscle_group: group, is_archived: false, ...over })
const change = (id: string, sessionId: string, kind: string, over: Row = {}): Row => ({ id, user_id: U, session_id: sessionId, kind, week_plan_set_id: null, set_log_id: null, ...over })

function world(extra: { sessions?: Row[]; logs?: Row[]; changes?: Row[]; exercises?: Row[] } = {}) {
  const fake = fakePostgrest({
    v2_sessions: [
      session('s-a', 'plan-a'), // last week's Upper A
      session('s-b', 'plan-b', 'skipped'), // last week's Lower A
      session('s-this', 'plan-this'), // a session of THIS week's plan row: not last week's
      session('s-free', null), // a session with no plan row: no week Plan draws
      ...(extra.sessions ?? []),
    ],
    v2_set_logs: [
      log('l-1', 's-a', 'ex-bench', { week_plan_set_id: 'set-1' }),
      log('l-2', 's-a', 'ex-bench', { week_plan_set_id: 'set-2', parent_set_id: 'l-1', is_skipped: true }),
      log('l-3', 's-a', 'ex-fly', { is_warmup: true }),
      log('l-this', 's-this', 'ex-squat'),
      log('l-free', 's-free', 'ex-squat'),
      ...(extra.logs ?? []),
    ],
    v2_session_set_changes: [
      change('c-del', 's-a', 'deleted', { week_plan_set_id: 'set-9' }),
      change('c-ret', 's-a', 'retyped', { week_plan_set_id: 'set-8', is_warmup: true }),
      change('c-pen', 's-a', 'pending_stages', { set_log_id: 'l-1', stage_kind: 'dropset', stage_count: 2 }),
      change('c-this', 's-this', 'deleted', { week_plan_set_id: 'set-7' }),
      ...(extra.changes ?? []),
    ],
    exercises: [
      exercise('ex-bench', 'chest'),
      exercise('ex-fly', 'chest', { is_archived: true }),
      exercise('ex-squat', 'quads'),
      ...(extra.exercises ?? []),
    ],
  })
  h.client = fake.client
  return fake
}

beforeEach(() => {
  h.client = null
})

describe('fetchVolumeSessions', () => {
  it('reads the sessions of the plan rows it is given, and no others: one request, ordered, naming the columns it reads', async () => {
    const fake = world()
    const read = await fetchVolumeSessions(['plan-b', 'plan-a'])
    expect(read.sessions.map((s) => [s.weekPlanId, s.status])).toEqual([['plan-a', 'completed'], ['plan-b', 'skipped']])
    const requests = fake.to('v2_sessions')
    expect(requests).toHaveLength(1)
    expect(requests[0].filters).toEqual([{ op: 'in', column: 'week_plan_id', value: ['plan-b', 'plan-a'] }])
    expect(requests[0].order).toBe('id')
    expect(requests[0].range).toEqual([0, 499])
    expect(requests[0].select).toBe(
      'id, week_plan_id, status, v2_set_logs(id, exercise_id, week_plan_set_id, parent_set_id, is_warmup, is_skipped, exercises(id, muscle_group)), v2_session_set_changes(kind, week_plan_set_id)',
    )
  })

  it('populates every session\'s logs, as the module reads them: exercise, planned set, head, warmup, skipped (and nothing else)', async () => {
    world()
    const read = await fetchVolumeSessions(['plan-a', 'plan-b'])
    const a = read.sessions.find((s) => s.weekPlanId === 'plan-a')!
    expect(a.setLogs).toEqual([
      { id: 'l-1', exerciseId: 'ex-bench', weekPlanSetId: 'set-1', parentSetId: null, isWarmup: false, isSkipped: false },
      { id: 'l-2', exerciseId: 'ex-bench', weekPlanSetId: 'set-2', parentSetId: 'l-1', isWarmup: false, isSkipped: true },
      { id: 'l-3', exerciseId: 'ex-fly', weekPlanSetId: null, parentSetId: null, isWarmup: true, isSkipped: false },
    ])
    expect(read.sessions.find((s) => s.weekPlanId === 'plan-b')!.setLogs).toEqual([]) // a skipped session has none, and reads as having none
  })

  it('reads a log with no warmup flag (written before the column existed) as a working set', async () => {
    world({ logs: [log('l-old', 's-b', 'ex-bench', { is_warmup: null })] })
    const old = (await fetchVolumeSessions(['plan-b'])).sessions[0].setLogs[0]
    expect(old).toMatchObject({ id: 'l-old', isWarmup: false })
  })

  it('hands back the session\'s `deleted` changes only: a retyped or pending_stages row changes no count', async () => {
    world()
    const read = await fetchVolumeSessions(['plan-a'])
    expect(read.sessions[0].sessionSetChanges).toEqual([{ kind: 'deleted', weekPlanSetId: 'set-9' }])
  })

  it('names every exercise a log names with its muscle group once, an archived one and one with no group included', async () => {
    world({
      logs: [log('l-4', 's-b', 'ex-nogroup'), log('l-5', 's-b', 'ex-bench')],
      exercises: [exercise('ex-nogroup', null)],
    })
    const read = await fetchVolumeSessions(['plan-a', 'plan-b'])
    expect(read.exercises).toEqual([
      { id: 'ex-bench', muscleGroup: 'chest' },
      { id: 'ex-fly', muscleGroup: 'chest' }, // archived
      { id: 'ex-nogroup', muscleGroup: 'other' },
    ])
    // The exercise of a session this read doesn't return isn't named.
    expect(read.exercises.map((e) => e.id)).not.toContain('ex-squat')
  })

  it('pages: a full page asks for the next range, a short page stops, and every session comes back', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => session(`s-${String(i).padStart(4, '0')}`, 'plan-a'))
    const fake = world({ sessions: many })
    const read = await fetchVolumeSessions(['plan-a'])
    expect(read.sessions).toHaveLength(1002) // the 1001 and 's-a'
    expect(fake.to('v2_sessions').map((r) => r.range)).toEqual([[0, 499], [500, 999], [1000, 1499]])
  })

  it('asks nothing when there is no plan row to read by', async () => {
    const fake = world()
    expect(await fetchVolumeSessions([])).toEqual({ sessions: [], exercises: [] })
    expect(fake.requests).toHaveLength(0)
  })

  it('a failed read throws it', async () => {
    const fake = world()
    fake.failWith('v2_sessions', 'boom')
    await expect(fetchVolumeSessions(['plan-a'])).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('useVolumeSessions', () => {
  const wrapper = (client: QueryClient) => ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client }, children)

  it('reads by the plan rows it is given, the same set in any order and with repeats once; idle with none', async () => {
    const fake = world()
    const client = new QueryClient()
    const { result, rerender } = renderHook(({ ids }: { ids: string[] }) => useVolumeSessions(ids), { wrapper: wrapper(client), initialProps: { ids: [] as string[] } })
    expect(result.current.fetchStatus).toBe('idle')
    expect(fake.requests).toHaveLength(0)
    rerender({ ids: ['plan-b', 'plan-a', 'plan-a'] })
    await waitFor(() => expect(result.current.data?.sessions).toHaveLength(2))
    expect(fake.to('v2_sessions')[0].filters).toEqual([{ op: 'in', column: 'week_plan_id', value: ['plan-a', 'plan-b'] }])
    rerender({ ids: ['plan-a', 'plan-b'] })
    expect(fake.to('v2_sessions')).toHaveLength(1) // the same key: not read again
  })

  it('its key sits under the done list\'s prefix, so whatever refreshes that list (a start, a finish, a skip, a move) refreshes this one', async () => {
    world()
    const client = new QueryClient()
    const { result } = renderHook(() => useVolumeSessions(['plan-a']), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(client.getQueryCache().findAll({ queryKey: [DONE_WEEK_PLANS_KEY] }).map((q) => q.queryKey)).toEqual([[DONE_WEEK_PLANS_KEY, 'volume', ['plan-a']]])
  })
})
