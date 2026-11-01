import { describe, it, expect } from 'vitest'
import { format, parseISO } from 'date-fns'
import type { WeekPlan, WeeklySchedule } from '../../types'
import { stage } from '../plan/weekPlanning.testutil'
import { DAYS, LEGS, NO_DAYS, PULL, SCHEDULE, session } from './programHistory.testutil'
import type { Spec } from './programHistory.testutil'
import {
  buildProgramHistory,
  daysLabel,
  exerciseMeta,
  finishedHeaderLine,
  openingWeek,
} from './programHistory'
import type { HistoryInput, ProgramHistory } from './programHistory'

// Chunk 66: a finished program's week-by-week structure (TASKS-1.2 "A finished program"; SPEC Defaults 11; board PR14), pure. The fixtures are the real
// app types (`WeekPlan` and its parts, from chunk 42's builders), so what the screen reads from `useAllWeekPlans` fits without a cast.
//
// The board's own example is the world of most tests: Pull 1 (Lat Pulldown, Seated Cable Row, EZ Bar Curl, Straight-Arm Pulldown), Legs and Push.
// Every rule is asserted through `buildProgramHistory`, which is what the screen calls; the small helpers (`exerciseMeta` and the header) are the
// words the screen prints, asserted as printed. (PR15's confirm text went in chunk 75: `fullDeleteText.test.ts`.)

function history(plans: WeekPlan[], over: Partial<HistoryInput> = {}): ProgramHistory {
  return buildProgramHistory({ plans, workoutDays: DAYS, unit: 'week', scheduleFor: () => SCHEDULE, ...over })
}
const week = (h: ProgramHistory, n: number) => h.weeks.find((w) => w.week === n)!
const card = (h: ProgramHistory, n: number, workout: string) => week(h, n).workouts.find((w) => w.name === workout)!

describe('fixture dates (printed, Checks that lied #21)', () => {
  it('the run of the examples below starts on a Monday and ends on a Sunday', () => {
    expect(['2026-07-06', '2026-09-13'].map((d) => `${d} ${format(parseISO(d), 'EEEE')}`)).toEqual(['2026-07-06 Monday', '2026-09-13 Sunday'])
  })
})

describe('the words of an exercise row (board PR14)', () => {
  it('"3 SETS · 1 DROPSET", "1 WARMUP · 2 SETS", "A1 · 3 SETS", and the singular and plural forms', () => {
    expect(exerciseMeta({ superset: null, warmups: 0, kinds: ['normal', 'normal', 'dropset'] })).toBe('3 SETS · 1 DROPSET')
    expect(exerciseMeta({ superset: null, warmups: 1, kinds: ['normal', 'normal'] })).toBe('1 WARMUP · 2 SETS')
    expect(exerciseMeta({ superset: 'A1', warmups: 0, kinds: ['normal', 'normal', 'normal'] })).toBe('A1 · 3 SETS')
    expect(exerciseMeta({ superset: null, warmups: 2, kinds: ['normal'] })).toBe('2 WARMUPS · 1 SET')
    expect(exerciseMeta({ superset: 'B2', warmups: 1, kinds: ['normal', 'dropset', 'dropset', 'rest_pause', 'myo_reps', 'myo_reps', 'cluster'] })).toBe(
      'B2 · 1 WARMUP · 7 SETS · 2 DROPSETS · 1 REST-PAUSE · 2 MYO-REPS · 1 CLUSTER',
    )
  })

  it('an exercise with no sets says so (ours)', () => {
    expect(exerciseMeta({ superset: null, warmups: 0, kinds: [] })).toBe('NO SETS')
    expect(exerciseMeta({ superset: null, warmups: 1, kinds: [] })).toBe('1 WARMUP · NO SETS')
  })
})

