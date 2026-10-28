// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay } from '../../types'
import type { DeloadRules } from '../../lib/deloadRules'
import { queryClient } from '../../lib/queryClient'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { createFakeDeloadDb, fakePlan, fakeSet, type FakeSetRow } from './fakeDeloadDb.testutil'
import { findSessionToggle, openWeekMenu, sessionToggle } from './planMenus.testutil'

// Chunk 48 (TASKS-1.2: "Deload rules are read from Settings and nowhere else"; SPEC Deload [1.2]: "Settings
// only; programs have no override"; "RIR rule: a range shifts both ends, floor 0"). The call-site proof:
// tapping the deload buttons on a run whose PROGRAM STORES a different override, and reading the rows that
// reach the database.
//
// It mocks nothing of Plan's own code: the real PlanPage, the real useWeekPlan.ts hooks (useSetDeload,
// useSetWeekDeload) and the real weekPlanService.ts (markSessionDeload, markWeekDeload, the snapshot and the
// restore) run against a stateful in-memory Supabase (fakeDeloadDb.testutil.ts: it applies the writes, so the
// page refetches what a user would see, and it enforces migration 042's check on target_rir_max). The fixture
// tells the right data source from the wrong one: the program's stored override halves the sets (keeps 4 of
// 8) with RIR +1, Settings quarters them (keeps 2 of 8) with RIR +2, on sets planned at RIR 1–2.
//
// Break proofs (chunk 48's report): PlanPage passing the program's stored override instead of the Settings
// rules; toSourceSet not reading target_rir_max; the snapshot, insertCalculatedPlanSets or
// insertRestoredPlanSets not writing it.

afterEach(() => {
  cleanup()
  queryClient.clear()
  useSettingsStore.setState(DEFAULT_SETTINGS)
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// Week 1, the current one: a run that started today.
const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: format(new Date(), 'yyyy-MM-dd'), endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

// The rules in play. Settings' are what a deload must apply; the program's are what an older version stored
// in v2_programs.deload_rules (the Program type has no such field any more, so it rides along outside the type).
const SETTINGS_RULES: DeloadRules = { sets: { mode: 'percent', value: 75, rounding: 'down' }, rir: { delta: 2 } }
const STORED_OVERRIDE: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' }, rir: { delta: 1 } }

let program: Program
function makeProgram(): Program {
  const base: Program = {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType: 'week_dependent',
  }
  return Object.assign(base, { deloadRules: STORED_OVERRIDE })
}

let fake = createFakeDeloadDb({ plans: [], sets: [], exercises: [] })

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => (fake.client.from as (t: string) => unknown)(table),
    rpc: (name: string, args: unknown) => fake.client.rpc(name, args),
  },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./useReview', () => ({ useReview: () => ({ status: 'ready', groups: [], count: 0, error: null }) })) // REVIEW's line (chunk 56): nothing differed here
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined })) // the week view's session states (chunk 54b): none here
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() })) // the CHANGE THE PROGRAM button's statuses: none here
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

// One planned session: eight working sets of one exercise at 100 kg, 8–12 reps, RIR 1–2 (a range).
function buildWorld() {
  const sets: FakeSetRow[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    fakeSet('wp-1', `s-${n}`, n, { target_rir: 1, target_rir_max: 2, target_weight: 100, rep_min: 8, rep_max: 12 }),
  )
  fake = createFakeDeloadDb({
    plans: [fakePlan('wp-1', 1)],
    sets,
    exercises: [{ week_plan_id: 'wp-1', program_exercise_id: 'pe-a', exercise_id: 'ex-a' }],
  })
  program = makeProgram()
}

function renderPlanPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const FOUND = { timeout: 5000 }
const insertedSets = () => fake.writes.filter((w) => w.table === 'v2_week_plan_sets' && w.method === 'insert').map((w) => w.args[0] as Record<string, unknown>)
const setsNow = () => fake.state.sets.map((s) => [s.set_number, s.target_rir, s.target_rir_max])
const ORIGINAL = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 1, 2])

