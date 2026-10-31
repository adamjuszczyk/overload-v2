// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Mesocycle, Program, RunSchedule, WeeklySchedule } from '../../types'
import type { StoredMark } from '../../lib/priorityMarks'
import { DAYS, NO_DAYS, SCHEDULE, cutPplPlans, session } from './programHistory.testutil'

// Chunk 66: the finished program screen (TASKS-1.2 "A finished program"; boards PR14 and PR15), through its real components; the hooks that read
// are stand-ins that answer by the id they are asked for, and every id a hook could be given by mistake (the run copy's program id where the run's
// id belongs, the saved program the run started from) has data of its own that says so on the screen. The structure itself is
// `programHistory.test.ts`'s; here: what the screen is made of, where it reads, where its PRIORITIES row leads, and DELETE.
//
// Write-path proofs (the delete; since chunk 75 a full delete through `FullDeleteConfirm`): what is counted and deleted, with which id (the run's own,
// never its copy's program id or the saved program's), after the press and not before, with the session ids read with the counts; what happens on
// success (PROGRAMS, once the delete has resolved, even though the list no longer holds the program by then) and on failure (the page stays, the reason
// is said, a retry works), and a second press in the same instant. The confirmation's own states are `FullDeleteConfirm.test.tsx`'s, the hooks behind
// it (`useFinishedRunCounts`, `useDeleteFinishedRun`: `networkMode: 'always'`, the invalidations returned) are `finishedProgram.writers.test.tsx`'s.

const state = vi.hoisted(() => ({
  mesos: [] as unknown[],
  mesosLoading: false,
  mesosError: null as unknown,
  programs: [] as unknown[],
  days: {} as Record<string, unknown[]>,
  plans: {} as Record<string, unknown[]>,
  schedules: {} as Record<string, unknown[]>,
  marks: {} as Record<string, unknown[]>,
  marksPending: false,
  marksError: false,
  legacy: {} as Record<string, boolean>,
  pending: false,
  // what the confirmation's counts read answers (a stand-in for `useFinishedRunCounts`) and what it was asked: [id, enabled]
  counted: true,
  counts: { weeks: 10, sessions: 38, loggedSets: 1046, coachAnalyses: 3, coachNotes: 0 } as Record<string, number>,
  sessionIds: ['s-1', 's-2', 's-3'] as string[],
  asked: { days: [] as string[], plans: [] as string[], schedule: [] as Array<string | undefined>, marks: [] as Array<string | null>, legacy: [] as Array<string | null>, counts: [] as Array<[string, boolean]> },
}))
const deleteMock = vi.hoisted(() => vi.fn())

vi.mock('./useMesos', () => ({
  useMesos: () => (state.mesosLoading ? { data: undefined, isLoading: true } : state.mesosError ? { data: undefined, isError: true, error: state.mesosError } : { data: state.mesos }),
  useFinishedRunCounts: (id: string, enabled: boolean) => {
    state.asked.counts.push([id, enabled])
    return state.counted && enabled
      ? { data: { counts: state.counts, sessionIds: state.sessionIds }, isFetching: false, isError: false, error: null }
      : { data: undefined, isFetching: enabled, isError: false, error: null }
  },
  useDeleteFinishedRun: () => ({ mutateAsync: deleteMock, isPending: state.pending }),
}))
vi.mock('./usePrograms', () => ({
  usePrograms: () => ({ data: state.programs }),
  useWorkoutDays: (programId: string) => {
    state.asked.days.push(programId)
    return { data: programId ? state.days[programId] : undefined }
  },
}))
vi.mock('../plan/useWeekPlan', () => ({
  useAllWeekPlans: (mesoId: string) => {
    state.asked.plans.push(mesoId)
    return { data: mesoId ? (state.plans[mesoId] ?? []) : undefined }
  },
}))
vi.mock('../plan/useRunSchedule', () => ({
  useRunSchedule: (mesoId: string | undefined) => {
    state.asked.schedule.push(mesoId)
    return { data: mesoId ? (state.schedules[mesoId] ?? []) : undefined }
  },
}))
vi.mock('../plan/useProgramPriorities', () => ({
  useProgramPriorities: (programId: string | null) => {
    state.asked.marks.push(programId)
    if (!programId) return { data: undefined }
    if (state.marksError) return { data: undefined, isError: true, error: new Error('rows unreadable') }
    return { data: state.marksPending ? undefined : (state.marks[programId] ?? []) }
  },
}))
vi.mock('../coach/usePriorityContext', () => ({
  usePriorityContext: (mesoId: string | null) => {
    state.asked.legacy.push(mesoId)
    return { data: mesoId ? { anyExplicit: state.legacy[mesoId] === true } : undefined }
  },
}))

