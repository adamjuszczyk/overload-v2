// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { renderHook, act, cleanup } from '@testing-library/react'
import type { AddedSet } from './workoutRules'
import { clearSessionDrafts, dexieDraftStore, draftIdentity, storedDraftId, usableDrafts, usableLists, type StoredDraft } from './sessionDrafts'
import { fakeDraftStore, newDraftWorld } from './draftStore.testutil'
import { exerciseOf, headLogOf } from './cardHarness.testutil'
import { useWorkoutRows, type WorkoutCard } from './useWorkoutRows'

// Chunk 63 — what the phone keeps for the workout (TASKS-1.2 63; G46 (a)): the Dexie rows of `session_set_drafts` and `session_added_sets` (against a stand-in for `lib/db` that
// answers copies, as Dexie does), the ids that name a draft by its set's own id, the rows that cannot be read, the session's end, and the card's list read back by
// `useWorkoutRows` after a reload, including the sets a swap for today moved to the card it made (chunk 59's review).

const dexie = vi.hoisted(() => ({ drafts: new Map<string, Record<string, unknown>>(), lists: new Map<string, Record<string, unknown>>() }))
vi.mock('../../lib/db', () => ({
  db: {
    session_set_drafts: {
      where: () => ({
        equals: (sessionId: string) => ({
          toArray: async () => structuredClone([...dexie.drafts.values()].filter((row) => row.sessionId === sessionId)),
          delete: async () => {
            for (const [id, row] of dexie.drafts) if (row.sessionId === sessionId) dexie.drafts.delete(id)
          },
        }),
      }),
      put: async (row: Record<string, unknown>) => void dexie.drafts.set(row.id as string, structuredClone(row)),
      bulkDelete: async (ids: string[]) => void ids.forEach((id) => dexie.drafts.delete(id)),
    },
    session_added_sets: {
      get: async (sessionId: string) => structuredClone(dexie.lists.get(sessionId)),
      put: async (row: Record<string, unknown>) => void dexie.lists.set(row.sessionId as string, structuredClone(row)),
      delete: async (sessionId: string) => void dexie.lists.delete(sessionId),
    },
  },
}))

afterEach(cleanup)
beforeEach(() => {
  dexie.drafts.clear()
  dexie.lists.clear()
})

const NORMAL = { kind: 'normal' } as const
const plannedDraft = (sessionId: string, weekPlanSetId: string, weight = 80): StoredDraft => {
  const key = { sessionId, weekPlanSetId }
  return { id: storedDraftId(key), sessionId, key, values: { weight, reps: 8, rir: 2, formRating: null, enteredUnit: null } }
}
const addedDraft = (sessionId: string, localId: string, position: number): StoredDraft => {
  const key = { sessionId, localId, exerciseId: 'ex-1', position }
  return { id: storedDraftId(key), sessionId, key, values: { weight: 50, reps: 10, rir: null, formRating: null, enteredUnit: null, type: NORMAL, place: 1, loggedAt: '2026-01-05T10:00:00Z' } }
}

describe('a draft is named by its set\'s own id, never by the number the row showed (DECISIONS 147 (b), 151)', () => {
  it('an added set\'s position is not part of its id: the same set unlogged at 03 and later at 02 is one draft', () => {
    expect(storedDraftId({ sessionId: 's1', localId: 'a', exerciseId: 'ex-1', position: 3 })).toBe(storedDraftId({ sessionId: 's1', localId: 'a', exerciseId: 'ex-1', position: 2 }))
  })
  it('a planned set, an added set, a drop of each and two sessions\' sets of one planned set (G14) are all different ids', () => {
    const ids = [
      storedDraftId({ sessionId: 's1', weekPlanSetId: 'x' }),
      storedDraftId({ sessionId: 's2', weekPlanSetId: 'x' }),
      storedDraftId({ sessionId: 's1', localId: 'x', exerciseId: 'ex-1', position: 1 }),
      storedDraftId({ sessionId: 's1', weekPlanSetId: 'x', drop: 1 }),
      storedDraftId({ sessionId: 's1', weekPlanSetId: 'x', drop: 2 }),
      storedDraftId({ sessionId: 's1', localId: 'x', exerciseId: 'ex-1', position: 1, drop: 1 }),
    ]
    expect(new Set(ids).size).toBe(ids.length)
    expect(draftIdentity({ sessionId: 's1', weekPlanSetId: 'x', drop: 2 })).toBe('p:x:d2')
  })
})

