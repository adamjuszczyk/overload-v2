// @vitest-environment jsdom
//
// Chunk 69 (SPEC [1.2] Language: "Program" everywhere (C12) — "ALL MESOS", "DELETE MESO", "Search sessions or mesos…" and
// the like become the program's words; TASKS-1.2 chunk 69). History keeps its code and its look; only the words change.
// The tree-wide check is scripts/check-wording.test.mjs; this file proves the History → Sessions screen itself says the new
// words where they are drawn, and that the rules the words describe are unchanged: the program filter lists every
// program, a session with no program says so, only a FINISHED program offers a delete, and its confirm deletes nothing
// until CONFIRM DELETE. Dates are real weekdays (Mondays for starts, Wednesdays for sessions).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react'
import type { Mesocycle } from '../../types'
import type { HistoryRow } from './historyService'
import { captureRender } from '../../testing/captureRender'

afterEach(() => cleanup())

const FINISHED: Mesocycle = {
  id: 'm-spring', userId: 'u1', name: 'Spring Block', programId: 'p1', status: 'completed',
  startDate: '2026-03-02', endDate: '2026-05-25', createdAt: '2026-03-01T00:00:00Z',
}
const CURRENT: Mesocycle = { ...FINISHED, id: 'm-summer', name: 'Summer Block', programId: 'p2', status: 'active', startDate: '2026-09-07', endDate: null }

const row = (over: Partial<HistoryRow>): HistoryRow => ({
  id: 's', date: '2026-09-09', status: 'completed', note: null, startedAt: null, completedAt: null, workoutDayId: 'wd1',
  workoutDayName: 'Upper A', mesocycleId: null, mesocycleName: null, setCount: 18, muscleGroups: ['chest', 'back'], ...over,
})
const ROWS: HistoryRow[] = [
  row({ id: 's-now', date: '2026-09-09', workoutDayName: 'Upper A', mesocycleId: 'm-summer', mesocycleName: 'Summer Block' }),
  row({ id: 's-old', date: '2026-03-04', workoutDayName: 'Lower A', mesocycleId: 'm-spring', mesocycleName: 'Spring Block', setCount: 15, muscleGroups: ['quads'] }),
  row({ id: 's-none', date: '2026-01-14', workoutDayName: 'Arms', setCount: 12, muscleGroups: ['biceps', 'triceps'] }),
]

const deleteMutate = vi.fn()
vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [FINISHED, CURRENT] }),
  useDeleteMeso: () => ({ mutate: deleteMutate, isPending: false }),
}))
vi.mock('./useHistory', () => ({
  useHistorySessions: () => ({
    data: { pages: [{ rows: ROWS, nextOffset: null }] }, isLoading: false, fetchNextPage: vi.fn(), hasNextPage: false, isFetchingNextPage: false,
  }),
}))
vi.mock('./SessionDetail', () => ({ default: () => null }))

const { default: HistorySessions } = await import('./HistorySessions')

beforeEach(() => deleteMutate.mockClear())

describe('History → Sessions says "program" (SPEC Language [1.2], C12)', () => {
  it('the search box, the program filter and each session\'s program line; a session with no program says NO PROGRAM', () => {
    const { container } = render(<HistorySessions />)
    expect(screen.getByPlaceholderText('Search sessions or programs…')).toBeTruthy()
    const filter = screen.getByDisplayValue('ALL PROGRAMS')
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(['ALL PROGRAMS', 'SPRING BLOCK', 'SUMMER BLOCK (ACTIVE)'])
    // the program's own name decides the line: two named programs, one session with none
    expect(screen.getAllByText(/ SETS$/).map((p) => p.textContent)).toEqual(['Summer Block · 18 SETS', 'Spring Block · 15 SETS', 'NO PROGRAM · 12 SETS'])
    expect(container.textContent).not.toMatch(/meso|\brun\b/i)
    captureRender('history-sessions', container)
  })

  it('a finished program offers DELETE PROGRAM; its confirm reads DELETE FINISHED PROGRAM? and CANCEL deletes nothing', () => {
    const { container } = render(<HistorySessions />)
    fireEvent.change(screen.getByDisplayValue('ALL PROGRAMS'), { target: { value: 'm-spring' } })
    fireEvent.click(screen.getByText('DELETE PROGRAM'))
    expect(screen.getByText('DELETE FINISHED PROGRAM?')).toBeTruthy()
    expect(screen.getByText(/This will permanently delete/).textContent).toBe(
      "This will permanently delete Spring Block's plan. This cannot be undone. Its logged sessions aren't deleted — they'll remain in History, no longer linked to this program.",
    )
    expect(container.textContent).not.toMatch(/meso|\brun\b/i)
    captureRender('history-sessions-delete', container)
    fireEvent.click(screen.getByText('CANCEL'))
    expect(deleteMutate).not.toHaveBeenCalled()
    expect(screen.getByText('DELETE PROGRAM')).toBeTruthy()
  })

  it('the current program offers no delete: only a finished one does', () => {
    render(<HistorySessions />)
    fireEvent.change(screen.getByDisplayValue('ALL PROGRAMS'), { target: { value: 'm-summer' } })
    expect(screen.queryByText('DELETE PROGRAM')).toBeNull()
  })
})
