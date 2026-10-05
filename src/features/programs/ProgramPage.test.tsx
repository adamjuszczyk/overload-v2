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

const mesosData: Mesocycle[] = []
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

function MesoProbe() {
  const { mesoId } = useParams<{ mesoId: string }>()
  return <div>PRIORITIES SCREEN mesoId={mesoId}</div>
}

function renderProgramPage() {
  return render(
    <MemoryRouter initialEntries={['/program']}>
      <Routes>
        <Route path="/program" element={<ProgramPage />} />
        <Route path="/meso/:mesoId/priorities" element={<MesoProbe />} />
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

  it('on success, navigates to the new mesocycle\'s priorities screen using the id v2_start_run returned', async () => {
    savedPrograms = [SAVED_PROGRAM]
    startRunMutateAsyncMock.mockResolvedValue('new-meso-1')
    renderProgramPage()

    await openAndSubmitStartMeso()

    await waitFor(() => expect(screen.getByText('PRIORITIES SCREEN mesoId=new-meso-1')).toBeTruthy())
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
