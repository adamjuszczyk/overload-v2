import { describe, it, expect, vi } from 'vitest'
import { addDays, format, parseISO } from 'date-fns'
import { schedule } from './scheduler'
import { scheduleForWeek as resolve } from '../programs/runSchedule'
import type {
  DayOfWeek,
  Mesocycle,
  Program,
  Session,
  WeekPlan,
  WeeklySchedule,
  WorkoutDay,
} from '../../types'

// Chunk 50 (SPEC [1.2] Programs and runs → "Weekdays storage"; Screens → Today: "it finds sessions by the weekdays in
// force that week"). `schedule()` asks which workout is on a weekday for a WEEK: the run's rows decide
// (`v2_run_schedules`: the row with the greatest from_week at or before the week, else the run copy's own schedule).
// The scenarios of scheduler.test.ts (no rows) are the proof that a run with no schedule change behaves as before; these
// are the rows' own, at the three places the scheduler used to read `program.schedule[dow]`: the missed-session scan,
// today's slot and the empty state's look-ahead.
//
// Every test resolves through the REAL resolver (runSchedule.ts), over rows that tell the right source from the wrong
// one: the run copy holds Saturday, which no row says, so a scheduler that reads the run copy (or ignores the rows)
// answers Saturday where the rows answer Tuesday or Wednesday; and week 3 is the row's own week, so a resolver that
// reads "before" the week instead of "at or before" answers Tuesday there.
//
// Dates are derived from a week number and a weekday, and each is proven to fall on that weekday (Checks that lied #21),
// never typed.

const MESO_MONDAY = parseISO('2026-08-24') // a Monday: week 1 is 08-24 .. 08-30, week 2 08-31 .. 09-06, week 3 09-07 .. 09-13
const DOW_INDEX: Record<DayOfWeek, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
}

/** The date of `day` in week `week` of the run (a run that started on a Monday), proven to be that weekday. */
function on(week: number, day: DayOfWeek): string {
  const date = addDays(MESO_MONDAY, (week - 1) * 7 + DOW_INDEX[day])
  expect(format(date, 'EEEE').toLowerCase(), `${format(date, 'yyyy-MM-dd')} is not a ${day}`).toBe(day)
  return format(date, 'yyyy-MM-dd')
}

const NONE: WeeklySchedule = {
  monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null,
}
const days = (over: Partial<WeeklySchedule>): WeeklySchedule => ({ ...NONE, ...over })

