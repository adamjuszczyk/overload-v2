// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { DeloadRestoreEntry, DeloadRules } from '../../lib/deloadRules'
import { queryClient } from '../../lib/queryClient'
import { createFakeDeloadDb, fakePlan, fakeSet, type FakeExerciseSlot } from './fakeDeloadDb.testutil'

// Chunk 188f (Adam, 2026-10-20; DECISIONS 188 (a), found in chunk 52's review, probe B; SPEC Deload [1.2]): a week mark that stops part way
// leaves the week half marked, and marking it again used to save a marked session's DELOADED sets over its saved plan, so UNMARK later
// brought the deload back and not the plan. In production since phase 1 (chunks 21-22). The guard is in markSessionDeload
// (weekPlanService.deloadSavedCopy.test.ts proves its calls); this is the sequence as the user has it, through the REAL hooks
// (useSetDeload, the session toggle's, and useSetWeekDeload, WEEK ⋯'s) and the real weekPlanService.ts over a stateful in-memory database
// (fakeDeloadDb.testutil.ts: it applies the writes, so each mark reads what the one before wrote). The app's own queryClient is the
// provider (RULES.md: the hooks import that singleton and invalidate it).
//
// The fixture: three sessions of week 4, each four sets of 100 at RIR 2 of its own exercise; the rules halve the sets (4 → 2) and add 2 to
// the RIR, so a session marked once reads two sets of 100 at RIR 4 with a four-entry copy, and a session marked a second time from those would
// read ONE set at RIR 6 with a two-entry copy. No dates: nothing here depends on today's weekday.

afterEach(() => {
  queryClient.clear()
  failCoreReadOf = null
  startedPlans = new Set()
})

const MESO = 'meso-1'
const WEEK = 4
const RULES: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' }, rir: { delta: 2 } }
const SESSIONS = ['push', 'pull', 'legs'] as const
type Session = (typeof SESSIONS)[number]
const planId = (s: Session) => `wp-${s}`

let fake = createFakeDeloadDb({ plans: [], sets: [], exercises: [] })
// Two things the stand-in does not do itself: a read that fails (a dropped connection), and a session that has been started.
let failCoreReadOf: string | null = null
let injected = 0
let startedPlans = new Set<string>()

function reachable(table: string) {
  const chain = fake.client.from(table) as Record<string, unknown>
  let eqValue: unknown
  const eq = chain.eq as (col: string, val: unknown) => unknown
  const single = chain.single as () => Promise<unknown>
  const then = chain.then as (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>
  chain.eq = (col: string, val: unknown) => {
    eqValue = val
    return eq(col, val)
  }
  if (!chain.in) chain.in = () => chain
  chain.single = () => {
    // fetchDeloadWeekPlanCore: the first read of a session's own row inside a mark
    if (table === 'v2_week_plans' && failCoreReadOf !== null && eqValue === failCoreReadOf) {
      failCoreReadOf = null
      injected += 1
      return Promise.resolve({ data: null, error: new Error('network dropped') })
    }
    return single()
  }
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    // hasAnySetLogForWeekPlan: the session rows of a started plan, then a count of its logs
    if (table === 'v2_sessions') return Promise.resolve({ data: startedPlans.has(eqValue as string) ? [{ id: `session-of-${eqValue}` }] : [], error: null }).then(res, rej)
    if (table === 'v2_set_logs') return Promise.resolve({ data: null, error: null, count: 1 }).then(res, rej)
    return then(res, rej)
  }
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => reachable(table),
    rpc: (name: string, args: unknown) => fake.client.rpc(name, args),
  },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const { useSetDeload, useSetWeekDeload } = await import('./useWeekPlan')

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function buildWorld() {
  injected = 0
  const plans = SESSIONS.map((s) => fakePlan(planId(s), WEEK, { workout_day_id: `wd-${s}` }))
  const sets = SESSIONS.flatMap((s) =>
    [1, 2, 3, 4].map((n) => fakeSet(planId(s), `${s}-s${n}`, n, { program_exercise_id: `pe-${s}`, target_rir: 2, target_weight: 100, rep_min: 8, rep_max: 10 })),
  )
  const exercises: FakeExerciseSlot[] = SESSIONS.map((s) => ({ week_plan_id: planId(s), program_exercise_id: `pe-${s}`, exercise_id: `ex-${s}` }))
  fake = createFakeDeloadDb({ plans, sets, exercises })
}

