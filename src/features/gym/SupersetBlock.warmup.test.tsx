// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SupersetBlock, { type SupersetMember } from './SupersetBlock'
import { useWorkoutRows } from './useWorkoutRows'
import { useRestTimerStore } from './restTimerStore'
import type { ProgramExercise, WeekPlanSet, SetLog } from '../../types'
import type { LogRequest } from './useExerciseCardState'

// Chunk 15's review fix, as chunk 58a's rows draw it: a superset member's own planned warmup is a real, loggable row ("W", board W1),
// drawn with the member above the rounds and never inside one (a warmup takes no part in the rounds or the current set: G54).

afterEach(() => {
  cleanup()
  useRestTimerStore.getState().stop()
})

vi.mock('./useSession', () => ({ useLastSessionLogs: () => ({ data: [], isLoading: false }) }))

function makeExercise(id: string, name: string): ProgramExercise {
  return {
    id, workoutDayId: 'wd-1', userId: 'u1', exerciseId: `ex-${id}`, position: 0, weightUnit: null, supersetBlockId: 'block-1',
    exercise: {
      id: `ex-${id}`, userId: 'u1', name, muscleGroup: 'chest', isArchived: false, createdAt: '2026-01-01T00:00:00Z',
      muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
    },
  }
}

const plannedHeads = (programExerciseId: string, count: number): WeekPlanSet[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${programExerciseId}-set-${i + 1}`, weekPlanId: 'wp-1', userId: 'u1', programExerciseId, setNumber: i + 1, targetRir: 2,
    isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
  }))

const plannedWarmup = (programExerciseId: string): WeekPlanSet => ({
  id: `${programExerciseId}-warmup-1`, weekPlanId: 'wp-1', userId: 'u1', programExerciseId, setNumber: 1, targetRir: null,
  isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: true,
})

function membersWithWarmupOnA(): SupersetMember[] {
  const peA = makeExercise('pe-a', 'Bench Press')
  const peB = makeExercise('pe-b', 'Barbell Row')
  return [
    { cardKey: peA.id, programExercise: peA, plannedSets: [plannedWarmup(peA.id), ...plannedHeads(peA.id, 4)], referenceSessions: [] },
    { cardKey: peB.id, programExercise: peB, plannedSets: plannedHeads(peB.id, 3), referenceSessions: [] },
  ]
}

function Harness({ ms, onLog }: { ms: SupersetMember[]; onLog: (params: LogRequest) => Promise<SetLog> }) {
  const logs: SetLog[] = []
  const workout = useWorkoutRows({
    cards: ms.map((m) => ({ key: m.cardKey, programExercise: m.programExercise, plannedSets: m.plannedSets })),
    blocks: [{ id: 'block-1', members: ms.map((m) => m.cardKey) }],
    logs,
  })
  return (
    <MemoryRouter>
      <SupersetBlock
        blockId="block-1" letter="A" members={ms} workout={workout} logs={logs} sessionId="session-1" referenceLoading={false}
        referenceMesocycleId={null} referenceIsError={false} referenceIsFromCache={false} onRetryReference={() => {}} today="2026-01-05"
        onLog={onLog} onUpdateSet={() => {}} onDeleteSet={async () => {}} onSwap={async () => {}}
      />
    </MemoryRouter>
  )
}

const renderBlock = (ms: SupersetMember[], onLog: (params: LogRequest) => Promise<SetLog> = () => Promise.resolve({} as SetLog)) => render(<Harness ms={ms} onLog={onLog} />)
const labelOf = (row: Element) => row.querySelector('span')?.textContent
const rowLabels = (c: Element) => Array.from(c.querySelectorAll('[data-row-key]')).map(labelOf)

describe('SupersetBlock — a member\'s planned warmup renders and logs (review fix)', () => {
  it('shows member A\'s warmup row ("W"), above the rounds', () => {
    const { container } = renderBlock(membersWithWarmupOnA())
    expect(rowLabels(container)).toEqual(['W', 'A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4'])
    const headings = [...container.querySelectorAll('p')].filter((p) => /^ROUND \d$/.test(p.textContent ?? ''))
    // the warmup row comes before the first ROUND header in the document
    const warmup = container.querySelector('[data-row-key$="warmup-1"]')!
    expect(warmup.compareDocumentPosition(headings[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('logging the warmup calls onLog with is_warmup: true, for exercise A, as warmup number 1', async () => {
    const onLog = vi.fn().mockResolvedValue({} as SetLog)
    renderBlock(membersWithWarmupOnA(), onLog)
    fireEvent.click(screen.getAllByRole('button', { name: 'LOG' })[0])
    await Promise.resolve()
    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onLog.mock.calls[0][0]).toMatchObject({ isWarmup: true, exerciseId: 'ex-pe-a', setNumber: 1, weekPlanSetId: 'pe-a-warmup-1' })
  })

  it('the round grid is unchanged: still exactly 4 ROUND headers, round 4 has one row (A only)', () => {
    const { container } = renderBlock(membersWithWarmupOnA())
    const headers = [...container.querySelectorAll('p')].filter((p) => /^ROUND \d$/.test(p.textContent ?? '')).map((p) => p.textContent)
    expect(headers).toEqual(['ROUND 1', 'ROUND 2', 'ROUND 3', 'ROUND 4'])
    const round4 = [...container.querySelectorAll('p')].find((p) => p.textContent === 'ROUND 4')!.parentElement!
    expect(rowLabels(round4)).toEqual(['A4'])
  })

  it('the warmup is never the current set and never inside a round', () => {
    const { container } = renderBlock(membersWithWarmupOnA())
    expect(container.querySelectorAll('[data-current-set]')).toHaveLength(1)
    expect(labelOf(container.querySelector('[data-current-set]')!)).toBe('A1')
    for (const header of [...container.querySelectorAll('p')].filter((p) => /^ROUND \d$/.test(p.textContent ?? ''))) {
      expect(rowLabels(header.parentElement!)).not.toContain('W')
    }
  })

  it('a member with no planned warmup has no "W" row at all', () => {
    const peA = makeExercise('pe-a', 'Bench Press')
    const peB = makeExercise('pe-b', 'Barbell Row')
    const { container } = renderBlock([
      { cardKey: peA.id, programExercise: peA, plannedSets: plannedHeads(peA.id, 4), referenceSessions: [] },
      { cardKey: peB.id, programExercise: peB, plannedSets: plannedHeads(peB.id, 3), referenceSessions: [] },
    ])
    expect(rowLabels(container)).not.toContain('W')
  })
})
