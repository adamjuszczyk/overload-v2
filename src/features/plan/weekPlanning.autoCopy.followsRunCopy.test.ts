import { describe, it, expect } from 'vitest'
import { autoCopy, type AutoCopiedSet, type RunCopy, type RunCopyExercise } from './weekPlanning'
import { plan, pe, pset, wset, stage } from './weekPlanning.testutil'

// DECISIONS 143 (Adam, 2026-10-15): "A week-dependent week copied after a save follows the run copy's current exercise
// list and order: an exercise still in the program brings its sets from the source session as the copy rules say; a
// removed one is dropped; an added one arrives with no sets; a swapped one brings the old exercise's sets (count, kinds,
// stages, rep targets — as SPEC's swap rule)."
//
// Why it is a rule at all: the week a week-dependent week is copied from is the workout's last planned normal week, and
// that session may be done or in progress, which a CHANGE THE PROGRAM save never touches. Without the rule a removed
// exercise came back, an added one was missing and a swap was undone.
//
// The fixture is "Pull 1" after a save made four kinds of change to it, with a source week (week 2) that is the old plan:
//
//                    run copy now                          week 2 (done), the source
//   Lat Pulldown     kept                                  4 sets: a warmup, a working set, a dropset head and its drop
//   Face Pull        REMOVED                               2 sets
//   EZ Curl          SWAPPED OUT (removed)                 3 sets: two working, a rest-pause head with a pause
//   Hammer Curl      SWAPPED IN, replaces EZ Curl          —
//   Cable Row        ADDED                                 —
//   Dip              a week-only slot of 1.1 (not in the program, but week 2 has it): 1 set
//
// The run copy's own program sets are different from what week 2 holds on purpose (Lat Pulldown has two, Cable Row has
// one), so a copy that reads the wrong place is told from the right one.

const rc = (id: string, exerciseId: string, position: number, flags: Partial<RunCopyExercise> = {}): RunCopyExercise => ({
  id,
  exerciseId,
  position,
  ...flags,
})

const REMOVED = '2026-10-15T12:00:00Z'

function runCopy(over: { exercises?: RunCopyExercise[] } = {}): RunCopy {
  return {
    exercises: over.exercises ?? [
      rc('pe-lat', 'lat', 0),
      rc('pe-face', 'face', 1, { removedAt: REMOVED }),
      rc('pe-curl', 'curl', 2, { removedAt: REMOVED }),
      rc('pe-ham', 'ham', 2, { replacesProgramExerciseId: 'pe-curl' }),
      rc('pe-row', 'row', 3),
      rc('pe-dip', 'dip', 4, { weekOnly: true }),
    ],
    sets: [
      pset('ps-lat-1', 'pe-lat', 1, { repMin: 8, repMax: 10 }),
      pset('ps-lat-2', 'pe-lat', 2, { repMin: 8, repMax: 10 }),
      pset('ps-row-1', 'pe-row', 1, { repMin: 10, repMax: 12 }), // the program holds a set for it; a week-dependent copy must not take it
    ],
  }
}

