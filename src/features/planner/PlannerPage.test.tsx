// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import type { Program, WorkoutDay, SequenceItem } from '../../types'

// Chunk 11 — the planner's own wizard shell: step switching, rename, G14,
// Save (navigates, writes nothing of its own) and Start (v2_start_run,
// chunk 6). StepPriorities/StepExercises/StepVolume are each their own
// heavily-tested component (StepPriorities.test.tsx/StepExercises.test.tsx/
// StepVolume.test.tsx) — mocked here to one-line stand-ins.

let programs: Program[] = []
let workoutDays: WorkoutDay[] = []
let sequenceItems: SequenceItem[] = []
const updateNameMutateAsyncMock = vi.fn()
const startRunMutateAsyncMock = vi.fn()
const splitMutateAsyncMock = vi.fn()
const showToastMock = vi.fn()

vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: programs, isLoading: false }),
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useUpdateProgramName: () => ({ mutateAsync: updateNameMutateAsyncMock }),
  // Chunk 33 — START reads the program's sequence (a sequence program is
  // scheduled by it), through useProgramHasSchedule.
  useSequenceItems: () => ({ data: sequenceItems, isLoading: false }),
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
  sequenceItems = []
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

// Chunk 33 — starting needs a schedule, so the tests that start a program give it
// one workout on a weekday.
const WORKOUT_DAY: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Full Body', position: 0, exercises: [] }
const MONDAY_SCHEDULE = { ...EMPTY_SCHEDULE, monday: 'wd-1' }

function LocationProbe() {
  const location = useLocation()
  // the query too (chunk 65): START goes to `/plan?week=1`, and a probe that read the path alone couldn't tell it from `/plan`
  return <div>AT {location.pathname}{location.search}</div>
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

  it('START calls v2_start_run (via useStartRun) with the program\'s own name and id, then goes to Plan with the week forced to 1 (/plan?week=1: chunk 65, SPEC Starting: "lands on Plan, week 1")', async () => {
    programs = [program({ name: 'Hypertrophy', schedule: MONDAY_SCHEDULE })]
    workoutDays = [WORKOUT_DAY]
    startRunMutateAsyncMock.mockResolvedValue('meso-1')
    renderPlanner()

    await fireEvent.click(screen.getByText('START'))

    expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'Hypertrophy', programId: 'prog-1' })
    expect(await screen.findByText('AT /plan?week=1')).toBeTruthy()
  })

  it('a failed START surfaces the error through the toast store and stays on the planner', async () => {
    programs = [program({ schedule: MONDAY_SCHEDULE })]
    workoutDays = [WORKOUT_DAY]
    startRunMutateAsyncMock.mockRejectedValue(new Error('network down'))
    renderPlanner()

    await fireEvent.click(screen.getByText('START'))

    expect(showToastMock).toHaveBeenCalledWith('network down')
    expect(screen.queryByText(/^AT \/plan/)).toBeNull()
  })
})

// Chunk 33 (SPEC Programs and runs [P1.1]: "The planner refuses to open a run's
// copy"). This was a defensive fallback that showed steps 2 and 3 with editing
// on; a run's schedule and workouts are fixed for the run.
describe('PlannerPage — a run\'s copy is refused (chunk 33)', () => {
  const RUN_COPY_MESSAGE = 'THIS PROGRAM IS A RUN\'S COPY'

  it('shows a short message and renders no step, no editor, no Save/Start', () => {
    programs = [program({ kind: 'run', schedule: MONDAY_SCHEDULE })]
    workoutDays = [WORKOUT_DAY]
    renderPlanner()

    expect(screen.getByText(RUN_COPY_MESSAGE)).toBeTruthy()
    // Absence: none of the three steps, nor the switcher that reaches them.
    expect(screen.queryByText('STEP PRIORITIES')).toBeNull()
    expect(screen.queryByText('STEP EXERCISES')).toBeNull()
    expect(screen.queryByText('STEP VOLUME')).toBeNull()
    expect(screen.queryByText('1 · PRIORITIES')).toBeNull()
    expect(screen.queryByText('2 · EXERCISES')).toBeNull()
    expect(screen.queryByText('3 · VOLUME')).toBeNull()
    expect(screen.queryByText('SAVE')).toBeNull()
    expect(screen.queryByText('START')).toBeNull()
    // ... nor the program's name as a rename button (the header is not rendered).
    expect(screen.queryByText('My Program')).toBeNull()
  })

  it('refuses a run\'s copy whatever its planning type', () => {
    for (const planningType of ['stable', 'week_dependent'] as const) {
      programs = [program({ kind: 'run', planningType })]
      const { unmount } = renderPlanner()
      expect(screen.getByText(RUN_COPY_MESSAGE)).toBeTruthy()
      expect(screen.queryByText('STEP EXERCISES')).toBeNull()
      unmount()
    }
  })

  it('the way back goes to the real /program route', () => {
    programs = [program({ kind: 'run' })]
    renderPlanner()

    fireEvent.click(screen.getByText('← Back to programs'))

    expect(screen.getByText('AT /program')).toBeTruthy()
  })

  it('does not refuse a saved program, nor one whose kind is not set (it reads as saved)', () => {
    programs = [program({ kind: 'saved' })]
    const first = renderPlanner()
    expect(screen.queryByText(RUN_COPY_MESSAGE)).toBeNull()
    expect(screen.getByText('STEP PRIORITIES')).toBeTruthy()
    first.unmount()

    const unset = program()
    delete (unset as { kind?: Program['kind'] }).kind
    programs = [unset]
    renderPlanner()
    expect(screen.queryByText(RUN_COPY_MESSAGE)).toBeNull()
    expect(screen.getByText('STEP PRIORITIES')).toBeTruthy()
  })

  it('a run\'s copy never reaches START, even with a scheduled workout (nothing is started from here)', () => {
    programs = [program({ kind: 'run', schedule: MONDAY_SCHEDULE })]
    workoutDays = [WORKOUT_DAY]
    renderPlanner()

    expect(screen.queryByText('START')).toBeNull()
    expect(startRunMutateAsyncMock).not.toHaveBeenCalled()
  })
})

