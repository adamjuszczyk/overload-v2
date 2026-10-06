// @vitest-environment jsdom
//
// Chunk 13 — the superset render test (separate from, and never touching,
// D30's plain-session fixture). SPEC "Supersets": "Shown as a block of
// rounds... Unequal set counts are allowed... 4 sets of A, 3 of B → 4
// rounds, round 4 has only A... The current set zigzags through rounds:
// A1 → B1 → A2 → B2 …" — TASKS.md chunk 13's own verification line: "block
// shows 4 rounds, round 4 has one row, the current-set button visits A1,
// B1, A2, …".
import { describe, it, expect, afterEach } from 'vitest'
import type { ComponentProps } from 'react'
import { render, cleanup, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SupersetBlock, { type SupersetMember } from './SupersetBlock'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import type { ProgramExercise, WeekPlanSet, SetLog } from '../../types'

afterEach(() => {
  cleanup()
  // Module-global zustand stores (same reset precedent as SetGroup.test.tsx).
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
})

function makeExercise(id: string, name: string): ProgramExercise {
  return {
    id,
    workoutDayId: 'wd-1',
    userId: 'u1',
    exerciseId: `ex-${id}`,
    exercise: {
      id: `ex-${id}`,
      userId: 'u1',
      name,
      muscleGroup: 'chest',
      isArchived: false,
      createdAt: '2026-01-01T00:00:00Z',
      muscleSubgroups: null,
      movementPattern: null,
      status: 'active',
      sourceLibraryId: null,
      lostAt: null,
    },
    position: 0,
    weightUnit: null,
    supersetBlockId: 'block-1',
  }
}

function plannedHeads(programExerciseId: string, count: number): WeekPlanSet[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${programExerciseId}-set-${i + 1}`,
    weekPlanId: 'wp-1',
    userId: 'u1',
    programExerciseId,
    setNumber: i + 1,
    targetRir: 2,
    isDropset: false,
    parentWeekPlanSetId: null,
    stageIndex: 0,
    isWarmup: false,
  }))
}

// 4 sets of A ("Bench Press"), 3 of B ("Barbell Row") — the exact TASKS.md
// example.
function members(): SupersetMember[] {
  const peA = makeExercise('pe-a', 'Bench Press')
  const peB = makeExercise('pe-b', 'Barbell Row')
  return [
    { programExercise: peA, plannedSets: plannedHeads(peA.id, 4), currentLogs: [], referenceSessions: [] },
    { programExercise: peB, plannedSets: plannedHeads(peB.id, 3), currentLogs: [], referenceSessions: [] },
  ]
}

function renderBlock(
  ms: SupersetMember[],
  onLog: ComponentProps<typeof SupersetBlock>['onLog'] = () => Promise.resolve({} as SetLog),
) {
  return render(
    <MemoryRouter>
      <SupersetBlock
        members={ms}
        referenceLoading={false}
        referenceMesocycleId={null}
        referenceIsError={false}
        referenceIsFromCache={false}
        onRetryReference={() => {}}
        today="2026-01-05"
        onLog={onLog}
        onUpdateSet={() => {}}
        onDeleteSet={async () => {}}
      />
    </MemoryRouter>,
  )
}

describe('SupersetBlock — rounds (SPEC "Supersets")', () => {
  it('shows "SUPERSET · 2 EXERCISES" and both exercise names', () => {
    const { container } = renderBlock(members())
    expect(container.textContent).toContain('SUPERSET')
    expect(container.textContent).toContain('2 EXERCISES')
    expect(container.textContent).toContain('Bench Press')
    expect(container.textContent).toContain('Barbell Row')
  })

  it('4 sets of A, 3 of B → exactly 4 ROUND headers', () => {
    const { container } = renderBlock(members())
    const text = container.textContent ?? ''
    for (const n of [1, 2, 3, 4]) expect(text).toContain(`ROUND ${n}`)
    expect(text).not.toContain('ROUND 5')
  })

  it('round 4 has exactly one row (A only — B has no 4th set)', () => {
    const { container } = renderBlock(members())
    const headers = [...container.querySelectorAll('p')].filter((p) => p.textContent === 'ROUND 4')
    expect(headers).toHaveLength(1)
    // The round's own section is its header's next sibling (the cells wrapper).
    const roundSection = headers[0].parentElement!
    const cellLabels = [...roundSection.querySelectorAll('p')].filter((p) => /^[A-Z] · /.test(p.textContent ?? ''))
    expect(cellLabels).toHaveLength(1)
    expect(cellLabels[0].textContent).toContain('BENCH PRESS')
  })

  it('the zigzag order (A1 → B1 → A2 → B2 → …) is the DOM order of unlogged rows', () => {
    const { container } = renderBlock(members())
    const unloggedRows = [...container.querySelectorAll('[data-unlogged-set]')]
    // Every unlogged row's nearest preceding member-label sibling (rendered
    // just above the row by SupersetBlock, see its own per-cell markup)
    // names which exercise that row belongs to.
    const labels = unloggedRows.map((row) => {
      // row = SetRow's own div (data-unlogged-set) → its parent is
      // SetGroup's own wrapper div → ITS parent is SupersetBlock's per-cell
      // div, which also holds the "A · BENCH PRESS" label <p> as a sibling.
      const cell = row.parentElement!.parentElement!
      const label = cell.querySelector('p')!
      return label.textContent!.startsWith('A ·') ? 'A' : 'B'
    })
    expect(labels).toEqual(['A', 'B', 'A', 'B', 'A', 'B', 'A'])
  })
})

describe('SupersetBlock — logging a round cell', () => {
  it('logging the first (A1) row calls onLog with A\'s exerciseId and setNumber 1', async () => {
    const calls: unknown[] = []
    const { container } = renderBlock(members(), (params) => {
      calls.push(params)
      return Promise.resolve({ id: 'log-1' } as SetLog)
    })

    const firstUnlogged = container.querySelector('[data-unlogged-set]') as HTMLElement
    const weightInput = within(firstUnlogged).getAllByRole('textbox')[0]
    const repsInput = within(firstUnlogged).getByRole('spinbutton')
    fireEvent.change(weightInput, { target: { value: '100' } })
    fireEvent.change(repsInput, { target: { value: '8' } })
    fireEvent.click(within(firstUnlogged).getByText('LOG'))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ exerciseId: 'ex-pe-a', setNumber: 1, weight: 100, reps: 8 })
  })
})