// Week 2 as it was planned and done: every number filled.
function weekTwo(over: Parameters<typeof plan>[3] = {}) {
  return plan(
    2,
    [pe('pe-lat', 'lat', 0), pe('pe-face', 'face', 1), pe('pe-curl', 'curl', 2), pe('pe-dip', 'dip', 3)],
    [
      wset('w2-lat-w', 'pe-lat', 1, { isWarmup: true, programSetId: 'ps-lat-w', targetWeight: 20, targetRir: 5, repMin: 12, repMax: 12 }),
      wset('w2-lat-1', 'pe-lat', 2, { programSetId: 'ps-lat-1', targetWeight: 57.5, targetRir: 2, targetRirMax: 3, repMin: 8, repMax: 10, tags: ['push here'] }),
      wset('w2-lat-d', 'pe-lat', 3, { programSetId: 'ps-lat-d', stageKind: 'dropset', targetWeight: 57.5, targetRir: 2, repMin: 8, repMax: 10 }),
      stage('w2-lat-d1', 'w2-lat-d', 'pe-lat', 1, { setNumber: 3, programSetId: 'ps-lat-d1', targetWeight: 40, targetRir: 0, isAmrap: true, repMin: null, repMax: null }),
      wset('w2-face-1', 'pe-face', 1, { programSetId: 'ps-face-1', targetWeight: 15, targetRir: 1, repMin: 15, repMax: 20 }),
      wset('w2-face-2', 'pe-face', 2, { programSetId: 'ps-face-2', targetWeight: 15, targetRir: 1, repMin: 15, repMax: 20 }),
      wset('w2-curl-1', 'pe-curl', 1, { programSetId: 'ps-curl-1', targetWeight: 30, targetRir: 2, repMin: 10, repMax: 12 }),
      wset('w2-curl-2', 'pe-curl', 2, { programSetId: null, targetWeight: 30, targetRir: 2, repMin: 10, repMax: 12 }),
      wset('w2-curl-3', 'pe-curl', 3, { programSetId: null, stageKind: 'rest_pause', targetWeight: 30, targetRir: 1, repMin: 8, repMax: 10 }),
      stage('w2-curl-3p', 'w2-curl-3', 'pe-curl', 1, { setNumber: 3, programSetId: null, targetWeight: 30, targetRir: 0, repMin: 4, repMax: 6 }),
      wset('w2-dip-1', 'pe-dip', 1, { programSetId: null, targetWeight: 0, targetRir: 2, repMin: 8, repMax: 12 }),
    ],
    over,
  )
}

// Week 2 with only some of its exercises, for the tests that give the run copy fewer rows.
function weekTwoOnly(...programExerciseIds: string[]) {
  const full = weekTwo()
  const keep = new Set(programExerciseIds)
  return { ...full, exercises: full.exercises.filter((e) => keep.has(e.id)), sets: full.sets.filter((x) => keep.has(x.programExerciseId)) }
}

const copyOf = (rcopy: RunCopy, week = weekTwo()) =>
  autoCopy({ planningType: 'week_dependent', weekNumber: 3, runCopy: rcopy, priorWeeks: [week] })

const setsOf = (rows: AutoCopiedSet[], programExerciseId: string) => rows.filter((s) => s.programExerciseId === programExerciseId)
const idsOf = (rows: AutoCopiedSet[]) => rows.map((s) => s.sourceId)

