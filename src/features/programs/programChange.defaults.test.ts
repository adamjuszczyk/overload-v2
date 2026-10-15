import { describe, it, expect } from 'vitest'
import { draftFromRunCopy, type DraftSet } from './programChange'
import { thisWeekOnly } from '../plan/weekPlanning'
import {
  type Db,
  type DbWeekPlanSet,
  type World,
  addExercise,
  addWorkout,
  applyOpsToDb,
  deletes,
  editSetsOf,
  inserts,
  newSet,
  newWorld,
  onlyRunCopy,
  onlySessions,
  planOf,
  planSession,
  runCopyOf,
  setDays,
  updates,
  weekSetOf,
  withReps,
} from './programChange.testutil'
import { weekDependentWorld } from './programChange.worlds.testutil'
import type { Op } from './programChange'

// Chunk 45 — a stable run's default sets land on the sessions that have not started (SPEC [1.2] Programs and runs →
// "How a save lands": "Stable default sets (count, kinds, stages, rep targets): applied to a not-done session's sets
// only where that session still matches the old default. A set changed for that week only ("THIS WEEK ONLY") is left as
// it is. Weights, RIR and cues on sets that stay are kept."), DECISIONS 105's lesson (a head's kind is ONE part, compared
// resolved), and TASKS 45's cases.
//
// The bench: Upper, one workout, Bench (three sets of 8–10) and Row (two of 10–12), planned for weeks 2 to 11. Week 2
// matches the default; each later week was changed for that week only, in the one way its name says. Every set carries a
// weight, a RIR and a cue, so a rule that touched them would show.

const BENCH = ['pe-b-s1', 'pe-b-s2', 'pe-b-s3']

function benchWorld(): World {
  const w = newWorld({ planningType: 'stable', scheduleType: 'weekday', currentWeek: 2 })
  addWorkout(w, 'w', 'Upper', 0)
  setDays(w, { monday: 'w' })
  addExercise(w, 'pe-b', 'w', 'ex-bench', 0, [{ reps: '8-10' }, { reps: '8-10' }, { reps: '8-10' }])
  addExercise(w, 'pe-r', 'w', 'ex-row', 1, [{ reps: '10-12' }, { reps: '10-12' }])
  for (let week = 2; week <= 11; week++) planSession(w, `w${week}`, 'w', week)
  const row = (plan: string, programSetId: string): DbWeekPlanSet => weekSetOf(w, plan, programSetId)
  // w3: set 2's rep target changed for that week
  Object.assign(row('w3', 'pe-b-s2'), { rep_min: 6, rep_max: 8 })
  // w4: a fourth set added in Plan (no program set)
  w.db.v2_week_plan_sets.push({ ...row('w4', 'pe-b-s3'), id: 'w4-extra', set_number: 4, program_set_id: null })
  // w5: set 3 removed
  w.db.v2_week_plan_sets = w.db.v2_week_plan_sets.filter((s) => s.id !== 'w5-pe-b-s3')
  // w6: set 1 turned into a warmup
  Object.assign(row('w6', 'pe-b-s1'), { is_warmup: true })
  // w7: set 2 turned into a dropset with a stage
  Object.assign(row('w7', 'pe-b-s2'), { stage_kind: 'dropset' })
  w.db.v2_week_plan_sets.push({ ...row('w7', 'pe-b-s2'), id: 'w7-stage', is_dropset: true, parent_week_plan_set_id: 'w7-pe-b-s2', stage_index: 1, stage_kind: null, program_set_id: null, rep_min: 6, rep_max: 8, tags: null })
  // w8: set 2 removed
  w.db.v2_week_plan_sets = w.db.v2_week_plan_sets.filter((s) => s.id !== 'w8-pe-b-s2')
  // w9: set 1 turned into a dropset with a stage
  Object.assign(row('w9', 'pe-b-s1'), { stage_kind: 'dropset' })
  w.db.v2_week_plan_sets.push({ ...row('w9', 'pe-b-s1'), id: 'w9-stage', is_dropset: true, parent_week_plan_set_id: 'w9-pe-b-s1', stage_index: 1, stage_kind: null, program_set_id: null, rep_min: 6, rep_max: 8, tags: null })
  // w10: set 1 turned into a warmup (as w6, kept apart so a test can name it)
  Object.assign(row('w10', 'pe-b-s1'), { is_warmup: true })
  // w11: set 1 turned into myo-reps with a stage
  Object.assign(row('w11', 'pe-b-s1'), { stage_kind: 'myo_reps' })
  w.db.v2_week_plan_sets.push({ ...row('w11', 'pe-b-s1'), id: 'w11-stage', is_dropset: true, parent_week_plan_set_id: 'w11-pe-b-s1', stage_index: 1, stage_kind: null, program_set_id: null, rep_min: 8, rep_max: 10, tags: null })
  return w
}

const draftOf = (w: World) => draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)
const benchSets = (edit: ReturnType<typeof draftOf>, fn: (sets: readonly DraftSet[]) => readonly DraftSet[]) => editSetsOf(edit, 'w', 'pe-b', fn)

// The plan a session-set op belongs to.
const planIdOf = (db: Db, o: Op): string | undefined =>
  o.op === 'insert' ? (o.row as { week_plan_id: string }).week_plan_id : db.v2_week_plan_sets.find((s) => s.id === o.id)?.week_plan_id

// Session-set ops by plan, each as "insert|update|delete <id>" with the patch of an update.
function bySession(db: Db, ops: readonly Op[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const o of onlySessions(ops)) {
    if (o.table !== 'v2_week_plan_sets') continue
    const plan = planIdOf(db, o)!
    const label = o.op === 'update' ? `update ${o.id} ${JSON.stringify(o.patch)}` : o.op === 'delete' ? `delete ${o.id}` : `insert ${(o.row as { set_number: number }).set_number}`
    ;(out[plan] ??= []).push(label)
  }
  return out
}
const reached = (db: Db, ops: readonly Op[]) => Object.keys(bySession(db, ops)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))

