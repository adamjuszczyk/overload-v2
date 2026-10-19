import { describe, it, expect } from 'vitest'
import type { WeekPlan } from '../../types'
import { forwardNote, forwardSource, nothingToPlanFrom } from './planForwardLogic'
import { pe, plan, wset } from './weekPlanning.testutil'

// Chunk 52 (TASKS-1.2 "Plan's header" → PlanForwardCard; SPEC Screens → Plan screen → Week row; board 1b; P1.2-10). What PLAN FORWARD's card says
// it takes, from where, and when there is nothing to plan from.

const slotPlan = (workout: string, week: number, over: Partial<WeekPlan> = {}, withSets = true): WeekPlan =>
  plan(week, [pe('pe-1', 'bench', 0)], withSets ? [wset(`s-${workout}-${week}`, 'pe-1', 1)] : [], { id: `wp-${workout}-${week}`, workoutDayId: workout, ...over })

describe('forwardSource — which week a week planned now would take its sets and set types from', () => {
  const slots = [{ workoutDayId: 'wd-a', sequencePosition: null }, { workoutDayId: 'wd-b', sequencePosition: null }]

  it('a stable run takes its default, whatever weeks exist', () => {
    const all = [slotPlan('wd-a', 1), slotPlan('wd-a', 2)]
    expect(forwardSource({ planningType: 'stable', week: 3, slots, allWeekPlans: all })).toEqual({ kind: 'default' })
  })

  it('a week-dependent run takes the one earlier week every workout takes', () => {
    const all = [slotPlan('wd-a', 1), slotPlan('wd-a', 2), slotPlan('wd-b', 1), slotPlan('wd-b', 2)]
    expect(forwardSource({ planningType: 'week_dependent', week: 3, slots, allWeekPlans: all })).toEqual({ kind: 'week', week: 2 })
  })

  it('skips a deload week and an empty one, and a week nobody planned: the source is the last planned normal week (DECISIONS 131, 132)', () => {
    // week 3 is a deload for A and empty for B; week 4 was never planned (a week off)
    const all = [
      slotPlan('wd-a', 1), slotPlan('wd-a', 2), slotPlan('wd-a', 3, { isDeload: true }),
      slotPlan('wd-b', 1), slotPlan('wd-b', 2), slotPlan('wd-b', 3, {}, false),
    ]
    expect(forwardSource({ planningType: 'week_dependent', week: 5, slots, allWeekPlans: all })).toEqual({ kind: 'week', week: 2 })
  })

  it('workouts that take different weeks have no one source', () => {
    const all = [slotPlan('wd-a', 1), slotPlan('wd-a', 2), slotPlan('wd-b', 1), slotPlan('wd-b', 2, { isDeload: true })]
    expect(forwardSource({ planningType: 'week_dependent', week: 3, slots, allWeekPlans: all })).toEqual({ kind: 'mixed' })
  })

  it('a workout with nothing to take beside one that has something is mixed, not that one\'s week', () => {
    const all = [slotPlan('wd-a', 1), slotPlan('wd-a', 2)]
    expect(forwardSource({ planningType: 'week_dependent', week: 3, slots, allWeekPlans: all })).toEqual({ kind: 'mixed' })
  })

  it('no workout with an earlier week with sets takes nothing', () => {
    expect(forwardSource({ planningType: 'week_dependent', week: 3, slots, allWeekPlans: [] })).toEqual({ kind: 'none' })
    expect(forwardSource({ planningType: 'week_dependent', week: 3, slots: [], allWeekPlans: [slotPlan('wd-a', 2)] })).toEqual({ kind: 'none' })
  })

  it('on a sequence run each slot is its own history', () => {
    const slot = (position: number, week: number) => slotPlan('wd-a', week, { id: `wp-${position}-${week}`, sequencePosition: position })
    const all = [slot(0, 1), slot(0, 2), slot(1, 1)]
    const bothSlots = [{ workoutDayId: 'wd-a', sequencePosition: 0 }, { workoutDayId: 'wd-a', sequencePosition: 1 }]
    expect(forwardSource({ planningType: 'week_dependent', week: 3, slots: bothSlots, allWeekPlans: all })).toEqual({ kind: 'mixed' })
    expect(forwardSource({ planningType: 'week_dependent', week: 3, slots: [bothSlots[0]], allWeekPlans: all })).toEqual({ kind: 'week', week: 2 })
  })
})

describe('forwardNote — board 1b\'s small print', () => {
  it('names the week it takes from and the week that opens next', () => {
    expect(forwardNote({ unit: 'week', week: 3, source: { kind: 'week', week: 2 } })).toBe(
      "Takes week 2's sets and set types. Numbers come with COPY. Week 4 opens once week 3 is planned.",
    )
  })

  it('says the default\'s sets, set types and rep targets on a stable run (SPEC)', () => {
    expect(forwardNote({ unit: 'week', week: 3, source: { kind: 'default' } })).toBe(
      "Takes the default's sets, set types and rep targets. Numbers come with COPY. Week 4 opens once week 3 is planned.",
    )
  })

  it('says cycle on a sequence run', () => {
    expect(forwardNote({ unit: 'cycle', week: 3, source: { kind: 'week', week: 2 } })).toBe(
      "Takes cycle 2's sets and set types. Numbers come with COPY. Cycle 4 opens once cycle 3 is planned.",
    )
  })

  it('says what it takes when the workouts take different weeks, and when there is nothing to take', () => {
    expect(forwardNote({ unit: 'week', week: 3, source: { kind: 'mixed' } })).toContain("Takes each workout's last planned week's sets and set types.")
    expect(forwardNote({ unit: 'week', week: 3, source: { kind: 'none' } })).toContain('Starts empty: no earlier week has sets to take.')
  })
})

describe('nothingToPlanFrom — P1.2-10: a stable run whose default has no set', () => {
  it('only a stable run, and only when the read says the default holds no set', () => {
    expect(nothingToPlanFrom('stable', false)).toBe(true)
    expect(nothingToPlanFrom('stable', true)).toBe(false)
    expect(nothingToPlanFrom('stable', undefined)).toBe(false) // not read yet: the button isn't blocked
    expect(nothingToPlanFrom('week_dependent', false)).toBe(false)
  })
})
