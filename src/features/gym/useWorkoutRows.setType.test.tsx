// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { exerciseOf, plannedSet } from './cardHarness.testutil'
import { useWorkoutRows } from './useWorkoutRows'
import type { HeldChange } from './workoutRules'

// Chunk 62 — what the session's rows hold for a type (TASKS-1.2 62; DECISIONS 161): the card's own state for a set added in the session, and the phone's in-flight change
// rows. `holdStages`, which held a swap's moved dropset's drops on the phone until 62 wrote their row, is gone.

const card = () => {
  const programExercise = exerciseOf()
  return { key: programExercise.id, programExercise, plannedSets: [plannedSet(1)] }
}
const noLogs: never[] = []

describe('setAddedType: the card keeps an added set\'s type until it has a log (DECISIONS 161)', () => {
  it('a set added with + ADD SET is Normal; given a type it is drawn as that type (a warmup leaves the working numbers, a dropset has its drops as open rows)', () => {
    const { result } = renderHook(() => useWorkoutRows({ cards: [card()], blocks: [], logs: noLogs }))
    let localId = ''
    act(() => void (localId = result.current.addSet('pe-1').localId))
    const added = () => result.current.rows.filter((r) => r.added && r.kind !== 'stage')
    expect(added().map((r) => r.type)).toEqual([{ kind: 'normal' }])
    act(() => result.current.setAddedType('pe-1', localId, { kind: 'staged', stageKind: 'dropset', stageCount: 2 }))
    expect(added().map((r) => r.type)).toEqual([{ kind: 'staged', stageKind: 'dropset', stageCount: 2 }])
    expect(result.current.rows.filter((r) => r.kind === 'stage')).toHaveLength(2)
    act(() => result.current.setAddedType('pe-1', localId, { kind: 'warmup' }))
    expect(added().map((r) => [r.kind, r.type])).toEqual([['warmup', { kind: 'warmup' }]])
    expect(result.current.rows.filter((r) => r.kind === 'stage')).toHaveLength(0)
  })

  it('a set the card\'s list does not name throws: the type would be lost, and the caller says why', () => {
    const { result } = renderHook(() => useWorkoutRows({ cards: [card()], blocks: [], logs: noLogs }))
    expect(() => result.current.setAddedType('pe-1', 'nope', { kind: 'warmup' })).toThrow(/lists no added set/)
    expect(() => result.current.setAddedType('no-card', 'nope', { kind: 'warmup' })).toThrow(/lists no added set/)
  })

  it('the type of one added set is not another\'s', () => {
    const { result } = renderHook(() => useWorkoutRows({ cards: [card()], blocks: [], logs: noLogs }))
    let first = ''
    act(() => {
      first = result.current.addSet('pe-1').localId
    })
    act(() => void result.current.addSet('pe-1'))
    act(() => result.current.setAddedType('pe-1', first, { kind: 'warmup' }))
    expect(result.current.rows.filter((r) => r.added).map((r) => r.kind)).toEqual(['warmup', 'working'])
  })
})

describe('holdChanges draws a change before its row is written and lets it go when the caller says (chunks 61 and 62)', () => {
  it('a `retyped` change held in flight is the set\'s type from then on, and the set\'s plan type again once it is released and no row is stored', () => {
    const { result } = renderHook(() => useWorkoutRows({ cards: [card()], blocks: [], logs: noLogs }))
    const planned = () => result.current.rows.find((r) => r.key === 'set:set-1')!.type
    expect(planned()).toEqual({ kind: 'normal' })
    let release = () => {}
    act(() => {
      release = result.current.holdChanges([{ kind: 'retyped', weekPlanSetId: 'set-1', type: { kind: 'warmup' } }])
    })
    expect(planned()).toEqual({ kind: 'warmup' })
    act(() => release())
    expect(planned()).toEqual({ kind: 'normal' })
  })

  it('a stored row is read with its id and a held change over it is the newer word', () => {
    const stored: HeldChange = { kind: 'retyped', weekPlanSetId: 'set-1', type: { kind: 'staged', stageKind: 'dropset', stageCount: 1 }, id: 'chg-1' }
    const { result } = renderHook(() => useWorkoutRows({ cards: [card()], blocks: [], logs: noLogs, changes: [stored] }))
    expect(result.current.changes).toEqual([stored])
    expect(result.current.rows.find((r) => r.key === 'set:set-1')!.type).toEqual({ kind: 'staged', stageKind: 'dropset', stageCount: 1 })
    act(() => void result.current.holdChanges([{ kind: 'retyped', weekPlanSetId: 'set-1', type: { kind: 'staged', stageKind: 'dropset', stageCount: 3 } }]))
    expect(result.current.rows.find((r) => r.key === 'set:set-1')!.type).toEqual({ kind: 'staged', stageKind: 'dropset', stageCount: 3 })
  })
})
