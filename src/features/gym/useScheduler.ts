import { format, subDays, isAfter, parseISO, differenceInCalendarWeeks } from 'date-fns'
import { useMesos } from '../programs/useMesos'
import { usePrograms, useWorkoutDays } from '../programs/usePrograms'
import { useWeekPlans, useAllWeekPlans } from '../plan/useWeekPlan'
import { useSessionsInRange } from './useSession'
import { schedule } from './scheduler'
import type { SchedulerResult, Mesocycle, WorkoutDay, WeekPlan } from '../../types'

const LOOKBACK_DAYS = 7

export interface SchedulerData {
  result: SchedulerResult | null
  isLoading: boolean
  activeMeso: Mesocycle | null
  workoutDays: WorkoutDay[]
  currentWeekPlans: WeekPlan[]
  allWeekPlans: WeekPlan[]
  currentWeek: number
}

export function useScheduler(today: string, dismissMissed = false): SchedulerData {
  const { data: mesos } = useMesos()
  const { data: programs } = usePrograms()

  const activeMeso = mesos?.find((m) => m.status === 'active') ?? null
  const programId = activeMeso?.programId ?? ''

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
  }
}
