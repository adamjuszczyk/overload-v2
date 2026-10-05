// Plan screen's Program tab (chunk 6, TASKS.md "A run owns a copy of its
// program" / SPEC.md "Plan screen" — "Program tab: the run's copy of the
// plan... workouts..."). At this stage (SPEC: "the run copy's exercise list
// still drives every week live, exactly as the shared program does today,
// so the tab can edit it") this is only the workout list; chunk 9
// introduces the per-type rules this comment in TASKS.md's chunk 6 brief
// flags as later work.
//
// Presentational only, same row built from the same existing tokens as
// ProgramBuilderPage.tsx's own workout-day row (name + chevron, minus the
// delete action — deleting a workout isn't this chunk's scope) — the run's
// copy opens into the exact same existing workout editor
// (/program/:id/day/:dayId, WorkoutDayEditorPage.tsx) a saved program's
// workouts already do, so the row that gets there looks the same too.

import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { WorkoutDay } from '../../types'

export default function ProgramTab({
  programId,
  workoutDays,
  isLoading,
}: {
  programId: string
  workoutDays: WorkoutDay[]
  isLoading: boolean
}) {
  const navigate = useNavigate()

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
        <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
      </div>
    )
  }

  if (workoutDays.length === 0) {
    return (
      <p style={{ textAlign: 'center', paddingTop: 60, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
        NO WORKOUTS YET
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {workoutDays.map((day) => (
        <button
          key={day.id}
          onClick={() => navigate(`/program/${programId}/day/${day.id}`)}
          style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {day.name}
            </div>
          </div>
          <ChevronRight size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        </button>
      ))}
    </div>
  )
}
