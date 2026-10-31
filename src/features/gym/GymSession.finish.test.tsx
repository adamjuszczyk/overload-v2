// @vitest-environment jsdom
// Chunk 64 — FINISH SESSION at the workout screen (TASKS-1.2 64; SPEC [1.2] "Finishing (11, C6)": "the finish screen (W18) shows the session's tiles, energy, pump and note, and
// COMPLETE. When planned sets aren't logged it says which ("2 planned sets aren't logged yet: EZ Bar Curl 01 and 02.") with GO BACK, which closes the finish screen and
// scrolls to the first of them. BACK TO SESSION closes it where it was. A reopened session finishes through W19"). The screen runs over the real rows (`useWorkoutRows`),
// the real scroll hook and the real `FinishScreen`: what is asserted is what the person would see and where the scroller ends up. The screen's own words, tiles, chips and
// payloads are `FinishScreen.test.tsx`'s; what COMPLETE writes is `FinishScreen.write.test.tsx`'s.
// Chunk 78 (SPEC 1.2.1 [6]) adds the pinned bar's other way in: once every working set and stage is logged or skipped the rest bar says WORKOUT COMPLETE and its FINISH opens
// the same screen (the last describe).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, cleanup, fireEvent, act, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import type { Session, SessionSetChangeRecord, SetLog, WeekPlan } from '../../types'
import type { ExerciseSwap } from './sessionService'
import type { AddedSet } from './workoutRules'

const complete = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null as unknown }))
const logSet = vi.hoisted(() => ({ mutateAsync: vi.fn() })) // what LOG asks the server to write (chunk 78: the rest the next log records)
const phone = vi.hoisted(() => ({ world: { drafts: new Map(), lists: null, log: [] } as import('./draftStore.testutil').DraftWorld }))

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 52 * 60 + 40 }))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('./WarmupRoutineChecklist', () => ({ default: () => null }))
vi.mock('../offline/SyncFailedNotice', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({ useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: [] }), useWarmupRoutineItems: () => ({ data: [] }) }))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: vi.fn().mockResolvedValue(false), flushSyncQueue: vi.fn() }))
vi.mock('./sessionDrafts', async (importOriginal) => {
  const { fakeDraftStore } = await import('./draftStore.testutil')
  return { ...(await importOriginal<typeof import('./sessionDrafts')>()), dexieDraftStore: () => fakeDraftStore(phone.world) }
})
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: logSet.mutateAsync }),
  useUpdateSetLog: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useCompleteSession: () => ({ mutateAsync: complete.mutateAsync, isPending: complete.isPending, isError: complete.isError, error: complete.error }),
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: swaps }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')

import { EZ_DONE, LAT_1_2, LAT_ALL, NORMAL, PE_EZ, SETS, deletedChange, log, skipped, swapRow, weekPlan, workoutDay } from './finishWorld.testutil'
import { useRestTimerStore } from './restTimerStore'

let session: Session
let swaps: ExerciseSwap[] = []
let plan: WeekPlan = weekPlan()

