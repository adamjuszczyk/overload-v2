import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { DayOfWeek, WeeklySchedule } from '../../types'
import {
  dayTakenText,
  daysCardText,
  daysOfWorkout,
  draftFromRunCopy,
  ruleBoxText,
  validateDays,
} from './programChange'
import { scheduleForWeek, sameSchedule } from './runSchedule'
import {
  NOW,
  USER,
  type World,
  applyOpsToDb,
  deletes,
  editExercises,
  fullDays,
  inserts,
  onlySessions,
  patchExercise,
  planOf,
  removeExerciseFrom,
  runCopyOf,
  scheduleRowsOf,
  updates,
} from './programChange.testutil'
import { sequenceWorld, stableWorld } from './programChange.worlds.testutil'

// Chunk 45 — weekdays (SPEC [1.2] Programs and runs → "Weekdays (1e)" and "Weekdays storage"; Defaults 2 and 3): "New days
// start next week: this week's sessions keep their days"; "a day another workout already uses can't be picked"; "At
// least one day stays on"; "Sequence runs have no DAYS card". Stored as `v2_run_schedules` rows (runSchedule.ts) and the
// run copy's own schedule.

const draftOf = (w: World) => draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)
const withDays = (w: World, change: Partial<WeeklySchedule>) => ({ ...draftOf(w), schedule: { ...draftOf(w).schedule, ...change } })

const OLD = fullDays({ tuesday: 'fb', thursday: 'fb', saturday: 'arms' })
const NEW = fullDays({ tuesday: 'fb', thursday: 'fb', friday: 'arms', saturday: 'arms' }) // Arms also on Friday

describe('a weekday change on a run with no schedule rows yet (current week 2)', () => {
  const w = stableWorld()
  const { ops, summary } = planOf(w, withDays(w, { friday: 'arms' }))

  it('writes from_week 1 with the days it had and from_week 3 with the new ones, then the run copy\'s schedule', () => {
    expect(ops).toEqual([
      { op: 'insert', table: 'v2_run_schedules', row: { id: 'n1', user_id: USER, mesocycle_id: 'meso', from_week: 1, schedule: OLD, created_at: NOW } },
      { op: 'insert', table: 'v2_run_schedules', row: { id: 'n2', user_id: USER, mesocycle_id: 'meso', from_week: 3, schedule: NEW, created_at: NOW } },
      { op: 'update', table: 'v2_programs', id: 'prog', patch: { schedule: NEW } },
    ])
  })

  it('says when the new days start', () => {
    expect(summary.scheduleStartWeek).toBe(3)
  })

  it('writes no session row: this week\'s sessions keep their days, and a week planned forward needs no rewrite (plan rows are per workout, not per day)', () => {
    expect(onlySessions(ops)).toEqual([])
  })

  it('once saved, this week and the weeks before still resolve the old days, and week 3 on the new', () => {
    const after = applyOpsToDb(w.db, ops)
    const rows = scheduleRowsOf(after, 'meso')
    const run = runCopyOf(after, 'prog', 'meso').schedule
    for (const week of [1, 2]) expect(sameSchedule(scheduleForWeek(rows, run, week), OLD)).toBe(true)
    for (const week of [3, 4, 9]) expect(sameSchedule(scheduleForWeek(rows, run, week), NEW)).toBe(true)
    expect(sameSchedule(run, NEW)).toBe(true) // the run copy holds the newest, for what doesn't resolve per week
  })

  it('the same days write nothing', () => {
    expect(planOf(w, draftOf(w)).ops).toEqual([])
  })
})