const { default: FinishedProgramPage } = await import('./FinishedProgramPage')

const mark = (tagValue: string, value: StoredMark['mark']): StoredMark => ({ tagType: 'muscle_group', tagValue, mark: value, updatedAt: '2026-01-01T00:00:00Z' })
const run = (over: Partial<Mesocycle> & Pick<Mesocycle, 'id' | 'name' | 'programId'>): Mesocycle => ({
  userId: 'user-1',
  status: 'completed',
  startDate: '2026-07-06',
  endDate: '2026-09-13',
  createdAt: '2026-07-06T08:00:00Z',
  sourceProgramId: 'prog-saved-ppl',
  ...over,
})
const program = (id: string, over: Partial<Program> = {}): Program => ({
  id,
  userId: 'user-1',
  name: 'Cut PPL',
  schedule: NO_DAYS,
  workoutDays: [],
  createdAt: '',
  updatedAt: '',
  kind: 'run',
  planningType: 'week_dependent',
  scheduleType: 'weekday',
  ...over,
})

// Push 2 is on Thursday until week 4 and on Friday from week 5; the run copy holds the newest days, so a screen that reads the copy's schedule for
// every week says FRIDAY in week 1.
const WEEK_5_ON: WeeklySchedule = { ...SCHEDULE, thursday: null, friday: 'push-2' }
const RUN_SCHEDULES: RunSchedule[] = [
  { id: 'rs-1', userId: 'user-1', mesocycleId: 'meso-cut', fromWeek: 1, schedule: SCHEDULE, createdAt: '' },
  { id: 'rs-2', userId: 'user-1', mesocycleId: 'meso-cut', fromWeek: 5, schedule: WEEK_5_ON, createdAt: '' },
]

const CUT = run({ id: 'meso-cut', name: 'Cut PPL', programId: 'prog-run-cut' })
const OLD = run({ id: 'meso-old', name: 'Spring Block', programId: 'prog-run-old', startDate: '2026-03-02', endDate: '2026-04-12' })
const BARE = run({ id: 'meso-bare', name: 'Bare Block', programId: 'prog-run-bare', startDate: '2026-03-02', endDate: '2026-04-12' })
const ACTIVE = run({ id: 'meso-active', name: 'Running Now', programId: 'prog-run-active', status: 'active', endDate: null })

function world() {
  state.mesos = [CUT, OLD, BARE, ACTIVE]
  state.programs = [program('prog-run-cut', { schedule: WEEK_5_ON }), program('prog-run-old'), program('prog-run-bare'), program('prog-run-active')]
  state.days = {
    'prog-run-cut': DAYS,
    // the saved program the run started from, with other workout names: a screen that reads the wrong program shows them
    'prog-saved-ppl': DAYS.map((d) => ({ ...d, name: `SAVED ${d.name}` })),
    'prog-run-old': DAYS,
    'prog-run-bare': DAYS,
  }
  state.plans = {
    'meso-cut': cutPplPlans(),
    // plans under the run copy's program id: a screen that asks for the program's plans where the run's belong shows this
    'prog-run-cut': [session(1, 'pull-1', [{ ex: 'bench' }])],
    'meso-old': [session(1, 'pull-1', [{ ex: 'lat' }]), session(2, 'pull-1', [{ ex: 'lat', sets: 4 }])],
    'meso-bare': [session(1, 'pull-1', [{ ex: 'lat' }])],
  }
  state.schedules = { 'meso-cut': RUN_SCHEDULES }
  state.marks = {
    'prog-run-cut': [mark('chest', 'focus'), mark('back', 'focus'), mark('calves', 'dont_care')],
    // the saved program's marks, which the planner may have changed since the run started
    'prog-saved-ppl': [mark('quads', 'focus')],
  }
  state.legacy = { 'meso-old': true }
  state.marksPending = false
  state.marksError = false
  state.mesosLoading = false
  state.mesosError = null
  state.pending = false
  state.counted = true
  state.counts = { weeks: 10, sessions: 38, loggedSets: 1046, coachAnalyses: 3, coachNotes: 0 }
  state.sessionIds = ['s-1', 's-2', 's-3']
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
  world()
  state.asked = { days: [], plans: [], schedule: [], marks: [], legacy: [], counts: [] }
})
afterEach(() => {
  cleanup()
  deleteMock.mockReset()
})