describe('what a row counts: sets are heads, warmups are counted apart, a stage is never a set', () => {
  it('a set with two stages is one set, a warmup is not a set, and a head with stages and no stored kind is a dropset', () => {
    const h = history([
      session(1, 'pull-1', [
        { ex: 'lat', sets: 3, staged: { 3: 'dropset' } },
        { ex: 'curl', sets: 2, warmups: 1 },
        { ex: 'row', sets: 3, staged: { 1: null, 2: 'rest_pause' } },
      ]),
    ])
    const rows = card(h, 1, 'Pull 1').rows
    expect(rows.map((r) => [r.name, r.meta])).toEqual([
      ['Lat Pulldown', '3 SETS · 1 DROPSET'],
      ['EZ Bar Curl', '1 WARMUP · 2 SETS'],
      ['Seated Cable Row', '3 SETS · 1 DROPSET · 1 REST-PAUSE'],
    ])
  })

  it('a second stage row on the same head changes nothing (stages never count)', () => {
    const base = session(1, 'pull-1', [{ ex: 'lat', sets: 3, staged: { 3: 'dropset' } }])
    const moreStages = { ...base, sets: [...base.sets, stage('lat-d2', 'pull-1-lat-s3', 'pull-1-lat', 2, { setNumber: 3 })] }
    expect(card(history([moreStages]), 1, 'Pull 1').rows[0].meta).toBe('3 SETS · 1 DROPSET')
  })

  it('a warmup added is a change of its own, never a change of the set count', () => {
    const h = history([
      session(1, 'pull-1', [{ ex: 'lat', sets: 3 }]),
      session(2, 'pull-1', [{ ex: 'lat', sets: 3, warmups: 2 }]),
    ])
    expect(week(h, 2).changes.map((c) => c.text)).toEqual(['Lat Pulldown: 0 → 2 warmup sets'])
  })
})

describe('each week is compared with the week before', () => {
  // Week 2 differs from week 1; weeks 3 and 4 are week 2 again; week 5 has a dropset: so week 1 is the wrong thing to compare 3 and 4 with.
  const plans = [
    session(1, 'pull-1', PULL),
    session(2, 'pull-1', [{ ex: 'lat', sets: 4 }, ...PULL.slice(1)]),
    session(3, 'pull-1', [{ ex: 'lat', sets: 4 }, ...PULL.slice(1)]),
    session(4, 'pull-1', [{ ex: 'lat', sets: 4 }, ...PULL.slice(1)]),
    session(5, 'pull-1', [{ ex: 'lat', sets: 4, staged: { 3: 'dropset' } }, ...PULL.slice(1, 3)]),
  ]

  it('a week the same as the one before has no dot and no change, however far it is from week 1', () => {
    const h = history(plans)
    expect(h.weeks.map((w) => [w.week, w.changed])).toEqual([[1, false], [2, true], [3, false], [4, false], [5, true]])
    expect(week(h, 3).changes).toEqual([])
    expect(week(h, 3).title).toBe('Same as week 2')
    expect(card(h, 3, 'Pull 1').tag).toBe('NO CHANGES')
  })

  it('week 5: a dropset made of set 3 and an exercise removed give a "~" and a "−" item, a dot and the board\'s title', () => {
    const w = week(history(plans), 5)
    expect(w.title).toBe('Changed from week 4')
    expect(w.changes).toEqual([
      { sign: '~', text: 'Lat Pulldown set 3 is now a dropset', where: 'PULL 1' },
      { sign: '−', text: 'Straight-Arm Pulldown removed', where: 'PULL 1' },
    ])
    expect(w.changed).toBe(true)
  })

  it('week 1 started from the program: no comparison, no change, no dot', () => {
    const w = week(history(plans), 1)
    expect(w.title).toBe('Started from the program')
    expect(w.changes).toEqual([])
    expect(w.changed).toBe(false)
    expect(card(history(plans), 1, 'Pull 1').tag).toBe('NO CHANGES')
  })

  it('a week nobody planned is not a tile, and the week after it is compared with the last planned one', () => {
    const h = history([session(1, 'pull-1', PULL), session(2, 'pull-1', PULL), session(4, 'pull-1', [{ ex: 'lat', sets: 5 }, ...PULL.slice(1)])])
    expect(h.weeks.map((w) => w.week)).toEqual([1, 2, 4])
    expect(week(h, 4).title).toBe('Changed from week 2')
    expect(week(h, 4).changes.map((c) => c.text)).toEqual(['Lat Pulldown: 3 → 5 sets'])
  })

  it('a workout is compared with the same workout, never with another one of the week before', () => {
    const h = history([
      session(1, 'pull-1', PULL),
      session(1, 'legs', LEGS),
      session(2, 'pull-1', PULL),
      session(2, 'legs', [{ ex: 'squat', warmups: 1, sets: 4 }, ...LEGS.slice(1)]),
    ])
    expect(card(h, 2, 'Pull 1').tag).toBe('NO CHANGES')
    expect(card(h, 2, 'Legs').tag).toBe('1 CHANGE')
    expect(week(h, 2).changes).toEqual([{ sign: '~', text: 'Back Squat: 3 → 4 sets', where: 'LEGS' }])
  })
})

