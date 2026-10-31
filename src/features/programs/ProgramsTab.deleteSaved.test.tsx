// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Mesocycle, Program, WeeklySchedule } from '../../types'

// Chunk 74 — DELETE on YOUR PROGRAMS (1.2.1 item 8a; SPEC Screens → Programs · YOUR PROGRAMS: delete a saved program; Rules 2; prototype "Programs · YOUR
// PROGRAMS": Normal, Delete, Delete offline, No programs). The screen half: the foot of a row (OPEN · START · DELETE), the running program's DELETE
// greyed with FINISH IT FIRST under it, the confirm in SPEC's words (online and offline), the id each DELETE sends, the pending state, and a refused
// delete shown inside the confirm. The hook behind it is proven in programsTab.writers.test.tsx and the service in programService.deleteSaved.test.ts;
// the whole path through the real hooks and a stand-in for the database is ProgramsTab.deleteSaved.wired.test.tsx. The hooks are mocked at the seam here,
// as every screen test of this app does.
//
// The fixture tells the rows apart: five saved programs, no two alike in name, days or types, of which the FIRST is the one the run started from (its
// DELETE is the greyed one) and a LATER one has that program's NAME but not its id (the greyed row follows the run's source program, an id, not a name).
// A writer that takes the row it was pressed on is pressed on the second, third, fourth and last row (RULES, chunk 176: a test on one row that isn't the
// first passes a handler that always writes to that one row).

const state = vi.hoisted(() => ({
  mesos: { data: [] as unknown[] } as { data: unknown[] | undefined },
  saved: { data: [] as unknown[] } as { data: unknown[] | undefined },
  programs: { data: [] as unknown[] } as { data: unknown[] | undefined },
  online: true,
  deletePending: false,
}))
const deleteMock = vi.hoisted(() => vi.fn())

