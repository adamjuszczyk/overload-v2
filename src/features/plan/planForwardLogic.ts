import type { PlanningType, WeekPlan } from '../../types'
import { chooseAutoCopySource, plannedWeekRecords, weeksOfSlot } from './weekPlanning'

// Chunk 52 (TASKS-1.2 "Plan's header" → PlanForwardCard; SPEC Screens → Plan screen → Week row, Weeks and copying [1.2] → What the
// auto-copy takes; board 1b). What PLAN FORWARD's card says it will do, as pure functions over what the page already has.
//
// "Takes week 2's sets and set types. Numbers come with COPY. Week 4 opens once week 3 is planned." (stable: "the default's sets, set
// types and rep targets"). The source is the one a week planned now would take (`chooseAutoCopySource`, the TypeScript twin of 045):
// the run's default on a stable run, otherwise each workout's last planned normal, non-empty week. Workouts that take different weeks
// have no one "week 2"; the note then says what each takes. (Until chunk 53's migration the database still copies the numbers too; the
// note is what the rule says, as the chunk report states.)

export type ForwardSource =
  | { kind: 'default' } // the run copy's sets, set types and rep targets (a stable run; week 1 of any run)
  | { kind: 'week'; week: number } // every workout takes the same earlier week
  | { kind: 'mixed' } // workouts take different earlier weeks
  | { kind: 'none' } // no workout has an earlier week with sets to take

export interface ForwardSlot {
  workoutDayId: string
  sequencePosition: number | null
}

export function forwardSource(input: {
  planningType: PlanningType
  week: number
  slots: readonly ForwardSlot[]
  allWeekPlans: readonly Pick<WeekPlan, 'workoutDayId' | 'sequencePosition' | 'weekNumber' | 'isDeload' | 'sets'>[]
}): ForwardSource {
  if (input.planningType === 'stable' || input.week === 1) return { kind: 'default' }
  const weeks = new Set<number>()
  let anyEmpty = false
  for (const slot of input.slots) {
    const source = chooseAutoCopySource({
      planningType: input.planningType,
      weekNumber: input.week,
      priorWeeks: plannedWeekRecords(weeksOfSlot(input.allWeekPlans, slot.workoutDayId, slot.sequencePosition)),
    })
    if (source.kind === 'week') weeks.add(source.weekNumber)
    else anyEmpty = true
  }
  if (weeks.size === 0) return { kind: 'none' }
  if (weeks.size === 1 && !anyEmpty) return { kind: 'week', week: [...weeks][0] }
  return { kind: 'mixed' }
}

/** The card's small print under the button. `unit` is the word for the run's weeks ("week" or "cycle"), in lower case. */
export function forwardNote(input: { unit: 'week' | 'cycle'; week: number; source: ForwardSource }): string {
  const { unit, week, source } = input
  const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
  const opens = `${sentence(unit)} ${week + 1} opens once ${unit} ${week} is planned.`
  switch (source.kind) {
    case 'default':
      return `Takes the default's sets, set types and rep targets. Numbers come with COPY. ${opens}`
    case 'week':
      return `Takes ${unit} ${source.week}'s sets and set types. Numbers come with COPY. ${opens}`
    case 'mixed':
      return `Takes each workout's last planned ${unit}'s sets and set types. Numbers come with COPY. ${opens}`
    case 'none':
      return `Starts empty: no earlier ${unit} has sets to take. Numbers come with COPY. ${opens}`
  }
}

/** P1.2-10: on a stable run whose default has no set in any of the week's workouts there is nothing to plan from. */
export function nothingToPlanFrom(planningType: PlanningType, defaultHasSets: boolean | undefined): boolean {
  return planningType === 'stable' && defaultHasSets === false
}
