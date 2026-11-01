// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Mesocycle, Program, RunSchedule, WeeklySchedule } from '../../types'
import type { StoredMark } from '../../lib/priorityMarks'
import { densifyPriorities } from '../../lib/priorityTags'
import { captureRender } from '../../testing/captureRender'
import { DAYS, SCHEDULE, cutPplPlans } from './programHistory.testutil'

// Chunk 66's screens, rendered the way boards PR14 and PR15 draw them, for the 390 px screenshots beside the boards (`CAPTURE_RENDER=1` writes
// `__fixtures__/finished-program-<board>.html`; `npm run shot` turns each into design/1.2/built/<board-id>.png + .txt). Each test captures first,
// then asserts the few things that say the capture is the state its board draws (RULES: a fixture is captured before it asserts). PR14 is the
// board's own run, "Cut PPL", with week 4 open; PR15 is its delete confirm (since chunk 75 the full delete's: see below). The long-name variants are for the 375 px checks: an 80-letter program,
// workout and exercise name.
//
// The fixture names read "finished-program-pr14" and so on; none is a utility-shaped word (RULES: Tailwind builds the stylesheet from every
// tracked file).

const deleteMock = vi.hoisted(() => vi.fn())
const state = vi.hoisted(() => ({
  mesos: [] as unknown[],
  programs: [] as unknown[],
  days: {} as Record<string, unknown[]>,
  plans: {} as Record<string, unknown[]>,
  schedules: {} as Record<string, unknown[]>,
  marks: {} as Record<string, unknown[]>,
  // the full delete's confirmation (chunk 75): the phone's connection, whether the counts have answered, and what they say
  online: true,
  counted: true,
  counts: { weeks: 10, sessions: 38, loggedSets: 1046, coachAnalyses: 3, coachNotes: 0 } as Record<string, number>,
}))

vi.mock('./useMesos', () => ({
  useMesos: () => ({ data: state.mesos }),
  useFinishedRunCounts: (_id: string, enabled: boolean) =>
    state.counted && enabled
      ? { data: { counts: state.counts, sessionIds: ['s-1', 's-2'] }, isFetching: false, isError: false, error: null }
      : { data: undefined, isFetching: enabled, isError: false, error: null },
  useDeleteFinishedRun: () => ({ mutateAsync: (...args: unknown[]) => deleteMock(...args), isPending: false }),
}))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => state.online }))
vi.mock('./usePrograms', () => ({
  usePrograms: () => ({ data: state.programs }),
  useWorkoutDays: (programId: string) => ({ data: programId ? state.days[programId] : undefined }),
}))
vi.mock('../plan/useWeekPlan', () => ({ useAllWeekPlans: (mesoId: string) => ({ data: mesoId ? (state.plans[mesoId] ?? []) : undefined }) }))
vi.mock('../plan/useRunSchedule', () => ({ useRunSchedule: (mesoId: string | undefined) => ({ data: mesoId ? (state.schedules[mesoId] ?? []) : undefined }) }))
vi.mock('../plan/useProgramPriorities', () => ({ useProgramPriorities: (programId: string | null) => ({ data: programId ? (state.marks[programId] ?? []) : undefined }) }))
// Coach's old table, asked for a run whose copy holds no marks: nothing set (the real answer's shape: all 34 tags, none explicit)
vi.mock('../coach/usePriorityContext', () => ({ usePriorityContext: (mesoId: string | null) => ({ data: mesoId ? { mesocycleId: mesoId, ...densifyPriorities([]) } : undefined }) }))

const { default: FinishedProgramPage } = await import('./FinishedProgramPage')

const mark = (tagValue: string, value: StoredMark['mark']): StoredMark => ({ tagType: 'muscle_group', tagValue, mark: value, updatedAt: '2026-01-01T00:00:00Z' })
const RUN: Mesocycle = { id: 'meso-cut', userId: 'user-1', name: 'Cut PPL', programId: 'prog-run-cut', sourceProgramId: 'prog-saved-ppl', status: 'completed', startDate: '2026-07-06', endDate: '2026-09-13', createdAt: '' }
const COPY: Program = { id: 'prog-run-cut', userId: 'user-1', name: 'Cut PPL', schedule: SCHEDULE, workoutDays: [], createdAt: '', updatedAt: '', kind: 'run', planningType: 'week_dependent', scheduleType: 'weekday' }
// The board's days: Pull 1 on Tuesday, Legs on Saturday, Push 1 on Monday and Push 2 on Thursday all the run long
const ROWS: RunSchedule[] = [{ id: 'rs-1', userId: 'user-1', mesocycleId: 'meso-cut', fromWeek: 1, schedule: SCHEDULE as WeeklySchedule, createdAt: '' }]

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
  state.mesos = [RUN]
  state.programs = [COPY]
  state.days = { 'prog-run-cut': DAYS }
  state.plans = { 'meso-cut': cutPplPlans() }
  state.schedules = { 'meso-cut': ROWS }
  state.marks = { 'prog-run-cut': [mark('chest', 'focus'), mark('back', 'focus'), mark('calves', 'dont_care')] }
  state.online = true
  state.counted = true
  state.counts = { weeks: 10, sessions: 38, loggedSets: 1046, coachAnalyses: 3, coachNotes: 0 }
  deleteMock.mockReset()
})
afterEach(() => cleanup())