function mount(opts: { logs: SetLog[]; changes?: SessionSetChangeRecord[]; swaps?: ExerciseSwap[]; lists?: Record<string, AddedSet[]>; session?: Partial<Session>; plan?: WeekPlan; sequence?: boolean }) {
  plan = opts.plan ?? weekPlan()
  swaps = opts.swaps ?? []
  phone.world.lists = opts.lists ?? null
  session = {
    id: 'session-1', userId: 'u1', mesocycleId: 'm1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: '2026-01-06', status: 'in_progress', note: null, startedAt: '2026-01-06T09:10:00Z',
    completedAt: null, createdAt: '2026-01-06T09:10:00Z', setLogs: opts.logs, setChanges: opts.changes ?? [], energyRating: null, pumpRating: null, ...opts.session,
  }
  const view = render(
    <main>
      <MemoryRouter>
        <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={plan} weekNumber={2} today="2026-01-06" scheduleType={opts.sequence ? 'sequence' : 'weekday'} />
      </MemoryRouter>
    </main>,
  )
  const main = view.container.querySelector('main') as HTMLElement
  // jsdom lays nothing out: the scroller's height, its position and its scrolling are set by hand
  let scrollTop = 0
  Object.defineProperty(main, 'clientHeight', { value: 800, configurable: true })
  Object.defineProperty(main, 'scrollTop', { get: () => scrollTop, set: (v: number) => void (scrollTop = v), configurable: true })
  main.scrollTo = vi.fn() as unknown as typeof main.scrollTo
  return { ...view, main }
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
const finish = () => fireEvent.click(screen.getByText('FINISH SESSION'))
const warningText = (c: HTMLElement) => c.querySelector('[data-finish-warning] span')?.textContent ?? null
const rect = (top: number) => ({ top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

beforeEach(() => {
  logSet.mutateAsync.mockReset().mockResolvedValue({})
  complete.mutateAsync.mockReset().mockResolvedValue(undefined)
  complete.isPending = false
  complete.isError = false
  complete.error = null
  swaps = []
  phone.world.drafts.clear()
  phone.world.lists = null
  phone.world.log = []
})
afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  // the phone's copy is written a tick after the screen asks (`draftStore.testutil.ts`): let a finished test's writes land before the next test seeds its own world
  await act(async () => { for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
})

describe('the date the fixtures name is the weekday they say (Checks that lied #21: a printed derivation, not a hand-typed day)', () => {
  it('2026-01-06 is a Tuesday', () => {
    expect(format(parseISO('2026-01-06'), 'EEEE')).toBe('Tuesday')
  })
})

describe('FINISH SESSION opens W18 over the workout\'s own rows', () => {
  it('the header\'s words with the clock after them, the title, and the tiles of the session: "WEEK 2 · TUESDAY · 52:40" over "FINISH PULL 1"', async () => {
    const { container } = mount({ logs: [...EZ_DONE, ...LAT_ALL] })
    await settle()
    expect(container.querySelectorAll('[data-row-key]').length).toBeGreaterThan(0)
    finish()
    expect(container.querySelectorAll('[data-row-key]').length).toBe(0) // the workout is swapped for the screen
    expect(container.querySelector('[data-finish-eyebrow]')!.textContent).toBe('WEEK 2 · TUESDAY · 52:40')
    expect(container.querySelector('h1')!.textContent).toBe('FINISH PULL 1')
    const tiles = ['WORKING SETS', 'SKIPPED', 'WARMUPS'].map((label) => container.querySelector(`[data-finish-tile="${label}"]`)!.textContent)
    expect(tiles).toEqual(['WORKING SETS6', 'SKIPPED0', 'WARMUPS1'])
  })

  it('a deload session says so first, and a sequence run names its cycle and slot, as the workout\'s own header does (the finish takes the header\'s parts)', async () => {
    const deload = mount({ logs: [...EZ_DONE, ...LAT_ALL], plan: weekPlan({ isDeload: true }) })
    await settle()
    finish()
    expect(deload.container.querySelector('[data-finish-eyebrow]')!.textContent).toBe('DELOAD · WEEK 2 · TUESDAY · 52:40')
    cleanup()
    const sequence = mount({ logs: [...EZ_DONE, ...LAT_ALL], plan: weekPlan({ sequencePosition: 1 }), sequence: true })
    await settle()
    finish()
    expect(sequence.container.querySelector('[data-finish-eyebrow]')!.textContent).toBe('CYCLE 2 · SLOT 2 · 52:40')
  })

  it('with two planned sets unlogged the box names them in the board\'s words: "2 planned sets aren\'t logged yet: EZ Bar Curl 01 and 02."', async () => {
    const { container } = mount({ logs: [log('l-ezw', 'ez-w1', 1, 'ex-ez', { isWarmup: true }), ...LAT_ALL] })
    await settle()
    finish()
    expect(warningText(container)).toBe("2 planned sets aren't logged yet: EZ Bar Curl 01 and 02.")
  })

  it('with none unlogged there is no box (absence), and every set logged or skipped is settled', async () => {
    const { container } = mount({ logs: [...EZ_DONE, ...LAT_1_2, skipped(log('l-lat3', 'lat-3', 3, 'ex-lat')), log('l-lat4', 'lat-4', 4, 'ex-lat')] })
    await settle()
    finish()
    expect(container.querySelector('[data-finish-warning]')).toBeNull()
    expect(container.querySelector('[data-finish-tile="SKIPPED"]')!.textContent).toBe('SKIPPED1')
  })

  it('a planned set deleted in the workout (a `deleted` change row) is not in the warning (break: list it too)', async () => {
    const { container } = mount({ logs: [log('l-ezw', 'ez-w1', 1, 'ex-ez', { isWarmup: true }), ...LAT_ALL], changes: [deletedChange('ez-2')] })
    await settle()
    finish()
    expect(warningText(container)).toBe("1 planned set isn't logged yet: EZ Bar Curl 01.")
  })
})

describe('GO BACK and BACK TO SESSION: where the scroller ends up (SPEC 11)', () => {
  // EZ Bar Curl is all logged with a set added to it and left open, so THE CURRENT SET is that added one; Lat Pulldown 02 to 04 are the planned sets still unlogged, and the FIRST OF THEM is Lat 02.
  async function scrolled() {
    const view = mount({ logs: [...EZ_DONE, log('l-lat1', 'lat-1', 1, 'ex-lat')] })
    await settle()
    fireEvent.click(screen.getAllByText(/ADD SET/)[0])
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.tagName === 'MAIN') return { ...rect(0), bottom: 800 }
      if (this.hasAttribute('data-current-set')) return rect(900)
      return rect(this.getAttribute('data-row-key') === 'set:lat-2' ? 1500 : 100)
    })
    return view
  }

  it('the fixture is the one it says: the current set is the added set on EZ Bar Curl, the first listed set is Lat Pulldown 02 (a vacuous fixture proves nothing)', async () => {
    const { container } = await scrolled()
    expect(container.querySelector('[data-current-set]')!.getAttribute('data-row-key')).toMatch(/^added:xe-ez:/)
    finish()
    expect(warningText(container)).toBe("3 planned sets aren't logged yet: Lat Pulldown 02, 03 and 04.")
  })

  it('GO BACK closes the screen and scrolls the scroller to the FIRST LISTED set, not to the current set (break: scroll to the current set)', async () => {
    const { container, main } = await scrolled()
    main.scrollTop = 640
    finish()
    expect(main.scrollTop).toBe(0) // the finish screen opens at its top
    fireEvent.click(screen.getByRole('button', { name: 'GO BACK' }))
    expect(container.querySelector('[data-finish]')).toBeNull()
    expect(container.querySelector('[data-row-key="set:lat-2"]')).not.toBeNull()
    expect(main.scrollTo).toHaveBeenCalledTimes(1)
    // the row's rectangle puts it 1500 down; the scroller is at 0 and the target is a quarter of its 800 from the top
    expect(main.scrollTo).toHaveBeenCalledWith({ top: 1500 - 200, behavior: 'smooth' })
    expect(main.scrollTop).toBe(0) // nothing put it back to where it was: GO BACK is the other way back
  })

  it('BACK TO SESSION closes it where it was: the scroller is put back at the position it had, and nothing scrolls (break: leave the scroller where the finish screen put it)', async () => {
    const { container, main } = await scrolled()
    main.scrollTop = 640
    finish()
    expect(main.scrollTop).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'BACK TO SESSION' }))
    expect(container.querySelector('[data-finish]')).toBeNull()
    expect(main.scrollTop).toBe(640)
    expect(main.scrollTo).not.toHaveBeenCalled()
    // and once more: the position it had the second time, not the first
    main.scrollTop = 120
    finish()
    fireEvent.click(screen.getByRole('button', { name: 'BACK TO SESSION' }))
    expect(main.scrollTop).toBe(120)
  })
})

