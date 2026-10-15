import { describe, it, expect } from 'vitest'
import type { WeekPlan } from '../../types'
import {
  autoCopy,
  chooseAutoCopySource,
  plannedWeekRecords,
  weeksOfSlot,
  type AutoCopiedSet,
  type RunCopy,
  type RunCopyExercise,
} from './weekPlanning'
import { plan, pe, pset, wset, stage } from './weekPlanning.testutil'

// Chunk 42 — what a planned week takes from its source (SPEC, Weeks and copying → What the auto-copy takes (2b)):
// structure, volume and set types from the source; the default's rep targets on a stable week; never a weight, a
// RIR, a week-dependent week's reps (AMRAP included), tags or the deload flag. autoCopy is the twin of migration
// 044 (chunk 53); scripts/plan-week-parity.mjs runs it against 041's `v2_plan_week` on the replayed database.

// ─── The fixture: one workout, "Pull 1", as its run copy holds it ──────────────────────────────────────────────

const rc = (id: string, exerciseId: string, position: number, flags: Partial<RunCopyExercise> = {}): RunCopyExercise => ({
  id,
  exerciseId,
  position,
  ...flags,
})

// Lat Pulldown: a warmup (12), a working set (8–10), a dropset head (8–10) with one AMRAP drop; Face Pull ×2 (15–20).
// Also in the run copy but not in its default: a week-only exercise, a removed exercise, and a removed Face Pull set.
function runCopy(): RunCopy {
  return {
    exercises: [
      rc('pe-dip', 'dip', 4, { removedAt: '2026-10-01T00:00:00Z' }),
      rc('pe-face', 'face', 2),
      rc('pe-curl', 'curl', 3, { weekOnly: true }),
      rc('pe-lat', 'lat', 1),
    ],
    sets: [
      pset('ps-face-3', 'pe-face', 3, { repMin: 15, repMax: 20, removedAt: '2026-10-01T00:00:00Z' }),
      pset('ps-lat-d1', 'pe-lat', 3, { parentProgramSetId: 'ps-lat-d', stageIndex: 1, repMin: null, repMax: null, isAmrap: true }),
      pset('ps-lat-1', 'pe-lat', 2, { repMin: 8, repMax: 10 }),
      pset('ps-lat-w', 'pe-lat', 1, { isWarmup: true, repMin: 12, repMax: 12 }),
      pset('ps-lat-d', 'pe-lat', 3, { stageKind: 'dropset', repMin: 8, repMax: 10 }),
      pset('ps-face-1', 'pe-face', 1, { repMin: 15, repMax: 20 }),
      pset('ps-face-2', 'pe-face', 2, { repMin: 15, repMax: 20 }),
      pset('ps-curl-1', 'pe-curl', 1, { repMin: 10, repMax: 12 }),
      pset('ps-dip-1', 'pe-dip', 1, { repMin: 8, repMax: 12 }),
    ],
  }
}

// Week 1 of the same workout, as a user left it: the default's structure plus an added Face Pull set (no program
// set), every number filled, the working set's reps changed to 9–11, a cue, and the AMRAP drop.
function weekOne(over: Partial<WeekPlan> = {}): WeekPlan {
  return plan(
    1,
    [pe('pe-lat', 'lat', 0), pe('pe-face', 'face', 1)],
    [
      wset('w1-lat-w', 'pe-lat', 1, { isWarmup: true, programSetId: 'ps-lat-w', targetWeight: 20, targetRir: 5, repMin: 12, repMax: 12 }),
      wset('w1-lat-1', 'pe-lat', 2, { programSetId: 'ps-lat-1', targetWeight: 55, targetRir: 2, targetRirMax: 3, repMin: 9, repMax: 11, tags: ['push here'] }),
      wset('w1-lat-d', 'pe-lat', 3, { programSetId: 'ps-lat-d', stageKind: 'dropset', targetWeight: 55, targetRir: 2, repMin: 8, repMax: 10 }),
      stage('w1-lat-d1', 'w1-lat-d', 'pe-lat', 1, { programSetId: 'ps-lat-d1', targetWeight: 40, targetRir: 0, repMin: null, repMax: null, isAmrap: true }),
      wset('w1-face-1', 'pe-face', 1, { programSetId: 'ps-face-1', targetWeight: 15, targetRir: 1, repMin: 15, repMax: 20 }),
      wset('w1-face-2', 'pe-face', 2, { programSetId: 'ps-face-2', targetWeight: 15, targetRir: 1, repMin: 15, repMax: 20 }),
      wset('w1-face-3', 'pe-face', 3, { programSetId: null, targetWeight: 12.5, targetRir: 1, repMin: 15, repMax: 20 }),
    ],
    over,
  )
}