describe('a weekday change on a run that already has rows', () => {
  it('writes only the new row, for the week after the current one', () => {
    const w = stableWorld()
    w.db.v2_run_schedules.push({ id: 'old1', user_id: USER, mesocycle_id: 'meso', from_week: 1, schedule: { tuesday: 'fb', thursday: 'fb', saturday: 'arms' } })
    const { ops } = planOf(w, withDays(w, { friday: 'arms' }))
    expect(inserts(ops, 'v2_run_schedules').map((o) => [o.row.from_week, o.row.schedule])).toEqual([[3, NEW]])
    expect(inserts(ops, 'v2_run_schedules')).toHaveLength(1) // not a second from_week 1
  })

  it('a second change in the same week writes over the first one\'s row', () => {
    const w = stableWorld()
    w.db.v2_run_schedules.push({ id: 'r1', user_id: USER, mesocycle_id: 'meso', from_week: 1, schedule: { tuesday: 'fb', thursday: 'fb', saturday: 'arms' } })
    w.db.v2_run_schedules.push({ id: 'r3', user_id: USER, mesocycle_id: 'meso', from_week: 3, schedule: { tuesday: 'fb', thursday: 'fb', friday: 'arms' } })
    const { ops } = planOf(w, withDays(w, { friday: 'arms', saturday: 'arms' }))
    expect(inserts(ops, 'v2_run_schedules')).toEqual([])
    expect(updates(ops, 'v2_run_schedules').map((o) => [o.id, o.patch.schedule])).toEqual([['r3', NEW]])
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow() // an insert of week 3 would have broken (meso, from_week)'s unique index
  })

  it('the week is the run\'s current week plus one, whatever it is', () => {
    const w = stableWorld()
    const { ops } = planOf(w, withDays(w, { friday: 'arms' }), { currentWeek: 6 })
    expect(inserts(ops, 'v2_run_schedules').map((o) => o.row.from_week)).toEqual([1, 7])
  })
})

describe('a workout on two weekdays — the shared plan row (G14)', () => {
  it('a day toggle on the shared workout keeps both days\' sessions on the one plan row: it writes schedule rows and no plan row', () => {
    const w = stableWorld()
    // Full Body is on Tuesday and Thursday (one plan row a week); move Tuesday to Wednesday
    const { ops } = planOf(w, withDays(w, { tuesday: null, wednesday: 'fb' }))
    expect(onlySessions(ops)).toEqual([])
    expect(ops.every((o) => ['v2_run_schedules', 'v2_programs'].includes(o.table))).toBe(true)
    const after = applyOpsToDb(w.db, ops)
    expect(after.v2_week_plans).toEqual(w.db.v2_week_plans) // the same plan rows: nothing re-made or moved
    expect(after.v2_week_plan_exercises).toEqual(w.db.v2_week_plan_exercises)
    expect(daysOfWorkout(fullDays(after.v2_programs[0].schedule), 'fb')).toEqual(['wednesday', 'thursday'])
    // and week 3 on resolves Wednesday and Thursday for it, week 2 still Tuesday and Thursday
    const rows = scheduleRowsOf(after, 'meso')
    expect(daysOfWorkout(scheduleForWeek(rows, fullDays(after.v2_programs[0].schedule), 2), 'fb')).toEqual(['tuesday', 'thursday'])
    expect(daysOfWorkout(scheduleForWeek(rows, fullDays(after.v2_programs[0].schedule), 3), 'fb')).toEqual(['wednesday', 'thursday'])
  })

  it('with exercises changed in the same save, the shared row is changed once, not once a day', () => {
    const w = stableWorld()
    const draft = { ...removeExerciseFrom(draftOf(w), 'fb', 'pe-inc'), schedule: withDays(w, { tuesday: null, wednesday: 'fb' }).schedule }
    const { ops } = planOf(w, draft)
    expect(deletes(ops, 'v2_week_plan_exercises').map((o) => o.id)).toEqual(['p2-fb-x-pe-inc', 'p3-fb-x-pe-inc'])
  })
})

describe('what a weekday change must not do', () => {
  it('a sequence run has no weekdays: a schedule in the draft writes no rows, whatever it says', () => {
    const w = sequenceWorld()
    w.db.v2_programs[0].schedule = { monday: 'a' } // a stale weekday map left under a program that was switched to a sequence
    const { ops, summary } = planOf(w, { ...draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), 'stable'), schedule: fullDays({ tuesday: 'a', friday: 'b' }) })
    expect(ops).toEqual([])
    expect(summary.scheduleStartWeek).toBeNull()
  })

  it('a workout that has days can\'t be left with none', () => {
    const w = stableWorld()
    expect(() => planOf(w, withDays(w, { saturday: null }))).toThrow(/needs at least one/)
    expect(() => planOf(w, withDays(w, { tuesday: null, thursday: null, saturday: 'arms' }))).toThrow(/needs at least one/)
  })

  it('a day can\'t name a workout the run doesn\'t have', () => {
    const w = stableWorld()
    expect(() => planOf(w, withDays(w, { friday: 'nowhere' }))).toThrow(/doesn't have/)
  })

  it('a workout that has no day at all is not asked for one when something else changes', () => {
    const w = stableWorld()
    w.db.v2_workout_days.push({ id: 'loose', user_id: USER, program_id: 'prog', name: 'Loose', position: 2 })
    const { ops } = planOf(w, withDays(w, { friday: 'arms' }))
    expect(inserts(ops, 'v2_run_schedules')).toHaveLength(2)
  })
})