describe('a default set\'s rep target changes (set 2, 8–10 → 10–12)', () => {
  const w = benchWorld()
  const { ops, summary } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 1 ? withReps(s, '10-12') : s))))
  const landed = bySession(w.db, ops)
  const REPS = '{"rep_min":10,"rep_max":12,"is_amrap":false}'

  it('lands on every session whose set 2 still equals the old default', () => {
    for (const week of [2, 4, 5, 6, 9, 10, 11]) expect(landed[`w${week}`]).toEqual([`update w${week}-pe-b-s2 ${REPS}`])
  })

  it('and not on a session where set 2 was changed for that week only: its rep target, or its kind', () => {
    expect(landed.w3).toBeUndefined() // 6–8
    expect(landed.w7).toBeUndefined() // a dropset now
  })

  it('a session that has no set 2 any more has nothing to change; the sets left alone are counted', () => {
    expect(landed.w8).toBeUndefined()
    expect(summary.setsLeftAlone).toBe(3) // w3, w7 and w8
  })

  it('the run copy\'s default takes the new target', () => {
    expect(onlyRunCopy(ops)).toEqual([{ op: 'update', table: 'v2_program_sets', id: 'pe-b-s2', patch: { rep_min: 10, rep_max: 12, is_amrap: false } }])
  })

  it('weights, RIR and cues on the sets that take it are kept: no op names them, and the rows still hold them', () => {
    for (const o of updates(ops, 'v2_week_plan_sets')) {
      expect(Object.keys(o.patch).sort()).toEqual(['is_amrap', 'rep_max', 'rep_min'])
    }
    const after = applyOpsToDb(w.db, ops)
    const kept = after.v2_week_plan_sets.filter((s) => s.week_plan_id === 'w2' && s.program_exercise_id === 'pe-b')
    expect(kept.map((s) => [s.target_weight, s.target_rir, s.tags])).toEqual([[60, 2, ['push here']], [60, 2, ['push here']], [60, 2, ['push here']]])
    expect(kept.map((s) => s.rep_min)).toEqual([8, 10, 8])
  })

  it('another exercise\'s sets are not touched', () => {
    expect(ops.some((o) => 'id' in o && o.id.includes('pe-r'))).toBe(false)
  })

  it('a session in progress or done is not touched, whatever it holds', () => {
    const { ops: next } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 1 ? withReps(s, '10-12') : s))), { statuses: { w2: 'done', w4: 'in_progress' } })
    expect(reached(w.db, next)).toEqual(['w5', 'w6', 'w9', 'w10', 'w11'])
  })
})

