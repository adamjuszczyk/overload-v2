// @vitest-environment jsdom
//
// Chunk 69 (SPEC [1.2] Language: "Program" everywhere (C12) — "ALL MESOS", "DELETE MESO", "Search sessions or mesos…" and
// the like become the program's words; TASKS-1.2 chunk 69). History keeps its code and its look; only the words change.
// The tree-wide check is scripts/check-wording.test.mjs; this file proves the History → Sessions screen itself says the new
// words where they are drawn, and that the rules the words describe are unchanged: the program filter lists every
// program, a session with no program says so, only a FINISHED program offers a delete, and its confirm deletes nothing
// until DELETE. Dates are real weekdays (Mondays for starts, Wednesdays for sessions).
//
// Chunk 75 (1.2.1 item 8b): the delete card's DELETE PROGRAM opens the same full-delete confirmation as DELETE THIS FINISHED PROGRAM
// (`FullDeleteConfirm`: "Delete [name]?", what goes counted, CANCEL and a red DELETE), with the same hooks and the program's own id; deleted, History
// stays here with its program filter reset. The confirmation's own states are `FullDeleteConfirm.test.tsx`'s.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import type { Mesocycle } from '../../types'
import type { HistoryRow } from './historyService'
import { captureRender } from '../../testing/captureRender'

afterEach(() => cleanup())

const FINISHED: Mesocycle = {
  id: 'm-spring', userId: 'u1', name: 'Spring Block', programId: 'p1', status: 'completed',
  startDate: '2026-03-02', endDate: '2026-05-25', createdAt: '2026-03-01T00:00:00Z',
}
const CURRENT: Mesocycle = { ...FINISHED, id: 'm-summer', name: 'Summer Block', programId: 'p2', status: 'active', startDate: '2026-09-07', endDate: null }
// another finished program, so a delete that is given the wrong program shows
const OTHER_FINISHED: Mesocycle = { ...FINISHED, id: 'm-winter', name: 'Winter Block', programId: 'p3', startDate: '2025-11-03', endDate: '2026-01-26' }

const row = (over: Partial<HistoryRow>): HistoryRow => ({
  id: 's', date: '2026-09-09', status: 'completed', note: null, startedAt: null, completedAt: null, workoutDayId: 'wd1',
  workoutDayName: 'Upper A', mesocycleId: null, mesocycleName: null, setCount: 18, muscleGroups: ['chest', 'back'], ...over,
})
const ROWS: HistoryRow[] = [
  row({ id: 's-now', date: '2026-09-09', workoutDayName: 'Upper A', mesocycleId: 'm-summer', mesocycleName: 'Summer Block' }),
  row({ id: 's-old', date: '2026-03-04', workoutDayName: 'Lower A', mesocycleId: 'm-spring', mesocycleName: 'Spring Block', setCount: 15, muscleGroups: ['quads'] }),
  row({ id: 's-none', date: '2026-01-14', workoutDayName: 'Arms', setCount: 12, muscleGroups: ['biceps', 'triceps'] }),
]

const deleteMutate = vi.hoisted(() => vi.fn())
const countedFor = vi.hoisted(() => vi.fn())
const world = vi.hoisted(() => ({ online: true, mesos: [] as unknown[] }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => world.online }))
vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: world.mesos }),
  // the confirmation's counts: asked by the program's id and whether the phone is online (the same hook the finished page uses)
  useFinishedRunCounts: (id: string, enabled: boolean) => {
    countedFor(id, enabled)
    return enabled
      ? { data: { counts: { weeks: 12, sessions: 30, loggedSets: 540, coachAnalyses: 2, coachNotes: 1 }, sessionIds: [`${id}-s1`, `${id}-s2`] }, isFetching: false, isError: false, error: null }
      : { data: undefined, isFetching: false, isError: false, error: null }
  },
  useDeleteFinishedRun: () => ({ mutateAsync: deleteMutate, isPending: false }),
}))
vi.mock('./useHistory', () => ({
  useHistorySessions: () => ({
    data: { pages: [{ rows: ROWS, nextOffset: null }] }, isLoading: false, fetchNextPage: vi.fn(), hasNextPage: false, isFetchingNextPage: false,
  }),
}))
vi.mock('./SessionDetail', () => ({ default: () => null }))

const { default: HistorySessions } = await import('./HistorySessions')

beforeEach(() => {
  deleteMutate.mockReset()
  countedFor.mockClear()
  world.online = true
  world.mesos = [FINISHED, CURRENT, OTHER_FINISHED]
})

const filterSelect = () => screen.getByRole('combobox') as HTMLSelectElement
const pick = (id: string) => fireEvent.change(filterSelect(), { target: { value: id } })
const confirm = () => screen.getByRole('button', { name: 'DELETE' }) as HTMLButtonElement

