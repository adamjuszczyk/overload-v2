// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Mesocycle, Program } from '../../types'

// Chunk 26 — ProgramsPage.tsx replaces ProgramPage.tsx at the same /program
// route (App.tsx), reached only from Plan's header now (PROGRAM is gone
// from Nav.tsx). Every data hook here is reused unchanged from chunk 6/10's
// ProgramPage.tsx (useMesos/usePrograms), so — same precedent as that
// file's own header comment — mocked at the hook layer rather than
// reconstructing a Supabase query-builder chain two layers down.
//
// Lessons (binding): screen-layer tests must assert real navigation targets
// (route paths and ids), not just a mocked navigate's call args — so every
// "goes to X" test below renders a real <Route> at the real target path
// (App.tsx's own paths: /program/:programId, /meso/:mesoId/priorities,
// /plan/priorities) and reads the resolved location back out, the same
// LocationProbe idiom PlannerPage.test.tsx already established.

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

const { default: ProgramsPage } = await import('./ProgramsPage')

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

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

function program(overrides: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Upper/Lower', schedule: {} as Program['schedule'],
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'saved',
    ...overrides,
  }
}

const SAVED_PROGRAM_1 = program({ id: 'prog-1', name: 'Upper/Lower' })
const SAVED_PROGRAM_2 = program({ id: 'prog-2', name: 'Push Pull Legs' })

const ACTIVE_MESO: Mesocycle = {
  id: 'meso-active-1',
  userId: 'user-1',
  name: 'Current Block',
  programId: 'prog-run-1',
  program: program({ id: 'prog-run-1', name: 'Upper/Lower', kind: 'run' }),
  status: 'active',
  startDate: '2026-01-01',
  endDate: null,
  createdAt: '2026-01-01T00:00:00Z',
}

// A completed meso whose row (ProgramsPage's own COMPLETED RUNS list) must
// still open MesoPrioritiesPage — unchanged since chunk 10's review fix;
// only the page it's reached FROM has moved (ProgramPage → ProgramsPage).
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

function LocationProbe() {
  const location = useLocation()
  return <div>AT {location.pathname}</div>
}

