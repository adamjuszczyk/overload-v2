import type { ProgramExercise, WeekPlanSet } from '../../types'
import ExerciseHeader from './ExerciseHeader'
import PlanTargetsPanel from './PlanTargetsPanel'
import ExerciseReference from './ExerciseReference'
import { useLastSessionLogs } from './useSession'

interface PreviewExerciseCardProps {
  programExercise: ProgramExercise
  plannedSets: WeekPlanSet[]
  workoutDayId: string
  occurrenceCount: number
  today: string
}

// Read-only mirror of ExerciseCard for the session preview — no SetRow
// inputs, no LOG/ADD SET buttons, no rest timer wiring.
export default function PreviewExerciseCard({
  programExercise,
  plannedSets,
  workoutDayId,
  occurrenceCount,
  today,
}: PreviewExerciseCardProps) {
  const { data: lastLogs = [], isLoading: lastLogsLoading } = useLastSessionLogs(
    programExercise.exerciseId,
    null,
  )

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <ExerciseHeader programExercise={programExercise} />

      <div
        className="grid"
        style={{ gridTemplateColumns: '1fr 1fr', borderBottom: plannedSets.length ? '1px solid var(--border)' : undefined }}
      >
        <PlanTargetsPanel plannedSets={plannedSets} />
        <div className="px-3 py-2">
          <ExerciseReference
            exerciseId={programExercise.exerciseId}
            currentSessionId={null}
            workoutDayId={workoutDayId}
            occurrenceCount={occurrenceCount}
            today={today}
            lastLogs={lastLogs}
            lastLogsLoading={lastLogsLoading}
          />
        </div>
      </div>

      {plannedSets.length > 0 && (
        <div className="px-3 py-3 space-y-2">
          {plannedSets.map((ps) => (
            <div
              key={ps.id}
              className="flex items-center gap-3 px-3 rounded-lg"
              style={{ backgroundColor: 'var(--surface)', minHeight: 44 }}
            >
              <span
                className="text-xs font-bold w-5 text-center"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {String(ps.setNumber).padStart(2, '0')}
              </span>
              <span className="flex-1 text-sm" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {ps.targetRir != null ? `TARGET RIR ${ps.targetRir}` : 'NO TARGET'}
              </span>
              {ps.isDropset && (
                <span
                  className="text-xs px-1 rounded"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)', fontSize: 9 }}
                >
                  DROP
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
