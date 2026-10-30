// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { addDays, format, getDay, parseISO } from 'date-fns'
import type { Mesocycle, Program, WeeklySchedule } from '../../types'
import type { StoredMark } from '../../lib/priorityMarks'

// Chunk 65 — the PROGRAMS tab (TASKS-1.2 "The PROGRAMS tab"; SPEC Screens → PROGRAMS, Programs and runs [1.2], Navigation and settings [1.2]
// → PLAN | PROGRAMS (8), Language → "Program everywhere"; boards PR1, PR2, PR3, PR4, PR6, PR7). The tab at the screen: the states it draws
// (a program running, none running, no programs at all, loading, a read that failed), where each link goes (real routes, read back out of the
// location), FINISH, and what is absent now that the old page is gone. The sheets it opens are proven in StartProgramSheet.test.tsx and
// NewProgramSheet.test.tsx; they are mounted here for real, and the START and CREATE hooks are mocked at the seam, as every screen test of
// this app does.
//
// The fixtures tell the right data source from the wrong one: the run's marks and the saved program's differ (the card reads the run's own
// copy), a saved program has the running program's NAME but not its id (RUNNING follows the run's source program, not a name), and the run's
// own program and the saved one differ in their types (the card's line comes from the run's copy). Dates come from a Monday, printed by the
// first test (Checks that lied #21).

const MONDAY = '2026-10-05'
const day = (offset: number) => format(addDays(parseISO(MONDAY), offset), 'yyyy-MM-dd')
const TODAY = day(16) // a Wednesday, in the run's third week

const state = vi.hoisted(() => ({
  mesos: { data: [] as unknown[] } as { data: unknown[] | undefined; isLoading?: boolean; isError?: boolean; error?: unknown },
  saved: { data: [] as unknown[] } as { data: unknown[] | undefined; isLoading?: boolean; isError?: boolean; error?: unknown },
  programs: { data: [] as unknown[] } as { data: unknown[] | undefined; isLoading?: boolean; isError?: boolean; error?: unknown },
  marks: {} as Record<string, unknown[]>,
  cycle: { cycle: 2 as number | null, failed: false, error: null as unknown },
  today: '',
  workoutDays: {} as Record<string, unknown[]>,
  sequenceItems: {} as Record<string, unknown[]>,
  // the run's `v2_run_schedules` rows: [] is an answer (none), undefined is not read yet
  schedules: [] as unknown[] | undefined,
}))
const calls = vi.hoisted(() => ({ priorities: [] as Array<string | null>, cycle: [] as Array<[string, string]>, schedule: [] as Array<string | undefined> }))
const completeMesoMock = vi.hoisted(() => vi.fn())
const completeState = vi.hoisted(() => ({ isPending: false }))
const startRunMock = vi.hoisted(() => vi.fn())
const createProgramMock = vi.hoisted(() => vi.fn())

vi.mock('./useMesos', () => ({
  useMesos: () => state.mesos,
  useStartRun: () => ({ mutateAsync: startRunMock, isPending: false }),
  useCompleteMeso: () => ({ mutateAsync: completeMesoMock, isPending: completeState.isPending }),
}))
vi.mock('./usePrograms', () => ({
  useSavedPrograms: () => state.saved,
  usePrograms: () => state.programs,
  useCreateProgram: () => ({ mutateAsync: createProgramMock, isPending: false }),
  useWorkoutDays: (programId: string) => ({ data: programId ? state.workoutDays[programId] : undefined }),
  useSequenceItems: (programId: string) => ({ data: programId ? state.sequenceItems[programId] : undefined }),
}))
vi.mock('../plan/useProgramPriorities', () => ({
  useProgramPriorities: (programId: string | null) => {
    calls.priorities.push(programId)
    return { data: programId ? state.marks[programId] : undefined }
  },
}))
vi.mock('../plan/useSequenceCurrentCycle', () => ({
  useSequenceCurrentCycle: (mesoId: string, programId: string) => {
    calls.cycle.push([mesoId, programId])
    return state.cycle
  },
}))
// The card reads the run's weekday rows (1.2.1 item 19): the stand-in records which run it was asked for, so a card that asks for the wrong one fails.
vi.mock('../plan/useRunSchedule', () => ({
  useRunSchedule: (mesoId: string | undefined) => {
    calls.schedule.push(mesoId)
    return { data: mesoId === undefined ? undefined : state.schedules }
  },
}))
vi.mock('../../hooks/useToday', () => ({ useToday: () => state.today }))

const { default: ProgramsTab } = await import('./ProgramsTab')

