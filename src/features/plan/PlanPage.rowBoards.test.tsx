// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, MuscleGroup, Program, ProgramExercise, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { captureRender } from '../../testing/captureRender'
import { pe, plan, stage, wset } from './weekPlanning.testutil'

// Chunk 54a: the exercise cards and set rows rendered the way boards 1, 1a and 9 draw them, for the 390 px screenshots beside the boards
// (`CAPTURE_RENDER=1` writes `__fixtures__/plan-<board>.html`; `npm run shot` turns each into design/1.2/built/<board>.png + .txt). Each test
// captures first, then asserts the few things that say the capture is the state its board draws (RULES: a fixture is captured before it
// asserts). The real PlanPage tree with the data hooks mocked, at 390 px.
//
//   board 1   Tuesday's Pull 1 on a week-dependent run: Lat Pulldown (a cue on set 01, a dropset with one drop on set 03), the superset of Seated
//             Cable Row and Face Pull (SUPERSET A · 1, A · 2), EZ Bar Curl with a warmup (W, 01, 02), each card with its "+" and no ⋯ of its own;
//             under the header's tiles, COPY and WEEK ⋯, the session toggle and CHANGE THE PROGRAM.
//   board 1a  the same week on a stable run: the same cards and rows (the stable week's THIS WEEK ONLY line and legend are 54b's).
//   board 9   the cell states: the weight being typed, the weight that isn't a number, a set with nothing set, an exercise in lbs, a set being
//             added ("+" disabled). The "changes since" marks and the deload session are 54b's.
//
// Not drawn here, because other chunks build them: the session chips and states, the legend and marks, VOLUME and REVIEW (54b, 55, 56). The
// old week-diff marks (chunk 31) are on the rows until 54b; both weeks hold the same numbers here, so none shows.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
})

const monday = (weeksAgo: number) => format(startOfWeek(subWeeks(new Date(), weeksAgo), { weekStartsOn: 1 }), 'yyyy-MM-dd')
const PROGRAM_NAME = 'Push Pull Legs'
const wd = (id: string, name: string, position: number): WorkoutDay => ({ id, programId: 'prog-1', userId: 'user-1', name, position, exercises: [] })
const DAYS = [wd('wd-push1', 'Push 1', 0), wd('wd-pull1', 'Pull 1', 1), wd('wd-push2', 'Push 2', 2), wd('wd-pull2', 'Pull 2', 3)]
const WEEKDAYS = { ...EMPTY_SCHEDULE, monday: 'wd-push1', tuesday: 'wd-pull1', thursday: 'wd-push2', friday: 'wd-pull2' }