const plan = (s: Session) => fake.state.plans.find((p) => p.id === planId(s))!
const content = (s: Session) =>
  fake.state.sets.filter((r) => r.week_plan_id === planId(s)).map((r) => [r.set_number, r.target_weight, r.target_rir]).sort((a, b) => (a[0] as number) - (b[0] as number))
const copyOf = (s: Session) => plan(s).deload_restore as DeloadRestoreEntry[] | null
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
// every write that saves a copy (a plan row updated with a `deload_restore` list), over the whole test
const copySaves = () => fake.writes.filter((w) => w.table === 'v2_week_plans' && w.method === 'update' && Array.isArray((w.args[0] as { deload_restore?: unknown }).deload_restore))

const ORIGINAL = [[1, 100, 2], [2, 100, 2], [3, 100, 2], [4, 100, 2]]
const MARKED = [[1, 100, 4], [2, 100, 4]]

// A press: the hook's mutation, awaited inside act so the hook's own cache writes settle before the test reads the database.
async function press<T>(send: () => Promise<T>): Promise<T> {
  let out!: T
  await act(async () => {
    out = await send()
  })
  return out
}
function weekHook() {
  const { result } = renderHook(() => useSetWeekDeload(MESO, WEEK), { wrapper })
  return (vars: { isDeload: boolean; rules: DeloadRules | null }) => press(() => result.current.mutateAsync(vars))
}
function sessionHook() {
  const { result } = renderHook(() => useSetDeload(MESO, WEEK), { wrapper })
  return (vars: { weekPlanId: string; isDeload: boolean; rules: DeloadRules | null }) => press(() => result.current.mutateAsync(vars))
}

