// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Mesocycle, Program, WeeklySchedule } from '../../types'
import type { StoredMark } from '../../lib/priorityMarks'
import { captureRender } from '../../testing/captureRender'

// Chunk 65's screens, rendered the way the boards draw them, for the 390 px screenshots beside the boards (`CAPTURE_RENDER=1` writes
// `__fixtures__/programs-<board>.html`; `npm run shot` turns each into design/1.2/built/<board-id>.png + .txt). Each test captures first, then
// asserts the few things that say the capture is the state its board draws (RULES: a fixture is captured before it asserts, so a broken rule
// still writes the fixture the Chromium check measures). Boards: PR1 (a program running), PR2 (none running, PLAN tapped), PR3 (no programs),
// PR4 (loading), PR6 and PR7 (FINISH, asking and finishing), PR8 (start, none running), PR9 (start, one running), PR10 (a failed start),
// PR11 (a program with no schedule), PR12 (no programs to start), PR13 and PR13b (the New program sheet, empty and both chosen). PR5 is
// today's PrioritiesEditor (TASKS: its entry, the FOCUS row, is PR1's).
//
// The fixture names read "programs-pr1" and so on; none is a utility-shaped word (RULES: Tailwind builds the stylesheet from every
// tracked file, and an id like those the rules name would add a rule to it).
//
// Chunk 74 (1.2.1 item 8a) adds the four DEMO states of the prototype's "Programs · YOUR PROGRAMS" at the bottom — Normal, Delete, Delete offline, No
// programs — as `programs-your-programs-<state>` (turned into design/1.2.1/built/<same name>.png + .txt by `npm run shot`), and one long-name
// variant of the confirm for the Chromium check of a name with no break in it.

const state = vi.hoisted(() => ({
  mesos: [] as unknown[],
  saved: [] as unknown[],
  programs: [] as unknown[],
  loading: false,
  today: '2026-10-14', // a Wednesday: the run below started on Monday 5 Oct, so this is its week 2, as PR1 says
  marks: [] as unknown[],
  workoutDays: {} as Record<string, unknown[]>,
  startError: null as unknown,
  pending: false,
  online: true,
}))
const startRunMock = vi.hoisted(() => vi.fn())
const completeMock = vi.hoisted(() => vi.fn())
const deleteMock = vi.hoisted(() => vi.fn())

vi.mock('./useMesos', () => ({
  useMesos: () => (state.loading ? { data: undefined, isLoading: true } : { data: state.mesos }),
  useStartRun: () => ({ mutateAsync: startRunMock, isPending: state.pending }),
  useCompleteMeso: () => ({ mutateAsync: completeMock, isPending: state.pending }),
}))
vi.mock('./usePrograms', () => ({
  useSavedPrograms: () => ({ data: state.saved }),
  usePrograms: () => ({ data: state.programs }),
  useCreateProgram: () => ({ mutateAsync: vi.fn(), isPending: state.pending }),
  useDeleteSavedProgram: () => ({ mutateAsync: deleteMock, isPending: state.pending }),
  useWorkoutDays: (programId: string) => ({ data: programId ? state.workoutDays[programId] : undefined }),
  useSequenceItems: () => ({ data: undefined }),
}))
vi.mock('../plan/useProgramPriorities', () => ({ useProgramPriorities: () => ({ data: state.marks }) }))
vi.mock('../plan/useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: null, failed: false, error: null }) }))
// the card's weekday rows (1.2.1 item 19): none, so the run's own copy is in force in every week, as these boards were drawn
vi.mock('../plan/useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('../../hooks/useToday', () => ({ useToday: () => state.today }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => state.online }))

const { default: ProgramsTab } = await import('./ProgramsTab')
const { default: StartProgramSheet } = await import('./StartProgramSheet')

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
  state.mesos = []
  state.saved = []
  state.programs = []
  state.loading = false
  state.marks = []
  state.workoutDays = {}
  state.pending = false
  state.online = true
})
afterEach(() => {
  cleanup()
  startRunMock.mockReset()
  completeMock.mockReset()
  deleteMock.mockReset()
})