const wdPush: WorkoutDay = { id: 'wd-push', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const wdPull: WorkoutDay = { id: 'wd-pull', programId: 'prog-1', userId: 'user-1', name: 'Pull Day', position: 1, exercises: [] }
const wdFull: WorkoutDay = { id: 'wd-full', programId: 'prog-1', userId: 'user-1', name: 'Full Body', position: 0, exercises: [] }
const wdArms: WorkoutDay = { id: 'wd-arms', programId: 'prog-1', userId: 'user-1', name: 'Arms', position: 1, exercises: [] }

const TUESDAY = days({ tuesday: 'wd-push' }) // the days before the change
const WEDNESDAY = days({ wednesday: 'wd-push' }) // from week 3
const SATURDAY = days({ saturday: 'wd-push' }) // what the run copy holds in the fixture: no row says this
const ROWS = [
  { fromWeek: 1, schedule: TUESDAY },
  { fromWeek: 3, schedule: WEDNESDAY },
]

function makeProgram(runCopy: WeeklySchedule, workoutDays = [wdPush, wdPull]): Program {
  return {
    id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: runCopy, workoutDays,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run',
  }
}

const meso = (startDate = on(1, 'monday')): Mesocycle => ({
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
})

function makeSession(over: Partial<Session> & Pick<Session, 'date' | 'workoutDayId' | 'status'>): Session {
  return {
    id: `session-${over.date}-${over.workoutDayId}`, userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: null, note: null,
    startedAt: null, completedAt: null, createdAt: '2026-08-01T00:00:00Z', energyRating: null, pumpRating: null, ...over,
  }
}

const weekPlan = (weekNumber: number, workoutDayId: string): WeekPlan => ({
  id: `wp-${weekNumber}-${workoutDayId}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId, weekNumber,
  isDeload: false, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
})

/** The scheduler over the rows, with the run copy holding `runCopy`. `ask` receives every week the scheduler asks for. */
function run(
  today: string,
  opts: {
    rows?: ReadonlyArray<{ fromWeek: number; schedule: WeeklySchedule }>
    runCopy?: WeeklySchedule
    sessions?: Session[]
    dismissMissed?: boolean
    workoutDays?: WorkoutDay[]
    allWeekPlans?: WeekPlan[]
    startDate?: string
    ask?: (week: number) => void
  } = {},
) {
  const rows = opts.rows ?? ROWS
  const program = makeProgram(opts.runCopy ?? SATURDAY, opts.workoutDays ?? [wdPush, wdPull])
  return schedule(today, {
    activeMeso: meso(opts.startDate),
    programs: [program],
    workoutDays: opts.workoutDays ?? [wdPush, wdPull],
    currentWeekPlans: [],
    allWeekPlans: opts.allWeekPlans ?? [],
    sessions: opts.sessions ?? [],
    dismissMissed: opts.dismissMissed,
    scheduleForWeek: (week) => {
      opts.ask?.(week)
      return resolve(rows, program.schedule, week)
    },
  })
}

describe('the fixture dates are the weekdays they say (derived, then proven)', () => {
  it('week 2 and 3, Tuesday and Wednesday', () => {
    expect([on(2, 'tuesday'), on(2, 'wednesday'), on(3, 'tuesday'), on(3, 'wednesday')]).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-08', '2026-09-09',
    ])
  })
})

describe('today: the workout on today\'s weekday is the one in force this week', () => {
  it('week 2 (the row from week 1): Tuesday is due', () => {
    expect(run(on(2, 'tuesday'))).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: on(2, 'tuesday') })
  })

  it('week 2: Wednesday is not due (Tuesday done; the new Wednesday starts in week 3)', () => {
    const tuesdayDone = makeSession({ date: on(2, 'tuesday'), workoutDayId: 'wd-push', status: 'completed' })
    const result = run(on(2, 'wednesday'), { sessions: [tuesdayDone] })
    expect(result.type).toBe('rest_day')
  })

  it('week 3 (the row\'s own week): Wednesday is due', () => {
    expect(run(on(3, 'wednesday'))).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: on(3, 'wednesday') })
  })

  it('week 3: Tuesday is not due any more, and nothing is missed before it', () => {
    expect(run(on(3, 'tuesday')).type).toBe('rest_day')
  })

  it('week 1 reads the row from week 1 too, not the run copy', () => {
    expect(run(on(1, 'tuesday'))).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: on(1, 'tuesday') })
    expect(run(on(1, 'saturday'), { dismissMissed: true }).type).toBe('rest_day') // the run copy's Saturday is nobody's
  })

  it('a week past the last row keeps the last row\'s days', () => {
    expect(run(on(7, 'wednesday'))).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: on(7, 'wednesday') })
  })

  it('with no rows every week is the run copy\'s (a run nobody changed the days of)', () => {
    expect(run(on(2, 'saturday'), { rows: [] })).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: on(2, 'saturday') })
    expect(run(on(2, 'tuesday'), { rows: [], dismissMissed: true }).type).toBe('rest_day')
  })

  it('the run copy as 51b writes it (the newest days) does not make an older week read them', () => {
    // After a save the run copy holds the newest schedule (Wednesday), the rows hold the history.
    const tuesdayDone = makeSession({ date: on(2, 'tuesday'), workoutDayId: 'wd-push', status: 'completed' })
    expect(run(on(2, 'tuesday'), { runCopy: WEDNESDAY })).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: on(2, 'tuesday') })
    expect(run(on(2, 'wednesday'), { runCopy: WEDNESDAY, sessions: [tuesdayDone] }).type).toBe('rest_day')
    expect(run(on(3, 'wednesday'), { runCopy: WEDNESDAY })).toEqual({ type: 'suggest_no_plan', workoutDay: wdPush, date: on(3, 'wednesday') })
  })
})

describe('the missed-session prompt lists the days of the week it is in', () => {
  it('week 2: a missed Tuesday is listed, never a Wednesday', () => {
    const result = run(on(2, 'friday'))
    expect(result).toEqual({
      type: 'missed_sessions',
      queue: [{ date: on(2, 'tuesday'), weekPlan: null, workoutDay: wdPush, existingSessionId: null }],
    })
  })

  it('week 3: a missed Wednesday is listed, never the Tuesday', () => {
    const result = run(on(3, 'friday'))
    expect(result).toEqual({
      type: 'missed_sessions',
      queue: [{ date: on(3, 'wednesday'), weekPlan: null, workoutDay: wdPush, existingSessionId: null }],
    })
  })

  it('the missed day carries the plan of its own week', () => {
    const plans = [weekPlan(2, 'wd-push'), weekPlan(3, 'wd-push')]
    const result = run(on(3, 'friday'), { allWeekPlans: plans })
    if (result.type !== 'missed_sessions') throw new Error('unreachable')
    expect(result.queue.map((m) => m.weekPlan?.weekNumber)).toEqual([3])
  })

  it('a Tuesday handled in week 2 leaves nothing missed', () => {
    const tuesdayDone = makeSession({ date: on(2, 'tuesday'), workoutDayId: 'wd-push', status: 'completed' })
    expect(run(on(2, 'friday'), { sessions: [tuesdayDone] }).type).toBe('rest_day')
  })

  it('a Tuesday in week 3 was never due: only the Wednesday is missed, and handled it leaves nothing', () => {
    const result = run(on(3, 'thursday'))
    if (result.type !== 'missed_sessions') throw new Error(`expected the missed Wednesday, got ${result.type}`)
    expect(result.queue.map((m) => m.date)).toEqual([on(3, 'wednesday')])
    const wednesdayDone = makeSession({ date: on(3, 'wednesday'), workoutDayId: 'wd-push', status: 'completed' })
    expect(run(on(3, 'thursday'), { sessions: [wednesdayDone] }).type).toBe('rest_day')
  })
})

describe('the empty state\'s "next up" reads each day in its own week', () => {
  it('Sunday of week 2: the next session is week 3\'s Wednesday, not the Tuesday week 2 had', () => {
    const tuesdayDone = makeSession({ date: on(2, 'tuesday'), workoutDayId: 'wd-push', status: 'completed' })
    const result = run(on(2, 'sunday'), { sessions: [tuesdayDone] })
    expect(result).toEqual({ type: 'rest_day', next: { date: on(3, 'wednesday'), workoutDay: wdPush } })
  })

  it('Monday of week 3: the next session is that Wednesday', () => {
    expect(run(on(3, 'monday'))).toEqual({ type: 'rest_day', next: { date: on(3, 'wednesday'), workoutDay: wdPush } })
  })

  it('Thursday of week 2 (Tuesday done): nothing is left in week 2, so the next is week 3\'s Wednesday', () => {
    const tuesdayDone = makeSession({ date: on(2, 'tuesday'), workoutDayId: 'wd-push', status: 'completed' })
    const result = run(on(2, 'thursday'), { sessions: [tuesdayDone] })
    expect(result).toEqual({ type: 'rest_day', next: { date: on(3, 'wednesday'), workoutDay: wdPush } })
  })

  it('with no rows the look-ahead reads the run copy in every week (as before)', () => {
    const result = run(on(2, 'sunday'), { rows: [], runCopy: TUESDAY, dismissMissed: true })
    expect(result).toEqual({ type: 'rest_day', next: { date: on(3, 'tuesday'), workoutDay: wdPush } })
  })
})

describe('the seed\'s shared-workout shape (G14): Full Body on two days, then on three', () => {
  const BEFORE = days({ tuesday: 'wd-full', thursday: 'wd-full', saturday: 'wd-arms' })
  const FROM_WEEK_3 = days({ monday: 'wd-full', wednesday: 'wd-full', friday: 'wd-full', saturday: 'wd-arms' })
  const rows = [
    { fromWeek: 1, schedule: BEFORE },
    { fromWeek: 3, schedule: FROM_WEEK_3 },
  ]
  const workoutDays = [wdFull, wdArms]
  const opts = { rows, runCopy: FROM_WEEK_3, workoutDays }

  it('week 2: Tuesday and Thursday both give Full Body, Friday does not', () => {
    expect(run(on(2, 'tuesday'), opts)).toEqual({ type: 'suggest_no_plan', workoutDay: wdFull, date: on(2, 'tuesday') })
    const tuesdayDone = makeSession({ date: on(2, 'tuesday'), workoutDayId: 'wd-full', status: 'completed' })
    expect(run(on(2, 'thursday'), { ...opts, sessions: [tuesdayDone] })).toEqual({
      type: 'suggest_no_plan', workoutDay: wdFull, date: on(2, 'thursday'),
    })
    const thursdayDone = makeSession({ date: on(2, 'thursday'), workoutDayId: 'wd-full', status: 'completed' })
    expect(run(on(2, 'friday'), { ...opts, sessions: [tuesdayDone, thursdayDone] })).toEqual({
      type: 'rest_day', next: { date: on(2, 'saturday'), workoutDay: wdArms },
    })
  })

  it('week 3: Monday, Wednesday and Friday give Full Body, Tuesday and Thursday do not', () => {
    expect(run(on(3, 'monday'), opts)).toEqual({ type: 'suggest_no_plan', workoutDay: wdFull, date: on(3, 'monday') })
    expect(run(on(3, 'tuesday'), { ...opts, dismissMissed: true })).toEqual({
      type: 'rest_day', next: { date: on(3, 'wednesday'), workoutDay: wdFull },
    })
    expect(run(on(3, 'friday'), { ...opts, dismissMissed: true })).toEqual({
      type: 'suggest_no_plan', workoutDay: wdFull, date: on(3, 'friday'),
    })
  })

  it('week 3, Thursday, nothing done: the missed Monday and Wednesday, never the Tuesday', () => {
    const result = run(on(3, 'thursday'), opts)
    if (result.type !== 'missed_sessions') throw new Error('unreachable')
    expect(result.queue.map((m) => m.date)).toEqual([on(3, 'monday'), on(3, 'wednesday')])
  })
})

describe('a session moved in a week keeps the week\'s own days', () => {
  it('week 3: the Wednesday session moved to Friday is not re-suggested on Wednesday, and Friday lists it with its Wednesday date', () => {
    const moved = makeSession({ date: on(3, 'wednesday'), workoutDayId: 'wd-push', status: 'planned', movedToDate: on(3, 'friday') })
    expect(run(on(3, 'wednesday'), { sessions: [moved] }).type).toBe('rest_day')
    expect(run(on(3, 'friday'), { sessions: [moved] })).toEqual({ type: 'planned', session: moved, weekPlan: null, workoutDay: wdPush })
  })
})

describe('the weeks the scheduler asks for come from the dates it asks about', () => {
  const asked = (today: string, opts: Parameters<typeof run>[1] = {}) => {
    const weeks: number[] = []
    run(today, { ...opts, ask: (w) => weeks.push(w) })
    return [...new Set(weeks)].sort((a, b) => a - b)
  }

  it('today and the missed days of this week: this week only', () => {
    expect(asked(on(3, 'friday'))).toEqual([3])
  })

  it('the look-ahead from a Sunday reaches into the next week, and only into it', () => {
    const tuesdayDone = makeSession({ date: on(2, 'tuesday'), workoutDayId: 'wd-push', status: 'completed' })
    expect(asked(on(2, 'sunday'), { sessions: [tuesdayDone] })).toEqual([2, 3])
  })

  it('weeks are Monday-anchored calendar weeks from the run\'s start, not blocks of seven days', () => {
    // A run that started on a Wednesday: the Sunday after is still week 1, the Monday after it is week 2.
    const startedWednesday = on(1, 'wednesday')
    expect(asked(on(1, 'sunday'), { startDate: startedWednesday, dismissMissed: true })).toEqual([1, 2])
    expect(asked(on(2, 'monday'), { startDate: startedWednesday, dismissMissed: true })).toEqual([2])
    // Week 2 is 08-31 .. 09-06 though only five days after the start.
    expect(run(on(2, 'tuesday'), { startDate: startedWednesday, rows: [{ fromWeek: 2, schedule: TUESDAY }] })).toEqual({
      type: 'suggest_no_plan', workoutDay: wdPush, date: on(2, 'tuesday'),
    })
  })
})

describe('the resolver is required (an omission would give the run copy\'s days, plausibly and wrongly)', () => {
  const baseInput = () => ({
    activeMeso: meso(), programs: [makeProgram(SATURDAY)], workoutDays: [wdPush, wdPull],
    currentWeekPlans: [] as WeekPlan[], allWeekPlans: [] as WeekPlan[], sessions: [] as Session[],
  })

  it('a call without it is refused at run time, before anything else is decided', () => {
    // @ts-expect-error scheduleForWeek is required: tsc refuses a call that leaves it out (checked by `npm run typecheck`)
    expect(() => schedule(on(2, 'tuesday'), baseInput())).toThrow(TypeError)
    // @ts-expect-error the same with nothing to schedule: the refusal does not depend on what the rest of the input says
    expect(() => schedule(on(2, 'tuesday'), { ...baseInput(), programs: [] })).toThrow(TypeError)
  })

  it('a value that is not a function is refused too', () => {
    expect(() => schedule(on(2, 'tuesday'), { ...baseInput(), scheduleForWeek: SATURDAY as never })).toThrow(TypeError)
  })

  it('a function that answers is used for every ask (a spy sees each week the scheduler read)', () => {
    const spy = vi.fn((week: number) => resolve(ROWS, SATURDAY, week))
    schedule(on(2, 'tuesday'), { ...baseInput(), scheduleForWeek: spy })
    expect(spy).toHaveBeenCalledWith(2)
  })
})
