// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Mesocycle, Program, SequenceItem, WorkoutDay } from '../../types'

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
// Chunk 33 — what the sheet's START RUN reads to know whether the selected
// program has a scheduled workout (through useProgramHasSchedule): the program's
// workouts, and for a sequence program its sequence. A key with no entry reads as
// "not answered yet" (undefined data), like a query that hasn't resolved.
let workoutDaysByProgram: Record<string, WorkoutDay[]> = {}
let sequenceItemsByProgram: Record<string, SequenceItem[]> = {}
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
  useWorkoutDays: (programId: string) => ({ data: programId ? workoutDaysByProgram[programId] : undefined, isLoading: false }),
  useSequenceItems: (programId: string) => ({ data: programId ? sequenceItemsByProgram[programId] : undefined, isLoading: false }),
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
  workoutDaysByProgram = {}
  sequenceItemsByProgram = {}
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  // The two saved programs below each have one workout on a Monday, so the tests
  // that start one (chunk 33: starting needs a schedule) can; the schedule tests
  // at the end set up their own.
  workoutDaysByProgram = { 'prog-1': [workoutDay('prog-1')], 'prog-2': [workoutDay('prog-2')] }
})

function program(overrides: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Upper/Lower', schedule: {} as Program['schedule'],
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'saved',
    ...overrides,
  }
}

function workoutDay(programId: string): WorkoutDay {
  return { id: `wd-${programId}`, programId, userId: 'user-1', name: 'Full Body', position: 0, exercises: [] }
}
const MONDAY = (programId: string) =>
  ({ monday: `wd-${programId}`, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }) as Program['schedule']
const NO_DAYS = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null } as Program['schedule']

const SAVED_PROGRAM_1 = program({ id: 'prog-1', name: 'Upper/Lower', schedule: MONDAY('prog-1') })
const SAVED_PROGRAM_2 = program({ id: 'prog-2', name: 'Push Pull Legs', schedule: MONDAY('prog-2') })

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

// ─── Under Plan's PLAN | PROGRAMS tabs (chunk 52, P1.2-12) ─────────────────

describe('ProgramsPage — embedded in Plan\'s PROGRAMS tab', () => {
  it('on its own route it has its own "OVERLOAD v2 / PROGRAMS" header, as it always did', () => {
    renderProgramsPage()
    expect(screen.getByRole('heading', { name: 'PROGRAMS' })).toBeTruthy()
    expect(screen.getByText('OVERLOAD v2')).toBeTruthy()
  })

  it('embedded, the tab is the title: the page leaves out its own header and keeps everything else', () => {
    savedPrograms = [SAVED_PROGRAM_1]
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <ProgramsPage embedded />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('heading', { name: 'PROGRAMS' })).toBeNull()
    expect(screen.queryByText('OVERLOAD v2')).toBeNull()
    expect(screen.getByText('ACTIVE RUN')).toBeTruthy()
    expect(screen.getByLabelText('Create a program')).toBeTruthy()
  })
})

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

// ─── Start needs a schedule (chunk 33) ──────────────────────────────────────
// SPEC Programs and runs [P1.1] (G39): "Starting a run needs a schedule: at least
// one workout on a weekday (weekday), or one workout in the sequence (sequence).
// Start isn't possible without one." The Programs page starts a run without
// opening the planner, so its sheet has the same check as the planner's START
// (DECISIONS 85, provisional: disabled, one line under it).