describe('the sets a session counts as the default\'s — by the program set they name, else by position', () => {
  it('a session set that names a default set is that set, wherever it sits: removing set 2 this week and then from the default leaves set 3 alone', () => {
    // w8 removed its set 2 for that week; its set 3 is now the second one by position. The default drops set 2.
    const w = benchWorld()
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.filter((_, i) => i !== 1)))
    const landed = bySession(w.db, ops)
    expect(landed.w8).toBeUndefined() // nothing to drop there, and its set 3 is not "the second set"
    expect(applyOpsToDb(w.db, ops).v2_week_plan_sets.some((s) => s.id === 'w8-pe-b-s3')).toBe(true)
  })

  it('and a change to set 3 still reaches it: w8\'s set 3 is the default\'s set 3 though it sits second', () => {
    const w = benchWorld()
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 2 ? withReps(s, '12-15') : s))))
    expect(bySession(w.db, ops).w8).toEqual(['update w8-pe-b-s3 {"rep_min":12,"rep_max":15,"is_amrap":false}'])
  })

  it('the order a session\'s rows come in does not matter for matching by position', () => {
    const w = benchWorld()
    for (const s of w.db.v2_week_plan_sets) if (s.week_plan_id === 'w2') s.program_set_id = null
    w.db.v2_week_plan_sets.reverse()
    for (const [index, id] of [[0, 'w2-pe-b-s1'], [1, 'w2-pe-b-s2'], [2, 'w2-pe-b-s3']] as const) {
      const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === index ? withReps(s, '10-12') : s))))
      expect(bySession(w.db, ops).w2).toEqual([`update ${id} {"rep_min":10,"rep_max":12,"is_amrap":false}`]) // the first and the last would swap places if the rows were taken in the order they came
    }
  })

  it('a session set with no link (a fixture, or a week from before there were links) is matched by its position', () => {
    const w = benchWorld()
    for (const s of w.db.v2_week_plan_sets) if (s.week_plan_id === 'w2') s.program_set_id = null
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 1 ? withReps(s, '10-12') : s))))
    expect(bySession(w.db, ops).w2).toEqual(['update w2-pe-b-s2 {"rep_min":10,"rep_max":12,"is_amrap":false}'])
  })

  it('a link to another exercise\'s program set (1.1\'s swapped-in row) is no link of this exercise: matched by position', () => {
    const w = benchWorld()
    for (const s of w.db.v2_week_plan_sets) if (s.week_plan_id === 'w2' && s.program_exercise_id === 'pe-b') s.program_set_id = s.program_set_id!.replace('pe-b', 'pe-r')
    expect(w.db.v2_week_plan_sets.find((s) => s.id === 'w2-pe-b-s1')!.program_set_id).toBe('pe-r-s1')
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 1 ? withReps(s, '10-12') : s))))
    expect(bySession(w.db, ops).w2).toEqual(['update w2-pe-b-s2 {"rep_min":10,"rep_max":12,"is_amrap":false}'])
  })

  it('a link to a set the default already dropped is not a link to the default: nothing pairs with it', () => {
    const w = benchWorld()
    w.db.v2_program_sets.push({ ...w.db.v2_program_sets.find((s) => s.id === 'pe-b-s3')!, id: 'pe-b-old', position: 4, removed_at: '2026-10-01T00:00:00Z' })
    const row = w.db.v2_week_plan_sets.find((s) => s.id === 'w5-pe-b-s2')!
    row.program_set_id = 'pe-b-old' // w5's second set names a set the default dropped: it is that session's own set now
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 1 ? withReps(s, '10-12') : s))))
    expect(bySession(w.db, ops).w5).toBeUndefined()
  })

  it('a session that has the exercise no longer (nothing of it planned) has nothing to change and nothing counted as left alone', () => {
    const w = benchWorld()
    w.db.v2_week_plan_sets = w.db.v2_week_plan_sets.filter((s) => !(s.week_plan_id === 'w5' && s.program_exercise_id === 'pe-b'))
    w.db.v2_week_plan_exercises = w.db.v2_week_plan_exercises.filter((e) => !(e.week_plan_id === 'w5' && e.program_exercise_id === 'pe-b'))
    const { ops, summary } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 1 ? withReps(s, '10-12') : s))))
    expect(bySession(w.db, ops).w5).toBeUndefined()
    expect(summary.setsLeftAlone).toBe(3) // w3, w7 and w8, as before: not w5
  })

  it('two session sets naming the same default set: the first by set number is its counterpart, the other is nobody\'s', () => {
    const w = benchWorld()
    w.db.v2_week_plan_sets.push({ ...weekSetOf(w, 'w2', 'pe-b-s2'), id: 'w2-twin', set_number: 4 }) // names pe-b-s2 too
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 1 ? withReps(s, '10-12') : s))))
    expect(bySession(w.db, ops).w2).toEqual(['update w2-pe-b-s2 {"rep_min":10,"rep_max":12,"is_amrap":false}'])
  })

  it('a set with no link beyond the default\'s count is not paired with a set that a link already claimed', () => {
    const w = benchWorld()
    // w8 lost its set 2: its sets are s1, s3 (linked) and an extra with no link, third by number
    w.db.v2_week_plan_sets.push({ ...weekSetOf(w, 'w8', 'pe-b-s3'), id: 'w8-extra', set_number: 4, program_set_id: null })
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 2 ? withReps(s, '12-15') : s))))
    expect(bySession(w.db, ops).w8).toEqual(['update w8-pe-b-s3 {"rep_min":12,"rep_max":15,"is_amrap":false}']) // not the extra
  })

  it('a session\'s set added for that week only is nobody\'s: a change to a default set never reaches it, by position or otherwise', () => {
    const w = benchWorld()
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s) => withReps(s, '4-5'))))
    expect(JSON.stringify(ops)).not.toContain('w4-extra')
  })

  it('matches the way chunk 42\'s THIS WEEK ONLY does: a session takes every set of a change to all of them exactly when it is not THIS WEEK ONLY', () => {
    const w = benchWorld()
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s) => withReps(s, '4-5'))))
    const landed = bySession(w.db, ops)
    const rc = runCopyOf(w.db, w.programId, w.mesocycleId)
    for (let week = 2; week <= 11; week++) {
      const sets = w.db.v2_week_plan_sets.filter((s) => s.week_plan_id === `w${week}` && s.program_exercise_id === 'pe-b').map((s) => ({
        id: s.id,
        programExerciseId: s.program_exercise_id,
        setNumber: s.set_number,
        parentWeekPlanSetId: s.parent_week_plan_set_id,
        stageIndex: s.stage_index,
        isWarmup: s.is_warmup,
        stageKind: s.stage_kind,
        targetWeight: s.target_weight,
        targetRir: s.target_rir,
        targetRirMax: s.target_rir_max,
        repMin: s.rep_min,
        repMax: s.rep_max,
        isAmrap: s.is_amrap,
      }))
      // THIS WEEK ONLY is the whole exercise's: its count differs, or some set does. The module decides set by set, so the
      // two agree exactly when a session has the default's count and takes every set.
      const heads = sets.filter((s) => s.parentWeekPlanSetId === null).length
      const takesEverySet = heads === 3 && (landed[`w${week}`] ?? []).filter((l) => l.startsWith('update')).length === 3
      expect(takesEverySet, `w${week}`).toBe(!thisWeekOnly(sets, rc.sets.filter((s) => s.programExerciseId === 'pe-b')))
    }
  })
})

describe('a default set is added — only where the session still has the default\'s count', () => {
  const w = benchWorld()
  const { ops, summary } = planOf(w, benchSets(draftOf(w), (sets) => [...sets, newSet('8-10')]))

  it('the sessions with three sets take it, as a fourth set after their highest, linked to the new program set', () => {
    const program = inserts(ops, 'v2_program_sets').map((o) => o.row)
    expect(program).toHaveLength(1)
    expect([program[0].program_exercise_id, program[0].position, program[0].rep_min, program[0].rep_max]).toEqual(['pe-b', 4, 8, 10])
    const sessionInserts = inserts(ops, 'v2_week_plan_sets').map((o) => o.row)
    expect(sessionInserts.map((r) => r.week_plan_id)).toEqual(['w2', 'w3', 'w6', 'w7', 'w9', 'w10', 'w11'])
    for (const r of sessionInserts) {
      expect([r.set_number, r.program_set_id, r.rep_min, r.rep_max, r.is_dropset, r.target_weight, r.target_rir, r.tags]).toEqual([4, program[0].id, 8, 10, false, null, null, null])
    }
  })

  it('a session whose count is not the default\'s (a set added or removed for that week only) keeps its own count', () => {
    expect(reached(w.db, ops)).not.toContain('w4') // four sets
    expect(reached(w.db, ops)).not.toContain('w5') // two sets
    expect(reached(w.db, ops)).not.toContain('w8') // two sets
    expect(summary.setsLeftAlone).toBe(3)
  })

  it('the new set\'s number is after the session\'s highest, not the default\'s position', () => {
    const w2 = benchWorld()
    for (const s of w2.db.v2_week_plan_sets.filter((x) => x.week_plan_id === 'w2' && x.program_exercise_id === 'pe-b')) s.set_number += 10 // numbers from an older week: 11, 12, 13
    const { ops: next } = planOf(w2, benchSets(draftOf(w2), (sets) => [...sets, newSet('8-10')]))
    expect(inserts(next, 'v2_week_plan_sets').find((o) => o.row.week_plan_id === 'w2')!.row.set_number).toBe(14)
  })

  it('the rows are accepted by the database', () => {
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })

  it('a new set after a stable exercise that had none: sessions with none take it', () => {
    const empty = benchWorld()
    empty.db.v2_week_plan_sets = empty.db.v2_week_plan_sets.filter((s) => s.program_exercise_id !== 'pe-r')
    empty.db.v2_program_sets = empty.db.v2_program_sets.filter((s) => s.program_exercise_id !== 'pe-r')
    const edit = editSetsOf(draftOf(empty), 'w', 'pe-r', () => [newSet('12')])
    const { ops: next } = planOf(empty, edit)
    expect(inserts(next, 'v2_week_plan_sets').filter((o) => o.row.program_exercise_id === 'pe-r').map((o) => o.row.set_number)).toEqual(Array(10).fill(1))
  })
})

