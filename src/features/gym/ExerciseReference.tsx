import { formatDistanceToNow, parseISO } from 'date-fns'
import type { SetLog, WeightUnit } from '../../types'
import type { ReferenceSession } from './sessionService'
import type { SetGroup } from './setGroupLogic'
import { resolveExerciseReference, resolveSecondaryReference, hasRealLoggedSet } from './referenceLogic'
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
  // The live session's own mesocycle (v2_sessions.mesocycle_id, or the
  // upcoming week plan's for a preview with no session yet) — scopes the
  // reach-back search to the current mesocycle only, same rule as
  // analysisInput.ts's resolveSecondaryReference call. null (no meso, or a
  // preview with no week plan yet) means the reach-back panel never shows —
  // resolveSecondaryReference's own defensive `none_in_meso` handles this,
  // not a crash.
  mesocycleId: string | null
  // Real bug this closes (CONTEXT.md, 2026-08-22): a genuine online-fetch
  // failure used to be silently swallowed and indistinguishable from "no
  // reference exists." Now surfaced explicitly instead of rendering FIRST
  // TIME for data that may well exist but couldn't be fetched.
  isError: boolean
  onRetry: () => void
  // True when `sessions` came from the offline Dexie fallback (genuinely
  // offline, not a swallowed error) — shown as a small provenance note, not
  // hidden the way it used to be.
  isFromCache: boolean
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

// "Last actually trained N ago" — coachPrompt.ts v3 frames the reach-back
// result the same way (elapsed time, not a same-week delta); this mirrors
// that wording so the live panel and the Coach write-up never disagree on
// how to describe the identical underlying fact.
function secondaryLabel(daysSince: number): string {
  return `LAST ACTUALLY TRAINED ${daysSince === 0 ? 'TODAY' : `${daysSince}D AGO`}`
}

export default function ExerciseReference({
  today,
  sessions,
  isLoading,
  mesocycleId,
  isError,
  onRetry,
  isFromCache,
  weightUnit,
}: ExerciseReferenceProps) {
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

  // Real bug this closes (CONTEXT.md, 2026-08-22): a failed fetch used to
  // silently render as FIRST TIME, indistinguishable from genuinely having
  // no history. Shown instead of the FIRST_TIME/last_week/last_time
  // rendering below, not alongside it — `sessions` is empty on a real error
  // (nothing to render anyway), and showing both would bury the one thing
  // that actually needs the lifter's attention (tap to retry).
  if (isError) {
    return (
      <div>
        <p
          className="text-xs font-bold tracking-widest mb-1"
          style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)' }}
        >
          COULDN'T LOAD REFERENCE
        </p>
        <button
          onClick={onRetry}
          className="text-xs font-bold tracking-widest underline"
          style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
        >
          RETRY
        </button>
      </div>
    )
  }

  const { primary, thisWeek } = resolveExerciseReference(today, sessions)

  // Reach-back (2026-08-22 fix): only when a real reference session was
  // found but it has nothing usable in it — mirrors analysisInput.ts's
  // trigger (there, `match.plain.slotCountA === 0 && ...dropsets... === 0`;
  // here, no `match` exists yet at this point in the render, so the
  // equivalent check is directly on the primary session's own logs via the
  // same hasRealLoggedSet rule referenceLogic.ts already uses internally).
  const secondary =
    primary.type !== 'first_time' && !hasRealLoggedSet(primary.session)
      ? resolveSecondaryReference(today, sessions, mesocycleId)
      : null

  return (
    <div className="space-y-2">
      {isFromCache && (
        <p
          className="text-xs"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', opacity: 0.7 }}
        >
          OFFLINE · CACHED
        </p>
      )}

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

      {secondary?.type === 'found' && (
        <Panel
          label={secondaryLabel(secondary.daysSince)}
          groups={secondary.session.logs}
          weightUnit={weightUnit}
        />
      )}
      {secondary?.type === 'none_in_meso' && (
        <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          NOTHING THIS MESO TO COMPARE AGAINST
        </p>
      )}
      {secondary?.type === 'all_skipped_in_meso' && (
        <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          SKIPPED EVERY TIME THIS MESO
        </p>
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