vi.mock('./useMesos', () => ({
  useMesos: () => state.mesos,
  useStartRun: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCompleteMeso: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('./usePrograms', () => ({
  useSavedPrograms: () => state.saved,
  usePrograms: () => state.programs,
  useCreateProgram: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSavedProgram: () => ({ mutateAsync: deleteMock, isPending: state.deletePending }),
  useWorkoutDays: () => ({ data: undefined }),
  useSequenceItems: () => ({ data: undefined }),
}))
vi.mock('../plan/useProgramPriorities', () => ({ useProgramPriorities: () => ({ data: [] }) }))
vi.mock('../plan/useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: null, failed: false, error: null }) }))
vi.mock('../plan/useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('../../hooks/useToday', () => ({ useToday: () => '2026-10-14' }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => state.online }))

const { default: ProgramsTab } = await import('./ProgramsTab')

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  state.mesos = { data: [] }
  state.saved = { data: [] }
  state.programs = { data: [] }
  state.online = true
  state.deletePending = false
})
afterEach(() => {
  cleanup()
  deleteMock.mockReset()
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NO_DAYS: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
const FIVE_DAYS: WeeklySchedule = { ...NO_DAYS, monday: 'wd-a', tuesday: 'wd-b', wednesday: 'wd-c', thursday: 'wd-a', friday: 'wd-d' }
const FOUR_DAYS: WeeklySchedule = { ...NO_DAYS, monday: 'wd-a', tuesday: 'wd-b', thursday: 'wd-a', friday: 'wd-b' }
const THREE_DAYS: WeeklySchedule = { ...NO_DAYS, monday: 'wd-a', wednesday: 'wd-b', friday: 'wd-c' }

function program(over: Partial<Program> & Pick<Program, 'id' | 'name'>): Program {
  return { userId: 'user-1', schedule: NO_DAYS, workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'saved', planningType: 'stable', scheduleType: 'weekday', ...over }
}

const PPL = program({ id: 'prog-ppl', name: 'Push Pull Legs', schedule: FIVE_DAYS })
const UL = program({ id: 'prog-ul', name: 'Upper / Lower', schedule: FOUR_DAYS, planningType: 'week_dependent' })
const FB = program({ id: 'prog-fb', name: 'Full Body 3x', schedule: THREE_DAYS })
// the running program's NAME, another program: it is not the one that runs
const PPL_TWO = program({ id: 'prog-ppl-2', name: 'Push Pull Legs', schedule: FOUR_DAYS, planningType: 'week_dependent' })
const STRENGTH = program({ id: 'prog-strength', name: 'Strength', schedule: NO_DAYS, scheduleType: 'sequence' })
const RUN_COPY = program({ id: 'prog-run', name: 'Push Pull Legs', kind: 'run', schedule: FIVE_DAYS })

const ACTIVE: Mesocycle = { id: 'meso-active', userId: 'user-1', name: 'Push Pull Legs', programId: 'prog-run', sourceProgramId: 'prog-ppl', status: 'active', startDate: '2026-10-05', endDate: null, createdAt: '2026-10-05T08:00:00Z' }
const FINISHED: Mesocycle = { id: 'meso-fin-1', userId: 'user-1', name: 'Cut PPL', programId: 'prog-old-1', sourceProgramId: 'prog-ul', status: 'completed', startDate: '2026-07-06', endDate: '2026-09-13', createdAt: '2026-07-06T08:00:00Z' }
const LIST = [PPL, UL, FB, PPL_TWO, STRENGTH]

/** A program running (from the FIRST saved program), five saved programs, one finished program. */
function running() {
  state.mesos = { data: [ACTIVE, FINISHED] }
  state.saved = { data: LIST }
  state.programs = { data: [RUN_COPY, ...LIST] }
}
/** Nothing running: the same five and the finished one. */
function notRunning() {
  state.mesos = { data: [FINISHED] }
  state.saved = { data: LIST }
  state.programs = { data: LIST }
}

const ui = () => (
  <MemoryRouter initialEntries={['/plan']}>
    <ProgramsTab onTab={() => undefined} />
  </MemoryRouter>
)
const renderTab = () => render(ui())

const rowOf = (id: string) => document.querySelector(`[data-program="${id}"]`) as HTMLElement
const footOf = (id: string) => rowOf(id).lastElementChild as HTMLElement
const deleteButtonOf = (id: string) => within(rowOf(id)).getByText('DELETE').closest('button') as HTMLButtonElement
/** The dialog's panel, found from its title. */
const panelOf = (title: string) => screen.getByText(title).parentElement as HTMLElement
const confirmButton = (title: string) => within(panelOf(title)).getByRole('button', { name: /^DELET/ }) as HTMLButtonElement

describe('the foot of a row — OPEN · START · DELETE', () => {
  it('ends every row in OPEN, START and DELETE, in that order, in three equal columns (the prototype\'s grid)', () => {
    running()
    renderTab()

    for (const { id } of LIST) {
      const foot = footOf(id)
      expect(Array.from(foot.children).map((el) => el.firstChild?.textContent), id).toEqual(['OPEN', 'START', 'DELETE'])
      expect(foot.style.gridTemplateColumns, id).toBe('repeat(3, minmax(0, 1fr))')
    }
    // OPEN is still a link to that program's planner, START still a button
    expect(footOf('prog-fb').children[0].tagName).toBe('A')
    expect(footOf('prog-fb').children[0].getAttribute('href')).toBe('/program/prog-fb')
    expect(footOf('prog-fb').children[1].tagName).toBe('BUTTON')
    expect(footOf('prog-fb').children[2].tagName).toBe('BUTTON')
  })

  it('the running program\'s DELETE is greyed (disabled, --text-dim) with FINISH IT FIRST under it; pressing it opens nothing', () => {
    running()
    renderTab()

    const button = deleteButtonOf('prog-ppl')
    expect(button.disabled).toBe(true)
    expect(button.style.color).toBe('var(--text-dim)')
    expect(within(button).getByText('FINISH IT FIRST')).toBeTruthy()

    fireEvent.click(button)

    expect(screen.queryByText(/^Delete /)).toBeNull()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('every other row\'s DELETE is enabled (--text-muted) and has no caption: FINISH IT FIRST is on the screen once', () => {
    running()
    renderTab()

    for (const id of ['prog-ul', 'prog-fb', 'prog-ppl-2', 'prog-strength']) {
      const button = deleteButtonOf(id)
      expect(button.disabled, id).toBe(false)
      expect(button.style.color, id).toBe('var(--text-muted)')
      expect(within(button).queryByText('FINISH IT FIRST'), id).toBeNull()
    }
    expect(screen.getAllByText('FINISH IT FIRST')).toHaveLength(1)
  })

  it('the greyed row follows the run\'s source program (an id), not a name: the program with the running one\'s name is not greyed', () => {
    running()
    renderTab()
    expect(deleteButtonOf('prog-ppl-2').disabled).toBe(false)
    expect(within(rowOf('prog-ppl-2')).queryByText('FINISH IT FIRST')).toBeNull()
    expect(within(rowOf('prog-ppl-2')).queryByText('RUNNING')).toBeNull()
  })

  it('with no program running every row\'s DELETE is enabled and nothing says FINISH IT FIRST', () => {
    notRunning()
    renderTab()
    for (const { id } of LIST) expect(deleteButtonOf(id).disabled, id).toBe(false)
    expect(screen.queryByText('FINISH IT FIRST')).toBeNull()
  })

  it('a run with no source program (an older run) greys no row', () => {
    running()
    state.mesos = { data: [{ ...ACTIVE, sourceProgramId: null }] }
    renderTab()
    for (const { id } of LIST) expect(deleteButtonOf(id).disabled, id).toBe(false)
    expect(screen.queryByText('FINISH IT FIRST')).toBeNull()
  })

  it('a finished program has no delete control on this tab (it is deleted from its own page, chunk 66), nor has the running program\'s card', () => {
    running()
    renderTab()
    expect(screen.getAllByText('DELETE')).toHaveLength(LIST.length) // one per YOUR PROGRAMS row, nowhere else
    expect(screen.queryByLabelText(/delete/i)).toBeNull()
  })
})

describe('the confirm — "Delete [name]?" (SPEC; DECISIONS 251: the UI never says "run")', () => {
  it('asks first, in SPEC\'s words, with CANCEL and a red DELETE; CANCEL deletes nothing and leaves the row', () => {
    running()
    renderTab()
    expect(screen.queryByText('Delete Upper / Lower?')).toBeNull()

    fireEvent.click(deleteButtonOf('prog-ul'))

    expect(screen.getByText('Delete Upper / Lower?')).toBeTruthy()
    expect(screen.getByText('It leaves YOUR PROGRAMS. Its finished programs stay in History.')).toBeTruthy()
    expect(within(panelOf('Delete Upper / Lower?')).getByRole('button', { name: 'CANCEL' })).toBeTruthy()
    const button = confirmButton('Delete Upper / Lower?')
    expect(button.textContent).toBe('DELETE')
    expect(button.disabled).toBe(false)
    expect(button.style.background).toBe('var(--error)') // danger: red
    // the word the guard refuses is not on the dialog
    expect(panelOf('Delete Upper / Lower?').textContent).not.toMatch(/\bruns?\b/i)

    fireEvent.click(within(panelOf('Delete Upper / Lower?')).getByRole('button', { name: 'CANCEL' }))

    expect(screen.queryByText('Delete Upper / Lower?')).toBeNull()
    expect(deleteMock).not.toHaveBeenCalled()
    expect(rowOf('prog-ul')).toBeTruthy()
  })

  it.each([
    ['prog-ul', 'Upper / Lower'],
    ['prog-fb', 'Full Body 3x'],
    ['prog-ppl-2', 'Push Pull Legs'],
    ['prog-strength', 'Strength'],
  ])('W: DELETE on %s (%s) sends THAT program\'s id, once, and the dialog closes when it is done', async (id, name) => {
    running()
    deleteMock.mockResolvedValue(undefined)
    renderTab()

    fireEvent.click(deleteButtonOf(id))
    fireEvent.click(confirmButton(`Delete ${name}?`))

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1))
    expect(deleteMock).toHaveBeenCalledWith(id) // the row's own id: not the first row's, not the run's, not the run's source program
    await waitFor(() => expect(screen.queryByText(`Delete ${name}?`)).toBeNull())
  })

  it('pressing DELETE on the second row and then the last, each confirm names its own program', () => {
    running()
    renderTab()

    fireEvent.click(deleteButtonOf('prog-ul'))
    expect(screen.getByText('Delete Upper / Lower?')).toBeTruthy()
    fireEvent.click(within(panelOf('Delete Upper / Lower?')).getByRole('button', { name: 'CANCEL' }))
    fireEvent.click(deleteButtonOf('prog-strength'))

    expect(screen.getByText('Delete Strength?')).toBeTruthy()
    expect(screen.queryByText('Delete Upper / Lower?')).toBeNull()
  })

  it('PR7-style: while the delete is out the button says DELETING… and cannot be pressed again', () => {
    running()
    state.deletePending = true
    renderTab()
    fireEvent.click(deleteButtonOf('prog-fb'))

    const pending = screen.getByRole('button', { name: 'DELETING…' }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
  })

  it('two presses in the same instant delete it once', async () => {
    running()
    deleteMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(undefined), 20)))
    renderTab()
    fireEvent.click(deleteButtonOf('prog-fb'))
    const button = confirmButton('Delete Full Body 3x?')

    await act(async () => {
      button.click()
      button.click()
    })

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1))
  })

  it('after a cancelled confirm, DELETE on the same row asks again with a clean question: no error left in it', async () => {
    running()
    deleteMock.mockRejectedValueOnce({ code: 'P0002', message: 'program not found' })
    renderTab()
    fireEvent.click(deleteButtonOf('prog-fb'))
    fireEvent.click(confirmButton('Delete Full Body 3x?'))
    expect(await screen.findByText('program not found')).toBeTruthy()
    fireEvent.click(within(panelOf('Delete Full Body 3x?')).getByRole('button', { name: 'CANCEL' }))

    fireEvent.click(deleteButtonOf('prog-fb'))

    expect(screen.getByText('Delete Full Body 3x?')).toBeTruthy()
    expect(screen.queryByText('program not found')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('offline — deleting needs a connection (SPEC Rules 2): nothing is sent, nothing is queued', () => {
  it('the confirm says "You\'re offline. Deleting needs a connection." in place of the question, and its DELETE is off (it keeps its label)', () => {
    running()
    state.online = false
    renderTab()

    fireEvent.click(deleteButtonOf('prog-ul'))

    expect(screen.getByText('Delete Upper / Lower?')).toBeTruthy()
    expect(screen.getByText("You're offline. Deleting needs a connection.")).toBeTruthy()
    expect(screen.queryByText('It leaves YOUR PROGRAMS. Its finished programs stay in History.')).toBeNull()
    const button = confirmButton('Delete Upper / Lower?')
    expect(button.textContent).toBe('DELETE') // not DELETING…: nothing is going out
    expect(button.disabled).toBe(true)
    // CANCEL still works
    expect(within(panelOf('Delete Upper / Lower?')).getByRole('button', { name: 'CANCEL' }).hasAttribute('disabled')).toBe(false)
  })

  it('pressing the off DELETE sends nothing', () => {
    running()
    state.online = false
    renderTab()
    fireEvent.click(deleteButtonOf('prog-ul'))

    fireEvent.click(confirmButton('Delete Upper / Lower?'))
    confirmButton('Delete Upper / Lower?').click()

    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('the row\'s own DELETE still opens the confirm offline (the confirm is where it says so)', () => {
    running()
    state.online = false
    renderTab()
    expect(deleteButtonOf('prog-ul').disabled).toBe(false)
  })

  it('a phone that goes offline under an open confirm switches it to the offline words, and back online restores the question and DELETE', () => {
    running()
    const view = renderTab()
    fireEvent.click(deleteButtonOf('prog-fb'))
    expect(screen.getByText('It leaves YOUR PROGRAMS. Its finished programs stay in History.')).toBeTruthy()
    expect(confirmButton('Delete Full Body 3x?').disabled).toBe(false)

    state.online = false
    view.rerender(ui())
    expect(screen.getByText("You're offline. Deleting needs a connection.")).toBeTruthy()
    expect(confirmButton('Delete Full Body 3x?').disabled).toBe(true)

    state.online = true
    view.rerender(ui())
    expect(screen.getByText('It leaves YOUR PROGRAMS. Its finished programs stay in History.')).toBeTruthy()
    expect(screen.queryByText("You're offline. Deleting needs a connection.")).toBeNull()
    expect(confirmButton('Delete Full Body 3x?').disabled).toBe(false)
  })
})

describe('a refused or failed delete stays inside the confirm', () => {
  it('OL002 (a program with a running program: the run started on another phone since this list was read) says "Couldn\'t delete [name]." with the database\'s reason; the dialog stays and the row stays', async () => {
    notRunning() // this phone's list doesn't know the run yet: the delete is offered, and the database refuses it
    const reason = 'a program with a running program cannot be deleted: finish it first'
    deleteMock.mockRejectedValue({ code: 'OL002', message: reason })
    renderTab()
    fireEvent.click(deleteButtonOf('prog-ul'))

    fireEvent.click(confirmButton('Delete Upper / Lower?'))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Couldn't delete Upper / Lower.")).toBeTruthy()
    expect(within(alert).getByText(reason)).toBeTruthy()
    expect(screen.getByText('Delete Upper / Lower?')).toBeTruthy()
    expect(panelOf('Delete Upper / Lower?').contains(alert)).toBe(true) // inside the confirm, not a toast
    expect(rowOf('prog-ul')).toBeTruthy()
    expect(confirmButton('Delete Upper / Lower?').disabled).toBe(false) // a retry is possible
  })

  it('a retry clears the earlier error at once, while it is out, and a second try that works closes the dialog', async () => {
    running()
    deleteMock.mockRejectedValueOnce({ code: 'OL001', message: 'Overload is being updated. Writes are refused until maintenance is off.' })
    renderTab()
    fireEvent.click(deleteButtonOf('prog-fb'))
    fireEvent.click(confirmButton('Delete Full Body 3x?'))
    expect(await screen.findByText('Overload is being updated. Writes are refused until maintenance is off.')).toBeTruthy()

    deleteMock.mockReturnValueOnce(new Promise(() => undefined)) // never answers: the retry stays out
    fireEvent.click(confirmButton('Delete Full Body 3x?'))

    expect(screen.queryByText('Overload is being updated. Writes are refused until maintenance is off.')).toBeNull()
    expect(deleteMock).toHaveBeenCalledTimes(2)
  })

  it('a retry that works closes the dialog', async () => {
    running()
    deleteMock.mockRejectedValueOnce({ message: 'first failure' })
    renderTab()
    fireEvent.click(deleteButtonOf('prog-fb'))
    fireEvent.click(confirmButton('Delete Full Body 3x?'))
    expect(await screen.findByText('first failure')).toBeTruthy()

    deleteMock.mockResolvedValue(undefined)
    fireEvent.click(confirmButton('Delete Full Body 3x?'))

    await waitFor(() => expect(screen.queryByText('Delete Full Body 3x?')).toBeNull())
    expect(deleteMock).toHaveBeenCalledTimes(2)
    expect(deleteMock).toHaveBeenLastCalledWith('prog-fb')
  })

  it.each([
    [false, 'Something went wrong.'],
    [true, 'You may be offline.'],
  ])('an error with no message, the phone offline: %s, says "%s" under "Couldn\'t delete [name]."', async (offline, line) => {
    running()
    deleteMock.mockRejectedValue({})
    const view = renderTab()
    fireEvent.click(deleteButtonOf('prog-fb'))
    fireEvent.click(confirmButton('Delete Full Body 3x?'))
    await screen.findByRole('alert')
    if (offline) {
      state.online = false
      view.rerender(ui()) // the phone lost its connection after the failure
    }

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText("Couldn't delete Full Body 3x.")).toBeTruthy()
    expect(within(alert).getByText(line)).toBeTruthy()
  })

  it('a name with no break in it wraps in the question and in the failure line (RULES: ConfirmDialog wraps its title, a caller wraps the name in the body)', async () => {
    running()
    const LONG = 'B'.repeat(80)
    state.saved = { data: [PPL, { ...UL, name: LONG }] }
    deleteMock.mockRejectedValue({ message: 'R'.repeat(120) })
    renderTab()
    fireEvent.click(deleteButtonOf('prog-ul'))
    const title = screen.getByText(`Delete ${LONG}?`)
    expect(title.style.overflowWrap).toBe('anywhere')

    fireEvent.click(within(title.parentElement as HTMLElement).getByRole('button', { name: 'DELETE' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(`Couldn't delete ${LONG}.`).style.overflowWrap).toBe('anywhere')
    expect(within(alert).getByText('R'.repeat(120)).style.overflowWrap).toBe('anywhere')
  })
})

describe('closing', () => {
  it('a delete that answers after CANCEL, with another program\'s confirm open by then, leaves that confirm open', async () => {
    running()
    let answer!: () => void
    deleteMock.mockImplementationOnce(() => new Promise<void>((resolve) => { answer = resolve }))
    renderTab()
    fireEvent.click(deleteButtonOf('prog-ul'))
    fireEvent.click(confirmButton('Delete Upper / Lower?'))
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1))
    fireEvent.click(within(panelOf('Delete Upper / Lower?')).getByRole('button', { name: 'CANCEL' }))
    fireEvent.click(deleteButtonOf('prog-strength'))
    expect(screen.getByText('Delete Strength?')).toBeTruthy()

    await act(async () => {
      answer()
    })

    expect(screen.getByText('Delete Strength?')).toBeTruthy()
    expect(screen.queryByText('Delete Upper / Lower?')).toBeNull()
  })

  it('the scrim closes the confirm too, and deletes nothing', () => {
    running()
    renderTab()
    fireEvent.click(deleteButtonOf('prog-fb'))

    const scrim = panelOf('Delete Full Body 3x?').parentElement as HTMLElement
    fireEvent.click(scrim)

    expect(screen.queryByText('Delete Full Body 3x?')).toBeNull()
    expect(deleteMock).not.toHaveBeenCalled()
  })
})

describe('what the empty states keep (SPEC: "No programs yet", unchanged)', () => {
  it('with no saved program, no run and nothing finished it is still PR3, with no DELETE anywhere', () => {
    state.mesos = { data: [] }
    state.saved = { data: [] }
    state.programs = { data: [] }
    renderTab()
    expect(screen.getByText('No programs yet')).toBeTruthy()
    expect(screen.queryByText('DELETE')).toBeNull()
  })
})

// ─── 375 px ──────────────────────────────────────────────────────────────────

describe('375 px', () => {
  it('the foot\'s three columns hold the widest caption (FINISH IT FIRST) in a third of the line, and no element carries a fixed pixel width past the screen', () => {
    running()
    const { container } = renderTab()

    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(el.style[prop])
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${el.style[prop]}`)
      }
    }
    expect(offenders).toEqual([])
    // the columns share the line equally and may shrink (minmax(0, 1fr)): the caption can't push a column wider
    expect(footOf('prog-ppl').style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))')
  })
})
