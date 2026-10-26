// @vitest-environment jsdom
// Chunk 59 — "Swap for today" and "Add an exercise" at the screen that writes them (TASKS-1.2 59 "Verification"; DECISIONS 164, 179, 183,
// 198 (a), 199 (a), 200 (a); boards W5, W10, W11, W13, W14). The session is drawn through the real GymSession, `useWorkoutRows` and the rules
// of chunk 46r; the hooks are stand-ins that record what is written, in order (`calls`), and answer as the server would (a swap row, a log).
// `__fixtures__/swap-writes-before-59.json` and `swap-insert-before-59.json` are the frozen "before": the skips and the swap row's
// arguments of the PRE-chunk screen (staging at ae25ab1: the swap icon, the old sheet, every skip and then the row) on the very fixture
// below (set 1 logged; set 2, set 3 as a dropset and its drop open).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import type { ExerciseSwap } from './sessionService'
import type { Exercise, ProgramExercise, WeekPlan, WorkoutDay, Session, SetLog } from '../../types'

afterEach(() => cleanup())

const dir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const BEFORE = JSON.parse(readFileSync(join(dir, 'swap-writes-before-59.json'), 'utf8')) as {
  before: string[]
  skips: Array<Record<string, unknown>>
  swapArgs: { programExerciseId: string; originalExercise: Exercise; replacementExercise: Exercise }
}

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const exercise = (id: string, name: string, muscleGroup: Exercise['muscleGroup'] = 'chest'): Exercise => ({
  id, userId: 'user-1', name, muscleGroup, isArchived: false, createdAt: '2026-01-01T00:00:00Z',
  muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
})
const BENCH = exercise('ex-1', 'Bench Press')
const REPLACEMENT = exercise('ex-2', 'Incline Press')
const pe1: ProgramExercise = { id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null, exercise: BENCH }
const planSet = (id: string, setNumber: number, extra: Record<string, unknown> = {}) => ({
  id, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber, targetRir: 2,
  isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...extra,
})
const plan = (sets: ReturnType<typeof planSet>[]): WeekPlan => ({
  id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1, isDeload: false, notes: null,
  sets: sets as WeekPlan['sets'], exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
})
// The capture's fixture: set 1 logged, set 2 open, set 3 a dropset with one planned drop.
const captureSets = () => [planSet('set-1', 1), planSet('set-2', 2), planSet('set-3', 3, { stageKind: 'dropset' }), planSet('set-3-drop', 3, { isDropset: true, parentWeekPlanSetId: 'set-3', stageIndex: 1, targetRir: 0 })]

let session: Session
let sessionSwaps: ExerciseSwap[] = []
let online = true
let serial = 0
let nextPick: Exercise | null = REPLACEMENT
let swapAnswer: 'ok' | { reject: unknown } = 'ok'
const calls: Array<{ what: 'swap' | 'skip' | 'log'; payload: Record<string, unknown> }> = []
const pickers: Array<Record<string, unknown>> = []
const queued: unknown[] = []
const updates: unknown[] = [] // what the screen asked `useUpdateSetLog` to change (a stored number, a weight)

