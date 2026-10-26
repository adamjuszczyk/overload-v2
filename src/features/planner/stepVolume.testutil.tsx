import type { ComponentType } from 'react'
import { expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import type { DayOfWeek, Program, ProgramExercise, WorkoutDay } from '../../types'

// The world chunk 67's step 3 tests share (TASKS-1.2 chunk 67; RULES: a fixture tells the right data source from the wrong one). Three workouts
// with a weekday each, and exercises whose sets repeat positions 1, 2, 3 ... across exercises and workouts, so a write that lands on the wrong
// exercise, the wrong set or the wrong workout can't pass. Each test file mocks, itself, what this one can't hoist: the supabase client (a
// stateful stand-in, fakeProgramSetsDb.testutil.ts), the signed-in user, and the program and exercise reads of ../programs/usePrograms.

export const EMPTY_SCHEDULE: Program['schedule'] = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }

export function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Bulk', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1', wednesday: 'wd-2', friday: 'wd-3' } as Record<DayOfWeek, string | null>,
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'saved', planningType: 'week_dependent',
    ...overrides,
  }
}

export function makeDay(id: string, name: string, position: number): WorkoutDay {
  return { id, programId: 'prog-1', userId: 'user-1', name, position, exercises: [] }
}

export function makeExercise(id: string, workoutDayId: string, name: string, position: number): ProgramExercise {
  return {
    id, workoutDayId, userId: 'user-1', exerciseId: `ex-${id}`, position, weightUnit: null,
    exercise: { id: `ex-${id}`, userId: 'user-1', name, muscleGroup: 'chest', isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
  }
}

export const FOUND = { timeout: 5000 }

/** The step inside the app's own query client (its hooks invalidate that singleton). */
export function renderStep(Step: ComponentType<{ program: Program; volumeReadOnly: boolean; canChangePlanningType: boolean }>, props: Partial<{ program: Program; volumeReadOnly: boolean; canChangePlanningType: boolean }> = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Step program={props.program ?? makeProgram()} volumeReadOnly={props.volumeReadOnly ?? false} canChangePlanningType={props.canChangePlanningType ?? true} />
    </QueryClientProvider>,
  )
}

/** Every write answered and every read done. */
export async function settled() {
  await waitFor(() => expect(queryClient.isMutating() + queryClient.isFetching()).toBe(0), FOUND)
}

/** Queries scoped to one exercise's block (`data-exercise`), so two exercises' "Set 01: type" never get mixed up. */
export const exercise = (programExerciseId: string) => within(document.querySelector(`[data-exercise="${programExerciseId}"]`) as HTMLElement)

export const dialog = (name: string) => within(screen.getByRole('dialog', { name }))
export const typeSheet = () => dialog('What is this set?')
export const repSheet = () => dialog('Rep target')
