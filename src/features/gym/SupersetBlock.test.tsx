// @vitest-environment jsdom
//
// Chunk 13 — the superset render test, plus the review fix's own proofs:
// every member of a block keeps ExerciseCard's full per-exercise behaviour
// (prefill, swap, skip-whole-exercise, ADD SET), not a thinned-down one.
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { render, cleanup, within, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SupersetBlock, { type SupersetMember } from './SupersetBlock'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import type { ProgramExercise, WeekPlanSet, SetLog, Exercise } from '../../types'

afterEach(() => {
  cleanup()
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
})

// Per-exercise previous-session logs, keyed by exerciseId — the mock below
// reads this so each member can have its OWN lastLogs (prefill is per
// exercise, same as a plain ExerciseCard).
let lastLogsByExerciseId: Record<string, SetLog[]> = {}

vi.mock('./useSession', () => ({
  useLastSessionLogs: (exerciseId: string) => ({ data: lastLogsByExerciseId[exerciseId] ?? [], isLoading: false }),
}))

// A lightweight, functional double — real enough to prove onConfirm/onClose
// wiring without pulling in the real sheet's own library/exercise-creation
// hooks (same "stub the sheet, not the behaviour it triggers" precedent
// GymSession.d30.test.tsx uses, except this one stays interactive).
const REPLACEMENT: Exercise = {
  id: 'ex-replacement', userId: 'u1', name: 'Incline Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
vi.mock('./SwapExerciseSheet', () => ({
  default: ({ currentExerciseName, onConfirm, onClose }: { currentExerciseName?: string; onConfirm: (ex: Exercise) => void; onClose: () => void }) => (
    <div>
      <p>SWAP SHEET FOR {currentExerciseName}</p>
      <button onClick={() => onConfirm(REPLACEMENT)}>CONFIRM PICK</button>
      <button onClick={onClose}>close sheet</button>
    </div>
  ),
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

describe('SupersetBlock — rounds (SPEC "Supersets")', () => {
  it('shows "SUPERSET · 2 EXERCISES" and both exercise names', () => {
    const { container } = renderBlock(members())
    expect(container.textContent).toContain('SUPERSET')
    expect(container.textContent).toContain('2 EXERCISES')
    expect(container.textContent).toContain('Bench Press')
    expect(container.textContent).toContain('Barbell Row')
  })

  it('4 sets of A, 3 of B → exactly 4 ROUND headers, round 4 has one row (A only)', () => {
    const { container } = renderBlock(members())
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

  it('the zigzag order (A1 → B1 → A2 → B2 → …) is the DOM order of unlogged rows', () => {
    const { container } = renderBlock(members())
    const unloggedRows = [...container.querySelectorAll('[data-unlogged-set]')]
    const labels = unloggedRows.map((row) => {
      const cell = row.parentElement!.parentElement!
      const label = cell.querySelector('p')!
      return label.textContent!.startsWith('A ·') ? 'A' : 'B'
    })
    expect(labels).toEqual(['A', 'B', 'A', 'B', 'A', 'B', 'A'])
  })

  it('logging the first (A1) row calls onLog with A\'s exerciseId and setNumber 1', () => {
    const calls: unknown[] = []
    const { container } = renderBlock(members(), {
      onLog: (params) => { calls.push(params); return Promise.resolve({ id: 'log-1' } as SetLog) },
    })

    const firstUnlogged = container.querySelector('[data-unlogged-set]') as HTMLElement
    fireEvent.change(within(firstUnlogged).getAllByRole('textbox')[0], { target: { value: '100' } })
    fireEvent.change(within(firstUnlogged).getByRole('spinbutton'), { target: { value: '8' } })
    fireEvent.click(within(firstUnlogged).getByText('LOG'))

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ exerciseId: 'ex-pe-a', setNumber: 1, weight: 100, reps: 8 })
  })
})

describe('SupersetBlock — review fix: full per-exercise behaviour inside a block', () => {
  it('prefill: a member\'s own last-session log fills its input, independent of the other member', () => {
    lastLogsByExerciseId = {
      'ex-pe-a': [{
        id: 'last-a1', userId: 'u1', sessionId: 'prev', exerciseId: 'ex-pe-a', weekPlanSetId: null,
        setNumber: 1, weight: 62.5, reps: 9, rir: 2, note: null, isDropset: false, parentSetId: null,
        stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false,
        loggedAt: '2026-01-01T00:00:00Z', restSeconds: null, formRating: null,
      }],
    }
    const { container } = renderBlock(members())
    const firstUnlogged = container.querySelector('[data-unlogged-set]') as HTMLElement
    const weightInput = within(firstUnlogged).getAllByRole('textbox')[0] as HTMLInputElement
    expect(weightInput.value).toBe('62.5')
    const repsInput = within(firstUnlogged).getByRole('spinbutton') as HTMLInputElement
    expect(repsInput.value).toBe('9')
  })

  it('swap: tapping SWAP on a member opens its own sheet; confirming calls onSwap with that member\'s programExercise', async () => {
    const swapCalls: unknown[] = []
    renderBlock(members(), { onSwap: (ex, pe) => swapCalls.push({ ex, pe }) })

    // Two swap triggers, one per member (ExerciseHeader's own history/swap
    // icon row) — open the SECOND member's (Barbell Row's) sheet.
    const swapButtons = screen.getAllByLabelText('Swap exercise for this session')
    expect(swapButtons).toHaveLength(2)
    fireEvent.click(swapButtons[1])

    expect(screen.getByText('SWAP SHEET FOR Barbell Row')).toBeTruthy()
    fireEvent.click(screen.getByText('CONFIRM PICK'))

    await vi.waitFor(() => expect(swapCalls).toHaveLength(1))
    expect(swapCalls[0]).toMatchObject({ ex: REPLACEMENT, pe: { id: 'pe-b', exerciseId: 'ex-pe-b' } })
  })

  it('skip: skipping one member marks only ITS remaining planned sets, not the other member\'s', async () => {
    const skipped: { exerciseId: string }[] = []
    renderBlock(members(), {
      onLog: (params) => {
        if (params.isSkipped) skipped.push({ exerciseId: params.exerciseId })
        return Promise.resolve({ id: `log-${skipped.length}` } as SetLog)
      },
    })

    const skipButtons = screen.getAllByText('SKIP REST OF EXERCISE')
    expect(skipButtons).toHaveLength(2) // one per member, both fully unlogged
    fireEvent.click(skipButtons[0]) // A's own SKIP REST OF EXERCISE
    fireEvent.click(screen.getByText('CONFIRM SKIP'))

    await vi.waitFor(() => expect(skipped.length).toBe(4)) // A's own 4 planned sets, none of B's
    expect(skipped.every((s) => s.exerciseId === 'ex-pe-a')).toBe(true)
  })

  it('ADD SET: adding a set to the shorter member (B, 3 sets) extends its rounds — round 4 now has both members', () => {
    const { container, rerender } = renderBlock(members())
    expect((container.textContent ?? '')).not.toContain('ROUND 5')

    const addSetButtons = screen.getAllByText('ADD SET')
    expect(addSetButtons).toHaveLength(2)
    fireEvent.click(addSetButtons[1]) // B's own ADD SET (B has 3 planned, A has 4)

    rerender(
      <MemoryRouter>
        <SupersetBlock
          members={members()}
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
        />
      </MemoryRouter>,
    )

    // Round 4 (previously A-only) now also has B's new extra slot.
    const headers = [...container.querySelectorAll('p')].filter((p) => p.textContent === 'ROUND 4')
    const roundSection = headers[0].parentElement!
    const cellLabels = [...roundSection.querySelectorAll('p')].filter((p) => /^[A-Z] · /.test(p.textContent ?? ''))
    expect(cellLabels.map((p) => p.textContent?.[0])).toEqual(['A', 'B'])
  })
})
