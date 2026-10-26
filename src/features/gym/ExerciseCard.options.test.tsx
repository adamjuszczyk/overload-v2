// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, screen, within, act } from '@testing-library/react'
import type { Exercise } from '../../types'
import type { SetLog } from '../../types'
import type { LogRequest } from './useExerciseCardState'
import { headLogOf, logOf, plannedDrop, plannedSet, renderCard, exerciseOf } from './cardHarness.testutil'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { numberCorrections, resolveRows, sessionOrder, type AddedSet, type OrderExercise, type SwapRecord } from './workoutRules'

// Chunk 59 — the exercise ⋯ of one card (board W10): which rows it offers where (DECISIONS 199 (a), TASKS 59), "Add a set" and its place
// (46m's mapping), and what "Skip the rest of this exercise" writes for every set it covers (DECISIONS 163 (a)). The card is drawn through
// `useWorkoutRows` as GymSession draws it (cardHarness.testutil.tsx); `onLog` is `useLogSet`'s mutate, so what it receives is the payload the
// screen writes. The swap through GymSession itself: GymSession.swap.test.tsx.

// The shared picker (chunk 41; its states are 41's): a stand-in whose button picks the replacement.
const REPLACEMENT: Exercise = {
  id: 'ex-2', userId: 'u1', name: 'Incline Press', muscleGroup: 'chest', isArchived: false, createdAt: '', muscleSubgroups: null, movementPattern: null,
  status: 'active', sourceLibraryId: null, lostAt: null,
}
vi.mock('../../components/ExercisePickerSheet', () => ({
  default: ({ onPick }: { onPick: (exercise: Exercise) => void }) => <button onClick={() => onPick(REPLACEMENT)}>PICK</button>,
}))

afterEach(() => {
  cleanup()
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
})
beforeEach(() => useSettingsStore.setState({ ...DEFAULT_SETTINGS }))

type Payload = Record<string, unknown>
function spy(hold = false) {
  const calls: Payload[] = []
  const releases: Array<() => void> = []
  const onLog = vi.fn((params: LogRequest) => {
    calls.push(params as unknown as Payload)
    const log = logOf({ id: (params.id as string | undefined) ?? `new-${calls.length}`, ...(params as unknown as Partial<SetLog>) })
    return hold ? new Promise<SetLog>((resolve) => void releases.push(() => resolve(log))) : Promise.resolve(log)
  })
  return { calls, onLog, releases }
}
const openOptions = () => fireEvent.click(screen.getByLabelText('Exercise options'))
const sheet = () => screen.getByRole('dialog')
const rowsIn = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-row-key]')).map((el) => el.querySelector('span')?.textContent)
const typeInto = (scope: HTMLElement, label: 'Weight' | 'Reps', value: string) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } })
const logCurrent = async (c: HTMLElement, weight = '50', reps = '10') => {
  const row = c.querySelector('[data-current-set]') as HTMLElement
  typeInto(row, 'Weight', weight)
  typeInto(row, 'Reps', reps)
  await act(async () => {
    fireEvent.click(within(row).getByText('LOG'))
    await Promise.resolve()
  })
}