describe('a week-dependent week copied after a save: the run copy\'s exercise list, the source week\'s sets (DECISIONS 143)', () => {
  it('all four at once: kept brings its sets, removed is gone, added has none, swapped brings the old exercise\'s — in the run copy\'s order', () => {
    const r = copyOf(runCopy())
    expect(r.source).toEqual({ kind: 'week', weekNumber: 2 })
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-lat', position: 0 }, // kept
      { programExerciseId: 'pe-ham', position: 2 }, // swapped in, at the swapped-out row's place
      { programExerciseId: 'pe-row', position: 3 }, // added
      { programExerciseId: 'pe-dip', position: 4 }, // week-only slot of week 2, after the run copy's own rows
    ])
    expect(idsOf(setsOf(r.sets, 'pe-lat')).sort()).toEqual(['w2-lat-1', 'w2-lat-d', 'w2-lat-d1', 'w2-lat-w'])
    expect(setsOf(r.sets, 'pe-face')).toEqual([])
    expect(setsOf(r.sets, 'pe-curl')).toEqual([])
    expect(idsOf(setsOf(r.sets, 'pe-ham')).sort()).toEqual(['w2-curl-1', 'w2-curl-2', 'w2-curl-3', 'w2-curl-3p'])
    expect(setsOf(r.sets, 'pe-row')).toEqual([])
    expect(idsOf(setsOf(r.sets, 'pe-dip'))).toEqual(['w2-dip-1'])
  })

  it('kept: the sets are the source week\'s — four of them, not the two the run copy\'s program holds', () => {
    const lat = setsOf(copyOf(runCopy()).sets, 'pe-lat')
    expect(lat).toHaveLength(4)
    expect(lat.some((s) => s.sourceId.startsWith('ps-'))).toBe(false)
  })

  it('kept: kinds, stages and links come along as the copy rules have them, and no number does', () => {
    const lat = new Map(setsOf(copyOf(runCopy()).sets, 'pe-lat').map((s) => [s.sourceId, s]))
    expect(lat.get('w2-lat-w')).toMatchObject({ isWarmup: true, setNumber: 1, programSetId: 'ps-lat-w' })
    expect(lat.get('w2-lat-d')).toMatchObject({ stageKind: 'dropset', setNumber: 3, programSetId: 'ps-lat-d', parentSourceId: null })
    expect(lat.get('w2-lat-d1')).toMatchObject({ isDropset: true, stageIndex: 1, parentSourceId: 'w2-lat-d', setNumber: 3 })
    for (const s of copyOf(runCopy()).sets) {
      expect([s.targetWeight, s.targetRir, s.targetRirMax, s.tags, s.repMin, s.repMax, s.isAmrap]).toEqual([null, null, null, null, null, null, false])
    }
  })

  it('removed: the exercise and every one of its sets are left out', () => {
    const r = copyOf(runCopy())
    expect(r.exercises.some((e) => e.programExerciseId === 'pe-face')).toBe(false)
    expect(r.sets.some((s) => s.programExerciseId === 'pe-face' || s.sourceId.startsWith('w2-face'))).toBe(false)
  })

  it('removed: an exercise the source week lists with no sets is left out too (the exercise row goes, not only its sets)', () => {
    const bare = plan(2, [pe('pe-lat', 'lat', 0), pe('pe-face', 'face', 1)], [wset('w2-lat-1', 'pe-lat', 1)])
    const r = copyOf(runCopy(), bare)
    expect(r.exercises.map((e) => e.programExerciseId)).not.toContain('pe-face')
  })

  it('added: it is listed, at the run copy\'s position, and has no sets — not the run copy\'s program set either', () => {
    const r = copyOf(runCopy())
    expect(r.exercises).toContainEqual({ programExerciseId: 'pe-row', position: 3 })
    expect(r.sets.some((s) => s.programExerciseId === 'pe-row')).toBe(false)
    expect(r.sets.some((s) => s.sourceId === 'ps-row-1')).toBe(false)
  })

  it('swapped: the new exercise takes the old one\'s sets — count, kinds, stages — pointed at the new row, in set order, no numbers', () => {
    const ham = setsOf(copyOf(runCopy()).sets, 'pe-ham')
    expect(ham.map((s) => [s.sourceId, s.setNumber, s.stageIndex, s.stageKind, s.isDropset, s.parentSourceId])).toEqual([
      ['w2-curl-1', 1, 0, null, false, null],
      ['w2-curl-2', 2, 0, null, false, null],
      ['w2-curl-3', 3, 0, 'rest_pause', false, null],
      ['w2-curl-3p', 3, 1, null, true, 'w2-curl-3'], // the pause stays attached to its head
    ])
    for (const s of ham) expect([s.targetWeight, s.targetRir, s.tags, s.repMin, s.repMax]).toEqual([null, null, null, null, null])
    expect(copyOf(runCopy()).sets.some((s) => s.programExerciseId === 'pe-curl')).toBe(false) // none left on the old row
  })

  it('swapped: the program set links come along verbatim (the old exercise\'s, as a session\'s re-pointed sets keep theirs)', () => {
    const ham = new Map(setsOf(copyOf(runCopy()).sets, 'pe-ham').map((s) => [s.sourceId, s]))
    expect(ham.get('w2-curl-1')!.programSetId).toBe('ps-curl-1')
    expect(ham.get('w2-curl-2')!.programSetId).toBeNull()
  })

  it('swapped twice: the second swap\'s new exercise takes the sets of the exercise the source week lists (the chain is followed)', () => {
    const twice = runCopy({
      exercises: [
        rc('pe-lat', 'lat', 0),
        rc('pe-curl', 'curl', 2, { removedAt: REMOVED }),
        rc('pe-ham', 'ham', 2, { removedAt: REMOVED, replacesProgramExerciseId: 'pe-curl' }),
        rc('pe-cable', 'cable', 2, { replacesProgramExerciseId: 'pe-ham' }),
      ],
    })
    const r = copyOf(twice, weekTwoOnly('pe-lat', 'pe-curl'))
    expect(r.exercises.map((e) => e.programExerciseId)).toEqual(['pe-lat', 'pe-cable'])
    expect(idsOf(setsOf(r.sets, 'pe-cable')).sort()).toEqual(['w2-curl-1', 'w2-curl-2', 'w2-curl-3', 'w2-curl-3p'])
  })

  it('swapped, but the source week does not list the exercise it replaced: nothing to take, it arrives like an added exercise', () => {
    const r = copyOf(runCopy(), plan(2, [pe('pe-lat', 'lat', 0)], [wset('w2-lat-1', 'pe-lat', 1)]))
    expect(r.exercises).toContainEqual({ programExerciseId: 'pe-ham', position: 2 })
    expect(setsOf(r.sets, 'pe-ham')).toEqual([])
    expect(idsOf(r.sets)).toEqual(['w2-lat-1'])
  })

  it('swapped, but the new row names no row it replaced (no `replacesProgramExerciseId`): the swapped-in exercise is empty and the swapped-out one gone', () => {
    // Since migration 043 a swap writes the link (`v2_program_exercises.replaces_program_exercise_id`, DECISIONS 143), so a row
    // like this is one that replaced nothing: it sits where a removed one was and is copied like an added exercise. It is the
    // (a′) outcome Adam did not choose for a swap, shown so that the link, not the position, is what carries the old sets.
    const noLink = runCopy({
      exercises: [rc('pe-lat', 'lat', 0), rc('pe-curl', 'curl', 2, { removedAt: REMOVED }), rc('pe-ham', 'ham', 2)],
    })
    const r = copyOf(noLink, weekTwoOnly('pe-lat', 'pe-curl'))
    expect(r.exercises.map((e) => e.programExerciseId)).toEqual(['pe-lat', 'pe-ham'])
    expect(setsOf(r.sets, 'pe-ham')).toEqual([])
    expect(setsOf(r.sets, 'pe-curl')).toEqual([])
  })

  it('two new exercises can not both take one old exercise\'s sets: the first by position does', () => {
    const both = runCopy({
      exercises: [
        rc('pe-lat', 'lat', 0),
        rc('pe-curl', 'curl', 2, { removedAt: REMOVED }),
        rc('pe-b', 'b', 3, { replacesProgramExerciseId: 'pe-curl' }),
        rc('pe-a', 'a', 2, { replacesProgramExerciseId: 'pe-curl' }),
      ],
    })
    const r = copyOf(both, weekTwoOnly('pe-lat', 'pe-curl'))
    expect(idsOf(setsOf(r.sets, 'pe-a')).sort()).toEqual(['w2-curl-1', 'w2-curl-2', 'w2-curl-3', 'w2-curl-3p'])
    expect(setsOf(r.sets, 'pe-b')).toEqual([])
    expect(new Set(idsOf(r.sets)).size).toBe(r.sets.length) // no source set is copied twice
  })

  it('a live exercise the source week lists keeps its own sets, even when it names a row the source week lists too as the one it replaced', () => {
    // Week 2 lists the swapped-in Hammer Curl (with one set of its own) and EZ Curl, the row Hammer Curl replaced (with three).
    const week = plan(
      2,
      [pe('pe-lat', 'lat', 0), pe('pe-ham', 'ham', 1), pe('pe-curl', 'curl', 2)],
      [wset('w2-lat-1', 'pe-lat', 1), wset('w2-ham-1', 'pe-ham', 1), wset('w2-curl-1', 'pe-curl', 1), wset('w2-curl-2', 'pe-curl', 2), wset('w2-curl-3', 'pe-curl', 3)],
    )
    const both = runCopy({
      exercises: [rc('pe-lat', 'lat', 0), rc('pe-ham', 'ham', 1, { replacesProgramExerciseId: 'pe-curl' }), rc('pe-curl', 'curl', 2, { removedAt: REMOVED })],
    })
    const r = copyOf(both, week)
    expect(idsOf(setsOf(r.sets, 'pe-ham'))).toEqual(['w2-ham-1']) // only its own
    expect(r.exercises.map((e) => e.programExerciseId)).toEqual(['pe-lat', 'pe-ham']) // and EZ Curl, removed, is gone with its sets
    expect(r.sets.some((s) => s.sourceId.startsWith('w2-curl'))).toBe(false)
  })

  it('an exercise that is live and listed is kept, whatever a later row says it replaced', () => {
    const stillThere = runCopy({
      exercises: [rc('pe-lat', 'lat', 0), rc('pe-curl', 'curl', 2), rc('pe-ham', 'ham', 3, { replacesProgramExerciseId: 'pe-curl' })],
    })
    const r = copyOf(stillThere, weekTwoOnly('pe-lat', 'pe-curl'))
    expect(idsOf(setsOf(r.sets, 'pe-curl')).sort()).toEqual(['w2-curl-1', 'w2-curl-2', 'w2-curl-3', 'w2-curl-3p'])
    expect(setsOf(r.sets, 'pe-ham')).toEqual([])
  })

  it('the order is the run copy\'s, not the source week\'s: a save moved Face Pull above Lat Pulldown', () => {
    const moved = runCopy({ exercises: [rc('pe-face', 'face', 0), rc('pe-lat', 'lat', 1), rc('pe-curl', 'curl', 2)] })
    const r = copyOf(moved, weekTwoOnly('pe-lat', 'pe-face', 'pe-curl'))
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-face', position: 0 },
      { programExerciseId: 'pe-lat', position: 1 },
      { programExerciseId: 'pe-curl', position: 2 },
    ])
  })

  it('the positions are the run copy\'s, whatever numbers the source week used', () => {
    // Week 2 numbered its rows 0..3; the run copy numbers Lat Pulldown 5 and EZ Curl 9.
    const r = copyOf(runCopy({ exercises: [rc('pe-lat', 'lat', 5), rc('pe-curl', 'curl', 9)] }), weekTwoOnly('pe-lat', 'pe-curl'))
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-lat', position: 5 },
      { programExerciseId: 'pe-curl', position: 9 },
    ])
  })
})

