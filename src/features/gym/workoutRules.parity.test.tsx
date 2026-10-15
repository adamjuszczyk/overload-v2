// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ProgramExercise, SetLog } from '../../types'
import { useExerciseCardState } from './useExerciseCardState'
import { resolveRows } from './workoutRules'
import { addedLog, card, dropLog, headLog, orderOf } from './workoutRules.testutil'

// Chunk 46: `resolveRows` numbers and matches the rows as the workout screen does today. This is the executed
// comparison (Checks that lied #28: parity claimed by hand hid bugs): the same plan and logs go through the
// card's own hook (`useExerciseCardState`, which 58a replaces with rows drawn from `resolveRows`) and through
// `resolveRows`, and the numbers, the logged and unlogged states and the drops still to log must agree.
// 58a deletes this file with the hook it compares against.

function programExercise(key: string): ProgramExercise {
  return { id: key, workoutDayId: 'wd', userId: 'u1', exerciseId: `ex.${key}`, position: 0, weightUnit: null }
}

/** What the card draws for a set: where it stands, the number it shows, whether it is logged, its drops. */
interface Shown {
  number: number
  state: 'logged' | 'skipped' | 'unlogged'
  loggedDrops: number
  openDrops: number
}

function fromHook(spec: string, logs: SetLog[], addedTaps: number): { sets: Shown[]; warmups: number[] } {
  const c = card('ex', spec)
  const { result } = renderHook(() =>
    useExerciseCardState({
      programExercise: programExercise('ex'),
      plannedSets: c.plannedSets as never,
      currentLogs: logs,
      lastLogs: [],
      lastLogsLoading: false,
      referenceSessions: [],
      referenceLoading: false,
      referenceMesocycleId: null,
      referenceIsError: false,
      referenceIsFromCache: false,
      onRetryReference: () => {},
      today: '2026-10-12',
      onLog: async () => ({}) as SetLog,
      onUpdateSet: () => {},
      onDeleteSet: async () => {},
      onSwap: () => {},
    }),
  )
  for (let i = 0; i < addedTaps; i++) act(() => result.current.handleAddSet())
  const state = result.current
  const stateOf = (head: SetLog | undefined): Shown['state'] => (head === undefined ? 'unlogged' : head.isSkipped ? 'skipped' : 'logged')
  const planned = state.plannedDisplay.map((row) => {
    const loggedDrops = row.group?.stages.length ?? 0
    // SetGroup draws the planned drops still to do under a head that is logged and not skipped, and every planned drop under an unlogged head.
    const openDrops = row.group?.head.isSkipped ? 0 : row.plannedStages.length - loggedDrops
    return { number: row.displayNumber, state: stateOf(row.group?.head), loggedDrops, openDrops }
  })
  const extra = state.extraDisplay.map((row) => ({
    number: row.displayNumber,
    state: stateOf(row.group?.head),
    loggedDrops: row.group?.stages.length ?? 0,
    openDrops: 0,
  }))
  return { sets: [...planned, ...extra], warmups: state.warmupRows.map((_, i) => i + 1) }
}

function fromRules(spec: string, logs: SetLog[], added: number): { sets: Shown[]; warmups: number[] } {
  const rows = resolveRows(orderOf([card('ex', spec, { added })]), logs, [])
  const sets = rows
    .filter((r) => r.kind === 'working')
    .map((head) => {
      const drops = rows.filter((r) => r.kind === 'stage' && r.headKey === head.key)
      return {
        number: head.number,
        state: head.state,
        loggedDrops: drops.filter((d) => d.state !== 'unlogged').length,
        openDrops: drops.filter((d) => d.state === 'unlogged').length,
      }
    })
  return { sets, warmups: rows.filter((r) => r.kind === 'warmup').map((r) => r.number) }
}

// `taps` is how many times ADD SET was tapped after the screen opened; the card's slots start at the added sets
// already logged (its `extraSlotCount`), which is the count the rules are given.
function same(spec: string, logs: SetLog[], taps = 0) {
  const addedLogs = logs.filter((l) => l.weekPlanSetId === null && l.parentSetId === null && !l.isWarmup).length
  const hook = fromHook(spec, logs, taps)
  const rules = fromRules(spec, logs, addedLogs + taps)
  expect(rules).toEqual(hook)
  return rules
}