describe('the set count and the set kinds', () => {
  it('"3 → 4 sets" for a count change, singular for a count of one', () => {
    const h = history([session(1, 'pull-1', [{ ex: 'lat', sets: 3 }, { ex: 'row', sets: 2 }]), session(2, 'pull-1', [{ ex: 'lat', sets: 4 }, { ex: 'row', sets: 1 }])])
    expect(week(h, 2).changes.map((c) => c.text)).toEqual(['Lat Pulldown: 3 → 4 sets', 'Seated Cable Row: 2 → 1 set'])
  })

  it('a set of another kind says which set and what it is now, for each kind the planner has', () => {
    const before = session(1, 'pull-1', [{ ex: 'lat', sets: 4 }])
    const kinds: Array<[Spec['staged'], string[]]> = [
      [{ 2: 'dropset' }, ['Lat Pulldown set 2 is now a dropset']],
      [{ 2: 'rest_pause' }, ['Lat Pulldown set 2 is now a rest-pause set']],
      [{ 2: 'myo_reps', 4: 'cluster' }, ['Lat Pulldown set 2 is now a myo-reps set', 'Lat Pulldown set 4 is now a cluster set']],
      [{ 3: null }, ['Lat Pulldown set 3 is now a dropset']],
    ]
    for (const [staged, texts] of kinds) {
      const h = history([before, session(2, 'pull-1', [{ ex: 'lat', sets: 4, staged }])])
      expect(week(h, 2).changes.map((c) => c.text)).toEqual(texts)
    }
  })

  it('a dropset made a plain set again says so', () => {
    const h = history([session(1, 'pull-1', [{ ex: 'lat', staged: { 3: 'dropset' } }]), session(2, 'pull-1', [{ ex: 'lat' }])])
    expect(week(h, 2).changes.map((c) => c.text)).toEqual(['Lat Pulldown set 3 is now a normal set'])
  })

  it('the kind is compared among the working sets, so a warmup in front shifts no number', () => {
    const h = history([
      session(1, 'pull-1', [{ ex: 'lat', staged: { 3: 'dropset' } }]),
      session(2, 'pull-1', [{ ex: 'lat', staged: { 3: 'dropset' }, warmups: 1 }]),
    ])
    expect(week(h, 2).changes.map((c) => c.text)).toEqual(['Lat Pulldown: 0 → 1 warmup set'])
  })

  it('the number of drops in a staged set is not a change (SPEC: exercises, order, set counts and set kinds)', () => {
    const one = session(1, 'pull-1', [{ ex: 'lat', staged: { 3: 'dropset' } }])
    const two = session(2, 'pull-1', [{ ex: 'lat', staged: { 3: 'dropset' } }])
    const h = history([one, { ...two, sets: [...two.sets, stage('extra', 'pull-1-lat-s3', 'pull-1-lat', 2, { setNumber: 3 })] }])
    expect(week(h, 2).changed).toBe(false)
  })
})

