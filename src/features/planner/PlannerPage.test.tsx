// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Program, WorkoutDay } from '../../types'

// Chunk 11 — the planner's own wizard shell: step switching, rename, G14,
// Save (navigates, writes nothing of its own) and Start (v2_start_run,
// chunk 6). StepPriorities/StepExercises/StepVolume are each their own
// heavily-tested component (StepPriorities.test.tsx/StepExercises.test.tsx/
// StepVolume.test.tsx) — mocked here to one-line stand-ins, same posture
// ProgramTab.test.tsx takes toward the very same two step components.

let programs: Program[] = []
let workoutDays: WorkoutDay[] = []
const updateNameMutateAsyncMock = vi.fn()
const startRunMutateAsyncMock = vi.fn()
const splitMutateAsyncMock = vi.fn()
const showToastMock = vi.fn()

vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: programs, isLoading: false }),
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useUpdateProgramName: () => ({ mutateAsync: updateNameMutateAsyncMock }),
}))

vi.mock('../programs/useMesos', () => ({
  useStartRun: () => ({ mutateAsync: startRunMutateAsyncMock, isPending: false }),
}))

vi.mock('../notifications/toastStore', () => ({
  useToastStore: (selector: (s: { show: typeof showToastMock }) => unknown) => selector({ show: showToastMock }),
}))

vi.mock('./usePlanner', async () => {
  const actual = await vi.importActual<typeof import('./plannerService')>('./plannerService')
  return {
    detectSharedWeekdayWorkouts: actual.detectSharedWeekdayWorkouts,
    useSplitSharedWeekdayWorkouts: () => ({ mutateAsync: splitMutateAsyncMock, isPending: false }),
  }
})

vi.mock('./StepPriorities', () => ({ default: () => <div>STEP PRIORITIES</div> }))
vi.mock('./StepExercises', () => ({ default: () => <div>STEP EXERCISES</div> }))
vi.mock('./StepVolume', () => ({ default: () => <div>STEP VOLUME</div> }))

const { default: PlannerPage } = await import('./PlannerPage')

afterEach(() => {
  cleanup()
  updateNameMutateAsyncMock.mockReset()
  startRunMutateAsyncMock.mockReset()
  splitMutateAsyncMock.mockReset()
  showToastMock.mockReset()
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  programs = []
  workoutDays = []
})

const EMPTY_SCHEDULE = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }

function program(overrides: Partial<Program> = {}): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'My Program', schedule: EMPTY_SCHEDULE,
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'saved', planningType: 'week_dependent',
    ...overrides,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div>AT {location.pathname}</div>
}

function renderPlanner() {
  return render(
    <MemoryRouter initialEntries={['/program/prog-1']}>
      <Routes>
        <Route path="/program/:programId" element={<PlannerPage />} />
        <Route path="/program" element={<LocationProbe />} />
        <Route path="/plan" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PlannerPage — program lookup', () => {
  it('shows PROGRAM NOT FOUND when no program matches the route id', () => {
    renderPlanner()
    expect(screen.getByText('PROGRAM NOT FOUND')).toBeTruthy()
  })

  it('renders step 1 (Priorities) by default for a saved program', () => {
    programs = [program()]
    renderPlanner()
    expect(screen.getByText('STEP PRIORITIES')).toBeTruthy()
  })
})

describe('PlannerPage — step switcher ("back and forward between steps")', () => {
  it('switches to Exercises and then Volume on tap', () => {
    programs = [program()]
    renderPlanner()

    fireEvent.click(screen.getByText('2 · EXERCISES'))
    expect(screen.getByText('STEP EXERCISES')).toBeTruthy()

    fireEvent.click(screen.getByText('3 · VOLUME'))
    expect(screen.getByText('STEP VOLUME')).toBeTruthy()

    fireEvent.click(screen.getByText('1 · PRIORITIES'))
    expect(screen.getByText('STEP PRIORITIES')).toBeTruthy()
  })
})

describe('PlannerPage — rename', () => {
  it('tapping the name, editing, and blurring saves the trimmed new name', async () => {
    programs = [program({ name: 'Old Name' })]
    renderPlanner()

    fireEvent.click(screen.getByText('Old Name'))
    const input = screen.getByDisplayValue('Old Name')
    fireEvent.change(input, { target: { value: '  New Name  ' } })
    fireEvent.blur(input)

    expect(updateNameMutateAsyncMock).toHaveBeenCalledWith({ id: 'prog-1', name: 'New Name' })
  })

  it('blurring unchanged does not save', () => {
    programs = [program({ name: 'Same Name' })]
    renderPlanner()

    fireEvent.click(screen.getByText('Same Name'))
    fireEvent.blur(screen.getByDisplayValue('Same Name'))

    expect(updateNameMutateAsyncMock).not.toHaveBeenCalled()
  })
})

