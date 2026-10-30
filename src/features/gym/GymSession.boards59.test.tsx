// @vitest-environment jsdom
// Chunk 59 — boards W5 (swapped and added exercises), W10 (exercise options, both states), W11 (swap for today) and W14 (confirm add), drawn
// by the workout screen's own call sites, the shared picker real (chunk 41's states are its own). `CAPTURE_RENDER=1 npx vitest run
// src/features/gym/GymSession.boards59.test.tsx` writes `__fixtures__/w5.html`, `w10.html`, `w10-closed.html`, `w11.html` and `w14.html`
// for `npm run shot` (design/1.2/built/); each picture is held against its board by the text dump first (RULES: usage rules).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, cleanup, fireEvent, act, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { captureRender } from '../../testing/captureRender'
import { referenceSessionOf } from './cardHarness.testutil'
import type { ExerciseSwap, ReferenceSession } from './sessionService'
import type { Exercise, ProgramExercise, WeekPlan, WorkoutDay, Session, SetLog } from '../../types'

afterEach(() => cleanup())

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Pull 1', position: 0, exercises: [] }
const exercise = (id: string, name: string, muscleGroup: Exercise['muscleGroup'] = 'back'): Exercise => ({
  id, userId: 'user-1', name, muscleGroup, isArchived: false, createdAt: '2026-01-01T00:00:00Z',
  muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
})
const LAT = exercise('ex-lat', 'Lat Pulldown')
const LIBRARY = [
  LAT,
  exercise('ex-chest-row', 'Chest-Supported Row'),
  exercise('ex-machine', 'Machine Pulldown'),
  exercise('ex-pullup', 'Pull-Up'),
  exercise('ex-sacr', 'Single-Arm Cable Row'),
  exercise('ex-straight', 'Straight-Arm Pulldown'),
  exercise('ex-tbar', 'T-Bar Row'),
  exercise('ex-hammer', 'Hammer Curl', 'biceps'),
]
const pe1: ProgramExercise = { id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-lat', position: 0, weightUnit: null, exercise: LAT }
const planSet = (id: string, setNumber: number, extra: Record<string, unknown> = {}) => ({
  id, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber, targetRir: 2,
  isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...extra,
})
// Board W5's session: Lat Pulldown 01 and 02 logged, its 03 a dropset with one drop (52.5 kg, 8–10, RIR 1; the drop 40 kg × AMRAP, no RIR, as the board draws it).
const weekPlan: WeekPlan = {
  id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null,
  sets: [
    planSet('set-1', 1),
    planSet('set-2', 2),
    planSet('set-3', 3, { stageKind: 'dropset', targetWeight: 52.5, repMin: 8, repMax: 10, targetRir: 1 }),
    planSet('set-3-drop', 3, { isDropset: true, parentWeekPlanSetId: 'set-3', stageIndex: 1, targetWeight: 40, repMin: null, repMax: null, isAmrap: true, targetRir: null }),
  ] as WeekPlan['sets'],
  exercises: [pe1],
  createdAt: '2026-01-01T00:00:00Z',
}

let session: Session
let sessionSwaps: ExerciseSwap[] = []
let references = new Map<string, ReferenceSession[]>()
const logOf = (over: Partial<SetLog> & { id: string }): SetLog => ({
  userId: 'user-1', sessionId: 'session-1', exerciseId: 'ex-lat', weekPlanSetId: null, setNumber: 1, weight: 55, reps: 9, rir: 2, note: null,
  isDropset: false, parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false,
  loggedAt: '2026-10-12T18:03:00Z', restSeconds: null, formRating: null, stageKind: null, addedPlace: null, ...over,
})

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 0 }))
vi.mock('./useScrollToCurrentSet', () => ({
  useScrollToCurrentSet: () => ({ containerRef: { current: null }, direction: null, scrollToCurrentSet: () => {} }),
}))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
// The exercise library is the service boundary: the real `useExercises` and `useCreateExercise` run on the app's query client.
vi.mock('../library/exerciseService', () => ({
  fetchExercises: () => Promise.resolve(LIBRARY),
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  setExerciseArchived: vi.fn(),
  fetchExerciseCount: vi.fn(),
  seedDefaultExercisesIfEmpty: vi.fn(),
  fetchLostExercises: vi.fn(),
  previewExerciseDelete: vi.fn(),
  deleteExercise: vi.fn(),
  restoreExercise: vi.fn(),
}))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: [] }), useWarmupRoutineItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: async () => true, flushSyncQueue: () => Promise.resolve() }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({
    mutateAsync: (params: Record<string, unknown>) => {
      const log = logOf({
        id: (params.id as string | undefined) ?? `new-${(session.setLogs?.length ?? 0) + 1}`,
        exerciseId: params.exerciseId as string, weekPlanSetId: params.weekPlanSetId as string | null, setNumber: params.setNumber as number,
        weight: null, reps: null, isSkipped: (params.isSkipped as boolean | undefined) ?? false,
        isWarmup: (params.isWarmup as boolean | undefined) ?? false, addedPlace: (params.addedPlace as number | null | undefined) ?? null,
        stageKind: (params.stageKind as SetLog['stageKind'] | undefined) ?? null, parentSetId: (params.parentSetId as string | null) ?? null,
        stageIndex: (params.stageIndex as number | undefined) ?? 0, isDropset: (params.isDropset as boolean | undefined) ?? false,
      })
      session = { ...session, setLogs: [...(session.setLogs ?? []), log] }
      return Promise.resolve(log)
    },
  }),
  useLastSessionLogs: () => ({ data: [], isLoading: false }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({ data: references, isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: sessionSwaps }),
  useRecordExerciseSwap: () => ({
    mutateAsync: async (params: { programExerciseId: string; originalExercise: Exercise; replacementExercise: Exercise; movedSets: ExerciseSwap['movedSets'] }) => {
      sessionSwaps = [
        ...sessionSwaps,
        {
          id: 'swap-1', sessionId: 'session-1', programExerciseId: params.programExerciseId, originalExerciseId: params.originalExercise.id,
          originalExerciseName: params.originalExercise.name, replacementExerciseId: params.replacementExercise.id,
          replacementExerciseName: params.replacementExercise.name, createdAt: '2026-10-12T18:10:00Z', movedSets: params.movedSets,
        },
      ]
    },
  }),
}))