describe('several default sets added at once', () => {
  it('numbered one after another from after the session\'s highest, in the order the draft lists them', () => {
    const w = benchWorld()
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => [...sets, newSet('8-10'), newSet('12')]))
    expect(inserts(ops, 'v2_week_plan_sets').filter((o) => o.row.week_plan_id === 'w2').map((o) => [o.row.set_number, o.row.rep_min])).toEqual([[4, 8], [5, 12]])
    expect(inserts(ops, 'v2_program_sets').map((o) => [o.row.position, o.row.rep_min])).toEqual([[4, 8], [5, 12]])
  })
})

describe('a default set is dropped — "removed" from the sessions where it still is what it was', () => {
  const w = benchWorld()
  const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.filter((_, i) => i !== 1)))
  const landed = bySession(w.db, ops)

  it('the run copy soft-removes it (a set the default drops is never deleted: planned weeks keep their link)', () => {
    expect(onlyRunCopy(ops)).toEqual([{ op: 'update', table: 'v2_program_sets', id: 'pe-b-s2', patch: { removed_at: '2026-10-15T12:00:00.000Z' } }])
  })

  it('the sessions where set 2 still equals the default lose it; the others keep their set 2', () => {
    for (const week of [2, 4, 5, 6, 9, 10, 11]) expect(landed[`w${week}`]).toEqual([`delete w${week}-pe-b-s2`])
    expect(landed.w3).toBeUndefined()
    expect(landed.w7).toBeUndefined()
  })

  it('the sets that stay keep their weight, RIR and cues; the remaining ones are what the default has left', () => {
    const after = applyOpsToDb(w.db, ops)
    const left = after.v2_week_plan_sets.filter((s) => s.week_plan_id === 'w2' && s.program_exercise_id === 'pe-b')
    expect(left.map((s) => [s.id, s.target_weight, s.target_rir])).toEqual([['w2-pe-b-s1', 60, 2], ['w2-pe-b-s3', 60, 2]])
  })

  it('the default\'s later sets keep their positions (nothing renumbered that did not have to move)', () => {
    expect(updates(ops, 'v2_program_sets').map((o) => Object.keys(o.patch))).toEqual([['removed_at']])
  })

  it('dropping the last set, and dropping every set', () => {
    const last = planOf(w, benchSets(draftOf(w), (sets) => sets.slice(0, 2))).ops
    expect(bySession(w.db, last).w2).toEqual(['delete w2-pe-b-s3'])
    const all = planOf(w, benchSets(draftOf(w), () => [])).ops
    expect(bySession(w.db, all).w2).toEqual(['delete w2-pe-b-s1', 'delete w2-pe-b-s2', 'delete w2-pe-b-s3'])
  })

  it('a dropped set\'s stages go with it: first, and the run copy removes them too', () => {
    const d = dropWorld()
    const { ops: next } = planOf(d, editSetsOf(draftOf(d), 'w', 'pe-d', () => []))
    expect(deletes(next, 'v2_week_plan_sets').filter((o) => o.id.startsWith('d2-')).map((o) => o.id)).toEqual(['d2-pe-d-s1-t1', 'd2-pe-d-s1', 'd2-pe-d-s2'])
    expect(updates(next, 'v2_program_sets').map((o) => o.id)).toEqual(['pe-d-s1', 'pe-d-s1-t1', 'pe-d-s2'])
  })
})

