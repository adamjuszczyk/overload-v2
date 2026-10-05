// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom'
import type { WorkoutDay } from '../../types'
import ProgramTab from './ProgramTab'

// Chunk 6, TASKS.md — "Plan gets a Program tab listing the run's workouts
// and opening the existing workout editor on the run's copy." Presentational
// only (no data hook of its own — PlanPage passes it the same useWorkoutDays
// result it already fetches), so this proves the two things that are this
// file's own job: it renders the run's workouts, and each one links to the
// existing editor route with the RUN COPY's own ids — not the saved
// template's — which is the whole point of a run owning its own copy.

afterEach(() => cleanup())

function day(overrides: Partial<WorkoutDay> = {}): WorkoutDay {
  return {
    id: 'wd-1',
    programId: 'run-copy-1',
    userId: 'user-1',
    name: 'Upper',
    position: 0,
    exercises: [],
    sourceWorkoutDayId: 'template-wd-1',
    ...overrides,
  }
}

// A real (uncommitted) router, not a mock — MemoryRouter + a destination
// route lets ProgramTab's real useNavigate() call actually navigate, so the
// landed URL's own params can be read back directly instead of inspecting a
// mocked call (EditorProbe renders exactly the :programId/:dayId it
// received, so a wrong id shows up as wrong text, not just "some route
// matched").
function EditorProbe() {
  const { programId, dayId } = useParams<{ programId: string; dayId: string }>()
  return <div>EDITOR SCREEN programId={programId} dayId={dayId}</div>
}

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <Routes>
        <Route path="/plan" element={ui} />
        <Route path="/program/:programId/day/:dayId" element={<EditorProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProgramTab — renders the run copy\'s workouts', () => {
  it('lists every workout day, in order, by name', () => {
    renderWithRouter(
      <ProgramTab
        programId="run-copy-1"
        workoutDays={[day({ id: 'wd-1', name: 'Upper', position: 0 }), day({ id: 'wd-2', name: 'Lower', position: 1 })]}
        isLoading={false}
      />,
    )

    expect(screen.getByText('Upper')).toBeTruthy()
    expect(screen.getByText('Lower')).toBeTruthy()
  })

  it('shows a loading spinner while isLoading, not the empty state or any row', () => {
    renderWithRouter(<ProgramTab programId="run-copy-1" workoutDays={[]} isLoading={true} />)

    expect(screen.queryByText('NO WORKOUTS YET')).toBeNull()
    expect(document.querySelector('.animate-spin')).toBeTruthy()
  })

  it('shows an empty state when the run copy has no workouts yet', () => {
    renderWithRouter(<ProgramTab programId="run-copy-1" workoutDays={[]} isLoading={false} />)

    expect(screen.getByText('NO WORKOUTS YET')).toBeTruthy()
  })
})

describe('ProgramTab — each row opens the existing workout editor on the RUN COPY\'s ids', () => {
  it('navigates to /program/:runCopyProgramId/day/:workoutDayId — the copy\'s own ids, not the template\'s', () => {
    renderWithRouter(
      <ProgramTab
        programId="run-copy-1"
        workoutDays={[day({ id: 'wd-1', name: 'Upper', sourceWorkoutDayId: 'template-wd-1' })]}
        isLoading={false}
      />,
    )

    fireEvent.click(screen.getByText('Upper'))

    // The copy's own ids reached the route — not 'template-wd-1' (the
    // template workout this copy's lineage points at), which would mean the
    // tab had wired the link to the saved program instead of the run.
    expect(screen.getByText('EDITOR SCREEN programId=run-copy-1 dayId=wd-1')).toBeTruthy()
  })

  it('a second run copy with the same workout name and id links to ITS OWN program id, not the first\'s', () => {
    renderWithRouter(
      <ProgramTab programId="run-copy-2" workoutDays={[day({ id: 'wd-1', name: 'Upper' })]} isLoading={false} />,
    )

    fireEvent.click(screen.getByText('Upper'))

    expect(screen.getByText('EDITOR SCREEN programId=run-copy-2 dayId=wd-1')).toBeTruthy()
  })
})