function Where() {
  return <div data-testid="where">AT {useLocation().pathname}</div>
}
const tree = (id: string) => (
  <MemoryRouter initialEntries={[`/program/finished/${id}`]}>
    <Routes>
      <Route path="/program/finished/:mesocycleId" element={<FinishedProgramPage />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>
)
function renderAt(id: string) {
  return render(tree(id))
}
const at = () => screen.getByTestId('where').textContent
const tile = (week: number) => screen.getByRole('button', { name: new RegExp(`^WEEK ${week}\\b`) })
const lastOf = <T,>(list: T[]) => list[list.length - 1]

describe('the header (board PR14)', () => {
  it('FINISHED PROGRAM, the name, "Jul 6 → Sep 13, 2026 · 10 weeks · 1 deload" and a PRIORITIES row with the run copy\'s marks', () => {
    renderAt('meso-cut')
    expect(screen.getByText('FINISHED PROGRAM')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('CUT PPL')
    expect(screen.getByText('Jul 6 → Sep 13, 2026 · 10 weeks · 1 deload')).toBeTruthy()
    expect(screen.getByText('PRIORITIES')).toBeTruthy()
    expect(screen.getByText("Focus: chest, back · Don't care: calves")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to Programs' })).toBeTruthy()
  })

  it('the back arrow goes to PROGRAMS', () => {
    renderAt('meso-cut')
    fireEvent.click(screen.getByRole('button', { name: 'Back to Programs' }))
    expect(at()).toBe('AT /program')
  })
})

describe('the tiles and the open week', () => {
  it('ten tiles, WK and the week number, DL on the deload week 7, a dot on the weeks whose structure changed (3, 4 and 8), and the legend', () => {
    renderAt('meso-cut')
    const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-week]'))
    expect(tiles.map((t) => t.textContent)).toEqual(['WK1', 'WK2', 'WK3', 'WK4', 'WK5', 'WK6', 'DL7', 'WK8', 'WK9', 'WK10'])
    expect(tiles.filter((t) => /structure changed/.test(t.getAttribute('aria-label')!)).map((t) => t.getAttribute('data-week'))).toEqual(['3', '4', '8'])
    expect(screen.getByText('STRUCTURE CHANGED THAT WEEK')).toBeTruthy()
    expect(tile(7).getAttribute('aria-label')).toBe('WEEK 7 · DELOAD')
  })

  it('it opens on week 3, the first changed week, and a tap opens another: week 4 is the board\'s picture', () => {
    renderAt('meso-cut')
    expect(tile(3).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Changed from week 2')).toBeTruthy()
    fireEvent.click(tile(4))
    expect(tile(4).getAttribute('aria-pressed')).toBe('true')
    expect(tile(3).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('WEEK 4 · STRUCTURE')).toBeTruthy()
    expect(screen.getByText('Changed from week 3')).toBeTruthy()
  })

  it('week 4: the changes, each with its workout, in the board\'s order and signs', () => {
    renderAt('meso-cut')
    fireEvent.click(tile(4))
    const items = ['Face Pull added', 'Lat Pulldown set 3 is now a dropset', 'Straight-Arm Pulldown removed'].map((text) => screen.getByText(text))
    expect(items.map((el) => el.parentElement!.parentElement!.textContent)).toEqual([
      '+Face Pull addedPULL 1',
      '~Lat Pulldown set 3 is now a dropsetPULL 1',
      '−Straight-Arm Pulldown removedPULL 1',
    ])
  })

  it('week 3: one item for the change that both Push workouts made', () => {
    renderAt('meso-cut')
    const text = screen.getByText('Incline Dumbbell Press: 3 → 4 sets')
    expect(text.parentElement!.textContent).toBe('Incline Dumbbell Press: 3 → 4 setsPUSH 1 · PUSH 2')
  })

  it('a week with nothing changed says so, with its workouts all "NO CHANGES"', () => {
    renderAt('meso-cut')
    fireEvent.click(tile(5))
    expect(screen.getByText('Same as week 4')).toBeTruthy()
    expect(screen.getAllByText('NO CHANGES')).toHaveLength(4)
  })

  it('week 1 started from the program', () => {
    renderAt('meso-cut')
    fireEvent.click(tile(1))
    expect(screen.getByText('Started from the program')).toBeTruthy()
  })

  it('the deload week is labelled WEEK 7 · DELOAD in its card', () => {
    renderAt('meso-cut')
    fireEvent.click(tile(7))
    expect(screen.getAllByText('WEEK 7 · DELOAD').length).toBeGreaterThan(0)
  })
})

describe('the workout cards (board PR14)', () => {
  it('week 4: each workout with its weekday, its tag and its exercises in order; the changed rows, the superset and the removed one drawn as the board draws them', () => {
    renderAt('meso-cut')
    fireEvent.click(tile(4))
    const pull = document.querySelector<HTMLElement>('[data-workout="workout-pull-1"]')!
    expect(pull.textContent).toBe('TUESDAYPull 13 CHANGES' + '01Lat Pulldown3 SETS · 1 DROPSET' + '02Seated Cable RowA1 · 3 SETS' + '03Face PullA2 · 2 SETS' + '04EZ Bar Curl1 WARMUP · 2 SETS' + '—Straight-Arm PulldownREMOVED')
    const rows = Array.from(pull.querySelectorAll<HTMLElement>('[data-state]'))
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['changed', 'same', 'changed', 'same', 'removed'])
    const removed = rows[4]
    expect(removed.style.borderStyle).toBe('dashed')
    expect((removed.querySelector('span span:nth-child(2)') as HTMLElement).style.textDecoration).toBe('line-through')
    expect(rows[0].style.borderColor).toBe('var(--accent)')
    const legs = document.querySelector<HTMLElement>('[data-workout="workout-legs"]')!
    expect(within(legs).getByText('SATURDAY')).toBeTruthy()
    expect(within(legs).getByText('NO CHANGES')).toBeTruthy()
  })

  it('the weekday of a workout is the one in force that week: Push 2 on Thursday in week 4 and on Friday in week 5', () => {
    renderAt('meso-cut')
    const push2 = () => document.querySelector<HTMLElement>('[data-workout="workout-push-2"]')!
    fireEvent.click(tile(4))
    expect(within(push2()).getByText('THURSDAY')).toBeTruthy()
    fireEvent.click(tile(5))
    expect(within(push2()).getByText('FRIDAY')).toBeTruthy()
    expect(within(push2()).queryByText('THURSDAY')).toBeNull()
  })

  it('"3 SETS" with no day line for a workout on no weekday that week, and the cards follow the program\'s order', () => {
    state.schedules = { 'meso-cut': [{ id: 'rs', userId: 'user-1', mesocycleId: 'meso-cut', fromWeek: 1, schedule: NO_DAYS, createdAt: '' }] }
    renderAt('meso-cut')
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-workout]'))
    expect(cards.map((c) => c.getAttribute('data-workout'))).toEqual(['workout-push-1', 'workout-pull-1', 'workout-push-2', 'workout-legs'])
    expect(cards.map((c) => c.firstElementChild!.firstElementChild!.children.length)).toEqual([1, 1, 1, 1])
  })
})

describe('where it reads (one break per call pattern): each hook is asked for the run, or the run\'s own program, never the saved program or another id', () => {
  it('the weeks are the run\'s (not the run copy program\'s id, which holds another bench-only plan here)', () => {
    renderAt('meso-cut')
    expect(lastOf(state.asked.plans)).toBe('meso-cut')
    expect(screen.queryByText('Bench Press')).toBeNull()
    expect(screen.getAllByText('Lat Pulldown').length).toBeGreaterThan(0)
  })

  it('the workouts\' names are the run copy\'s, not the saved program\'s', () => {
    renderAt('meso-cut')
    expect(lastOf(state.asked.days)).toBe('prog-run-cut')
    expect(screen.getByText('Pull 1')).toBeTruthy()
    expect(screen.queryByText('SAVED Pull 1')).toBeNull()
  })

  it('the weekdays are read for the run (the days in force, week by week), and are not asked for at all on a sequence run', () => {
    renderAt('meso-cut')
    expect(lastOf(state.asked.schedule)).toBe('meso-cut')
    cleanup()
    state.asked.schedule = []
    state.programs = [program('prog-run-cut', { scheduleType: 'sequence' })]
    state.plans['meso-cut'] = [session(1, 'pull-1', [{ ex: 'lat' }], { sequencePosition: 0 }), session(1, 'legs', [{ ex: 'squat' }], { sequencePosition: 1 })]
    renderAt('meso-cut')
    expect(state.asked.schedule.every((id) => id === undefined)).toBe(true)
    expect(screen.getByText('WEEK 1 · STRUCTURE'.replace('WEEK', 'CYCLE'))).toBeTruthy()
    expect(screen.getByText('SLOT 1')).toBeTruthy()
    expect(screen.getByText('SLOT 2')).toBeTruthy()
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-week]')).map((t) => t.textContent)).toEqual(['CY1'])
  })

  it('the marks are the run copy\'s, not the saved program\'s (which says quads here)', () => {
    renderAt('meso-cut')
    expect(lastOf(state.asked.marks)).toBe('prog-run-cut')
    expect(screen.queryByText(/quads/i)).toBeNull()
  })

  it('the old table is asked about this run, and only when the run copy holds no marks', () => {
    renderAt('meso-cut')
    expect(state.asked.legacy.every((id) => id === null)).toBe(true)
    cleanup()
    state.asked.legacy = []
    renderAt('meso-old')
    expect(lastOf(state.asked.legacy)).toBe('meso-old')
  })
})