describe('the ⋯ of a card: the rows it offers, and where (DECISIONS 199 (a): a swap only where today\'s app offers it)', () => {
  it('a plain card: the eyebrow counts its sets, and the four rows are there with the words of W10', () => {
    renderCard({ plannedSets: [1, 2, 3].map((n) => plannedSet(n)), logs: [headLogOf(1)] })
    openOptions()
    expect(within(sheet()).getByText('CHEST · 1 OF 3 SETS DONE')).toBeTruthy()
    expect(within(sheet()).getByText('Bench Press')).toBeTruthy()
    expect(within(sheet()).getByText('Swap for today')).toBeTruthy()
    expect(within(sheet()).getByText('Sets 02 and 03 will be marked skipped.')).toBeTruthy()
    expect(within(sheet()).getByText('Add a set')).toBeTruthy()
    expect(within(sheet()).getByText('Exercise history')).toBeTruthy()
  })

  // A family of similar controls is tested with a table over every member (RULES): each state of a card, and the rows it draws.
  const STATES: Array<[string, Record<string, unknown>, { swap: boolean; skip: boolean; addSet: boolean; addSetButton: boolean }]> = [
    ['a card of a planned slot no swap touched', {}, { swap: true, skip: true, addSet: true, addSetButton: true }],
    ['the card a swap made (SWAPPED FROM)', { swappedFrom: { exerciseName: 'Lat Pulldown' }, slotSwapped: true }, { swap: false, skip: true, addSet: true, addSetButton: true }],
    ['a card that says it was swapped from something, whatever the slot says (SWAPPED FROM never sits over a swap)', { swappedFrom: { exerciseName: 'Lat Pulldown' } }, { swap: false, skip: true, addSet: true, addSetButton: true }],
    ['the card of a swapped slot (a swap row with no record, 198 (a))', { slotSwapped: true }, { swap: false, skip: true, addSet: true, addSetButton: true }],
    ['an exercise added today (ADDED TODAY)', { addedToday: true }, { swap: false, skip: true, addSet: true, addSetButton: true }],
    ['the card the sets of a swap left (its row has a record)', { slotSwapped: true, setsMoved: true }, { swap: false, skip: true, addSet: false, addSetButton: false }],
  ]
  it.each(STATES)('%s', (_name, props, offers) => {
    renderCard({ plannedSets: [1, 2].map((n) => plannedSet(n)), props })
    expect(!!screen.queryByText('ADD SET')).toBe(offers.addSetButton)
    openOptions()
    expect(!!within(sheet()).queryByText('Swap for today')).toBe(offers.swap)
    expect(!!within(sheet()).queryByText('Skip the rest of this exercise')).toBe(offers.skip)
    expect(!!within(sheet()).queryByText('Add a set')).toBe(offers.addSet)
    expect(within(sheet()).getByText('Exercise history')).toBeTruthy()
  })

  it('"Nothing left to skip": with every set logged or skipped the skip row is not drawn', () => {
    renderCard({ plannedSets: [1, 2].map((n) => plannedSet(n)), logs: [headLogOf(1), headLogOf(2, { isSkipped: true, weight: null, reps: null })] })
    openOptions()
    expect(within(sheet()).queryByText('Skip the rest of this exercise')).toBeNull()
    expect(within(sheet()).getByText('Swap for today')).toBeTruthy()
    expect(within(sheet()).getByText('Add a set')).toBeTruthy()
  })

  it('the old controls are gone from the card: no swap icon, no SKIP REST OF EXERCISE under the rows (absence)', () => {
    const { container } = renderCard({ plannedSets: [1, 2].map((n) => plannedSet(n)) })
    expect(screen.queryByLabelText('Swap exercise for this session')).toBeNull()
    expect(container.textContent).not.toContain('SKIP REST OF EXERCISE')
    expect(screen.getByLabelText('Exercise options')).toBeTruthy()
  })

  it('a muscle group is worded as the boards word it (REAR DELTS), not as it is stored', () => {
    const programExercise = exerciseOf()
    renderCard({
      plannedSets: [plannedSet(1)],
      props: { programExercise: { ...programExercise, exercise: { ...programExercise.exercise!, muscleGroup: 'rear_delts' as never } } },
    })
    expect(screen.getByText('REAR DELTS')).toBeTruthy()
  })
})

describe('Add a set (SPEC Supersets: "a member\'s ⋯ has Add a set for that member only"; 46m: the place is given once, when the set is made)', () => {
  it('twice on one exercise gives places 1 and 2: the set logged first carries 1, the next 2, and each the number its row shows (break: a fixed place)', async () => {
    const { calls, onLog } = spy()
    const { container, setLogs } = renderCard({ plannedSets: [], props: { onLog } })
    openOptions()
    fireEvent.click(screen.getByText('Add a set'))
    expect(screen.queryByRole('dialog')).toBeNull() // the sheet closes
    openOptions()
    fireEvent.click(screen.getByText('Add a set'))
    expect(rowsIn(container)).toEqual(['01', '02'])
    await logCurrent(container)
    setLogs([logOf({ id: calls[0].id as string, setNumber: 1, addedPlace: 1 })])
    await logCurrent(container, '55', '8')
    expect(calls.map((c) => [c.setNumber, c.addedPlace, c.weekPlanSetId])).toEqual([[1, 1, null], [2, 2, null]])
    expect(calls.every((c) => typeof c.id === 'string')).toBe(true)
  })

  it('on a card that has planned sets, the new set is the next number after them and comes after the plan', () => {
    const { container } = renderCard({ plannedSets: [1, 2].map((n) => plannedSet(n)) })
    openOptions()
    fireEvent.click(screen.getByText('Add a set'))
    expect(rowsIn(container)).toEqual(['01', '02', '03'])
  })
})