describe('the Dexie store: drafts and the card\'s list, per session, as copies', () => {
  it('keeps a draft whole under its id, reads only its own session\'s back, and deletes by id', async () => {
    const store = dexieDraftStore('s1')
    await store.putDraft(plannedDraft('s1', 'set-3'))
    await store.putDraft(addedDraft('s1', 'a1', 4))
    await dexieDraftStore('s2').putDraft(plannedDraft('s2', 'set-3', 99))
    const { drafts } = await store.load()
    expect(drafts.map((d) => d.id).sort()).toEqual(['s1|a:a1', 's1|p:set-3'])
    expect(drafts.find((d) => d.id === 's1|p:set-3')).toEqual(plannedDraft('s1', 'set-3'))
    await store.deleteDrafts(['s1|p:set-3'])
    expect((await store.load()).drafts.map((d) => d.id)).toEqual(['s1|a:a1'])
    expect([...dexie.drafts.keys()].sort()).toEqual(['s1|a:a1', 's2|p:set-3']) // the other session's draft is where it was
  })

  it('keeps the card\'s list of one session and answers it back', async () => {
    const store = dexieDraftStore('s1')
    const lists = { 'pe-1': [{ localId: 'a1', logId: null, type: NORMAL, place: 1 }] }
    await store.saveLists(lists)
    expect((await store.load()).lists).toEqual(lists)
    expect((await dexieDraftStore('s2').load()).lists).toEqual({})
  })

  it('the session\'s end clears its drafts and its list, and only its own (break: nothing cleared)', async () => {
    const one = dexieDraftStore('s1')
    const two = dexieDraftStore('s2')
    await one.putDraft(plannedDraft('s1', 'set-3'))
    await one.saveLists({ 'pe-1': [{ localId: 'a1', logId: null, type: NORMAL, place: 1 }] })
    await two.putDraft(plannedDraft('s2', 'set-3'))
    await two.saveLists({ 'pe-1': [{ localId: 'b1', logId: null, type: NORMAL, place: 1 }] })
    await clearSessionDrafts('s1')
    expect(await one.load()).toEqual({ drafts: [], lists: {} })
    expect((await two.load()).drafts).toHaveLength(1)
    expect(Object.keys((await two.load()).lists)).toEqual(['pe-1'])
  })

  it('rows the rules could not read are left out, so a damaged row cannot stop the screen: a draft of an added set with no type, an entry with no place, a duplicate id', () => {
    const noType = addedDraft('s1', 'a2', 1)
    delete (noType.values as { type?: unknown }).type
    const noTimeNoPlace = addedDraft('s1', 'a3', 1)
    ;(noTimeNoPlace.values as { place: number | null; loggedAt?: string }).place = null
    delete (noTimeNoPlace.values as { loggedAt?: string }).loggedAt
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(usableDrafts([plannedDraft('s1', 'set-3'), addedDraft('s1', 'a1', 1), noType, noTimeNoPlace]).map((d) => d.id)).toEqual(['s1|p:set-3', 's1|a:a1'])
    const entry = (over: Partial<AddedSet>): AddedSet => ({ localId: 'a1', logId: null, type: NORMAL, place: 1, ...over })
    expect(usableLists({ c: [entry({}), entry({ localId: 'a2', place: 0 }), entry({ localId: 'a3', type: undefined as never }), entry({}), entry({ localId: 'a4', logId: 'log-4', place: 2 })] })).toEqual({
      c: [entry({}), entry({ localId: 'a4', logId: 'log-4', place: 2 })],
    })
    expect(usableLists('nonsense')).toEqual({})
    warn.mockRestore()
  })
})

