// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, within, fireEvent, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SupersetBlock, { type SupersetMember } from './SupersetBlock'
import type { SwapInput } from './useExerciseCardState'
import { useWorkoutRows } from './useWorkoutRows'
import { referenceSessionOf } from './cardHarness.testutil'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import type { ProgramExercise, WeekPlanSet, SetLog, Exercise } from '../../types'
import { spyWriters } from './setWriters.testutil'

// Chunk 58a: the block draws the rounds the session's rules form (`resolveRows`), through `useWorkoutRows`, which the harness below
// stands in for (GymSession calls it once for the whole session). The rows are found by what they say: `data-row-key` names a row and
// its first cell is its label (A1, B1, … — the member's letter and the round).

afterEach(() => {
  cleanup()
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
})

const REPLACEMENT: Exercise = {
  id: 'ex-replacement', userId: 'u1', name: 'Incline Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
// A stand-in for the shared exercise picker (chunk 59: the swap's; its own states are chunk 41's): it names the exercise being replaced.
vi.mock('../../components/ExercisePickerSheet', () => ({
  default: ({ replacing, onPick, onClose }: { replacing?: { id: string }; onPick: (ex: Exercise) => void; onClose: () => void }) => (
    <div>
      <p>SWAP SHEET FOR {replacing?.id}</p>
      <button onClick={() => onPick(REPLACEMENT)}>CONFIRM PICK</button>
      <button onClick={onClose}>close sheet</button>
    </div>
  ),
}))

function makeExercise(id: string, name: string): ProgramExercise {
  return {
    id, workoutDayId: 'wd-1', userId: 'u1', exerciseId: `ex-${id}`, position: 0, weightUnit: null, supersetBlockId: 'block-1',
    exercise: {
      id: `ex-${id}`, userId: 'u1', name, muscleGroup: 'chest', isArchived: false, createdAt: '2026-01-01T00:00:00Z',
      muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
    },
  }
}

function plannedHeads(programExerciseId: string, count: number, extra: Partial<WeekPlanSet> = {}): WeekPlanSet[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${programExerciseId}-set-${i + 1}`, weekPlanId: 'wp-1', userId: 'u1', programExerciseId, setNumber: i + 1, targetRir: 2,
    isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...extra,
  }))
}

function members(): SupersetMember[] {
  const peA = makeExercise('pe-a', 'Bench Press')
  const peB = makeExercise('pe-b', 'Barbell Row')
  return [
    { cardKey: peA.id, programExercise: peA, plannedSets: plannedHeads(peA.id, 4), referenceSessions: [] },
    { cardKey: peB.id, programExercise: peB, plannedSets: plannedHeads(peB.id, 3), referenceSessions: [] },
  ]
}

function makeSetLog(overrides: Partial<SetLog> = {}): SetLog {
  return {
    id: 'log-1', userId: 'u1', sessionId: 'session-1', exerciseId: 'ex-pe-a', weekPlanSetId: null, setNumber: 1, weight: null, reps: null,
    rir: null, note: null, isDropset: false, parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null,
    isSkipped: false, loggedAt: '2026-01-05T10:00:00.000Z', restSeconds: null, formRating: null, ...overrides,
  }
}

type BlockProps = Partial<Parameters<typeof SupersetBlock>[0]>

function Harness({ ms, logs, overrides }: { ms: SupersetMember[]; logs: SetLog[]; overrides: BlockProps }) {
  const workout = useWorkoutRows({
    cards: ms.map((m) => ({ key: m.cardKey, programExercise: m.programExercise, plannedSets: m.plannedSets })),
    blocks: [{ id: 'block-1', members: ms.map((m) => m.cardKey) }],
    logs,
  })
  return (
    <MemoryRouter>
      <SupersetBlock
        blockId="block-1"
        letter="A"
        members={ms}
        workout={workout}
        logs={logs}
        sessionId="session-1"
        referenceLoading={false}
        referenceMesocycleId={null}
        referenceIsError={false}
        referenceIsFromCache={false}
        onRetryReference={() => {}}
        today="2026-01-05"
        onLog={() => Promise.resolve({} as SetLog)}
        onUpdateSet={() => {}}
        onDeleteSet={async () => {}}
        writers={spyWriters()}
        onSwap={async () => {}}
        {...overrides}
      />
    </MemoryRouter>
  )
}

function renderBlock(ms: SupersetMember[], overrides: BlockProps = {}, logs: SetLog[] = []) {
  const view = render(<Harness ms={ms} logs={logs} overrides={overrides} />)
  return { ...view, setLogs: (next: SetLog[]) => view.rerender(<Harness ms={ms} logs={next} overrides={overrides} />) }
}

const labelOf = (row: Element) => row.querySelector('span')?.textContent
const rowLabels = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-row-key]')).map(labelOf)

describe('SupersetBlock — rounds (SPEC "Supersets", board W1)', () => {
  it('names the block ("SUPERSET A") and shows both exercise names', () => {
    const { container } = renderBlock(members())
    expect(container.textContent).toContain('SUPERSET A')
    expect(container.textContent).toContain('Bench Press')
    expect(container.textContent).toContain('Barbell Row')
  })

  it('says its rest after each round when the block has one (board W1: "REST 1:30 AFTER EACH ROUND")', () => {
    const { container } = renderBlock(members(), { blockRest: { restWithinRoundSeconds: null, restAfterRoundSeconds: 90 } })
    expect(container.textContent).toContain('SUPERSET A · REST 1:30 AFTER EACH ROUND')
  })

  it('4 sets of A, 3 of B → exactly 4 ROUND headers, round 4 has one row (A only)', () => {
    const { container } = renderBlock(members())
    const headers = [...container.querySelectorAll('p')].filter((p) => /^ROUND \d+$/.test(p.textContent ?? '')).map((p) => p.textContent)
    expect(headers).toEqual(['ROUND 1', 'ROUND 2', 'ROUND 3', 'ROUND 4'])
    const round4 = [...container.querySelectorAll('p')].find((p) => p.textContent === 'ROUND 4')!.parentElement!
    expect(rowLabels(round4 as HTMLElement)).toEqual(['A4'])
  })

  it('the zigzag order (A1 → B1 → A2 → B2 → …) is the order of the rows, and A1 is the one current row', () => {
    const { container } = renderBlock(members())
    expect(rowLabels(container)).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4'])
    const current = container.querySelectorAll('[data-current-set]')
    expect(current).toHaveLength(1)
    expect(labelOf(current[0])).toBe('A1')
  })

  it('logging the first (A1) row calls onLog with A\'s exerciseId and the number the row shows, 1', () => {
    const calls: unknown[] = []
    const { container } = renderBlock(members(), { onLog: (params) => { calls.push(params); return Promise.resolve({ id: 'log-1' } as SetLog) } })
    const current = container.querySelector('[data-current-set]') as HTMLElement
    fireEvent.change(within(current).getByLabelText('Weight'), { target: { value: '100' } })
    fireEvent.change(within(current).getByLabelText('Reps'), { target: { value: '8' } })
    fireEvent.click(within(current).getByText('LOG'))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ exerciseId: 'ex-pe-a', setNumber: 1, weight: 100, reps: 8 })
  })

  it('every open row has its boxes (chunk 60), and the current set zigzags into the next member once A1 is logged', () => {
    const { container, setLogs } = renderBlock(members())
    expect(within(container).getAllByLabelText('Weight')).toHaveLength(7) // A1 B1 A2 B2 A3 B3 A4, all open
    expect(labelOf(container.querySelector('[data-current-set]') as HTMLElement)).toBe('A1')
    setLogs([makeSetLog({ id: 'a1', weekPlanSetId: 'pe-a-set-1', weight: 100, reps: 8 })])
    expect(container.querySelectorAll('[data-current-set]')).toHaveLength(1)
    expect(labelOf(container.querySelector('[data-current-set]') as HTMLElement)).toBe('B1')
    expect(within(container).getAllByLabelText('Weight')).toHaveLength(6) // A1 is logged and has no boxes any more
  })
})

describe('SupersetBlock — full per-exercise behaviour inside a block (chunk 13 review fix)', () => {
  // Today is Monday 2026-01-05: last week is Mon 2025-12-29 to Sun 2026-01-04, so Wed 2025-12-31 is last week's and Wed 2025-12-24 the
  // week before (the reference's LAST WEEK and LAST TIME); a sequence run has no weeks and reads the most recent one.
  const lastSet = (sessionId: string, weight: number) => makeSetLog({ id: `${sessionId}-1`, sessionId, weight, reps: 9, rir: 2 })
  const withReference = (...sessions: ReturnType<typeof referenceSessionOf>[]): SupersetMember[] => {
    const [a, b] = members()
    return [{ ...a, referenceSessions: sessions }, b]
  }

  it('last time shows on the member\'s LAST line, from its own reference session, not in its boxes (DECISIONS 162 (a))', () => {
    const { container } = renderBlock(withReference(referenceSessionOf('prev', '2025-12-31', [lastSet('prev', 62.5)])))
    const current = container.querySelector('[data-current-set]') as HTMLElement
    expect((within(current).getByLabelText('Weight') as HTMLInputElement).value).toBe('')
    expect((within(current).getByLabelText('Reps') as HTMLInputElement).value).toBe('')
    expect(current.textContent).toContain('LAST')
    expect(current.textContent).toContain('62.5 × 9 @ 2')
  })

  it('the member\'s LAST line is the reference\'s primary session: a deload last week does not count, and the run\'s schedule type is read', () => {
    // Today is Wednesday 2026-01-07: last week's session is Friday 2026-01-02's, this week's Monday 2026-01-05's.
    const deload = referenceSessionOf('deload', '2025-12-31', [lastSet('deload', 30)], { isDeload: true })
    const lastWeek = referenceSessionOf('lastWeek', '2026-01-02', [lastSet('lastWeek', 70)])
    const thisWeek = referenceSessionOf('thisWeek', '2026-01-05', [lastSet('thisWeek', 80)])
    const lastOf = (c: HTMLElement) => (c.querySelector('[data-current-set]') as HTMLElement).textContent ?? ''
    const weekday = renderBlock(withReference(deload, lastWeek, thisWeek), { today: '2026-01-07' }).container
    expect(lastOf(weekday)).toContain('70 × 9 @ 2') // last week's non-deload session; this week's is the panel's EARLIER THIS WEEK
    cleanup()
    const sequence = renderBlock(withReference(deload, lastWeek, thisWeek), { today: '2026-01-07', referenceScheduleType: 'sequence' }).container
    expect(lastOf(sequence)).toContain('80 × 9 @ 2') // a sequence run has no weeks: the most recent past non-deload session
    expect(lastOf(sequence)).not.toContain('30 ×')
  })

  it('swap: "Swap for today" in a member\'s ⋯ opens its own picker; confirming calls onSwap with that member\'s programExercise', async () => {
    const swapCalls: SwapInput[] = []
    renderBlock(members(), { onSwap: async (input) => void swapCalls.push(input) })
    const options = screen.getAllByLabelText('Exercise options')
    expect(options).toHaveLength(2)
    fireEvent.click(options[1])
    fireEvent.click(screen.getByText('Swap for today'))
    expect(screen.getByText('SWAP SHEET FOR ex-pe-b')).toBeTruthy()
    fireEvent.click(screen.getByText('CONFIRM PICK'))
    await vi.waitFor(() => expect(swapCalls).toHaveLength(1))
    expect(swapCalls[0]).toMatchObject({ exercise: REPLACEMENT, programExercise: { id: 'pe-b', exerciseId: 'ex-pe-b' }, record: { fromKey: 'pe-b' } })
    await vi.waitFor(() => expect(screen.queryByText('SWAP SHEET FOR ex-pe-b')).toBeNull()) // saved: the member's picker closes
  })

  it('skip: skipping one member marks only ITS remaining planned sets, each with the number its row shows', async () => {
    const skipped: { exerciseId: string; setNumber: number }[] = []
    renderBlock(members(), {
      onLog: (params) => {
        if (params.isSkipped) skipped.push({ exerciseId: params.exerciseId, setNumber: params.setNumber })
        return Promise.resolve({ id: `log-${skipped.length}` } as SetLog)
      },
    })
    fireEvent.click(screen.getAllByLabelText('Exercise options')[0]) // A's own ⋯
    fireEvent.click(screen.getByText('Skip the rest of this exercise'))
    await act(async () => {
      fireEvent.click(screen.getByText('SKIP 4 SETS'))
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(skipped.length).toBe(4)) // A's own 4 planned sets, none of B's
    expect(skipped).toEqual([1, 2, 3, 4].map((setNumber) => ({ exerciseId: 'ex-pe-a', setNumber })))
  })

  it('Add a set: in the shorter member\'s ⋯ (B, 3 sets) it extends the rounds — round 4 now has both members — and no member has an ADD SET button of its own', () => {
    const { container } = renderBlock(members())
    expect(rowLabels(container)).not.toContain('B4')
    expect(screen.queryAllByText('ADD SET')).toHaveLength(0)
    fireEvent.click(screen.getAllByLabelText('Exercise options')[1]) // B's own ⋯ (B has 3 planned, A has 4)
    fireEvent.click(screen.getByText('Add a set'))
    const round4 = [...container.querySelectorAll('p')].find((p) => p.textContent === 'ROUND 4')!.parentElement!
    expect(rowLabels(round4 as HTMLElement)).toEqual(['A4', 'B4'])
    // that member's sets only: A has the four it had (no round 5, and no fifth set of A), B has its fourth
    expect([...container.querySelectorAll('p')].some((p) => p.textContent === 'ROUND 5')).toBe(false)
    expect(rowLabels(container).filter((l) => l?.startsWith('A'))).toEqual(['A1', 'A2', 'A3', 'A4'])
    expect(rowLabels(container).filter((l) => l?.startsWith('B'))).toEqual(['B1', 'B2', 'B3', 'B4'])
  })
})

describe('SupersetBlock — DELETE SET (chunk 61, board W7b\'s member names)', () => {
  it('a member\'s open set: its ⋯ asks W9 in the block, naming the member and the round, and DELETE SET writes that planned set\'s `deleted` change row', async () => {
    const writers = spyWriters()
    const { container } = renderBlock(members(), { writers })
    const second = container.querySelectorAll('[data-row-key]')[1] as HTMLElement // B1: the second row of the zigzag
    expect(second.getAttribute('data-row-key')).toBe('set:pe-b-set-1')
    fireEvent.click(within(second).getByLabelText('Set options'))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('DELETE SET'))
    const confirm = screen.getByRole('alertdialog')
    expect(confirm.textContent).toContain('BARBELL ROW · B1')
    expect(writers.writeChanges).not.toHaveBeenCalled() // asked first
    await act(async () => {
      fireEvent.click(within(confirm).getByText('DELETE SET'))
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    expect(writers.writeChanges).toHaveBeenCalledWith([{ change: { kind: 'deleted', weekPlanSetId: 'pe-b-set-1' }, id: null }])
  })
})

describe('SupersetBlock — + ADD ROUND (SPEC Defaults 9, board W1)', () => {
  it('adds one set to every member: A 4 and B 3 sets become 5 and 4', () => {
    const { container } = renderBlock(members())
    fireEvent.click(screen.getByText('ADD ROUND'))
    expect(rowLabels(container)).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4', 'B4', 'A5'])
  })

  it('each new set gets its own place, once, per member: a second round is place 2, and LOG writes it (a planned set writes none)', () => {
    const calls: Record<string, unknown>[] = []
    const logsNow: SetLog[] = []
    const { container, setLogs } = renderBlock(members(), {
      onLog: (params) => {
        calls.push(params as unknown as Record<string, unknown>)
        const log = makeSetLog({ id: (params.id as string | undefined) ?? 'planned', exerciseId: params.exerciseId, weekPlanSetId: params.weekPlanSetId, addedPlace: params.addedPlace ?? null, weight: params.weight, reps: params.reps, setNumber: params.setNumber })
        logsNow.push(log)
        return Promise.resolve(log)
      },
    })
    fireEvent.click(screen.getByText('ADD ROUND'))
    fireEvent.click(screen.getByText('ADD ROUND'))
    // log the three planned B sets and four planned A sets, in order, then the added sets
    const logCurrent = (weight: string, reps: string) => {
      const current = container.querySelector('[data-current-set]') as HTMLElement
      fireEvent.change(within(current).getByLabelText('Weight'), { target: { value: weight } })
      fireEvent.change(within(current).getByLabelText('Reps'), { target: { value: reps } })
      fireEvent.click(within(current).getByText('LOG'))
      setLogs([...logsNow])
    }
    for (let i = 0; i < 7; i++) logCurrent('50', '10') // the planned sets: A1 B1 A2 B2 A3 B3 A4
    expect(calls.slice(0, 7).every((c) => !('addedPlace' in c) && !('id' in c))).toBe(true)
    for (let i = 0; i < 4; i++) logCurrent('50', '10') // A5? no: B4, A5, B5, A6 in the order of the rounds
    const added = calls.slice(7)
    expect(added.map((c) => [c.exerciseId, c.addedPlace])).toEqual([
      ['ex-pe-b', 1],
      ['ex-pe-a', 1],
      ['ex-pe-b', 2],
      ['ex-pe-a', 2],
    ])
    expect(added.every((c) => typeof c.id === 'string')).toBe(true)
  })
})

// Tests owed since 58a's review (DECISIONS "Tests owed", X6): every test above holds the cards' lists of added sets from the first
// ADD ROUND. After a reload, a reopened session or on another phone the lists are empty and only the logs say which places are taken.
describe('SupersetBlock — + ADD ROUND after a reload takes the places the logs hold (X6)', () => {
  it('with an added round already logged (place 1) and the cards\' lists empty, + ADD ROUND gives each member place 2, and LOG writes it', () => {
    const calls: Record<string, unknown>[] = []
    const logsNow: SetLog[] = []
    const logged = [
      ...Array.from({ length: 4 }, (_, i) => makeSetLog({ id: `a-${i + 1}`, exerciseId: 'ex-pe-a', weekPlanSetId: `pe-a-set-${i + 1}`, setNumber: i + 1, weight: 50, reps: 10 })),
      ...Array.from({ length: 3 }, (_, i) => makeSetLog({ id: `b-${i + 1}`, exerciseId: 'ex-pe-b', weekPlanSetId: `pe-b-set-${i + 1}`, setNumber: i + 1, weight: 50, reps: 10 })),
      makeSetLog({ id: 'b-added', exerciseId: 'ex-pe-b', weekPlanSetId: null, setNumber: 4, addedPlace: 1, weight: 50, reps: 10 }), // the earlier round's
      makeSetLog({ id: 'a-added', exerciseId: 'ex-pe-a', weekPlanSetId: null, setNumber: 5, addedPlace: 1, weight: 50, reps: 10 }),
    ]
    logsNow.push(...logged)
    const { container, setLogs } = renderBlock(
      members(),
      {
        onLog: (params) => {
          calls.push(params as unknown as Record<string, unknown>)
          const log = makeSetLog({ id: (params.id as string | undefined) ?? 'planned', exerciseId: params.exerciseId, weekPlanSetId: params.weekPlanSetId, addedPlace: params.addedPlace ?? null, weight: params.weight, reps: params.reps, setNumber: params.setNumber })
          logsNow.push(log)
          return Promise.resolve(log)
        },
      },
      logged,
    )
    expect(container.querySelector('[data-current-set]')).toBeNull() // nothing open: every set is logged
    fireEvent.click(screen.getByText('ADD ROUND'))
    for (let i = 0; i < 2; i++) {
      const current = container.querySelector('[data-current-set]') as HTMLElement
      fireEvent.change(within(current).getByLabelText('Weight'), { target: { value: '50' } })
      fireEvent.change(within(current).getByLabelText('Reps'), { target: { value: '10' } })
      fireEvent.click(within(current).getByText('LOG'))
      setLogs([...logsNow])
    }
    expect(calls.map((c) => [c.exerciseId, c.addedPlace])).toEqual([
      ['ex-pe-b', 2],
      ['ex-pe-a', 2],
    ])
  })
})

describe('SupersetBlock — a staged set rides with its head inside a round (chunk 14)', () => {
  it('a planned rest-pause set (head + 2 stages) renders every row under its round, is locked until its head is logged, carries weight stage to stage, and writes stage_kind "as planned"', () => {
    const peA = makeExercise('pe-a', 'Bench Press')
    const peB = makeExercise('pe-b', 'Barbell Row')
    const stagedHead: WeekPlanSet = {
      id: 'pe-a-head', weekPlanId: 'wp-1', userId: 'u1', programExerciseId: peA.id, setNumber: 1, targetRir: 2, isDropset: false,
      parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, stageKind: 'rest_pause',
    }
    const stage = (n: number): WeekPlanSet => ({
      id: `pe-a-stage-${n}`, weekPlanId: 'wp-1', userId: 'u1', programExerciseId: peA.id, setNumber: 1, targetRir: 0, isDropset: true,
      parentWeekPlanSetId: 'pe-a-head', stageIndex: n, isWarmup: false,
    })
    const ms: SupersetMember[] = [
      { cardKey: peA.id, programExercise: peA, plannedSets: [stagedHead, stage(1), stage(2)], referenceSessions: [] },
      { cardKey: peB.id, programExercise: peB, plannedSets: plannedHeads(peB.id, 1), referenceSessions: [] },
    ]
    const onLog = vi.fn((params: Parameters<NonNullable<BlockProps['onLog']>>[0]) => Promise.resolve(makeSetLog({ ...params, id: 'real-head-id' })))
    const { container, setLogs } = renderBlock(ms, { onLog })

    // round 1: the head, its two locked stages (board W3), then B1
    expect(rowLabels(container)).toEqual(['A1', '↳', '↳', 'B1'])
    expect(container.textContent).toContain('REST-PAUSE · 2 STAGES')
    expect(container.textContent).toContain('AFTER SET 01')
    expect(container.textContent).toContain('AFTER STAGE 1')

    const current = container.querySelector('[data-current-set]') as HTMLElement
    fireEvent.change(within(current).getByLabelText('Weight'), { target: { value: '100' } })
    fireEvent.change(within(current).getByLabelText('Reps'), { target: { value: '10' } })
    fireEvent.click(within(current).getByText('LOG'))
    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onLog.mock.calls[0][0]).toMatchObject({ weekPlanSetId: 'pe-a-head', stageKind: 'rest_pause' })

    setLogs([makeSetLog({ id: 'real-head-id', weekPlanSetId: 'pe-a-head', weight: 100, reps: 10, stageKind: 'rest_pause' })])
    // the first stage opens by itself (C8) and starts from the head's weight: rest-pause carries the weight over
    const stageRow = container.querySelector('[data-current-set]') as HTMLElement
    expect(labelOf(stageRow)).toBe('↳')
    expect((within(stageRow).getByLabelText('Weight') as HTMLInputElement).value).toBe('100')
  })
})