function renderProgramsPage() {
  return render(
    <MemoryRouter initialEntries={['/program']}>
      <Routes>
        <Route path="/program" element={<ProgramsPage />} />
        <Route path="/program/:programId" element={<LocationProbe />} />
        <Route path="/meso/:mesoId/priorities" element={<LocationProbe />} />
        <Route path="/plan/priorities" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

// ─── Create a program ──────────────────────────────────────────────────────

describe('ProgramsPage — create a program', () => {
  it('createProgram.mutateAsync is called with the trimmed name, then navigates to the real /program/:id route for the created program', async () => {
    createProgramMutateAsyncMock.mockResolvedValue({ id: 'new-prog-9', name: 'New Block' })
    renderProgramsPage()

    fireEvent.click(screen.getByLabelText('Create a program'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Hypertrophy Block'), { target: { value: '  New Block  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'CREATE PROGRAM' }))

    await waitFor(() => expect(createProgramMutateAsyncMock).toHaveBeenCalledWith('New Block'))
    await waitFor(() => expect(screen.getByText('AT /program/new-prog-9')).toBeTruthy())
  })
})

// ─── Saved programs: "Open in planner" and "Start" ─────────────────────────

describe('ProgramsPage — saved programs: Open in planner', () => {
  it('each row opens the real planner route for ITS OWN program id, not always the first', () => {
    savedPrograms = [SAVED_PROGRAM_1, SAVED_PROGRAM_2]
    renderProgramsPage()

    const openButtons = screen.getAllByText('OPEN IN PLANNER')
    expect(openButtons).toHaveLength(2)
    fireEvent.click(openButtons[1])

    expect(screen.getByText('AT /program/prog-2')).toBeTruthy()
  })
})

describe('ProgramsPage — saved programs: Start (calls chunk 6\'s v2_start_run, same as before)', () => {
  it('Start on a specific row pre-selects THAT program — submitting immediately starts it, not the first program in the list', async () => {
    savedPrograms = [SAVED_PROGRAM_1, SAVED_PROGRAM_2]
    startRunMutateAsyncMock.mockResolvedValue('new-meso-1')
    renderProgramsPage()

    const startButtons = screen.getAllByText('START')
    fireEvent.click(startButtons[1]) // SAVED_PROGRAM_2's row
    fireEvent.click(screen.getByRole('button', { name: 'START RUN' }))

    await waitFor(() => expect(startRunMutateAsyncMock).toHaveBeenCalledTimes(1))
    expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'Push Pull Legs', programId: 'prog-2' })
  })

  it('on success, navigates to the real /plan/priorities route (the active run\'s priorities editor, not the old per-meso screen)', async () => {
    savedPrograms = [SAVED_PROGRAM_1]
    startRunMutateAsyncMock.mockResolvedValue('new-meso-1')
    renderProgramsPage()

    fireEvent.click(screen.getByText('START'))
    fireEvent.click(screen.getByRole('button', { name: 'START RUN' }))

    await waitFor(() => expect(screen.getByText('AT /plan/priorities')).toBeTruthy())
  })

  it('a custom run name is passed through instead of the program name', async () => {
    savedPrograms = [SAVED_PROGRAM_1]
    startRunMutateAsyncMock.mockResolvedValue('new-meso-1')
    renderProgramsPage()

    fireEvent.click(screen.getByText('START'))
    fireEvent.change(screen.getByPlaceholderText('Upper/Lower'), { target: { value: 'My Custom Block' } })
    fireEvent.click(screen.getByRole('button', { name: 'START RUN' }))

    await waitFor(() =>
      expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'My Custom Block', programId: 'prog-1' }),
    )
  })

  it('a rejected start shows a toast and does not navigate away', async () => {
    savedPrograms = [SAVED_PROGRAM_1]
    startRunMutateAsyncMock.mockRejectedValue(new Error('v2_start_run: program prog-1 is not a saved program (kind=run)'))
    renderProgramsPage()

    fireEvent.click(screen.getByText('START'))
    fireEvent.click(screen.getByRole('button', { name: 'START RUN' }))

    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith('v2_start_run: program prog-1 is not a saved program (kind=run)'),
    )
    expect(screen.queryByText(/^AT \//)).toBeNull()
  })

  it('a non-Error rejection still shows a toast, with a sensible fallback message', async () => {
    savedPrograms = [SAVED_PROGRAM_1]
    startRunMutateAsyncMock.mockRejectedValue('offline')
    renderProgramsPage()

    fireEvent.click(screen.getByText('START'))
    fireEvent.click(screen.getByRole('button', { name: 'START RUN' }))

    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Could not start the mesocycle'))
  })
})

// ─── Starting while a run is active still ends the old one (chunk 6) ──────

describe('ProgramsPage — Start while a run is active (reuses chunk 6\'s v2_start_run, never reimplemented)', () => {
  it('tapping Start on a saved program calls useStartRun with only the NEW program — ending the active run is v2_start_run\'s own atomic job, not a second call this page makes', async () => {
    mesosData = [ACTIVE_MESO]
    savedPrograms = [SAVED_PROGRAM_1]
    startRunMutateAsyncMock.mockResolvedValue('new-meso-2')
    renderProgramsPage()

    fireEvent.click(screen.getByText('START'))
    // The sheet says so, same wording precedent as before this chunk.
    expect(screen.getByText('Starting a new run will automatically end the current one.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'START RUN' }))

    await waitFor(() =>
      expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'Upper/Lower', programId: 'prog-1' }),
    )
    // No separate "end the active run" call from this page — ACTIVE_MESO's
    // own id is never passed to completeMeso by the Start flow.
    expect(completeMesoMutateAsyncMock).not.toHaveBeenCalled()
  })
})

// ─── Active run: End run ───────────────────────────────────────────────────

