// @vitest-environment jsdom
//
// Review fix (reviewer, chunk 15) — "a superset member must keep everything
// a single card has": member A's planned warmup must still render and log
// inside a superset block, exactly like ExerciseCard's own WARMUP section,
// and must never enter the round grid. Same mocking/render precedent as
// SupersetBlock.test.tsx.
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SupersetBlock, { type SupersetMember } from './SupersetBlock'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import type { ProgramExercise, WeekPlanSet, SetLog } from '../../types'

afterEach(() => {
  cleanup()
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
})

let lastLogsByExerciseId: Record<string, SetLog[]> = {}
vi.mock('./useSession', () => ({
  useLastSessionLogs: (exerciseId: string) => ({ data: lastLogsByExerciseId[exerciseId] ?? [], isLoading: false }),
}))

function makeExercise(id: string, name: string): ProgramExercise {
  return {
    id,
    workoutDayId: 'wd-1',
    userId: 'u1',
    exerciseId: `ex-${id}`,
    position: 0,
    weightUnit: null,
    supersetBlockId: 'block-1',
    exercise: {
      id: `ex-${id}`, userId: 'u1', name, muscleGroup: 'chest', isArchived: false,
      createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
      status: 'active', sourceLibraryId: null, lostAt: null,
    },
  }
}

function plannedHeads(programExerciseId: string, count: number): WeekPlanSet[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${programExerciseId}-set-${i + 1}`,
    weekPlanId: 'wp-1', userId: 'u1', programExerciseId,
    setNumber: i + 1, targetRir: 2, isDropset: false,
    parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
  }))
}

function plannedWarmup(programExerciseId: string): WeekPlanSet {
  return {
    id: `${programExerciseId}-warmup-1`,
    weekPlanId: 'wp-1', userId: 'u1', programExerciseId,
    setNumber: 1, targetRir: null, isDropset: false,
    parentWeekPlanSetId: null, stageIndex: 0, isWarmup: true,
  }
}

// Same 4-sets-of-A/3-sets-of-B fixture as SupersetBlock.test.tsx's own
// round test, with ONE planned warmup added to A only — proving the round
// grid (4 rounds, round 4 has one row — A only) is exactly unchanged.
function membersWithWarmupOnA(): SupersetMember[] {
  const peA = makeExercise('pe-a', 'Bench Press')
  const peB = makeExercise('pe-b', 'Barbell Row')
  return [
    {
      programExercise: peA,
      plannedSets: [plannedWarmup(peA.id), ...plannedHeads(peA.id, 4)],
      currentLogs: [],
      referenceSessions: [],
    },
    { programExercise: peB, plannedSets: plannedHeads(peB.id, 3), currentLogs: [], referenceSessions: [] },
  ]
}

function renderBlock(
  ms: SupersetMember[],
  overrides: Partial<ComponentProps<typeof SupersetBlock>> = {},
) {
  return render(
    <MemoryRouter>
      <SupersetBlock
        members={ms}
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
        onSwap={() => {}}
        {...overrides}
      />
    </MemoryRouter>,
  )
}

afterEach(() => {
  lastLogsByExerciseId = {}
})

describe('SupersetBlock — a member\'s planned warmup renders and logs (review fix)', () => {
  it('shows a WARMUP section for member A, above the rounds', () => {
    const { container } = renderBlock(membersWithWarmupOnA())
    expect(container.textContent).toContain('WARMUP')

    // The WARMUP heading appears before the first ROUND heading in DOM
    // order — "above the rounds", not inside the round grid.
    const headings = [...container.querySelectorAll('p')].filter(
      (p) => p.textContent === 'WARMUP' || p.textContent === 'ROUND 1',
    )
    expect(headings.map((p) => p.textContent)).toEqual(['WARMUP', 'ROUND 1'])
  })

  it('logging the warmup calls onLog with is_warmup: true, for exercise A', async () => {
    const onLog = vi.fn().mockResolvedValue({} as SetLog)
    renderBlock(membersWithWarmupOnA(), { onLog })

    // The warmup row's own LOG button is first in DOM order (its section
    // renders above the rounds) — every round cell's own working-set LOG
    // button comes after it.
    fireEvent.click(screen.getAllByRole('button', { name: 'LOG' })[0])
    await Promise.resolve()

    expect(onLog).toHaveBeenCalledTimes(1)
    const payload = onLog.mock.calls[0][0]
    expect(payload.isWarmup).toBe(true)
    expect(payload.exerciseId).toBe('ex-pe-a')
  })

  it('the round grid is unchanged: still exactly 4 ROUND headers, round 4 has one row (A only)', () => {
    const { container } = renderBlock(membersWithWarmupOnA())
    const text = container.textContent ?? ''
    for (const n of [1, 2, 3, 4]) expect(text).toContain(`ROUND ${n}`)
    expect(text).not.toContain('ROUND 5')

    const headers = [...container.querySelectorAll('p')].filter((p) => p.textContent === 'ROUND 4')
    expect(headers).toHaveLength(1)
    const roundSection = headers[0].parentElement!
    const cellLabels = [...roundSection.querySelectorAll('p')].filter((p) => /^[A-Z] · /.test(p.textContent ?? ''))
    expect(cellLabels).toHaveLength(1)
    expect(cellLabels[0].textContent).toContain('BENCH PRESS')
  })

  it('the warmup row never appears inside the round grid (no [data-unlogged-set] marker on it)', () => {
    const { container } = renderBlock(membersWithWarmupOnA())
    // Every [data-unlogged-set] row belongs to a round cell — the warmup
    // row (SetRow's isWarmup branch) never sets that attribute at all.
    const unloggedRows = [...container.querySelectorAll('[data-unlogged-set]')]
    expect(unloggedRows).toHaveLength(7) // 4 (A) + 3 (B), same as the no-warmup baseline
  })

  it('a member with no planned warmup shows no WARMUP section at all', () => {
    const peA = makeExercise('pe-a', 'Bench Press')
    const peB = makeExercise('pe-b', 'Barbell Row')
    const ms: SupersetMember[] = [
      { programExercise: peA, plannedSets: plannedHeads(peA.id, 4), currentLogs: [], referenceSessions: [] },
      { programExercise: peB, plannedSets: plannedHeads(peB.id, 3), currentLogs: [], referenceSessions: [] },
    ]
    const { container } = renderBlock(ms)
    expect(container.textContent).not.toContain('WARMUP')
  })
})
