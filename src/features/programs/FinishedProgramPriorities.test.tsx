// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS } from '../../lib/exerciseTags'
import type { Mesocycle } from '../../types'

// Chunk 66: a finished program's priorities, editable (SPEC Programs and runs [1.2]: "A finished program's priorities stay editable ... It shows and
// edits the run's own priorities (the ones copied at its start)"). The editor is the planner's step 1 on the run's own program id; its writes are
// real hooks over the app's own query client, with the service that talks to the database the only stand-in, so what is asserted is the request a
// tap makes: the run copy's id (not the saved program the run started from), the group, the mark.

const state = vi.hoisted(() => ({
  mesos: [] as unknown[],
  fetched: [] as string[],
}))
const setMarkMock = vi.hoisted(() => vi.fn())

vi.mock('./useMesos', () => ({ useMesos: () => ({ data: state.mesos }) }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../notifications/toastStore', () => ({ useToastStore: (selector: (s: { show: () => void }) => unknown) => selector({ show: () => undefined }) }))
vi.mock('../plan/programPrioritiesService', () => ({
  fetchProgramPriorities: (programId: string) => {
    state.fetched.push(programId)
    return Promise.resolve([])
  },
  setPriorityMark: (...args: unknown[]) => setMarkMock(...args),
}))

const { default: FinishedProgramPriorities } = await import('./FinishedProgramPriorities')

const FINISHED: Mesocycle = { id: 'meso-cut', userId: 'user-1', name: 'Cut PPL', programId: 'prog-run-cut', sourceProgramId: 'prog-saved-ppl', status: 'completed', startDate: '2026-07-06', endDate: '2026-09-13', createdAt: '' }
const ACTIVE: Mesocycle = { ...FINISHED, id: 'meso-active', name: 'Running Now', programId: 'prog-run-active', status: 'active', endDate: null }

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
  state.mesos = [FINISHED, ACTIVE]
  state.fetched = []
  setMarkMock.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  setMarkMock.mockReset()
  queryClient.clear()
})

function Where() {
  return <div data-testid="where">AT {useLocation().pathname}</div>
}
function renderAt(id: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/program/finished/${id}/priorities`]}>
        <Routes>
          <Route path="/program/finished/:mesocycleId/priorities" element={<FinishedProgramPriorities />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('a finished program\'s priorities editor', () => {
  it('the header is the priorities screen\'s: the back arrow, the program\'s name over PRIORITIES; every group is there; the planner\'s "skip" line is not', async () => {
    renderAt('meso-cut')
    expect(screen.getByText('CUT PPL')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PRIORITIES')
    expect(screen.getByRole('button', { name: 'Back to the finished program' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText(MUSCLE_GROUP_LABELS[MUSCLE_GROUPS[0]])).toBeTruthy())
    for (const group of MUSCLE_GROUPS) expect(screen.getByText(MUSCLE_GROUP_LABELS[group])).toBeTruthy()
    expect(screen.queryByText(/SKIP IF YOU DON'T NEED IT/)).toBeNull()
  })

  it('it reads the marks of the run\'s own copy, never the saved program\'s', async () => {
    renderAt('meso-cut')
    await waitFor(() => expect(state.fetched.length).toBeGreaterThan(0))
    expect([...new Set(state.fetched)]).toEqual(['prog-run-cut'])
  })

  it('a tap on FOCUS writes that mark for that group on the run\'s copy: the user, the copy\'s id, the tag and the mark', async () => {
    renderAt('meso-cut')
    await waitFor(() => expect(screen.getAllByText('FOCUS').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('FOCUS')[0])
    await waitFor(() => expect(setMarkMock).toHaveBeenCalledTimes(1))
    expect(setMarkMock).toHaveBeenCalledWith('user-1', 'prog-run-cut', 'muscle_group', MUSCLE_GROUPS[0], 'focus')
  })

  it('and DON\'T CARE on the same group is the other mark, on the same copy', async () => {
    renderAt('meso-cut')
    await waitFor(() => expect(screen.getAllByText("DON'T CARE").length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText("DON'T CARE")[0])
    await waitFor(() => expect(setMarkMock).toHaveBeenCalledTimes(1))
    expect(setMarkMock).toHaveBeenCalledWith('user-1', 'prog-run-cut', 'muscle_group', MUSCLE_GROUPS[0], 'dont_care')
  })

  it('the back arrow returns to the finished program', () => {
    renderAt('meso-cut')
    fireEvent.click(screen.getByRole('button', { name: 'Back to the finished program' }))
    expect(screen.getByTestId('where').textContent).toBe('AT /program/finished/meso-cut')
  })

  it('a program that is running (or no program) has no editor here, and nothing is read or written for it', () => {
    renderAt('meso-active')
    expect(screen.getByText('No finished program here')).toBeTruthy()
    expect(screen.queryByText('FOCUS')).toBeNull()
    expect(state.fetched).toEqual([])
    expect(setMarkMock).not.toHaveBeenCalled()
  })
})
