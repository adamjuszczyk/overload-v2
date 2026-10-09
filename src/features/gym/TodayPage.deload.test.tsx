// @vitest-environment jsdom
//
// Chunk 21 (SPEC "Deload" — "'DELOAD' for that session, not 'DELOAD
// WEEK'"). TodayPage.tsx's own upcoming-session card read "DELOAD WEEK"
// before this chunk (TASKS.md's own Fact: "yet Today labels it 'DELOAD
// WEEK' (TodayPage.tsx:136-143)") — this is the one real text fix, on the
// `suggest_from_plan`/`suggest_no_plan` card's own label, still gated on
// that one upcoming session's own weekPlan.isDeload (unchanged condition).
//
// Two groups of tests: a byte-identical render-parity proof for a
// NON-deload session (DECISIONS D30's own method, extended here per the
// chunk's own gate: "a non-deload Today... render[s] exactly as master" —
// no such parity test existed for Today before this chunk, so this is the
// first capture, taken on this branch's own pre-text-fix render, which is
// identical to master's for this one case since the fix only ever touches
// text inside the isDeload-true branch); and a label-condition proof for
// the deload case, which master's D30 facts say has never actually been
// exercised live (L1).
//
// Chunk 24 re-capture (reviewer's own D30-style gate for this chunk: "A
// plain Today with one scheduled session and no moves renders as on
// master; capture master's render in a scratch worktree and compare"):
// this chunk adds a real "MOVE THIS SESSION" button (SPEC "Weekday") to
// this exact card. Proof the only diff is that one button, not a
// regression: this branch's base (origin/master, 394ce31) carries this same
// fixture file byte-identical (`git diff origin/master -- <this fixture>`
// is empty) — i.e. the OLD content already here WAS master's own render for
// this scenario — so diffing it against this chunk's freshly captured
// render is exactly the master-vs-branch comparison the gate asks for,
// without needing a second checkout. The diff is exactly one line: the new
// button appended after START SESSION, nothing else moved, changed or
// disappeared (this chunk's report has the full diff). Re-captured the
// same way every prior visible change to this card has been (chunk 21's
// own header above).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Mesocycle, WorkoutDay, WeekPlan, SchedulerResult } from '../../types'
import type { SchedulerData } from './useScheduler'

afterEach(() => cleanup())

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: '2026-01-01', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

function makeWeekPlan(isDeload: boolean): WeekPlan {
  return {
    id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2,
    isDeload, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
  }
}

const mockState: { result: SchedulerResult | null } = { result: null }

vi.mock('./useScheduler', () => ({
  useScheduler: (): SchedulerData => ({
    result: mockState.result,
    isLoading: false,
    activeMeso,
    workoutDays: [workoutDay],
    currentWeekPlans: mockState.result?.type === 'suggest_from_plan' ? [mockState.result.weekPlan] : [],
    allWeekPlans: [],
    currentWeek: 2,
  }),
}))
vi.mock('./useSession', () => ({
  useCreateSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useActiveSession: () => ({ data: undefined }),
  useReopenSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSkipSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSessionNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  // Chunk 24 — "Move this session" 's own hooks; this fixture never
  // exercises them (no click ever fires), so a plain stub is enough.
  useMoveSession: () => ({ mutate: vi.fn(), isPending: false }),
  useClearMovedSession: () => ({ mutate: vi.fn(), isPending: false }),
  useStartMovedSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
// Chunk 24 — the new MOVE THIS SESSION button is disabled while offline
// (TodayPage.tsx's own `!isOnline` check); this fixture needs it enabled so
// the button's presence/behaviour is unaffected by online status.
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../plan/useWeekPlan', () => ({
  usePlanWeek: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  planWeekThenFindId: vi.fn(async () => null),
}))
// Freezes the header date so the byte-identical fixture below never goes
// stale with the real calendar — TodayPage has no `today` prop of its own
// (unlike GymSession/SessionPreview), it calls this hook directly.
vi.mock('../../hooks/useToday', () => ({ useToday: () => '2026-01-05' }))

const { default: TodayPage } = await import('./TodayPage')

function renderToday() {
  return render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  mockState.result = null
})

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url))
const EXPECTED_HTML = readFileSync(join(FIXTURE_DIR, '__fixtures__', 'todaypage-chunk21-render.html'), 'utf8')

describe('TodayPage — a non-deload upcoming session renders unchanged (chunk 21 gate: Today parity)', () => {
  // Byte-identical snapshot (same method as PlanPage.renderParity.test.tsx
  // / DECISIONS D30), captured for this exact fixture — the FIRST such
  // capture for Today (none existed before this chunk). This chunk's only
  // TodayPage.tsx edit is the literal text inside `{weekPlan?.isDeload &&
  // (<p>...</p>)}` — entirely absent from the DOM whenever isDeload is
  // false, as it is here — so this capture is provably identical to
  // whatever master would have rendered for the same fixture, not merely
  // asserted to be.
  it('matches a byte-identical capture of this card, with no DELOAD text anywhere in it', () => {
    mockState.result = { type: 'suggest_from_plan', weekPlan: makeWeekPlan(false), date: '2026-01-05' }
    const { container } = renderToday()

    expect(container.innerHTML).toBe(EXPECTED_HTML)
    expect(screen.getByText('Push Day')).toBeTruthy()
    expect(screen.getByText(/WEEK 2/)).toBeTruthy()
    expect(screen.queryByText(/DELOAD/)).toBeNull()
  })

  it('a scheduled workout with no plan yet (suggest_no_plan) also shows no DELOAD text', () => {
    mockState.result = { type: 'suggest_no_plan', workoutDay, date: '2026-01-05' }
    renderToday()

    expect(screen.getByText('Push Day')).toBeTruthy()
    expect(screen.getByText(/NO PLAN THIS WEEK/)).toBeTruthy()
    expect(screen.queryByText(/DELOAD/)).toBeNull()
  })
})

describe('TodayPage — a deload session labels "DELOAD", never "DELOAD WEEK" (chunk 21)', () => {
  it('shows DELOAD on the upcoming card when its own plan row is deload', () => {
    mockState.result = { type: 'suggest_from_plan', weekPlan: makeWeekPlan(true), date: '2026-01-05' }
    renderToday()

    expect(screen.getByText('DELOAD')).toBeTruthy()
    expect(screen.queryByText('DELOAD WEEK')).toBeNull()
    expect(screen.queryByText(/DELOAD WEEK/)).toBeNull()
  })
})