describe('the PRIORITIES row leads by where the run\'s marks are (G50)', () => {
  const rowLink = () => document.querySelector<HTMLAnchorElement>('[data-priorities-row]')!

  it('marks on the run copy (the new table) → the editor', () => {
    renderAt('meso-cut')
    expect(rowLink().getAttribute('href')).toBe('/program/finished/meso-cut/priorities')
  })

  it('marks only in the old table (a run finished before 1.1) → the completed-run page as it is, and no summary line of ours', () => {
    renderAt('meso-old')
    expect(rowLink().getAttribute('href')).toBe('/meso/meso-old/priorities')
    expect(rowLink().textContent).toBe('PRIORITIES')
  })

  it('marks in neither → the editor (a mark can be set on any finished program), the row only its label', () => {
    renderAt('meso-bare')
    expect(rowLink().getAttribute('href')).toBe('/program/finished/meso-bare/priorities')
    expect(rowLink().textContent).toBe('PRIORITIES')
  })

  it('marks in both → the new table\'s editor (the migration mapped an active run\'s old marks onto it)', () => {
    state.legacy = { 'meso-cut': true }
    renderAt('meso-cut')
    expect(rowLink().getAttribute('href')).toBe('/program/finished/meso-cut/priorities')
  })

  it('until the marks are read the row is there and leads nowhere; a failed read says so, and still leads nowhere', () => {
    state.marksPending = true
    renderAt('meso-cut')
    expect(rowLink().tagName).toBe('DIV')
    expect(rowLink().getAttribute('aria-disabled')).toBe('true')
    cleanup()
    state.marksPending = false
    state.marksError = true
    renderAt('meso-cut')
    expect(rowLink().tagName).toBe('DIV')
    expect(screen.getByText("Couldn't load priorities.")).toBeTruthy()
  })
})