describe('resolveRows reads a plan and its logs as the card does today', () => {
  it('nothing logged: the sets run 1 to 4', () => {
    const shown = same('n n n n', [])
    expect(shown.sets.map((s) => s.number)).toEqual([1, 2, 3, 4])
  })

  it('two logged in order: the open ones follow the logged heads', () => {
    const shown = same('n n n n', [headLog('ex', 1), headLog('ex', 2)])
    expect(shown.sets.map((s) => [s.number, s.state])).toEqual([[1, 'logged'], [2, 'logged'], [3, 'unlogged'], [4, 'unlogged']])
  })

  it('set 3 logged first: it shows 1 and the sets before it shift', () => {
    const shown = same('n n n n', [headLog('ex', 3, { number: 1 })])
    expect(shown.sets.map((s) => s.number)).toEqual([2, 3, 1, 4])
  })

  it('logs that come in any order, a skipped set among them', () => {
    const shown = same('n n n n', [headLog('ex', 2, { number: 2 }), headLog('ex', 1, { number: 1, skipped: true })])
    expect(shown.sets.map((s) => s.state)).toEqual(['skipped', 'logged', 'unlogged', 'unlogged'])
  })

  it('warmups are numbered among themselves and do not move the working sets', () => {
    const shown = same('w w n n', [headLog('ex', 1, { warmup: true, number: 1 }), headLog('ex', 3, { number: 1 })])
    expect(shown.warmups).toEqual([1, 2])
    expect(shown.sets.map((s) => s.number)).toEqual([1, 2])
  })

  it('a dropset: the head logged with one of two planned drops, and with none', () => {
    const head = headLog('ex', 1, { stageKind: 'dropset' })
    const one = same('d2 n', [head, dropLog(head, 1)])
    expect(one.sets[0]).toEqual({ number: 1, state: 'logged', loggedDrops: 1, openDrops: 1 })
    const none = same('d2 n', [head])
    expect(none.sets[0]).toEqual({ number: 1, state: 'logged', loggedDrops: 0, openDrops: 2 })
    expect(same('d2 n', []).sets[0]).toEqual({ number: 1, state: 'unlogged', loggedDrops: 0, openDrops: 2 })
  })

  it('a skipped dropset head has no drops left to do', () => {
    const head = headLog('ex', 1, { skipped: true, stageKind: 'dropset' })
    expect(same('d2 n', [head]).sets[0]).toEqual({ number: 1, state: 'skipped', loggedDrops: 0, openDrops: 0 })
  })

  it('a pre-1.1 dropset (no stage kind anywhere) is a dropset in both', () => {
    const head = headLog('ex', 1)
    expect(same('l1 n', [head]).sets[0]).toEqual({ number: 1, state: 'logged', loggedDrops: 0, openDrops: 1 })
  })

  it('sets added with ADD SET: one logged and two more taps, after the planned ones', () => {
    const logs = [headLog('ex', 1), headLog('ex', 2), addedLog('ex', 1, { number: 3 })]
    const shown = same('n n', logs, 2)
    expect(shown.sets.map((s) => [s.number, s.state])).toEqual([[1, 'logged'], [2, 'logged'], [3, 'logged'], [4, 'unlogged'], [5, 'unlogged']])
  })

  it('added logs that come in any order are matched in the order of their numbers', () => {
    const logs = [headLog('ex', 1), addedLog('ex', 2, { number: 4 }), addedLog('ex', 1, { number: 3 })]
    const shown = same('n n', logs, 1)
    // the open planned set shows 4: three heads are logged (one planned, two added); the screen's own rule, kept
    expect(shown.sets.map((s) => [s.number, s.state])).toEqual([[1, 'logged'], [4, 'unlogged'], [3, 'logged'], [4, 'logged'], [5, 'unlogged']])
  })

  it('an added set made a dropset in the session shows the drop it was logged with', () => {
    const head = addedLog('ex', 1, { stageKind: 'dropset', number: 1 })
    const shown = same('', [head, dropLog(head, 1)])
    expect(shown.sets[0]).toEqual({ number: 1, state: 'logged', loggedDrops: 1, openDrops: 0 })
  })
})