describe('what the run copy does not list as live: week-only slots and unknown rows stay as week 2 has them', () => {
  it('a week-only slot of the source week is kept with its sets, after the run copy\'s rows (1.1 week-level adds and swaps carried forward)', () => {
    const r = copyOf(runCopy())
    expect(r.exercises[r.exercises.length - 1]).toEqual({ programExerciseId: 'pe-dip', position: 4 })
    expect(idsOf(setsOf(r.sets, 'pe-dip'))).toEqual(['w2-dip-1'])
  })

  it('several are numbered after the last of the run copy\'s rows in the source week\'s own order', () => {
    const week = plan(
      2,
      [pe('pe-wo2', 'wo2', 7), pe('pe-lat', 'lat', 0), pe('pe-wo1', 'wo1', 3)],
      [wset('a', 'pe-lat', 1), wset('b', 'pe-wo1', 1), wset('c', 'pe-wo2', 1)],
    )
    const r = copyOf(
      runCopy({ exercises: [rc('pe-lat', 'lat', 0), rc('pe-wo1', 'wo1', 40, { weekOnly: true }), rc('pe-wo2', 'wo2', 41, { weekOnly: true })] }),
      week,
    )
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-lat', position: 0 },
      { programExerciseId: 'pe-wo1', position: 1 }, // source order: position 3 before position 7
      { programExerciseId: 'pe-wo2', position: 2 },
    ])
  })

  it('a week-only slot the source week lists twice is copied once (041: on conflict do nothing)', () => {
    const week = plan(2, [pe('pe-lat', 'lat', 0), pe('pe-wo', 'wo', 1), pe('pe-wo', 'wo', 2)], [wset('a', 'pe-lat', 1), wset('w', 'pe-wo', 1)])
    const r = copyOf(runCopy({ exercises: [rc('pe-lat', 'lat', 0), rc('pe-wo', 'wo', 5, { weekOnly: true })] }), week)
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-lat', position: 0 },
      { programExerciseId: 'pe-wo', position: 1 },
    ])
  })

  it('a row the run copy does not know at all is kept too: nothing says it was removed', () => {
    const week = plan(2, [pe('pe-lat', 'lat', 0), pe('pe-ghost', 'ghost', 1)], [wset('a', 'pe-lat', 1), wset('g', 'pe-ghost', 1)])
    const r = copyOf(runCopy({ exercises: [rc('pe-lat', 'lat', 0)] }), week)
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-lat', position: 0 },
      { programExerciseId: 'pe-ghost', position: 1 },
    ])
    expect(idsOf(r.sets).sort()).toEqual(['a', 'g'])
  })

  it('a week-only slot that was removed from the run is gone like any removed row (removed_at decides, week-only or not)', () => {
    const r = copyOf(
      runCopy({ exercises: [rc('pe-lat', 'lat', 0), rc('pe-dip', 'dip', 4, { weekOnly: true, removedAt: REMOVED })] }),
      weekTwoOnly('pe-lat', 'pe-dip'),
    )
    expect(r.exercises).toEqual([{ programExerciseId: 'pe-lat', position: 0 }])
    expect(r.sets.some((s) => s.programExerciseId === 'pe-dip')).toBe(false)
  })

  it('a stage whose head is a set of an exercise left out has no parent link (the head is not among the rows copied)', () => {
    const week = plan(
      2,
      [pe('pe-lat', 'lat', 0), pe('pe-face', 'face', 1)],
      [wset('lat-1', 'pe-lat', 1), wset('face-head', 'pe-face', 1, { stageKind: 'dropset' }), stage('lat-stage', 'face-head', 'pe-lat', 1)],
    )
    const r = copyOf(runCopy({ exercises: [rc('pe-lat', 'lat', 0), rc('pe-face', 'face', 1, { removedAt: REMOVED })] }), week)
    expect(idsOf(r.sets).sort()).toEqual(['lat-1', 'lat-stage'])
    expect(r.sets.find((s) => s.sourceId === 'lat-stage')).toMatchObject({ isDropset: true, parentSourceId: null })
  })

  it('a removed row is gone even when the source week lists nothing else of the workout', () => {
    const r = copyOf(runCopy({ exercises: [rc('pe-lat', 'lat', 0), rc('pe-face', 'face', 1, { removedAt: REMOVED })] }), plan(2, [pe('pe-face', 'face', 0)], [wset('f', 'pe-face', 1)]))
    expect(r.exercises).toEqual([{ programExerciseId: 'pe-lat', position: 0 }])
    expect(r.sets).toEqual([])
  })
})

