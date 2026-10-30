// @vitest-environment jsdom
// Chunk 64 — FINISH SESSION at the workout screen (TASKS-1.2 64; SPEC [1.2] "Finishing (11, C6)": "the finish screen (W18) shows the session's tiles, energy, pump and note, and
// COMPLETE. When planned sets aren't logged it says which ("2 planned sets aren't logged yet: EZ Bar Curl 01 and 02.") with GO BACK, which closes the finish screen and
// scrolls to the first of them. BACK TO SESSION closes it where it was. A reopened session finishes through W19"). The screen runs over the real rows (`useWorkoutRows`),
// the real scroll hook and the real `FinishScreen`: what is asserted is what the person would see and where the scroller ends up. The screen's own words, tiles, chips and
// payloads are `FinishScreen.test.tsx`'s; what COMPLETE writes is `FinishScreen.write.test.tsx`'s.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, cleanup, fireEvent, act, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import type { Session, SessionSetChangeRecord, SetLog, WeekPlan } from '../../types'
import type { ExerciseSwap } from './sessionService'
import type { AddedSet } from './workoutRules'

const complete = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false, isError: false, error: null as unknown }))
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
  useLogSet: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useUpdateSetLog: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useCompleteSession: () => ({ mutateAsync: complete.mutateAsync, isPending: complete.isPending, isError: complete.isError, error: complete.error }),
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: swaps }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')

import { EZ_DONE, LAT_1_2, LAT_ALL, NORMAL, deletedChange, log, skipped, swapRow, weekPlan, workoutDay } from './finishWorld.testutil'

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