describe('ProgramsPage — START RUN needs a schedule (chunk 33)', () => {
  const REASON = 'Schedule at least one workout to start'
  const startRunButton = () => screen.getByRole('button', { name: 'START RUN' }) as HTMLButtonElement

  function openSheetFor(rowIndex = 0) {
    fireEvent.click(screen.getAllByText('START')[rowIndex])
  }

  describe('a weekday program', () => {
    it('with no workout on any weekday: START RUN is disabled, the reason shows, and useStartRun is never called', () => {
      savedPrograms = [program({ id: 'prog-1', name: 'Upper/Lower', schedule: NO_DAYS })]
      renderProgramsPage()

      openSheetFor()
      expect(startRunButton().disabled).toBe(true)
      expect(screen.getByText(REASON)).toBeTruthy()

      fireEvent.click(startRunButton())
      expect(startRunMutateAsyncMock).not.toHaveBeenCalled()
      expect(screen.queryByText(/^AT \//)).toBeNull()
    })

    it('a form submit by any other route (Enter in the name field) starts nothing either', () => {
      savedPrograms = [program({ id: 'prog-1', name: 'Upper/Lower', schedule: NO_DAYS })]
      renderProgramsPage()

      openSheetFor()
      fireEvent.submit(startRunButton().closest('form')!)

      expect(startRunMutateAsyncMock).not.toHaveBeenCalled()
    })

    it('with one workout on a weekday: START RUN is enabled, no reason shows, and it starts the program', async () => {
      savedPrograms = [SAVED_PROGRAM_1]
      startRunMutateAsyncMock.mockResolvedValue('new-meso-1')
      renderProgramsPage()

      openSheetFor()
      expect(startRunButton().disabled).toBe(false)
      expect(screen.queryByText(REASON)).toBeNull()

      fireEvent.click(startRunButton())
      await waitFor(() => expect(startRunMutateAsyncMock).toHaveBeenCalledTimes(1))
      expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'Upper/Lower', programId: 'prog-1' })
    })

    it('a weekday that names a workout the program no longer has is not a scheduled workout', () => {
      savedPrograms = [program({ id: 'prog-1', schedule: { ...NO_DAYS, monday: 'wd-gone' } })]
      renderProgramsPage()

      openSheetFor()
      expect(startRunButton().disabled).toBe(true)
      expect(screen.getByText(REASON)).toBeTruthy()
    })

    it('the row\'s own START still opens the sheet (the check is on the sheet\'s START RUN)', () => {
      savedPrograms = [program({ id: 'prog-1', name: 'Upper/Lower', schedule: NO_DAYS })]
      renderProgramsPage()

      const rowStart = screen.getByText('START') as HTMLButtonElement
      expect(rowStart.disabled).toBe(false)
      fireEvent.click(rowStart)
      expect(screen.getByText('START RUN', { selector: 'button' })).toBeTruthy()
    })
  })

  describe('a sequence program', () => {
    const SEQUENCE_PROGRAM = () => program({ id: 'prog-1', name: 'Cycle', scheduleType: 'sequence', schedule: NO_DAYS })
    const item = (position: number, workoutDayId: string | null): SequenceItem =>
      ({ id: `si-${position}`, userId: 'user-1', programId: 'prog-1', position, workoutDayId })

    it('with no slot at all: START RUN is disabled and the reason shows', () => {
      savedPrograms = [SEQUENCE_PROGRAM()]
      sequenceItemsByProgram = { 'prog-1': [] }
      renderProgramsPage()

      openSheetFor()
      expect(startRunButton().disabled).toBe(true)
      expect(screen.getByText(REASON)).toBeTruthy()
      fireEvent.click(startRunButton())
      expect(startRunMutateAsyncMock).not.toHaveBeenCalled()
    })

    it('with only rest slots: START RUN is disabled and the reason shows', () => {
      savedPrograms = [SEQUENCE_PROGRAM()]
      sequenceItemsByProgram = { 'prog-1': [item(0, null), item(1, null)] }
      renderProgramsPage()

      openSheetFor()
      expect(startRunButton().disabled).toBe(true)
      expect(screen.getByText(REASON)).toBeTruthy()
    })

    it('a weekday map left under a sequence program does not schedule it', () => {
      savedPrograms = [program({ id: 'prog-1', scheduleType: 'sequence', schedule: MONDAY('prog-1') })]
      sequenceItemsByProgram = { 'prog-1': [] }
      renderProgramsPage()

      openSheetFor()
      expect(startRunButton().disabled).toBe(true)
      expect(screen.getByText(REASON)).toBeTruthy()
    })

    it('with one workout in the sequence: START RUN is enabled, no reason shows, and it starts the program', async () => {
      savedPrograms = [SEQUENCE_PROGRAM()]
      sequenceItemsByProgram = { 'prog-1': [item(0, null), item(1, 'wd-prog-1')] }
      startRunMutateAsyncMock.mockResolvedValue('new-meso-1')
      renderProgramsPage()

      openSheetFor()
      expect(startRunButton().disabled).toBe(false)
      expect(screen.queryByText(REASON)).toBeNull()

      fireEvent.click(startRunButton())
      await waitFor(() => expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'Cycle', programId: 'prog-1' }))
    })
  })

  it('is decided for the program the sheet has selected: choosing another in the picker changes it', async () => {
    savedPrograms = [
      program({ id: 'prog-1', name: 'Upper/Lower', schedule: MONDAY('prog-1') }),
      program({ id: 'prog-2', name: 'Push Pull Legs', schedule: NO_DAYS }),
    ]
    startRunMutateAsyncMock.mockResolvedValue('new-meso-1')
    renderProgramsPage()

    openSheetFor(0) // prog-1: scheduled
    expect(startRunButton().disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Push Pull Legs' })) // prog-2: none
    expect(startRunButton().disabled).toBe(true)
    expect(screen.getByText(REASON)).toBeTruthy()
    fireEvent.click(startRunButton())
    expect(startRunMutateAsyncMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Upper/Lower' })) // back to prog-1
    expect(startRunButton().disabled).toBe(false)
    expect(screen.queryByText(REASON)).toBeNull()
    fireEvent.click(startRunButton())
    await waitFor(() => expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'Upper/Lower', programId: 'prog-1' }))
  })

  it('while the program\'s workouts have not answered: START RUN waits, and no reason shows yet', () => {
    savedPrograms = [SAVED_PROGRAM_1]
    workoutDaysByProgram = {} // no answer for prog-1
    renderProgramsPage()

    openSheetFor()
    expect(startRunButton().disabled).toBe(true)
    expect(screen.queryByText(REASON)).toBeNull()
    fireEvent.click(startRunButton())
    expect(startRunMutateAsyncMock).not.toHaveBeenCalled()
  })

  it('the reason line is a single line of the sheet (it fits at 375px: no fixed width wider than that)', () => {
    savedPrograms = [program({ id: 'prog-1', schedule: NO_DAYS })]
    const { container } = renderProgramsPage()

    openSheetFor()
    expect(screen.getByText(REASON)).toBeTruthy()
    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(el.style[prop])
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${el.style[prop]}`)
      }
    }
    expect(offenders).toEqual([])
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
