// @vitest-environment jsdom
//
// Chunk 69 (SPEC [1.2] Language: "MESO OVERVIEW" and the rest become the program's words; TASKS-1.2 chunk 69). Progress keeps
// its code and its look. The tree-wide check is scripts/check-wording.test.mjs; this file proves the PROGRESS screen's tab
// and its two empty states say "program" where they are drawn: no program at all, and a program with no completed week.
// ExerciseProgress (the other tab) has its own screen and tests, and its one string ("PROGRESS · THIS PROGRAM") is held
// by the tree-wide check.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import type { Mesocycle } from '../../types'
import { captureRender } from '../../testing/captureRender'

afterEach(() => cleanup())

const CURRENT: Mesocycle = {
  id: 'm-summer', userId: 'u1', name: 'Summer Block', programId: 'p2', status: 'active',
  startDate: '2026-09-07', endDate: null, createdAt: '2026-09-01T00:00:00Z',
}

const mock: { programs: Mesocycle[] } = { programs: [] }
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: mock.programs, isLoading: false }) }))
vi.mock('./useProgress', () => ({ useMesoWeeklyProgress: () => ({ data: [], isLoading: false }) }))
vi.mock('./ExerciseProgress', () => ({ default: () => <p>EXERCISE TAB</p> }))

const { default: ProgressPage } = await import('./ProgressPage')

beforeEach(() => { mock.programs = [] })

describe('Progress says "program" (SPEC Language [1.2], C12)', () => {
  it('the tabs are EXERCISE and PROGRAM OVERVIEW', () => {
    render(<ProgressPage />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['EXERCISE', 'PROGRAM OVERVIEW'])
  })

  it('with no program: NO PROGRAMS YET and where to start one (Plan → Programs)', () => {
    const { container } = render(<ProgressPage />)
    fireEvent.click(screen.getByText('PROGRAM OVERVIEW'))
    expect(screen.getByText('NO PROGRAMS YET')).toBeTruthy()
    expect(screen.getByText('Start a program in Plan → Programs to track progress.')).toBeTruthy()
    expect(container.textContent).not.toMatch(/meso|\brun\b/i)
    captureRender('progress-no-programs', container)
  })

  it('with a program and no completed week: NO COMPLETED WEEKS YET and "see your program overview"', () => {
    mock.programs = [CURRENT]
    const { container } = render(<ProgressPage />)
    fireEvent.click(screen.getByText('PROGRAM OVERVIEW'))
    expect(screen.getByText('NO COMPLETED WEEKS YET')).toBeTruthy()
    expect(screen.getByText('Complete sessions across a full week to see your program overview.')).toBeTruthy()
    expect(screen.queryByText('NO PROGRAMS YET')).toBeNull()
    expect(container.textContent).not.toMatch(/meso|\brun\b/i)
    captureRender('progress-no-weeks', container)
  })
})