describe('the planned sets a swap for today moved (DECISIONS 201 (a); board W5\'s Machine Pulldown 03)', () => {
  // what the swap leaves on the phone that made it: the new card's list of the moved sets (63), and the swap's skip of each on the card they left
  const card = 'xe-lat:replacement'
  const rowsOn = (c: HTMLElement) => Array.from(c.querySelectorAll(`[data-row-key^="added:${card}:"]`)).map((el) => `${el.getAttribute('data-row-key')!.split(':').pop()}:${el.getAttribute('data-row-state') ?? 'current'}`)

  it('Lat Pulldown 01 and 02 logged, its 03 and 04 moved to Machine Pulldown and open: W18 names them under the new card, "Machine Pulldown 03 and 04" (break: leave a moved planned set out of the warning)', async () => {
    const { container } = mount({
      logs: [...EZ_DONE, ...LAT_1_2, skipped(log('s3', 'lat-3', 3, 'ex-lat')), skipped(log('s4', 'lat-4', 4, 'ex-lat'))],
      swaps: [swapRow({ fromKey: 'xe-lat', moved: [{ from: { weekPlanSetId: 'lat-3' }, place: 1 }, { from: { weekPlanSetId: 'lat-4' }, place: 2 }] })],
      lists: { [card]: [{ localId: 'm1', logId: null, type: NORMAL, place: 1 }, { localId: 'm2', logId: null, type: NORMAL, place: 2 }] },
    })
    await settle()
    expect(rowsOn(container)).toEqual(['m1:current', 'm2:upcoming'])
    finish()
    expect(warningText(container)).toBe("2 planned sets aren't logged yet: Machine Pulldown 03 and 04.")
  })

  it('a set moved from an ADDED set is open on the new card and not listed (absence): only the planned one is', async () => {
    // Lat Pulldown 04 was deleted before the swap; the open planned 03 and an open added set moved, each skipped on the card it left (the added one with its place)
    const addedOnLat = skipped(log('s-added', null, 4, 'ex-lat', { addedPlace: 1 }))
    const { container } = mount({
      logs: [...EZ_DONE, ...LAT_1_2, skipped(log('s3', 'lat-3', 3, 'ex-lat')), addedOnLat],
      changes: [deletedChange('lat-4')],
      swaps: [swapRow({ fromKey: 'xe-lat', moved: [{ from: { weekPlanSetId: 'lat-3' }, place: 1 }, { from: { addedPlace: 1 }, place: 2 }] })],
      lists: { [card]: [{ localId: 'm1', logId: null, type: NORMAL, place: 1 }, { localId: 'm2', logId: null, type: NORMAL, place: 2 }] },
    })
    await settle()
    expect(rowsOn(container)).toHaveLength(2) // both moved sets are open on the screen
    finish()
    expect(warningText(container)).toBe("1 planned set isn't logged yet: Machine Pulldown 03.")
  })

  it('a set added to the new card by hand is not listed either (absence)', async () => {
    const { container } = mount({
      logs: [...EZ_DONE, ...LAT_1_2, skipped(log('s3', 'lat-3', 3, 'ex-lat')), skipped(log('s4', 'lat-4', 4, 'ex-lat'))],
      swaps: [swapRow({ fromKey: 'xe-lat', moved: [{ from: { weekPlanSetId: 'lat-3' }, place: 1 }, { from: { weekPlanSetId: 'lat-4' }, place: 2 }] })],
      lists: { [card]: [{ localId: 'm1', logId: null, type: NORMAL, place: 1 }, { localId: 'm2', logId: null, type: NORMAL, place: 2 }, { localId: 'h1', logId: null, type: NORMAL, place: 3 }] },
    })
    await settle()
    expect(rowsOn(container)).toHaveLength(3)
    finish()
    expect(warningText(container)).toBe("2 planned sets aren't logged yet: Machine Pulldown 03 and 04.")
  })
})

