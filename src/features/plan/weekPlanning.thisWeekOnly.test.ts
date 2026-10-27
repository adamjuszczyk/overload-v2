import { describe, it, expect } from 'vitest'
import type { WeekPlanSet } from '../../types'
import { addSetDefaults, thisWeekOnly } from './weekPlanning'
import { pset, stage, wset } from './weekPlanning.testutil'

// Chunk 42 — "THIS WEEK ONLY" (SPEC, Weeks and copying → Stable weeks): a stable week's exercise shows the line once a
// set differs from the default in set count, kind, stages or rep target; weight, RIR and cues never count, because the
// default holds none. The fixtures put the same change on the side the rule reads and the side it doesn't, so a rule
// that compared the wrong field gives the wrong answer.

// The default: Bench, three working sets of 8–10.
const DEFAULT = () => [
  pset('p1', 'e', 1, { repMin: 8, repMax: 10 }),
  pset('p2', 'e', 2, { repMin: 8, repMax: 10 }),
  pset('p3', 'e', 3, { repMin: 8, repMax: 10 }),
]
// The week as planned from it: the same three sets, with the weights and RIR a user types (the default has none).
const WEEK = (over: Record<string, Partial<WeekPlanSet>> = {}) => [
  wset('w1', 'e', 1, { repMin: 8, repMax: 10, targetWeight: 100, targetRir: 2, ...over.w1 }),
  wset('w2', 'e', 2, { repMin: 8, repMax: 10, targetWeight: 100, targetRir: 2, ...over.w2 }),
  wset('w3', 'e', 3, { repMin: 8, repMax: 10, targetWeight: 100, targetRir: 2, ...over.w3 }),
]

describe('thisWeekOnly — false while the week matches the default', () => {
  it('the same sets, kinds and rep targets', () => {
    expect(thisWeekOnly(WEEK(), DEFAULT())).toBe(false)
  })

  it('weight never counts: every set carries one and the default holds none', () => {
    expect(thisWeekOnly(WEEK({ w2: { targetWeight: 142.5 }, w3: { targetWeight: null } }), DEFAULT())).toBe(false)
  })

  it('RIR never counts, a range included', () => {
    expect(thisWeekOnly(WEEK({ w1: { targetRir: 0 }, w2: { targetRir: 1, targetRirMax: 3 }, w3: { targetRir: null } }), DEFAULT())).toBe(false)
  })

  it('cues never count', () => {
    expect(thisWeekOnly(WEEK({ w1: { tags: ['push here'] }, w3: { tags: ['push back', 'custom'] } }), DEFAULT())).toBe(false)
  })

  it('an exercise with no sets in either', () => {
    expect(thisWeekOnly([], [])).toBe(false)
  })

  it('a rep target shows as it is: 8 to 8 is 8, and a half-filled pair is no target on either side', () => {
    const base = [pset('p1', 'e', 1, { repMin: 8, repMax: 8 }), pset('p2', 'e', 2, { repMin: 8, repMax: null })]
    const week = [wset('w1', 'e', 1, { repMin: 8, repMax: 8 }), wset('w2', 'e', 2, { repMin: null, repMax: null })]
    expect(thisWeekOnly(week, base)).toBe(false)
  })

  it('a set the default dropped (removed_at) is not part of the default', () => {
    const base = [...DEFAULT(), pset('p4', 'e', 4, { removedAt: '2026-10-01T00:00:00Z' })]
    expect(thisWeekOnly(WEEK(), base)).toBe(false)
    const four = [...WEEK(), wset('w4', 'e', 4, { repMin: 8, repMax: 10 })]
    expect(thisWeekOnly(four, base)).toBe(true) // the week has a fourth set the default no longer has
  })

  // Chunk 54b's review (R11): weekDiff.test.ts's "a removed stage, and the stages of a removed head, are not part of it either" went with 1.1's module; 42's
  // tests above drop only a removed head.
  it('a stage the default dropped (removed_at on a stage program set) is not part of the default either (break: the stages are taken from every set, the dropped ones included)', () => {
    // set 1 is a dropset with two drops in the default; the second was dropped since
    const base = [
      pset('p1', 'e', 1, { repMin: 8, repMax: 10, stageKind: 'dropset' }),
      pset('p1a', 'e', 1, { parentProgramSetId: 'p1', stageIndex: 1, repMin: 8, repMax: 10 }),
      pset('p1b', 'e', 1, { parentProgramSetId: 'p1', stageIndex: 2, repMin: 8, repMax: 10, removedAt: '2026-10-01T00:00:00Z' }),
    ]
    const one = [wset('w1', 'e', 1, { repMin: 8, repMax: 10, stageKind: 'dropset' }), stage('w1a', 'w1', 'e', 1, { repMin: 8, repMax: 10 })]
    expect(thisWeekOnly(one, base)).toBe(false) // the week's one drop is what the default holds now
    expect(thisWeekOnly([...one, stage('w1b', 'w1', 'e', 2, { repMin: 8, repMax: 10 })], base)).toBe(true) // a second drop is the week's own
  })

  it('the rows may come in any order: heads are ranked by set number, stages by stage index', () => {
    const base = [
      pset('p2', 'e', 2, { repMin: 8, repMax: 10, stageKind: 'dropset' }),
      pset('p2b', 'e', 2, { parentProgramSetId: 'p2', stageIndex: 2, repMin: 6, repMax: 6 }),
      pset('p2a', 'e', 2, { parentProgramSetId: 'p2', stageIndex: 1, repMin: 8, repMax: 8 }),
      pset('p1', 'e', 1, { repMin: 8, repMax: 10 }),
    ]
    const week = [
      wset('w2b', 'e', 1, { isDropset: true, parentWeekPlanSetId: 'w2', stageIndex: 2, repMin: 6, repMax: 6 }),
      wset('w2', 'e', 2, { repMin: 8, repMax: 10, stageKind: 'dropset' }),
      wset('w2a', 'e', 1, { isDropset: true, parentWeekPlanSetId: 'w2', stageIndex: 1, repMin: 8, repMax: 8 }),
      wset('w1', 'e', 1, { repMin: 8, repMax: 10 }),
    ]
    expect(thisWeekOnly(week, base)).toBe(false)
  })
})

