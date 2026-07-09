import { formatDistanceToNow, format, parseISO } from 'date-fns'
import type { SetLog } from '../../types'
import type { ReferenceSession } from './sessionService'
import { useLastCompletedSession } from './useSession'
import { resolveExerciseReference } from './referenceLogic'

interface ExerciseReferenceProps {
  exerciseId: string
  currentSessionId: string | null
  workoutDayId: string
  occurrenceCount: number
  today: string
  // Most recent completed session's logs for this exercise, any workout day
  // (already excludes the current session) — reused from whatever query the
  // caller already runs for prefill, which has an offline/Dexie fallback.
  // Reusing it here (instead of a second online-only fetch) keeps the
  // reference panel working offline mid-session.
  lastLogs: SetLog[]
  lastLogsLoading: boolean
}

function relativeLabel(date: string): string {
  return formatDistanceToNow(parseISO(date), { addSuffix: true }).toUpperCase()
}

function SetRows({ logs }: { logs: SetLog[] }) {
  if (logs.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        —
      </p>
    )
  }
  return (
    <div className="space-y-0.5">
      {logs.map((log) => (
        <div key={log.id} className="flex items-center gap-1">
          <span
            className="text-xs tabular-nums"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 16 }}
          >
            {log.setNumber}
          </span>
          <span
            className="text-xs tabular-nums"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
          >
            {log.weight}×{log.reps}
          </span>
          {log.rir != null && (
            <span className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              @{log.rir}
            </span>
          )}
          {log.isDropset && (
            <span
              className="text-xs px-1 rounded"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)', fontSize: 9 }}
            >
              D
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function Panel({ label, sub, logs }: { label: string; sub?: string; logs: SetLog[] }) {
  return (
    <div>
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
        {sub && <span style={{ color: 'var(--text-muted)', opacity: 0.7 }}> · {sub}</span>}
      </p>
      <SetRows logs={logs} />
    </div>
  )
}

function CompactPanel({ label, sub, logs }: { label: string; sub?: string; logs: SetLog[] }) {
  return (
    <div>
      <p
        className="font-bold mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.04em' }}
      >
        {label}
        {sub && <span style={{ opacity: 0.7 }}> · {sub}</span>}
      </p>
      <SetRows logs={logs} />
    </div>
  )
}

export default function ExerciseReference({
  exerciseId,
  currentSessionId,
  workoutDayId,
  occurrenceCount,
  today,
  lastLogs,
  lastLogsLoading,
}: ExerciseReferenceProps) {
  const anySlot: ReferenceSession | null =
    lastLogs.length > 0
      ? { sessionId: lastLogs[0].sessionId, date: format(parseISO(lastLogs[0].loggedAt), 'yyyy-MM-dd'), logs: lastLogs }
      : null

  // Same-workout-day match has no offline fallback — only relevant for the
  // less common twice-a-week exercises, and resolveExerciseReference already
  // degrades gracefully to a single LAST TIME panel when it's unavailable.
  const { data: sameSlot, isLoading: sameLoading } = useLastCompletedSession(exerciseId, currentSessionId, {
    workoutDayId,
    enabled: occurrenceCount >= 2,
  })

  if (lastLogsLoading || (occurrenceCount >= 2 && sameLoading)) {
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

  const state = resolveExerciseReference(today, occurrenceCount, sameSlot ?? null, anySlot)

  if (state.type === 'first_time') {
    return (
      <div>
        <p
          className="text-xs font-bold tracking-widest mb-1"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          FIRST TIME
        </p>
      </div>
    )
  }

  if (state.type === 'last_week') {
    return <Panel label="LAST WEEK" logs={state.session.logs} />
  }

  if (state.type === 'last_time') {
    return <Panel label="LAST TIME" sub={relativeLabel(state.session.date)} logs={state.session.logs} />
  }

  // 'both' — LAST WEEK + LAST TIME side by side within the reference slot
  return (
    <div className="grid grid-cols-2 gap-2">
      <CompactPanel label="LAST WEEK" logs={state.lastWeek.logs} />
      <CompactPanel label="LAST TIME" sub={relativeLabel(state.lastTime.date)} logs={state.lastTime.logs} />
    </div>
  )
}
