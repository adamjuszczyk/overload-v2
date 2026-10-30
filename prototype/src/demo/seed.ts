// Fake data for the prototype: the repo's own test fixtures where they exist
// (programHistory.testutil's "Cut PPL" run), seeded into the real query cache
// under the real query keys, so the real hooks read it.
import { queryClient } from '@app/lib/queryClient'
import { DAYS, SCHEDULE, cutPplPlans } from '@app/features/programs/programHistory.testutil'
import { RUN_SCHEDULES_KEY } from '@app/features/plan/useRunSchedule'
import type { Mesocycle, Program, WeeklySchedule } from '@app/types'

const U = 'proto-user'
const T = '2026-10-01T10:00:00Z'
const NONE: WeeklySchedule = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
const UL: WeeklySchedule = { ...NONE, monday: 'ul-upper', tuesday: 'ul-lower', thursday: 'ul-upper2', friday: 'ul-lower2' }
const FB: WeeklySchedule = { ...NONE, monday: 'fb-a', wednesday: 'fb-b', friday: 'fb-c' }

const days = (programId: string, list: { id: string; name: string; position: number }[]) =>
  list.map((d) => ({ ...d, programId, userId: U, exercises: [] }))
const ulDays = [{ id: 'ul-upper', name: 'Upper 1', position: 0 }, { id: 'ul-lower', name: 'Lower 1', position: 1 }, { id: 'ul-upper2', name: 'Upper 2', position: 2 }, { id: 'ul-lower2', name: 'Lower 2', position: 3 }]

function program(id: string, name: string, kind: 'saved' | 'run_copy', schedule: WeeklySchedule, list: { id: string; name: string; position: number }[], planningType: 'week_dependent' | 'stable' = 'week_dependent'): Program {
  return { id, userId: U, name, schedule, workoutDays: days(id, list), createdAt: T, updatedAt: T, kind, planningType, scheduleType: 'weekday' } as Program
}

export const SAVED: Program[] = [
  program('sp-ul', 'Upper/Lower', 'saved', UL, ulDays),
  program('sp-ppl', 'Push Pull Legs', 'saved', SCHEDULE, DAYS),
  program('sp-fb', 'Full Body 3x', 'saved', FB, [{ id: 'fb-a', name: 'Full Body A', position: 0 }, { id: 'fb-b', name: 'Full Body B', position: 1 }, { id: 'fb-c', name: 'Full Body C', position: 2 }], 'stable'),
]
const COPIES: Program[] = [
  program('rc-ul', 'Upper/Lower', 'run_copy', UL, ulDays),
  program('rc-cut', 'Cut PPL', 'run_copy', SCHEDULE, DAYS),
  program('rc-ppl2', 'Push Pull Legs', 'run_copy', SCHEDULE, DAYS),
  program('rc-old', 'Strength Block', 'run_copy', SCHEDULE, DAYS),
]

const meso = (id: string, name: string, programId: string, status: 'active' | 'completed', startDate: string, endDate: string | null, sourceProgramId: string): Mesocycle =>
  ({ id, userId: U, name, programId, status, startDate, endDate, createdAt: T, sourceProgramId }) as Mesocycle

const MESOS: Mesocycle[] = [
  meso('m-active', 'Upper/Lower', 'rc-ul', 'active', '2026-10-12', null, 'sp-ul'),
  meso('m-ppl2', 'Push Pull Legs', 'rc-ppl2', 'completed', '2026-10-05', '2026-10-11', 'sp-ppl'),
  meso('m-cut', 'Cut PPL', 'rc-cut', 'completed', '2026-07-06', '2026-09-13', 'sp-ppl'),
  meso('m-old', 'Strength Block', 'rc-old', 'completed', '2026-04-06', '2026-06-14', 'sp-ppl'),
]

// What item 8 (b)'s confirmation names, as the server would count it.
const COUNTS: Record<string, { weeks: number; sessions: number; sets: number; coach: number }> = {
  'm-cut': { weeks: 10, sessions: 38, sets: 1046, coach: 3 },
  'm-ppl2': { weeks: 1, sessions: 2, sets: 31, coach: 0 },
}
export const deleteCounts = (runId: string) => COUNTS[runId] ?? { weeks: 0, sessions: 0, sets: 0, coach: 0 }

export function seed() {
  const q = queryClient
  q.setDefaultOptions({ queries: { retry: false } })
  q.setQueryData(['v2_settings'], null)
  q.setQueryData(['v2_mesos'], MESOS)
  q.setQueryData(['v2_programs', 'saved'], SAVED)
  q.setQueryData(['v2_programs'], [...SAVED, ...COPIES])
  for (const p of [...SAVED, ...COPIES]) q.setQueryData(['v2_workoutDays', p.id], p.workoutDays)
  const cut = cutPplPlans()
  q.setQueryData(['v2_allWeekPlans', 'm-cut'], cut)
  q.setQueryData(['v2_allWeekPlans', 'm-ppl2'], cut.filter((p) => p.weekNumber === 1 && (p.workoutDayId === 'push-1' || p.workoutDayId === 'pull-1')))
  for (const m of MESOS) q.setQueryData([RUN_SCHEDULES_KEY, m.id], [])
  q.setQueryData(['v2_programPriorities', 'rc-cut'], [
    { tagType: 'muscle_group', tagValue: 'chest', mark: 'focus', updatedAt: T },
    { tagType: 'muscle_group', tagValue: 'back', mark: 'focus', updatedAt: T },
    { tagType: 'muscle_group', tagValue: 'calves', mark: 'dont_care', updatedAt: T },
  ])
  q.setQueryData(['v2_programPriorities', 'rc-ppl2'], [])
  q.setQueryData(['v2_programPriorities', 'rc-ul'], [])
  // A pre-1.1 run: no marks in the new table, old marks in Coach's table (four levels).
  q.setQueryData(['v2_programPriorities', 'rc-old'], [])
  q.setQueryData(['v2_coachMesoTagPriorities', 'm-old'], { anyExplicit: true })
  q.setQueryData(['proto_legacyMarks', 'm-old'], [
    { tagType: 'muscle_group', tagValue: 'quads', priority: 'top' },
    { tagType: 'muscle_group', tagValue: 'chest', priority: 'high' },
    { tagType: 'muscle_group', tagValue: 'calves', priority: 'low' },
  ])
  q.setQueryData(['v2_allWeekPlans', 'm-old'], cut.filter((p) => p.weekNumber <= 4))
  q.setQueryData(['v2_coachMesoTagPriorities', 'm-cut'], { anyExplicit: false })
  q.setQueryData(['v2_coachMesoTagPriorities', 'm-ppl2'], { anyExplicit: false })
}

export function removeSavedProgram(id: string) {
  queryClient.setQueryData<Program[]>(['v2_programs', 'saved'], (list) => (list ?? []).filter((p) => p.id !== id))
}
export function removeRun(id: string) {
  queryClient.setQueryData<Mesocycle[]>(['v2_mesos'], (list) => (list ?? []).filter((m) => m.id !== id))
}
