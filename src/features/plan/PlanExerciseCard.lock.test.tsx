// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { Exercise, ProgramExercise, WeekPlanSet } from '../../types'

// TASKS-1.2 chunk 54a: a card that is locked (a past week, a session that is done, a workout with no plan row) has no picker and no sheet open.
// One that turns locked with a picker open closes it in that very render (PlanPage.sequenceCycle.test.tsx proves the same through the page, for a
// cycle that gets done), and the picker does not come back when the card is writable again (a done session can be reopened).
//
// The card is rendered on its own. The set type sheet reads the exercise's program sets and writes through the week hooks, none of which these
// tests reach until a sheet is open, and the one that is opened here (the set type picker) is given stand-ins.

vi.mock('./useWeekPlan', () => ({ useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }) }))
vi.mock('../planner/usePlanner', () => ({
  useProgramSets: () => ({ data: [] }),
  useUpdateProgramSetRest: () => ({ mutate: vi.fn() }),
  useUpdateProgramSetStageRest: () => ({ mutate: vi.fn() }),
}))

const { default: PlanExerciseCard } = await import('./PlanExerciseCard')
type CardProps = ComponentProps<typeof PlanExerciseCard>

afterEach(() => cleanup())

const EX: Exercise = {
  id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '',
  muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
const PE: ProgramExercise = { id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null, exercise: EX }
const SET: WeekPlanSet = {
  id: 's1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 2, isDropset: false,
  parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null,
}

function card(over: Partial<CardProps> = {}) {
  return (
    <PlanExerciseCard
      pe={PE}
      sets={[SET]}
      superset={null}
      readOnly={false}
      canWrite
      mesoId="meso-1"
      weekNumber={2}
      isCycle={false}
      planningType="week_dependent"
      runCues={[]}
      addDisabled={false}
      adding={false}
      onAddSet={() => {}}
      onUpdate={() => {}}
      onRemoveRow={() => {}}
      {...over}
    />
  )
}

const dialog = () => screen.queryByRole('dialog')
const openers: Record<string, () => void> = {
  'the rep target picker': () => fireEvent.click(screen.getByRole('button', { name: 'Set rep target' })),
  'the RIR target picker': () => fireEvent.click(screen.getByRole('button', { name: 'RIR 2' })),
  'the set type picker': () => fireEvent.click(screen.getByLabelText('Options for set 1')),
}

describe('PlanExerciseCard — a card that turns read-only closes what it had open', () => {
  for (const [name, open] of Object.entries(openers)) {
    it(`${name} goes when the card turns read-only, and stays gone when it is writable again`, () => {
      const view = render(card())
      open()
      expect(dialog()).toBeTruthy()

      view.rerender(card({ readOnly: true }))
      expect(dialog()).toBeNull()

      view.rerender(card({ readOnly: false }))
      expect(dialog()).toBeNull()
    })
  }

  it('the same when the card loses its plan row (nothing can be written for it any more)', () => {
    const view = render(card())
    openers['the rep target picker']()
    expect(dialog()).toBeTruthy()

    view.rerender(card({ canWrite: false }))
    expect(dialog()).toBeNull()
    expect(screen.queryByLabelText('Add set to Bench Press')).toBeNull()
  })

  it('control: a card that stays writable keeps its picker open through a render', () => {
    const view = render(card())
    openers['the rep target picker']()

    view.rerender(card({ adding: true }))

    expect(dialog()).toBeTruthy()
  })
})