describe('a default set\'s kind changes — one part, compared resolved (DECISIONS 105)', () => {
  it('working → dropset with a stage: the head gets the kind and a stage row, in the sessions where it was a plain set', () => {
    const w = benchWorld()
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 0 ? { ...s, stageKind: 'dropset', stages: [{ id: null, repMin: 6, repMax: 8, isAmrap: false }] } : s))))
    // the run copy: the head's kind and a new stage under it
    const rc = onlyRunCopy(ops)
    expect(rc.filter((o) => o.op === 'update')).toEqual([{ op: 'update', table: 'v2_program_sets', id: 'pe-b-s1', patch: { stage_kind: 'dropset' } }])
    const stage = inserts(rc, 'v2_program_sets')[0].row
    expect([stage.parent_program_set_id, stage.stage_index, stage.position, stage.rep_min, stage.rep_max, stage.stage_kind]).toEqual(['pe-b-s1', 1, 1, 6, 8, null])
    // sessions: w2 takes it
    const w2 = inserts(ops, 'v2_week_plan_sets').find((o) => o.row.week_plan_id === 'w2')!.row
    expect([w2.parent_week_plan_set_id, w2.stage_index, w2.set_number, w2.is_dropset, w2.rep_min, w2.rep_max, w2.program_set_id, w2.stage_kind]).toEqual(['w2-pe-b-s1', 1, 1, true, 6, 8, stage.id, null])
    expect(updates(ops, 'v2_week_plan_sets').find((o) => o.id === 'w2-pe-b-s1')!.patch).toEqual({ stage_kind: 'dropset' })
    // not on the sessions where set 1 had become something else this week: a warmup, a dropset, myo-reps
    expect(reached(w.db, ops)).not.toContain('w6')
    expect(reached(w.db, ops)).not.toContain('w9')
    expect(reached(w.db, ops)).not.toContain('w10')
    expect(reached(w.db, ops)).not.toContain('w11')
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })

  it('105 case 1: the default makes set 1 a warmup; a session that had turned it into a dropset with a stage is skipped as a whole', () => {
    const w = benchWorld()
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 0 ? { ...s, isWarmup: true } : s))))
    const landed = bySession(w.db, ops)
    expect(landed.w2).toEqual(['update w2-pe-b-s1 {"is_warmup":true}'])
    expect(landed.w9).toBeUndefined() // a warmup that is also a dropset with a stage is what 105 found written
    expect(JSON.stringify(ops)).not.toContain('w9-')
    expect(onlyRunCopy(ops)).toEqual([{ op: 'update', table: 'v2_program_sets', id: 'pe-b-s1', patch: { is_warmup: true } }]) // and the default itself
  })

  it('105 case 2: the default stages set 1 as a dropset; a session that had made it a warmup is skipped as a whole', () => {
    const w = benchWorld()
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 0 ? { ...s, stageKind: 'dropset', stages: [{ id: null, repMin: 6, repMax: 8, isAmrap: false }] } : s))))
    expect(JSON.stringify(ops)).not.toContain('w10-')
    expect(JSON.stringify(ops)).not.toContain('w6-')
  })

  it('105 case 3: the default adds a stage to a dropset; a session that changed it to myo-reps, or to a warmup, gets no stage', () => {
    const d = dropWorld()
    const draft = editSetsOf(draftOf(d), 'w', 'pe-d', (sets) => sets.map((s, i) => (i === 0 ? { ...s, stages: [...s.stages, { id: null, repMin: 6, repMax: 8, isAmrap: false }] } : s)))
    const { ops } = planOf(d, draft)
    expect(reached(d.db, ops).sort()).toEqual(['d2'])
    const stage = inserts(ops, 'v2_week_plan_sets')[0].row
    expect([stage.week_plan_id, stage.parent_week_plan_set_id, stage.stage_index, stage.set_number]).toEqual(['d2', 'd2-pe-d-s1', 2, 1]) // after the existing stage
  })

  it('the kind is compared resolved: a legacy head with a stage and no kind reads as a dropset, as the session\'s dropset does', () => {
    const d = dropWorld({ legacyNull: true })
    const draft = editSetsOf(draftOf(d), 'w', 'pe-d', (sets) => sets.map((s, i) => (i === 0 ? { ...s, stages: s.stages.map((st) => ({ ...st, repMin: 5, repMax: 7 })) } : s)))
    const { ops } = planOf(d, draft)
    // d2's head says 'dropset', the default's says nothing: the same kind; d3's says rest-pause: a different one
    expect(bySession(d.db, ops).d2).toEqual(['update d2-pe-d-s1-t1 {"rep_min":5,"rep_max":7,"is_amrap":false}'])
    expect(bySession(d.db, ops).d3).toBeUndefined()
  })

  it('a stage kind on a head with no stages is no kind at all: it is not a difference', () => {
    const w = benchWorld()
    Object.assign(weekSetOf(w, 'w2', 'pe-b-s2'), { stage_kind: 'cluster' }) // a leftover kind, no stages under it
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 1 ? withReps(s, '10-12') : s))))
    expect(bySession(w.db, ops).w2).toEqual(['update w2-pe-b-s2 {"rep_min":10,"rep_max":12,"is_amrap":false}'])
  })

  it('dropset → normal removes the stages from the sessions where they are the default\'s', () => {
    const d = dropWorld()
    const { ops } = planOf(d, editSetsOf(draftOf(d), 'w', 'pe-d', (sets) => sets.map((s, i) => (i === 0 ? { ...s, stageKind: null, stages: [] } : s))))
    expect(bySession(d.db, ops).d2).toEqual(['update d2-pe-d-s1 {"stage_kind":null}', 'delete d2-pe-d-s1-t1'])
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, o.patch])).toEqual([
      ['pe-d-s1', { stage_kind: null }],
      ['pe-d-s1-t1', { removed_at: '2026-10-15T12:00:00.000Z' }],
    ])
    expect(() => applyOpsToDb(d.db, ops)).not.toThrow()
  })

  it('a dropset\'s drops go down by one: the last stage is removed where the session still has them as they were', () => {
    const d = dropWorld({ stages: 2 })
    const { ops } = planOf(d, editSetsOf(draftOf(d), 'w', 'pe-d', (sets) => sets.map((s, i) => (i === 0 ? { ...s, stages: s.stages.slice(0, 1) } : s))))
    expect(bySession(d.db, ops).d2).toEqual(['delete d2-pe-d-s1-t2'])
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, o.patch])).toEqual([['pe-d-s1-t2', { removed_at: '2026-10-15T12:00:00.000Z' }]])
  })

  it('a stage\'s rep target changes: it lands on the session\'s stage of that index, in sessions that still match', () => {
    const d = dropWorld()
    const draft = editSetsOf(draftOf(d), 'w', 'pe-d', (sets) => sets.map((s, i) => (i === 0 ? { ...s, stages: s.stages.map((st) => withReps(st as unknown as DraftSet, '5-7') as unknown as DraftSet['stages'][number]) } : s)))
    const { ops } = planOf(d, draft)
    expect(bySession(d.db, ops).d2).toEqual(['update d2-pe-d-s1-t1 {"rep_min":5,"rep_max":7,"is_amrap":false}'])
    expect(bySession(d.db, ops).d5).toBeUndefined() // its stage was changed for that week
    expect(onlyRunCopy(ops)).toEqual([{ op: 'update', table: 'v2_program_sets', id: 'pe-d-s1-t1', patch: { rep_min: 5, rep_max: 7, is_amrap: false } }]) // and the default's stage row
  })

  it('several stages dropped at once go from the highest index down', () => {
    const d = dropWorld({ stages: 3 })
    const { ops } = planOf(d, editSetsOf(draftOf(d), 'w', 'pe-d', (sets) => sets.map((s, i) => (i === 0 ? { ...s, stages: s.stages.slice(0, 1) } : s))))
    expect(deletes(ops, 'v2_week_plan_sets').filter((o) => o.id.startsWith('d2-')).map((o) => o.id)).toEqual(['d2-pe-d-s1-t3', 'd2-pe-d-s1-t2'])
    expect(() => applyOpsToDb(d.db, ops)).not.toThrow()
  })

  it('a stage keeps the index it has: drop the middle one of three and the third stays third; a new stage goes after the highest', () => {
    const d = dropWorld({ stages: 3 })
    const draft = editSetsOf(draftOf(d), 'w', 'pe-d', (sets) => sets.map((s, i) => (i === 0 ? { ...s, stages: [s.stages[0], s.stages[2], { id: null, repMin: 4, repMax: 6, isAmrap: false }] } : s)))
    const { ops } = planOf(d, draft)
    expect(bySession(d.db, ops).d2).toEqual(['insert 1', 'delete d2-pe-d-s1-t2'])
    expect(inserts(ops, 'v2_week_plan_sets').find((o) => o.row.week_plan_id === 'd2')!.row.stage_index).toBe(4)
    const program = inserts(ops, 'v2_program_sets')
    expect(program.map((o) => [o.row.parent_program_set_id, o.row.stage_index])).toEqual([['pe-d-s1', 4]])
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, o.patch])).toEqual([['pe-d-s1-t2', { removed_at: '2026-10-15T12:00:00.000Z' }]])
    expect(() => applyOpsToDb(d.db, ops)).not.toThrow()
  })

  it('normal → warmup: the flag changes and RIR stays where it is (a warmup row has no RIR cell, the number is just not shown)', () => {
    const w = benchWorld()
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 0 ? { ...s, isWarmup: true } : s))))
    expect(bySession(w.db, ops).w2).toEqual(['update w2-pe-b-s1 {"is_warmup":true}'])
    expect(applyOpsToDb(w.db, ops).v2_week_plan_sets.find((s) => s.id === 'w2-pe-b-s1')!.target_rir).toBe(2)
  })

  it('a warmup can never be staged: a draft that does it is refused', () => {
    const w = benchWorld()
    expect(() => planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 0 ? { ...s, isWarmup: true, stages: [{ id: null, repMin: 6, repMax: 8, isAmrap: false }] } : s))))).toThrow(/warmup can never be staged/)
  })
})

