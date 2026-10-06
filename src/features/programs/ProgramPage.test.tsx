// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom'
import type { Mesocycle, Program } from '../../types'

// ProgramPage.tsx pulls in useMesos/usePrograms (which value-import the real
// Supabase client at module load) — mocked at the hook layer, same
// heavy-mocking precedent as library/ReassignSheet.test.tsx (the app's own
// example of testing a component with this many data-hook dependencies),
// rather than mocking ../../lib/supabase directly: ProgramPage calls six
// different hooks from two modules, and asserting on the hook call itself
// (did useStartRun's mutateAsync get called, with what) is both simpler and
// more direct than reconstructing a Supabase query-builder chain two layers
// down for a component test.

let mesosData: Mesocycle[] = []
let savedPrograms: Program[] = []
const startRunMutateAsyncMock = vi.fn()
const completeMesoMutateAsyncMock = vi.fn()
const deleteMesoMutateAsyncMock = vi.fn()
const createProgramMutateAsyncMock = vi.fn()
const showToastMock = vi.fn()

vi.mock('./useMesos', () => ({
  useMesos: () => ({ data: mesosData, isLoading: false }),
  useStartRun: () => ({ mutateAsync: startRunMutateAsyncMock, isPending: false }),
  useCompleteMeso: () => ({ mutateAsync: completeMesoMutateAsyncMock, isPending: false }),
  useDeleteMeso: () => ({ mutateAsync: deleteMesoMutateAsyncMock, isPending: false }),
}))

vi.mock('./usePrograms', () => ({
  useSavedPrograms: () => ({ data: savedPrograms, isLoading: false }),
  useCreateProgram: () => ({ mutateAsync: createProgramMutateAsyncMock, isPending: false }),
}))

vi.mock('../notifications/toastStore', () => ({
  useToastStore: (selector: (s: { show: typeof showToastMock }) => unknown) => selector({ show: showToastMock }),
}))

const { default: ProgramPage } = await import('./ProgramPage')

afterEach(() => {
  cleanup()
  startRunMutateAsyncMock.mockReset()
  completeMesoMutateAsyncMock.mockReset()
  deleteMesoMutateAsyncMock.mockReset()
  createProgramMutateAsyncMock.mockReset()
  showToastMock.mockReset()
  savedPrograms = []
  mesosData = []
})

const SAVED_PROGRAM: Program = {
  id: 'prog-1',
  userId: 'user-1',
  name: 'Upper/Lower',
  schedule: {} as Program['schedule'],
  workoutDays: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  kind: 'saved',
}

// A completed meso whose row (ProgramPage's own COMPLETED list) must still
// open the OLD per-mesocycle screen — chunk 10 review fix only moves where
// the ACTIVE run lands right after START; completed runs keep editing/
// viewing v2_coach_meso_tag_priorities through MesoPrioritiesPage exactly
// as before (TASKS.md chunk 10: "Completed runs' rows stay ... untouched").
const COMPLETED_MESO: Mesocycle = {
  id: 'meso-completed-1',
  userId: 'user-1',
  name: 'Finished Block',
  programId: 'prog-1',
  status: 'completed',
  startDate: '2026-01-01',
  endDate: '2026-02-01',
  createdAt: '2026-01-01T00:00:00Z',
}

function MesoProbe() {
  const { mesoId } = useParams<{ mesoId: string }>()
  return <div>PRIORITIES SCREEN mesoId={mesoId}</div>
}

// The new Plan-driven editor (chunk 10: PrioritiesEditor.tsx) — no route
// param (it looks up the active run itself), so this probe needs none
// either; a distinct marker string from MesoProbe's is what lets a test
// assert "the NEW screen, not the old one" unambiguously.
function PlanPrioritiesProbe() {
  return <div>PLAN PRIORITIES EDITOR</div>
}