// Chunk 33 (SPEC Programs and runs [P1.1], G39: "Starting a run needs a
// schedule: at least one workout on a weekday (weekday), or one workout in the
// sequence (sequence). Start isn't possible without one."; DECISIONS 85,
// provisional: START disabled, one line under it).
describe('PlannerPage — START needs a schedule (chunk 33)', () => {
  const REASON = 'Schedule at least one workout to start'
  const startButton = () => screen.getByText('START') as HTMLButtonElement

  describe('a weekday program', () => {
    it('with no workout on any weekday: START is disabled, the reason shows, and tapping it starts nothing', () => {
      programs = [program({ schedule: EMPTY_SCHEDULE })]
      workoutDays = [WORKOUT_DAY]
      renderPlanner()

      expect(startButton().disabled).toBe(true)
      expect(screen.getByText(REASON)).toBeTruthy()

      fireEvent.click(startButton())
      expect(startRunMutateAsyncMock).not.toHaveBeenCalled()
      expect(screen.queryByText(/^AT \/plan/)).toBeNull()
    })

    it('with a workout on a weekday: START is enabled, no reason shows, and it starts the program', async () => {
      programs = [program({ name: 'Hypertrophy', schedule: { ...EMPTY_SCHEDULE, thursday: 'wd-1' } })]
      workoutDays = [WORKOUT_DAY]
      startRunMutateAsyncMock.mockResolvedValue('meso-1')
      renderPlanner()

      expect(startButton().disabled).toBe(false)
      expect(screen.queryByText(REASON)).toBeNull()

      fireEvent.click(startButton())
      expect(startRunMutateAsyncMock).toHaveBeenCalledTimes(1)
      expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'Hypertrophy', programId: 'prog-1' })
      expect(await screen.findByText('AT /plan?week=1')).toBeTruthy()
    })

    it('a weekday that names a workout the program no longer has is not a scheduled workout', () => {
      programs = [program({ schedule: { ...EMPTY_SCHEDULE, monday: 'wd-gone' } })]
      workoutDays = [WORKOUT_DAY]
      renderPlanner()

      expect(startButton().disabled).toBe(true)
      expect(screen.getByText(REASON)).toBeTruthy()
    })

    it('a stale sequence under a weekday program is not read (only the weekday map is)', () => {
      programs = [program({ scheduleType: 'weekday', schedule: EMPTY_SCHEDULE })]
      workoutDays = [WORKOUT_DAY]
      sequenceItems = [{ id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-1' }]
      renderPlanner()

      expect(startButton().disabled).toBe(true)
      expect(screen.getByText(REASON)).toBeTruthy()
    })
  })

  describe('a sequence program', () => {
    it('with no slot at all: START is disabled and the reason shows', () => {
      programs = [program({ scheduleType: 'sequence' })]
      workoutDays = [WORKOUT_DAY]
      renderPlanner()

      expect(startButton().disabled).toBe(true)
      expect(screen.getByText(REASON)).toBeTruthy()
      fireEvent.click(startButton())
      expect(startRunMutateAsyncMock).not.toHaveBeenCalled()
    })

    it('with only rest slots: START is disabled and the reason shows', () => {
      programs = [program({ scheduleType: 'sequence' })]
      workoutDays = [WORKOUT_DAY]
      sequenceItems = [
        { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: null },
        { id: 'si-2', userId: 'user-1', programId: 'prog-1', position: 1, workoutDayId: null },
      ]
      renderPlanner()

      expect(startButton().disabled).toBe(true)
      expect(screen.getByText(REASON)).toBeTruthy()
    })

    it('a weekday map left under a sequence program does not schedule it', () => {
      programs = [program({ scheduleType: 'sequence', schedule: MONDAY_SCHEDULE })]
      workoutDays = [WORKOUT_DAY]
      renderPlanner()

      expect(startButton().disabled).toBe(true)
      expect(screen.getByText(REASON)).toBeTruthy()
    })

    it('with one workout in the sequence: START is enabled, no reason shows, and it starts the program', () => {
      programs = [program({ name: 'Cycle', scheduleType: 'sequence' })]
      workoutDays = [WORKOUT_DAY]
      sequenceItems = [
        { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: null },
        { id: 'si-2', userId: 'user-1', programId: 'prog-1', position: 1, workoutDayId: 'wd-1' },
      ]
      startRunMutateAsyncMock.mockResolvedValue('meso-1')
      renderPlanner()

      expect(startButton().disabled).toBe(false)
      expect(screen.queryByText(REASON)).toBeNull()

      fireEvent.click(startButton())
      expect(startRunMutateAsyncMock).toHaveBeenCalledWith({ name: 'Cycle', programId: 'prog-1' })
    })
  })

  it('SAVE stays available without a schedule (it writes nothing and leaves the planner)', () => {
    programs = [program({ schedule: EMPTY_SCHEDULE })]
    renderPlanner()

    fireEvent.click(screen.getByText('SAVE'))

    expect(screen.getByText('AT /program')).toBeTruthy()
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