describe('exercises added, removed and moved', () => {
  it('added is "+", removed is "−" with a ghost row after the others, and each is on its card', () => {
    const h = history([session(1, 'pull-1', PULL), session(2, 'pull-1', [{ ex: 'lat' }, { ex: 'row' }, { ex: 'face', sets: 2 }, { ex: 'curl', warmups: 1, sets: 2 }])])
    expect(week(h, 2).changes).toEqual([
      { sign: '+', text: 'Face Pull added', where: 'PULL 1' },
      { sign: '−', text: 'Straight-Arm Pulldown removed', where: 'PULL 1' },
    ])
    const rows = card(h, 2, 'Pull 1').rows
    expect(rows.map((r) => [r.number, r.name, r.meta, r.state])).toEqual([
      ['01', 'Lat Pulldown', '3 SETS', 'same'],
      ['02', 'Seated Cable Row', '3 SETS', 'same'],
      ['03', 'Face Pull', '2 SETS', 'changed'],
      ['04', 'EZ Bar Curl', '1 WARMUP · 2 SETS', 'same'],
      ['—', 'Straight-Arm Pulldown', 'REMOVED', 'removed'],
    ])
    expect(card(h, 2, 'Pull 1').tag).toBe('2 CHANGES')
  })

  it('board PR14, week 4: Pull 1 lists what was added, then what changed, then what was removed, whatever order the exercises are in; its card reads "3 CHANGES"', () => {
    const before = session(3, 'pull-1', PULL)
    // Lat Pulldown (first) changes, Face Pull (third) is added, Straight-Arm Pulldown (the last of the week before) is gone; Seated Cable Row and
    // Face Pull are now a superset, which is no change and, since 1.2.1 (SPEC [20], DECISIONS 193 (a)), no label on their rows either
    const after = session(4, 'pull-1', [{ ex: 'lat', staged: { 3: 'dropset' } }, { ex: 'row', block: 'b' }, { ex: 'face', sets: 2, block: 'b' }, PULL[2]])
    const h = history([before, after])
    expect(week(h, 4).changes.map((c) => `${c.sign} ${c.text}`)).toEqual(['+ Face Pull added', '~ Lat Pulldown set 3 is now a dropset', '− Straight-Arm Pulldown removed'])
    expect(card(h, 4, 'Pull 1').tag).toBe('3 CHANGES')
    expect(card(h, 4, 'Pull 1').rows.map((r) => [r.number, r.name, r.meta, r.state])).toEqual([
      ['01', 'Lat Pulldown', '3 SETS · 1 DROPSET', 'changed'],
      ['02', 'Seated Cable Row', '3 SETS', 'same'],
      ['03', 'Face Pull', '2 SETS', 'changed'],
      ['04', 'EZ Bar Curl', '1 WARMUP · 2 SETS', 'same'],
      ['—', 'Straight-Arm Pulldown', 'REMOVED', 'removed'],
    ])
  })

  it('a swap is the old exercise removed and the new one added', () => {
    const h = history([session(1, 'legs', LEGS), session(2, 'legs', [{ ex: 'squat', warmups: 1 }, { ex: 'rdl' }, { ex: 'bench', rowId: 'legs-new-row' }, { ex: 'calf', sets: 2 }])])
    expect(week(h, 2).changes.map((c) => `${c.sign} ${c.text}`)).toEqual(['+ Bench Press added', '− Leg Extension removed'])
  })

  it('an exercise twice in a workout pairs up in order: removing the second one is one removal, not two changes', () => {
    const twice = (n: number) => session(n, 'push-1', [{ ex: 'bench', rowId: 'a' }, { ex: 'incline' }, { ex: 'bench', rowId: 'b', sets: 2 }].slice(0, n === 1 ? 3 : 2))
    const h = history([twice(1), twice(2)])
    expect(week(h, 2).changes.map((c) => `${c.sign} ${c.text}`)).toEqual(['− Bench Press removed'])
  })

  it('an exercise moved: "Leg Extension moved before Back Squat" (board PR14), once, not for each exercise it passed', () => {
    const h = history([session(1, 'legs', LEGS), session(2, 'legs', [LEGS[2], LEGS[0], LEGS[1], LEGS[3]])])
    expect(week(h, 2).changes).toEqual([{ sign: '~', text: 'Leg Extension moved before Back Squat', where: 'LEGS' }])
    expect(card(h, 2, 'Legs').rows.map((r) => [r.name, r.state])).toEqual([['Leg Extension', 'changed'], ['Back Squat', 'same'], ['Romanian Deadlift', 'same'], ['Standing Calf Raise', 'same']])
  })

  it('two neighbours that swapped places are one move, and one moved to the end says so', () => {
    const swap = history([session(1, 'push-1', [{ ex: 'bench' }, { ex: 'incline' }]), session(2, 'push-1', [{ ex: 'incline' }, { ex: 'bench' }])])
    expect(week(swap, 2).changes.map((c) => c.text)).toEqual(['Incline Dumbbell Press moved before Bench Press'])
    const last = history([session(1, 'legs', LEGS), session(2, 'legs', [LEGS[1], LEGS[2], LEGS[3], LEGS[0]])])
    expect(week(last, 2).changes.map((c) => c.text)).toEqual(['Back Squat moved to the end'])
  })

  it('an exercise added or removed moves nobody else', () => {
    const h = history([session(1, 'legs', LEGS), session(2, 'legs', [{ ex: 'face' }, ...LEGS.slice(1)])])
    expect(week(h, 2).changes.map((c) => `${c.sign} ${c.text}`)).toEqual(['+ Face Pull added', '− Back Squat removed'])
  })
})