const { default: GymSession } = await import('./GymSession')
const { queryClient } = await import('../../lib/queryClient')
const { useSettingsStore, DEFAULT_SETTINGS } = await import('../settings/settingsStore')

const jsx = () => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={2} today="2026-10-13" />
    </MemoryRouter>
  </QueryClientProvider>
)
const settle = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })
const press = async (el: Element) => { await act(async () => { fireEvent.click(el); for (let i = 0; i < 12; i++) await Promise.resolve() }) }
const pressText = (text: string) => press(screen.getByText(text))
const cards = (c: HTMLElement) => Array.from(c.querySelectorAll('.rounded-xl.overflow-hidden')) as HTMLElement[]

beforeEach(() => {
  queryClient.clear()
  session = {
    id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
    date: '2026-10-13', status: 'in_progress', note: null, startedAt: '2026-10-13T17:00:00Z', completedAt: null, createdAt: '2026-10-13T17:00:00Z',
    energyRating: null, pumpRating: null,
    setLogs: [
      logOf({ id: 'l1', weekPlanSetId: 'set-1', setNumber: 1, weight: 55, reps: 9, rir: 2 }),
      logOf({ id: 'l2', weekPlanSetId: 'set-2', setNumber: 2, weight: 55, reps: 8, rir: 1 }),
    ],
  }
  sessionSwaps = []
  references = new Map()
  useSettingsStore.setState({ ...DEFAULT_SETTINGS })
})

describe('W10 — the exercise options sheet, as the card opens it', () => {
  it('"BACK · 2 OF 3 SETS DONE" over Lat Pulldown; the four rows with their sublines; the skip row asks first: CANCEL and SKIP 2 SETS', async () => {
    const { container } = render(jsx())
    await settle()
    await press(screen.getByLabelText('Exercise options'))
    const closed = document.body.textContent!
    for (const line of ['BACK · 2 OF 3 SETS DONE', 'Lat Pulldown', 'Swap for today', "Next week's plan stays the same.", 'Skip the rest of this exercise', 'Set 03 and its drop will be marked skipped.', 'Add a set', 'This exercise only. In a superset, the others stay as they are.', 'Exercise history']) {
      expect(closed).toContain(line)
    }
    expect(closed).not.toContain('SKIP 2 SETS')
    captureRender('w10-closed', document.body)
    await pressText('Skip the rest of this exercise')
    expect(screen.getByText('CANCEL')).toBeTruthy()
    expect(screen.getByText('SKIP 2 SETS')).toBeTruthy()
    captureRender('w10', document.body)
    void container
  })
})