describe('Skip the rest of this exercise covers every open set (DECISIONS 163 (a), Adam 2026-10-16; TASKS 59)', () => {
  const skipTheRest = async (label: string) => {
    openOptions()
    fireEvent.click(screen.getByText('Skip the rest of this exercise'))
    await act(async () => {
      fireEvent.click(screen.getByText(label))
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
  }

  it('the warmup is skipped as a warmup, with the planned set it is, the number its row shows and no rest started (break: planned working sets only)', async () => {
    const { calls, onLog } = spy()
    renderCard({ plannedSets: [plannedSet(1, { id: 'w', isWarmup: true }), plannedSet(2, { id: 'set-2' })], props: { onLog } })
    await skipTheRest('SKIP 2 SETS')
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ weekPlanSetId: 'w', setNumber: 1, isSkipped: true, isWarmup: true, weight: null, reps: null, parentSetId: null, stageIndex: 0 })
    expect('addedPlace' in calls[0]).toBe(false) // a planned set's skip carries no place
    expect('isWarmup' in calls[1]).toBe(false) // and a planned working set's payload is the one it always was
    expect(calls[1]).toMatchObject({ weekPlanSetId: 'set-2', setNumber: 1, isSkipped: true })
    expect(useRestTimerStore.getState().startedAt).not.toBeNull() // the working set's skip starts its rest, as it always did
  })

  it('a skipped warmup alone starts no rest', async () => {
    const { onLog } = spy()
    renderCard({ plannedSets: [plannedSet(1, { id: 'w', isWarmup: true })], props: { onLog } })
    await skipTheRest('SKIP 1 SET')
    expect(onLog).toHaveBeenCalledTimes(1)
    expect(useRestTimerStore.getState().startedAt).toBeNull()
  })

  it('an open added set is skipped with its place, naming its own log (break: the place left out; no id, and the log is drawn as a second set)', async () => {
    const { calls, onLog } = spy()
    const { container, setLogs } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1)], props: { onLog } })
    openOptions()
    fireEvent.click(screen.getByText('Add a set'))
    openOptions()
    fireEvent.click(screen.getByText('Add a set'))
    expect(rowsIn(container)).toEqual(['01', '02', '03'])
    await skipTheRest('SKIP 2 SETS')
    expect(calls).toHaveLength(2)
    expect(calls.map((c) => [c.weekPlanSetId, c.setNumber, c.isSkipped, c.addedPlace])).toEqual([[null, 2, true, 1], [null, 3, true, 2]])
    expect(calls.every((c) => typeof c.id === 'string' && !('isWarmup' in c))).toBe(true)
    // the server's answer: two skipped logs; each added set is drawn once, as skipped
    setLogs([headLogOf(1), ...calls.map((c) => logOf({ id: c.id as string, setNumber: c.setNumber as number, isSkipped: true, weight: null, reps: null, addedPlace: c.addedPlace as number }))])
    expect(rowsIn(container)).toEqual(['01', '02', '03'])
    expect(Array.from(container.querySelectorAll('[data-row-key]')).map((el) => (el as HTMLElement).textContent!.includes('SKIPPED'))).toEqual([false, true, true])
  })

  it('a planned dropset: the head then each drop, as before, and the open drops of a logged head too', async () => {
    const { calls, onLog } = spy()
    renderCard({ plannedSets: [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1), plannedDrop(1, 2)], logs: [headLogOf(1, { stageKind: 'dropset' })], props: { onLog } })
    await skipTheRest('SKIP 2 SETS')
    expect(calls.map((c) => [c.weekPlanSetId, c.parentSetId, c.stageIndex, c.isDropset, c.setNumber])).toEqual([
      ['set-1-drop-1', 'log-1', 1, true, 1],
      ['set-1-drop-2', 'log-1', 2, true, 1],
    ])
  })

  it('the button reads SKIPPING… while the skips are out and the sheet closes when they are written', async () => {
    const { releases, onLog } = spy(true)
    renderCard({ plannedSets: [plannedSet(1)], props: { onLog } })
    openOptions()
    fireEvent.click(screen.getByText('Skip the rest of this exercise'))
    await act(async () => {
      fireEvent.click(screen.getByText('SKIP 1 SET'))
      await Promise.resolve()
    })
    expect(screen.getByText('SKIPPING…')).toBeTruthy()
    await act(async () => {
      releases[0]()
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the skip of a set a swap moved is read back by the rules that draw it (DECISIONS 194; 46r\'s probes P1 and P1b)', () => {
  // Lat Pulldown 01 logged; A and B added and made Warmups, B logged (W2); the swap moves A. After a reload, B must still read W2, Lat
  // Pulldown must draw no row for A, and drawing writes nothing: A's skip alone holds the kind (a warmup) and the place of the gap it left.
  // (Nothing on the screen makes an added Warmup before chunk 62, so the card's list starts with these two: `initialAdded`.)
  const WARMUP = { kind: 'warmup' as const }
  const entries: AddedSet[] = [
    { localId: 'a', logId: null, type: WARMUP, place: 1 },
    { localId: 'b', logId: 'log-b', type: WARMUP, place: 2 },
  ]
  const lat1 = headLogOf(1, { id: 'log-lat-1', weekPlanSetId: 'lat.1' })
  const logB = logOf({ id: 'log-b', setNumber: 2, isWarmup: true, addedPlace: 2 })

  async function swapMovingA() {
    const { calls, onLog } = spy()
    let saved: { record: SwapRecord; entries: AddedSet[] } | null = null
    renderCard({
      plannedSets: [plannedSet(1, { id: 'lat.1' })],
      logs: [lat1, logB],
      initialAdded: entries,
      props: { onLog, onSwap: async (input) => void (saved = { record: input.record, entries: input.entries }) },
    })
    openOptions()
    fireEvent.click(screen.getByText('Swap for today'))
    await act(async () => {
      fireEvent.click(screen.getByText('PICK'))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(screen.queryByText('PICK')).toBeNull() // the swap is saved: the picker closes (a refused swap keeps it, GymSession.swap.test.tsx)
    return { calls, saved: saved! }
  }

  // The session as a reload draws it: the card's list is gone, the swap's record and the logs (the skip among them) remain.
  function readAfterReload(skip: Payload, record: SwapRecord) {
    const lat: OrderExercise = { key: 'pe-1', exerciseId: 'ex-1', name: 'Bench Press', plannedSets: [plannedSet(1, { id: 'lat.1' })], added: [] }
    const machine: OrderExercise = { key: 'pe-1:replacement', exerciseId: 'ex-2', name: 'Incline Press', plannedSets: [], added: [], swappedFrom: record }
    const skipLog = logOf({
      id: skip.id as string, exerciseId: skip.exerciseId as string, weekPlanSetId: skip.weekPlanSetId as string | null, setNumber: skip.setNumber as number,
      isSkipped: true, weight: null, reps: null, isWarmup: (skip.isWarmup as boolean | undefined) ?? false, addedPlace: (skip.addedPlace as number | null | undefined) ?? null,
    })
    const logs = [lat1, logB, skipLog]
    const order = sessionOrder([lat, machine])
    const rows = resolveRows(order, logs).filter((r) => r.exerciseKey === 'pe-1').map((r) => `${r.kind === 'warmup' ? 'W' : ''}${String(r.number).padStart(r.kind === 'warmup' ? 1 : 2, '0')}${r.state === 'logged' ? '✓' : r.state === 'skipped' ? '×' : '·'}`)
    return { rows, corrections: numberCorrections(order, logs) }
  }

  it('A\'s skip carries its warmup kind and its place; read back, B still reads W2, the card draws no row for A and nothing is written', async () => {
    const { calls, saved } = await swapMovingA()
    expect(saved.record).toEqual({ fromKey: 'pe-1', moved: [{ from: { addedPlace: 1 }, place: 1 }] })
    expect(saved.entries).toMatchObject([{ place: 1, type: WARMUP }])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ exerciseId: 'ex-1', weekPlanSetId: null, setNumber: 1, isSkipped: true, isWarmup: true, addedPlace: 1, parentSetId: null, stageIndex: 0 })
    expect(typeof calls[0].id).toBe('string')
    const read = readAfterReload(calls[0], saved.record)
    expect(read.rows).toEqual(['W2✓', '01✓']) // B is W2 beside the gap A left; the gap is no row
    expect(read.corrections).toEqual([])
  })

  it('the control: without its warmup kind the skip reads as a working set, B reads W1 and the draw would write 2 → 1; without its place it is a set logged before 044 and is drawn beside the moved set', async () => {
    const { calls, saved } = await swapMovingA()
    const { isWarmup: _kind, ...noKind } = calls[0]
    const withoutKind = readAfterReload(noKind, saved.record)
    expect(withoutKind.rows).not.toEqual(['W2✓', '01✓'])
    expect(withoutKind.corrections).toEqual([{ id: 'log-b', setNumber: 1 }])
    const { addedPlace: _place, ...noPlace } = calls[0]
    const withoutPlace = readAfterReload(noPlace, saved.record)
    expect(withoutPlace.rows).not.toEqual(['W2✓', '01✓'])
  })
})