const logOf = (over: Partial<SetLog> & { id: string }): SetLog => ({
  userId: 'user-1', sessionId: 'session-1', exerciseId: 'ex-1', weekPlanSetId: null, setNumber: 1, weight: 60, reps: 8, rir: null, note: null,
  isDropset: false, parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false,
  loggedAt: '2026-01-05T10:05:00Z', restSeconds: null, formRating: null, stageKind: null, addedPlace: null, ...over,
})

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => online }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 0 }))
vi.mock('./useScrollToCurrentSet', () => ({
  useScrollToCurrentSet: () => ({ containerRef: { current: null }, direction: null, scrollToCurrentSet: () => {} }),
}))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [BENCH, REPLACEMENT] }) }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: [] }), useWarmupRoutineItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('../offline/useSyncQueue', () => ({
  queueSetLogPatch: async (l: unknown, setNumber: number) => {
    queued.push({ l, setNumber })
    return true
  },
  flushSyncQueue: () => Promise.resolve(),
}))
// The shared exercise picker (chunk 41; its states are 41's): a stand-in that keeps the props it was given and draws the confirm's line
// (what the caller says over the button), so what the swap and the add hand it is read here, at their call site.
vi.mock('../../components/ExercisePickerSheet', () => ({
  default: (props: Record<string, unknown>) => {
    pickers.push(props)
    const note = props.confirmNote as ((e: Exercise | null) => ReactNode) | undefined
    return (
      <div role="dialog" aria-label={`PICKER ${String(props.title)}`}>
        <p data-testid="picker-eyebrow">{String(props.eyebrow)}</p>
        <div data-testid="picker-note">{note ? note(null) : null}</div>
        <div data-testid="picker-note-picked">{note ? note(nextPick) : null}</div>
        <button onClick={() => (props.onPick as (e: Exercise | null) => void)(nextPick)}>{String(props.confirmLabel)}</button>
        <button onClick={() => (props.onClose as () => void)()}>close picker</button>
      </div>
    )
  },
}))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({
    mutateAsync: (params: Record<string, unknown>) => {
      calls.push({ what: params.isSkipped === true ? 'skip' : 'log', payload: JSON.parse(JSON.stringify(params)) })
      const log = logOf({
        id: (params.id as string | undefined) ?? `log-${++serial}`,
        exerciseId: params.exerciseId as string,
        weekPlanSetId: params.weekPlanSetId as string | null,
        setNumber: params.setNumber as number,
        weight: (params.weight as number | null) ?? null,
        reps: (params.reps as number | null) ?? null,
        isDropset: (params.isDropset as boolean | undefined) ?? false,
        parentSetId: (params.parentSetId as string | null) ?? null,
        stageIndex: (params.stageIndex as number | undefined) ?? 0,
        isWarmup: (params.isWarmup as boolean | undefined) ?? false,
        isSkipped: (params.isSkipped as boolean | undefined) ?? false,
        stageKind: (params.stageKind as SetLog['stageKind'] | undefined) ?? null,
        addedPlace: (params.addedPlace as number | null | undefined) ?? null,
      })
      session = { ...session, setLogs: [...(session.setLogs ?? []), log] }
      return Promise.resolve(log)
    },
  }),
  useLastSessionLogs: () => ({ data: [], isLoading: false }),
  useUpdateSetLog: () => ({ mutate: (args: unknown) => void updates.push(args) }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: sessionSwaps }),
  useRecordExerciseSwap: () => ({
    mutateAsync: async (params: { programExerciseId: string; originalExercise: Exercise; replacementExercise: Exercise; movedSets: ExerciseSwap['movedSets'] }) => {
      calls.push({ what: 'swap', payload: JSON.parse(JSON.stringify(params)) })
      if (swapAnswer !== 'ok') throw swapAnswer.reject
      sessionSwaps = [
        ...sessionSwaps,
        {
          id: `swap-${sessionSwaps.length + 1}`, sessionId: 'session-1', programExerciseId: params.programExerciseId,
          originalExerciseId: params.originalExercise.id, originalExerciseName: params.originalExercise.name,
          replacementExerciseId: params.replacementExercise.id, replacementExerciseName: params.replacementExercise.name,
          createdAt: '2026-01-05T10:10:00Z', movedSets: params.movedSets,
        },
      ]
    },
  }),
}))

const { default: GymSession } = await import('./GymSession')
const { useRestTimerStore } = await import('./restTimerStore')
const { useSettingsStore, DEFAULT_SETTINGS } = await import('../settings/settingsStore')

let current: WeekPlan = plan(captureSets())
const jsx = () => (
  <MemoryRouter>
    <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={current} weekNumber={1} today="2026-01-05" />
  </MemoryRouter>
)
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-row-key]')).map((el) => el.querySelector('span')?.textContent)
const cards = (c: HTMLElement) => Array.from(c.querySelectorAll('.rounded-xl.overflow-hidden')) as HTMLElement[]
const names = (c: HTMLElement) => cards(c).map((card) => card.querySelector('.font-black')?.textContent)
const optionsOf = (card: HTMLElement) => within(card).getByLabelText('Exercise options')
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); for (let i = 0; i < 8; i++) await Promise.resolve() }) }

/** ⋯ of the card -> Swap for today -> the picker's confirm; resolves once everything the press wrote is written. */
async function swapCard(container: HTMLElement, at = 0) {
  fireEvent.click(optionsOf(cards(container)[at]))
  fireEvent.click(screen.getByText('Swap for today'))
  await click(screen.getByText('SWAP FOR TODAY'))
}