describe('validateDays — the toggle on the DAYS card', () => {
  const before = fullDays({ monday: 'push1', tuesday: 'pull1', thursday: 'push2', friday: 'pull2', saturday: 'legs' })

  it('refuses a day another workout is on, and says whose', () => {
    expect(validateDays({ schedule: before, workoutId: 'pull1', days: ['tuesday', 'thursday'] })).toEqual({ ok: false, reason: 'taken', day: 'thursday', takenBy: 'push2' })
  })

  it('names the first such day in week order when several are taken', () => {
    expect(validateDays({ schedule: before, workoutId: 'pull1', days: ['saturday', 'monday', 'tuesday'] })).toEqual({ ok: false, reason: 'taken', day: 'monday', takenBy: 'push1' })
  })

  it('a day the workout is already on is its own: keeping it is not a conflict', () => {
    const r = validateDays({ schedule: before, workoutId: 'pull1', days: ['tuesday', 'wednesday'] })
    expect(r.ok).toBe(true)
  })

  it('refuses no days at all: "a workout needs at least one day"', () => {
    expect(validateDays({ schedule: before, workoutId: 'pull1', days: [] })).toEqual({ ok: false, reason: 'no_days' })
  })

  it('moving to another day frees the one it leaves, and no other workout\'s day changes', () => {
    const r = validateDays({ schedule: before, workoutId: 'pull1', days: ['wednesday'] })
    expect(r).toEqual({ ok: true, schedule: fullDays({ monday: 'push1', wednesday: 'pull1', thursday: 'push2', friday: 'pull2', saturday: 'legs' }) })
  })

  it('a workout can be on several days (G14), and a workout with no day yet can take its first', () => {
    const r = validateDays({ schedule: before, workoutId: 'pull1', days: ['tuesday', 'wednesday'] })
    expect(r.ok && daysOfWorkout(r.schedule, 'pull1')).toEqual(['tuesday', 'wednesday'])
    const first = validateDays({ schedule: before, workoutId: 'loose', days: ['sunday'] })
    expect(first.ok && first.schedule.sunday).toBe('loose')
  })

  it('the schedule it returns is a full seven-day map, and the one given is left as it was', () => {
    const frozen = Object.freeze({ ...before })
    const r = validateDays({ schedule: frozen, workoutId: 'pull1', days: ['wednesday'] })
    expect(r.ok && Object.keys(r.schedule)).toHaveLength(7)
    expect(frozen).toEqual(before)
  })
})

