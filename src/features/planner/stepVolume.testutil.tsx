import type { ComponentType } from 'react'
import { expect } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import type { DayOfWeek, Program, ProgramExercise, WorkoutDay } from '../../types'
import { fakeProgramSet, fakeProgramStage, type FakeProgramSetRow } from './fakeProgramSetsDb.testutil'

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

// ─── The world ──────────────────────────────────────────────────────────────────────────────────

export const INC = 'pe-incline'
export const DIPS = 'pe-dips'
export const FLY = 'pe-fly'
export const LAT = 'pe-lat'
export const ROW = 'pe-row'

/**
 * Push 1: Incline Dumbbell Press (01 a warmup at 12, 02 and 03 at 8–12, 04 at 8–12 with a rest after of 3 minutes and one drop), Dips (no sets), Pec Deck
 * Fly (three sets, all 10–12), Lateral Raise (four sets with no target). Pull 1: Barbell Row (three sets at 6–8). Legs: no exercises. Every exercise's sets
 * are at positions 1, 2, 3 ..., so a count, a row or a write that comes from or lands on the wrong exercise shows.
 */
export function world(): FakeProgramSetRow[] {
  return [
    fakeProgramSet('inc1', INC, 1, { is_warmup: true, rep_min: 12, rep_max: 12 }),
    fakeProgramSet('inc2', INC, 2, { rep_min: 8, rep_max: 12 }),
    fakeProgramSet('inc3', INC, 3, { rep_min: 8, rep_max: 12 }),
    fakeProgramSet('inc4', INC, 4, { rep_min: 8, rep_max: 12, rest_seconds: 180, stage_kind: 'dropset' }),
    fakeProgramStage('inc4s1', INC, 'inc4', 4, 1),
    fakeProgramSet('fly1', FLY, 1, { rep_min: 10, rep_max: 12 }),
    fakeProgramSet('fly2', FLY, 2, { rep_min: 10, rep_max: 12 }),
    fakeProgramSet('fly3', FLY, 3, { rep_min: 10, rep_max: 12 }),
    fakeProgramSet('lat1', LAT, 1),
    fakeProgramSet('lat2', LAT, 2),
    fakeProgramSet('lat3', LAT, 3),
    fakeProgramSet('lat4', LAT, 4),
    fakeProgramSet('row1', ROW, 1, { rep_min: 6, rep_max: 8 }),
    fakeProgramSet('row2', ROW, 2, { rep_min: 6, rep_max: 8 }),
    fakeProgramSet('row3', ROW, 3, { rep_min: 6, rep_max: 8 }),
  ]
}

export function worldWorkouts(): { workoutDays: WorkoutDay[]; exercisesByDay: Record<string, ProgramExercise[]> } {
  return {
    workoutDays: [makeDay('wd-1', 'Push 1', 0), makeDay('wd-2', 'Pull 1', 1), makeDay('wd-3', 'Legs', 2)],
    exercisesByDay: {
      'wd-1': [makeExercise(INC, 'wd-1', 'Incline Dumbbell Press', 0), makeExercise(DIPS, 'wd-1', 'Dips', 1), makeExercise(FLY, 'wd-1', 'Pec Deck Fly', 2), makeExercise(LAT, 'wd-1', 'Lateral Raise', 3)],
      'wd-2': [makeExercise(ROW, 'wd-2', 'Barbell Row', 0)],
      'wd-3': [],
    },
  }
}

export const open = (name: string) => fireEvent.click(screen.getByRole('button', { name: `Show set targets for ${name}` }))
export const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