describe('what stays as it was', () => {
  it('a source week that lists exactly the run copy\'s exercises copies them whole, as before this rule (kept, nothing added or removed)', () => {
    const same = plan(2, [pe('pe-lat', 'lat', 0), pe('pe-row', 'row', 3)], [wset('a', 'pe-lat', 1), wset('b', 'pe-lat', 2), wset('r', 'pe-row', 1)])
    const r = copyOf(runCopy({ exercises: [rc('pe-lat', 'lat', 0), rc('pe-row', 'row', 3)] }), same)
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-lat', position: 0 },
      { programExerciseId: 'pe-row', position: 3 },
    ])
    expect(idsOf(r.sets).sort()).toEqual(['a', 'b', 'r'])
  })

  it('a stable week and week 1 take the run copy\'s own sets, so the rule changes nothing for them', () => {
    const stable = autoCopy({ planningType: 'stable', weekNumber: 3, runCopy: runCopy(), priorWeeks: [weekTwo()] })
    expect(stable.source).toEqual({ kind: 'program' })
    expect(idsOf(stable.sets).sort()).toEqual(['ps-lat-1', 'ps-lat-2', 'ps-row-1'])
    const first = autoCopy({ planningType: 'week_dependent', weekNumber: 1, runCopy: runCopy(), priorWeeks: [] })
    expect(first.source).toEqual({ kind: 'program' })
    expect(idsOf(first.sets).sort()).toEqual(['ps-lat-1', 'ps-lat-2', 'ps-row-1'])
  })

  it('an empty source (nothing usable to copy) is an empty week: the run copy\'s list does not fill it', () => {
    const r = autoCopy({ planningType: 'week_dependent', weekNumber: 3, runCopy: runCopy(), priorWeeks: [weekTwo({ isDeload: true })] })
    expect(r).toEqual({ source: { kind: 'empty' }, exercises: [], sets: [] })
  })

  it('a copy does not change its input', () => {
    const copy = runCopy()
    const week = weekTwo()
    const frozen = JSON.stringify({ copy, week })
    copyOf(copy, week)
    expect(JSON.stringify({ copy, week })).toBe(frozen)
  })

  it('the rows come in any order and the answer is the same', () => {
    const forward = copyOf(runCopy())
    const copy = runCopy()
    const week = weekTwo()
    const reversed = autoCopy({
      planningType: 'week_dependent',
      weekNumber: 3,
      runCopy: { exercises: [...copy.exercises].reverse(), sets: [...copy.sets].reverse() },
      priorWeeks: [{ ...week, exercises: [...week.exercises].reverse(), sets: [...week.sets].reverse() }],
    })
    expect(reversed.exercises).toEqual(forward.exercises)
    expect(idsOf(reversed.sets).sort()).toEqual(idsOf(forward.sets).sort())
    expect(reversed.sets.map((s) => s.programExerciseId).sort()).toEqual(forward.sets.map((s) => s.programExerciseId).sort())
  })
})