beforeEach(() => {
  current = plan(captureSets())
  session = {
    id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
    date: '2026-01-05', status: 'in_progress', note: null, startedAt: '2026-01-05T10:00:00Z', completedAt: null,
    createdAt: '2026-01-05T10:00:00Z', energyRating: null, pumpRating: null,
    setLogs: [logOf({ id: 'log-0', weekPlanSetId: 'set-1', setNumber: 1, weight: 60, reps: 8, rir: 2, loggedAt: '2026-01-05T10:02:00Z' })],
  }
  sessionSwaps = []
  online = true
  serial = 0
  nextPick = REPLACEMENT
  swapAnswer = 'ok'
  calls.length = 0
  pickers.length = 0
  queued.length = 0
  updates.length = 0
  useRestTimerStore.setState({ startedAt: null, isVisible: true, anchorId: null, targetSeconds: null })
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, targetRestSeconds: 90 })
})

describe('the frozen "before" is the swap it claims to be (a vacuous fixture proves nothing)', () => {
  it('three skips of the open planned sets (set 2, the dropset 3, its drop), then the swap row', () => {
    expect(BEFORE.before).toEqual(['skip', 'skip', 'skip', 'swap'])
    expect(BEFORE.skips.map((s) => [s.weekPlanSetId, s.setNumber, s.isDropset, s.parentSetId])).toEqual([['set-2', 2, false, null], ['set-3', 3, false, null], ['set-3-drop', 3, true, 'log-2']])
    expect(BEFORE.swapArgs.programExerciseId).toBe('pe-1')
  })
})