describe('thisWeekOnly — true once the set count, a kind, the stages or a rep target differs', () => {
  it('a set added, or a set removed', () => {
    expect(thisWeekOnly([...WEEK(), wset('w4', 'e', 4, { repMin: 8, repMax: 10 })], DEFAULT())).toBe(true)
    expect(thisWeekOnly(WEEK().slice(0, 2), DEFAULT())).toBe(true)
  })

  it('a stage added (a set made a dropset with a drop)', () => {
    const week = [
      ...WEEK({ w3: { stageKind: 'dropset' } }),
      stage('w3a', 'w3', 'e', 1, { repMin: 8, repMax: 10 }),
    ]
    expect(thisWeekOnly(week, DEFAULT())).toBe(true)
  })

  it('a stage removed from a set the default has staged', () => {
    const base = [
      pset('p1', 'e', 1, { repMin: 8, repMax: 10, stageKind: 'dropset' }),
      pset('p1a', 'e', 1, { parentProgramSetId: 'p1', stageIndex: 1, repMin: 8, repMax: 10 }),
      pset('p1b', 'e', 1, { parentProgramSetId: 'p1', stageIndex: 2, repMin: 8, repMax: 10 }),
    ]
    const week = [wset('w1', 'e', 1, { repMin: 8, repMax: 10, stageKind: 'dropset' }), stage('w1a', 'w1', 'e', 1, { repMin: 8, repMax: 10 })]
    expect(thisWeekOnly(week, base)).toBe(true)
  })

  it('a set made a warmup', () => {
    expect(thisWeekOnly(WEEK({ w1: { isWarmup: true } }), DEFAULT())).toBe(true)
  })

  it('a warmup added above the working sets shifts every position after it', () => {
    const week = [wset('w0', 'e', 1, { isWarmup: true, repMin: 8, repMax: 10 }), ...WEEK().map((s, i) => ({ ...s, setNumber: i + 2 }))]
    expect(thisWeekOnly(week, DEFAULT())).toBe(true)
  })

  it('a set that is staged in the default and plain in the week, or the other way round', () => {
    const staged = [pset('p1', 'e', 1, { repMin: 8, repMax: 10, stageKind: 'dropset' }), pset('p1a', 'e', 1, { parentProgramSetId: 'p1', stageIndex: 1, repMin: 8, repMax: 10 })]
    expect(thisWeekOnly([wset('w1', 'e', 1, { repMin: 8, repMax: 10 })], staged)).toBe(true)
    expect(thisWeekOnly([wset('w1', 'e', 1, { repMin: 8, repMax: 10, stageKind: 'dropset' }), stage('w1a', 'w1', 'e', 1, { repMin: 8, repMax: 10 })], [pset('p1', 'e', 1, { repMin: 8, repMax: 10 })])).toBe(true)
  })

  it('the stage kind: a dropset in the default is a myo-reps set this week, the stages equal', () => {
    const base = [pset('p1', 'e', 1, { repMin: 8, repMax: 10, stageKind: 'dropset' }), pset('p1a', 'e', 1, { parentProgramSetId: 'p1', stageIndex: 1, repMin: 8, repMax: 10 })]
    const week = [wset('w1', 'e', 1, { repMin: 8, repMax: 10, stageKind: 'myo_reps' }), stage('w1a', 'w1', 'e', 1, { repMin: 8, repMax: 10 })]
    expect(thisWeekOnly(week, base)).toBe(true)
    // A null kind on a head that has stages reads as a dropset: the same set.
    expect(thisWeekOnly([wset('w1', 'e', 1, { repMin: 8, repMax: 10, stageKind: null }), stage('w1a', 'w1', 'e', 1, { repMin: 8, repMax: 10 })], base)).toBe(false)
  })

  it('a rep target changed: a number, a range, AMRAP, or cleared', () => {
    expect(thisWeekOnly(WEEK({ w2: { repMin: 12, repMax: 12 } }), DEFAULT())).toBe(true)
    expect(thisWeekOnly(WEEK({ w2: { repMin: 8, repMax: 12 } }), DEFAULT())).toBe(true)
    expect(thisWeekOnly(WEEK({ w2: { repMin: null, repMax: null, isAmrap: true } }), DEFAULT())).toBe(true)
    expect(thisWeekOnly(WEEK({ w2: { repMin: null, repMax: null } }), DEFAULT())).toBe(true)
  })

  it('a stage\'s rep target changed', () => {
    const base = [pset('p1', 'e', 1, { repMin: 8, repMax: 10, stageKind: 'dropset' }), pset('p1a', 'e', 1, { parentProgramSetId: 'p1', stageIndex: 1, repMin: 8, repMax: 8 })]
    const week = (rep: Partial<WeekPlanSet>) => [wset('w1', 'e', 1, { repMin: 8, repMax: 10, stageKind: 'dropset' }), stage('w1a', 'w1', 'e', 1, rep)]
    expect(thisWeekOnly(week({ repMin: 8, repMax: 8 }), base)).toBe(false)
    expect(thisWeekOnly(week({ repMin: 6, repMax: 6 }), base)).toBe(true)
  })

  it('a change plus unrelated weight changes is still a change; only the structure decides', () => {
    expect(thisWeekOnly(WEEK({ w1: { targetWeight: 80, repMin: 5, repMax: 5 } }), DEFAULT())).toBe(true)
  })
})

