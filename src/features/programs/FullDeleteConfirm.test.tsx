// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import type { FinishedRunCounts } from '../../types'

// Chunk 75 (1.2.1 item 8b; SPEC Screens → Finished program: full delete): the one confirmation both entry points draw, through its REAL hooks
// (`useFinishedRunCounts`, `useDeleteFinishedRun`) on the app's own query client, with the services behind them mocked: what it reads and when, what
// it says in each state, when DELETE is on, what DELETE sends, and what happens with the answer. The words are `fullDeleteText.test.ts`'s; the
// queue clean-up is `finishedRun.queue.test.tsx`'s (here it is a stand-in that records what it is given); the two screens that draw it are
// `FinishedProgramPage.test.tsx`'s and `HistorySessions.wording.test.tsx`'s.
//
// The states: counting ("Counting what goes…", DELETE off) until the counts AND the session ids have both answered; counted (the sentence, DELETE
// on); a read that failed (the reason, DELETE off); offline ("You're offline. Deleting needs a connection.", DELETE off, nothing read); a delete in
// flight (DELETING…, off); a delete that failed (inside, with the reason, DELETE on again).

const world = vi.hoisted(() => ({ online: true }))
const countsMock = vi.hoisted(() => vi.fn())
const idsMock = vi.hoisted(() => vi.fn())
const deleteMock = vi.hoisted(() => vi.fn())
const dropMock = vi.hoisted(() => vi.fn())

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => world.online }))
vi.mock('./mesoService', () => ({
  fetchMesos: vi.fn(),
  completeMeso: vi.fn(),
  fetchFinishedRunCounts: (...args: unknown[]) => countsMock(...args),
  fetchFinishedRunSessionIds: (...args: unknown[]) => idsMock(...args),
  deleteFinishedRun: (...args: unknown[]) => deleteMock(...args),
}))
vi.mock('./finishedRunQueue', () => ({ dropQueuedWritesOfDeletedRun: (...args: unknown[]) => dropMock(...args) }))
vi.mock('./runService', () => ({ startRun: vi.fn() }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const { default: FullDeleteConfirm } = await import('./FullDeleteConfirm')

const CUT: FinishedRunCounts = { weeks: 10, sessions: 38, loggedSets: 1046, coachAnalyses: 3, coachNotes: 0 }
const RUN = { id: 'meso-cut', name: 'Cut PPL' }

type Deferred<T = unknown> = { resolve: (value: T) => void; reject: (error: unknown) => void; promise: Promise<T> }
const deferred = <T = unknown,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { resolve, reject, promise }
}
const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

const onCancel = vi.fn()
const onDeleted = vi.fn()

function ui(run: { id: string; name: string } = RUN) {
  return (
    <QueryClientProvider client={queryClient}>
      <FullDeleteConfirm run={run} onCancel={onCancel} onDeleted={onDeleted} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  world.online = true
  countsMock.mockReset().mockResolvedValue(CUT)
  idsMock.mockReset().mockResolvedValue(['s-1', 's-2'])
  deleteMock.mockReset().mockResolvedValue(undefined)
  dropMock.mockReset().mockImplementation(async (_id: string, ids: readonly string[]) => [...ids])
  onCancel.mockReset()
  onDeleted.mockReset()
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})

const deleteButton = () => screen.getByRole('button', { name: /^DELET/ }) as HTMLButtonElement
// A click that reaches the button's handler although the button is disabled (the browser sends none to a disabled button, so this is the stale-event race the
// handler's own guard exists for: DELETE cannot be undone, and the count it was pressed on must be the count on screen).
function clickThroughDisabled(button: HTMLButtonElement) {
  expect(button.disabled).toBe(true)
  const key = Object.keys(button).find((k) => k.startsWith('__reactProps$'))!
  ;(button as unknown as Record<string, { onClick: () => void }>)[key].onClick()
}

describe('counting → counted', () => {
  it('"Delete Cut PPL?", "Counting what goes…" and DELETE off until the counts have answered; then the sentence and DELETE on, in the error colour, with CANCEL', async () => {
    const counts = deferred<FinishedRunCounts>()
    countsMock.mockReturnValue(counts.promise)
    render(ui())

    expect(screen.getByText('Delete Cut PPL?')).toBeTruthy()
    expect(screen.getByText('Counting what goes…')).toBeTruthy()
    expect(deleteButton().disabled).toBe(true)
    expect(deleteButton().textContent).toBe('DELETE')
    expect(screen.queryByText(/^Deletes its/)).toBeNull()

    await act(async () => { counts.resolve(CUT) })

    expect(await screen.findByText("Deletes its 10 weeks: 38 sessions and 1046 logged sets, plus 3 Coach analyses. Its results leave History, Progress and every stat. This can't be undone.")).toBeTruthy()
    expect(screen.queryByText('Counting what goes…')).toBeNull()
    expect(deleteButton().disabled).toBe(false)
    // the destructive variant of the shared confirm (the prototype draws DELETE in the error colour), not the accent's
    expect(deleteButton().getAttribute('style')).toContain('var(--error)')
    expect(deleteButton().getAttribute('style')).not.toContain('var(--accent)')
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeTruthy()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('DELETE stays off while the session ids are still out, though the counts have answered (one query for both)', async () => {
    const ids = deferred<string[]>()
    idsMock.mockReturnValue(ids.promise)
    render(ui())
    await waitFor(() => expect(countsMock).toHaveBeenCalledTimes(1))
    await tick()

    expect(screen.getByText('Counting what goes…')).toBeTruthy()
    expect(screen.queryByText(/^Deletes its/)).toBeNull()
    expect(deleteButton().disabled).toBe(true)
    fireEvent.click(deleteButton())
    expect(deleteMock).not.toHaveBeenCalled()

    await act(async () => { ids.resolve(['s-1']) })
    await screen.findByText(/^Deletes its 10 weeks/)
    expect(deleteButton().disabled).toBe(false)
  })

  it('reads the counts and the ids for this program only, once each, when it opens', async () => {
    render(ui({ id: 'meso-old', name: 'Spring Block' }))
    await screen.findByText(/^Deletes its/)
    expect(countsMock).toHaveBeenCalledTimes(1)
    expect(countsMock).toHaveBeenCalledWith('meso-old')
    expect(idsMock).toHaveBeenCalledTimes(1)
    expect(idsMock).toHaveBeenCalledWith('meso-old')
  })

  it('the sentence follows the counts: one week without Coach rows (the prototype\'s Delete, no Coach rows), and notes alone', async () => {
    countsMock.mockResolvedValue({ weeks: 1, sessions: 2, loggedSets: 31, coachAnalyses: 0, coachNotes: 0 })
    const first = render(ui())
    expect(await first.findByText("Deletes its 1 week: 2 sessions and 31 logged sets. Its results leave History, Progress and every stat. This can't be undone.")).toBeTruthy()
    first.unmount()
    queryClient.clear()

    countsMock.mockResolvedValue({ weeks: 1, sessions: 1, loggedSets: 1, coachAnalyses: 0, coachNotes: 1 })
    render(ui())
    expect(await screen.findByText("Deletes its 1 week: 1 session and 1 logged set and 1 Coach note. Its results leave History, Progress and every stat. This can't be undone.")).toBeTruthy()
  })
})

describe('offline', () => {
  it('"You\'re offline. Deleting needs a connection." and DELETE off, and neither the counts nor the ids are read, however long it waits', async () => {
    world.online = false
    render(ui())
    await tick()
    await tick()

    expect(screen.getByText("You're offline. Deleting needs a connection.")).toBeTruthy()
    expect(screen.queryByText('Counting what goes…')).toBeNull()
    expect(deleteButton().disabled).toBe(true)
    expect(countsMock).not.toHaveBeenCalled()
    expect(idsMock).not.toHaveBeenCalled()
    fireEvent.click(deleteButton())
    await tick()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('going offline with the sentence on screen takes it away and turns DELETE off; coming back counts again, and the old count is not named meanwhile', async () => {
    const { rerender } = render(ui())
    await screen.findByText(/^Deletes its 10 weeks/)

    world.online = false
    rerender(ui())
    expect(screen.getByText("You're offline. Deleting needs a connection.")).toBeTruthy()
    expect(screen.queryByText(/^Deletes its/)).toBeNull()
    expect(deleteButton().disabled).toBe(true)
    // the earlier count is still in the query, and a stale click on the disabled button must not delete on it
    clickThroughDisabled(deleteButton())
    await tick()
    expect(deleteMock).not.toHaveBeenCalled()

    const again = deferred<FinishedRunCounts>()
    countsMock.mockReturnValue(again.promise)
    world.online = true
    rerender(ui())
    await waitFor(() => expect(countsMock).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Counting what goes…')).toBeTruthy()
    expect(screen.queryByText(/^Deletes its/)).toBeNull()
    expect(deleteButton().disabled).toBe(true)
    clickThroughDisabled(deleteButton())
    await tick()
    expect(deleteMock).not.toHaveBeenCalled()

    await act(async () => { again.resolve({ ...CUT, sessions: 39 }) })
    expect(await screen.findByText(/^Deletes its 10 weeks: 39 sessions/)).toBeTruthy()
    expect(deleteButton().disabled).toBe(false)
  })
})

describe('a count that could not be read', () => {
  it('a read that fails AFTER one that answered is a failure too: the earlier count is not named, and DELETE is off (TanStack keeps the old data, the confirmation must not)', async () => {
    const { rerender } = render(ui())
    await screen.findByText(/^Deletes its 10 weeks/)
    world.online = false
    rerender(ui())
    countsMock.mockRejectedValue({ message: 'Failed to fetch' })
    world.online = true
    rerender(ui())

    expect(await screen.findByText("Couldn't count what goes.")).toBeTruthy()
    expect(screen.getByText('Failed to fetch')).toBeTruthy()
    expect(screen.queryByText(/^Deletes its/)).toBeNull()
    expect(deleteButton().disabled).toBe(true)
    fireEvent.click(deleteButton())
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('says so with the reason, keeps DELETE off, and does not ask again', async () => {
    countsMock.mockRejectedValue({ code: 'P0002', message: 'program not found: meso-cut' })
    render(ui())

    expect(await screen.findByText("Couldn't count what goes.")).toBeTruthy()
    expect(screen.getByText('program not found: meso-cut')).toBeTruthy()
    expect(screen.queryByText('Counting what goes…')).toBeNull()
    expect(screen.queryByText(/^Deletes its/)).toBeNull()
    expect(deleteButton().disabled).toBe(true)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1300)) })
    expect(countsMock).toHaveBeenCalledTimes(1)
    fireEvent.click(deleteButton())
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('the ids failing alone is the same: the counts in hand are not enough', async () => {
    idsMock.mockRejectedValue({ message: 'JWT expired' })
    render(ui())

    expect(await screen.findByText("Couldn't count what goes.")).toBeTruthy()
    expect(screen.getByText('JWT expired')).toBeTruthy()
    expect(screen.queryByText(/^Deletes its/)).toBeNull()
    expect(deleteButton().disabled).toBe(true)
  })
})

describe('DELETE', () => {
  it('sends this program\'s id and the session ids read with the counts, to the delete and to the phone\'s queue, and then says it is done — in that order', async () => {
    const request = deferred()
    deleteMock.mockReturnValue(request.promise)
    render(ui())
    await screen.findByText(/^Deletes its/)

    fireEvent.click(deleteButton())
    await tick()

    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteMock).toHaveBeenCalledWith('meso-cut')
    expect(dropMock).not.toHaveBeenCalled() // the request is still out
    expect(onDeleted).not.toHaveBeenCalled()
    expect(screen.getByText('Delete Cut PPL?')).toBeTruthy()

    await act(async () => { request.resolve(undefined) })
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(dropMock).toHaveBeenCalledTimes(1)
    expect(dropMock).toHaveBeenCalledWith('meso-cut', ['s-1', 's-2'])
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('while the delete is out the button says DELETING… and cannot be pressed again', async () => {
    deleteMock.mockReturnValue(new Promise(() => {}))
    render(ui())
    await screen.findByText(/^Deletes its/)

    fireEvent.click(deleteButton())
    await tick()

    const button = screen.getByRole('button', { name: 'DELETING…' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(deleteMock).toHaveBeenCalledTimes(1)
  })

  it('two presses of DELETE in one instant are one delete', async () => {
    const request = deferred()
    deleteMock.mockReturnValue(request.promise)
    render(ui())
    await screen.findByText(/^Deletes its/)
    const button = deleteButton()

    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
    })

    expect(deleteMock).toHaveBeenCalledTimes(1)
    await act(async () => { request.resolve(undefined) })
  })

  it('a refused delete stays inside, "Couldn\'t delete Cut PPL." with the database\'s reason; the counts stay, DELETE can be pressed again, and nothing is said to have been done', async () => {
    deleteMock.mockRejectedValueOnce({ code: 'OL003', message: 'only a finished program can be deleted' }).mockResolvedValueOnce(undefined)
    render(ui())
    await screen.findByText(/^Deletes its/)

    fireEvent.click(deleteButton())

    expect(await screen.findByText("Couldn't delete Cut PPL.")).toBeTruthy()
    expect(screen.getByText('only a finished program can be deleted')).toBeTruthy()
    expect(screen.getByText(/^Deletes its 10 weeks/)).toBeTruthy()
    expect(onDeleted).not.toHaveBeenCalled()
    expect(dropMock).not.toHaveBeenCalled()
    expect(deleteButton().disabled).toBe(false)
    expect(deleteButton().textContent).toBe('DELETE')

    fireEvent.click(deleteButton())
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(deleteMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText("Couldn't delete Cut PPL.")).toBeNull()
  })

  it('a delete that failed offline-ish (the request itself) shows the real reason, not a made-up one', async () => {
    deleteMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(ui())
    await screen.findByText(/^Deletes its/)
    fireEvent.click(deleteButton())
    expect(await screen.findByText('Failed to fetch')).toBeTruthy()
  })

  it('CANCEL closes it without deleting anything or reading anything more', async () => {
    render(ui())
    await screen.findByText(/^Deletes its/)

    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(deleteMock).not.toHaveBeenCalled()
    expect(dropMock).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })
})

describe('375 px: a name with no break in it wraps (the title, and the failure line)', () => {
  const LONG = 'X'.repeat(80)

  it('an 80-letter program name wraps in the title and in "Couldn\'t delete …"', async () => {
    deleteMock.mockRejectedValue(new Error('refused'))
    render(ui({ id: 'meso-long', name: LONG }))
    await screen.findByText(/^Deletes its/)
    const title = screen.getByText(`Delete ${LONG}?`)
    expect(title.style.overflowWrap).toBe('anywhere')

    fireEvent.click(deleteButton())
    const caption = await screen.findByText(`Couldn't delete ${LONG}.`)
    expect(caption.style.overflowWrap).toBe('anywhere')
    expect(screen.getByText(/^Deletes its/).style.overflowWrap).toBe('anywhere')
  })
})