const byId = (rows: AutoCopiedSet[]) => new Map(rows.map((r) => [r.sourceId, r]))

// A stage's head is always written before it (a caller giving the rows their own ids needs the head's first).
function expectStagesAfterTheirHeads(rows: AutoCopiedSet[]): void {
  rows.forEach((row, i) => {
    if (row.parentSourceId === null) return
    expect(rows.findIndex((r) => r.sourceId === row.parentSourceId)).toBeGreaterThanOrEqual(0)
    expect(rows.findIndex((r) => r.sourceId === row.parentSourceId)).toBeLessThan(i)
  })
}

// ─── Which source ──────────────────────────────────────────────────────────────────────────────────────────────

describe('chooseAutoCopySource — week 1 and a stable week start from the program; a week-dependent week from last week', () => {
  const prior = (...entries: Array<[number, boolean, boolean?]>) =>
    entries.map(([weekNumber, isDeload, isEmpty = false]) => ({ weekNumber, isDeload, isEmpty }))

  it('week 1 of any run starts from the program, even with a week already planned', () => {
    expect(chooseAutoCopySource({ planningType: 'week_dependent', weekNumber: 1, priorWeeks: prior([1, false]) })).toEqual({ kind: 'program' })
    expect(chooseAutoCopySource({ planningType: 'stable', weekNumber: 1, priorWeeks: [] })).toEqual({ kind: 'program' })
  })

  it('a stable week is always the default (the run copy), never last week', () => {
    expect(chooseAutoCopySource({ planningType: 'stable', weekNumber: 3, priorWeeks: prior([1, false], [2, false]) })).toEqual({ kind: 'program' })
  })

  it('a week-dependent week after week 1 is the last planned normal, non-empty occurrence', () => {
    expect(chooseAutoCopySource({ planningType: 'week_dependent', weekNumber: 3, priorWeeks: prior([1, false], [2, false]) })).toEqual({ kind: 'week', weekNumber: 2 })
  })

  it('a week nobody planned in between is no source and does not stop the search: weeks 1 and 2 planned, week 3 missed → week 4 copies week 2 (G56)', () => {
    // Week 3 is simply not in the list. "The week before" would find nothing and the oldest week would be week 1.
    expect(chooseAutoCopySource({ planningType: 'week_dependent', weekNumber: 4, priorWeeks: prior([1, false], [2, false]) })).toEqual({ kind: 'week', weekNumber: 2 })
    // Weeks missed one after another: the last planned normal week is still the source.
    expect(chooseAutoCopySource({ planningType: 'week_dependent', weekNumber: 6, priorWeeks: prior([1, false], [2, false]) })).toEqual({ kind: 'week', weekNumber: 2 })
    // The week before the missed one is a deload week: it is skipped as ever, and the older normal week is the source.
    expect(chooseAutoCopySource({ planningType: 'week_dependent', weekNumber: 4, priorWeeks: prior([1, false], [2, true]) })).toEqual({ kind: 'week', weekNumber: 1 })
    // A stable week is the default whatever was missed.
    expect(chooseAutoCopySource({ planningType: 'stable', weekNumber: 4, priorWeeks: prior([1, false], [2, false]) })).toEqual({ kind: 'program' })
  })

  it('deload and empty occurrences are skipped, a week after the planned one is never the source', () => {
    const weeks = prior([1, false], [2, true], [3, false, true], [5, false])
    expect(chooseAutoCopySource({ planningType: 'week_dependent', weekNumber: 4, priorWeeks: weeks })).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('nothing usable to copy gives an empty week', () => {
    expect(chooseAutoCopySource({ planningType: 'week_dependent', weekNumber: 2, priorWeeks: prior([1, true]) })).toEqual({ kind: 'empty' })
    expect(chooseAutoCopySource({ planningType: 'week_dependent', weekNumber: 2, priorWeeks: [] })).toEqual({ kind: 'empty' })
    expect(chooseAutoCopySource({ planningType: 'week_dependent', weekNumber: 3, priorWeeks: prior([1, false, true], [2, false, true]) })).toEqual({ kind: 'empty' })
  })

  it('a week below 1 has no source (041 raises for it too)', () => {
    expect(() => chooseAutoCopySource({ planningType: 'stable', weekNumber: 0, priorWeeks: [] })).toThrow(RangeError)
    expect(() => chooseAutoCopySource({ planningType: 'week_dependent', weekNumber: 1.5, priorWeeks: [] })).toThrow(RangeError)
  })
})

describe('plannedWeekRecords and weeksOfSlot — what the source search reads', () => {
  it('a week is empty when it has no set rows, whatever its exercise list holds', () => {
    const withExercisesOnly = plan(2, [pe('pe-lat', 'lat', 0)], [])
    const withSets = plan(3, [pe('pe-lat', 'lat', 0)], [wset('s', 'pe-lat', 1)])
    expect(plannedWeekRecords([withExercisesOnly, withSets])).toEqual([
      { weekNumber: 2, isDeload: false, isEmpty: true },
      { weekNumber: 3, isDeload: false, isEmpty: false },
    ])
  })

  it('a slot is its workout, and on a sequence run its sequence position: a repeated workout has two histories', () => {
    const all = [
      plan(1, [], [], { id: 'a1', workoutDayId: 'wd-A', sequencePosition: 1 }),
      plan(1, [], [], { id: 'b1', workoutDayId: 'wd-B', sequencePosition: 2 }),
      plan(1, [], [], { id: 'a4', workoutDayId: 'wd-A', sequencePosition: 4 }),
      plan(2, [], [], { id: 'a1-c2', workoutDayId: 'wd-A', sequencePosition: 1 }),
      plan(1, [], [], { id: 'mon1', workoutDayId: 'wd-W' }),
      plan(2, [], [], { id: 'mon2', workoutDayId: 'wd-W', sequencePosition: null }),
    ]
    expect(weeksOfSlot(all, 'wd-A', 1).map((w) => w.id)).toEqual(['a1', 'a1-c2'])
    expect(weeksOfSlot(all, 'wd-A', 4).map((w) => w.id)).toEqual(['a4'])
    expect(weeksOfSlot(all, 'wd-W', null).map((w) => w.id)).toEqual(['mon1', 'mon2'])
    // A weekday workout has no slot 1; a slot is not a workout.
    expect(weeksOfSlot(all, 'wd-W', 1)).toEqual([])
  })
})

describe('autoCopy on a sequence run — a slot is planned from its own last cycle', () => {
  it('the repeated workout\'s two slots have two histories: slot 4 copies slot 4\'s cycle, not slot 1\'s', () => {
    const slot1 = plan(1, [pe('pe-lat', 'lat', 0)], [wset('s1-a', 'pe-lat', 1), wset('s1-b', 'pe-lat', 2)], { workoutDayId: 'wd-A', sequencePosition: 1 })
    const slot4 = plan(1, [pe('pe-lat', 'lat', 0)], [wset('s4-a', 'pe-lat', 1), wset('s4-b', 'pe-lat', 2), wset('s4-c', 'pe-lat', 3)], { workoutDayId: 'wd-A', sequencePosition: 4 })
    const all = [slot1, slot4]
    const cycleTwo = (position: number) =>
      autoCopy({ planningType: 'week_dependent', weekNumber: 2, runCopy: runCopy(), priorWeeks: weeksOfSlot(all, 'wd-A', position) })
    expect(cycleTwo(4).sets.map((s) => s.sourceId)).toEqual(['s4-a', 's4-b', 's4-c'])
    expect(cycleTwo(1).sets.map((s) => s.sourceId)).toEqual(['s1-a', 's1-b'])
  })
})

// ─── The program source: a stable week, and week 1 of any run ─────────────────────────────────────────────────────

describe('autoCopy — from the program (a stable week; week 1 of any run)', () => {
  const stableWeekTwo = () => autoCopy({ planningType: 'stable', weekNumber: 2, runCopy: runCopy(), priorWeeks: [weekOne()] })

  it('takes the default\'s exercises in program order, without a week-only slot or a removed exercise', () => {
    const r = stableWeekTwo()
    expect(r.source).toEqual({ kind: 'program' })
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-lat', position: 1 },
      { programExerciseId: 'pe-face', position: 2 },
    ])
  })

  it('takes the default\'s live sets, heads before stages, without a set the default dropped or one under an excluded exercise', () => {
    const r = stableWeekTwo()
    // Heads by position, then the stage: the warmup, the working set, the dropset head, Face Pull ×2 — in the order SQL
    // inserts them (position, then Lat before Face Pull is a tie on position 1/2, kept in input order) — then the drop.
    expect(r.sets.map((s) => s.sourceId)).toEqual(['ps-lat-w', 'ps-face-1', 'ps-lat-1', 'ps-face-2', 'ps-lat-d', 'ps-lat-d1'])
    expectStagesAfterTheirHeads(r.sets)
    // Not there: the removed Face Pull set, the week-only exercise's set, the removed exercise's set.
    expect(r.sets.some((s) => ['ps-face-3', 'ps-curl-1', 'ps-dip-1'].includes(s.sourceId))).toBe(false)
  })

  it('keeps each set\'s kind, stages and links: warmup, stage kind, a stage\'s parent and index, set number = position, program set id', () => {
    const rows = byId(stableWeekTwo().sets)
    expect(rows.get('ps-lat-w')).toMatchObject({ isWarmup: true, isDropset: false, stageKind: null, setNumber: 1, programSetId: 'ps-lat-w', parentSourceId: null })
    expect(rows.get('ps-lat-d')).toMatchObject({ isWarmup: false, isDropset: false, stageKind: 'dropset', setNumber: 3, stageIndex: 0, parentSourceId: null })
    expect(rows.get('ps-lat-d1')).toMatchObject({
      isDropset: true, // a stage row
      stageKind: null,
      setNumber: 3, // the head's position
      stageIndex: 1,
      parentSourceId: 'ps-lat-d',
      programSetId: 'ps-lat-d1',
    })
  })

  it('takes the default\'s rep targets, AMRAP included — not week 1\'s (the working set is 8–10 here, 9–11 in week 1)', () => {
    const rows = byId(stableWeekTwo().sets)
    expect(rows.get('ps-lat-1')).toMatchObject({ repMin: 8, repMax: 10, isAmrap: false })
    expect(rows.get('ps-lat-w')).toMatchObject({ repMin: 12, repMax: 12, isAmrap: false })
    expect(rows.get('ps-lat-d1')).toMatchObject({ repMin: null, repMax: null, isAmrap: true })
    expect(rows.get('ps-face-1')).toMatchObject({ repMin: 15, repMax: 20 })
  })

  it('takes the structure from the default, not from last week: week 1\'s added Face Pull set is absent', () => {
    const r = stableWeekTwo()
    expect(r.sets.filter((s) => s.programExerciseId === 'pe-face')).toHaveLength(2)
    expect(r.sets.some((s) => s.sourceId === 'w1-face-3')).toBe(false)
  })

  it('never carries a weight, a RIR (either end) or tags: week 1\'s are filled, the copy\'s are null', () => {
    for (const s of stableWeekTwo().sets) {
      expect(s.targetWeight).toBeNull()
      expect(s.targetRir).toBeNull()
      expect(s.targetRirMax).toBeNull()
      expect(s.tags).toBeNull()
    }
  })

  it('week 1 of a week-dependent run starts from the program too, rep targets included (041\'s program branch, kept by 044)', () => {
    const r = autoCopy({ planningType: 'week_dependent', weekNumber: 1, runCopy: runCopy(), priorWeeks: [] })
    expect(r.source).toEqual({ kind: 'program' })
    const rows = byId(r.sets)
    expect(rows.get('ps-lat-1')).toMatchObject({ repMin: 8, repMax: 10 })
    expect(rows.get('ps-lat-d1')).toMatchObject({ isAmrap: true })
  })

  it('a stage whose head was dropped has no parent link (the SQL\'s id map has no entry for it)', () => {
    const copy: RunCopy = {
      exercises: [rc('pe-lat', 'lat', 1)],
      sets: [
        pset('ps-d', 'pe-lat', 1, { stageKind: 'dropset', removedAt: '2026-10-01T00:00:00Z' }),
        pset('ps-d1', 'pe-lat', 1, { parentProgramSetId: 'ps-d', stageIndex: 1 }),
      ],
    }
    const r = autoCopy({ planningType: 'stable', weekNumber: 2, runCopy: copy, priorWeeks: [] })
    expect(r.sets).toHaveLength(1)
    expect(r.sets[0]).toMatchObject({ sourceId: 'ps-d1', isDropset: true, parentSourceId: null })
  })
})

