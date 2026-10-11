import { supabase } from '../../lib/supabase'
import { fetchRunProgramExercises } from '../programs/runProgramExercises'
import { fetchProgramSets } from '../planner/plannerService'
import {
  parseMakeDefaultResult,
  toDefaultExercises,
  type DefaultExercise,
  type MakeDefaultResult,
} from './makeWeekDefault'

// Chunk 32 (TASKS-1.1 "Stable: Make this week the new default") — the two calls around
// the action. The pure decisions are in makeWeekDefault.ts.

// "Make this week the new default": migration 040's v2_make_week_default rewrites the
// run's copy in one transaction (exercises and sets become the week's, a dropped set is
// soft-removed, weights, RIR and tags untouched) and answers with the OLD default of each
// workout it rewrote, for the "apply ahead" offer. Atomic: an error (not signed in, not a
// stable run, a week with no session that can be a source) means nothing was written, and
// is thrown as it came. There is no undo.
export async function makeWeekDefault(mesoId: string, weekNumber: number): Promise<MakeDefaultResult> {
  const { data, error } = await supabase.rpc('v2_make_week_default', {
    p_mesocycle_id: mesoId,
    p_week_number: weekNumber,
  })
  if (error) throw error
  return parseMakeDefaultResult(data)
}

// The NEW default of each workout, read from the run's copy after the call: its current
// exercise rows (fetchRunProgramExercises, the one read path) and the program sets of
// them that are part of the default (fetchProgramSets returns the dropped ones too; they
// are left out here). One request per workout for the rows, one for all the sets.
export async function fetchRunCopyDefaults(workoutDayIds: string[]): Promise<Map<string, DefaultExercise[]>> {
  const rowsByWorkout = await Promise.all(
    workoutDayIds.map(async (id) => [id, await fetchRunProgramExercises(id)] as const),
  )
  const programSets = await fetchProgramSets(rowsByWorkout.flatMap(([, rows]) => rows.map((pe) => pe.id)))
  return new Map(rowsByWorkout.map(([id, rows]) => [id, toDefaultExercises(rows, programSets)]))
}