const state = vi.hoisted(() => ({
  meso: null as unknown as Mesocycle,
  program: null as unknown as Program,
  all: [] as WeekPlan[],
  done: new Set<string>(),
  addPending: false,
  addVariables: undefined as { programExerciseId: string } | undefined,
}))

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [state.meso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [state.program], isLoading: false }),
  useWorkoutDays: () => ({ data: DAYS, isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./useReview', () => ({ useReview: () => ({ status: 'ready', groups: [], count: 0, error: null }) })) // REVIEW's line (chunk 56): nothing differed here
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined })) // the week view's session states (chunk 54b): none here
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => state.done }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
vi.mock('./useCopyNumbers', () => ({ useCopyNumbers: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: state.all.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: state.all, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: state.addPending, variables: state.addVariables }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')

// ─── Tuesday's Pull 1, as board 1 draws it ────────────────────────────────────

const named = (id: string, name: string, muscleGroup: MuscleGroup, position: number, over: Partial<ProgramExercise> = {}): ProgramExercise => {
  const base = pe(id, id, position, { workoutDayId: 'wd-pull1', ...over })
  return { ...base, exercise: { ...base.exercise!, name, muscleGroup } }
}
const LAT = named('pe-lat', 'Lat Pulldown', 'back', 0)
const ROW = named('pe-row', 'Seated Cable Row', 'back', 1, { supersetBlockId: 'blk-a' })
const FACE = named('pe-face', 'Face Pull', 'shoulders', 2, { supersetBlockId: 'blk-a' })
const CURL = named('pe-curl', 'EZ Bar Curl', 'biceps', 3)

function pullDay(week: number, over: { lat?: WeekPlanSet[]; lbs?: boolean } = {}): WeekPlan {
  const id = (name: string) => `${name}-${week}`
  const planId = `wp-wd-pull1-${week}`
  const s = (name: string, peId: string, setNumber: number, more: Partial<WeekPlanSet>) => wset(id(name), peId, setNumber, { weekPlanId: planId, ...more })
  const lat = over.lat ?? [
    s('lat1', 'pe-lat', 1, { targetWeight: 55, repMin: 8, repMax: 10, targetRir: 2, tags: ['push back'] }),
    s('lat2', 'pe-lat', 2, { targetWeight: 55, repMin: 8, repMax: 10, targetRir: 2 }),
    s('lat3', 'pe-lat', 3, { targetWeight: 52.5, repMin: 8, repMax: 10, targetRir: 1, stageKind: 'dropset' }),
    { ...stage(id('lat3s'), id('lat3'), 'pe-lat', 1, { targetWeight: 40, repMin: null, repMax: null, isAmrap: true, targetRir: 0 }), weekPlanId: planId },
  ]
  const sets = [
    ...lat,
    ...[1, 2, 3].map((n) => s(`row${n}`, 'pe-row', n, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 1, targetRirMax: 2 })),
    ...[1, 2].map((n) => s(`face${n}`, 'pe-face', n, { targetWeight: 15, repMin: 15, repMax: 20, targetRir: 1 })),
    s('curlw', 'pe-curl', 1, { isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12, targetRir: null }),
    s('curl1', 'pe-curl', 2, { targetWeight: 30, repMin: 8, repMax: 8, targetRir: 1 }),
    s('curl2', 'pe-curl', 3, { targetWeight: 30, repMin: null, repMax: null, isAmrap: true, targetRir: 0 }),
  ]
  const exercises = over.lbs ? [LAT, { ...ROW, weightUnit: 'lbs' as const }, FACE, CURL] : [LAT, ROW, FACE, CURL]
  return plan(week, exercises, sets, { id: planId, workoutDayId: 'wd-pull1' })
}

function weekdayRun(planningType: Program['planningType'], pull: (week: number) => WeekPlan = pullDay) {
  state.meso = { id: 'meso-1', userId: 'user-1', name: PROGRAM_NAME, programId: 'prog-1', status: 'active', startDate: monday(1), endDate: null, createdAt: '2026-01-01T00:00:00Z' }
  state.program = { id: 'prog-1', userId: 'user-1', name: PROGRAM_NAME, workoutDays: [], schedule: WEEKDAYS, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType }
  const other = (week: number) => ['wd-push1', 'wd-push2', 'wd-pull2'].map((workoutDayId) => plan(week, [], [], { id: `wp-${workoutDayId}-${week}`, workoutDayId }))
  state.all = [1, 2].flatMap((week) => [pull(week), ...other(week)])
  state.done = new Set(['wp-wd-push1-2']) // Monday's Push 1 is done
  state.addPending = false
  state.addVariables = undefined
}

const ui = () => (
  <MemoryRouter initialEntries={['/plan']}>
    <PlanPage />
  </MemoryRouter>
)
const cardOf = (name: string) => screen.getByText(name).closest('[data-exercise-card]') as HTMLElement
// One card on the page's own gutter (16 px), the way board 9 frames a state: the capture is what is INSIDE the element it is given.
function framed(card: HTMLElement): HTMLElement {
  const frame = document.createElement('div')
  frame.style.padding = '16px'
  frame.appendChild(card.cloneNode(true))
  const holder = document.createElement('div')
  holder.appendChild(frame)
  return holder
}

// ─── Board 1 ─────────────────────────────────────────────────────────────────

describe('board 1: the exercise cards and set rows of Tuesday\'s Pull 1 (week-dependent run)', () => {
  it('four cards in the week\'s order, each with name, muscle and "+", the superset chips, the rows as the board numbers them, no ⋯ on an exercise', () => {
    weekdayRun('week_dependent')
    const { container } = render(ui())
    fireEvent.click(screen.getByText('TUE'))
    captureRender('plan-1-rows', document.body)

    expect(Array.from(container.querySelectorAll('[data-exercise-card]')).map((card) => card.querySelector('span')?.textContent)).toEqual(['Lat Pulldown', 'Seated Cable Row', 'Face Pull', 'EZ Bar Curl'])
    // the muscle under each name, and a "+" on each
    for (const [name, muscle] of [['Lat Pulldown', 'BACK'], ['Seated Cable Row', 'BACK'], ['Face Pull', 'SHOULDERS'], ['EZ Bar Curl', 'BICEPS']]) {
      expect(within(cardOf(name)).getByText(muscle)).toBeTruthy()
      expect(within(cardOf(name)).getByLabelText(`Add set to ${name}`)).toBeTruthy()
      expect(screen.queryByLabelText(`${name} options`)).toBeNull()
    }
    expect(within(cardOf('Seated Cable Row')).getByText('SUPERSET A · 1')).toBeTruthy()
    expect(within(cardOf('Face Pull')).getByText('SUPERSET A · 2')).toBeTruthy()
    // Lat Pulldown: 01, 02, 03 with its drop under it; the kind chip over 03; the cue under 01
    const lat = within(cardOf('Lat Pulldown'))
    expect(lat.getByText('DROPSET · 1 DROP')).toBeTruthy()
    expect(lat.getByText('Push back')).toBeTruthy()
    expect(lat.getAllByText('↳')).toHaveLength(1)
    // EZ Bar Curl: W, 01, 02; the warmup has no RIR cell, and set 02 is AMRAP with RIR 0
    const curl = within(cardOf('EZ Bar Curl'))
    expect(curl.getByText('W')).toBeTruthy()
    expect(curl.getAllByRole('button', { name: /^RIR/ })).toHaveLength(2)
    expect(curl.getByRole('button', { name: 'AMRAP' })).toBeTruthy()
    // under the cards: CHANGE THE PROGRAM
    expect(screen.getByText('CHANGE THE PROGRAM FROM WEEK 2')).toBeTruthy()
  })
})

// ─── Board 1a ────────────────────────────────────────────────────────────────

describe('board 1a: the same week on a stable run', () => {
  it('the same four cards and rows; the picker of a stable week has no rest rows (the legend and THIS WEEK ONLY are 54b\'s)', () => {
    weekdayRun('stable')
    render(ui())
    fireEvent.click(screen.getByText('TUE'))
    captureRender('plan-1a-rows', document.body)

    expect(Array.from(document.querySelectorAll('[data-exercise-card]'))).toHaveLength(4)
    expect(within(cardOf('Lat Pulldown')).getByText('DROPSET · 1 DROP')).toBeTruthy()
    expect(within(cardOf('EZ Bar Curl')).getByText('W')).toBeTruthy()
    fireEvent.click(within(cardOf('Lat Pulldown')).getAllByLabelText(/^Options for /)[0])
    expect(screen.queryByText('Rest after this set')).toBeNull()
  })
})

// ─── Board 9: the cell states ────────────────────────────────────────────────

describe('board 9: the cell states', () => {
  it('WEIGHT · EDITING: the weight cell is a field with the accent border, the number typed and the unit', () => {
    weekdayRun('week_dependent')
    render(ui())
    fireEvent.click(screen.getByText('TUE'))
    fireEvent.click(within(cardOf('Lat Pulldown')).getAllByRole('button', { name: '55kg' })[0])
    captureRender('plan-9-weight-editing', framed(cardOf('Lat Pulldown')))

    const field = screen.getByLabelText('Weight target') as HTMLInputElement
    expect(field.value).toBe('55')
    expect(document.activeElement).toBe(field)
    expect(field.closest('div')?.getAttribute('style')).toContain('2px solid var(--accent)')
    expect(within(field.closest('div') as HTMLElement).getByText('kg')).toBeTruthy()
  })

  it('WEIGHT · NOT A NUMBER: the field in the error colour and "Enter a valid weight" under the row', () => {
    weekdayRun('week_dependent')
    render(ui())
    fireEvent.click(screen.getByText('TUE'))
    fireEvent.click(within(cardOf('Lat Pulldown')).getAllByRole('button', { name: '55kg' })[0])
    const field = screen.getByLabelText('Weight target')
    fireEvent.change(field, { target: { value: '5o' } })
    fireEvent.blur(field)
    captureRender('plan-9-weight-invalid', framed(cardOf('Lat Pulldown')))

    expect(screen.getByRole('alert').textContent).toBe('Enter a valid weight')
    expect((screen.getByLabelText('Weight target') as HTMLInputElement).value).toBe('5o')
    expect(screen.getByLabelText('Weight target').closest('div')?.getAttribute('style')).toContain('2px solid var(--error)')
  })

  it('NOTHING SET: dashes in the weight and the reps, and RIR –', () => {
    const empty = (week: number) =>
      pullDay(week, { lat: [wset(`lat4-${week}`, 'pe-lat', 4, { weekPlanId: `wp-wd-pull1-${week}`, targetWeight: null, repMin: null, repMax: null, targetRir: null })] })
    weekdayRun('week_dependent', empty)
    render(ui())
    fireEvent.click(screen.getByText('TUE'))
    captureRender('plan-9-nothing-set', framed(cardOf('Lat Pulldown')))

    const row = (screen.getAllByText('01')[0].parentElement as HTMLElement)
    expect(row.textContent?.replace(/\s/g, '')).toBe('01—×—RIR–')
    expect(within(row).getByRole('button', { name: 'Set rep target' })).toBeTruthy()
  })

  it('EXERCISE IN LBS: the weight in the exercise\'s unit, 130 lbs, stored as kg', () => {
    const inLbs = (week: number) => {
      const day = pullDay(week, { lbs: true })
      return { ...day, sets: day.sets.map((set) => (set.programExerciseId === 'pe-row' ? { ...set, targetWeight: 58.97 } : set)) }
    }
    weekdayRun('week_dependent', inLbs)
    render(ui())
    fireEvent.click(screen.getByText('TUE'))
    captureRender('plan-9-lbs', framed(cardOf('Seated Cable Row')))

    expect(within(cardOf('Seated Cable Row')).getAllByRole('button', { name: '130lbs' })).toHaveLength(3)
    expect(within(cardOf('Seated Cable Row')).getByText('SUPERSET A · 1')).toBeTruthy() // the board's card is one of the superset's two
  })

  it('ADDING A SET: the card whose set is being added has its "+" disabled and grey', () => {
    weekdayRun('week_dependent')
    state.addPending = true
    state.addVariables = { programExerciseId: 'pe-face' }
    render(ui())
    fireEvent.click(screen.getByText('TUE'))
    captureRender('plan-9-adding', framed(cardOf('Face Pull')))

    const plus = within(cardOf('Face Pull')).getByLabelText('Adding a set to Face Pull') as HTMLButtonElement
    expect(plus.disabled).toBe(true)
    expect(plus.getAttribute('style')).toContain('var(--surface-raised)')
    expect(plus.getAttribute('style')).not.toContain('var(--accent-muted)')
  })
})

// ─── The widest rows: the 375 px overflow check ──────────────────────────────

// Not a board: the fixture for the standing 375 px check (`node scripts/screenshot-fixture.mjs <fixture> <scratch>.png --width 375`), with the
// widest content a row, a chip and a card can hold: a name with no break, the longest numbers the cells take, a range on both ends, a stage row
// and a warmup with the same, the longest kind chip and cues with no break. Chromium measures it; this only builds it.
describe('the widest rows (375 px check)', () => {
  it('a long name, 4-digit weights in lbs, 3-digit reps, RIR 20–20, a 12-stage chip and cues with no break: drawn, every row there', () => {
    const planId = 'wp-wd-pull1-2'
    const widest = (week: number): WeekPlan => {
      const long = pe('pe-long', 'long', 0, { workoutDayId: 'wd-pull1', weightUnit: 'lbs', supersetBlockId: 'blk-z' })
      const exercise = { ...long, exercise: { ...long.exercise!, name: 'Superlongnameforanexercisewithnospacesatall', muscleGroup: 'hamstrings' as MuscleGroup } }
      const partner = { ...named('pe-partner', 'Another Exercise', 'quads', 1), supersetBlockId: 'blk-z' }
      const set = (id: string, setNumber: number, more: Partial<WeekPlanSet>) => wset(id, 'pe-long', setNumber, { weekPlanId: planId, targetWeight: 1234.5, repMin: 100, repMax: 100, targetRir: 20, targetRirMax: 20, ...more })
      const sets = [
        set('w', 1, { isWarmup: true, targetRir: null, targetRirMax: null }),
        set('a', 2, { stageKind: 'myo_reps', tags: ['abcdefghijklmnopqrstuvwxyzabcdefghi', 'push here', 'maintain strength', 'focus on execution'] }),
        ...Array.from({ length: 12 }, (_, i) => ({ ...stage(`as${i}`, 'a', 'pe-long', i + 1, { targetWeight: 1234.5, repMin: 100, repMax: 100, targetRir: 20, targetRirMax: 20 }), weekPlanId: planId })),
        set('b', 3, {}),
      ]
      return plan(week, [exercise, partner], sets, { id: planId, workoutDayId: 'wd-pull1' })
    }
    weekdayRun('week_dependent', widest)
    render(ui())
    fireEvent.click(screen.getByText('TUE'))
    captureRender('plan-rows-worst', document.body)

    expect(screen.getByText('MYO-REPS · 12 MINI-SETS')).toBeTruthy()
    expect(screen.getAllByText('↳')).toHaveLength(12)
    expect(screen.getAllByRole('button', { name: '2721.6lbs' }).length).toBeGreaterThan(10)
  })
})