const onTab = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  state.today = TODAY
  state.mesos = { data: [] }
  state.saved = { data: [] }
  state.programs = { data: [] }
  state.marks = {}
  state.cycle = { cycle: 2, failed: false, error: null }
  state.workoutDays = {}
  state.sequenceItems = {}
  state.schedules = []
  completeState.isPending = false
  calls.priorities.length = 0
  calls.cycle.length = 0
  calls.schedule.length = 0
})
afterEach(() => {
  cleanup()
  onTab.mockReset()
  completeMesoMock.mockReset()
  startRunMock.mockReset()
  createProgramMock.mockReset()
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NO_DAYS: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
const FIVE_DAYS: WeeklySchedule = { ...NO_DAYS, monday: 'wd-a', tuesday: 'wd-b', wednesday: 'wd-c', thursday: 'wd-a', friday: 'wd-d' }
const FOUR_DAYS: WeeklySchedule = { ...NO_DAYS, monday: 'wd-a', tuesday: 'wd-b', thursday: 'wd-a', friday: 'wd-b' }

function program(over: Partial<Program> & Pick<Program, 'id' | 'name'>): Program {
  return { userId: 'user-1', schedule: NO_DAYS, workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'saved', planningType: 'stable', scheduleType: 'weekday', ...over }
}

const SAVED_PPL = program({ id: 'prog-ppl', name: 'Push Pull Legs', schedule: FIVE_DAYS, planningType: 'stable' })
const SAVED_UL = program({ id: 'prog-ul', name: 'Upper / Lower', schedule: FOUR_DAYS, planningType: 'week_dependent' })
// the same NAME as the running program, a different program: it is not the one that runs
const SAVED_SAME_NAME = program({ id: 'prog-ppl-2', name: 'Push Pull Legs', schedule: FOUR_DAYS, planningType: 'week_dependent' })
// the run's own copy has FOUR weekdays where the saved program it came from has five (CHANGE THE PROGRAM moved days since the run started): the card's line comes from the copy
const RUN_COPY = program({ id: 'prog-run', name: 'Push Pull Legs', kind: 'run', schedule: FOUR_DAYS, planningType: 'stable' })

const ACTIVE: Mesocycle = { id: 'meso-active', userId: 'user-1', name: 'Push Pull Legs', programId: 'prog-run', sourceProgramId: 'prog-ppl', status: 'active', startDate: MONDAY, endDate: null, createdAt: '2026-10-05T08:00:00Z' }
const FINISHED_1: Mesocycle = { id: 'meso-fin-1', userId: 'user-1', name: 'Push Pull Legs', programId: 'prog-old-1', status: 'completed', startDate: '2026-09-14', endDate: '2026-10-04', createdAt: '2026-09-14T08:00:00Z' }
const FINISHED_2: Mesocycle = { id: 'meso-fin-2', userId: 'user-1', name: 'Cut PPL', programId: 'prog-old-2', status: 'completed', startDate: '2026-07-06', endDate: '2026-09-13', createdAt: '2026-07-06T08:00:00Z' }

const mark = (tagType: StoredMark['tagType'], tagValue: string, value: StoredMark['mark']): StoredMark => ({ tagType, tagValue, mark: value, updatedAt: '2026-01-01T00:00:00Z' })
// What the run's own program copy holds, and what the saved program holds now (the planner may have changed it since the run started)
const RUN_MARKS = [mark('muscle_group', 'back', 'focus'), mark('muscle_group', 'chest', 'focus'), mark('muscle_group', 'calves', 'dont_care'), mark('muscle_group', 'forearms', 'dont_care')]
const SAVED_MARKS = [mark('muscle_group', 'glutes', 'focus'), mark('muscle_group', 'core', 'dont_care')]

/** A program running: the run, its copy, two saved programs (one of them the one that runs) and two finished runs. */
function running() {
  state.mesos = { data: [ACTIVE, FINISHED_1, FINISHED_2] }
  state.saved = { data: [SAVED_PPL, SAVED_UL] }
  state.programs = { data: [RUN_COPY, SAVED_PPL, SAVED_UL] }
  state.marks = { 'prog-run': RUN_MARKS, 'prog-ppl': SAVED_MARKS }
  state.workoutDays = { 'prog-ppl': [{ id: 'wd-a' }], 'prog-ul': [{ id: 'wd-a' }] }
}

/** Nothing running: the two saved programs and the two finished runs. */
function notRunning() {
  state.mesos = { data: [FINISHED_1, FINISHED_2] }
  state.saved = { data: [SAVED_PPL, SAVED_UL] }
  state.programs = { data: [SAVED_PPL, SAVED_UL] }
  state.workoutDays = { 'prog-ppl': [{ id: 'wd-a' }], 'prog-ul': [{ id: 'wd-a' }] }
}

function Probe() {
  const location = useLocation()
  return <div data-testid="at">{`AT ${location.pathname}${location.search}`}</div>
}
const at = () => screen.getByTestId('at').textContent

const tabUi = () => (
  <MemoryRouter initialEntries={['/plan']}>
    <Routes>
      <Route path="/plan" element={<><ProgramsTab onTab={onTab} /><Probe /></>} />
      <Route path="*" element={<Probe />} />
    </Routes>
  </MemoryRouter>
)
function renderTab() {
  return render(tabUi())
}

const section = (label: string) => screen.getByText(label).parentElement as HTMLElement
const programRow = (id: string) => document.querySelector(`[data-program="${id}"]`) as HTMLElement
const plan = () => screen.getByRole('tab', { name: 'PLAN' })

describe('the fixture dates', () => {
  it('come from a Monday and the run is in its third week (printed)', () => {
    expect(format(parseISO(MONDAY), 'EEEE')).toBe('Monday')
    expect(format(parseISO(TODAY), 'yyyy-MM-dd EEEE')).toBe('2026-10-21 Wednesday')
    expect(getDay(parseISO(TODAY))).toBe(3)
    // Sep 14 is a Monday and Oct 4 the Sunday two weeks after it
    expect(format(parseISO(FINISHED_1.startDate), 'EEE')).toBe('Mon')
    expect(format(parseISO(FINISHED_1.endDate!), 'EEE')).toBe('Sun')
    expect(format(parseISO(FINISHED_2.startDate), 'EEE')).toBe('Mon')
    expect(format(parseISO(FINISHED_2.endDate!), 'EEE')).toBe('Sun')
  })
})

// ─── PR1: a program is running ───────────────────────────────────────────────

describe('PR1 — a program running', () => {
  it('the header: PLAN | PROGRAMS with PROGRAMS open and PLAN not locked, then "[PROGRAM] · WEEK n"', () => {
    running()
    renderTab()

    expect(screen.getAllByRole('tab').map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([['PLAN', 'false'], ['PROGRAMS', 'true']])
    expect(plan().hasAttribute('aria-disabled')).toBe(false)
    expect(screen.getByText('PUSH PULL LEGS · WEEK 3')).toBeTruthy()
  })

  it('the three sections, in order: CURRENT PROGRAM, YOUR PROGRAMS, FINISHED', () => {
    running()
    renderTab()

    const labels = ['CURRENT PROGRAM', 'YOUR PROGRAMS', 'FINISHED'].map((label) => screen.getByText(label))
    for (let i = 0; i < labels.length - 1; i++) expect(labels[i].compareDocumentPosition(labels[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the card: the week in a chip, the run\'s name, when it started and its types (the run\'s own copy), then FOCUS, DON\'T CARE, EDIT PROGRAM and FINISH', () => {
    running()
    renderTab()
    const card = section('CURRENT PROGRAM')

    expect(within(card).getByText('WEEK 3')).toBeTruthy()
    expect(within(card).getByText('Push Pull Legs')).toBeTruthy()
    expect(within(card).getByText('Started Oct 5, 2026')).toBeTruthy()
    expect(within(card).getByText('Weekdays · stable · 4 days a week')).toBeTruthy() // the run's copy, not the saved program's five
    expect(within(card).getByText('FOCUS')).toBeTruthy()
    expect(within(card).getByText("DON'T CARE")).toBeTruthy()
    expect(within(card).getByText('EDIT PROGRAM')).toBeTruthy()
    expect(within(card).getByText('FINISH')).toBeTruthy()
    expect(screen.getByText('Finishing keeps every week in History. The program stays saved below, so you can start it again.')).toBeTruthy()
    // in the board's order
    const order = ['WEEK 3', 'Started Oct 5, 2026', 'FOCUS', "DON'T CARE", 'EDIT PROGRAM', 'FINISH'].map((text) => within(card).getByText(text))
    for (let i = 0; i < order.length - 1; i++) expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the week chip is the accent with the near-black on it, and NEW PROGRAM (PR3) the same: text on the accent is --on-accent (RULES), asserted at the screen', () => {
    running()
    renderTab()
    const chip = within(section('CURRENT PROGRAM')).getByText('WEEK 3')
    expect(chip.style.background).toBe('var(--accent)')
    expect(chip.style.color).toBe('var(--on-accent)')
    cleanup()

    state.mesos = { data: [] }
    state.saved = { data: [] }
    renderTab()
    const button = screen.getByRole('button', { name: 'NEW PROGRAM' })
    expect(button.style.background).toBe('var(--accent)')
    expect(button.style.color).toBe('var(--on-accent)')
  })

  it('FOCUS and DON\'T CARE are summarised from the RUN\'s marks, not the saved program\'s (the two differ in this world)', () => {
    running()
    renderTab()
    const card = section('CURRENT PROGRAM')

    expect(within(card).getByText('Chest, back')).toBeTruthy()
    expect(within(card).getByText('Forearms, calves')).toBeTruthy()
    // the saved program's marks (glutes / core) are nowhere
    expect(screen.queryByText(/glutes/i)).toBeNull()
    expect(screen.queryByText(/core/i)).toBeNull()
    // and the read was for the run's own program, only
    expect(new Set(calls.priorities)).toEqual(new Set(['prog-run']))
  })

  it('a row is drawn only for a mark that is set: no marks, no rows; one kind, one row (the standing UI rule: an unset feature shows nothing)', () => {
    running()
    state.marks = { 'prog-run': [] }
    renderTab()
    expect(screen.queryByText('FOCUS')).toBeNull()
    expect(screen.queryByText("DON'T CARE")).toBeNull()
    expect(screen.getByText('EDIT PROGRAM')).toBeTruthy() // the card itself is there
    cleanup()

    state.marks = { 'prog-run': [mark('muscle_group', 'chest', 'focus')] }
    renderTab()
    expect(screen.getByText('FOCUS')).toBeTruthy()
    expect(screen.queryByText("DON'T CARE")).toBeNull()
    cleanup()

    state.marks = { 'prog-run': [mark('muscle_group', 'calves', 'dont_care')] }
    renderTab()
    expect(screen.queryByText('FOCUS')).toBeNull()
    expect(screen.getByText("DON'T CARE")).toBeTruthy()
  })

  it('YOUR PROGRAMS: each saved program with its types in capitals, OPEN and START; RUNNING only on the program the run started from', () => {
    running()
    state.saved = { data: [SAVED_PPL, SAVED_UL, SAVED_SAME_NAME] }
    renderTab()

    expect(within(programRow('prog-ppl')).getByText('Push Pull Legs')).toBeTruthy()
    expect(within(programRow('prog-ppl')).getByText('WEEKDAYS · STABLE · 5 DAYS A WEEK')).toBeTruthy()
    expect(within(programRow('prog-ul')).getByText('WEEKDAYS · WEEK-DEPENDENT · 4 DAYS A WEEK')).toBeTruthy()
    for (const id of ['prog-ppl', 'prog-ul', 'prog-ppl-2']) {
      expect(within(programRow(id)).getByText('OPEN')).toBeTruthy()
      expect(within(programRow(id)).getByText('START')).toBeTruthy()
    }
    // RUNNING follows the run's source program (an id), not a name that happens to match
    expect(within(programRow('prog-ppl')).getByText('RUNNING')).toBeTruthy()
    expect(within(programRow('prog-ul')).queryByText('RUNNING')).toBeNull()
    expect(within(programRow('prog-ppl-2')).queryByText('RUNNING')).toBeNull()
    expect(screen.getAllByText('RUNNING')).toHaveLength(1)
    expect(screen.getByText('+ NEW PROGRAM')).toBeTruthy()
  })

  it('a run with no source program (an older run) has no RUNNING tag on any row', () => {
    running()
    state.mesos = { data: [{ ...ACTIVE, sourceProgramId: null }] }
    renderTab()
    expect(screen.queryByText('RUNNING')).toBeNull()
  })

  it('FINISHED: each finished run by its name, then "SEP 14 – OCT 4, 2026 · 3 WEEKS"; the running program is not in it', () => {
    running()
    renderTab()
    const finished = section('FINISHED')

    expect(within(finished).getAllByText('Push Pull Legs')).toHaveLength(1)
    expect(within(finished).getByText('SEP 14 – OCT 4, 2026 · 3 WEEKS')).toBeTruthy()
    expect(within(finished).getByText('Cut PPL')).toBeTruthy()
    expect(within(finished).getByText('JUL 6 – SEP 13, 2026 · 10 WEEKS')).toBeTruthy()
  })

  it('with nothing finished yet there is no FINISHED section', () => {
    running()
    state.mesos = { data: [ACTIVE] }
    renderTab()
    expect(screen.queryByText('FINISHED')).toBeNull()
    expect(screen.getByText('YOUR PROGRAMS')).toBeTruthy()
  })

  it('a sequence run says CYCLE and the cycle it is in, read for the run\'s own ids; a weekday run reads no cycle at all', () => {
    running()
    const seqCopy = program({ id: 'prog-run', name: 'Rotation', kind: 'run', scheduleType: 'sequence', planningType: 'week_dependent' })
    state.programs = { data: [seqCopy] }
    state.mesos = { data: [{ ...ACTIVE, name: 'Rotation' }] }
    state.cycle = { cycle: 2, failed: false, error: null }
    renderTab()

    expect(within(section('CURRENT PROGRAM')).getByText('CYCLE 2')).toBeTruthy()
    expect(screen.getByText('ROTATION · CYCLE 2')).toBeTruthy()
    expect(within(section('CURRENT PROGRAM')).getByText('Sequence · week-dependent')).toBeTruthy()
    expect(within(section('CURRENT PROGRAM')).queryByText('WEEK 3')).toBeNull()
    expect(calls.cycle[calls.cycle.length - 1]).toEqual(['meso-active', 'prog-run'])
    cleanup()

    // while the cycle isn't known: no chip, no cycle in the line (it is read, not guessed)
    state.cycle = { cycle: null, failed: false, error: null }
    renderTab()
    expect(screen.queryByText(/CYCLE \d/)).toBeNull()
    expect(screen.queryByText(/WEEK \d/)).toBeNull()
    expect(screen.getByText('ROTATION')).toBeTruthy()
    cleanup()

    // a weekday run: the cycle read is asked of nothing (empty ids: the hook's own reads are off)
    calls.cycle.length = 0
    running()
    renderTab()
    expect(calls.cycle.length).toBeGreaterThan(0)
    expect(new Set(calls.cycle.map(([mesoId, programId]) => `${mesoId}|${programId}`))).toEqual(new Set(['|']))
  })

  it('the week is the calendar week of the run\'s start, Monday-anchored: Sunday is still week 2, Monday is week 3', () => {
    running()
    state.today = day(13) // Sunday
    renderTab()
    expect(within(section('CURRENT PROGRAM')).getByText('WEEK 2')).toBeTruthy()
    cleanup()
    state.today = day(14) // Monday
    renderTab()
    expect(within(section('CURRENT PROGRAM')).getByText('WEEK 3')).toBeTruthy()
  })
})

// ─── "N days a week" counts the week in force (1.2.1 item 19; SPEC "PROGRAMS · CURRENT PROGRAM card"; DECISIONS 190 (a)) ───────────────────────────

// The run's days were four a week, were changed in week 2 to start in week 3 (three), and again to start in week 5 (two): the run copy holds the newest
// (two), the rows hold all three (`from_week` 1, 3 and 5), and the saved program it started from has five. Each week's answer is a different number, so the
// card's line says which of the four sources it read.
describe('the CURRENT PROGRAM card counts the days of the week in force (1.2.1 item 19)', () => {
  const TWO_DAYS: WeeklySchedule = { ...NO_DAYS, monday: 'wd-a', thursday: 'wd-b' }
  const THREE_DAYS: WeeklySchedule = { ...NO_DAYS, monday: 'wd-a', wednesday: 'wd-c', friday: 'wd-d' }
  const row = (fromWeek: number, schedule: WeeklySchedule) => ({ id: `rs-${fromWeek}`, userId: 'user-1', mesocycleId: 'meso-active', fromWeek, schedule, createdAt: '' })
  const ROWS = [row(1, FOUR_DAYS), row(3, THREE_DAYS), row(5, TWO_DAYS)]
  const line = () => within(section('CURRENT PROGRAM')).getByText(/^Weekdays · stable/).textContent

  function changed(rows: unknown[] = ROWS) {
    running()
    state.programs = { data: [{ ...RUN_COPY, schedule: TWO_DAYS }, SAVED_PPL, SAVED_UL] }
    state.schedules = rows
  }

  it('the weeks and days of this world are printed: Mondays 2026-10-05, 10-12, 10-19, 10-26 and 11-02 start weeks 1 to 5', () => {
    const mondays = [0, 7, 14, 21, 28].map((offset) => format(parseISO(day(offset)), 'yyyy-MM-dd EEE'))
    expect(mondays).toEqual(['2026-10-05 Mon', '2026-10-12 Mon', '2026-10-19 Mon', '2026-10-26 Mon', '2026-11-02 Mon'])
    expect([FOUR_DAYS, THREE_DAYS, TWO_DAYS, FIVE_DAYS].map((s) => Object.values(s).filter(Boolean).length)).toEqual([4, 3, 2, 5])
  })

  it('week 2 counts the week-2 days (four), though the run copy holds the newest (two): a change that starts in week 3 is not this week’s', () => {
    changed()
    state.today = day(9) // Wednesday of week 2
    renderTab()
    expect(within(section('CURRENT PROGRAM')).getByText('WEEK 2')).toBeTruthy()
    expect(line()).toBe('Weekdays · stable · 4 days a week')
  })

  it('week 3 counts three, week 4 still three, week 5 two: the row with the greatest from_week at or before the week', () => {
    for (const [offset, week, days] of [[16, 3, '3 days'], [23, 4, '3 days'], [30, 5, '2 days']] as const) {
      changed()
      state.today = day(offset)
      renderTab()
      expect(within(section('CURRENT PROGRAM')).getByText(`WEEK ${week}`)).toBeTruthy()
      expect(line()).toBe(`Weekdays · stable · ${days} a week`)
      cleanup()
    }
  })

  it('the week turns over on Monday: Sunday of week 2 still counts four, Monday of week 3 counts three', () => {
    changed()
    state.today = day(13) // Sunday 2026-10-18
    renderTab()
    expect(line()).toBe('Weekdays · stable · 4 days a week')
    cleanup()
    state.today = day(14) // Monday 2026-10-19
    renderTab()
    expect(line()).toBe('Weekdays · stable · 3 days a week')
  })

  it('the rows may come in any order', () => {
    changed([row(5, TWO_DAYS), row(1, FOUR_DAYS), row(3, THREE_DAYS)])
    state.today = day(16)
    renderTab()
    expect(line()).toBe('Weekdays · stable · 3 days a week')
  })

  it('a run with no rows is in the run copy’s days in every week', () => {
    changed([])
    state.today = day(9)
    renderTab()
    expect(line()).toBe('Weekdays · stable · 2 days a week')
  })

  it('until the rows are read the line says nothing about days, not the run copy’s number; the rest of the line is there', () => {
    changed()
    state.schedules = undefined // not read yet (an empty list would be an answer)
    renderTab()
    expect(line()).toBe('Weekdays · stable')
    cleanup()
    // and the days appear once they are read
    changed()
    renderTab()
    expect(line()).toBe('Weekdays · stable · 3 days a week')
  })

  it('the rows are the RUN’s: the stand-in is asked for the run’s id, and a sequence run, which has no weekdays, is asked for none', () => {
    changed()
    renderTab()
    expect(calls.schedule.length).toBeGreaterThan(0)
    expect(new Set(calls.schedule)).toEqual(new Set(['meso-active']))
    cleanup()
    calls.schedule.length = 0
    running()
    const seqCopy = program({ id: 'prog-run', name: 'Rotation', kind: 'run', scheduleType: 'sequence', planningType: 'week_dependent', schedule: FIVE_DAYS })
    state.programs = { data: [seqCopy] }
    state.mesos = { data: [{ ...ACTIVE, name: 'Rotation' }] }
    renderTab()
    expect(within(section('CURRENT PROGRAM')).getByText('Sequence · week-dependent')).toBeTruthy()
    expect(new Set(calls.schedule)).toEqual(new Set([undefined]))
  })

  it('YOUR PROGRAMS rows keep counting the saved program’s own days, whatever the run’s rows say', () => {
    changed()
    state.today = day(9)
    renderTab()
    expect(within(programRow('prog-ppl')).getByText('WEEKDAYS · STABLE · 5 DAYS A WEEK')).toBeTruthy() // the program the run started from
    expect(within(programRow('prog-ul')).getByText('WEEKDAYS · WEEK-DEPENDENT · 4 DAYS A WEEK')).toBeTruthy()
  })
})

// ─── Where the links go ──────────────────────────────────────────────────────

describe('where each link goes (real routes, read back out of the location)', () => {
  it('FOCUS and DON\'T CARE open the run\'s priorities, view-only', () => {
    running()
    renderTab()
    fireEvent.click(screen.getByText('FOCUS'))
    expect(at()).toBe('AT /plan/priorities')
    cleanup()

    renderTab()
    fireEvent.click(screen.getByText("DON'T CARE"))
    expect(at()).toBe('AT /plan/priorities')
  })

  it('EDIT PROGRAM opens CHANGE THE PROGRAM', () => {
    running()
    renderTab()
    fireEvent.click(screen.getByText('EDIT PROGRAM'))
    expect(at()).toBe('AT /plan/change')
  })

  it('EDIT PROGRAM is there when the run has no schedule (Plan draws no CHANGE THE PROGRAM button then: this is its way in)', () => {
    running()
    state.programs = { data: [{ ...RUN_COPY, schedule: NO_DAYS }] }
    renderTab()
    expect(screen.getByText('EDIT PROGRAM')).toBeTruthy()
  })

  it('OPEN opens the planner on THAT saved program, not the first', () => {
    running()
    renderTab()
    fireEvent.click(within(programRow('prog-ul')).getByText('OPEN'))
    expect(at()).toBe('AT /program/prog-ul')
  })

  it('a FINISHED row opens that run\'s finished program (chunk 66)', () => {
    running()
    renderTab()
    fireEvent.click(screen.getByText('Cut PPL'))
    expect(at()).toBe('AT /program/finished/meso-fin-2')
  })
})

// ─── PR2: no program running ─────────────────────────────────────────────────

describe('PR2 — no program running', () => {
  it('"No program running", the line that says what to do, and no CURRENT PROGRAM card', () => {
    notRunning()
    renderTab()

    expect(screen.getByText('NO PROGRAM RUNNING')).toBeTruthy() // the line under the tabs
    expect(screen.getByText('No program running')).toBeTruthy()
    expect(screen.getByText('START one of your programs below. Its weeks then show in PLAN.')).toBeTruthy()
    for (const gone of ['EDIT PROGRAM', 'FINISH', 'FOCUS', "DON'T CARE"]) expect(screen.queryByText(gone)).toBeNull()
    expect(screen.queryByText('RUNNING')).toBeNull()
    // the saved programs and the finished ones are still there
    expect(screen.getAllByText('START')).toHaveLength(2)
    expect(screen.getByText('SEP 14 – OCT 4, 2026 · 3 WEEKS')).toBeTruthy()
  })

  it('PLAN is locked (dimmed, a lock, disabled) and tapping it shows "Start a program to plan your weeks." and does not open Plan', () => {
    notRunning()
    renderTab()

    expect(plan().getAttribute('aria-disabled')).toBe('true')
    expect(plan().querySelector('svg')).not.toBeNull()
    expect(screen.queryByText('Start a program to plan your weeks.')).toBeNull()
    fireEvent.click(plan())
    expect(screen.getByText('Start a program to plan your weeks.')).toBeTruthy()
    expect(onTab).not.toHaveBeenCalled()
    expect(at()).toBe('AT /plan')
  })

  it('with a program running PLAN is not locked, and a tap on it asks the shell for Plan', () => {
    running()
    renderTab()
    fireEvent.click(plan())
    expect(onTab).toHaveBeenCalledWith('plan')
    expect(screen.queryByText('Start a program to plan your weeks.')).toBeNull()
  })

  it('a run that finishes while the tab is open locks PLAN and turns the card into PR2\'s block', () => {
    running()
    const view = renderTab()
    expect(screen.getByText('EDIT PROGRAM')).toBeTruthy()

    state.mesos = { data: [{ ...ACTIVE, status: 'completed', endDate: TODAY }, FINISHED_1, FINISHED_2] }
    view.rerender(
      <MemoryRouter initialEntries={['/plan']}>
        <Routes>
          <Route path="/plan" element={<><ProgramsTab onTab={onTab} /><Probe /></>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.queryByText('EDIT PROGRAM')).toBeNull()
    expect(screen.getByText('No program running')).toBeTruthy()
    expect(plan().getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('NO PROGRAM RUNNING')).toBeTruthy()
  })
})

// ─── PR3: no programs at all ─────────────────────────────────────────────────

describe('PR3 — no programs at all', () => {
  it('says what a program is in one line, offers NEW PROGRAM, and draws nothing of the other sections', () => {
    renderTab()

    expect(screen.getByText('No programs yet')).toBeTruthy()
    expect(screen.getByText('A program is your training plan: workouts, exercises and sets. Make one, then START it to plan your weeks.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'NEW PROGRAM' })).toBeTruthy()
    for (const gone of ['CURRENT PROGRAM', 'YOUR PROGRAMS', 'FINISHED', '+ NEW PROGRAM', 'No program running']) expect(screen.queryByText(gone)).toBeNull()
    // the line under the tabs and the lock still say so
    expect(screen.getByText('NO PROGRAM RUNNING')).toBeTruthy()
    expect(plan().getAttribute('aria-disabled')).toBe('true')
  })

  it('NEW PROGRAM opens the New program sheet', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'NEW PROGRAM' }))
    expect(screen.getByRole('dialog', { name: 'New program' })).toBeTruthy()
  })

  it('it is for an account with no saved program, no running one and no finished one: a finished run alone is not PR3 (YOUR PROGRAMS, empty, with + NEW PROGRAM)', () => {
    state.mesos = { data: [FINISHED_1] }
    renderTab()

    expect(screen.queryByText('No programs yet')).toBeNull()
    expect(screen.getByText('YOUR PROGRAMS')).toBeTruthy()
    expect(screen.getByText('+ NEW PROGRAM')).toBeTruthy()
    expect(screen.queryByText('START')).toBeNull()
    expect(screen.getByText('FINISHED')).toBeTruthy()
  })

  it('nor is a running program with no saved program', () => {
    state.mesos = { data: [ACTIVE] }
    state.programs = { data: [RUN_COPY] }
    renderTab()
    expect(screen.queryByText('No programs yet')).toBeNull()
    expect(screen.getByText('EDIT PROGRAM')).toBeTruthy()
  })
})

// ─── PR4: loading ────────────────────────────────────────────────────────────

describe('PR4 — loading', () => {
  it.each([
    ['the runs', () => { state.mesos = { data: undefined, isLoading: true } }],
    ['the saved programs', () => { state.saved = { data: undefined, isLoading: true } }],
  ])('while %s are out: LOADING under the tabs and a spinner under CURRENT PROGRAM, nothing of the other sections, and PLAN not locked (nothing is known yet)', (_name, load) => {
    running()
    load()
    renderTab()

    expect(screen.getByText('LOADING')).toBeTruthy()
    expect(screen.getByText('CURRENT PROGRAM')).toBeTruthy()
    const spinner = screen.getByRole('status', { name: 'Loading' })
    // the ring is written one side at a time (a captured render drops a `border` shorthand holding var())
    expect(spinner.firstElementChild?.getAttribute('style')).toContain('border-top-color: var(--accent)')
    for (const gone of ['YOUR PROGRAMS', 'FINISHED', 'No programs yet', 'No program running', 'EDIT PROGRAM', 'START']) expect(screen.queryByText(gone)).toBeNull()
    expect(plan().hasAttribute('aria-disabled')).toBe(false)
  })

  it('a running program\'s own program still out is loading too: the card needs its types', () => {
    running()
    state.programs = { data: undefined, isLoading: true }
    renderTab()
    expect(screen.getByText('LOADING')).toBeTruthy()
    expect(screen.queryByText('EDIT PROGRAM')).toBeNull()
  })

  it('with no program running that read is not waited for (nothing needs it)', () => {
    notRunning()
    state.programs = { data: undefined, isLoading: true }
    renderTab()
    expect(screen.queryByText('LOADING')).toBeNull()
    expect(screen.getByText('YOUR PROGRAMS')).toBeTruthy()
  })
})

// ─── A read that failed ──────────────────────────────────────────────────────

describe('a read that failed with nothing to show (SPEC Errors 15)', () => {
  it.each([
    ['the runs', () => { state.mesos = { data: undefined, isError: true, error: { message: 'JWT expired' } } }, 'JWT expired'],
    ['the saved programs', () => { state.saved = { data: undefined, isError: true, error: { message: 'permission denied for table v2_programs' } } }, 'permission denied for table v2_programs'],
    ['the run\'s own program', () => { state.programs = { data: undefined, isError: true, error: new Error('Failed to fetch') } }, 'Failed to fetch'],
  ])('%s: "COULDN\'T LOAD PROGRAMS" and the real reason, never the empty states (an empty answer and a failed one differ)', (_name, fail, reason) => {
    running()
    fail()
    renderTab()

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText("COULDN'T LOAD PROGRAMS")).toBeTruthy()
    expect(within(alert).getByText(reason)).toBeTruthy()
    for (const gone of ['No programs yet', 'No program running', 'NO PROGRAM RUNNING', 'LOADING', 'YOUR PROGRAMS', 'EDIT PROGRAM']) expect(screen.queryByText(gone)).toBeNull()
    // PLAN is not locked on a guess: nothing says that no program runs
    expect(plan().hasAttribute('aria-disabled')).toBe(false)
  })

  it.each([
    [false, 'Something went wrong.'],
    [true, 'You may be offline.'],
  ])('an error with no message, the phone offline: %s, says "%s" (P1.2-5; the offline wording only when the phone is)', (offline, line) => {
    running()
    state.mesos = { data: undefined, isError: true, error: {} }
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(!offline)
    try {
      renderTab()
      expect(within(screen.getByRole('alert')).getByText(line)).toBeTruthy()
    } finally {
      onLine.mockRestore()
    }
  })

  it('a refetch that failed but left data on screen shows the data, not the error (the earlier answer is still the answer)', () => {
    running()
    state.mesos = { data: [ACTIVE, FINISHED_1, FINISHED_2], isError: true, error: { message: 'refetch failed' } }
    renderTab()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('EDIT PROGRAM')).toBeTruthy()
  })
})

// ─── FINISH ──────────────────────────────────────────────────────────────────

describe('FINISH — PR6 and PR7', () => {
  it('asks first, in PR6\'s words: "Finish [name]?", the program stays saved, every week stays in History; CANCEL finishes nothing', () => {
    running()
    renderTab()
    expect(screen.queryByText('Finish Push Pull Legs?')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))

    expect(screen.getByText('Finish Push Pull Legs?')).toBeTruthy()
    expect(screen.getByText('The program stays saved, so you can start it again. Every week stays in History.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    expect(screen.queryByText('Finish Push Pull Legs?')).toBeNull()
    expect(completeMesoMock).not.toHaveBeenCalled()
  })

  it('W: the confirm calls completeMeso with the RUN\'s id, once; the dialog closes when it is done', async () => {
    running()
    completeMesoMock.mockResolvedValue(undefined)
    renderTab()

    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
    const confirm = within(screen.getByText('Finish Push Pull Legs?').parentElement!.parentElement!).getByRole('button', { name: 'FINISH' })
    fireEvent.click(confirm)

    await waitFor(() => expect(completeMesoMock).toHaveBeenCalledTimes(1))
    expect(completeMesoMock).toHaveBeenCalledWith('meso-active') // the run's id, not its program's
    await waitFor(() => expect(screen.queryByText('Finish Push Pull Legs?')).toBeNull())
  })

  it('PR7: while it is out the confirm says FINISHING… and cannot be pressed again', () => {
    running()
    completeState.isPending = true
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))

    const pending = screen.getByRole('button', { name: 'FINISHING…' }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
  })

  it('two presses in the same instant finish it once', async () => {
    running()
    completeMesoMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(undefined), 20)))
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
    const confirm = within(screen.getByText('Finish Push Pull Legs?').parentElement!.parentElement!).getByRole('button', { name: 'FINISH' }) as HTMLButtonElement

    await act(async () => {
      confirm.click()
      confirm.click()
    })

    await waitFor(() => expect(completeMesoMock).toHaveBeenCalledTimes(1))
  })

  it.each([
    [false, 'Something went wrong.'],
    [true, 'You may be offline.'],
  ])('a failed finish with no message, the phone offline: %s, says "%s" under "Couldn\'t finish [name]."', async (offline, line) => {
    running()
    completeMesoMock.mockRejectedValue({})
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(!offline)
    try {
      renderTab()
      fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
      fireEvent.click(within(screen.getByText('Finish Push Pull Legs?').parentElement!.parentElement!).getByRole('button', { name: 'FINISH' }))

      const alert = await screen.findByRole('alert')
      expect(within(alert).getByText("Couldn't finish Push Pull Legs.")).toBeTruthy()
      expect(within(alert).getByText(line)).toBeTruthy()
    } finally {
      onLine.mockRestore()
    }
  })

  it('a run name with no break in it wraps in the question and in the failure line (Chromium saw both run out of the dialog)', async () => {
    running()
    const LONG = 'B'.repeat(80)
    state.mesos = { data: [{ ...ACTIVE, name: LONG }, FINISHED_1, FINISHED_2] }
    completeMesoMock.mockRejectedValue({ message: 'R'.repeat(120) })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
    const title = screen.getByText(`Finish ${LONG}?`)
    expect(title.style.overflowWrap).toBe('anywhere')

    fireEvent.click(within(title.parentElement!.parentElement!).getByRole('button', { name: 'FINISH' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(`Couldn't finish ${LONG}.`).style.overflowWrap).toBe('anywhere')
    expect(within(alert).getByText('R'.repeat(120)).style.overflowWrap).toBe('anywhere')
  })

  it('a retry clears the earlier error at once, while it is out: the dialog is not left saying the last try failed', async () => {
    running()
    completeMesoMock.mockRejectedValueOnce({ message: 'first failure' })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
    const confirm = () => within(screen.getByText('Finish Push Pull Legs?').parentElement!.parentElement!).getByRole('button', { name: 'FINISH' })
    fireEvent.click(confirm())
    expect(await screen.findByText('first failure')).toBeTruthy()

    completeMesoMock.mockReturnValueOnce(new Promise(() => undefined)) // never answers: the retry stays out
    fireEvent.click(confirm())

    expect(screen.queryByText('first failure')).toBeNull()
    expect(completeMesoMock).toHaveBeenCalledTimes(2)
  })

  it('after a failed finish was cancelled, FINISH on the card asks again with a clean question: no error left in it', async () => {
    running()
    completeMesoMock.mockRejectedValueOnce({ message: 'first failure' })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
    fireEvent.click(within(screen.getByText('Finish Push Pull Legs?').parentElement!.parentElement!).getByRole('button', { name: 'FINISH' }))
    expect(await screen.findByText('first failure')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    expect(screen.queryByText('Finish Push Pull Legs?')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))

    expect(screen.getByText('Finish Push Pull Legs?')).toBeTruthy()
    expect(screen.queryByText('first failure')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a failed finish keeps the dialog open and says "Couldn\'t finish [name]." with the real reason (a Supabase error is no Error object)', async () => {
    running()
    completeMesoMock.mockRejectedValue({ message: 'new row violates row-level security policy for table "v2_mesocycles"' })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
    fireEvent.click(within(screen.getByText('Finish Push Pull Legs?').parentElement!.parentElement!).getByRole('button', { name: 'FINISH' }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText("Couldn't finish Push Pull Legs.")).toBeTruthy()
    expect(within(alert).getByText('new row violates row-level security policy for table "v2_mesocycles"')).toBeTruthy()
    expect(screen.getByText('Finish Push Pull Legs?')).toBeTruthy()

    // a retry works, and clears the error
    completeMesoMock.mockResolvedValue(undefined)
    fireEvent.click(within(screen.getByText('Finish Push Pull Legs?').parentElement!.parentElement!).getByRole('button', { name: 'FINISH' }))
    await waitFor(() => expect(screen.queryByText('Finish Push Pull Legs?')).toBeNull())
    expect(completeMesoMock).toHaveBeenCalledTimes(2)
  })

  it('the card becomes PR2\'s once the run is finished (the run list answers with it completed)', async () => {
    running()
    completeMesoMock.mockImplementation(async () => {
      state.mesos = { data: [{ ...ACTIVE, status: 'completed', endDate: TODAY }, FINISHED_1, FINISHED_2] }
    })
    const view = renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
    fireEvent.click(within(screen.getByText('Finish Push Pull Legs?').parentElement!.parentElement!).getByRole('button', { name: 'FINISH' }))
    await waitFor(() => expect(completeMesoMock).toHaveBeenCalled())

    view.rerender(
      <MemoryRouter initialEntries={['/plan']}>
        <Routes>
          <Route path="/plan" element={<><ProgramsTab onTab={onTab} /><Probe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('No program running')).toBeTruthy()
    expect(screen.queryByText('Finish Push Pull Legs?')).toBeNull()
    // the finished run is in FINISHED now (the list answered with it completed), beside the one that was there
    expect(within(section('FINISHED')).getAllByText('Push Pull Legs')).toHaveLength(2)
  })
})

// ─── The sheets, opened from the tab ─────────────────────────────────────────

describe('the sheets the tab opens', () => {
  it('+ NEW PROGRAM opens the New program sheet', () => {
    running()
    renderTab()
    fireEvent.click(screen.getByText('+ NEW PROGRAM'))
    expect(screen.getByRole('dialog', { name: 'New program' })).toBeTruthy()
  })

  it('a row\'s START opens the start sheet with THAT program picked, and with a program running it says "Start a new program" and what starting does (PR9)', () => {
    running()
    renderTab()
    fireEvent.click(within(programRow('prog-ul')).getByText('START'))

    const dialog = screen.getByRole('dialog', { name: 'Start a new program' })
    expect(within(dialog).getByRole('radio', { name: 'Upper / Lower' }).getAttribute('aria-checked')).toBe('true')
    expect(within(dialog).getByRole('radio', { name: 'Push Pull Legs' }).getAttribute('aria-checked')).toBe('false')
    expect(within(dialog).getByText('Starting it finishes Push Pull Legs. Its weeks stay in History.')).toBeTruthy()
  })

  it('with nothing running the sheet is "Start a program" and says nothing about finishing one (PR8)', () => {
    notRunning()
    renderTab()
    fireEvent.click(within(programRow('prog-ppl')).getByText('START'))

    const dialog = screen.getByRole('dialog', { name: 'Start a program' })
    expect(within(dialog).queryByText(/Starting it finishes/)).toBeNull()
    expect(within(dialog).getByRole('radio', { name: 'Push Pull Legs' }).getAttribute('aria-checked')).toBe('true')
  })

  it('closing a sheet leaves the tab as it was', () => {
    running()
    renderTab()
    fireEvent.click(screen.getByText('+ NEW PROGRAM'))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('EDIT PROGRAM')).toBeTruthy()
  })

  it('the start sheet closes with its close button too, and the tab is as it was', () => {
    running()
    renderTab()
    fireEvent.click(within(programRow('prog-ul')).getByText('START'))
    expect(screen.getByRole('dialog', { name: 'Start a new program' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('EDIT PROGRAM')).toBeTruthy()
    expect(startRunMock).not.toHaveBeenCalled()
  })

  it('PR12 (the saved programs gone under an open start sheet): CREATE PROGRAM puts the start sheet away and opens the New program sheet', () => {
    running()
    const view = renderTab()
    fireEvent.click(within(programRow('prog-ul')).getByText('START'))
    expect(screen.getByRole('dialog', { name: 'Start a new program' })).toBeTruthy()

    state.saved = { data: [] } // deleted elsewhere while the sheet was open
    view.rerender(tabUi())
    expect(screen.getByText('Create a program first.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'CREATE PROGRAM' }))

    expect(screen.getByRole('dialog', { name: 'New program' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: /^Start a/ })).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

// ─── What is gone with the old page ──────────────────────────────────────────

describe('absence — the old page\'s words are gone from every state (Checks that lied #32)', () => {
  const GONE = [/END RUN/, /ACTIVE RUN/, /COMPLETED RUNS/, /START RUN/, /NO ACTIVE RUN/, /SAVED PROGRAMS/, /OPEN IN PLANNER/, /NO PROGRAMS YET/, /Mesocycle/i, /\bmeso\b/i, /OVERLOAD v2/, /Delete run/i, /START A NEW RUN/]
  const everyState: Array<[string, () => void]> = [
    ['a program running', running],
    ['no program running', notRunning],
    ['no programs at all', () => undefined],
    ['loading', () => { state.mesos = { data: undefined, isLoading: true } }],
    ['failed', () => { state.mesos = { data: undefined, isError: true, error: { message: 'boom' } } }],
  ]

  it.each(everyState)('%s', (_name, setup) => {
    setup()
    const { container } = renderTab()
    for (const word of GONE) expect(container.textContent, String(word)).not.toMatch(word)
    expect(screen.queryByLabelText(/Delete/)).toBeNull()
    expect(screen.queryByRole('button', { name: /trash/i })).toBeNull()
  })

  it('and no row of the tab has a delete control (a finished run is deleted from its own page, chunk 66)', () => {
    running()
    renderTab()
    expect(screen.queryByLabelText(/delete/i)).toBeNull()
  })
})

// ─── 375 px ──────────────────────────────────────────────────────────────────

describe('375 px', () => {
  it('no element carries a fixed pixel width wider than the screen, and long names wrap (an unbroken word must not run past the line)', () => {
    running()
    const LONG = 'A'.repeat(80)
    state.mesos = { data: [{ ...ACTIVE, name: LONG }, { ...FINISHED_1, name: LONG }] }
    state.saved = { data: [{ ...SAVED_PPL, name: LONG }, SAVED_UL] }
    const { container } = renderTab()

    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(el.style[prop])
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${el.style[prop]}`)
      }
    }
    expect(offenders).toEqual([])
    for (const el of screen.getAllByText(LONG)) expect(el.style.overflowWrap, 'a long name wraps inside its line').toBe('anywhere')
    expect(screen.getByText(`${LONG} · WEEK 3`.toUpperCase()).style.overflowWrap).toBe('anywhere')
  })
})