function renderProgramPage() {
  return render(
    <MemoryRouter initialEntries={['/program']}>
      <Routes>
        <Route path="/program" element={<ProgramPage />} />
        <Route path="/meso/:mesoId/priorities" element={<MesoProbe />} />
        <Route path="/plan/priorities" element={<PlanPrioritiesProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openAndSubmitStartMeso() {
  fireEvent.click(screen.getByText('+ START MESOCYCLE'))
  fireEvent.click(screen.getByRole('button', { name: 'START MESOCYCLE' }))
}

// Chunk 6, TASKS.md — "ProgramPage's START MESOCYCLE calls [v2_start_run]
// (runService.ts), replacing completeAllActiveMesos + createMeso." The old
// two-step functions no longer exist in mesoService.ts at all (see
// mesoService.test.ts's own export-shape check); this file proves the
// *replacement* behaviour: the one click calls useStartRun's mutateAsync
// exactly once with the picked program, and nothing it does depends on the
// retired two-step path.
describe('ProgramPage — START MESOCYCLE calls v2_start_run (useStartRun), not the old two-step path', () => {
  it('clicking START MESOCYCLE calls startRun.mutateAsync once, with the selected program and a name', async () => {
    savedPrograms = [SAVED_PROGRAM]
    startRunMutateAsyncMock.mockResolvedValue('new-meso-1')
    renderProgramPage()

    await openAndSubmitStartMeso()

    await waitFor(() => expect(startRunMutateAsyncMock).toHaveBeenCalledTimes(1))
    expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'Upper/Lower', programId: 'prog-1' })
  })

  // Chunk 10 review fix (behaviour change, on purpose — flagged in the
  // commit): this used to navigate to /meso/:id/priorities (the OLD
  // four-level MesoPrioritiesPage) using the id v2_start_run returned.
  // The new run IS the active run, so from here on it opens the NEW
  // editor instead — which needs no id (it looks up the active run
  // itself, PlanPage.tsx's own pattern). Landing on the old screen would
  // write the new run's marks into v2_coach_meso_tag_priorities, against
  // TASKS.md/SPEC.md's "Run marks are stored only in the new form", and
  // would show none of the marks v2_start_run actually copied onto the
  // run's own program (those live in v2_program_priorities, which that
  // screen never reads).
  it('on success, navigates to the new Plan priorities editor for the active run — never the old per-meso screen', async () => {
    savedPrograms = [SAVED_PROGRAM]
    startRunMutateAsyncMock.mockResolvedValue('new-meso-1')
    renderProgramPage()

    await openAndSubmitStartMeso()

    await waitFor(() => expect(screen.getByText('PLAN PRIORITIES EDITOR')).toBeTruthy())
    expect(screen.queryByText(/PRIORITIES SCREEN mesoId/)).toBeNull()
  })

  it('a custom meso name is passed through instead of the program name', async () => {
    savedPrograms = [SAVED_PROGRAM]
    startRunMutateAsyncMock.mockResolvedValue('new-meso-1')
    renderProgramPage()

    fireEvent.click(screen.getByText('+ START MESOCYCLE'))
    fireEvent.change(screen.getByPlaceholderText('Upper/Lower'), { target: { value: 'My Custom Block' } })
    fireEvent.click(screen.getByRole('button', { name: 'START MESOCYCLE' }))

    await waitFor(() =>
      expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'My Custom Block', programId: 'prog-1' }),
    )
  })

  it('only saved programs are offered to pick from (useSavedPrograms, not an unfiltered list)', () => {
    savedPrograms = [SAVED_PROGRAM]
    renderProgramPage()

    fireEvent.click(screen.getByText('+ START MESOCYCLE'))

    // The picker renders exactly what useSavedPrograms returned — proving
    // this screen reads the filtered hook is a one-line import check
    // (ProgramPage.tsx imports useSavedPrograms, not usePrograms) plus this:
    // the name it offers is the saved program's.
    expect(screen.getAllByText('Upper/Lower').length).toBeGreaterThan(0)
  })
})

describe('ProgramPage — START MESOCYCLE surfaces errors (CONTEXT.md: handleStartMeso had no try/catch before this chunk)', () => {
  it('a rejected startRun shows a toast and does not navigate away', async () => {
    savedPrograms = [SAVED_PROGRAM]
    startRunMutateAsyncMock.mockRejectedValue(new Error('v2_start_run: program prog-1 is not a saved program (kind=run)'))
    renderProgramPage()

    await openAndSubmitStartMeso()

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith('v2_start_run: program prog-1 is not a saved program (kind=run)'),
    )
    // Still on the Program page's own sheet — not routed to a priorities
    // screen for a mesocycle that was never created.
    expect(screen.queryByText(/PRIORITIES SCREEN/)).toBeNull()
  })

  it('a non-Error rejection still shows a toast, with a sensible fallback message', async () => {
    savedPrograms = [SAVED_PROGRAM]
    startRunMutateAsyncMock.mockRejectedValue('offline')
    renderProgramPage()

    await openAndSubmitStartMeso()

    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Could not start the mesocycle'))
  })
})

// Chunk 10 review fix's other half: proves the completed list's own
// navigation (lines ~153/160 in ProgramPage.tsx) is untouched by the
// START-flow fix above — a completed meso still opens the OLD screen.
describe('ProgramPage — a completed meso still opens the old per-meso priorities screen', () => {
  it('clicking a completed meso row navigates to /meso/:id/priorities (MesoPrioritiesPage), not the new Plan editor', async () => {
    mesosData = [COMPLETED_MESO]
    renderProgramPage()

    fireEvent.click(screen.getByText('Finished Block'))

    await waitFor(() => expect(screen.getByText('PRIORITIES SCREEN mesoId=meso-completed-1')).toBeTruthy())
    expect(screen.queryByText('PLAN PRIORITIES EDITOR')).toBeNull()
  })
})