describe('the states', () => {
  it('while the runs are read: a spinner and no program', () => {
    state.mesosLoading = true
    renderAt('meso-cut')
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('a read that failed says so with the real reason, and nothing else', () => {
    state.mesosError = new Error('JWT expired')
    renderAt('meso-cut')
    expect(screen.getByText("COULDN'T LOAD THIS PROGRAM")).toBeTruthy()
    expect(screen.getByText('JWT expired')).toBeTruthy()
    expect(screen.queryByText('DELETE THIS FINISHED PROGRAM')).toBeNull()
  })

  it('an id that is no run, and the id of a running program, are not a finished program (and have no delete)', () => {
    for (const id of ['meso-nothing', 'meso-active']) {
      cleanup()
      renderAt(id)
      expect(screen.getByText("COULDN'T FIND THIS PROGRAM")).toBeTruthy()
      expect(screen.queryByText('DELETE THIS FINISHED PROGRAM')).toBeNull()
    }
  })

  it('a program that planned no week says so and can still be deleted', () => {
    state.plans['meso-cut'] = []
    renderAt('meso-cut')
    expect(screen.getByText('NO WEEKS WERE PLANNED')).toBeTruthy()
    expect(screen.getByText('Jul 6 → Sep 13, 2026 · 10 weeks')).toBeTruthy()
    expect(screen.getByText('DELETE THIS FINISHED PROGRAM')).toBeTruthy()
  })

  it('the words meso, mesocycle and run are nowhere on it (C12: "program" everywhere)', () => {
    const { container } = renderAt('meso-cut')
    expect(container.textContent).not.toMatch(/\bmeso(cycle)?s?\b|\brun\b/i)
  })
})

describe('DELETE THIS FINISHED PROGRAM (PR15; since chunk 75 a full delete that counts what goes)', () => {
  const press = () => fireEvent.click(screen.getByText('DELETE THIS FINISHED PROGRAM'))
  const confirm = () => screen.getByRole('button', { name: 'DELETE' })

  it('asks first, in the words of the prototype\'s Delete, and counts and deletes nothing until it is pressed', () => {
    renderAt('meso-cut')
    // closed: nothing is counted (the confirmation does not exist, so nothing asks the counts for anything)
    expect(state.asked.counts).toEqual([])
    expect(screen.queryByText('Delete Cut PPL?')).toBeNull()
    press()
    expect(screen.getByText('Delete Cut PPL?')).toBeTruthy()
    expect(screen.getByText("Deletes its 10 weeks: 38 sessions and 1046 logged sets, plus 3 Coach analyses. Its results leave History, Progress and every stat. This can't be undone.")).toBeTruthy()
    // the destructive variant of the shared confirm (the board draws DELETE in the error colour), not the accent's
    expect(confirm().getAttribute('style')).toContain('var(--error)')
    expect(confirm().getAttribute('style')).not.toContain('var(--accent)')
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('counts THIS program: the run\'s own id, never its copy\'s program id or the saved program\'s, and only while it is open', () => {
    renderAt('meso-cut')
    press()
    expect(state.asked.counts.length).toBeGreaterThan(0)
    expect(state.asked.counts.every(([id]) => id === 'meso-cut')).toBe(true)
    expect(state.asked.counts.every(([, enabled]) => enabled === true)).toBe(true) // the phone is online
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    const asked = state.asked.counts.length
    fireEvent.click(tile(2))
    expect(state.asked.counts).toHaveLength(asked)
  })

  it('"Counting what goes…" with DELETE off while the counts are out', () => {
    state.counted = false
    renderAt('meso-cut')
    press()
    expect(screen.getByText('Delete Cut PPL?')).toBeTruthy()
    expect(screen.getByText('Counting what goes…')).toBeTruthy()
    expect((confirm() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(confirm())
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('CANCEL leaves the program as it is', () => {
    renderAt('meso-cut')
    press()
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    expect(screen.queryByText('Delete Cut PPL?')).toBeNull()
    expect(deleteMock).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('CUT PPL')
  })

  it('DELETE deletes this program once — its own id, not its copy\'s or the saved program\'s — with the session ids read with the counts, and then opens PROGRAMS', async () => {
    deleteMock.mockResolvedValue(['s-1'])
    renderAt('meso-cut')
    press()
    fireEvent.click(confirm())
    await waitFor(() => expect(at()).toBe('AT /program'))
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteMock).toHaveBeenCalledWith({ id: 'meso-cut', sessionIds: ['s-1', 's-2', 's-3'] })
  })

  it('it stays on the page until the delete has resolved: PROGRAMS opens after the write, never before it', async () => {
    let resolve!: () => void
    deleteMock.mockReturnValue(new Promise<void>((res) => { resolve = res }))
    renderAt('meso-cut')
    press()
    fireEvent.click(confirm())
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('where')).toBeNull()
    expect(screen.getByText('Delete Cut PPL?')).toBeTruthy()
    await act(async () => { resolve() })
    await waitFor(() => expect(at()).toBe('AT /program'))
  })

  it('the confirmation outlives the program: the list is read again before the delete resolves and no longer holds it, and DELETING… stays on screen until PROGRAMS opens', async () => {
    let resolve!: () => void
    deleteMock.mockImplementation(() => new Promise<void>((res) => { resolve = res }))
    const view = renderAt('meso-cut')
    press()
    fireEvent.click(confirm())
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    state.mesos = state.mesos.filter((m) => (m as Mesocycle).id !== 'meso-cut') // the lists were read again: the program is gone from them
    state.pending = true
    await act(async () => { view.rerender(tree('meso-cut')) })

    expect(screen.getByText("COULDN'T FIND THIS PROGRAM")).toBeTruthy() // behind the dialog, for the moment before PROGRAMS
    expect(screen.getByText('Delete Cut PPL?')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'DELETING…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByTestId('where')).toBeNull()

    await act(async () => { resolve() })
    await waitFor(() => expect(at()).toBe('AT /program'))
  })

  it('a failed delete keeps the program and the page, says why in the confirm, and DELETE can be pressed again', async () => {
    deleteMock.mockRejectedValueOnce(new Error('permission denied for function v2_delete_finished_run')).mockResolvedValueOnce(undefined)
    renderAt('meso-cut')
    press()
    fireEvent.click(confirm())
    await waitFor(() => expect(screen.getByText("Couldn't delete Cut PPL.")).toBeTruthy())
    expect(screen.getByText('permission denied for function v2_delete_finished_run')).toBeTruthy()
    expect(screen.queryByTestId('where')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('CUT PPL')
    fireEvent.click(confirm())
    await waitFor(() => expect(at()).toBe('AT /program'))
    expect(deleteMock).toHaveBeenCalledTimes(2)
  })

  it('two presses of DELETE in one instant are one delete', async () => {
    let resolve!: () => void
    deleteMock.mockReturnValue(new Promise<void>((res) => { resolve = res }))
    renderAt('meso-cut')
    press()
    const button = confirm()
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(deleteMock).toHaveBeenCalledTimes(1)
    await act(async () => { resolve() })
  })

  it('while it is out the button says DELETING… and cannot be pressed again', () => {
    state.pending = true
    renderAt('meso-cut')
    press()
    const button = screen.getByRole('button', { name: 'DELETING…' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('a program that planned no week is counted and deleted like any other ("0 weeks" when the database says so)', () => {
    state.plans['meso-cut'] = []
    state.counts = { weeks: 0, sessions: 0, loggedSets: 0, coachAnalyses: 0, coachNotes: 0 }
    renderAt('meso-cut')
    press()
    expect(screen.getByText("Deletes its 0 weeks: 0 sessions and 0 logged sets. Its results leave History, Progress and every stat. This can't be undone.")).toBeTruthy()
  })
})

describe('375 px: long names wrap and nothing is wider than the screen', () => {
  const LONG = 'X'.repeat(80)

  it('an 80-letter program name, workout name and exercise name each wrap (overflow-wrap: anywhere) in the header, the cards and the confirm', () => {
    state.mesos = [{ ...CUT, name: LONG }]
    state.days['prog-run-cut'] = DAYS.map((d) => ({ ...d, name: d.id === 'pull-1' ? LONG : d.name }))
    renderAt('meso-cut')
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe(LONG)
    expect(h1.style.overflowWrap).toBe('anywhere')
    const nameCell = screen.getAllByText(LONG).find((el) => el.tagName === 'SPAN')!
    expect(nameCell.style.overflowWrap).toBe('anywhere')
    press()
    expect(screen.getByText(`Delete ${LONG}?`).style.overflowWrap).toBe('anywhere')

    function press() {
      fireEvent.click(screen.getByText('DELETE THIS FINISHED PROGRAM'))
    }
  })

  it('no element carries a fixed pixel width wider than 375', () => {
    const { container } = renderAt('meso-cut')
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