// ─── The week source: a week-dependent week after week 1 ──────────────────────────────────────────────────────────

describe('autoCopy — from last week (a week-dependent week after week 1)', () => {
  const weekDependentWeekTwo = () =>
    autoCopy({ planningType: 'week_dependent', weekNumber: 2, runCopy: runCopy(), priorWeeks: [weekOne()] })

  it('takes last week\'s structure as it is: its exercises and order, every set, the added one included', () => {
    const r = weekDependentWeekTwo()
    expect(r.source).toEqual({ kind: 'week', weekNumber: 1 })
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-lat', position: 0 },
      { programExerciseId: 'pe-face', position: 1 },
    ])
    expect(r.sets.map((s) => s.sourceId).sort()).toEqual(
      ['w1-face-1', 'w1-face-2', 'w1-face-3', 'w1-lat-1', 'w1-lat-d', 'w1-lat-d1', 'w1-lat-w'],
    )
    expectStagesAfterTheirHeads(r.sets)
    expect(r.sets.filter((s) => s.programExerciseId === 'pe-face')).toHaveLength(3) // the default has 2
  })

  it('keeps each set\'s kind, stages and links, and carries the program set link verbatim (an added set has none)', () => {
    const rows = byId(weekDependentWeekTwo().sets)
    expect(rows.get('w1-lat-w')).toMatchObject({ isWarmup: true, programSetId: 'ps-lat-w', setNumber: 1 })
    expect(rows.get('w1-lat-d')).toMatchObject({ stageKind: 'dropset', programSetId: 'ps-lat-d', setNumber: 3 })
    expect(rows.get('w1-lat-d1')).toMatchObject({ isDropset: true, stageIndex: 1, parentSourceId: 'w1-lat-d', programSetId: 'ps-lat-d1' })
    expect(rows.get('w1-face-3')).toMatchObject({ programSetId: null, setNumber: 3 })
  })

  it('keeps a dropset\'s two drops, each attached to the head and in stage order, with no numbers on either', () => {
    const twoDrops = plan(
      1,
      [pe('pe-lat', 'lat', 0)],
      [
        wset('h', 'pe-lat', 1, { stageKind: 'dropset', programSetId: 'ps-h', targetWeight: 60, targetRir: 1 }),
        stage('d2', 'h', 'pe-lat', 2, { programSetId: 'ps-d2', targetWeight: 30, targetRir: 0, repMin: 6, repMax: 8 }),
        stage('d1', 'h', 'pe-lat', 1, { programSetId: 'ps-d1', targetWeight: 45, targetRir: 0, isAmrap: true, repMin: null, repMax: null }),
      ],
    )
    const r = autoCopy({ planningType: 'week_dependent', weekNumber: 2, runCopy: runCopy(), priorWeeks: [twoDrops] })
    expect(r.sets.map((s) => [s.sourceId, s.parentSourceId, s.stageIndex, s.isDropset])).toEqual([
      ['h', null, 0, false],
      ['d1', 'h', 1, true],
      ['d2', 'h', 2, true],
    ])
    for (const s of r.sets) expect([s.targetWeight, s.targetRir, s.repMin, s.repMax, s.isAmrap]).toEqual([null, null, null, null, false])
  })

  it('a stage whose head is not among the source week\'s sets has no parent link (the SQL\'s id map has no entry for it)', () => {
    const orphaned = plan(1, [pe('pe-lat', 'lat', 0)], [wset('a', 'pe-lat', 1), stage('lost-stage', 'no-such-head', 'pe-lat', 1)])
    const r = autoCopy({ planningType: 'week_dependent', weekNumber: 2, runCopy: runCopy(), priorWeeks: [orphaned] })
    expect(byId(r.sets).get('lost-stage')).toMatchObject({ isDropset: true, parentSourceId: null })
    expect(byId(r.sets).get('a')).toMatchObject({ parentSourceId: null })
  })

  it('an exercise listed twice in the source week is copied once (041: on conflict do nothing; the table\'s key forbids it anyway)', () => {
    const doubled = plan(1, [pe('pe-lat', 'lat', 0), pe('pe-lat', 'lat', 1)], [wset('a', 'pe-lat', 1)])
    const r = autoCopy({ planningType: 'week_dependent', weekNumber: 2, runCopy: runCopy(), priorWeeks: [doubled] })
    expect(r.exercises).toEqual([{ programExerciseId: 'pe-lat', position: 0 }])
  })

  it('drops every rep target and the AMRAP flag — week 1\'s 9–11 and its AMRAP drop do not come along', () => {
    for (const s of weekDependentWeekTwo().sets) {
      expect(s.repMin).toBeNull()
      expect(s.repMax).toBeNull()
      expect(s.isAmrap).toBe(false)
    }
  })

  it('drops every weight, RIR (both ends) and cue — all of week 1\'s are filled', () => {
    for (const s of weekDependentWeekTwo().sets) {
      expect(s.targetWeight).toBeNull()
      expect(s.targetRir).toBeNull()
      expect(s.targetRirMax).toBeNull()
      expect(s.tags).toBeNull()
    }
  })

  it('last week is the last NORMAL, NON-EMPTY occurrence: a deload week and an empty week in between are skipped', () => {
    const deloadWeek = plan(2, [pe('pe-lat', 'lat', 0)], [wset('w2-lat-1', 'pe-lat', 1)], { isDeload: true })
    const emptyWeek = plan(3, [pe('pe-lat', 'lat', 0)], [])
    const r = autoCopy({ planningType: 'week_dependent', weekNumber: 4, runCopy: runCopy(), priorWeeks: [weekOne(), deloadWeek, emptyWeek] })
    expect(r.source).toEqual({ kind: 'week', weekNumber: 1 })
    expect(r.sets).toHaveLength(7)
    expect(r.sets.some((s) => s.sourceId === 'w2-lat-1')).toBe(false)
  })

  it('the source is not the newest prior week when a later one is a deload week (the partly-deload rule stays)', () => {
    const lighter = plan(2, [pe('pe-lat', 'lat', 0)], [wset('w2-lat-1', 'pe-lat', 1)])
    const deload = plan(3, [pe('pe-lat', 'lat', 0)], [wset('w3-lat-1', 'pe-lat', 1)], { isDeload: true })
    const r = autoCopy({ planningType: 'week_dependent', weekNumber: 4, runCopy: runCopy(), priorWeeks: [weekOne(), lighter, deload] })
    expect(r.source).toEqual({ kind: 'week', weekNumber: 2 })
    expect(r.sets.map((s) => s.sourceId)).toEqual(['w2-lat-1'])
  })

  it('nothing usable to copy: an empty week, no exercises and no sets', () => {
    const r = autoCopy({ planningType: 'week_dependent', weekNumber: 2, runCopy: runCopy(), priorWeeks: [weekOne({ isDeload: true })] })
    expect(r).toEqual({ source: { kind: 'empty' }, exercises: [], sets: [] })
  })

  it('the run copy plays no part once a week is the source: Lat\'s default dropped a set, last week still has it', () => {
    const changedCopy = runCopy()
    changedCopy.sets = changedCopy.sets.filter((ps) => ps.id !== 'ps-lat-1')
    const r = autoCopy({ planningType: 'week_dependent', weekNumber: 2, runCopy: changedCopy, priorWeeks: [weekOne()] })
    expect(r.sets.some((s) => s.sourceId === 'w1-lat-1')).toBe(true)
  })
})