// The dangerous value goes last (CONTEXT: a guard that keeps a loop finite). The two rows' link reads are counted and a
// walk that doesn't stop throws on the 25th, so a guard taken out fails here instead of spinning forever.
describe('links that loop end the walk', () => {
  it('A replaces B replaces A, none of them in the source week: the walk stops and the new exercise arrives with no sets', () => {
    let reads = 0
    const counted = (id: string, replaces: string, position: number): RunCopyExercise => ({
      id,
      exerciseId: id,
      position,
      get replacesProgramExerciseId() {
        if (++reads > 25) throw new Error('the walk went round in circles')
        return replaces
      },
    })
    const loop: RunCopy = { exercises: [rc('pe-lat', 'lat', 0), counted('pe-a', 'pe-b', 1), counted('pe-b', 'pe-a', 2)], sets: [] }
    const r = copyOf(loop, weekTwoOnly('pe-lat'))
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-lat', position: 0 },
      { programExerciseId: 'pe-a', position: 1 },
      { programExerciseId: 'pe-b', position: 2 },
    ])
    expect(setsOf(r.sets, 'pe-a')).toEqual([])
    expect(setsOf(r.sets, 'pe-b')).toEqual([])
  })

  it('a chain that runs into a loop it is not part of ends too: X replaces A, A replaces B, B replaces A', () => {
    let reads = 0
    const counted = (id: string, replaces: string, position: number): RunCopyExercise => ({
      id,
      exerciseId: id,
      position,
      removedAt: REMOVED,
      get replacesProgramExerciseId() {
        if (++reads > 25) throw new Error('the walk went round in circles')
        return replaces
      },
    })
    const loop: RunCopy = {
      exercises: [rc('pe-lat', 'lat', 0), rc('pe-x', 'x', 1, { replacesProgramExerciseId: 'pe-a' }), counted('pe-a', 'pe-b', 2), counted('pe-b', 'pe-a', 3)],
      sets: [],
    }
    const r = copyOf(loop, weekTwoOnly('pe-lat'))
    expect(r.exercises).toEqual([
      { programExerciseId: 'pe-lat', position: 0 },
      { programExerciseId: 'pe-x', position: 1 },
    ])
    expect(setsOf(r.sets, 'pe-x')).toEqual([])
  })

  it('a row that replaces itself ends the walk the same way', () => {
    let reads = 0
    const selfish: RunCopyExercise = {
      id: 'pe-a',
      exerciseId: 'a',
      position: 1,
      get replacesProgramExerciseId() {
        if (++reads > 25) throw new Error('the walk went round in circles')
        return 'pe-a'
      },
    }
    const r = copyOf({ exercises: [rc('pe-lat', 'lat', 0), selfish], sets: [] }, weekTwoOnly('pe-lat'))
    expect(r.exercises.map((e) => e.programExerciseId)).toEqual(['pe-lat', 'pe-a'])
  })
})