const NO_DAYS: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
function program(over: Partial<Program> & Pick<Program, 'id' | 'name'>): Program {
  return { userId: 'user-1', schedule: NO_DAYS, workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'saved', planningType: 'stable', scheduleType: 'weekday', ...over }
}
const FIVE_DAYS: WeeklySchedule = { ...NO_DAYS, monday: 'wd-a', tuesday: 'wd-b', wednesday: 'wd-c', thursday: 'wd-a', friday: 'wd-d' }
const FOUR_DAYS: WeeklySchedule = { ...NO_DAYS, monday: 'wd-a', tuesday: 'wd-b', thursday: 'wd-a', friday: 'wd-b' }

const PPL = program({ id: 'prog-ppl', name: 'Push Pull Legs', schedule: FIVE_DAYS, planningType: 'stable' })
const UL = program({ id: 'prog-ul', name: 'Upper / Lower', schedule: FOUR_DAYS, planningType: 'week_dependent' })
const STRENGTH = program({ id: 'prog-strength', name: 'Strength' }) // no workout on any weekday: PR11
const RUN_COPY = program({ id: 'prog-run', name: 'Push Pull Legs', kind: 'run', schedule: FIVE_DAYS, planningType: 'stable' })
const ACTIVE: Mesocycle = { id: 'meso-active', userId: 'user-1', name: 'Push Pull Legs', programId: 'prog-run', sourceProgramId: 'prog-ppl', status: 'active', startDate: '2026-10-05', endDate: null, createdAt: '2026-10-05T08:00:00Z' }
const FINISHED: Mesocycle[] = [
  { id: 'meso-fin-1', userId: 'user-1', name: 'Push Pull Legs', programId: 'prog-old-1', status: 'completed', startDate: '2026-09-14', endDate: '2026-10-04', createdAt: '2026-09-14T08:00:00Z' },
  { id: 'meso-fin-2', userId: 'user-1', name: 'Cut PPL', programId: 'prog-old-2', status: 'completed', startDate: '2026-07-06', endDate: '2026-09-13', createdAt: '2026-07-06T08:00:00Z' },
]
const mark = (tagType: StoredMark['tagType'], tagValue: string, value: StoredMark['mark']): StoredMark => ({ tagType, tagValue, mark: value, updatedAt: '2026-01-01T00:00:00Z' })
const MARKS = [mark('muscle_group', 'chest', 'focus'), mark('muscle_group', 'back', 'focus'), mark('muscle_group', 'forearms', 'dont_care'), mark('muscle_group', 'calves', 'dont_care')]

/** PR1's world: Push Pull Legs running (week 2), two saved programs, two finished. */
function running() {
  state.mesos = [ACTIVE, ...FINISHED]
  state.saved = [PPL, UL]
  state.programs = [RUN_COPY, PPL, UL]
  state.marks = MARKS
  state.workoutDays = { 'prog-ppl': [{ id: 'wd-a' }], 'prog-ul': [{ id: 'wd-a' }], 'prog-strength': [{ id: 'wd-x' }] }
}
/** PR2's world: the same programs, none running. */
function notRunning() {
  state.mesos = [...FINISHED]
  state.saved = [PPL, UL]
  state.programs = [PPL, UL]
  state.workoutDays = { 'prog-ppl': [{ id: 'wd-a' }], 'prog-ul': [{ id: 'wd-a' }], 'prog-strength': [{ id: 'wd-x' }] }
}

const ui = () => (
  <MemoryRouter initialEntries={['/plan']}>
    <ProgramsTab onTab={() => undefined} />
  </MemoryRouter>
)

describe('PR1 — a program running', () => {
  it('PLAN | PROGRAMS, "PUSH PULL LEGS · WEEK 2", the card, YOUR PROGRAMS (RUNNING on the first), FINISHED', () => {
    running()
    render(ui())
    captureRender('programs-pr1', document.body)

    expect(screen.getByText('PUSH PULL LEGS · WEEK 2')).toBeTruthy()
    expect(screen.getByText('WEEK 2')).toBeTruthy()
    expect(screen.getByText('Weekdays · stable · 5 days a week')).toBeTruthy()
    expect(screen.getByText('Chest, back')).toBeTruthy()
    expect(screen.getByText('RUNNING')).toBeTruthy()
    expect(screen.getByText('SEP 14 – OCT 4, 2026 · 3 WEEKS')).toBeTruthy()
  })
})

