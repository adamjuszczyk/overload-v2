// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay } from '../../types'
import { queryClient } from '../../lib/queryClient'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { createFakeDeloadDb, fakePlan, fakeSet } from './fakeDeloadDb.testutil'
import { findSessionMenuButton, openWeekMenu, sessionDeloadChip } from './planMenus.testutil'

// Chunk 54a, WEEK ⋯'s pending label (Adam, 2026-10-20; DECISIONS 187 (a), found in chunk 52's review, probe A): the row read "UNMARKING…"
// while a MARK was out, and "MARKING…" while an UNMARK was, because the label took its direction from whether the week READS as marked, and
// the mark (like the unmark) is patched into the week before it lands, so a week that is being marked already reads as marked. The label
// now follows the request itself: the mutation's own `isDeload`.
//
// The whole path, as the user has it: the real PlanPage, the real `useSetWeekDeload` (its optimistic patch and its `variables`) and the
// real weekPlanService.ts over a stateful in-memory database (fakeDeloadDb.testutil.ts), with the request held in flight behind a gate
// (the service's mark and unmark wait for it), so the test reads the sheet while the write is out. `marked` is whatever the hook's patch
// made of the week: this test never passes it by hand (the 1e capture did, and no test saw it).
//
// Break proofs (the report): the label taken from `marked`, as the code did (the first test reads UNMARKING… and fails, the second reads
// MARKING… and fails); the label always MARKING… (the second fails); the label always UNMARKING… (the first fails).

afterEach(() => {
  cleanup()
  queryClient.clear()
  useSettingsStore.setState(DEFAULT_SETTINGS)
  release()
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: format(new Date(), 'yyyy-MM-dd'), endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
  workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent',
}

let fake = createFakeDeloadDb({ plans: [], sets: [], exercises: [] })

// The gate: while it is held, a mark or an unmark waits at the door of the service, after the hook's optimistic patch and before the database.
let gate: Promise<void> | null = null
let release: () => void = () => {}
function hold() {
  gate = new Promise<void>((resolve) => {
    release = () => {
      resolve()
      gate = null
    }
  })
}

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
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./useReview', () => ({ useReview: () => ({ status: 'ready', groups: [], count: 0, error: null }) })) // REVIEW's line (chunk 56): nothing differed here
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined })) // the week view's session states (chunk 54b): none here
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
vi.mock('./weekPlanService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./weekPlanService')>()
  return {
    ...actual,
    markWeekDeload: async (...args: Parameters<typeof actual.markWeekDeload>) => {
      await gate
      return actual.markWeekDeload(...args)
    },
    unmarkWeekDeload: async (...args: Parameters<typeof actual.unmarkWeekDeload>) => {
      await gate
      return actual.unmarkWeekDeload(...args)
    },
  }
})

const { default: PlanPage } = await import('./PlanPage')

function buildWorld() {
  fake = createFakeDeloadDb({
    plans: [fakePlan('wp-1', 1)],
    sets: [1, 2, 3, 4].map((n) => fakeSet('wp-1', `s-${n}`, n, { target_rir: 2, target_weight: 100, rep_min: 8, rep_max: 8 })),
    exercises: [{ week_plan_id: 'wp-1', program_exercise_id: 'pe-a', exercise_id: 'ex-a' }],
  })
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
const sheet = () => within(screen.getByRole('dialog', { name: 'Week 1' }))
// The row: its button, and the words on it.
const rowButton = (label: string) => sheet().getByText(label).closest('button') as HTMLButtonElement

describe('WEEK ⋯ — the pending label follows the request in flight, not whether the week reads as marked (DECISIONS 187 (a))', () => {
  it('while a MARK is out the row reads MARKING… — although the week already reads as marked by then — and is disabled', async () => {
    buildWorld()
    renderPlanPage()
    await findSessionMenuButton() // the page has the week
    openWeekMenu()
    expect(sheet().getByText('MARK WEEK AS DELOAD')).toBeTruthy()

    hold()
    fireEvent.click(rowButton('MARK WEEK AS DELOAD'))

    // The hook's optimistic patch has marked the week (the session's DELOAD chip says so) while the write is still out ...
    await waitFor(() => expect(sessionDeloadChip()).not.toBeNull(), FOUND)
    expect(fake.state.plans[0].is_deload).toBe(false) // ... and the database has not been touched
    // ... and the row says what is happening: a mark.
    expect(sheet().getByText('MARKING…')).toBeTruthy()
    expect(sheet().queryByText('UNMARKING…')).toBeNull()
    expect(rowButton('MARKING…').disabled).toBe(true)

    release()
    await waitFor(() => expect(sheet().getByText('UNMARK THIS WEEK')).toBeTruthy(), FOUND)
    expect(sheet().queryByText('MARKING…')).toBeNull()
    expect(fake.state.plans[0].is_deload).toBe(true)
  })

  it('while an UNMARK is out the row reads UNMARKING… — although the week already reads as unmarked by then — and is disabled', async () => {
    buildWorld()
    renderPlanPage()
    await findSessionMenuButton()
    openWeekMenu()
    fireEvent.click(rowButton('MARK WEEK AS DELOAD')) // marked first, with the gate open
    await waitFor(() => expect(sheet().getByText('UNMARK THIS WEEK')).toBeTruthy(), FOUND)
    expect(fake.state.plans[0].is_deload).toBe(true)

    hold()
    fireEvent.click(rowButton('UNMARK THIS WEEK'))

    await waitFor(() => expect(sessionDeloadChip()).toBeNull(), FOUND) // patched unmarked, the write still out
    expect(fake.state.plans[0].is_deload).toBe(true) // the database still holds the mark
    expect(sheet().getByText('UNMARKING…')).toBeTruthy()
    expect(sheet().queryByText('MARKING…')).toBeNull()
    expect(rowButton('UNMARKING…').disabled).toBe(true)

    release()
    await waitFor(() => expect(sheet().getByText('MARK WEEK AS DELOAD')).toBeTruthy(), FOUND)
    expect(sheet().queryByText('UNMARKING…')).toBeNull()
    expect(fake.state.plans[0].is_deload).toBe(false)
  })

  it('a press on the disabled row while the write is out asks for nothing more', async () => {
    buildWorld()
    renderPlanPage()
    await findSessionMenuButton()
    openWeekMenu()

    hold()
    fireEvent.click(rowButton('MARK WEEK AS DELOAD'))
    await waitFor(() => expect(sessionDeloadChip()).not.toBeNull(), FOUND)
    fireEvent.click(rowButton('MARKING…'))
    fireEvent.click(rowButton('MARKING…'))
    release()
    await waitFor(() => expect(sheet().getByText('UNMARK THIS WEEK')).toBeTruthy(), FOUND)

    // exactly one mark ran (the plan row is flagged by the mark's one update), not one per press
    expect(fake.writes.filter((w) => w.table === 'v2_week_plans' && w.method === 'update')).toHaveLength(1)
  })
})