describe('Swap for today writes what it wrote before, with the record, row first (DECISIONS 200 (a); TASKS 59 "the swap sends the same payload and skip writes")', () => {
  it('the skips of the planned working sets are the pre-chunk ones, byte for byte, and the swap row carries the record beside the arguments it had', async () => {
    const { container } = render(jsx())
    await swapCard(container)
    expect(screen.queryByLabelText('PICKER Swap for what?')).toBeNull() // saved: the picker closes (a refused swap keeps it, below)
    expect(calls.filter((c) => c.what === 'skip').map((c) => c.payload)).toEqual(BEFORE.skips)
    const swap = calls.find((c) => c.what === 'swap')!.payload
    expect(swap).toEqual({
      ...BEFORE.swapArgs,
      movedSets: { fromKey: 'pe-1', moved: [{ from: { weekPlanSetId: 'set-2' }, place: 1 }, { from: { weekPlanSetId: 'set-3' }, place: 2 }] },
    })
    // the row is written FIRST: a swap that can't be saved must skip nothing (200); before 59 it came last
    expect(calls.map((c) => c.what)).toEqual(['swap', 'skip', 'skip', 'skip'])
  })

  it('the record is the one the planner made from the rows: the moved sets in the order they stood, by their planned ids, with the place each took', async () => {
    current = plan([planSet('set-1', 1), planSet('set-2', 2), planSet('set-3', 3), planSet('set-4', 4)])
    session = { ...session, setLogs: [logOf({ id: 'fx-1', weekPlanSetId: 'set-1', setNumber: 1 }), logOf({ id: 'fx-3', weekPlanSetId: 'set-3', setNumber: 3 })] }
    const { container } = render(jsx())
    await swapCard(container)
    expect(calls.find((c) => c.what === 'swap')!.payload.movedSets).toEqual({ fromKey: 'pe-1', moved: [{ from: { weekPlanSetId: 'set-2' }, place: 1 }, { from: { weekPlanSetId: 'set-4' }, place: 2 }] })
  })

  it('a swap that is refused writes nothing else: no skip, the sets stay as they were, and the real reason is shown under "Couldn\'t swap."', async () => {
    swapAnswer = { reject: { message: 'duplicate key value violates unique constraint "v2_session_exercise_swaps_slot_uk"', code: '23505' } } // a Supabase error is no Error
    const { container } = render(jsx())
    const before = labels(container)
    await swapCard(container)
    expect(calls.map((c) => c.what)).toEqual(['swap'])
    expect(sessionSwaps).toEqual([])
    const note = screen.getByTestId('picker-note')
    expect(within(note).getByRole('alert').textContent).toBe('Couldn\'t swap.duplicate key value violates unique constraint "v2_session_exercise_swaps_slot_uk"')
    expect(labels(container)).toEqual(before)
    expect(names(container)).toEqual(['Bench Press'])
    // the picker stays for another try
    expect(screen.getByLabelText('PICKER Swap for what?')).toBeTruthy()
  })

  it('offline the swap fails at once with the reason the client gave, and "You may be offline." only where it gave none (SPEC Errors)', async () => {
    online = false
    swapAnswer = { reject: new TypeError('Failed to fetch') }
    const { container } = render(jsx())
    await swapCard(container)
    expect(calls.map((c) => c.what)).toEqual(['swap']) // tried, refused, nothing written
    expect(within(screen.getByTestId('picker-note')).getByRole('alert').textContent).toBe("Couldn't swap.Failed to fetch")
    cleanup()
    calls.length = 0
    swapAnswer = { reject: new Error('') }
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false) // the phone is offline and the error says nothing
    const again = render(jsx())
    await swapCard(again.container)
    expect(within(screen.getByTestId('picker-note')).getByRole('alert').textContent).toBe("Couldn't swap.You may be offline.")
    onLine.mockRestore()
  })

  it('a swap refused and tried again lists the moved sets once: the first try\'s entries are taken back (break: two tries, four moved sets)', async () => {
    swapAnswer = { reject: { message: 'refused' } }
    const { container, rerender } = render(jsx())
    await swapCard(container)
    expect(calls.map((c) => c.what)).toEqual(['swap'])
    swapAnswer = 'ok'
    await click(screen.getByText('SWAP FOR TODAY'))
    rerender(jsx())
    await settle()
    const rows = cards(container)[1] ? Array.from(cards(container)[1].querySelectorAll('[data-row-key]')) : []
    expect(rows.map((el) => el.querySelector('span')?.textContent)).toEqual(['02', '03', '↳']) // two moved sets and the drop, never four
  })

  it('a double press of SWAP FOR TODAY in one instant saves one swap (the second is ignored while the first is out)', async () => {
    const { container } = render(jsx())
    fireEvent.click(optionsOf(cards(container)[0]))
    fireEvent.click(screen.getByText('Swap for today'))
    const button = screen.getByText('SWAP FOR TODAY')
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(calls.filter((c) => c.what === 'swap')).toHaveLength(1)
    expect(calls.filter((c) => c.what === 'skip')).toHaveLength(3)
  })
})