describe('what a week stores and what it does not: tempo and supersets never make a change (SPEC Defaults 11)', () => {
  it('a tempo that differs and a superset that was linked since the week before: no item, no dot, "NO CHANGES"', () => {
    const before = session(1, 'pull-1', [{ ex: 'lat' }, { ex: 'row' }, { ex: 'face', sets: 2 }, { ex: 'rdl', tempo: null }])
    const after = session(2, 'pull-1', [{ ex: 'lat' }, { ex: 'row', block: 'blk-1' }, { ex: 'face', sets: 2, block: 'blk-1' }, { ex: 'rdl', tempo: '3-1-1-0' }])
    const h = history([before, after])
    expect(week(h, 2).changes).toEqual([])
    expect(week(h, 2).changed).toBe(false)
    expect(card(h, 2, 'Pull 1').tag).toBe('NO CHANGES')
  })

  it('a tempo is not printed on a row either (TASKS: "tempo and supersets never appear in the change list"; the board draws "TEMPO 3-1-1-0", the spec wins)', () => {
    const h = history([session(1, 'legs', [{ ex: 'rdl', tempo: '3-1-1-0' }])])
    expect(card(h, 1, 'Legs').rows[0].meta).toBe('3 SETS')
  })

  // Chunk 76 (SPEC 1.2.1 Finished program [20], DECISIONS 193 (a)): a superset is stored once for the run, so a label on every week could show one in
  // the weeks before it was made. Chunk 66's "A1", "A2", "B1" are gone: `structureOf` gives every row `superset: null`.
  it('exercises in a superset carry no label on their rows (a two-member block, and a second block beside it)', () => {
    const h = history([session(1, 'pull-1', [{ ex: 'lat', block: 'b1' }, { ex: 'row', block: 'b1' }, { ex: 'face', sets: 2 }, { ex: 'curl', block: 'b2', sets: 2 }, { ex: 'sap', block: 'b2', sets: 2 }])])
    expect(card(h, 1, 'Pull 1').rows.map((r) => r.meta)).toEqual(['3 SETS', '3 SETS', '2 SETS', '2 SETS', '2 SETS'])
    expect(card(h, 1, 'Pull 1').rows.some((r) => /\b[A-Z][12]\b/.test(r.meta))).toBe(false)
  })

  it('a superset linked in a later week reads the same in every week before and after it: no label in any, and no change item for it', () => {
    const h = history([
      session(1, 'pull-1', [{ ex: 'lat' }, { ex: 'row' }]),
      session(2, 'pull-1', [{ ex: 'lat', block: 'b1' }, { ex: 'row', block: 'b1' }]),
    ])
    for (const n of [1, 2]) expect(card(h, n, 'Pull 1').rows.map((r) => r.meta)).toEqual(['3 SETS', '3 SETS'])
    expect(week(h, 2).changes).toEqual([])
  })

  it('a block that has only one member left in the list is not a superset (no label)', () => {
    const h = history([session(1, 'pull-1', [{ ex: 'lat', block: 'b1' }, { ex: 'row' }])])
    expect(card(h, 1, 'Pull 1').rows.map((r) => r.meta)).toEqual(['3 SETS', '3 SETS'])
  })
})

