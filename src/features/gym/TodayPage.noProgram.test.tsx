// @vitest-environment jsdom
//
// Chunk 69 (SPEC [1.2] Language: "Program" everywhere (C12), and TASKS-1.2 chunk 69: Today's empty state says "Start a program
// to begin training" and its button, GO TO PROGRAMS →, opens Plan on PROGRAMS). Today keeps its code and its look; this is the
// no-program state only (the scheduler is replaced wholesale, as TodayPage.moveSession.test.tsx does). The tree-wide check is
// scripts/check-wording.test.mjs. Two empty states, told apart by whether any program is saved; the button goes to the PROGRAMS
// tab's route (`/program`, App.tsx: Plan opened on PROGRAMS) in both.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { SchedulerResult } from '../../types'
import type { SchedulerData } from './useScheduler'
import { captureRender } from '../../testing/captureRender'

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const TODAY = '2026-09-09' // a Wednesday
const mockState: { result: SchedulerResult } = { result: { type: 'no_program' } }

vi.mock('./useScheduler', () => ({
  useScheduler: (): SchedulerData => ({
    result: mockState.result, isLoading: false, activeMeso: null, workoutDays: [], currentWeekPlans: [], allWeekPlans: [], currentWeek: 1,
  }),
}))
vi.mock('./useSession', () => ({
  useCreateSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMoveSession: () => ({ mutate: vi.fn(), isPending: false }),
  useClearMovedSession: () => ({ mutate: vi.fn(), isPending: false }),
  useStartMovedSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../plan/useWeekPlan', () => ({
  usePlanWeek: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  planWeekThenFindId: vi.fn(async () => 'wp-1'),
}))
vi.mock('../../hooks/useToday', () => ({ useToday: () => TODAY }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))

const { default: TodayPage } = await import('./TodayPage')

function renderToday() {
  return render(
    <MemoryRouter initialEntries={['/today']}>
      <Routes>
        <Route path="/today" element={<TodayPage />} />
        <Route path="/program" element={<p>PLAN ON PROGRAMS</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Today with no program running says "program" (SPEC Language [1.2], C12)', () => {
  it('no program saved: "Create a program to get started"', () => {
    mockState.result = { type: 'no_program' }
    const { container } = renderToday()
    expect(screen.getByText('Create a program to get started')).toBeTruthy()
    expect(screen.queryByText('Start a program to begin training')).toBeNull()
    expect(screen.getByText('GO TO PROGRAMS →')).toBeTruthy()
    expect(container.textContent).not.toMatch(/meso|\brun\b/i)
  })

  it('programs saved, none running: "Start a program to begin training"; GO TO PROGRAMS → opens Plan on PROGRAMS', () => {
    mockState.result = { type: 'no_active_meso' }
    const { container } = renderToday()
    expect(screen.getByText('Start a program to begin training')).toBeTruthy()
    expect(screen.queryByText('Create a program to get started')).toBeNull()
    expect(container.textContent).not.toMatch(/meso|\brun\b/i)
    captureRender('today-no-program', container)
    fireEvent.click(screen.getByText('GO TO PROGRAMS →'))
    expect(screen.getByText('PLAN ON PROGRAMS')).toBeTruthy()
  })
})