describe('PlanPage — a session marked as deload follows the Settings rules (chunk 48)', () => {
  it('a run whose program stored a different override: 8 sets at RIR 1–2 become 2 sets at 3–4 (Settings), not 4 at 2–3 (the override)', async () => {
    buildWorld()
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: SETTINGS_RULES })
    renderPlanPage()

    fireEvent.click(await findSessionToggle('MARK THIS SESSION AS DELOAD'))
    await findSessionToggle('UNMARK THIS SESSION') // the page refetched the marked session

    const inserted = insertedSets()
    expect(inserted).toHaveLength(2)
    expect(inserted.map((p) => [p.set_number, p.target_rir, p.target_rir_max])).toEqual([[1, 3, 4], [2, 3, 4]])
    // only the sets and RIR rules are on: weight and reps pass through
    expect(inserted.every((p) => p.target_weight === 100 && p.rep_min === 8 && p.rep_max === 12)).toBe(true)
    expect(setsNow()).toEqual([[1, 3, 4], [2, 3, 4]])
    expect(fake.state.plans[0].is_deload).toBe(true)
  })

  it('the pre-mark RIR range is in the saved copy, and UNMARK brings all 8 sets back with 1–2', async () => {
    buildWorld()
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: SETTINGS_RULES })
    renderPlanPage()

    fireEvent.click(await findSessionToggle('MARK THIS SESSION AS DELOAD'))
    await findSessionToggle('UNMARK THIS SESSION')
    const saved = fake.state.plans[0].deload_restore as { setNumber: number; targetRir: number; targetRirMax: number | null }[]
    expect(saved.map((e) => [e.setNumber, e.targetRir, e.targetRirMax])).toEqual(ORIGINAL)

    fireEvent.click(sessionToggle())
    await findSessionToggle('MARK THIS SESSION AS DELOAD')

    expect(setsNow()).toEqual(ORIGINAL)
    expect(fake.state.sets.every((s) => s.target_weight === 100 && s.rep_min === 8 && s.rep_max === 12)).toBe(true)
    expect(fake.state.plans[0]).toMatchObject({ is_deload: false, deload_restore: null })
  })

  it('no rules in Settings: the mark is flag-only, whatever the program stored (the override is not a fallback)', async () => {
    buildWorld()
    renderPlanPage()

    fireEvent.click(await findSessionToggle('MARK THIS SESSION AS DELOAD'))
    await findSessionToggle('UNMARK THIS SESSION')

    expect(fake.state.plans[0]).toMatchObject({ is_deload: true, deload_restore: null })
    expect(setsNow()).toEqual(ORIGINAL) // not one set changed
    expect(fake.writes.filter((w) => w.table === 'v2_week_plan_sets')).toEqual([]) // none deleted or inserted
  })
})

describe('PlanPage — MARK WEEK AS DELOAD follows the Settings rules too (chunk 48)', () => {
  it('a run whose program stored a different override: the week\'s session is marked with Settings\' rules, and UNMARK THIS WEEK restores the range', async () => {
    buildWorld()
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: SETTINGS_RULES })
    renderPlanPage()

    // Chunk 52: the week's deload is in WEEK ⋯ (board 1e), not a button above the panel.
    await screen.findByLabelText('Week 1 options', {}, FOUND)
    openWeekMenu()
    fireEvent.click(await screen.findByText('MARK WEEK AS DELOAD', {}, FOUND))
    await screen.findByText('UNMARK THIS WEEK', {}, FOUND)

    expect(insertedSets().map((p) => [p.set_number, p.target_rir, p.target_rir_max])).toEqual([[1, 3, 4], [2, 3, 4]])
    expect(setsNow()).toEqual([[1, 3, 4], [2, 3, 4]])

    fireEvent.click(screen.getByText('UNMARK THIS WEEK'))
    await screen.findByText('MARK WEEK AS DELOAD', {}, FOUND)

    expect(setsNow()).toEqual(ORIGINAL)
    expect(fake.state.plans[0]).toMatchObject({ is_deload: false, deload_restore: null })
    // Chunk 52: marking and unmarking a week plans nothing first (the week is planned by definition when its WEEK ⋯ exists): no
    // `v2_plan_week` call, no call to any function at all.
    expect(fake.writes.filter((w) => w.table === 'rpc')).toEqual([])
  })

  it('no rules in Settings: flag-only here too', async () => {
    buildWorld()
    renderPlanPage()

    await screen.findByLabelText('Week 1 options', {}, FOUND)
    openWeekMenu()
    fireEvent.click(await screen.findByText('MARK WEEK AS DELOAD', {}, FOUND))
    await screen.findByText('UNMARK THIS WEEK', {}, FOUND)

    expect(fake.state.plans[0]).toMatchObject({ is_deload: true, deload_restore: null })
    expect(setsNow()).toEqual(ORIGINAL)
  })
})

describe('the fixture itself (so the proofs above are not vacuous)', () => {
  it('the stored override and Settings differ, and the override would give a different result', async () => {
    const { calculateDeloadSets } = await import('../../lib/deloadRules')
    const source = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      id: `s-${n}`, programExerciseId: 'pe-a', setNumber: n, parentId: null, stageIndex: 0, isWarmup: false, stageKind: null,
      programSetId: null, repMin: 8, repMax: 12, isAmrap: false, targetRir: 1, targetRirMax: 2, tags: null, isDropset: false,
      plannedWeight: 100, loggedWeight: null,
    }))
    const bySettings = calculateDeloadSets(source, SETTINGS_RULES)
    const byOverride = calculateDeloadSets(source, STORED_OVERRIDE)
    expect(bySettings.map((s) => [s.targetRir, s.targetRirMax])).toEqual([[3, 4], [3, 4]])
    expect(byOverride.map((s) => [s.targetRir, s.targetRirMax])).toEqual([[2, 3], [2, 3], [2, 3], [2, 3]])
  })
})