describe('the same change in two workouts is one item, naming both (board PR14: "PUSH 1 · PUSH 2")', () => {
  const plans = [
    session(1, 'push-1', [{ ex: 'incline', sets: 3 }]),
    session(1, 'push-2', [{ ex: 'incline', sets: 3 }]),
    session(1, 'pull-1', PULL),
    session(2, 'push-1', [{ ex: 'incline', sets: 4 }]),
    session(2, 'push-2', [{ ex: 'incline', sets: 4 }]),
    session(2, 'pull-1', [{ ex: 'lat', sets: 3, staged: { 3: 'dropset' } }, ...PULL.slice(1)]),
  ]

  it('one item for both, in the order the workouts come, and the cards each count their own', () => {
    const h = history(plans)
    expect(week(h, 2).changes).toEqual([
      { sign: '~', text: 'Incline Dumbbell Press: 3 → 4 sets', where: 'PUSH 1 · PUSH 2' },
      { sign: '~', text: 'Lat Pulldown set 3 is now a dropset', where: 'PULL 1' },
    ])
    expect(week(h, 2).workouts.map((w) => [w.name, w.tag])).toEqual([['Push 1', '1 CHANGE'], ['Pull 1', '1 CHANGE'], ['Push 2', '1 CHANGE']])
  })
})

describe('the tiles: WK, DL and a dot', () => {
  it('a week with every planned session marked deload is DL and counted; a week with only one of its sessions marked is not', () => {
    const h = history([
      session(1, 'pull-1', PULL),
      session(1, 'legs', LEGS),
      session(2, 'pull-1', PULL, { isDeload: true }),
      session(2, 'legs', LEGS, { isDeload: true }),
      session(3, 'pull-1', PULL, { isDeload: true }),
      session(3, 'legs', LEGS),
    ])
    expect(h.weeks.map((w) => [w.week, w.top, w.deload])).toEqual([[1, 'WK', false], [2, 'DL', true], [3, 'WK', false]])
    expect(h.deloads).toBe(1)
    expect(week(h, 2).label).toBe('WEEK 2 · DELOAD')
    expect(week(h, 3).label).toBe('WEEK 3')
  })

  it('the board: ten weeks, week 7 the deload, a dot on 3, 4 and 8', () => {
    const plans: WeekPlan[] = []
    for (let n = 1; n <= 10; n++) {
      const lat = n >= 3 ? 4 : 3
      const pull: Spec[] = n >= 4 ? [{ ex: 'lat', sets: lat, staged: { 3: 'dropset' } }, ...PULL.slice(1, 3)] : [{ ex: 'lat', sets: lat }, ...PULL.slice(1)]
      const legs: Spec[] = n >= 8 ? [LEGS[2], LEGS[0], LEGS[1], LEGS[3]] : LEGS
      plans.push(session(n, 'pull-1', pull, { isDeload: n === 7 }), session(n, 'legs', legs, { isDeload: n === 7 }))
    }
    const h = history(plans)
    expect(h.weeks.map((w) => `${w.top}${w.week}${w.changed ? '*' : ''}`)).toEqual(['WK1', 'WK2', 'WK3*', 'WK4*', 'WK5', 'WK6', 'DL7', 'WK8*', 'WK9', 'WK10'])
    expect(h.deloads).toBe(1)
  })

  it('a run with no planned week has no tiles', () => {
    expect(history([])).toEqual({ weeks: [], deloads: 0 })
    expect(openingWeek(history([]))).toBeNull()
  })

  // Chunk 76 (SPEC 1.2.1 Finished program [25], Adam 2026-10-29): it opens on week 1, not on the first week whose structure changed (chunk 66's pick).
  it('it opens on its first week, whichever week first changed: week 1 when its first changed week is 3', () => {
    const h = history([session(1, 'pull-1', PULL), session(2, 'pull-1', PULL), session(3, 'pull-1', [{ ex: 'lat', sets: 5 }]), session(4, 'pull-1', PULL)])
    expect(h.weeks.filter((w) => w.changed).map((w) => w.week)).toEqual([3, 4]) // the fixture does what it says: a later week is the first one that changed
    expect(openingWeek(h)).toBe(1)
  })

  it('a run whose first planned week is 2 opens on 2 (the first week it has), and a run of one week on that week', () => {
    expect(openingWeek(history([session(2, 'pull-1', PULL), session(3, 'pull-1', [{ ex: 'lat', sets: 5 }])]))).toBe(2)
    expect(openingWeek(history([session(1, 'pull-1', PULL)]))).toBe(1)
  })

  it('the plans arrive in any order and the first week is the first tile (the weeks are sorted by number)', () => {
    expect(openingWeek(history([session(4, 'pull-1', PULL), session(3, 'pull-1', PULL), session(1, 'pull-1', PULL)]))).toBe(1)
  })
})

