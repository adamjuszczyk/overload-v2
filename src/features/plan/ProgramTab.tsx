import type { Program } from '../../types'
import StepExercises from '../planner/StepExercises'
import StepVolume from '../planner/StepVolume'

// Plan screen's Program tab (chunk 6: TASKS.md "A run owns a copy of its
// program" — then chunk 11: SPEC.md "Plan screen" — "Program tab: the run's
// copy of the plan... edits change this run only"; TASKS.md "On a stable
// run, the program tab edits the run's copy (exercises and sets) with the
// same step 2/step 3 components").
//
// Not a separate route any more — ProgramBuilderPage/WorkoutDayEditorPage
// (what this tab used to link each workout row into) are both removed this
// chunk. Editing now happens inline, directly on the run's own `program`
// (kind = 'run'): the exact same StepExercises/StepVolume the planner uses
// for a saved program, just with no priorities step (that stays on
// PrioritiesEditor.tsx, reached from Plan's header, "as today" — SPEC
// "Programs and runs": "Priorities live on the program and can be changed
// per run in the plan screen") and no Save/Start (there is nothing to save
// — every edit here already commits live — and nothing to start, a run
// already is one).
//
// volumeReadOnly (chunk 9's rule, unchanged by this chunk): week-dependent
// -> the exercise list and the sets are read-only, shown as week 1's
// reference; stable -> both editable, and those changes reach weeks not yet
// planned (SPEC "Programs and runs" / "Weeks and copying"). Schedule
// (weekday assignment, inside StepExercises) is never read-only — it isn't
// "Volume", for either planning type.
export default function ProgramTab({ program }: { program: Program }) {
  const volumeReadOnly = (program.planningType ?? 'week_dependent') !== 'stable'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 10 }}>
          EXERCISES & SCHEDULE
        </p>
        <StepExercises program={program} volumeReadOnly={volumeReadOnly} />
      </div>

      <div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 10 }}>
          VOLUME
        </p>
        {volumeReadOnly && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 10 }}>
            VOLUME IS READ-ONLY HERE — EDIT IT IN A WEEK
          </p>
        )}
        <StepVolume program={program} volumeReadOnly={volumeReadOnly} canChangePlanningType={false} />
      </div>
    </div>
  )
}
