import { formatDistanceToNow, parseISO } from 'date-fns'
import type { SetLog, WeightUnit } from '../../types'
import type { ReferenceSession } from './sessionService'
import type { SetGroup } from './setGroupLogic'
import { resolveExerciseReference } from './referenceLogic'
import { toDisplayWeight } from '../../lib/weightUnit'

interface ExerciseReferenceProps {
  today: string
  // This exercise's eligible sessions — same workout_day_id, status
  // 'completed', excluding the current session — already fetched once per
  // workout day by the session-first batched query (v3 §2.3) and sliced per
  // exercise by the caller. Unsorted/unfiltered by date; resolveExerciseReference
  // owns all of that boundary math.
  sessions: ReferenceSession[]
  isLoading: boolean
  // Resolved unit for the exercise this reference panel belongs to (v3
  // §2.4) — log.weight is always canonical kg; this panel converts for
  // display, same as the live gym-screen rows next to it.
  weightUnit: WeightUnit
}

function relativeLabel(daysSince: number, date: string): string {
  if (daysSince === 0) return 'TODAY'
  return formatDistanceToNow(parseISO(date), { addSuffix: true }).toUpperCase()
}

function SetLine({ log, isStage, weightUnit }: { log: SetLog; isStage?: boolean; weightUnit: WeightUnit }) {
  return (
    <div className="flex items-center gap-1" style={isStage ? { paddingLeft: 12 } : undefined}>
      <span
        className="text-xs tabular-nums"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 16 }}
      >
        {isStage ? '↳' : log.setNumber}
      </span>
      <span
        className="text-xs tabular-nums"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
      >
        {log.weight !== null ? toDisplayWeight(log.weight, weightUnit) : '—'}×{log.reps}
      </span>
      {log.rir != null && (
        <span className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          @{log.rir}
        </span>
      )}
      {isStage && (
        <span
          className="text-xs px-1 rounded"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)', fontSize: 9 }}
        >
          DROP
        </span>
      )}
    </div>
  )
}

// Grouped, not flat (§2.7 item 9) — a head row followed by its own nested
// stage rows, each stage carrying the DROP badge. Whether a row is a stage
// is structural (it's in `group.stages`), never `log.isDropset` alone — an
// orphaned dropset-flagged row with no parent renders as its own head with
// no badge, same convention as SessionDetail.tsx / SetGroup.tsx.
function SetRows({ groups, weightUnit }: { groups: SetGroup<SetLog>[]; weightUnit: WeightUnit }) {
  if (groups.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        —
      </p>
    )
  }
  return (
    <div className="space-y-0.5">
      {groups.map((group) => (
        <div key={group.head.id}>
          <SetLine log={group.head} weightUnit={weightUnit} />
          {group.stages.map((stage) => (
            <SetLine key={stage.id} log={stage} isStage weightUnit={weightUnit} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Panel({
  label,
  sub,
  groups,
  weightUnit,
}: {
  label: string
  sub?: string
  groups: SetGroup<SetLog>[]
  weightUnit: WeightUnit
}) {
  return (
    <div>
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
        {sub && <span style={{ color: 'var(--text-muted)', opacity: 0.7 }}> · {sub}</span>}
      </p>
      <SetRows groups={groups} weightUnit={weightUnit} />
    </div>
  )
}

export default function ExerciseReference({ today, sessions, isLoading, weightUnit }: ExerciseReferenceProps) {
  if (isLoading) {
    return (
      <div>
        <p
          className="text-xs font-bold tracking-widest mb-1"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          REFERENCE
        </p>
        <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          ···
        </p>
      </div>
    )
  }

  const { primary, thisWeek } = resolveExerciseReference(today, sessions)

  return (
    <div className="space-y-2">
      {primary.type === 'first_time' && (
        <p
          className="text-xs font-bold tracking-widest"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          FIRST TIME
        </p>
      )}

      {primary.type === 'last_week' && (
        <Panel label="LAST WEEK" groups={primary.session.logs} weightUnit={weightUnit} />
      )}

      {primary.type === 'last_time' && (
        <Panel
          label="LAST TIME"
          sub={relativeLabel(primary.daysSince, primary.session.date)}
          groups={primary.session.logs}
          weightUnit={weightUnit}
        />
      )}

      {/* Rendered label is "EARLIER THIS WEEK", not "THIS WEEK" (which
          TASKS.md §2.3 / SPEC.md §4.1 use) — display-only rename, the
          underlying `thisWeek` field name is unchanged. PlanTargetsPanel.tsx
          already hardcodes its own "THIS WEEK" header for planned targets in
          the column immediately to the left of this one; both can render
          simultaneously (confirmed with real data during Phase 3.3 live
          testing) and were otherwise visually indistinguishable despite
          meaning completely different things. See CONTEXT.md. */}
      {thisWeek.map(({ session, daysSince }) => (
        <Panel
          key={session.sessionId}
          label="EARLIER THIS WEEK"
          sub={relativeLabel(daysSince, session.date)}
          groups={session.logs}
          weightUnit={weightUnit}
        />
      ))}
    </div>
  )
}