describe('the cards: one per workout, in the program\'s order, with the days the week had', () => {
  it('a card names the weekday or weekdays the workout was on that week, from the schedule in force that week', () => {
    // week 2: Pull 1 moved to Wednesday, Push 1 shares Monday, Thursday and Friday
    const week2: WeeklySchedule = { ...NO_DAYS, monday: 'push-1', wednesday: 'pull-1', thursday: 'push-1', friday: 'push-1' }
    const h = history(
      [session(1, 'pull-1', PULL), session(1, 'push-1', [{ ex: 'bench' }]), session(2, 'pull-1', PULL), session(2, 'push-1', [{ ex: 'bench' }])],
      { scheduleFor: (w) => (w === 1 ? SCHEDULE : week2) },
    )
    expect(week(h, 1).workouts.map((w) => [w.name, w.dayLabel])).toEqual([['Push 1', 'MONDAY'], ['Pull 1', 'TUESDAY']])
    expect(week(h, 2).workouts.map((w) => [w.name, w.dayLabel])).toEqual([['Push 1', 'MON · THU · FRI'], ['Pull 1', 'WEDNESDAY']])
  })

  it('a workout on no weekday that week has no day line, and a run with no schedule given has none at all', () => {
    expect(card(history([session(1, 'pull-1', PULL)], { scheduleFor: () => NO_DAYS }), 1, 'Pull 1').dayLabel).toBeNull()
    expect(card(history([session(1, 'pull-1', PULL)], { scheduleFor: undefined }), 1, 'Pull 1').dayLabel).toBeNull()
  })

  it('days are named in full for one and short for several, in week order', () => {
    expect(daysLabel([])).toBeNull()
    expect(daysLabel(['saturday'])).toBe('SATURDAY')
    expect(daysLabel(['monday', 'thursday', 'friday'])).toBe('MON · THU · FRI')
  })

  it('cards are in the program\'s workout order, not the order the plans came in', () => {
    const h = history([session(1, 'legs', LEGS), session(1, 'pull-1', PULL), session(1, 'push-1', [{ ex: 'bench' }])])
    expect(week(h, 1).workouts.map((w) => w.name)).toEqual(['Push 1', 'Pull 1', 'Legs'])
  })
})

