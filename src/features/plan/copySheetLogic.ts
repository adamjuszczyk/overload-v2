import type { PlanningType, WeekPlan } from '../../types'
import type { Op, WeekPlanSetColumns } from '../programs/programChange'
import { copyNumbers, plannedWeekRecords, weeksOfSlot, type CopyField, type SetNumbersChanges, type SetNumbersUpdate } from './weekPlanning'
import { findLastUsableWeek } from './weekSources'

// Chunk 52 (TASKS-1.2 "Plan's header"; SPEC Weeks and copying [1.2] → COPY (2c); G53; board 2). What COPY's sheet decides, as pure
// functions: which workout is copied from which week, what the sheet offers, what its eyebrow says, and the op list it sends.
//
// COPY copies each of this week's workouts from its OWN source, the last planned normal, non-empty occurrence of that slot before
// this week (SPEC "Deload sessions are never a copy source"; DECISIONS 42's empty skip; DECISIONS 132; the carry note for 52), and
// not simply from week N − 1: after a week off, or a deload last week, the source is an earlier week. `copyNumbers` (weekPlanning.ts)
// matches each workout of this week to the `lastWeek` entry of its own slot, so what is passed as `lastWeek` is one source plan per
// slot. A workout with no usable earlier week has nothing to copy from ("no_source"), and a done workout is locked ("done").

export type CopyRowState = 'open' | 'done' | 'no_source'

export interface CopyRow {
  /** This week's plan row for the workout (a slot, on a sequence run). */
  id: string
  /** The row's day label on the sheet (`TUE`, `TUE · THU` for a workout that shares one plan, `SLOT 3`). */
  day: string
  name: string
  state: CopyRowState
  /** The week the numbers come from; null with no usable week. */
  sourceWeek: number | null
  /** That week's plan of the same slot; null with no usable week. */
  source: WeekPlan | null
}

/** Every workout of this week with the week its numbers would come from. `label` names a row: its day and the workout's name. */
export function copyRows(input: {
  thisWeek: readonly WeekPlan[]
  allWeekPlans: readonly WeekPlan[]
  doneWeekPlanIds: ReadonlySet<string>
  label: (plan: WeekPlan) => { day: string; name: string }
}): CopyRow[] {
  return input.thisWeek.map((plan) => {
    const slot = weeksOfSlot(input.allWeekPlans, plan.workoutDayId, plan.sequencePosition ?? null)
    const sourceWeek = findLastUsableWeek(plannedWeekRecords(slot), plan.weekNumber)
    const source = sourceWeek === null ? null : (slot.find((wp) => wp.weekNumber === sourceWeek) ?? null)
    const { day, name } = input.label(plan)
    const state: CopyRowState = input.doneWeekPlanIds.has(plan.id) ? 'done' : source === null ? 'no_source' : 'open'
    return { id: plan.id, day, name, state, sourceWeek: source === null ? null : sourceWeek, source }
  })
}

/** Which fields the sheet offers (G53): a stable run's default owns its rep targets, so a stable week copies Weight and RIR only. */
export function copyFieldsOffered(planningType: PlanningType): CopyField[] {
  return planningType === 'stable' ? ['weight', 'rir'] : ['weight', 'reps', 'rir']
}

/** The workouts the sheet copies into: ticked, and never a done one or one with nothing to copy from. The one place that says so. */
export function pickedWorkouts(rows: readonly CopyRow[], picked: ReadonlySet<string>): CopyRow[] {
  return rows.filter((row) => row.state === 'open' && picked.has(row.id))
}

/** What the copy would change in this week's sets (the sheet's CTA is disabled when it would change none). */
export function copyUpdates(input: {
  rows: readonly CopyRow[]
  picked: ReadonlySet<string>
  fields: ReadonlySet<CopyField>
  overwrite: boolean
  thisWeek: readonly WeekPlan[]
}): SetNumbersUpdate[] {
  const workouts = pickedWorkouts(input.rows, input.picked)
  return copyNumbers({
    fields: input.fields,
    workouts: workouts.map((row) => row.id),
    overwrite: input.overwrite,
    lastWeek: workouts.flatMap((row) => (row.source === null ? [] : [row.source])),
    thisWeek: input.thisWeek,
  })
}

const COLUMN_OF: Record<keyof SetNumbersChanges, keyof WeekPlanSetColumns> = {
  targetWeight: 'target_weight',
  repMin: 'rep_min',
  repMax: 'rep_max',
  isAmrap: 'is_amrap',
  targetRir: 'target_rir',
  targetRirMax: 'target_rir_max',
}

/**
 * The op list for one request: an update of each set `copyNumbers` changed, naming the columns it changed and no others
 * (`v2_apply_ops`, 043; a key left out is a column left alone, a null is a box emptied: an RIR range replaced by a number).
 */
export function numbersOps(updates: readonly SetNumbersUpdate[]): Op[] {
  return updates.map(({ setId, changes }): Op => {
    const patch: Partial<Record<keyof WeekPlanSetColumns, unknown>> = {}
    for (const key of Object.keys(changes) as Array<keyof SetNumbersChanges>) {
      if (changes[key] !== undefined) patch[COLUMN_OF[key]] = changes[key]
    }
    return { op: 'update', table: 'v2_week_plan_sets', id: setId, patch: patch as Partial<WeekPlanSetColumns> }
  })
}

/**
 * The sheet's eyebrow (board 2: `WEEK 2 · FROM WEEK 1'S PLAN`). When the workouts copy from different weeks (a deload last week for
 * one of them, a workout added later) no one week is "last week": it names them, up to three, else "EARLIER WEEKS". A display choice
 * (D31), recorded in the chunk report.
 */
export function copyEyebrow(input: { unit: 'WEEK' | 'CYCLE'; week: number; rows: readonly CopyRow[] }): string {
  const { unit, week } = input
  const sources = [...new Set(input.rows.filter((row) => row.state === 'open').map((row) => row.sourceWeek as number))].sort((a, b) => a - b)
  const head = `${unit} ${week}`
  if (sources.length === 0) return head
  if (sources.length === 1) return `${head} · FROM ${unit} ${sources[0]}'S PLAN`
  if (sources.length > 3) return `${head} · FROM EARLIER ${unit}S`
  const last = sources[sources.length - 1]
  return `${head} · FROM ${unit}S ${sources.slice(0, -1).join(', ')} AND ${last}`
}
