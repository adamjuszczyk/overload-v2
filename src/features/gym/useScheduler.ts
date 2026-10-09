import { format, subDays, isAfter, parseISO, differenceInCalendarWeeks } from 'date-fns'
import { useMesos } from '../programs/useMesos'
import { usePrograms, useWorkoutDays } from '../programs/usePrograms'
import { useWeekPlans, useAllWeekPlans } from '../plan/useWeekPlan'
import { useSessionsInRange } from './useSession'
import { schedule } from './scheduler'
import type { SchedulerResult, Mesocycle, Program, WorkoutDay, WeekPlan } from '../../types'

const LOOKBACK_DAYS = 7

export interface SchedulerData {
  result: SchedulerResult | null
  isLoading: boolean
  activeMeso: Mesocycle | null
  workoutDays: WorkoutDay[]
  currentWeekPlans: WeekPlan[]
  allWeekPlans: WeekPlan[]
  currentWeek: number
  // Chunk 25 — additive only: the active run's own program (already fetched
  // below via usePrograms — no new query). Optional so every existing
  // hand-built SchedulerData fixture (TodayPage.deload.test.tsx/TodayPage.
  // moveSession.test.tsx, both of which mock useScheduler wholesale) keeps
  // compiling and behaving unchanged — TodayPage.tsx reads
  // `(scheduler.program?.scheduleType ?? 'weekday')`, so an absent field
  // here reads exactly like a weekday run, same as today.
  program?: Program | null
}

export function useScheduler(today: string, dismissMissed = false): SchedulerData {
  const { data: mesos } = useMesos()
  const { data: programs } = usePrograms()

  const activeMeso = mesos?.find((m) => m.status === 'active') ?? null
  const programId = activeMeso?.programId ?? ''
  // Chunk 25 — same programs list already fetched below; no new query.
  const activeProgram = programs?.find((p) => p.id === programId) ?? null

  const currentWeek = activeMeso
    ? differenceInCalendarWeeks(parseISO(today), parseISO(activeMeso.startDate), { weekStartsOn: 1 }) + 1
    : 1

  // Lookback window — never earlier than meso start date
  const lookbackStart = activeMeso
    ? format(
        isAfter(parseISO(activeMeso.startDate), subDays(parseISO(today), LOOKBACK_DAYS))
          ? parseISO(activeMeso.startDate)
          : subDays(parseISO(today), LOOKBACK_DAYS),
        'yyyy-MM-dd',
      )
    : today

  const { data: workoutDays } = useWorkoutDays(programId)
  const { data: currentWeekPlans } = useWeekPlans(activeMeso?.id ?? '', currentWeek)
  const { data: allWeekPlans } = useAllWeekPlans(activeMeso?.id ?? '')
  const { data: sessions } = useSessionsInRange(lookbackStart, today)

  const isLoading =
    !mesos ||
    !programs ||
    (!!programId && !workoutDays) ||
    !sessions ||
    (!!activeMeso && (!currentWeekPlans || !allWeekPlans))

  if (isLoading) {
    return {
      result: null,
      isLoading: true,
      activeMeso,
      workoutDays: [],
      currentWeekPlans: [],
      allWeekPlans: [],
      currentWeek,
      program: activeProgram,
    }
  }

  const result = schedule(today, {
    activeMeso,
    programs: programs ?? [],
    workoutDays: workoutDays ?? [],
    currentWeekPlans: currentWeekPlans ?? [],
    allWeekPlans: allWeekPlans ?? [],
    sessions: sessions ?? [],
    dismissMissed,
  })

  return {
    result,
    isLoading: false,
    activeMeso,
    workoutDays: workoutDays ?? [],
    currentWeekPlans: currentWeekPlans ?? [],
    allWeekPlans: allWeekPlans ?? [],
    currentWeek,
    program: activeProgram,
  }
}