describe('ProgramsPage — active run: End run', () => {
  it('shows the active run\'s card with one action, END RUN (no "NEW MESO" shortcut any more)', () => {
    mesosData = [ACTIVE_MESO]
    renderProgramsPage()

    expect(screen.getByText('Current Block')).toBeTruthy()
    expect(screen.getByText('END RUN')).toBeTruthy()
    expect(screen.queryByText('NEW MESO')).toBeNull()
    expect(screen.queryByText('COMPLETE MESO')).toBeNull()
  })

  it('END RUN → confirm → completeMeso.mutateAsync is called with the active run\'s id, then the start sheet reopens to prompt a new one', async () => {
    mesosData = [ACTIVE_MESO]
    savedPrograms = [SAVED_PROGRAM_1]
    completeMesoMutateAsyncMock.mockResolvedValue(undefined)
    renderProgramsPage()

    fireEvent.click(screen.getByText('END RUN'))
    expect(screen.getByText('End run?')).toBeTruthy()
    // Two "END RUN" buttons now exist — the card's own (still behind the
    // sheet) and the confirm sheet's; the confirm one renders last.
    const endRunButtons = screen.getAllByRole('button', { name: 'END RUN' })
    fireEvent.click(endRunButtons[endRunButtons.length - 1])

    await waitFor(() => expect(completeMesoMutateAsyncMock).toHaveBeenCalledWith('meso-active-1'))
    await waitFor(() => expect(screen.getByText('START A NEW RUN')).toBeTruthy())
  })

  it('no active run shows a plain empty-state caption, not a page-level Start CTA (Start now lives on each saved program\'s own row)', () => {
    renderProgramsPage()
    expect(screen.getByText('NO ACTIVE RUN')).toBeTruthy()
  })
})

// ─── Completed runs: delete, and their priorities pages ────────────────────

describe('ProgramsPage — completed runs: delete', () => {
  it('the trash icon → confirm "Delete run?" → deleteMeso.mutateAsync is called with that run\'s id', async () => {
    mesosData = [COMPLETED_MESO]
    deleteMesoMutateAsyncMock.mockResolvedValue(undefined)
    renderProgramsPage()

    fireEvent.click(screen.getByLabelText('Delete run'))
    expect(screen.getByText('Delete run?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'DELETE' }))

    await waitFor(() => expect(deleteMesoMutateAsyncMock).toHaveBeenCalledWith('meso-completed-1'))
  })
})

describe('ProgramsPage — completed runs: priorities pages (MesoPrioritiesPage, untouched)', () => {
  it('clicking a completed run\'s row navigates to the real /meso/:id/priorities route', () => {
    mesosData = [COMPLETED_MESO]
    renderProgramsPage()

    fireEvent.click(screen.getByText('Finished Block'))

    expect(screen.getByText('AT /meso/meso-completed-1/priorities')).toBeTruthy()
  })

  it('the trash icon does not also trigger the row\'s own navigation (stopPropagation)', () => {
    mesosData = [COMPLETED_MESO]
    renderProgramsPage()

    fireEvent.click(screen.getByLabelText('Delete run'))

    expect(screen.queryByText(/^AT \//)).toBeNull()
  })
})

// ─── Empty states ───────────────────────────────────────────────────────────

describe('ProgramsPage — empty states', () => {
  it('no saved programs shows NO PROGRAMS YET', () => {
    renderProgramsPage()
    expect(screen.getByText('NO PROGRAMS YET')).toBeTruthy()
  })
})

// ─── 375px ──────────────────────────────────────────────────────────────────

describe('ProgramsPage — 375px', () => {
  it('no rendered element carries a fixed pixel width wider than 375px', () => {
    mesosData = [ACTIVE_MESO, COMPLETED_MESO]
    savedPrograms = [SAVED_PROGRAM_1, SAVED_PROGRAM_2]
    const { container } = renderProgramsPage()
    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const value = el.style[prop]
        const m = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