describe('PR2 — no program running, PLAN tapped', () => {
  it('PLAN locked with its hint under it, "No program running", the programs with START, FINISHED', () => {
    notRunning()
    render(ui())
    fireEvent.click(screen.getByRole('tab', { name: 'PLAN' }))
    captureRender('programs-pr2', document.body)

    expect(screen.getByText('Start a program to plan your weeks.')).toBeTruthy()
    expect(screen.getByText('NO PROGRAM RUNNING')).toBeTruthy()
    expect(screen.getByText('No program running')).toBeTruthy()
    expect(screen.queryByText('RUNNING')).toBeNull()
  })
})

describe('PR3 — no programs yet', () => {
  it('says what a program is and offers NEW PROGRAM', () => {
    render(ui())
    captureRender('programs-pr3', document.body)
    expect(screen.getByText('No programs yet')).toBeTruthy()
  })
})

describe('PR4 — loading', () => {
  it('LOADING under the tabs, a spinner under CURRENT PROGRAM', () => {
    state.loading = true
    render(ui())
    captureRender('programs-pr4', document.body)
    expect(screen.getByText('LOADING')).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
  })
})

describe('PR6 and PR7 — FINISH', () => {
  it('PR6: "Finish Push Pull Legs?", the two lines, CANCEL and FINISH', () => {
    running()
    render(ui())
    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
    captureRender('programs-pr6', document.body)
    expect(screen.getByText('Finish Push Pull Legs?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeTruthy()
  })

  it('PR7: the same with FINISHING… on the button', () => {
    running()
    state.pending = true
    render(ui())
    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
    captureRender('programs-pr7', document.body)
    expect(screen.getByRole('button', { name: 'FINISHING…' })).toBeTruthy()
  })
})

describe('PR8 to PR12 — START', () => {
  const openStart = (programName: string) => fireEvent.click(within(screen.getByText(programName).closest('[data-program]') as HTMLElement).getByText('START'))

  it('PR8: "Start a program", the name field, the list with Upper / Lower picked, START PROGRAM', () => {
    notRunning()
    state.saved = [PPL, UL, STRENGTH]
    render(ui())
    openStart('Upper / Lower')
    captureRender('programs-pr8', document.body)
    expect(screen.getByRole('dialog', { name: 'Start a program' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Upper / Lower' }).getAttribute('aria-checked')).toBe('true')
  })

  it('PR9: "Start a new program" and the line that starting finishes Push Pull Legs', () => {
    running()
    state.saved = [PPL, UL, STRENGTH]
    render(ui())
    openStart('Upper / Lower')
    captureRender('programs-pr9', document.body)
    expect(screen.getByRole('dialog', { name: 'Start a new program' })).toBeTruthy()
    expect(screen.getByText('Starting it finishes Push Pull Legs. Its weeks stay in History.')).toBeTruthy()
  })

  it('PR10: the failed start\'s banner at the top, the reason under it', async () => {
    running()
    state.saved = [PPL, UL, STRENGTH]
    startRunMock.mockRejectedValue({ message: 'DELETE requires a WHERE clause' })
    render(ui())
    openStart('Upper / Lower')
    fireEvent.click(screen.getByRole('button', { name: 'START PROGRAM' }))
    await act(async () => { await Promise.resolve() })
    await screen.findByRole('alert')
    captureRender('programs-pr10', document.body)
    expect(screen.getByText("Couldn't start Upper / Lower.")).toBeTruthy()
    expect(screen.getByText('DELETE requires a WHERE clause')).toBeTruthy()
  })

  it('PR11: Strength picked, START PROGRAM off and the reason under it', () => {
    running()
    state.saved = [PPL, UL, STRENGTH]
    state.programs = [RUN_COPY, PPL, UL, STRENGTH]
    state.workoutDays = { ...state.workoutDays, 'prog-strength': [{ id: 'wd-x' }] }
    render(ui())
    openStart('Upper / Lower')
    fireEvent.click(screen.getByRole('radio', { name: 'Strength' }))
    captureRender('programs-pr11', document.body)
    expect((screen.getByRole('button', { name: 'START PROGRAM' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Schedule at least one workout to start.')).toBeTruthy()
  })

  it('PR12: no programs to start: "Create a program first." and CREATE PROGRAM, over the tab', () => {
    // nothing offers a START with no program to start: the sheet is opened over the tab with an empty list (a program that goes while the
    // tab is open), which is the state the board draws
    notRunning()
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <ProgramsTab onTab={() => undefined} />
        <StartProgramSheet programs={[]} runningName={null} onClose={() => undefined} onCreateProgram={() => undefined} />
      </MemoryRouter>,
    )
    captureRender('programs-pr12', document.body)
    expect(screen.getByRole('dialog', { name: 'Start a program' })).toBeTruthy()
    expect(screen.getByText('Create a program first.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CREATE PROGRAM' })).toBeTruthy()
  })
})

// Long names, for the Chromium checks at 375 px (the sheet check measures inside every dialog; the page check measures the tab): an unbroken
// 80-letter name in every place a program's or a run's name is drawn (RULES, 128 (i): "nothing runs past its line"). Not boards.
describe('long names (Chromium checks; not boards)', () => {
  const LONG = 'B'.repeat(80)

  it('the tab with a long run, program and finished-run name', () => {
    running()
    state.mesos = [{ ...ACTIVE, name: LONG }, { ...FINISHED[0], name: LONG }]
    state.saved = [{ ...PPL, name: LONG }, UL]
    render(ui())
    captureRender('programs-pr1-long-name', document.body)
    expect(screen.getAllByText(LONG).length).toBeGreaterThan(2)
  })

  it('PR9 with a long program name picked and a long running program\'s name in the line', () => {
    running()
    state.mesos = [{ ...ACTIVE, name: LONG }]
    state.saved = [{ ...PPL, name: LONG }, UL, STRENGTH]
    render(ui())
    fireEvent.click(within(screen.getAllByText(LONG)[1].closest('[data-program]') as HTMLElement).getByText('START'))
    captureRender('programs-pr9-long-name', document.body)
    expect(screen.getByRole('radio', { name: LONG }).getAttribute('aria-checked')).toBe('true')
  })

  it('PR10 with a long unbroken reason', async () => {
    running()
    state.saved = [{ ...PPL, name: LONG }, UL]
    startRunMock.mockRejectedValue({ message: 'R'.repeat(120) })
    render(ui())
    fireEvent.click(within(screen.getByText(LONG).closest('[data-program]') as HTMLElement).getByText('START'))
    fireEvent.click(screen.getByRole('button', { name: 'START PROGRAM' }))
    await act(async () => { await Promise.resolve() })
    await screen.findByRole('alert')
    captureRender('programs-pr10-long-name', document.body)
    expect(screen.getByText('R'.repeat(120))).toBeTruthy()
  })

  it('PR6 with a long run name in the question, and then a failed finish that names it', async () => {
    running()
    state.mesos = [{ ...ACTIVE, name: LONG }]
    completeMock.mockRejectedValue({ message: 'R'.repeat(120) })
    render(ui())
    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
    captureRender('programs-pr6-long-name', document.body)
    expect(screen.getByText(`Finish ${LONG}?`)).toBeTruthy()

    fireEvent.click(within(screen.getByText(`Finish ${LONG}?`).parentElement!.parentElement!).getByRole('button', { name: 'FINISH' }))
    await screen.findByRole('alert')
    captureRender('programs-pr6-failed-long-name', document.body)
    expect(screen.getByText(`Couldn't finish ${LONG}.`)).toBeTruthy()
  })

  it('PR13 with a long name typed', () => {
    running()
    render(ui())
    fireEvent.click(screen.getByText('+ NEW PROGRAM'))
    fireEvent.change(screen.getByLabelText('PROGRAM NAME'), { target: { value: LONG } })
    captureRender('programs-pr13-long-name', document.body)
    expect((screen.getByLabelText('PROGRAM NAME') as HTMLInputElement).value).toBe(LONG)
  })
})

describe('PR13 and PR13b — New program', () => {
  it('PR13: Upper / Lower typed, nothing chosen: CHOOSE ONE twice, CREATE PROGRAM off, the line why', () => {
    running()
    render(ui())
    fireEvent.click(screen.getByText('+ NEW PROGRAM'))
    fireEvent.change(screen.getByLabelText('PROGRAM NAME'), { target: { value: 'Upper / Lower' } })
    captureRender('programs-pr13', document.body)
    expect(screen.getAllByText('CHOOSE ONE')).toHaveLength(2)
    expect(screen.getByText('Choose a schedule and a planning type to create it.')).toBeTruthy()
  })

  it('PR13b: Weekdays and Stable chosen: CREATE PROGRAM on, the line that both can be changed later', () => {
    running()
    render(ui())
    fireEvent.click(screen.getByText('+ NEW PROGRAM'))
    fireEvent.change(screen.getByLabelText('PROGRAM NAME'), { target: { value: 'Upper / Lower' } })
    fireEvent.click(screen.getByRole('radio', { name: /^Weekdays/ }))
    fireEvent.click(screen.getByRole('radio', { name: /^Stable/ }))
    captureRender('programs-pr13b', document.body)
    expect((screen.getByRole('button', { name: 'CREATE PROGRAM' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('You can change both later in the program.')).toBeTruthy()
  })
})

// ─── Chunk 74 — Programs · YOUR PROGRAMS, the prototype's four DEMO states (1.2.1 item 8a) ───────────────────────────────────────────────────────
// The prototype's world (prototype/src/demo/seed.ts): Upper/Lower runs, three saved programs (the one that runs first), three finished. Its Delete
// states open the confirm on the first saved program that is not the running one: Push Pull Legs.

describe('Programs · YOUR PROGRAMS (1.2.1 item 8a)', () => {
  const UPPER_LOWER = program({ id: 'sp-ul', name: 'Upper/Lower', schedule: FOUR_DAYS, planningType: 'week_dependent' })
  const PUSH_PULL_LEGS = program({ id: 'sp-ppl', name: 'Push Pull Legs', schedule: FIVE_DAYS, planningType: 'stable' })
  const FULL_BODY = program({ id: 'sp-fb', name: 'Full Body 3x', schedule: { ...NO_DAYS, monday: 'wd-a', wednesday: 'wd-b', friday: 'wd-c' }, planningType: 'stable' })
  const UL_COPY = program({ id: 'rc-ul', name: 'Upper/Lower', kind: 'run', schedule: FOUR_DAYS, planningType: 'week_dependent' })
  const RUN: Mesocycle = { id: 'm-active', userId: 'user-1', name: 'Upper/Lower', programId: 'rc-ul', sourceProgramId: 'sp-ul', status: 'active', startDate: '2026-10-12', endDate: null, createdAt: '2026-10-12T08:00:00Z' }
  const DONE: Mesocycle[] = [
    { id: 'm-ppl2', userId: 'user-1', name: 'Push Pull Legs', programId: 'rc-ppl2', sourceProgramId: 'sp-ppl', status: 'completed', startDate: '2026-10-05', endDate: '2026-10-11', createdAt: '2026-10-05T08:00:00Z' },
    { id: 'm-cut', userId: 'user-1', name: 'Cut PPL', programId: 'rc-cut', sourceProgramId: 'sp-ppl', status: 'completed', startDate: '2026-07-06', endDate: '2026-09-13', createdAt: '2026-07-06T08:00:00Z' },
    { id: 'm-old', userId: 'user-1', name: 'Strength Block', programId: 'rc-old', sourceProgramId: 'sp-ppl', status: 'completed', startDate: '2026-04-06', endDate: '2026-06-14', createdAt: '2026-04-06T08:00:00Z' },
  ]
  const demoWorld = () => {
    state.today = '2026-10-14'
    state.mesos = [RUN, ...DONE]
    state.saved = [UPPER_LOWER, PUSH_PULL_LEGS, FULL_BODY]
    state.programs = [UL_COPY, UPPER_LOWER, PUSH_PULL_LEGS, FULL_BODY]
    state.workoutDays = { 'sp-ul': [{ id: 'wd-a' }], 'sp-ppl': [{ id: 'wd-a' }], 'sp-fb': [{ id: 'wd-a' }] }
  }
  // by the row's id: the running program's name is also on the card above the list
  const rowOf = (id: string) => document.querySelector(`[data-program="${id}"]`) as HTMLElement
  const deleteOf = (id: string) => within(rowOf(id)).getByText('DELETE').closest('button') as HTMLButtonElement

  it('Normal: OPEN · START · DELETE on every row; the running program\'s DELETE greyed with FINISH IT FIRST under it', () => {
    demoWorld()
    render(ui())
    captureRender('programs-your-programs-normal', document.body)

    expect(screen.getAllByText('DELETE')).toHaveLength(3)
    expect(screen.getAllByText('FINISH IT FIRST')).toHaveLength(1)
    expect(deleteOf('sp-ul').disabled).toBe(true)
    expect(deleteOf('sp-ppl').disabled).toBe(false)
    expect(deleteOf('sp-fb').disabled).toBe(false)
    expect(within(rowOf('sp-ul')).getByText('RUNNING')).toBeTruthy()
  })

  it('Delete: "Delete Push Pull Legs?", the two sentences, CANCEL and a red DELETE', () => {
    demoWorld()
    render(ui())
    fireEvent.click(deleteOf('sp-ppl'))
    captureRender('programs-your-programs-delete', document.body)

    expect(screen.getByText('Delete Push Pull Legs?')).toBeTruthy()
    expect(screen.getByText('It leaves YOUR PROGRAMS. Its finished programs stay in History.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeTruthy()
    const confirm = within(screen.getByText('Delete Push Pull Legs?').parentElement as HTMLElement).getByRole('button', { name: 'DELETE' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    expect(confirm.style.background).toBe('var(--error)')
  })

  it('Delete offline: "You\'re offline. Deleting needs a connection." and DELETE off', () => {
    demoWorld()
    state.online = false
    render(ui())
    fireEvent.click(deleteOf('sp-ppl'))
    captureRender('programs-your-programs-delete-offline', document.body)

    expect(screen.getByText('Delete Push Pull Legs?')).toBeTruthy()
    expect(screen.getByText("You're offline. Deleting needs a connection.")).toBeTruthy()
    expect(screen.queryByText('It leaves YOUR PROGRAMS. Its finished programs stay in History.')).toBeNull()
    const confirm = within(screen.getByText('Delete Push Pull Legs?').parentElement as HTMLElement).getByRole('button', { name: 'DELETE' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
  })

  it('No programs: "No programs yet" (unchanged from 1.2), with no DELETE on the screen', () => {
    render(ui())
    captureRender('programs-your-programs-no-programs', document.body)

    expect(screen.getByText('No programs yet')).toBeTruthy()
    expect(screen.queryByText('DELETE')).toBeNull()
  })

  it('the confirm with a name that has no break in it, and a refused delete\'s reason under it (for the Chromium check of the dialog\'s width)', async () => {
    demoWorld()
    const LONG = 'X'.repeat(80)
    state.saved = [UPPER_LOWER, { ...PUSH_PULL_LEGS, name: LONG }, FULL_BODY]
    deleteMock.mockRejectedValue({ code: 'OL002', message: 'a program with a running program cannot be deleted: finish it first' })
    render(ui())
    fireEvent.click(deleteOf('sp-ppl'))
    fireEvent.click(within(screen.getByText(`Delete ${LONG}?`).parentElement as HTMLElement).getByRole('button', { name: 'DELETE' }))
    await screen.findByRole('alert')
    captureRender('programs-your-programs-delete-long-name', document.body)

    expect(screen.getByText(`Delete ${LONG}?`).style.overflowWrap).toBe('anywhere')
    expect(screen.getByText(`Couldn't delete ${LONG}.`).style.overflowWrap).toBe('anywhere')
  })
})
