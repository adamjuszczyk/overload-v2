// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 7 (TASKS.md "Each planned session owns its exercise list — refactor,
// no visible change"): proves PlanPage renders byte-identical output before
// and after this chunk, for the same underlying data, and that it is
// actually reading the NEW source (weekPlan.exercises) rather than
// coincidentally matching.
//
// __fixtures__/planpage-chunk6-render.html is the frozen "before": captured
// by rendering build/chunk-6's own PlanPage.tsx (commit 5f0b03e) with this
// exact fixture data, mocking useProgramExercises (chunk 6's only exercise
// source) to return [pe1, pe2] — see the capture procedure in this chunk's
// report for the exact throwaway script used (run once on a build/chunk-6
// worktree, output copied here, never committed there).
//
// This test renders the SAME component tree on THIS branch with the SAME
// fixture, but swaps which mock carries the real data: useProgramExercises
// (the fallback, used only when no week plan exists) now returns a
// deliberately WRONG list, and weekPlan.exercises (the new source) carries
// the real [pe1, pe2] instead. If PlanPage still read useProgramExercises
// while a week plan exists, the rendered output would show the wrong
// exercise ("DECOY EXERCISE") instead of Bench Press/Incline Press, and
// this test would fail — see the "breaks" section of this chunk's report
// for that exact failure, captured by temporarily reverting
// WorkoutDayPanel's fallback-preference line.

afterEach(() => cleanup())

const today = new Date().toISOString().slice(0, 10)

const activeMeso: Mesocycle = {
  id: 'meso-1',
  userId: 'user-1',
  name: 'Test Meso',
  programId: 'prog-1',
  status: 'active',
  startDate: today,
  endDate: null,
  createdAt: '2026-01-01T00:00:00Z',
}

const program: Program = {
  id: 'prog-1',
  userId: 'user-1',
  name: 'Test Program',
  schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
  workoutDays: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  kind: 'run',
}

const workoutDay: WorkoutDay = {
  id: 'wd-1',
  programId: 'prog-1',
  userId: 'user-1',
  name: 'Push Day',
  position: 0,
  exercises: [],
}

const pe1: ProgramExercise = {
  id: 'pe-1',
  workoutDayId: 'wd-1',
  userId: 'user-1',
  exerciseId: 'ex-1',
  position: 0,
  targetReps: 8,
  weightUnit: null,
  exercise: {
    id: 'ex-1',
    userId: 'user-1',
    name: 'Bench Press',
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

const pe2: ProgramExercise = {
  id: 'pe-2',
  workoutDayId: 'wd-1',
  userId: 'user-1',
  exerciseId: 'ex-2',
  position: 1,
  targetReps: null,
  weightUnit: null,
  exercise: {
    id: 'ex-2',
    userId: 'user-1',
    name: 'Incline Press',
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

// Deliberately wrong — if PlanPage ever falls back to useProgramExercises
// while a week plan exists, this exercise would appear instead of Bench
// Press/Incline Press, and the HTML comparison below would fail.
const decoyExercise: ProgramExercise = {
  id: 'pe-decoy',
  workoutDayId: 'wd-1',
  userId: 'user-1',
  exerciseId: 'ex-decoy',
  position: 0,
  targetReps: null,
  weightUnit: null,
  exercise: {
    id: 'ex-decoy',
    userId: 'user-1',
    name: 'DECOY EXERCISE',
    muscleGroup: 'other',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
  },
}

const weekPlan: WeekPlan = {
  id: 'wp-1',
  userId: 'user-1',
  mesocycleId: 'meso-1',
  workoutDayId: 'wd-1',
  weekNumber: 1,
  isDeload: false,
  notes: null,
  sets: [
    {
      id: 'set-1',
      weekPlanId: 'wp-1',
      userId: 'user-1',
      programExerciseId: 'pe-1',
      setNumber: 1,
      targetRir: 2,
      isDropset: false,
      parentWeekPlanSetId: null,
      stageIndex: 0,
      isWarmup: false,
    },
    {
      id: 'set-1-drop',
      weekPlanId: 'wp-1',
      userId: 'user-1',
      programExerciseId: 'pe-1',
      setNumber: 1,
      targetRir: 0,
      isDropset: true,
      parentWeekPlanSetId: 'set-1',
      stageIndex: 1,
      isWarmup: false,
    },
  ],
  // The week's own exercise list (chunk 7) — the real data, same content
  // useProgramExercises carried on build/chunk-6.
  exercises: [pe1, pe2],
  createdAt: '2026-01-01T00:00:00Z',
}

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  // The fallback source only — deliberately wrong, see decoyExercise above.
  useProgramExercises: () => ({ data: [decoyExercise], isLoading: false }),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: [weekPlan], isLoading: false }),
  // Chunk 8 — the meso-wide history query PlanPage now reads for its
  // manual-copy-button gating; [weekPlan] is enough for this fixture (this
  // test's weekPlan already has exercises, so every button-visibility
  // branch chunk 8 added evaluates to false here, same as before this
  // chunk — see the chunk 8 report for why this fixture's render is
  // unaffected) and usePlanWeek's mutate is never awaited by this render.
  useAllWeekPlans: () => ({ data: [weekPlan], isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url))
const EXPECTED_HTML = readFileSync(join(FIXTURE_DIR, '__fixtures__', 'planpage-chunk6-render.html'), 'utf8')

describe('PlanPage — renders from the week\'s own exercise list, byte-identical to build/chunk-6', () => {
  it('matches the frozen build/chunk-6 render exactly, for the same underlying data', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>,
    )
    expect(container.innerHTML).toBe(EXPECTED_HTML)
  })

  it('sanity: the frozen fixture itself names both exercises (guards against an empty/truncated fixture passing vacuously)', () => {
    expect(EXPECTED_HTML).toContain('Bench Press')
    expect(EXPECTED_HTML).toContain('Incline Press')
    expect(EXPECTED_HTML).not.toContain('DECOY')
  })
})
