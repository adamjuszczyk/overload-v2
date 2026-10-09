// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'

// Chunk 7 (TASKS.md "Each planned session owns its exercise list — refactor,
// no visible change") introduced this test to prove PlanPage reads the
// week's own exercise list (weekPlan.exercises) rather than falling back to
// useProgramExercises while a week plan exists — via a decoy: the fallback
// mock returns a deliberately WRONG exercise, so a regression back to the
// old source would show "DECOY EXERCISE" instead of Bench Press/Incline
// Press, and the HTML comparison below would fail.
//
// Chunk 9 review retry fix #4: chunk 9 adds real, visible UI to this same
// render (SWAP/move-up/move-down/REMOVE/ADD EXERCISE) — so the fixture this
// test compares against is no longer "byte-identical to build/chunk-6", and
// pretending it still is would be actively wrong. __fixtures__/
// planpage-chunk6-render.html is RE-CAPTURED here from build/chunk-9's own
// PlanPage.tsx, same fixture data as chunk 7/8 (unchanged — pe1/pe2/
// decoyExercise/weekPlan, no new props needed since this test exercises
// the decoy mechanism, not chunk 9's new buttons specifically), capturing
// whatever this branch currently renders for it. The decoy proof (does
// PlanPage read weekPlan.exercises or the fallback) is the invariant this
// file keeps proving, chunk over chunk — each chunk that visibly changes
// PlanPage's render re-captures this same fixture the same way, exactly as
// this one now does for chunk 9's own new buttons.
//
// Chunk 14 re-capture: this fixture's weekPlan already has a dropset
// (set-1/set-1-drop), so PlanSetGroup's new stage-kind label and STAGE
// KIND chip row (SPEC "Staged sets" — "labels stages by kind") now appear
// in it too — re-captured the same way, same unchanged fixture data (no
// stageKind set anywhere in it, so it reads as a dropset, same as before
// this chunk; PlanPage.repTargets.test.tsx/PlanPage.copyButtons.test.tsx
// stay green unmodified, confirming this is additive, not a regression).
//
// Chunk 19 re-capture: SetRow now always shows a WEIGHT editor (head and
// stage) and, on the head only, a TAGS chip row — neither existed before
// this chunk, so this fixture's two rows (set-1, no weight/tags of their
// own) now show both, both at rest ("—"/every preset inactive/"+ CUSTOM"):
// still the same unchanged fixture data, re-captured the same way as every
// prior visible change to this render. The rep target span is now a
// clickable RepTargetEditor; this fixture's own sets carry no repMin/repMax
// either, so it renders the new "—" placeholder (nothing rendered at all,
// pre-chunk-19) rather than the formatted-text span — see
// PlanPage.targetsParity.test.tsx for the narrower, assertion-based proof
// that an EXISTING rep target's own rendering is undisturbed by any of this
// (a literal whole-row byte-diff against master is no longer possible once
// weight/rep targets are genuinely editable — that test's own header
// explains why, and what it checks instead).
//
// Chunk 21 re-capture: PlanPage's Weeks tab now always offers a page-level
// "MARK WEEK AS DELOAD" / "UNMARK THIS WEEK" action (SPEC "Deload" — "mark
// session or week as deload" is one of this screen's own week actions,
// listed alongside "copy last week") whenever the viewed week isn't past
// and has scheduled days — true for this fixture's own week 1, so its
// render now includes that one new button. Same unchanged fixture data
// (weekPlan.isDeload: false, so the button reads MARK, not UNMARK) and the
// same re-capture convention as every visible change above. The per-session
// DELOAD toggle itself is unaffected (still conditioned on weekPlan alone,
// same as before) and this fixture's one program has no shared weekday
// (monday only), so no shared-row note renders either — see
// PlanPage.deload.test.tsx for both of those, and for the week action
// itself.
//
// Chunk 26 re-capture: PlanPage's header now always shows one new "Programs"
// icon button (CalendarDays, aria-label="Programs", navigate('/program')),
// next to the week-navigation controls — SPEC.md "Programs page": "Reached
// from the plan screen's header", now that PROGRAM is gone from the bottom
// bar (Nav.tsx) and nothing else in this header led there before (the
// no-active-run empty state's own "START A PROGRAM" button is a separate,
// already-existing branch, untouched). Confirmed by diffing the old and new
// fixture strings directly: the ONLY difference is this one <button> (14
// lines once pretty-printed), nothing else in this render moved or changed.
// Same unchanged fixture data and re-capture convention as every prior
// visible change to this render above.

afterEach(() => cleanup())

const today = new Date().toISOString().slice(0, 10)

const activeMeso: Mesocycle = {
  id: 'meso-1',
  userId: 'user-1',
  name: 'Test Meso',
  programId: 'prog-1',
  status: 'active',
  startDate: today,
  endDate: null,
  createdAt: '2026-01-01T00:00:00Z',
}