describe('a half-marked week marked again — through useSetDeload and useSetWeekDeload over weekPlanService (DECISIONS 188 (a))', () => {
  it('one session marked on its own, then MARK WEEK: that session keeps its sets and its saved copy, the others are marked; UNMARK WEEK puts every session back to its plan', async () => {
    buildWorld()
    const markSession = sessionHook()
    const markWeek = weekHook()

    // The session's own toggle (SessionCard → useSetDeload): four sets of 100 at RIR 2 become two at RIR 4, the copy holds the four.
    await markSession({ weekPlanId: planId('push'), isDeload: true, rules: RULES })
    expect(content('push')).toEqual(MARKED)
    expect(copyOf('push')).toHaveLength(4)
    expect(plan('push').is_deload).toBe(true)
    const copyAfterFirstMark = clone(copyOf('push'))
    expect(SESSIONS.filter((s) => plan(s).is_deload)).toEqual(['push']) // a half-marked week

    // MARK WEEK AS DELOAD from WEEK ⋯ (useSetWeekDeload).
    const outcome = await markWeek({ isDeload: true, rules: RULES })
    expect(outcome).toEqual({ anyAlreadyStarted: false }) // a session left as it is is not "already started": no notice

    // Push: as the first mark left it. Not calculated again (one set at RIR 6), its copy not saved again from the deloaded sets (two entries).
    expect(content('push')).toEqual(MARKED)
    expect(copyOf('push')).toEqual(copyAfterFirstMark)
    expect(copyOf('push')).toHaveLength(4)
    // Pull and Legs: marked now, each with the plan it had.
    for (const s of ['pull', 'legs'] as const) {
      expect(plan(s).is_deload).toBe(true)
      expect(content(s)).toEqual(MARKED)
      expect(copyOf(s)).toHaveLength(4)
    }
    expect(copySaves()).toHaveLength(3) // one save per session over the whole sequence, Push's once

    // UNMARK WEEK AS DELOAD: every session is its plan again, the one marked first included.
    await markWeek({ isDeload: false, rules: RULES })
    for (const s of SESSIONS) {
      expect(content(s)).toEqual(ORIGINAL)
      expect(plan(s).is_deload).toBe(false)
      expect(copyOf(s)).toBeNull()
    }
  })

  it('a week mark cut off while it reads the second session leaves the week half marked; marking the week again finishes the mark, and UNMARK still restores every plan', async () => {
    buildWorld()
    const markWeek = weekHook()

    failCoreReadOf = planId('pull') // the connection drops as the second session is read
    await expect(markWeek({ isDeload: true, rules: RULES })).rejects.toThrow('network dropped')
    expect(injected).toBe(1) // the failure fired (Checks that lied #22)

    // Half marked: Push is marked with its copy; Pull and Legs were never reached.
    expect(plan('push').is_deload).toBe(true)
    expect(content('push')).toEqual(MARKED)
    const copyAfterCutOff = clone(copyOf('push'))
    expect(copyAfterCutOff).toHaveLength(4)
    for (const s of ['pull', 'legs'] as const) {
      expect(plan(s).is_deload).toBe(false)
      expect(content(s)).toEqual(ORIGINAL)
      expect(copyOf(s)).toBeNull()
    }

    // The same press again.
    await markWeek({ isDeload: true, rules: RULES })
    expect(content('push')).toEqual(MARKED)
    expect(copyOf('push')).toEqual(copyAfterCutOff)
    for (const s of ['pull', 'legs'] as const) {
      expect(plan(s).is_deload).toBe(true)
      expect(content(s)).toEqual(MARKED)
      expect(copyOf(s)).toHaveLength(4)
    }
    expect(copySaves()).toHaveLength(3)

    await markWeek({ isDeload: false, rules: RULES })
    for (const s of SESSIONS) {
      expect(content(s)).toEqual(ORIGINAL)
      expect(plan(s).is_deload).toBe(false)
    }
  })

  it('a week with a session that holds a copy, an unmarked one and a started one: the first is left as it is, the second is marked, the third keeps its sets, and only the started one counts for the notice', async () => {
    buildWorld()
    const markSession = sessionHook()
    const markWeek = weekHook()
    await markSession({ weekPlanId: planId('push'), isDeload: true, rules: RULES })
    const copyOfPush = clone(copyOf('push'))
    startedPlans = new Set([planId('legs')])

    const outcome = await markWeek({ isDeload: true, rules: RULES })

    expect(outcome).toEqual({ anyAlreadyStarted: true })
    expect(content('push')).toEqual(MARKED)
    expect(copyOf('push')).toEqual(copyOfPush)
    expect(content('pull')).toEqual(MARKED)
    expect(copyOf('pull')).toHaveLength(4)
    // Legs has been started: flagged, its planned sets and its (absent) copy untouched, as before this chunk.
    expect(plan('legs').is_deload).toBe(true)
    expect(content('legs')).toEqual(ORIGINAL)
    expect(copyOf('legs')).toBeNull()
    expect(copySaves()).toHaveLength(2) // Push's, Pull's — none for Legs, none again for Push
  })

  it('the ordinary paths are as before: an unmarked week is marked once per session and UNMARK restores it; rules off marks the flag only', async () => {
    buildWorld()
    const markWeek = weekHook()

    await markWeek({ isDeload: true, rules: RULES })
    for (const s of SESSIONS) {
      expect(content(s)).toEqual(MARKED)
      expect(copyOf(s)).toHaveLength(4)
    }
    expect(copySaves()).toHaveLength(3)
    await markWeek({ isDeload: false, rules: RULES })
    for (const s of SESSIONS) expect(content(s)).toEqual(ORIGINAL)

    fake.writes.length = 0
    await markWeek({ isDeload: true, rules: null }) // no rules switched on: the flag, and nothing else
    for (const s of SESSIONS) {
      expect(plan(s).is_deload).toBe(true)
      expect(content(s)).toEqual(ORIGINAL)
      expect(copyOf(s)).toBeNull()
    }
    expect(fake.writes.filter((w) => w.table === 'v2_week_plan_sets')).toEqual([])
    expect(copySaves()).toHaveLength(0)
  })
})