describe('W19: a reopened session', () => {
  it('shows no box although planned sets are unlogged, with its note and ratings in the boxes and the same chips (break: the box shown for a reopened session)', async () => {
    const { container } = mount({
      logs: [log('l-ezw', 'ez-w1', 1, 'ex-ez', { isWarmup: true }), ...LAT_ALL],
      session: { note: 'Grip went on the last curl set.', energyRating: 'high', pumpRating: 'good' },
    })
    await settle()
    finish()
    expect(container.querySelector('[data-finish]')!.getAttribute('data-finish')).toBe('reopened')
    expect(container.querySelector('[data-finish-warning]')).toBeNull()
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Grip went on the last curl set.')
    expect(screen.getByRole('button', { name: 'HIGH' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'GOOD' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('COMPLETE at the workout screen', () => {
  it('sends the session\'s own id with what was typed, once, and the workout stays closed behind the screen while it saves', async () => {
    const { container } = mount({ logs: [...EZ_DONE, ...LAT_ALL] })
    await settle()
    finish()
    fireEvent.change(container.querySelector('textarea')!, { target: { value: ' Felt strong. ' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'COMPLETE' }))
      await Promise.resolve()
    })
    expect(complete.mutateAsync).toHaveBeenCalledTimes(1)
    expect(complete.mutateAsync).toHaveBeenCalledWith({ id: 'session-1', note: 'Felt strong.', energyRating: null, pumpRating: null })
    expect(container.querySelectorAll('[data-row-key]').length).toBe(0)
  })
})

// ─── Chunk 78: WORKOUT COMPLETE on the pinned bar (SPEC 1.2.1 [6]; DECISIONS 259) ─────────────────────────────────────────────────────────────────────────────────────────────
// "Once every working set and stage is logged or skipped, the rest bar shows WORKOUT COMPLETE and a FINISH button (which opens the finish screen) instead of the rest timer and
// the jump button. Open warmups don't count. Added sets do. A workout with no working set or stage at all keeps the usual bar (Adam, 2026-10-30, TASKS question 10). The rest
// keeps being timed underneath. An added set or exercise brings the bar back, showing the rest since the last set, and the next log records it. FINISH SESSION at the foot of the
// list stays." The screen runs over the real rows and the real bar; the world is Pull 1 on Tuesday of week 2 (EZ Bar Curl: a warmup, 01, 02; Lat Pulldown 01 to 04).
describe('WORKOUT COMPLETE on the rest bar (SPEC 1.2.1 [6])', () => {
  const REST_START = new Date('2026-01-06T10:00:00Z').getTime()
  const bar = (c: HTMLElement) => c.querySelector('[data-rest-bar]') as HTMLElement | null
  const isComplete = (c: HTMLElement) => bar(c)?.hasAttribute('data-workout-complete') === true
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-06T10:01:15Z'))
    // the last set was logged 75 s ago, and the rest chain's target is 2:00
    useRestTimerStore.setState({ startedAt: REST_START, isVisible: true, anchorId: null, targetSeconds: 120 })
  })
  afterEach(() => {
    vi.useRealTimers()
    useRestTimerStore.getState().stop()
  })

  it('every working set logged (the warmup too): WORKOUT COMPLETE and FINISH replace the timer, whose clock is not drawn; FINISH SESSION at the foot stays', async () => {
    const { container } = mount({ logs: [...EZ_DONE, ...LAT_ALL] })
    await settle()
    expect(isComplete(container)).toBe(true)
    expect(bar(container)!.textContent).toBe('WORKOUT COMPLETEFINISH')
    expect(container.textContent).not.toContain('1:15')
    expect(screen.getByText('FINISH SESSION')).toBeTruthy()
  })

  it('an open warmup does not count: the rest are logged, the warmup is not, and the bar still says the workout is complete', async () => {
    const { container } = mount({ logs: [EZ_DONE[1], EZ_DONE[2], ...LAT_ALL] })
    await settle()
    expect(container.querySelector('[data-row-key="set:ez-w1"]')!.getAttribute('data-row-state')).toBe('unlogged') // the warmup is open
    expect(isComplete(container)).toBe(true)
  })

  it('an open working set keeps the timer: Lat Pulldown 03 and 04 are open and the bar is "REST 1:15 / 2:00" with the jump to the set', async () => {
    const { container } = mount({ logs: [...EZ_DONE, ...LAT_1_2] })
    await settle()
    expect(isComplete(container)).toBe(false)
    expect(bar(container)!.textContent).toContain('REST')
    expect(bar(container)!.textContent).toContain('1:15')
    expect(bar(container)!.textContent).toContain('/ 2:00')
    expect(bar(container)!.textContent).not.toContain('FINISH')
  })

  it('skipped sets are settled: 03 and 04 skipped and the rest logged is complete', async () => {
    const { container } = mount({ logs: [...EZ_DONE, ...LAT_1_2, skipped(log('l-lat3', 'lat-3', 3, 'ex-lat')), skipped(log('l-lat4', 'lat-4', 4, 'ex-lat'))] })
    await settle()
    expect(isComplete(container)).toBe(true)
  })

  it('a stage counts too: a logged dropset head whose drop is still open is not complete; with the drop logged it is', async () => {
    const dropSets = [
      ...SETS.filter((set) => set.id !== 'lat-3' && set.id !== 'lat-4'),
      { ...SETS.find((set) => set.id === 'lat-3')!, stageKind: 'dropset' as const },
      { ...SETS.find((set) => set.id === 'lat-4')!, id: 'lat-3-d1', setNumber: 3, isDropset: true, parentWeekPlanSetId: 'lat-3', stageIndex: 1 },
    ]
    const plan3 = weekPlan({ sets: dropSets })
    const head = log('l-lat3', 'lat-3', 3, 'ex-lat', { stageKind: 'dropset' })
    const drop = log('l-lat3d', 'lat-3-d1', 3, 'ex-lat', { isDropset: true, parentSetId: 'l-lat3', stageIndex: 1 })
    const open = mount({ logs: [...EZ_DONE, ...LAT_1_2, head], plan: plan3 })
    await settle()
    expect(isComplete(open.container)).toBe(false)
    expect(open.container.querySelector('[data-current-set]')!.getAttribute('data-row-key')).toBe('set:lat-3:stage:1')
    cleanup()
    const done = mount({ logs: [...EZ_DONE, ...LAT_1_2, head, drop], plan: plan3 })
    await settle()
    expect(isComplete(done.container)).toBe(true)
  })

  it('a workout with no working set at all keeps the usual bar (DECISIONS 259): no sets planned, or only a warmup', async () => {
    const none = mount({ logs: [], plan: weekPlan({ sets: [] }) })
    await settle()
    expect(none.container.querySelectorAll('[data-row-key]')).toHaveLength(0) // the fixture is the one it says: nothing to log, no current set
    expect(isComplete(none.container)).toBe(false)
    expect(bar(none.container)!.textContent).toContain('REST') // the usual bar: the timer that is running
    expect(none.container.textContent).not.toContain('WORKOUT COMPLETE')
    cleanup()
    useRestTimerStore.getState().stop() // and with no rest running, no bar at all, as before
    const idle = mount({ logs: [], plan: weekPlan({ sets: [] }) })
    await settle()
    expect(bar(idle.container)).toBeNull()
    cleanup()
    const warmupOnly = mount({ logs: [], plan: weekPlan({ sets: [SETS[0]], exercises: [PE_EZ] }) })
    await settle()
    expect(warmupOnly.container.querySelector('[data-row-key="set:ez-w1"]')).not.toBeNull()
    expect(isComplete(warmupOnly.container)).toBe(false)
    expect(warmupOnly.container.textContent).not.toContain('WORKOUT COMPLETE')
  })

  it('a planned set deleted in the workout is not an open one: 04 deleted and the rest logged is complete, with 04 open and 03 deleted it is not', async () => {
    const del = mount({ logs: [...EZ_DONE, ...LAT_1_2, log('l-lat3', 'lat-3', 3, 'ex-lat')], changes: [deletedChange('lat-4')] })
    await settle()
    expect(isComplete(del.container)).toBe(true)
    cleanup()
    const open = mount({ logs: [...EZ_DONE, ...LAT_1_2], changes: [deletedChange('lat-3')] }) // 04 is still open
    await settle()
    expect(isComplete(open.container)).toBe(false)
  })

  it('FINISH opens the finish screen, the one FINISH SESSION opens, completing nothing by itself; BACK TO SESSION returns to the bar', async () => {
    const { container } = mount({ logs: [...EZ_DONE, ...LAT_ALL] })
    await settle()
    fireEvent.click(within(bar(container)!).getByText('FINISH'))
    expect(container.querySelectorAll('[data-row-key]')).toHaveLength(0) // the workout is swapped for the screen
    expect(container.querySelector('[data-finish]')!.getAttribute('data-finish')).toBe('new')
    expect(container.querySelector('h1')!.textContent).toBe('FINISH PULL 1')
    expect(complete.mutateAsync).not.toHaveBeenCalled() // opening the screen completes nothing
    fireEvent.click(screen.getByRole('button', { name: 'BACK TO SESSION' }))
    await settle()
    expect(isComplete(container)).toBe(true)
  })

  it('+ ADD SET brings the bar back: the timer with the rest since the last set, and the next LOG records that rest', async () => {
    const { container } = mount({ logs: [...EZ_DONE, ...LAT_ALL] })
    await settle()
    expect(isComplete(container)).toBe(true)
    // the clock moves on while the bar says the workout is complete
    act(() => void vi.setSystemTime(new Date('2026-01-06T10:02:00Z')))
    fireEvent.click(screen.getAllByText('ADD SET')[1]) // Lat Pulldown's card (EZ Bar Curl is the first)
    await settle()
    expect(isComplete(container)).toBe(false)
    expect(bar(container)!.textContent).toContain('REST')
    expect(bar(container)!.textContent).toContain('2:00') // 10:00:00 to 10:02:00: the rest since the last set, from the store that was never stopped
    expect(bar(container)!.textContent).not.toContain('WORKOUT COMPLETE')
    // the added set is the current one; typing its numbers and LOG records the rest since that last set
    const current = container.querySelector('[data-current-set]') as HTMLElement
    fireEvent.change(within(current).getByLabelText('Weight'), { target: { value: '57.5' } })
    fireEvent.change(within(current).getByLabelText('Reps'), { target: { value: '8' } })
    await act(async () => {
      fireEvent.click(within(current).getByText('LOG'))
      await Promise.resolve()
    })
    expect(logSet.mutateAsync).toHaveBeenCalledTimes(1)
    expect(logSet.mutateAsync.mock.calls[0][0]).toMatchObject({ weight: 57.5, reps: 8, restSeconds: 120 })
  })

  it('a set added before a reload is not among the rows until the phone\'s list is read: until then the bar does not say the workout is complete', async () => {
    const lists = { 'xe-lat': [{ localId: 'added-1', logId: null, type: NORMAL, place: 1 }] } as unknown as Record<string, AddedSet[]>
    const { container } = mount({ logs: [...EZ_DONE, ...LAT_ALL], lists })
    // the first draw: the rows the server gave; the phone's list arrives a tick later
    expect(isComplete(container)).toBe(false)
    await settle()
    expect(container.querySelector('[data-row-key^="added:"]')).not.toBeNull() // the added set is drawn now, open
    expect(isComplete(container)).toBe(false)
    expect(bar(container)!.textContent).toContain('REST')
    cleanup()
    // the control: with no added set on the phone the same logs are complete once the list has been read, and not a tick before
    const plain = mount({ logs: [...EZ_DONE, ...LAT_ALL] })
    expect(isComplete(plain.container)).toBe(false)
    await settle()
    expect(isComplete(plain.container)).toBe(true)
  })
})