describe('PlannerPage — Save and Start', () => {
  it('SAVE writes nothing and navigates to /program (reviewer note 1: open, then save unchanged -> no row changes)', () => {
    programs = [program()]
    renderPlanner()

    fireEvent.click(screen.getByText('SAVE'))

    expect(updateNameMutateAsyncMock).not.toHaveBeenCalled()
    expect(startRunMutateAsyncMock).not.toHaveBeenCalled()
    expect(screen.getByText('AT /program')).toBeTruthy()
  })

  it('START calls v2_start_run (via useStartRun) with the program\'s own name and id, then goes to /plan', async () => {
    programs = [program({ name: 'Hypertrophy' })]
    startRunMutateAsyncMock.mockResolvedValue('meso-1')
    renderPlanner()

    await fireEvent.click(screen.getByText('START'))

    expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'Hypertrophy', programId: 'prog-1' })
    expect(await screen.findByText('AT /plan')).toBeTruthy()
  })

  it('a failed START surfaces the error through the toast store and stays on the planner', async () => {
    programs = [program()]
    startRunMutateAsyncMock.mockRejectedValue(new Error('network down'))
    renderPlanner()

    await fireEvent.click(screen.getByText('START'))

    expect(showToastMock).toHaveBeenCalledWith('network down')
    expect(screen.queryByText('AT /plan')).toBeNull()
  })

  it('a defensive run-kind program (should never actually be routed here) hides step 1 and Save/Start', () => {
    programs = [program({ kind: 'run' })]
    renderPlanner()

    expect(screen.queryByText('1 · PRIORITIES')).toBeNull()
    expect(screen.queryByText('SAVE')).toBeNull()
    expect(screen.queryByText('START')).toBeNull()
    expect(screen.getByText('STEP EXERCISES')).toBeTruthy()
  })
})

describe('PlannerPage — G14: one workout on several weekdays', () => {
  const sharedSchedule = { ...EMPTY_SCHEDULE, monday: 'wd-1', wednesday: 'wd-1', friday: 'wd-1' }

  it('shows the prompt when the schedule shares one workout across weekdays', () => {
    programs = [program({ schedule: sharedSchedule })]
    workoutDays = [{ id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Full Body', position: 0, exercises: [] }]
    renderPlanner()

    expect(screen.getByText('One workout, several weekdays')).toBeTruthy()
    expect(screen.getByText('Monday · Wednesday · Friday')).toBeTruthy()
  })

  it('does not show the prompt when every workout has exactly one weekday', () => {
    programs = [program()]
    renderPlanner()
    expect(screen.queryByText('One workout, several weekdays')).toBeNull()
  })

  it('"KEEP AS IS" dismisses without calling the split mutation', () => {
    programs = [program({ schedule: sharedSchedule })]
    workoutDays = [{ id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Full Body', position: 0, exercises: [] }]
    renderPlanner()

    fireEvent.click(screen.getByText('KEEP AS IS'))

    expect(splitMutateAsyncMock).not.toHaveBeenCalled()
    expect(screen.queryByText('One workout, several weekdays')).toBeNull()
  })

  it('the split only runs after choosing it AND a second, explicit confirm', () => {
    programs = [program({ schedule: sharedSchedule })]
    workoutDays = [{ id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Full Body', position: 0, exercises: [] }]
    splitMutateAsyncMock.mockResolvedValue(undefined)
    renderPlanner()

    fireEvent.click(screen.getByText('GIVE EACH DAY ITS OWN WORKOUT'))
    // Not yet called — this is the selection, not the confirm.
    expect(splitMutateAsyncMock).not.toHaveBeenCalled()
    expect(screen.getByText('Give each weekday its own workout?')).toBeTruthy()

    fireEvent.click(screen.getByText('CONFIRM'))

    expect(splitMutateAsyncMock).toHaveBeenCalledWith({
      schedule: sharedSchedule,
      workoutDays,
      groups: [{ workoutDayId: 'wd-1', weekdays: ['monday', 'wednesday', 'friday'] }],
    })
  })

  it('CANCEL on the confirm step returns to the choice view without calling the mutation', () => {
    programs = [program({ schedule: sharedSchedule })]
    workoutDays = [{ id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Full Body', position: 0, exercises: [] }]
    renderPlanner()

    fireEvent.click(screen.getByText('GIVE EACH DAY ITS OWN WORKOUT'))
    fireEvent.click(screen.getByText('CANCEL'))

    expect(splitMutateAsyncMock).not.toHaveBeenCalled()
    expect(screen.getByText('One workout, several weekdays')).toBeTruthy()
  })
})

describe('PlannerPage — 375px', () => {
  it('no rendered element carries a fixed pixel width wider than 375px', () => {
    programs = [program({ schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1', wednesday: 'wd-1' } })]
    workoutDays = [{ id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Full Body', position: 0, exercises: [] }]
    const { container } = renderPlanner()
    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const value = el.style[prop]
        const m = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
