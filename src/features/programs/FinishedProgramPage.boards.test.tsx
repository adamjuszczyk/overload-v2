// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Mesocycle, Program, RunSchedule, WeeklySchedule } from '../../types'
import type { StoredMark } from '../../lib/priorityMarks'
import { captureRender } from '../../testing/captureRender'
import { DAYS, SCHEDULE, cutPplPlans } from './programHistory.testutil'

// Chunk 66's screens, rendered the way boards PR14 and PR15 draw them, for the 390 px screenshots beside the boards (`CAPTURE_RENDER=1` writes
// `__fixtures__/finished-program-<board>.html`; `npm run shot` turns each into design/1.2/built/<board-id>.png + .txt). Each test captures first,
// then asserts the few things that say the capture is the state its board draws (RULES: a fixture is captured before it asserts). PR14 is the
// board's own run, "Cut PPL", with week 4 open; PR15 is its delete confirm. The long-name variants are for the 375 px checks: an 80-letter program,
// workout and exercise name.
//
// The fixture names read "finished-program-pr14" and so on; none is a utility-shaped word (RULES: Tailwind builds the stylesheet from every
// tracked file).

const state = vi.hoisted(() => ({
  mesos: [] as unknown[],
  programs: [] as unknown[],
  days: {} as Record<string, unknown[]>,
  plans: {} as Record<string, unknown[]>,
  schedules: {} as Record<string, unknown[]>,
  marks: {} as Record<string, unknown[]>,
}))

vi.mock('./useMesos', () => ({
  useMesos: () => ({ data: state.mesos }),
  useDeleteMeso: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('./usePrograms', () => ({
  usePrograms: () => ({ data: state.programs }),
  useWorkoutDays: (programId: string) => ({ data: programId ? state.days[programId] : undefined }),
}))
vi.mock('../plan/useWeekPlan', () => ({ useAllWeekPlans: (mesoId: string) => ({ data: mesoId ? (state.plans[mesoId] ?? []) : undefined }) }))
vi.mock('../plan/useRunSchedule', () => ({ useRunSchedule: (mesoId: string | undefined) => ({ data: mesoId ? (state.schedules[mesoId] ?? []) : undefined }) }))
vi.mock('../plan/useProgramPriorities', () => ({ useProgramPriorities: (programId: string | null) => ({ data: programId ? (state.marks[programId] ?? []) : undefined }) }))
vi.mock('../coach/usePriorityContext', () => ({ usePriorityContext: (mesoId: string | null) => ({ data: mesoId ? { anyExplicit: false } : undefined }) }))

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

describe('PR15 — the delete confirm', () => {
  it('"Delete this finished program?", the line with the program\'s name and dates, CANCEL and DELETE', () => {
    render(ui())
    fireEvent.click(tile(4))
    fireEvent.click(screen.getByText('DELETE THIS FINISHED PROGRAM'))
    captureRender('finished-program-pr15', document.body)

    expect(screen.getByText('Delete this finished program?')).toBeTruthy()
    expect(screen.getByText("Cut PPL, Jul 6 – Sep 13. Its weekly plan is deleted. Its sessions stay in History, and the saved program isn't touched. This can't be undone.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'CANCEL' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'DELETE' })).toBeTruthy()
  })

  it('the same with an 80-letter program name (375 px)', () => {
    const LONG = 'X'.repeat(80)
    state.mesos = [{ ...RUN, name: LONG }]
    render(ui())
    fireEvent.click(screen.getByText('DELETE THIS FINISHED PROGRAM'))
    captureRender('finished-program-pr15-long-name', document.body)
    expect(screen.getByText(new RegExp(`^${LONG}, Jul 6`))).toBeTruthy()
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
