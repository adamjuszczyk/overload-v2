import type { ProgramExercise, WeekPlanSet } from '../../types'
import ExerciseHeader from './ExerciseHeader'
import PlanTargetsPanel from './PlanTargetsPanel'
import ExerciseReference from './ExerciseReference'
import { useLastSessionLogs } from './useSession'
import { groupWeekPlanSets } from './setGroupLogic'

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

  // Heads only, stages nested beneath (§2.7 item 7) — a planned dropset's
  // stage rows are never their own top-level entry.
  const groups = groupWeekPlanSets(plannedSets).sort((a, b) => a.head.setNumber - b.head.setNumber)

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

      {groups.length > 0 && (
        <div className="px-3 py-3 space-y-2">
          {groups.map(({ head, stages }) => (
            <div key={head.id} className="space-y-1">
              <div
                className="flex items-center gap-3 px-3 rounded-lg"
                style={{ backgroundColor: 'var(--surface)', minHeight: 44 }}
              >
                <span
                  className="text-xs font-bold w-5 text-center"
                  style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  {String(head.setNumber).padStart(2, '0')}
                </span>
                <span className="flex-1 text-sm" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {head.targetRir != null ? `TARGET RIR ${head.targetRir}` : 'NO TARGET'}
                </span>
                {stages.length > 0 && (
                  <span
                    className="text-xs px-1 rounded"
                    style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)', fontSize: 9 }}
                  >
                    {stages.length} STAGE{stages.length > 1 ? 'S' : ''}
                  </span>
                )}
              </div>

              {stages.length > 0 && (
                <div className="pl-4 space-y-1" style={{ borderLeft: '1px dashed var(--border)' }}>
                  {stages.map((stage) => (
                    <div
                      key={stage.id}
                      className="flex items-center gap-3 px-3 rounded-lg"
                      style={{ backgroundColor: 'var(--surface)', minHeight: 36 }}
                    >
                      <span
                        className="text-xs font-bold w-5 text-center"
                        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                      >
                        ↳
                      </span>
                      <span className="flex-1 text-sm" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {stage.targetRir != null ? `TARGET RIR ${stage.targetRir}` : 'NO TARGET'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
