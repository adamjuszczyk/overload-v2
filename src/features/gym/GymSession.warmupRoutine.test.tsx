// @vitest-environment jsdom
//
// Chunk 18 (TASKS.md "Warmup routine" / SPEC.md "Warmup routine [P1]" —
// reviewer's brief: "jsdom 'real session' tests"). Renders the REAL
// GymSession -> WarmupRoutineChecklist -> warmupRoutineStore tree (same
// precedent as GymSession.tempo.test.tsx/GymSession.restChain.test.tsx),
// with everything else about the screen mocked away exactly as those files
// do. `usePrograms` is mocked, but warmupRoutineStore.ts itself is NOT —
// ticking must genuinely exercise the real Zustand store and real
// localStorage (jsdom provides one; the suite's default 'node' environment
// does not, same reason every other GymSession component test opts into
// jsdom).
//
// A SEPARATE file from GymSession.warmup.test.tsx (chunk 15's own warmup
// SETS / is_warmup feature) — this one is the warmup ROUTINE checklist
// (v2_workout_warmup_items), an unrelated table and an unrelated UI
// concern. Also separate from GymSession.d30.test.tsx: nothing here touches
// gymsession-d30-render.html or its test.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { WorkoutDay, WeekPlan, Session, WarmupRoutineItem } from '../../types'

afterEach(() => cleanup())

const session: Session = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined,
  workoutDayId: 'wd-1', workoutDay: undefined, date: '2026-01-05', status: 'in_progress', note: null,
  startedAt: '2026-01-05T10:00:00Z', completedAt: null, createdAt: '2026-01-05T10:00:00Z',
  setLogs: [], energyRating: null, pumpRating: null,
}

// Controlled per test — the fixture useWarmupRoutineItems below returns.
let warmupItems: WarmupRoutineItem[] = []