describe('the card\'s list is read back by `useWorkoutRows` (chunk 63; board W5: the swap\'s moved sets)', () => {
  const original: WorkoutCard = { key: 'pe-1', programExercise: exerciseOf(), plannedSets: [] }
  const replacement = (): WorkoutCard => ({
    key: 'pe-1:replacement',
    programExercise: { ...exerciseOf({ id: 'pe-1' }), exerciseId: 'ex-2' },
    plannedSets: [],
    swappedFrom: { fromKey: 'pe-1', moved: [{ from: { weekPlanSetId: 'set-2' }, place: 1 }, { from: { weekPlanSetId: 'set-3' }, place: 2 }] },
  })
  const planned = [1, 2, 3].map((n) => ({ id: `set-${n}`, weekPlanId: 'wp-1', userId: 'u1', programExerciseId: 'pe-1', setNumber: n, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false }))
  const cards = (): WorkoutCard[] => [{ ...original, plannedSets: planned }, replacement()]
  const moved: AddedSet[] = [
    { localId: 'm1', logId: null, type: NORMAL, place: 1 },
    { localId: 'm2', logId: null, type: { kind: 'staged', stageKind: 'dropset', stageCount: 1 }, place: 2 },
  ]
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  const mount = (store: ReturnType<typeof fakeDraftStore>) => renderHook(() => useWorkoutRows({ cards: cards(), blocks: [], logs: [headLogOf(1)], store }))
  const keysOf = (rows: ReturnType<typeof useWorkoutRows>['rows'], card: string) => rows.filter((row) => row.exerciseKey === card).map((row) => row.key)

  it('a swap moving two open sets, one of them a dropset, then a reload: both are drawn on the swap\'s card in their places with their types, and the card they left draws neither (break: the swap card\'s entries not kept)', async () => {
    const world = newDraftWorld()
    const first = mount(fakeDraftStore(world))
    await settle()
    act(() => first.result.current.addEntries('pe-1:replacement', moved))
    await settle()
    expect(keysOf(first.result.current.rows, 'pe-1:replacement')).toEqual(['added:pe-1:replacement:m1', 'added:pe-1:replacement:m2', 'added:pe-1:replacement:m2:stage:1'])
    expect(world.lists).toEqual({ 'pe-1:replacement': moved })
    first.unmount()

    const again = mount(fakeDraftStore(world))
    await settle()
    expect(again.result.current.hydrated).toBe(true)
    const rows = again.result.current.rows
    expect(keysOf(rows, 'pe-1:replacement')).toEqual(['added:pe-1:replacement:m1', 'added:pe-1:replacement:m2', 'added:pe-1:replacement:m2:stage:1'])
    expect(rows.filter((r) => r.exerciseKey === 'pe-1:replacement' && r.kind !== 'stage').map((r) => r.type)).toEqual([NORMAL, { kind: 'staged', stageKind: 'dropset', stageCount: 1 }])
    expect(keysOf(rows, 'pe-1')).toEqual(['set:set-1']) // the card they left draws neither of them (46r's Q1: a gap, never a row)
  })

  it('a swap that was never saved (the app closed first) left its entries on the phone; the retry replaces them, so no moved set is drawn twice (break: the entries added to the old ones)', async () => {
    const world = newDraftWorld()
    world.lists = { 'pe-1:replacement': [{ localId: 'stale', logId: null, type: NORMAL, place: 1 }] }
    const view = mount(fakeDraftStore(world))
    await settle()
    act(() => view.result.current.addEntries('pe-1:replacement', moved))
    await settle()
    expect(keysOf(view.result.current.rows, 'pe-1:replacement').filter((k) => !k.includes(':stage:'))).toEqual(['added:pe-1:replacement:m1', 'added:pe-1:replacement:m2'])
    expect(world.lists).toEqual({ 'pe-1:replacement': moved })
  })

  it('the screen draws before the phone has answered, and a stored list is merged in, never written over by the empty one it started with', async () => {
    const world = newDraftWorld()
    world.lists = { 'pe-1:replacement': moved }
    const view = mount(fakeDraftStore(world))
    expect(view.result.current.hydrated).toBe(false)
    expect(keysOf(view.result.current.rows, 'pe-1:replacement')).toEqual([]) // first draw: the phone has not answered
    await settle()
    expect(view.result.current.hydrated).toBe(true)
    expect(keysOf(view.result.current.rows, 'pe-1:replacement')).toHaveLength(3)
    expect(world.log).not.toContain('lists') // nothing written back for a list that did not change
    expect(world.lists).toEqual({ 'pe-1:replacement': moved })
  })

  it('every card of an exercise is handed all the session\'s drafts: an exercise on two cards draws the draft of its added set once, on the card the rules name (break: the drafts handed to the last card only)', async () => {
    const world = newDraftWorld()
    const key = { sessionId: 'session-1', localId: 'a1', exerciseId: 'ex-1', position: 2 }
    world.drafts.set('session-1|a:a1', {
      id: 'session-1|a:a1', sessionId: 'session-1', key,
      values: { weight: 50, reps: 10, rir: null, formRating: null, enteredUnit: null, type: NORMAL, place: 1, loggedAt: '2026-01-05T10:00:00Z' },
    })
    const twoCards: WorkoutCard[] = [
      { key: 'pe-1', programExercise: exerciseOf(), plannedSets: [] },
      { key: 'extra-ex-1', programExercise: exerciseOf({ id: 'extra-ex-1' }), plannedSets: [] },
    ]
    const view = renderHook(() => useWorkoutRows({ cards: twoCards, blocks: [], logs: [], store: fakeDraftStore(world) }))
    await settle()
    expect(view.result.current.rows.map((r) => r.key)).toEqual(['added:pe-1:a1'])
  })

  it('a session that is not in progress writes no list (persist off)', async () => {
    const world = newDraftWorld()
    const store = fakeDraftStore(world)
    const view = renderHook(() => useWorkoutRows({ cards: cards(), blocks: [], logs: [headLogOf(1)], store, persist: false }))
    await settle()
    act(() => view.result.current.addEntries('pe-1:replacement', moved))
    await settle()
    expect(world.log).not.toContain('lists')
  })
})