describe('W11 and W14 — the swap and the add, at the workout screen\'s call sites with the shared picker', () => {
  it('W11: after a pick, "The set left moves to Machine Pulldown. Next week\'s plan stays the same." over SWAP FOR TODAY', async () => {
    render(jsx())
    await settle()
    await press(screen.getByLabelText('Exercise options'))
    await pressText('Swap for today')
    await settle()
    expect(document.body.textContent).toContain('LAT PULLDOWN · TODAY ONLY')
    expect(document.body.textContent).toContain('Swap for what?')
    expect(document.body.textContent).toContain("Next week's plan stays the same.")
    await press(await screen.findByText('Machine Pulldown'))
    expect(document.body.textContent).toContain("The set left moves to Machine Pulldown. Next week's plan stays the same.")
    expect(document.body.textContent).toContain('SWAP FOR TODAY')
    captureRender('w11', document.body)
  })

  it('W14: "Add Hammer Curl?" with "Only today\'s session changes; the plan stays the same.", BACK and ADD EXERCISE', async () => {
    render(jsx())
    await settle()
    await pressText('ADD EXERCISE')
    await settle()
    expect(document.body.textContent).toContain('PULL 1 · TODAY')
    await press(await screen.findByText('Hammer Curl'))
    expect(document.body.textContent).toContain('Add Hammer Curl?')
    expect(document.body.textContent).toContain("Only today's session changes; the plan stays the same.")
    expect(screen.getByRole('button', { name: 'BACK' })).toBeTruthy()
    captureRender('w14', document.body)
  })
})

describe('W5 — swapped and added exercises', () => {
  it('Lat Pulldown keeps its two logged sets and no + ADD SET; Machine Pulldown, swapped from it, has set 03 (the dropset with its drop) and + ADD SET; Straight-Arm Pulldown, added today, has 01', async () => {
    // Each card's "last time" is its own exercise's (board W5): the swapped card reads the new exercise's session, not the one it left.
    const lastTime = (id: string, exerciseId: string, date: string, sets: Array<[number, number]>) =>
      referenceSessionOf(id, date, sets.map(([weight, reps], i) => logOf({ id: `${id}-${i + 1}`, sessionId: id, exerciseId, setNumber: i + 1, weight, reps, rir: 2, loggedAt: `${date}T18:00:00Z` })))
    references = new Map([
      ['ex-lat', [lastTime('r-lat', 'ex-lat', '2026-10-06', [[55, 9], [55, 8]])]],
      ['ex-machine', [lastTime('r-machine', 'ex-machine', '2026-09-22', [[45, 12], [47.5, 11], [50, 10]])]],
      ['ex-straight', [lastTime('r-straight', 'ex-straight', '2026-09-08', [[25, 12]])]],
    ])
    const { container, rerender } = render(jsx())
    await settle()
    await press(screen.getByLabelText('Exercise options'))
    await pressText('Swap for today')
    await settle()
    await press(await screen.findByText('Machine Pulldown'))
    await pressText('SWAP FOR TODAY')
    rerender(jsx())
    await settle()
    await pressText('ADD EXERCISE')
    await settle()
    await press(await screen.findByText('Straight-Arm Pulldown'))
    await press(screen.getAllByText('ADD EXERCISE')[1])
    rerender(jsx())
    await settle()
    await press(within(cards(container)[2]).getByText('ADD SET'))
    const [lat, machine, straight] = cards(container)
    expect(lat.textContent).toContain('Lat Pulldown')
    expect(lat.textContent).not.toContain('ADD SET')
    expect(machine.textContent).toContain('BACK · SWAPPED FROM LAT PULLDOWN')
    expect(machine.textContent).toContain('DROPSET · 1 DROP')
    expect(machine.textContent).toContain('AFTER SET 03')
    // the moved dropset's drop shows the targets of its own planned drop, as the board draws it (DECISIONS 164; break: the stage branch of `targetsOf` gives nothing)
    expect(machine.textContent).toContain('40 kg × AMRAP')
    expect(machine.textContent).toContain('ADD SET')
    expect((within(machine).getByLabelText('Weight') as HTMLInputElement).value).toBe('52.5')
    expect((within(machine).getByLabelText('Reps') as HTMLInputElement).placeholder).toBe('8–10')
    expect(straight.textContent).toContain('BACK · ADDED TODAY')
    expect(Array.from(straight.querySelectorAll('[data-row-key]')).map((el) => el.querySelector('span')?.textContent)).toEqual(['01'])
    const lastLine = (card: HTMLElement) => card.querySelector('[data-last-line]')?.textContent
    expect([lastLine(lat), lastLine(machine), lastLine(straight)]).toEqual(['LAST = LAST WEEK, TUE', 'LAST = 21 DAYS AGO', 'LAST = ABOUT 1 MONTH AGO'])
    expect(machine.textContent).toContain('50 × 10 @ 2') // the moved set 03's own LAST line, from the new exercise's session
    expect(straight.textContent).toContain('25 × 12 @ 2')
    // Board W5 draws the cards alone: the pinned rest bar (sticky at the bottom, so a full-page shot of a screen taller than 844 px draws
    // it over the third card's header) is left out of the capture.
    const cardsOnly = container.cloneNode(true) as HTMLElement
    cardsOnly.querySelector('[data-rest-bar]')?.remove()
    captureRender('w5', cardsOnly)
  })
})