describe('rest and positions are run-wide: no session row changes', () => {
  it('REST AFTER and REST BETWEEN are written on the run copy\'s sets and nowhere else', () => {
    const d = dropWorld()
    const draft = editSetsOf(draftOf(d), 'w', 'pe-d', (sets) => sets.map((s, i) => (i === 0 ? { ...s, restSeconds: 90, stageRestSeconds: 20 } : { ...s, restSeconds: 120 })))
    const { ops } = planOf(d, draft)
    expect(onlySessions(ops)).toEqual([])
    expect(updates(ops, 'v2_program_sets').map((o) => [o.id, o.patch])).toEqual([
      ['pe-d-s1', { stage_rest_seconds: 20, rest_seconds: 90 }],
      ['pe-d-s2', { rest_seconds: 120 }],
    ])
  })

  it('a rep target change and a rest change in one edit: the session still gets only the rep target', () => {
    const w = benchWorld()
    const { ops } = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 1 ? { ...withReps(s, '10-12'), restSeconds: 150 } : s))))
    expect(bySession(w.db, ops).w2).toEqual(['update w2-pe-b-s2 {"rep_min":10,"rep_max":12,"is_amrap":false}'])
    expect(onlyRunCopy(ops)).toEqual([{ op: 'update', table: 'v2_program_sets', id: 'pe-b-s2', patch: { rep_min: 10, rep_max: 12, is_amrap: false, rest_seconds: 150 } }])
  })

  it('a default that changes nothing writes nothing', () => {
    const w = benchWorld()
    expect(planOf(w, draftOf(w)).ops).toEqual([])
  })

  it('the default\'s sets reordered: the run copy renumbers them (a stage follows its head) and no session row is touched', () => {
    const d = dropWorld() // set 1 is a dropset with a stage, set 2 a plain set
    const { ops } = planOf(d, editSetsOf(draftOf(d), 'w', 'pe-d', (sets) => [sets[1], sets[0]]))
    expect(onlySessions(ops)).toEqual([])
    expect(onlyRunCopy(ops)).toEqual([
      { op: 'update', table: 'v2_program_sets', id: 'pe-d-s2', patch: { position: 1 } },
      { op: 'update', table: 'v2_program_sets', id: 'pe-d-s1', patch: { position: 2 } },
      { op: 'update', table: 'v2_program_sets', id: 'pe-d-s1-t1', patch: { position: 2 } },
    ])
    expect(() => applyOpsToDb(d.db, ops)).not.toThrow()
  })

  it('a swapped exercise\'s new default is numbered from 1, whatever numbers the old one had', () => {
    const w = benchWorld()
    w.db.v2_program_sets.find((s) => s.id === 'pe-b-s3')!.position = 7 // 1, 2, 7
    const edit = draftOf(w)
    const swapped = {
      ...edit,
      workouts: edit.workouts.map((wo) => ({
        ...wo,
        exercises: wo.exercises.map((e) => (e.kind === 'kept' && e.id === 'pe-b' ? { kind: 'swapped' as const, replaces: 'pe-b', exerciseId: 'ex-incline', supersetBlockId: null, restSeconds: null, restAfterSeconds: null, tempo: null, weightUnit: null, sets: e.sets } : e)),
      })),
    }
    const { ops } = planOf(w, swapped)
    expect(inserts(ops, 'v2_program_sets').map((o) => o.row.position)).toEqual([1, 2, 3])
  })

  it('an AMRAP rep target is the flag with no numbers, and a rep target that is none is all empty', () => {
    const w = benchWorld()
    const amrap = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 0 ? withReps(s, 'amrap') : s)))).ops
    expect(updates(amrap, 'v2_program_sets').map((o) => o.patch)).toEqual([{ rep_min: null, rep_max: null, is_amrap: true }])
    const none = planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 0 ? withReps(s, '') : s)))).ops
    expect(updates(none, 'v2_program_sets').map((o) => o.patch)).toEqual([{ rep_min: null, rep_max: null, is_amrap: false }])
  })

  it('a rep target the database would refuse is refused here', () => {
    const w = benchWorld()
    const bad = (patch: Partial<DraftSet>) => benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 0 ? { ...s, ...patch } : s)))
    expect(() => planOf(w, bad({ repMin: 10, repMax: 8 }))).toThrow(/high end/)
    expect(() => planOf(w, bad({ repMin: null, repMax: 8 }))).toThrow(/high end/)
    expect(() => planOf(w, bad({ repMin: 0, repMax: 8 }))).toThrow(/low end/)
    expect(() => planOf(w, bad({ repMin: 8, repMax: 8, isAmrap: true }))).toThrow(/AMRAP/)
    expect(() => planOf(w, bad({ repMin: 8, repMax: null, isAmrap: true }))).toThrow(/AMRAP/)
    expect(() => planOf(w, bad({ repMin: null, repMax: 8, isAmrap: true }))).toThrow(/AMRAP/)
  })

  it('the edges of what the database allows are allowed here: a rep target of 1, a rest of 0', () => {
    const w = benchWorld()
    const ok = (patch: Partial<DraftSet>) => planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 0 ? { ...s, ...patch } : s))))
    expect(updates(ok({ repMin: 1, repMax: 1 }).ops, 'v2_program_sets').map((o) => o.patch)).toEqual([{ rep_min: 1, rep_max: 1, is_amrap: false }])
    expect(updates(ok({ restSeconds: 0, stageRestSeconds: 0 }).ops, 'v2_program_sets').map((o) => o.patch)).toEqual([{ rest_seconds: 0, stage_rest_seconds: 0 }])
  })

  it('a refused set is named by where it is in the list', () => {
    const w = benchWorld()
    expect(() => planOf(w, benchSets(draftOf(w), (sets) => sets.map((s, i) => (i === 1 ? { ...s, repMin: 10, repMax: 8 } : s))))).toThrow(/workout w, exercise 1, set 2: the rep target's high end/)
    const d = dropWorld()
    expect(() => planOf(d, editSetsOf(draftOf(d), 'w', 'pe-d', (sets) => sets.map((s, i) => (i === 0 ? { ...s, stages: [{ ...s.stages[0], repMin: 9, repMax: 3 }] } : s))))).toThrow(/workout w, exercise 1, set 1, stage 1: the rep target's high end/)
  })
})