const ui = () => (
  <MemoryRouter initialEntries={['/program/finished/meso-cut']}>
    <Routes>
      <Route path="/program/finished/:mesocycleId" element={<FinishedProgramPage />} />
    </Routes>
  </MemoryRouter>
)
const tile = (week: number) => screen.getByRole('button', { name: new RegExp(`^WEEK ${week}\\b`) })

describe('PR14 — a finished program', () => {
  it('FINISHED PROGRAM, the name, the dates line, PRIORITIES, the tiles with week 4 open, the week\'s changes and its structure, DELETE THIS FINISHED PROGRAM', () => {
    render(ui())
    fireEvent.click(tile(4))
    captureRender('finished-program-pr14', document.body)

    expect(screen.getByText('FINISHED PROGRAM')).toBeTruthy()
    expect(screen.getByText('CUT PPL')).toBeTruthy()
    expect(screen.getByText('Jul 6 → Sep 13, 2026 · 10 weeks · 1 deload')).toBeTruthy()
    expect(screen.getByText("Focus: chest, back · Don't care: calves")).toBeTruthy()
    expect(tile(4).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Changed from week 3')).toBeTruthy()
    expect(screen.getByText('WEEK 4 · STRUCTURE')).toBeTruthy()
    expect(screen.getByText('3 CHANGES')).toBeTruthy()
    expect(screen.getByText('DELETE THIS FINISHED PROGRAM')).toBeTruthy()
  })

  it('the same with an 80-letter program name, workout name and exercise name (375 px)', () => {
    const LONG = 'X'.repeat(80)
    state.mesos = [{ ...RUN, name: LONG }]
    state.days = { 'prog-run-cut': DAYS.map((d) => ({ ...d, name: d.id === 'pull-1' ? LONG : d.name })) }
    state.plans = {
      'meso-cut': cutPplPlans().map((p) => ({ ...p, exercises: p.exercises.map((e) => (e.exerciseId === 'lat' ? { ...e, exercise: { ...e.exercise!, name: LONG } } : e)) })),
    }
    render(ui())
    fireEvent.click(tile(4))
    captureRender('finished-program-pr14-long-name', document.body)
    expect(screen.getAllByText(LONG).length).toBeGreaterThan(1)
  })
})

// Chunk 76 (1.2.1 items 24, 25, 20 and 1): the prototype's "Finished program" has two DEMO states of the screen itself, Cut PPL, 10 weeks and False start,
// 1 week, captured as `finished-program-cut-ppl-10-weeks` and `finished-program-false-start-1-week` (design/1.2.1/built/<same name>.png + .txt by `npm run
// shot`). Cut PPL is the 10-week run with tall cards: week 1's four workouts are taller than the phone, so the week strip above them is the one that used to
// shrink to nothing. A capture shows that only when the screen is held to the phone's height, as it is in the app (its page root is `height: 100%`, and
// `captureRender` takes the render's body, whose wrapper has no height of its own, so the full-page pictures of PR14 and the deletes never constrained it):
// these two are drawn inside an 844 px frame. The screen opens on week 1, its rows carry no superset labels, and the PRIORITIES row says "Focus: chest,
// back · Don't care: calves" (the prototype's seed). The false start is the prototype's Push Pull Legs of Oct 5 to Oct 11: Push 1 and Pull 1 of its one
// week, no marks.
describe('Finished program (1.2.1): Cut PPL, 10 weeks and False start, 1 week', () => {
  it('Cut PPL, 10 weeks: it opens on week 1, the strip of ten tiles never shrinks, the cards carry no superset label, and PRIORITIES leads with its marks', () => {
    render(<div style={{ height: 844 }}>{ui()}</div>)
    captureRender('finished-program-cut-ppl-10-weeks', document.body)

    expect(tile(1).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Started from the program')).toBeTruthy()
    expect(screen.getByText('WEEK 1 · STRUCTURE')).toBeTruthy()
    const strip = screen.getByLabelText('Weeks of this program')
    expect(strip.children).toHaveLength(10)
    expect(strip.style.flexShrink).toBe('0')
    expect(Array.from(document.querySelectorAll('[data-workout]')).map((el) => el.getAttribute('data-workout'))).toEqual(['workout-push-1', 'workout-pull-1', 'workout-push-2', 'workout-legs'])
    expect(document.body.textContent).not.toMatch(/\b[AB][12] · /)
    expect(document.querySelector<HTMLAnchorElement>('[data-priorities-row]')!.getAttribute('href')).toBe('/program/finished/meso-cut/priorities')
    expect(screen.getByText("Focus: chest, back · Don't care: calves")).toBeTruthy()
  })

  it('False start, 1 week: one tile, open, Push 1 and Pull 1, PRIORITIES with no line (nothing is marked)', () => {
    state.mesos = [{ ...RUN, id: 'meso-ppl2', name: 'Push Pull Legs', programId: 'prog-run-ppl2', startDate: '2026-10-05', endDate: '2026-10-11' }]
    state.programs = [{ ...COPY, id: 'prog-run-ppl2', name: 'Push Pull Legs' }]
    state.days = { 'prog-run-ppl2': DAYS }
    state.plans = { 'meso-ppl2': cutPplPlans().filter((p) => p.weekNumber === 1 && (p.workoutDayId === 'push-1' || p.workoutDayId === 'pull-1')) }
    state.schedules = { 'meso-ppl2': [{ ...ROWS[0], mesocycleId: 'meso-ppl2' }] }
    render(
      <div style={{ height: 844 }}>
        <MemoryRouter initialEntries={['/program/finished/meso-ppl2']}>
          <Routes>
            <Route path="/program/finished/:mesocycleId" element={<FinishedProgramPage />} />
          </Routes>
        </MemoryRouter>
      </div>,
    )
    captureRender('finished-program-false-start-1-week', document.body)

    expect(screen.getByText('Oct 5 → Oct 11, 2026 · 1 week')).toBeTruthy()
    expect(Array.from(document.querySelectorAll('[data-week]')).map((t) => t.textContent)).toEqual(['WK1'])
    expect(tile(1).getAttribute('aria-pressed')).toBe('true')
    expect(Array.from(document.querySelectorAll('[data-workout]')).map((el) => el.getAttribute('data-workout'))).toEqual(['workout-push-1', 'workout-pull-1'])
    expect(document.querySelector('[data-priorities-row]')!.textContent).toBe('PRIORITIES')
  })
})

// Chunk 75 (1.2.1 item 8b): PR15 is the full delete's confirmation now, and the prototype's "Finished program" has three DEMO states of it — Delete (Cut PPL, with
// Coach rows), Delete, no Coach rows (a one-week program) and Delete offline — captured as `finished-program-delete`, `finished-program-delete-no-coach-rows`
// and `finished-program-delete-offline` (turned into design/1.2.1/built/<same name>.png + .txt by `npm run shot`). The prototype counts Coach analyses only; SPEC
// adds the notes ("[ and N Coach notes]"), so a fourth picture shows both parts. The counts are the prototype's (prototype/src/demo/seed.ts): Cut PPL 10 weeks, 38
// sessions, 1046 logged sets, 3 Coach analyses; the false start 1 week, 2 sessions, 31 sets, none.
describe('PR15 — the full delete confirmation (1.2.1 item 8b)', () => {
  const open = () => {
    render(ui())
    fireEvent.click(screen.getByText('DELETE THIS FINISHED PROGRAM'))
  }

  it('Delete: "Delete Cut PPL?", the counted sentence with its Coach part, CANCEL and a red DELETE', () => {
    open()
    captureRender('finished-program-delete', document.body)

    expect(screen.getByText('Delete Cut PPL?')).toBeTruthy()
    expect(screen.getByText("Deletes its 10 weeks: 38 sessions and 1046 logged sets, plus 3 Coach analyses. Its results leave History, Progress and every stat. This can't be undone.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeTruthy()
    const deleteButton = screen.getByRole('button', { name: 'DELETE' }) as HTMLButtonElement
    expect(deleteButton.disabled).toBe(false)
    expect(deleteButton.style.background).toBe('var(--error)')
  })

  it('Delete, no Coach rows: a false start of one week reads "1 week" and names no Coach part', () => {
    state.mesos = [{ ...RUN, id: 'meso-ppl2', name: 'Push Pull Legs', programId: 'prog-run-ppl2', startDate: '2026-10-05', endDate: '2026-10-11' }]
    state.programs = [{ ...COPY, id: 'prog-run-ppl2', name: 'Push Pull Legs' }]
    state.days = { 'prog-run-ppl2': DAYS }
    state.plans = { 'meso-ppl2': cutPplPlans().slice(0, 3) }
    state.counts = { weeks: 1, sessions: 2, loggedSets: 31, coachAnalyses: 0, coachNotes: 0 }
    render(
      <MemoryRouter initialEntries={['/program/finished/meso-ppl2']}>
        <Routes>
          <Route path="/program/finished/:mesocycleId" element={<FinishedProgramPage />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('DELETE THIS FINISHED PROGRAM'))
    captureRender('finished-program-delete-no-coach-rows', document.body)

    expect(screen.getByText('Delete Push Pull Legs?')).toBeTruthy()
    expect(screen.getByText("Deletes its 1 week: 2 sessions and 31 logged sets. Its results leave History, Progress and every stat. This can't be undone.")).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Coach/)
  })

  it("Delete offline: \"You're offline. Deleting needs a connection.\" and DELETE off — no count is named", () => {
    state.online = false
    open()
    captureRender('finished-program-delete-offline', document.body)

    expect(screen.getByText('Delete Cut PPL?')).toBeTruthy()
    expect(screen.getByText("You're offline. Deleting needs a connection.")).toBeTruthy()
    expect(screen.queryByText(/^Deletes its/)).toBeNull()
    expect((screen.getByRole('button', { name: 'DELETE' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("ours: both Coach parts, which SPEC adds to the prototype's sentence (\"plus 3 Coach analyses and 2 Coach notes\")", () => {
    state.counts = { weeks: 10, sessions: 38, loggedSets: 1046, coachAnalyses: 3, coachNotes: 2 }
    open()
    captureRender('finished-program-delete-with-notes', document.body)

    expect(screen.getByText("Deletes its 10 weeks: 38 sessions and 1046 logged sets, plus 3 Coach analyses and 2 Coach notes. Its results leave History, Progress and every stat. This can't be undone.")).toBeTruthy()
  })

  it('ours: counting — "Counting what goes…" with DELETE off (the moment before the counts answer)', () => {
    state.counted = false
    open()
    captureRender('finished-program-delete-counting', document.body)

    expect(screen.getByText('Counting what goes…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'DELETE' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the same with an 80-letter program name (375 px)', () => {
    const LONG = 'X'.repeat(80)
    state.mesos = [{ ...RUN, name: LONG }]
    open()
    captureRender('finished-program-delete-long-name', document.body)
    expect(screen.getByText(`Delete ${LONG}?`)).toBeTruthy()
  })

  it('ours: a delete the database refuses stays inside — "Couldn\'t delete Cut PPL." and the reason, the counted sentence still there, DELETE on again', async () => {
    deleteMock.mockRejectedValue({ code: 'OL003', message: 'only a finished program can be deleted' })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'DELETE' }))
    await screen.findByText("Couldn't delete Cut PPL.")
    captureRender('finished-program-delete-failed', document.body)

    expect(screen.getByText('only a finished program can be deleted')).toBeTruthy()
    expect(screen.getByText(/^Deletes its 10 weeks/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'DELETE' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('the same refusal with an 80-letter program name (375 px): the failure line wraps too', async () => {
    const LONG = 'X'.repeat(80)
    state.mesos = [{ ...RUN, name: LONG }]
    deleteMock.mockRejectedValue({ code: 'OL003', message: 'only a finished program can be deleted' })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'DELETE' }))
    await screen.findByText(`Couldn't delete ${LONG}.`)
    captureRender('finished-program-delete-failed-long-name', document.body)
    expect(screen.getByText(`Couldn't delete ${LONG}.`).style.overflowWrap).toBe('anywhere')
  })
})

// ours: the states no board draws, for the same pictures' sake
describe('a program that planned no week', () => {
  it('says so, under the header, with the delete still there', () => {
    state.plans = { 'meso-cut': [] }
    render(ui())
    captureRender('finished-program-no-weeks', document.body)
    expect(screen.getByText('NO WEEKS WERE PLANNED')).toBeTruthy()
  })
})
