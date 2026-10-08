// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SetLog } from '../../types'
import type { ReferenceSession } from './sessionService'
import type { SetGroup } from './setGroupLogic'
import ExerciseReference from './ExerciseReference'

// Screen-layer tests (Lessons: "a screen-layer test asserting what
// ExerciseReference receives and shows") — renders the REAL component with
// hand-built `sessions` props, the same way the live hook's output would
// arrive, so a defensive-filter or wiring regression inside
// ExerciseReference.tsx itself (not just inside referenceByExercise.ts)
// would be caught here too.

afterEach(() => cleanup())
beforeEach(() => {
  // Chunk 23's own "check UI at 375px" (reviewer's note 7) — jsdom does no
  // real layout, so this is the same symbolic-but-required convention
  // PlanPage.weightTarget.test.tsx and its siblings already use: set the
  // viewport width property so nothing in this render path reads
  // window.innerWidth and silently assumes a wider screen. ExerciseReference
  // itself has no responsive branching at all (plain flex/text, every
  // colour via --tokens), so this is a guard against a future regression
  // more than a live behaviour difference today.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

function log(id: string, params: Partial<SetLog> = {}): SetLog {
  return {
    id,
    userId: 'user-1',
    sessionId: 'sess',
    exerciseId: 'ex-1',
    weekPlanSetId: null,
    setNumber: 1,
    weight: 100,
    reps: 8,
    rir: 2,
    note: null,
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
    isWarmup: false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: false,
    loggedAt: '2026-08-05T10:00:00Z',
    restSeconds: null,
    formRating: null,
    ...params,
  }
}
function group(l: SetLog): SetGroup<SetLog> {
  return { head: l, stages: [] }
}
function session(params: Partial<ReferenceSession> & { sessionId: string; date: string }): ReferenceSession {
  return { completedAt: null, mesocycleId: 'meso-1', logs: [], ...params }
}

const baseProps = {
  today: '2026-08-11',
  isLoading: false,
  mesocycleId: 'meso-1' as string | null,
  isError: false,
  onRetry: () => {},
  isFromCache: false,
  weightUnit: 'kg' as const,
}

describe('ExerciseReference — primary slot rendering', () => {
  it('FIRST TIME when sessions is empty', () => {
    render(<ExerciseReference {...baseProps} sessions={[]} />)
    expect(screen.getByText('FIRST TIME')).toBeTruthy()
  })

  it('LAST WEEK, with the matched session\'s own logged numbers', () => {
    const sessions = [session({ sessionId: 's1', date: '2026-08-05', logs: [group(log('l1', { weight: 100, reps: 8, rir: 2 }))] })]
    render(<ExerciseReference {...baseProps} sessions={sessions} />)
    expect(screen.getByText('LAST WEEK')).toBeTruthy()
    expect(screen.getByText('100×8')).toBeTruthy()
  })

  it('LAST TIME, with an elapsed-days sub-label', () => {
    const sessions = [session({ sessionId: 's1', date: '2026-07-01', completedAt: '2026-07-01T10:00:00Z', logs: [group(log('l1', { weight: 60, reps: 12 }))] })]
    render(<ExerciseReference {...baseProps} sessions={sessions} />)
    expect(screen.getByText('LAST TIME')).toBeTruthy()
    expect(screen.getByText('60×12')).toBeTruthy()
  })

  it('a deload-flagged candidate is never shown as LAST WEEK (or any primary slot) — defensive filter at the component\'s own resolver call', () => {
    // Raw, unfiltered input (as if the caller forgot to pre-filter) — the
    // component's own call into resolveExerciseReferenceAcrossRuns must
    // still exclude it, not just the service layer.
    const sessions = [session({ sessionId: 'deload', date: '2026-08-05', isDeload: true, logs: [group(log('l1'))] })]
    render(<ExerciseReference {...baseProps} sessions={sessions} />)
    expect(screen.getByText('FIRST TIME')).toBeTruthy()
    expect(screen.queryByText('LAST WEEK')).toBeNull()
  })
})

describe('ExerciseReference — reach-back (cross-run), new labels (no "THIS MESO" wording)', () => {
  it('shows the found reach-back session when the primary match was all-skipped', () => {
    const sessions = [
      session({ sessionId: 'skipped', date: '2026-08-05', logs: [group(log('l1', { isSkipped: true, weight: null, reps: null, rir: null }))] }),
      session({ sessionId: 'real-earlier', date: '2026-06-01', mesocycleId: 'meso-0', logs: [group(log('l2', { weight: 70, reps: 10 }))] }),
    ]
    render(<ExerciseReference {...baseProps} sessions={sessions} />)
    expect(screen.getByText(/LAST ACTUALLY TRAINED/)).toBeTruthy()
    expect(screen.getByText('70×10')).toBeTruthy()
  })

  it('"all skipped" state uses the new, non-meso-scoped label', () => {
    const sessions = [
      session({ sessionId: 'skipped-1', date: '2026-08-05', logs: [group(log('l1', { isSkipped: true, weight: null, reps: null, rir: null }))] }),
      session({ sessionId: 'skipped-2', date: '2026-06-01', mesocycleId: 'meso-0', logs: [group(log('l2', { isSkipped: true, weight: null, reps: null, rir: null }))] }),
    ]
    render(<ExerciseReference {...baseProps} sessions={sessions} />)
    expect(screen.getByText('SKIPPED EVERY TIME ON RECORD')).toBeTruthy()
    expect(screen.queryByText(/THIS MESO/)).toBeNull()
  })

  // "NOTHING ON RECORD TO COMPARE AGAINST" (none_found) is not exercised
  // here, deliberately: the component only ever calls the reach-back when
  // `primary.type !== 'first_time'`, which means `sessions` always
  // contains at least that one (already deload-excluded, already-past)
  // session — so `resolveReachBackAcrossRuns`'s own `past.length === 0`
  // branch can never fire through this component's own call site. It's a
  // genuinely unreachable-from-here defensive state (same class of
  // "unreachable in practice" as resolveSecondaryReference's own
  // `none_in_meso` + zero-candidates combination before this chunk) —
  // covered directly at the pure layer instead
  // (referenceByExercise.test.ts's own 'none_found: zero candidates at
  // all' case), where it's independently callable.
})

describe('ExerciseReference — EARLIER THIS WEEK (additive, unchanged shape)', () => {
  it('renders one panel per this-week occurrence, each with its own numbers', () => {
    const sessions = [
      session({ sessionId: 'last-week', date: '2026-08-05', logs: [group(log('l1', { weight: 100, reps: 8 }))] }),
      session({ sessionId: 'this-week', date: '2026-08-10', logs: [group(log('l2', { weight: 90, reps: 9 }))] }),
    ]
    render(<ExerciseReference {...baseProps} sessions={sessions} />)
    expect(screen.getByText('EARLIER THIS WEEK')).toBeTruthy()
    expect(screen.getByText('90×9')).toBeTruthy()
  })
})

describe('ExerciseReference — loading/error passthrough (unaffected by this chunk)', () => {
  it('isLoading renders the REFERENCE placeholder, not any resolved slot', () => {
    render(<ExerciseReference {...baseProps} isLoading sessions={[]} />)
    expect(screen.getByText('REFERENCE')).toBeTruthy()
    expect(screen.queryByText('FIRST TIME')).toBeNull()
  })

  it('isError renders the retry affordance, not any resolved slot', () => {
    render(<ExerciseReference {...baseProps} isError sessions={[]} />)
    expect(screen.getByText("COULDN'T LOAD REFERENCE")).toBeTruthy()
    expect(screen.queryByText('FIRST TIME')).toBeNull()
  })
})

describe('ExerciseReference — mesocycleId no longer consulted, but still accepted', () => {
  it('null vs a real id produce the identical render (the prop is accepted for caller compatibility, not read)', () => {
    const sessions = [session({ sessionId: 's1', date: '2026-08-05', logs: [group(log('l1'))] })]
    const withId = render(<ExerciseReference {...baseProps} mesocycleId="meso-1" sessions={sessions} />)
    const html1 = withId.container.innerHTML
    cleanup()
    const withNull = render(<ExerciseReference {...baseProps} mesocycleId={null} sessions={sessions} />)
    expect(withNull.container.innerHTML).toBe(html1)
  })
})

describe('ExerciseReference — D30-adjacent parity: a plain weekday LAST WEEK case renders exactly as master did', () => {
  // __fixtures__/exercisereference-lastweek-parity.html — captured by
  // rendering origin/master's (9bb0dde) OWN ExerciseReference.tsx with this
  // exact fixture, in a separate git worktree, via a throwaway capture
  // script (never committed there — same convention as
  // GymSession.d30.test.tsx's own fixture). Deliberately only a LAST_WEEK
  // match (no "this week" occurrence) — LAST_WEEK is the one primary slot
  // whose Panel never calls relativeLabel/formatDistanceToNow, so the
  // captured HTML has no wall-clock-relative text that would go stale as
  // real time passes.
  const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url))
  const EXPECTED_HTML = readFileSync(join(FIXTURE_DIR, '__fixtures__', 'exercisereference-lastweek-parity.html'), 'utf8')

  it('matches the frozen master render exactly: a non-deload session dated in the immediately preceding week', () => {
    const sessions = [
      session({ sessionId: 'sess-last-week', date: '2026-08-05', completedAt: '2026-08-05T18:00:00Z', logs: [group(log('log-lw', { weight: 100, reps: 8, rir: 2 }))] }),
    ]
    const { container } = render(<ExerciseReference {...baseProps} sessions={sessions} />)
    expect(container.innerHTML).toBe(EXPECTED_HTML)
  })

  it('sanity: the frozen fixture actually shows LAST WEEK and the logged set, not an empty/truncated capture', () => {
    expect(EXPECTED_HTML).toContain('LAST WEEK')
    expect(EXPECTED_HTML).toContain('100×8')
  })
})
