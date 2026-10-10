import type { ProgramExercise, ProgramSet, WeekPlanSet, WeightUnit } from '../../types'
import { formatRestTime } from '../../lib/formatRestTime'
import { DEFAULT_STAGE_REST_SECONDS, type StageKind } from '../../lib/plannerVocabulary.js'

// Chunk 30 (TASKS-1.1 "Rest, tempo, grouping, the routine and units in the
// Structure view (run-wide)"; SPEC Programs and runs / Rest / Tempo / Supersets /
// Warmup routine [P1.1]) — the pure decisions behind Plan's STRUCTURE view of the
// run-wide fields. Supabase-free and React-free, the way weekEdits.ts is, so each
// rule is tested directly; StructureFields.tsx draws them and PlanPage.tsx hands
// them the week.

// ─── A set's own rest: only where the set names a program set of its own row ──
// Rest, stage rest and a set's own rest are run-wide: they live on a program set
// (v2_program_sets.rest_seconds / stage_rest_seconds) of the run's copy, and the
// workout screen finds them through the planned set's own program_set_id, among
// the program sets of THAT set's own exercise row only (useExerciseCardState.ts:
// GymSession hands each card `allProgramSets.filter(ps => ps.programExerciseId ===
// pe.id)`, then `programSetById.get(plannedSet.programSetId)`).
//
// That is exactly the rule here (G35, G45 answered "no": TASKS-1.1). A set with no
// such program set shows no set REST and no STAGE REST and follows its exercise's
// rest, then the global rest, as it does today. They are:
//   - a set added in a week (addSet writes no program_set_id);
//   - every set of an exercise added in a week (no program sets at all);
//   - the sets of a swapped-in exercise: they still name the replaced row's
//     program sets, which belong to ANOTHER exercise row, so the lookup finds a
//     program set and must still refuse it. (Checking the id alone would show a
//     REST control that edits a row the swapped-in exercise never reads.)
export function ownProgramSet(set: WeekPlanSet, programSetById: ReadonlyMap<string, ProgramSet>): ProgramSet | null {
  if (!set.programSetId) return null
  const programSet = programSetById.get(set.programSetId)
  if (!programSet) return null
  return programSet.programExerciseId === set.programExerciseId ? programSet : null
}

// ─── Markers ─────────────────────────────────────────────────────────────────
// Standing UI rule: a feature that is set shows a small marker on its row; an
// unset one shows nothing. Display-only choices (D31), provisional: the text of
// each marker, and that they sit under the exercise's name / under the set's
// number in the STRUCTURE view only (each view marks its own fields).

// An exercise's: its rest, rest after and tempo where set, and its unit where it
// overrides the Settings unit. Rows created in the planner carry a literal unit
// from the day they are added (programService.ts's addProgramExercise writes the
// resolved one), so "a unit is stored" is true of nearly every exercise; the
// marker is for the ones that differ from the unit in Settings, the only case
// where it changes what you see.
export function exerciseMarkers(pe: ProgramExercise, globalUnit: WeightUnit): string[] {
  const markers: string[] = []
  if (pe.restSeconds != null) markers.push(`REST ${formatRestTime(pe.restSeconds)}`)
  if (pe.restAfterSeconds != null) markers.push(`REST AFTER ${formatRestTime(pe.restAfterSeconds)}`)
  if (pe.tempo) markers.push(`TEMPO ${pe.tempo}`)
  if (pe.weightUnit != null && pe.weightUnit !== globalUnit) markers.push(`UNIT ${pe.weightUnit.toUpperCase()}`)
  return markers
}

// A set's: its own rest where set, and a staged head's stage rest where set.
export function setRestMarkers(programSet: ProgramSet | null, isStagedHead: boolean): string[] {
  if (!programSet) return []
  const markers: string[] = []
  if (programSet.restSeconds != null) markers.push(`REST ${formatRestTime(programSet.restSeconds)}`)
  if (isStagedHead && programSet.stageRestSeconds != null) markers.push(`STAGE REST ${formatRestTime(programSet.stageRestSeconds)}`)
  return markers
}

// What a staged head's STAGE REST reads when none is set: its kind's own default
// (dropset: no timer; rest-pause, myo-reps and cluster: 15 s) — StepVolume.tsx's
// stageRestDefaultText, for the kind the week's head carries (the kind the
// workout screen's rest chain reads).
export function stageRestDefaultText(kind: StageKind): string {
  const seconds = DEFAULT_STAGE_REST_SECONDS[kind]
  return seconds == null ? 'NO TIMER' : formatRestTime(seconds).toUpperCase()
}