describe('History → Sessions says "program" (SPEC Language [1.2], C12)', () => {
  it("the search box, the program filter and each session's program line; a session with no program says NO PROGRAM", () => {
    const { container } = render(<HistorySessions />)
    expect(screen.getByPlaceholderText('Search sessions or programs…')).toBeTruthy()
    const filter = screen.getByDisplayValue('ALL PROGRAMS')
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(['ALL PROGRAMS', 'SPRING BLOCK', 'SUMMER BLOCK (ACTIVE)', 'WINTER BLOCK'])
    // the program's own name decides the line: two named programs, one session with none
    expect(screen.getAllByText(/ SETS$/).map((p) => p.textContent)).toEqual(['Summer Block · 18 SETS', 'Spring Block · 15 SETS', 'NO PROGRAM · 12 SETS'])
    expect(container.textContent).not.toMatch(/meso|\brun\b/i)
    captureRender('history-sessions', container)
  })

  it('a finished program offers DELETE PROGRAM; it opens the full-delete confirmation ("Delete [name]?", what goes counted), and CANCEL deletes nothing', () => {
    const { container } = render(<HistorySessions />)
    pick('m-spring')
    expect(countedFor).not.toHaveBeenCalled() // the card is not the confirmation: nothing is counted until it is open
    fireEvent.click(screen.getByText('DELETE PROGRAM'))
    expect(screen.getByText('Delete Spring Block?')).toBeTruthy()
    expect(screen.getByText("Deletes its 12 weeks: 30 sessions and 540 logged sets, plus 2 Coach analyses and 1 Coach note. Its results leave History, Progress and every stat. This can't be undone.")).toBeTruthy()
    expect(screen.queryByText('DELETE FINISHED PROGRAM?')).toBeNull() // the 1.2 inline confirm is gone
    expect(screen.queryByText('CONFIRM DELETE')).toBeNull()
    expect(container.textContent).not.toMatch(/meso|\brun\b/i)
    expect(confirm().style.background).toBe('var(--error)')
    captureRender('history-sessions-delete', container)
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    expect(deleteMutate).not.toHaveBeenCalled()
    expect(screen.queryByText('Delete Spring Block?')).toBeNull()
    expect(screen.getByText('DELETE PROGRAM')).toBeTruthy()
    expect(filterSelect().value).toBe('m-spring') // the filter is as it was
  })

  it('the current program offers no delete: only a finished one does', () => {
    render(<HistorySessions />)
    pick('m-summer')
    expect(screen.queryByText('DELETE PROGRAM')).toBeNull()
  })
})

describe("History's program-filter delete is the finished page's delete: the same hooks, with the selected program's own id", () => {
  it('counts the selected program, never another finished one, and only while the confirmation is open', () => {
    render(<HistorySessions />)
    pick('m-spring')
    fireEvent.click(screen.getByText('DELETE PROGRAM'))
    expect(countedFor.mock.calls.length).toBeGreaterThan(0)
    expect(countedFor.mock.calls.every(([id, enabled]) => id === 'm-spring' && enabled === true)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    countedFor.mockClear()
    pick('m-winter')
    fireEvent.click(screen.getByText('DELETE PROGRAM'))
    expect(screen.getByText('Delete Winter Block?')).toBeTruthy()
    expect(countedFor.mock.calls.every(([id]) => id === 'm-winter')).toBe(true)
  })

  it('DELETE deletes the selected program once, with the session ids read with the counts, and History stays here with its filter back on ALL PROGRAMS', async () => {
    deleteMutate.mockResolvedValue([])
    render(<HistorySessions />)
    pick('m-winter')
    fireEvent.click(screen.getByText('DELETE PROGRAM'))

    fireEvent.click(confirm())

    await waitFor(() => expect(filterSelect().value).toBe(''))
    expect(deleteMutate).toHaveBeenCalledTimes(1)
    expect(deleteMutate).toHaveBeenCalledWith({ id: 'm-winter', sessionIds: ['m-winter-s1', 'm-winter-s2'] })
    expect(screen.queryByText('Delete Winter Block?')).toBeNull()
    expect(screen.queryByText('DELETE PROGRAM')).toBeNull() // no program selected, so no card
    expect(screen.getAllByText(/ SETS$/)).toHaveLength(3) // History is still here, with every session listed
  })

  it('the confirmation outlives the program: when the list is read again and no longer holds it, the card goes and the confirmation stays until the delete has resolved', async () => {
    let resolve!: () => void
    deleteMutate.mockImplementation(() => new Promise<void>((res) => { resolve = res }))
    const view = render(<HistorySessions />)
    pick('m-spring')
    fireEvent.click(screen.getByText('DELETE PROGRAM'))
    fireEvent.click(confirm())
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    world.mesos = world.mesos.filter((m) => (m as Mesocycle).id !== 'm-spring') // the lists were read again: the program is gone from them
    await act(async () => { view.rerender(<HistorySessions />) })

    expect(screen.queryByText('DELETE PROGRAM')).toBeNull() // the card needs the program, and it is gone
    expect(screen.getByText('Delete Spring Block?')).toBeTruthy() // the confirmation holds it whole
    await act(async () => { resolve() })
    await waitFor(() => expect(screen.queryByText('Delete Spring Block?')).toBeNull())
    expect(filterSelect().value).toBe('')
  })

  it('a failed delete keeps the filter and the program, says why inside the confirmation, and can be pressed again', async () => {
    deleteMutate.mockRejectedValueOnce({ code: 'OL003', message: 'only a finished program can be deleted' }).mockResolvedValueOnce([])
    render(<HistorySessions />)
    pick('m-spring')
    fireEvent.click(screen.getByText('DELETE PROGRAM'))

    fireEvent.click(confirm())

    expect(await screen.findByText("Couldn't delete Spring Block.")).toBeTruthy()
    expect(screen.getByText('only a finished program can be deleted')).toBeTruthy()
    expect(filterSelect().value).toBe('m-spring')
    fireEvent.click(confirm())
    await waitFor(() => expect(filterSelect().value).toBe(''))
    expect(deleteMutate).toHaveBeenCalledTimes(2)
  })

  it('offline: the confirmation says so, DELETE is off, and nothing is counted', () => {
    world.online = false
    render(<HistorySessions />)
    pick('m-spring')
    fireEvent.click(screen.getByText('DELETE PROGRAM'))
    expect(screen.getByText("You're offline. Deleting needs a connection.")).toBeTruthy()
    expect(confirm().disabled).toBe(true)
    expect(countedFor.mock.calls.every(([, enabled]) => enabled === false)).toBe(true)
    fireEvent.click(confirm())
    expect(deleteMutate).not.toHaveBeenCalled()
  })
})
