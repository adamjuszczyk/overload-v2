import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chunk 33 (SPEC Programs and runs [P1.1], G30): "fixed for the run: the schedule
// (schedule type, a weekday per workout, the sequence order), the workouts, and
// the deload-rules override"; "The planner refuses to open a run's copy". No
// screen edits a running program's schedule or workouts. (The override itself is
// gone since chunk 48: SPEC Objects stored → Program [1.2], "no longer read or
// written"; programDeloadOverrideUnused.static.test.ts pins that.)
//
// The behavioural halves are screen tests: PlannerPage.test.tsx (a run's copy is
// refused: no step, no editor) and PlanPage.programTabRemoved.test.tsx (nothing of
// the old tab, or of an editor for any of these, in Plan). This is the structural
// half, and it's by construction rather than by a list of words: every write to
// a program's schedule or workouts is made by a hook only the planner's two step
// components call, and only PlannerPage mounts them. Plan (and everything else)
// can't edit a run's schedule because nothing there can reach a hook that does.
// (Chunk 28's PrioritiesEditor test pins the same kind of fact for the priorities.)
//
// Source text, not behaviour: it reads every non-test file under src/. A new
// screen that needs one of these writers has to be added here on purpose.

const SRC = fileURLToPath(new URL('../../', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    const isSource = /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.testutil\.tsx?$/.test(name)
    return isSource ? [path] : []
  })
}

const FILES = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))
const filesMentioning = (pattern: RegExp) => FILES.filter((f) => pattern.test(f.text)).map((f) => f.path).sort()

// What edits a program's schedule or its workouts (usePrograms.ts and usePlanner.ts
// define them; the planner's steps call them).
const WRITERS = [
  'useUpdateScheduleType',      // weekday / sequence
  'useAssignWorkoutWeekday',    // a weekday per workout
  'useUpdateSchedule',
  'useAddSequenceItem',         // the sequence order
  'useUpdateSequenceItemWorkout',
  'useRemoveSequenceItem',
  'useReorderSequenceItems',
  'useCreateWorkoutDay',        // the workouts
  'useUpdateWorkoutDayName',
  'useDeleteWorkoutDay',
  'useSplitSharedWeekdayWorkouts',
  'useUpdatePlanningType',
]

const PLANNER_ONLY = [
  'features/planner/PlannerPage.tsx',
  'features/planner/StepExercises.tsx',
  'features/planner/StepVolume.tsx',
]
const DEFINITIONS = ['features/programs/usePrograms.ts', 'features/planner/usePlanner.ts']

describe('a running program\'s schedule and workouts are fixed for the run (chunk 33)', () => {
  it('the planner\'s steps are mounted by the planner and by nothing else (the program tab was the only other)', () => {
    expect(filesMentioning(/from '[^']*\/StepExercises'|from '\.\/StepExercises'/)).toEqual(['features/planner/PlannerPage.tsx'])
    expect(filesMentioning(/from '[^']*\/StepVolume'|from '\.\/StepVolume'/)).toEqual(['features/planner/PlannerPage.tsx'])
    expect(filesMentioning(/from '[^']*\/ProgramTab'|from '\.\/ProgramTab'/)).toEqual([])
    expect(FILES.some((f) => f.path === 'features/plan/ProgramTab.tsx')).toBe(false)
  })

  it.each(WRITERS)('%s is called by the planner\'s own files only', (writer) => {
    const mentions = filesMentioning(new RegExp(`\\b${writer}\\b`))
    expect(mentions.length).toBeGreaterThan(0) // the name is real: a rename can't pass this vacuously
    const outsiders = mentions.filter((path) => !PLANNER_ONLY.includes(path) && !DEFINITIONS.includes(path))
    expect(outsiders).toEqual([])
  })

  it('Plan\'s screen, its week panel and the Programs page call none of them', () => {
    for (const path of ['features/plan/PlanPage.tsx', 'features/plan/StructureFields.tsx', 'features/programs/ProgramsPage.tsx', 'features/plan/PrioritiesEditor.tsx']) {
      const file = FILES.find((f) => f.path === path)
      expect(file, path).toBeTruthy()
      for (const writer of WRITERS) expect(new RegExp(`\\b${writer}\\b`).test(file!.text), `${path} mentions ${writer}`).toBe(false)
    }
  })
})