describe('the picker is the shared one, with the words of boards W11 and W14', () => {
  it('swap: LAT PULLDOWN · TODAY ONLY style eyebrow, "Swap for what?", SWAP FOR TODAY, no group under a name, the workout\'s exercises left out, the exercise being replaced named', () => {
    const { container } = render(jsx())
    fireEvent.click(optionsOf(cards(container)[0]))
    fireEvent.click(screen.getByText('Swap for today'))
    const props = pickers[pickers.length - 1]
    expect(props).toMatchObject({
      mode: 'swap',
      eyebrow: 'BENCH PRESS · TODAY ONLY',
      title: 'Swap for what?',
      confirmLabel: 'SWAP FOR TODAY',
      showGroup: false,
      replacing: { id: 'ex-1', muscleGroup: 'chest' },
      exclude: ['ex-1'],
    })
    expect(typeof props.onCreate).toBe('function')
    // the line over the button: before a pick the plan's half alone; after one, what moves where (two open sets: set 2 and the dropset)
    const note = props.confirmNote as (e: Exercise | null) => ReactNode
    expect(note(null)).toBeTruthy()
    expect(screen.getByTestId('picker-note').textContent).toBe("Next week's plan stays the same.")
    cleanup()
  })

  it('swap: the line over the button counts the sets that move, the open ones: not a drop (it goes with its set), not the drop of a set already logged (break: every open item counts)', () => {
    const lineAfterAPick = () => {
      const { container } = render(jsx())
      fireEvent.click(optionsOf(cards(container)[0]))
      fireEvent.click(screen.getByText('Swap for today'))
      const text = screen.getByTestId('picker-note-picked').textContent
      cleanup()
      return text
    }
    const drop = planSet('set-1-drop', 1, { isDropset: true, parentWeekPlanSetId: 'set-1', stageIndex: 1, targetRir: 0 })
    const loggedDropsetHead = logOf({ id: 'fx-1', weekPlanSetId: 'set-1', setNumber: 1, stageKind: 'dropset' })
    // set 02 and the dropset 03 with its drop: two sets move
    expect(lineAfterAPick()).toBe("The 2 sets left move to Incline Press. Next week's plan stays the same.")
    // the dropset 01 is logged and its drop is open: the drop is skipped and moves nowhere, set 02 is the one set that moves
    current = plan([planSet('set-1', 1, { stageKind: 'dropset' }), drop, planSet('set-2', 2)])
    session = { ...session, setLogs: [loggedDropsetHead] }
    expect(lineAfterAPick()).toBe("The set left moves to Incline Press. Next week's plan stays the same.")
    // only that drop is open: nothing moves, and the line says so
    current = plan([planSet('set-1', 1, { stageKind: 'dropset' }), drop])
    expect(lineAfterAPick()).toBe("No set is left to move. Incline Press takes the place of this exercise today. Next week's plan stays the same.")
  })

  it('add: PUSH DAY · TODAY, "Add an exercise", ADD EXERCISE with W14\'s line, the exercises already in the workout left out', () => {
    render(jsx())
    fireEvent.click(screen.getByText('ADD EXERCISE'))
    const props = pickers[pickers.length - 1]
    expect(props).toMatchObject({ mode: 'add', eyebrow: 'PUSH DAY · TODAY', title: 'Add an exercise', confirmLabel: 'ADD EXERCISE', showGroup: false, exclude: ['ex-1'] })
    expect(typeof props.onCreate).toBe('function')
    expect(screen.getByTestId('picker-note').textContent).toBe("Only today's session changes; the plan stays the same.")
  })

  it('add: a pick closes the picker and draws the exercise as an ADDED TODAY card, which offers no swap (DECISIONS 199 (a)) but keeps Add a set', async () => {
    nextPick = exercise('ex-9', 'Farmer Carry', 'core')
    const { container } = render(jsx())
    fireEvent.click(screen.getByText('ADD EXERCISE'))
    await click(screen.getAllByText('ADD EXERCISE')[1]) // the picker's own confirm (the page's button is the first)
    expect(screen.queryByLabelText('PICKER Add an exercise')).toBeNull()
    expect(names(container)).toEqual(['Bench Press', 'Farmer Carry'])
    const added = cards(container)[1]
    expect(added.textContent).toContain('CORE · ADDED TODAY')
    fireEvent.click(optionsOf(added))
    expect(screen.queryByText('Swap for today')).toBeNull()
    expect(screen.queryByText('Skip the rest of this exercise')).toBeNull() // no set is open on it yet: nothing left to skip
    fireEvent.click(screen.getByText('Add a set'))
    expect(labels(container).slice(-1)).toEqual(['01'])
    fireEvent.click(optionsOf(cards(container)[1]))
    expect(screen.getByText('Skip the rest of this exercise')).toBeTruthy() // its ⋯ keeps the skip once a set is open
    expect(screen.queryByText('Swap for today')).toBeNull()
  })

  it('add: an add that fails says so under "Couldn\'t add the exercise." with the reason it gave', async () => {
    nextPick = null // a pick that no exercise stands behind: the add reads its id and throws
    render(jsx())
    fireEvent.click(screen.getByText('ADD EXERCISE'))
    await click(screen.getAllByText('ADD EXERCISE')[1])
    const alert = within(screen.getByTestId('picker-note')).getByRole('alert')
    expect(alert.textContent).toContain("Couldn't add the exercise.")
    expect(alert.textContent).toMatch(/null|undefined|id/)
  })
})