describe('a sequence run: cycles, and each slot is compared with the same slot', () => {
  const sequence = (n: number, lat: number) => [
    session(n, 'pull-1', [{ ex: 'lat', sets: 3 }], { sequencePosition: 0 }),
    session(n, 'legs', LEGS, { sequencePosition: 1 }),
    session(n, 'pull-1', [{ ex: 'lat', sets: lat }], { sequencePosition: 2 }),
  ]

  it('says cycle and CY, and "SLOT n" counted from 1, for slots the app numbers from 0', () => {
    const h = history([...sequence(1, 3), ...sequence(2, 4)], { unit: 'cycle', scheduleFor: undefined })
    expect(h.weeks.map((w) => [w.top, w.label, w.title])).toEqual([['CY', 'CYCLE 1', 'Started from the program'], ['CY', 'CYCLE 2', 'Changed from cycle 1']])
    expect(week(h, 2).structureLabel).toBe('CYCLE 2 · STRUCTURE')
    expect(week(h, 1).workouts.map((w) => w.dayLabel)).toEqual(['SLOT 1', 'SLOT 2', 'SLOT 3'])
  })

  it('a workout in two slots changes in one of them only: the other slot is not the one compared', () => {
    const h = history([...sequence(1, 3), ...sequence(2, 4)], { unit: 'cycle', scheduleFor: undefined })
    expect(week(h, 2).workouts.map((w) => [w.dayLabel, w.tag])).toEqual([['SLOT 1', 'NO CHANGES'], ['SLOT 2', 'NO CHANGES'], ['SLOT 3', '1 CHANGE']])
    expect(week(h, 2).changes).toEqual([{ sign: '~', text: 'Lat Pulldown: 3 → 4 sets', where: 'PULL 1' }])
  })
})

describe('no dependence on the order the rows come in', () => {
  it('plans, exercise rows and set rows reversed give the same history', () => {
    const plans = [
      session(1, 'pull-1', PULL),
      session(1, 'legs', LEGS),
      session(2, 'pull-1', [{ ex: 'lat', sets: 4, staged: { 3: 'dropset' }, block: 'b' }, { ex: 'row', block: 'b' }, { ex: 'curl', warmups: 1, sets: 2 }]),
      session(2, 'legs', [LEGS[2], LEGS[0], LEGS[1], LEGS[3]]),
    ]
    const reversed = [...plans].reverse().map((p) => ({ ...p, exercises: [...p.exercises].reverse(), sets: [...p.sets].reverse() }))
    expect(history(reversed)).toEqual(history(plans))
  })
})

describe('the header and the confirm (boards PR14 and PR15)', () => {
  const RUN = { name: 'Cut PPL', startDate: '2026-07-06', endDate: '2026-09-13' }

  it('"Jul 6 → Sep 13, 2026 · 10 weeks · 1 deload": the weeks are calendar weeks, Monday-anchored, and the year is said once', () => {
    expect(finishedHeaderLine(RUN, 1)).toBe('Jul 6 → Sep 13, 2026 · 10 weeks · 1 deload')
    expect(finishedHeaderLine({ startDate: '2026-07-06', endDate: '2026-07-12' }, 0)).toBe('Jul 6 → Jul 12, 2026 · 1 week')
    // Mon 2026-12-28 to Sun 2027-01-17: the weeks of Dec 28, Jan 4 and Jan 11, across the year
    expect(['2026-12-28', '2027-01-17'].map((d) => format(parseISO(d), 'EEEE'))).toEqual(['Monday', 'Sunday'])
    expect(finishedHeaderLine({ startDate: '2026-12-28', endDate: '2027-01-17' }, 2)).toBe('Dec 28, 2026 → Jan 17, 2027 · 3 weeks · 2 deloads')
  })

  it('a deload part is left out when there is none, and a run with no end date says only when it started', () => {
    expect(finishedHeaderLine(RUN, 0)).toBe('Jul 6 → Sep 13, 2026 · 10 weeks')
    expect(finishedHeaderLine({ startDate: '2026-07-06', endDate: null }, 0)).toBe('Jul 6, 2026')
  })
})