const program: Program = {
  id: 'prog-1',
  userId: 'user-1',
  name: 'Test Program',
  schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
  workoutDays: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  kind: 'run',
}

const workoutDay: WorkoutDay = {
  id: 'wd-1',
  programId: 'prog-1',
  userId: 'user-1',
  name: 'Push Day',
  position: 0,
  exercises: [],
}

const pe1: ProgramExercise = {
  id: 'pe-1',
  workoutDayId: 'wd-1',
  userId: 'user-1',
  exerciseId: 'ex-1',
  position: 0,
  weightUnit: null,
  exercise: {
    id: 'ex-1',
    userId: 'user-1',
    name: 'Bench Press',
    muscleGroup: 'chest',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
  },
}

const pe2: ProgramExercise = {
  id: 'pe-2',
  workoutDayId: 'wd-1',
  userId: 'user-1',
  exerciseId: 'ex-2',
  position: 1,
  weightUnit: null,
  exercise: {
    id: 'ex-2',
    userId: 'user-1',
    name: 'Incline Press',
    muscleGroup: 'chest',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
  },
}

// Deliberately wrong — if PlanPage ever falls back to useProgramExercises
// while a week plan exists, this exercise would appear instead of Bench
// Press/Incline Press, and the HTML comparison below would fail.
const decoyExercise: ProgramExercise = {
  id: 'pe-decoy',
  workoutDayId: 'wd-1',
  userId: 'user-1',
  exerciseId: 'ex-decoy',
  position: 0,
  weightUnit: null,
  exercise: {
    id: 'ex-decoy',
    userId: 'user-1',
    name: 'DECOY EXERCISE',
    muscleGroup: 'other',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
  },
}

const weekPlan: WeekPlan = {
  id: 'wp-1',
  userId: 'user-1',
  mesocycleId: 'meso-1',
  workoutDayId: 'wd-1',
  weekNumber: 1,
  isDeload: false,
  notes: null,
  sets: [
    {
      id: 'set-1',
      weekPlanId: 'wp-1',
      userId: 'user-1',
      programExerciseId: 'pe-1',
      setNumber: 1,
      targetRir: 2,
      isDropset: false,
      parentWeekPlanSetId: null,
      stageIndex: 0,
      isWarmup: false,
    },
    {
      id: 'set-1-drop',
      weekPlanId: 'wp-1',
      userId: 'user-1',
      programExerciseId: 'pe-1',
      setNumber: 1,
      targetRir: 0,
      isDropset: true,
      parentWeekPlanSetId: 'set-1',
      stageIndex: 1,
      isWarmup: false,
    },
  ],
  // The week's own exercise list (chunk 7) — the real data, same content
  // useProgramExercises carried on build/chunk-6.
  exercises: [pe1, pe2],
  createdAt: '2026-01-01T00:00:00Z',
}

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  // The fallback source only — deliberately wrong, see decoyExercise above.
  useProgramExercises: () => ({ data: [decoyExercise], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: () => ({ data: [weekPlan], isLoading: false }),
  // Chunk 8 — the meso-wide history query PlanPage now reads for its
  // manual-copy-button gating; [weekPlan] is enough for this fixture (this
  // test's weekPlan already has exercises, so every button-visibility
  // branch chunk 8 added evaluates to false here, same as before this
  // chunk — see the chunk 8 report for why this fixture's render is
  // unaffected) and usePlanWeek's mutate is never awaited by this render.
  useAllWeekPlans: () => ({ data: [weekPlan], isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  // Chunk 21 - the week-level mark/unmark action's own hook.
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  // Chunk 9 — week actions (TASKS.md "Edit a week's exercises"). None of
  // these mutate on a plain render; this fixture only needs them exported
  // so PlanPage.tsx's own import resolves against this mock, same reason
  // every other hook above is listed.
  useSwapWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))

// Chunk 24 — this component owns its own hooks (useSessionsInRange via
// gym/useSession.ts, which needs a real QueryClientProvider this file's
// own render() doesn't set up — every other PlanPage hook is mocked away
// the same way for the same reason). Stubbed to nothing: this file's own
// job is unrelated to session-moving: MoveSessionControl.test.tsx proves
// the real component.
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url))
const EXPECTED_HTML = readFileSync(join(FIXTURE_DIR, '__fixtures__', 'planpage-chunk6-render.html'), 'utf8')

describe('PlanPage — renders from the week\'s own exercise list, not the useProgramExercises fallback', () => {
  it('matches the frozen build/chunk-9 render exactly, for the same underlying data (re-captured each time this render visibly changes)', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>,
    )
    expect(container.innerHTML).toBe(EXPECTED_HTML)
  })

  it('sanity: the frozen fixture itself names both exercises (guards against an empty/truncated fixture passing vacuously)', () => {
    expect(EXPECTED_HTML).toContain('Bench Press')
    expect(EXPECTED_HTML).toContain('Incline Press')
    expect(EXPECTED_HTML).not.toContain('DECOY')
  })
})