describe('after the swap: the cards of W5', () => {
  it('the replacement says what it was swapped from, takes the moved sets with their numbers, type and drops after the card they left, and the original keeps what was logged', async () => {
    const { container, rerender } = render(jsx())
    await swapCard(container)
    rerender(jsx())
    await settle()
    expect(names(container)).toEqual(['Bench Press', 'Incline Press'])
    expect(cards(container)[1].textContent).toContain('CHEST · SWAPPED FROM BENCH PRESS')
    // 01 stays on the original (logged), the moved sets are 02 and the dropset 03 with its drop, numbered on after it (183 (a))
    const rowsOf = (card: HTMLElement) => Array.from(card.querySelectorAll('[data-row-key]')).map((el) => el.querySelector('span')?.textContent)
    expect(rowsOf(cards(container)[0])).toEqual(['01'])
    expect(rowsOf(cards(container)[1])).toEqual(['02', '03', '↳'])
    expect(cards(container)[1].textContent).toContain('DROPSET · 1 DROP')
  })

  it('the moved set shows the targets it had on the card it left (DECISIONS 164: "with their numbers, type, drops and targets, as W5 draws"; break: an empty row)', async () => {
    current = plan([planSet('set-1', 1), planSet('set-2', 2, { targetWeight: 52.5, repMin: 8, repMax: 10, targetRir: 1 })])
    const { container, rerender } = render(jsx())
    await swapCard(container)
    rerender(jsx())
    await settle()
    const row = container.querySelector('[data-current-set]') as HTMLElement
    expect(row.closest('.rounded-xl')!.textContent).toContain('SWAPPED FROM BENCH PRESS')
    expect((within(row).getByLabelText('Weight') as HTMLInputElement).value).toBe('52.5')
    expect((within(row).getByLabelText('Reps') as HTMLInputElement).placeholder).toBe('8–10')
  })

  it('each moved set shows the targets of its own planned set: two sets, two sets of targets (break: the first one\'s for every row)', async () => {
    current = plan([planSet('set-1', 1), planSet('set-2', 2, { targetWeight: 52.5, repMin: 8, repMax: 10, targetRir: 1 }), planSet('set-3', 3, { targetWeight: 60, repMin: 6, repMax: 8, targetRir: 2 })])
    const { container, rerender } = render(jsx())
    await swapCard(container)
    rerender(jsx())
    await settle()
    const rows = Array.from(cards(container)[1].querySelectorAll('[data-row-key]')) as HTMLElement[]
    expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual(['02', '03'])
    expect((within(rows[0]).getByLabelText('Weight') as HTMLInputElement).value).toBe('52.5') // the current row: its own weight in the box
    // the one after it has its boxes too (chunk 60), and they hold its own targets, not the first set's
    expect((within(rows[1]).getByLabelText('Weight') as HTMLInputElement).value).toBe('60')
    expect((within(rows[1]).getByLabelText('Reps') as HTMLInputElement).placeholder).toBe('6–8')
    expect((within(rows[1]).getByLabelText('RIR') as HTMLInputElement).placeholder).toBe('2')
  })

  it('the card the sets left offers no second swap, no + ADD SET and no "Add a set"; the new card offers no swap but keeps + ADD SET, Add a set and the skip (DECISIONS 199 (a), TASKS 59)', async () => {
    const { container, rerender } = render(jsx())
    expect(within(cards(container)[0]).getByText('ADD SET')).toBeTruthy() // before the swap
    await swapCard(container)
    rerender(jsx())
    await settle()
    const [original, replacement] = cards(container)
    expect(within(original).queryByText('ADD SET')).toBeNull()
    fireEvent.click(optionsOf(original))
    expect(screen.queryByText('Swap for today')).toBeNull()
    expect(screen.queryByText('Add a set')).toBeNull()
    expect(screen.queryByText('Skip the rest of this exercise')).toBeNull() // nothing of it is open
    expect(screen.getByText('Exercise history')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Close'))
    expect(within(replacement).getByText('ADD SET')).toBeTruthy()
    fireEvent.click(optionsOf(replacement))
    expect(screen.queryByText('Swap for today')).toBeNull()
    expect(screen.getByText('Add a set')).toBeTruthy()
    expect(screen.getByText('Skip the rest of this exercise')).toBeTruthy()
  })

  it('a swap never changes the number of a set that is already logged, on either card: 01 and 03 logged, 02 and 04 moved: 01, 03 stay, nothing is patched (46r\'s Q1)', async () => {
    current = plan([planSet('set-1', 1), planSet('set-2', 2), planSet('set-3', 3), planSet('set-4', 4)])
    session = { ...session, setLogs: [logOf({ id: 'fx-1', weekPlanSetId: 'set-1', setNumber: 1 }), logOf({ id: 'fx-3', weekPlanSetId: 'set-3', setNumber: 3 })] }
    const { container, rerender } = render(jsx())
    await swapCard(container)
    rerender(jsx())
    await settle()
    const rowsOf = (card: HTMLElement) => Array.from(card.querySelectorAll('[data-row-key]')).map((el) => el.querySelector('span')?.textContent)
    expect(rowsOf(cards(container)[0])).toEqual(['01', '03']) // the gap where 02 stood shows
    expect(rowsOf(cards(container)[1])).toEqual(['03', '04'])
    expect(queued).toEqual([]) // no patch of a stored number
    expect(updates).toEqual([]) // and no edit of any log
    expect(session.setLogs!.filter((l) => !l.isSkipped).map((l) => [l.id, l.setNumber])).toEqual([['fx-1', 1], ['fx-3', 3]])
  })
})

describe('the moved sets are logged as added sets of the new exercise, each with its place (DECISIONS 179; break: no place, reversed, restart at 1)', () => {
  const typeAndLog = async (container: HTMLElement, weight: string, reps: string) => {
    const row = container.querySelector('[data-current-set]') as HTMLElement
    fireEvent.change(within(row).getByLabelText('Weight'), { target: { value: weight } })
    fireEvent.change(within(row).getByLabelText('Reps'), { target: { value: reps } })
    await click(within(row).getByText('LOG'))
  }

  it('02 then the dropset 03: places 1 and 2 in the order they stood, the number each row shows, no planned set, the new exercise; the dropset logs as a dropset and its drop is logged under it', async () => {
    const { container, rerender } = render(jsx())
    await swapCard(container)
    rerender(jsx())
    await settle()
    calls.length = 0
    await typeAndLog(container, '50', '10')
    rerender(jsx())
    expect(useRestTimerStore.getState().startedAt).not.toBeNull() // the plain set's rest runs
    await typeAndLog(container, '52.5', '8')
    rerender(jsx())
    // a dropset's head runs no rest before its drop: the drop's stage context comes from the moved set's own type (it has no planned set)
    expect(useRestTimerStore.getState().startedAt).toBeNull()
    // the drop is current now (the head's change row has no writer before chunk 62: the card keeps it on this phone)
    const dropRow = container.querySelector('[data-current-set]') as HTMLElement
    expect(dropRow.getAttribute('data-row-key')).toContain(':stage:1')
    await typeAndLog(container, '40', '12')
    const logs = calls.filter((c) => c.what === 'log').map((c) => c.payload)
    expect(logs).toHaveLength(3)
    expect(logs[0]).toMatchObject({ exerciseId: 'ex-2', weekPlanSetId: null, setNumber: 2, addedPlace: 1, stageKind: null, parentSetId: null })
    expect(typeof logs[0].id).toBe('string')
    expect(logs[1]).toMatchObject({ exerciseId: 'ex-2', weekPlanSetId: null, setNumber: 3, addedPlace: 2, stageKind: 'dropset', parentSetId: null })
    expect(logs[2]).toMatchObject({ exerciseId: 'ex-2', weekPlanSetId: null, setNumber: 3, parentSetId: logs[1].id, stageIndex: 1, isDropset: true })
    expect('addedPlace' in logs[2]).toBe(false) // a drop carries no place (DECISIONS 177)
  })

  it('a moved warmup is logged as a warmup that names itself and carries its place (break: the log leaves its place out and is drawn a second time)', async () => {
    current = plan([planSet('set-1', 1, { isWarmup: true }), planSet('set-2', 2), planSet('set-3', 3)])
    session = { ...session, setLogs: [] }
    const { container, rerender } = render(jsx())
    await swapCard(container)
    rerender(jsx())
    await settle()
    const rowsOf = (card: HTMLElement) => Array.from(card.querySelectorAll('[data-row-key]'))
    const replacement = cards(container)[1]
    const warmup = rowsOf(replacement).find((el) => el.getAttribute('data-row-key')!.startsWith('added:'))!
    expect(warmup.textContent).toContain('W')
    calls.length = 0
    // a warmup's row logs with its own LOG
    const wRow = replacement.querySelector('[data-row-state]') as HTMLElement | null
    void wRow
    const logButton = within(replacement).getAllByText('LOG')[0]
    await click(logButton)
    rerender(jsx())
    await settle()
    const log = calls.find((c) => c.what === 'log')!.payload
    expect(log).toMatchObject({ exerciseId: 'ex-2', weekPlanSetId: null, isWarmup: true, addedPlace: 1, setNumber: 1 })
    expect(typeof log.id).toBe('string')
    // drawn once: the warmup and the two working sets, three rows
    expect(rowsOf(cards(container)[1])).toHaveLength(3)
  })

  it('the original\'s moved warmup is skipped as a warmup and the added sets are skipped with their place', async () => {
    current = plan([planSet('warmup-a', 1, { isWarmup: true }), planSet('set-2', 2)])
    session = { ...session, setLogs: [] }
    const { container } = render(jsx())
    fireEvent.click(within(cards(container)[0]).getByText('ADD SET')) // a set added in the session: place 1
    await swapCard(container)
    const skips = calls.filter((c) => c.what === 'skip').map((c) => c.payload)
    expect(skips.map((s) => [s.weekPlanSetId, s.setNumber, s.isWarmup ?? false, s.addedPlace ?? null])).toEqual([['warmup-a', 1, true, null], ['set-2', 1, false, null], [null, 2, false, 1]])
    expect(typeof skips[2].id).toBe('string') // the added set's skip names itself, so the card never draws its log as a second set
    expect(calls.find((c) => c.what === 'swap')!.payload.movedSets).toEqual({
      fromKey: 'pe-1',
      moved: [{ from: { weekPlanSetId: 'warmup-a' }, place: 1 }, { from: { weekPlanSetId: 'set-2' }, place: 2 }, { from: { addedPlace: 1 }, place: 3 }],
    })
  })
})

describe('a swap row the screen can\'t draw as a record is drawn as before 1.2 draws it (DECISIONS 198 (a)): nothing is inferred, nothing thrown', () => {
  it('a record naming another card is left out: two cards, no set moved, and the original keeps its + ADD SET', async () => {
    sessionSwaps = [{
      id: 'swap-1', sessionId: 'session-1', programExerciseId: 'pe-1', originalExerciseId: 'ex-1', originalExerciseName: 'Bench Press',
      replacementExerciseId: 'ex-2', replacementExerciseName: 'Incline Press', createdAt: '2026-01-05T10:10:00Z',
      movedSets: { fromKey: 'some-other-card', moved: [{ from: { weekPlanSetId: 'set-2' }, place: 1 }] },
    }]
    const { container } = render(jsx())
    await settle()
    expect(names(container)).toEqual(['Bench Press', 'Incline Press'])
    expect(cards(container)[1].textContent).toContain('SWAPPED FROM BENCH PRESS')
    expect(within(cards(container)[0]).getByText('ADD SET')).toBeTruthy()
  })

  it('a row with a record: the original is "a card whose sets a swap moved" and the replacement shows them', async () => {
    sessionSwaps = [{
      id: 'swap-1', sessionId: 'session-1', programExerciseId: 'pe-1', originalExerciseId: 'ex-1', originalExerciseName: 'Bench Press',
      replacementExerciseId: 'ex-2', replacementExerciseName: 'Incline Press', createdAt: '2026-01-05T10:10:00Z',
      movedSets: { fromKey: 'pe-1', moved: [{ from: { weekPlanSetId: 'set-2' }, place: 1 }, { from: { weekPlanSetId: 'set-3' }, place: 2 }] },
    }]
    const { container } = render(jsx())
    await settle()
    expect(within(cards(container)[0]).queryByText('ADD SET')).toBeNull()
    expect(Array.from(cards(container)[0].querySelectorAll('[data-row-key]')).map((el) => el.querySelector('span')?.textContent)).toEqual(['01'])
  })
})

describe('Exercise history is the card\'s last-time sheet', () => {
  it('"Exercise history" in the ⋯ closes the options and opens the same sheet the history icon does', async () => {
    const { container } = render(jsx())
    fireEvent.click(optionsOf(cards(container)[0]))
    fireEvent.click(screen.getByText('Exercise history'))
    expect(screen.queryByText('Swap for today')).toBeNull()
    expect(screen.getByText('Last time')).toBeTruthy()
  })
})