// ─── After a week nobody planned (G56, DECISIONS 131 (b)) ─────────────────────────────────────────────────────────

// SPEC, Weeks and copying → How far ahead: "The current week copies from the last planned normal week, as the copy rules
// already say." Pull 1 is planned in weeks 1 and 2, which differ, and never in week 3 (a week off); week 4 is the current
// week and is planned now. Week 1 is weekOne(); week 2 is this: Lat Pulldown ×2, Face Pull ×1 and Curl ×2, which only
// week 2 has.
function weekTwo(over: Partial<WeekPlan> = {}): WeekPlan {
  return plan(
    2,
    [pe('pe-lat', 'lat', 0), pe('pe-face', 'face', 1), pe('pe-curl', 'curl', 2)],
    [
      wset('w2-lat-1', 'pe-lat', 1, { programSetId: 'ps-lat-1', targetWeight: 57.5, targetRir: 2, repMin: 8, repMax: 10 }),
      wset('w2-lat-2', 'pe-lat', 2, { programSetId: null, targetWeight: 57.5, targetRir: 1, repMin: 8, repMax: 10 }),
      wset('w2-face-1', 'pe-face', 1, { programSetId: 'ps-face-1', targetWeight: 15, targetRir: 1, repMin: 15, repMax: 20 }),
      wset('w2-curl-1', 'pe-curl', 1, { programSetId: null, targetWeight: 12, targetRir: 2, repMin: 10, repMax: 12 }),
      wset('w2-curl-2', 'pe-curl', 2, { programSetId: null, targetWeight: 12, targetRir: 2, repMin: 10, repMax: 12 }),
    ],
    over,
  )
}
const WEEK_TWO_SETS = ['w2-curl-1', 'w2-curl-2', 'w2-face-1', 'w2-lat-1', 'w2-lat-2']