// ─── "+ ADD SET" ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('addSetDefaults — a Normal set with the previous set\'s rep target and no weight or RIR (Defaults 8)', () => {
  const NO_NUMBERS = { isWarmup: false, stageKind: null, targetWeight: null, targetRir: null, targetRirMax: null }

  it('takes the previous set\'s rep target as it is: a number, a range, or AMRAP', () => {
    expect(addSetDefaults(wset('p', 'e', 1, { repMin: 12, repMax: 12 }))).toEqual({ ...NO_NUMBERS, repMin: 12, repMax: 12, isAmrap: false })
    expect(addSetDefaults(wset('p', 'e', 1, { repMin: 8, repMax: 10 }))).toEqual({ ...NO_NUMBERS, repMin: 8, repMax: 10, isAmrap: false })
    expect(addSetDefaults(wset('p', 'e', 1, { repMin: null, repMax: null, isAmrap: true }))).toEqual({ ...NO_NUMBERS, repMin: null, repMax: null, isAmrap: true })
  })

  it('takes no weight and no RIR from the previous set, though it has both', () => {
    const next = addSetDefaults(wset('p', 'e', 1, { targetWeight: 142.5, targetRir: 1, targetRirMax: 2, repMin: 5, repMax: 5 }))
    expect(next.targetWeight).toBeNull()
    expect(next.targetRir).toBeNull()
    expect(next.targetRirMax).toBeNull()
    expect(next.repMin).toBe(5)
  })

  it('is a Normal set whatever the previous one is: not a warmup, not staged', () => {
    const warmup = addSetDefaults(wset('p', 'e', 1, { isWarmup: true, repMin: 12, repMax: 12 }))
    expect(warmup).toMatchObject({ isWarmup: false, stageKind: null, repMin: 12, repMax: 12 })
    const dropset = addSetDefaults(wset('p', 'e', 1, { stageKind: 'dropset', repMin: 8, repMax: 10 }))
    expect(dropset).toMatchObject({ isWarmup: false, stageKind: null, repMin: 8, repMax: 10 })
  })

  it('has no rep target when there is no previous set, or the previous set had none', () => {
    expect(addSetDefaults(null)).toEqual({ ...NO_NUMBERS, repMin: null, repMax: null, isAmrap: false })
    expect(addSetDefaults(undefined)).toEqual({ ...NO_NUMBERS, repMin: null, repMax: null, isAmrap: false })
    expect(addSetDefaults(wset('p', 'e', 1, { repMin: null, repMax: null }))).toEqual({ ...NO_NUMBERS, repMin: null, repMax: null, isAmrap: false })
  })

  it('an AMRAP carries no numbers even if the row has stray ones', () => {
    expect(addSetDefaults(wset('p', 'e', 1, { repMin: 6, repMax: 8, isAmrap: true }))).toMatchObject({ repMin: null, repMax: null, isAmrap: true })
  })
})