describe('the texts', () => {
  const board = readFileSync(new URL('../../../design/1.2/source/Planner.dc.html', import.meta.url), 'utf8')

  it('the DAYS card\'s line is the board\'s, word for word', () => {
    const text = daysCardText({ workoutName: 'Pull 1', oldDays: ['tuesday'], newDays: ['wednesday'], startWeek: 3 })
    expect(text).toBe('Was Tuesday. New days start in week 3. This week Pull 1 stays on Tuesday; MOVE THIS SESSION in Plan moves just this week.')
    expect(board).toContain(text!)
  })

  it('a workout on two days says both, and one with none before says only what starts', () => {
    expect(daysCardText({ workoutName: 'Full Body', oldDays: ['tuesday', 'thursday'], newDays: ['wednesday', 'thursday'], startWeek: 4 })).toBe(
      'Was Tuesday and Thursday. New days start in week 4. This week Full Body stays on Tuesday and Thursday; MOVE THIS SESSION in Plan moves just this week.',
    )
    expect(daysCardText({ workoutName: 'Legs', oldDays: [], newDays: ['saturday'], startWeek: 3 })).toBe('New days start in week 3. MOVE THIS SESSION in Plan moves just this week.')
  })

  it('no change in the days: no line (the order they are listed in makes no difference)', () => {
    expect(daysCardText({ workoutName: 'Pull 1', oldDays: ['tuesday', 'thursday'], newDays: ['thursday', 'tuesday'] as DayOfWeek[], startWeek: 3 })).toBeNull()
  })

  it('"Thu is Push 2\'s day": the three-letter day, then whose it is', () => {
    expect(dayTakenText('thursday', 'Push 2')).toBe("Thu is Push 2's day")
    expect(dayTakenText('saturday', 'Arms')).toBe("Sat is Arms's day")
    expect(dayTakenText('monday', 'Push 1')).toBe("Mon is Push 1's day")
  })

  it('the rule box\'s headline is the board\'s, for each planning type', () => {
    const wd = ruleBoxText({ planningType: 'week_dependent', scheduleType: 'weekday', startWeek: 2, programName: 'Push Pull Legs', kept: [{ workoutName: 'Push 1', weekday: 'monday', status: 'done' }] })
    expect(wd.headline).toBe('Changes start in week 2. Sets are planned in each week, in Plan.')
    expect(board).toContain(wd.headline)
    const st = ruleBoxText({ planningType: 'stable', scheduleType: 'weekday', startWeek: 2, programName: 'Push Pull Legs', kept: [] })
    expect(st.headline).toBe('Changes start in week 2. Every week from then on copies this.')
    expect(board).toContain(st.headline)
  })

  it('under it: which done session keeps its plan, and that the saved program doesn\'t change — the board\'s sentence', () => {
    const wd = ruleBoxText({ planningType: 'week_dependent', scheduleType: 'weekday', startWeek: 2, programName: 'Push Pull Legs', kept: [{ workoutName: 'Push 1', weekday: 'monday', status: 'done' }] })
    expect(wd.detail).toBe("Monday's Push 1 is done, so it keeps its plan. Your saved program, Push Pull Legs, doesn't change.")
    expect(board).toContain(wd.detail)
  })

  it('several sessions kept, one in progress, none, and a sequence run (cycles, no weekdays): display choices, D31', () => {
    const base = { planningType: 'stable' as const, startWeek: 3, programName: 'PPL' }
    expect(ruleBoxText({ ...base, scheduleType: 'weekday', kept: [{ workoutName: 'Push 1', weekday: 'monday', status: 'done' }, { workoutName: 'Pull 1', weekday: 'tuesday', status: 'done' }] }).detail).toBe(
      "Monday's Push 1 and Tuesday's Pull 1 are done, so they keep their plans. Your saved program, PPL, doesn't change.",
    )
    expect(ruleBoxText({ ...base, scheduleType: 'weekday', kept: ['Push 1', 'Pull 1', 'Legs'].map((n) => ({ workoutName: n, status: 'done' as const })) }).detail).toBe(
      "Push 1, Pull 1 and Legs are done, so they keep their plans. Your saved program, PPL, doesn't change.",
    )
    expect(ruleBoxText({ ...base, scheduleType: 'weekday', kept: [{ workoutName: 'Pull 1', weekday: 'wednesday', status: 'in_progress' }] }).detail).toBe(
      "Wednesday's Pull 1 is in progress, so it stays as it is. Your saved program, PPL, doesn't change.",
    )
    expect(ruleBoxText({ ...base, scheduleType: 'weekday', kept: [{ workoutName: 'Push 1', weekday: 'monday', status: 'done' }, { workoutName: 'Pull 1', weekday: 'wednesday', status: 'in_progress' }] }).detail).toBe(
      "Monday's Push 1 is done, so it keeps its plan. Wednesday's Pull 1 is in progress, so it stays as it is. Your saved program, PPL, doesn't change.",
    )
    expect(ruleBoxText({ ...base, scheduleType: 'weekday', kept: [] }).detail).toBe("Your saved program, PPL, doesn't change.")
    const seq = ruleBoxText({ planningType: 'week_dependent', scheduleType: 'sequence', startWeek: 3, programName: 'Rotation', kept: [{ workoutName: 'Rotation A', status: 'done' }] })
    expect(seq.headline).toBe('Changes start in cycle 3. Sets are planned in each cycle, in Plan.')
    expect(seq.detail).toBe("Rotation A is done, so it keeps its plan. Your saved program, Rotation, doesn't change.")
    expect(ruleBoxText({ ...base, scheduleType: 'sequence', kept: [] }).headline).toBe('Changes start in cycle 3. Every cycle from then on copies this.')
  })
})

describe('the plan\'s own week number and the days card agree with each other', () => {
  it('rule box: the first session that has not started; days: the week after the current one', () => {
    const w = stableWorld()
    const { summary } = planOf(w, withDays(w, { friday: 'arms' }), { statuses: { 'p2-fb': 'done', 'p2-arms': 'done' } })
    expect(summary.startWeek).toBe(3)
    expect(summary.scheduleStartWeek).toBe(3)
    const half = planOf(w, withDays(w, { friday: 'arms' }), { statuses: { 'p2-fb': 'done' } }).summary
    expect([half.startWeek, half.scheduleStartWeek]).toEqual([2, 3]) // Arms of week 2 hasn't started: changes start in week 2, the days in week 3
    void editExercises
    void patchExercise
  })
})