describe('autoCopy after a missed week — the current week copies from the last planned normal week, whatever its number', () => {
  const weekFour = (priorWeeks: readonly WeekPlan[], planningType: 'week_dependent' | 'stable' = 'week_dependent') =>
    autoCopy({ planningType, weekNumber: 4, runCopy: runCopy(), priorWeeks })

  it('weeks 1 and 2 planned, week 3 never planned: week 4 takes week 2 whole — not week 1 (older, different) and not week 3 (nothing)', () => {
    const r = weekFour([weekOne(), weekTwo()])
    expect(r.source).toEqual({ kind: 'week', weekNumber: 2 })
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-lat', position: 0 },
      { programExerciseId: 'pe-face', position: 1 },
      { programExerciseId: 'pe-curl', position: 2 },
    ])
    expect(r.sets.map((s) => s.sourceId).sort()).toEqual(WEEK_TWO_SETS)
    expect(r.sets.some((s) => s.sourceId.startsWith('w1-'))).toBe(false) // none of week 1's seven sets
  })

  it('the order the planned weeks come in does not matter', () => {
    expect(weekFour([weekTwo(), weekOne()]).source).toEqual({ kind: 'week', weekNumber: 2 })
  })

  it('weeks missed one after another: week 6 still takes week 2, the last planned normal week', () => {
    const r = autoCopy({ planningType: 'week_dependent', weekNumber: 6, runCopy: runCopy(), priorWeeks: [weekOne(), weekTwo()] })
    expect(r.source).toEqual({ kind: 'week', weekNumber: 2 })
    expect(r.sets.map((s) => s.sourceId).sort()).toEqual(WEEK_TWO_SETS)
  })

  it('a deload week 2 and the missed week 3: the deload week is skipped as ever, so week 4 takes week 1', () => {
    const r = weekFour([weekOne(), weekTwo({ isDeload: true })])
    expect(r.source).toEqual({ kind: 'week', weekNumber: 1 })
    expect(r.sets).toHaveLength(7)
    expect(r.sets.some((s) => s.sourceId.startsWith('w2-'))).toBe(false)
  })

  it('an empty week 2 (no set rows) is skipped as ever too: week 4 takes week 1', () => {
    expect(weekFour([weekOne(), plan(2, [pe('pe-lat', 'lat', 0)], [])]).source).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('only weeks before the planned one count: a week 5 planned ahead before week 4 is never its source', () => {
    const weekFive = plan(5, [pe('pe-lat', 'lat', 0)], [wset('w5-lat-1', 'pe-lat', 1)])
    expect(weekFour([weekOne(), weekTwo(), weekFive]).source).toEqual({ kind: 'week', weekNumber: 2 })
  })

  it('nothing planned before it at all (every earlier week missed): an empty week — the copy rules\' own answer, unchanged', () => {
    expect(weekFour([])).toEqual({ source: { kind: 'empty' }, exercises: [], sets: [] })
  })

  it('a stable week is the default whatever was missed: the program\'s sets, not week 2\'s', () => {
    const r = weekFour([weekOne(), weekTwo()], 'stable')
    expect(r.source).toEqual({ kind: 'program' })
    expect(r.sets.some((s) => s.sourceId.startsWith('w2-') || s.sourceId.startsWith('w1-'))).toBe(false)
    expect(r.sets.map((s) => s.sourceId)).toEqual(['ps-lat-w', 'ps-face-1', 'ps-lat-1', 'ps-face-2', 'ps-lat-d', 'ps-lat-d1'])
  })

  it('on a sequence run a slot takes its own last planned cycle: cycle 3 was never planned, cycle 4 is the current one', () => {
    // The repeated workout is in slots 1 and 4; each cycle plans both, with a different number of sets each time.
    const cycle = (n: number, position: number, count: number) =>
      plan(n, [pe('pe-lat', 'lat', 0)], Array.from({ length: count }, (_, i) => wset(`c${n}-s${position}-${i + 1}`, 'pe-lat', i + 1)), {
        id: `c${n}-s${position}`,
        workoutDayId: 'wd-A',
        sequencePosition: position,
      })
    const all = [cycle(1, 1, 1), cycle(1, 4, 2), cycle(2, 1, 4), cycle(2, 4, 3)]
    const cycleFour = (position: number) =>
      autoCopy({ planningType: 'week_dependent', weekNumber: 4, runCopy: runCopy(), priorWeeks: weeksOfSlot(all, 'wd-A', position) })
    expect(cycleFour(1).source).toEqual({ kind: 'week', weekNumber: 2 })
    expect(cycleFour(1).sets.map((s) => s.sourceId)).toEqual(['c2-s1-1', 'c2-s1-2', 'c2-s1-3', 'c2-s1-4']) // slot 1's cycle 2
    expect(cycleFour(4).sets.map((s) => s.sourceId)).toEqual(['c2-s4-1', 'c2-s4-2', 'c2-s4-3']) // slot 4's cycle 2, not slot 1's
  })
})