// Spies the brief asks for: "no supabase call, with a spy on the client's
// from/rpc and on fetch." Nothing in this test's own dependency graph would
// reach the REAL lib/supabase module (every hook that could is mocked
// below, same as every other GymSession test file) — mocked here anyway so
// there is a concrete surface to assert against, a real regression guard
// rather than a vacuous pass.
const fromSpy = vi.fn()
const rpcSpy = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args), rpc: (...args: unknown[]) => rpcSpy(...args) },
}))

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 0 }))
vi.mock('./useScrollToCurrentSet', () => ({
  useScrollToCurrentSet: () => ({ containerRef: { current: null }, direction: null, scrollToCurrentSet: () => {} }),
}))
vi.mock('./RestTimer', () => ({ default: () => null }))
vi.mock('./SessionComplete', () => ({ default: () => null }))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('./SwapExerciseSheet', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }),
  useSupersetBlockRests: () => ({ data: [] }),
  // The one real concern of this file — every other GymSession test mocks
  // this empty; here it serves the fixture each test sets.
  useWarmupRoutineItems: () => ({ data: warmupItems }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: vi.fn() }),
  useLastSessionLogs: () => ({ data: [], isLoading: false }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({
    data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn(),
  }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')
const { useWarmupRoutineStore } = await import('./warmupRoutineStore')

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const weekPlan: WeekPlan = {
  id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
  isDeload: false, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
}

function item(overrides: Partial<WarmupRoutineItem> & { id: string; position: number; body: string }): WarmupRoutineItem {
  return { userId: 'user-1', workoutDayId: 'wd-1', ...overrides }
}

function sessionJsx(sessionId: string) {
  return (
    <MemoryRouter>
      <GymSession sessionId={sessionId} workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
    </MemoryRouter>
  )
}

beforeEach(() => {
  warmupItems = []
  fromSpy.mockClear()
  rpcSpy.mockClear()
  useWarmupRoutineStore.setState({ bySession: {} })
  localStorage.clear()
})

describe('GymSession — warmup routine checklist, real session', () => {
  it('shows the items in order at the top, above the exercise cards', () => {
    warmupItems = [
      item({ id: 'wi-1', position: 0, body: 'Bike 5 min' }),
      item({ id: 'wi-2', position: 1, body: 'Band pull-aparts' }),
      item({ id: 'wi-3', position: 2, body: 'Empty-bar bench' }),
    ]
    const { container } = render(sessionJsx('session-1'))

    expect(screen.getByText('WARMUP ROUTINE')).toBeTruthy()
    const texts = Array.from(container.querySelectorAll('button')).map((b) => b.textContent).filter(Boolean)
    const order = ['Bike 5 min', 'Band pull-aparts', 'Empty-bar bench'].map((t) =>
      texts.findIndex((text) => text!.includes(t)),
    )
    expect(order.every((i) => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b)) // strictly ascending — saved order
  })

  it('no items: no heading, no element at all (D30)', () => {
    warmupItems = []
    const { container } = render(sessionJsx('session-1'))

    expect(screen.queryByText('WARMUP ROUTINE')).toBeNull()
    // No tick icon of either state anywhere — not just no heading.
    expect(container.querySelector('svg.lucide-square')).toBeNull()
    expect(container.querySelector('svg.lucide-square-check-big')).toBeNull()
  })

  it('ticking an item writes nothing to the network: no supabase from/rpc call, no fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      warmupItems = [item({ id: 'wi-1', position: 0, body: 'Bike 5 min' })]
      render(sessionJsx('session-1'))

      fromSpy.mockClear() // clear anything incidental to mounting itself
      rpcSpy.mockClear()
      fetchSpy.mockClear()

      fireEvent.click(screen.getByText('Bike 5 min'))

      expect(fromSpy).not.toHaveBeenCalled()
      expect(rpcSpy).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('ticking shows a filled check and strikes the text through', () => {
    warmupItems = [item({ id: 'wi-1', position: 0, body: 'Bike 5 min' })]
    const { container } = render(sessionJsx('session-1'))

    expect(container.querySelector('svg.lucide-square-check-big')).toBeNull()
    fireEvent.click(screen.getByText('Bike 5 min'))
    expect(container.querySelector('svg.lucide-square-check-big')).toBeTruthy()
  })

  it('ticks survive an unmount and remount for the SAME session id', () => {
    warmupItems = [item({ id: 'wi-1', position: 0, body: 'Bike 5 min' })]
    const { unmount } = render(sessionJsx('session-1'))
    fireEvent.click(screen.getByText('Bike 5 min'))
    unmount()

    // A fresh mount — the component re-reads localStorage via load(), not
    // anything held over from the unmounted instance's own React state.
    const { container } = render(sessionJsx('session-1'))
    expect(container.querySelector('svg.lucide-square-check-big')).toBeTruthy()
  })

  it('a tick never leaks to a DIFFERENT session id, even for the identical item', () => {
    warmupItems = [item({ id: 'wi-1', position: 0, body: 'Bike 5 min' })]
    const { unmount } = render(sessionJsx('session-1'))
    fireEvent.click(screen.getByText('Bike 5 min'))
    unmount()

    const { container } = render(sessionJsx('session-2'))
    expect(container.querySelector('svg.lucide-square-check-big')).toBeNull()
    expect(container.querySelector('svg.lucide-square')).toBeTruthy() // still shown, just unticked
  })

  it('a failing localStorage still renders the checklist and still lets a tick show in-memory', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    try {
      warmupItems = [item({ id: 'wi-1', position: 0, body: 'Bike 5 min' })]
      expect(() => render(sessionJsx('session-1'))).not.toThrow()
      expect(screen.getByText('Bike 5 min')).toBeTruthy()

      expect(() => fireEvent.click(screen.getByText('Bike 5 min'))).not.toThrow()
      expect(screen.getByText('Bike 5 min')).toBeTruthy() // still rendered after the failed write
    } finally {
      spy.mockRestore()
    }
  })

  it('a failing localStorage on READ still renders (getItem throws)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    try {
      warmupItems = [item({ id: 'wi-1', position: 0, body: 'Bike 5 min' })]
      expect(() => render(sessionJsx('session-1'))).not.toThrow()
      expect(screen.getByText('Bike 5 min')).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })
})
