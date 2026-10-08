// @vitest-environment jsdom
//
// Chunk 21 (SPEC "Deload"). SessionPreview.tsx's own header already read
// `{weekPlan?.isDeload ? 'DELOAD · ' : ''}WEEK {weekNumber}` before this
// chunk, unchanged by it (same "already correct, never live-exercised"
// Fact as GymSession.tsx's own header — see GymSession.deload.test.tsx).
// No SessionPreview test file existed before this chunk, so this is a new
// minimal harness, not a re-capture of anything.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProgramExercise, WeekPlan, WorkoutDay } from '../../types'

afterEach(() => cleanup())

vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }),
}))
vi.mock('./useSession', () => ({
  useExerciseReferenceSessions: () => ({
    data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn(),
  }),
}))

const { default: SessionPreview } = await import('./SessionPreview')

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null,
  exercise: { id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
}

function makeWeekPlan(isDeload: boolean): WeekPlan {
  return {
    id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 3,
    isDeload, notes: null, sets: [], exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
  }
}

// PreviewExerciseCard -> ExerciseHeader calls useNavigate(), so a Router
// context is needed once the preview has any real exercise card to render
// (every scenario below but the empty-plan one).
function renderPreview(weekPlan: WeekPlan | null) {
  return render(
    <MemoryRouter>
      <SessionPreview
        workoutDay={workoutDay}
        weekPlan={weekPlan}
        weekNumber={3}
        today="2026-01-05"
        isStarting={false}
        onBack={() => {}}
        onStart={() => {}}
      />
    </MemoryRouter>,
  )
}

describe('SessionPreview — labels DELOAD per session, never DELOAD WEEK (chunk 21)', () => {
  it('a deload session\'s own plan row shows "DELOAD · WEEK 3", not "DELOAD WEEK"', () => {
    renderPreview(makeWeekPlan(true))
    expect(screen.getByText('DELOAD · WEEK 3')).toBeTruthy()
    expect(screen.queryByText(/DELOAD WEEK/)).toBeNull()
  })

  it('a non-deload session shows plain "WEEK 3", no DELOAD text anywhere', () => {
    renderPreview(makeWeekPlan(false))
    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.queryByText(/DELOAD/)).toBeNull()
  })

  it('no week plan at all (off-schedule preview) shows plain "WEEK 3" too', () => {
    renderPreview(null)
    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.queryByText(/DELOAD/)).toBeNull()
  })
})
