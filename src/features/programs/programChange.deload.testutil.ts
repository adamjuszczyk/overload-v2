// Marking a session deload and unmarking it on programChange.testutil.ts's tables, through the app's OWN write functions
// (weekPlanService.ts's applyCalculatedDeloadMark and applyDeloadRestore, with their injectable ops), so that the saved
// pre-deload copy is the one the app saves and the restore is the one the app runs (DECISIONS 142). Not a test file and
// imported by nothing in the app. A test that imports this file mocks '../../lib/supabase' (weekPlanService.ts imports
// the real client at load time); none of the functions used here reaches it, every write goes through the injected ops.

import { calculateDeloadSets, type DeloadRules } from '../../lib/deloadRules'
import {
  applyCalculatedDeloadMark,
  applyDeloadRestore,
  insertCalculatedPlanSets,
  insertRestoredPlanSets,
} from '../plan/weekPlanService'
import { type Db, type DbWeekPlanSet, USER, checkInserted } from './programChange.testutil'

// "Sets −50 %, rounded down" (SPEC, Deload: the global default when rules are turned on), nothing else.
export const HALF_THE_SETS: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' } }

const planRow = (db: Db, planId: string) => db.v2_week_plans.find((p) => p.id === planId)!

// A set row the way the app inserts one (a payload with only the columns it names): the columns it leaves out take the
// table's defaults, the foreign keys and checks are the executor's.
function insertOne(db: Db): (payload: Record<string, unknown>) => Promise<{ id: string }> {
  let n = 0
  return async (payload) => {
    const row = {
      parent_week_plan_set_id: null,
      target_rir_max: null,
      ...payload,
      id: `inserted-${String(payload.week_plan_id)}-${++n}`,
    } as unknown as DbWeekPlanSet
    checkInserted(db, 'v2_week_plan_sets', row)
    return { id: row.id }
  }
}

// markSessionDeload with rules on and no earlier occurrence to calculate from (the session's own sets are the base): the
// pre-mark sets are saved to `deload_restore`, the session's sets are replaced by the calculated ones, `is_deload` is set.
export async function markDeload(db: Db, planId: string, rules: DeloadRules = HALF_THE_SETS): Promise<void> {
  const current = db.v2_week_plan_sets.filter((s) => s.week_plan_id === planId)
  // Plain variables, not literals handed to the function: the shapes may carry fields (`targetRirMax`) a later chunk makes required.
  const source = current.map((s) => ({
    id: s.id,
    programExerciseId: s.program_exercise_id,
    setNumber: s.set_number,
    parentId: s.parent_week_plan_set_id,
    stageIndex: s.stage_index,
    isWarmup: s.is_warmup,
    stageKind: s.stage_kind,
    programSetId: s.program_set_id,
    repMin: s.rep_min,
    repMax: s.rep_max,
    isAmrap: s.is_amrap,
    targetRir: s.target_rir,
    targetRirMax: s.target_rir_max,
    tags: s.tags,
    isDropset: s.is_dropset,
    plannedWeight: s.target_weight,
    loggedWeight: null,
  }))
  const calculated = calculateDeloadSets(source, rules)
  const write = insertOne(db)
  await applyCalculatedDeloadMark(USER, planId, current, calculated, {
    writeSnapshotAndMark: async (id, snapshot) => {
      planRow(db, id).deload_restore = snapshot
      planRow(db, id).is_deload = true
    },
    deleteAllSets: async (id) => {
      db.v2_week_plan_sets = db.v2_week_plan_sets.filter((s) => s.week_plan_id !== id)
    },
    insertCalculatedSets: (userId, id, rows) => insertCalculatedPlanSets(userId, id, rows, write),
  })
}

// unmarkSessionDeload for a session nothing has been logged against: a program set that is gone is restored without its
// link (weekPlanService.ts withoutGoneProgramSets), then applyDeloadRestore deletes every set and inserts the saved copy.
export async function unmarkDeload(db: Db, planId: string): Promise<void> {
  const saved = planRow(db, planId).deload_restore
  if (saved == null) throw new Error(`${planId} has no saved plan to restore`)
  const exists = new Set(db.v2_program_sets.map((s) => s.id))
  const snapshot = saved.map((e) => (e.programSetId != null && !exists.has(e.programSetId) ? { ...e, programSetId: null } : e))
  const write = insertOne(db)
  await applyDeloadRestore(USER, planId, snapshot, {
    deleteAllSets: async (id) => {
      db.v2_week_plan_sets = db.v2_week_plan_sets.filter((s) => s.week_plan_id !== id)
    },
    insertRestoredSets: (userId, id, entries) => insertRestoredPlanSets(userId, id, entries, write),
    clearSnapshotAndUnmark: async (id) => {
      planRow(db, id).deload_restore = null
      planRow(db, id).is_deload = false
    },
  })
}

// What a session holds, for the two things 142 is about: the sets that name an exercise row the session does not list
// (Plan shows nothing for them), and the listed exercises that have no sets at all.
export interface SessionShape {
  list: Array<{ exercise: string; heads: number }> // in the session's order
  orphanSets: string[] // `<exercise row> <set number>` (a stage reads `… stage <index>`)
  emptyExercises: string[]
}

export function shapeOf(db: Db, planId: string): SessionShape {
  const listed = db.v2_week_plan_exercises.filter((e) => e.week_plan_id === planId).sort((a, b) => a.position - b.position)
  const sets = db.v2_week_plan_sets.filter((s) => s.week_plan_id === planId)
  const listedIds = new Set(listed.map((e) => e.program_exercise_id))
  return {
    list: listed.map((e) => ({
      exercise: e.program_exercise_id,
      heads: sets.filter((s) => s.program_exercise_id === e.program_exercise_id && s.parent_week_plan_set_id === null).length,
    })),
    orphanSets: sets
      .filter((s) => !listedIds.has(s.program_exercise_id))
      .map((s) => `${s.program_exercise_id} ${s.set_number}${s.parent_week_plan_set_id ? ` stage ${s.stage_index}` : ''}`),
    emptyExercises: [...listedIds].filter((id) => !sets.some((s) => s.program_exercise_id === id)),
  }
}

// A session's sets as saved-copy entries (what `deload_restore` would hold for them), in a stable order: exercise row, set
// number, stage index. Ids and parent links are not part of an entry. For comparing a plain session with a copy.
export function asEntries(db: Db, planId: string) {
  return db.v2_week_plan_sets
    .filter((s) => s.week_plan_id === planId)
    .map((s) => ({
      programExerciseId: s.program_exercise_id,
      setNumber: s.set_number,
      stageIndex: s.stage_index,
      isWarmup: s.is_warmup,
      isDropset: s.is_dropset,
      stageKind: s.stage_kind,
      programSetId: s.program_set_id,
      repMin: s.rep_min,
      repMax: s.rep_max,
      isAmrap: s.is_amrap,
      targetWeight: s.target_weight,
      targetRir: s.target_rir,
      tags: s.tags,
    }))
    .sort(compareEntries)
}

type EntryKey = { programExerciseId: string; setNumber: number; stageIndex: number }
export function compareEntries(a: EntryKey, b: EntryKey): number {
  return a.programExerciseId.localeCompare(b.programExerciseId) || a.setNumber - b.setNumber || a.stageIndex - b.stageIndex
}