describe('a week-dependent run holds no sets: what the draft says about them is ignored', () => {
  it('no program set is written and no planned set is touched', () => {
    const w = weekDependentWorld()
    const edit = editSetsOf(draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), 'week_dependent'), 'push', 'pe-bench', () => [newSet('3')])
    expect(edit.workouts.find((x) => x.id === 'push')!.exercises[0]).not.toHaveProperty('sets', undefined)
    expect(planOf(w, edit).ops).toEqual([])
  })

  it('the identity draft of a week-dependent run carries no sets at all', () => {
    const w = weekDependentWorld()
    for (const wo of draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), 'week_dependent').workouts) {
      for (const e of wo.exercises) expect(e.sets).toBeUndefined()
    }
  })
})

describe('a draft that names sets the default does not have is refused before anything is written', () => {
  it('a set that is not this exercise\'s: another exercise\'s, or none', () => {
    const w = benchWorld()
    expect(() => planOf(w, benchSets(draftOf(w), (sets) => [...sets, { ...sets[0], id: 'pe-r-s1' }]))).toThrow(/workout w, exercise 1, set 4: set pe-r-s1 is not a set of this exercise's default/)
    expect(() => planOf(w, benchSets(draftOf(w), (sets) => [...sets, { ...sets[0], id: 'nowhere' }]))).toThrow(/set 4: set nowhere is not a set of this exercise's default/)
  })

  it('a set listed twice', () => {
    const w = benchWorld()
    expect(() => planOf(w, benchSets(draftOf(w), (sets) => [...sets, sets[0]]))).toThrow(/set 4: set pe-b-s1 is listed twice/)
  })

  it('a stage that is not the set\'s, and a stage listed twice', () => {
    const d = dropWorld()
    const withStages = (stages: (s: DraftSet) => DraftSet['stages']) => editSetsOf(draftOf(d), 'w', 'pe-d', (sets) => sets.map((s, i) => (i === 0 ? { ...s, stages: stages(s) } : s)))
    expect(() => planOf(d, withStages((s) => [{ ...s.stages[0], id: 'nowhere' }]))).toThrow(/set 1: stage nowhere is not a stage of this set/)
    expect(() => planOf(d, withStages((s) => [s.stages[0], s.stages[0]]))).toThrow(/set 1: stage pe-d-s1-t1 is listed twice/)
  })
})

describe('swapping an exercise whose first set is a dropset', () => {
  it('each session stage is linked to its own copy of the stage; a stage added for that week only stays unlinked', () => {
    const d = dropWorld({ stages: 2 })
    d.db.v2_week_plan_sets.push({ ...d.db.v2_week_plan_sets.find((s) => s.id === 'd2-pe-d-s1-t2')!, id: 'd2-extra-stage', stage_index: 3, program_set_id: null })
    // and one that names a default stage but sits at an index the default has no stage for: no stage stands behind it
    d.db.v2_week_plan_sets.push({ ...d.db.v2_week_plan_sets.find((s) => s.id === 'd2-pe-d-s1-t2')!, id: 'd2-odd-stage', stage_index: 4, program_set_id: 'pe-d-s1-t1' })
    const edit = draftOf(d)
    const swapped = {
      ...edit,
      workouts: edit.workouts.map((wo) => ({
        ...wo,
        exercises: wo.exercises.map((e) => (e.kind === 'kept' && e.id === 'pe-d' ? { kind: 'swapped' as const, replaces: 'pe-d', exerciseId: 'ex-new', supersetBlockId: null, restSeconds: null, restAfterSeconds: null, tempo: null, weightUnit: null, sets: e.sets } : e)),
      })),
    }
    const { ops } = planOf(d, swapped)
    const copies = inserts(ops, 'v2_program_sets').map((o) => o.row)
    const stageCopy = (index: number) => copies.find((r) => r.parent_program_set_id !== null && r.stage_index === index)!.id
    const patch = (id: string) => updates(ops, 'v2_week_plan_sets').find((o) => o.id === id)!.patch
    expect(patch('d2-pe-d-s1').program_set_id).toBe(copies.find((r) => r.parent_program_set_id === null && r.position === 1)!.id)
    expect(patch('d2-pe-d-s1-t1').program_set_id).toBe(stageCopy(1))
    expect(patch('d2-pe-d-s1-t2').program_set_id).toBe(stageCopy(2))
    expect('program_set_id' in patch('d2-extra-stage')).toBe(false) // it had none and gets none
    expect(patch('d2-odd-stage').program_set_id).toBeNull() // it had a link nothing stands behind: cleared
    expect(() => applyOpsToDb(d.db, ops)).not.toThrow()
  })
})

describe('swapping an exercise and editing its sets in one save', () => {
  it('the swap lands first and the edit after it, on the same set rows: one op per row, pointing at the new exercise', () => {
    const w = benchWorld()
    const swap = draftOf(w)
    const edit = {
      ...swap,
      workouts: swap.workouts.map((wo) => ({
        ...wo,
        exercises: wo.exercises.map((e) =>
          e.kind === 'kept' && e.id === 'pe-b'
            ? {
                kind: 'swapped' as const,
                replaces: 'pe-b',
                exerciseId: 'ex-incline',
                supersetBlockId: null,
                restSeconds: null,
                restAfterSeconds: null,
                tempo: null,
                weightUnit: null,
                sets: (e.sets ?? []).map((s, i) => (i === 1 ? withReps(s, '10-12') : s)),
              }
            : e,
        ),
      })),
    }
    const { ops } = planOf(w, edit)
    const created = inserts(ops, 'v2_program_exercises')[0].row.id
    const copies = inserts(ops, 'v2_program_sets').map((o) => o.row)
    expect(copies.map((r) => [r.position, r.rep_min, r.rep_max])).toEqual([[1, 8, 10], [2, 10, 12], [3, 8, 10]]) // the new row's default has the edit
    const w2 = updates(ops, 'v2_week_plan_sets').filter((o) => o.id.startsWith('w2-pe-b'))
    expect(w2.map((o) => o.id)).toEqual(['w2-pe-b-s1', 'w2-pe-b-s2', 'w2-pe-b-s3'])
    expect(w2[0].patch).toEqual({ program_exercise_id: created, target_weight: null, target_rir: null, target_rir_max: null, tags: null, program_set_id: copies[0].id })
    expect(w2[1].patch).toEqual({ program_exercise_id: created, target_weight: null, target_rir: null, target_rir_max: null, tags: null, program_set_id: copies[1].id, rep_min: 10, rep_max: 12, is_amrap: false })
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })
})

// A workout with one dropset exercise: Dips with set 1 a dropset (a stage of 8–10) and set 2 plain. Sessions d2..d5:
// d2 matches; d3's set 1 became myo-reps; d4's set 1 became a warmup; d5's stage rep target was changed for that week.
function dropWorld(opts: { legacyNull?: boolean; stages?: number } = {}): World {
  const w = newWorld({ planningType: 'stable', scheduleType: 'weekday', currentWeek: 2 })
  addWorkout(w, 'w', 'Upper', 0)
  setDays(w, { monday: 'w' })
  const stages = Array.from({ length: opts.stages ?? 1 }, () => '8-10')
  addExercise(w, 'pe-d', 'w', 'ex-dip', 0, [{ reps: '10-12', kind: opts.legacyNull ? null : 'dropset', stages }, { reps: '10-12' }])
  if (opts.legacyNull) w.db.v2_program_sets.find((s) => s.id === 'pe-d-s1')!.stage_kind = null
  for (const week of [2, 3, 4, 5]) planSession(w, `d${week}`, 'w', week)
  // d2 as planned from it; a legacy default's session has the kind its head was given when planned from it (null) — and d2
  // here says 'dropset' explicitly in the legacy case, which is the same kind
  if (opts.legacyNull) weekSetOf(w, 'd2', 'pe-d-s1').stage_kind = 'dropset'
  weekSetOf(w, 'd3', 'pe-d-s1').stage_kind = opts.legacyNull ? 'rest_pause' : 'myo_reps'
  weekSetOf(w, 'd4', 'pe-d-s1').stage_kind = null
  weekSetOf(w, 'd4', 'pe-d-s1').is_warmup = true
  w.db.v2_week_plan_sets = w.db.v2_week_plan_sets.filter((s) => s.id !== 'd4-pe-d-s1-t1')
  Object.assign(w.db.v2_week_plan_sets.find((s) => s.id === 'd5-pe-d-s1-t1')!, { rep_min: 6, rep_max: 8 })
  return w
}
void BENCH
