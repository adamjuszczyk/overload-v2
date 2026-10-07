import { useMemo } from 'react'
import type { Program } from '../../types'
import StepExercises from '../planner/StepExercises'
import StepVolume from '../planner/StepVolume'
import { useAllWeekPlans } from './useWeekPlan'
import { allPlannedWeeks, type ChangeRecord } from './applyAhead'
import { useApplyAheadOffer, ApplyAheadBanner } from './ApplyAheadOffer'
import { detectSharedWeekdayWorkouts } from '../planner/usePlanner'

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
//
// Chunk 20 ("Apply this change to planned weeks ahead") — SPEC "Programs
// and runs": "stable: editable; weeks not yet planned pick it up, and
// 'Apply this change to planned weeks ahead' covers planned ones." Wired
// only here (never in the planner, PlannerPage.tsx, which has no mesoId
// and no weeks at all): StepExercises/StepVolume's own onVolumeChange prop
// stays undefined there, so nothing below changes that usage at all.
// allPlannedWeeks (not laterPlannedWeeks — there is no "edited week" for a
// program-tab edit) covers every already-planned week for the touched
// workout, regardless of number, per that same SPEC line.
export default function ProgramTab({ program, mesoId }: { program: Program; mesoId: string }) {
  const volumeReadOnly = (program.planningType ?? 'week_dependent') !== 'stable'

  const { data: allWeekPlans = [] } = useAllWeekPlans(mesoId)
  const applyAheadOffer = useApplyAheadOffer(mesoId, `program:${program.id}`)
  const sharedWorkoutDayIds = useMemo(
    () => new Set(detectSharedWeekdayWorkouts(program.schedule).map((g) => g.workoutDayId)),
    [program.schedule],
  )

  function handleVolumeChange(workoutDayId: string, changes: ChangeRecord[]) {
    const weeks = allPlannedWeeks(allWeekPlans, workoutDayId)
    applyAheadOffer.setOffer(changes, weeks, sharedWorkoutDayIds.has(workoutDayId))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {!volumeReadOnly && (
        <ApplyAheadBanner
          offer={applyAheadOffer.offer}
          outcome={applyAheadOffer.outcome}
          isPending={applyAheadOffer.isPending}
          onApply={applyAheadOffer.apply}
          onDismiss={applyAheadOffer.dismiss}
        />
      )}

      <div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 10 }}>
          EXERCISES & SCHEDULE
        </p>
        <StepExercises program={program} volumeReadOnly={volumeReadOnly} onVolumeChange={handleVolumeChange} />
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
        <StepVolume program={program} volumeReadOnly={volumeReadOnly} canChangePlanningType={false} onVolumeChange={handleVolumeChange} />
      </div>
    </div>
  )
}
