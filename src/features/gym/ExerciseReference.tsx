import { formatDistanceToNow, parseISO } from 'date-fns'
import type { SetLog, WeightUnit } from '../../types'
import type { ReferenceSession } from './sessionService'
import type { SetGroup } from './setGroupLogic'
// hasRealLoggedSet is referenceLogic.ts's own existing export (frozen,
// unchanged — Coach imports this file too) — reused as-is, same rule
// resolveExerciseReferenceAcrossRuns/resolveReachBackAcrossRuns below both
// already build on. resolveExerciseReference/resolveSecondaryReference
// themselves are NOT used here any more (chunk 23 — "ExerciseReference
// switches to the new resolver"); they stay exported from referenceLogic.ts
// unchanged for Coach's analysisInput.ts, which is the only remaining
// caller.
import { hasRealLoggedSet } from './referenceLogic'
import { resolveExerciseReferenceAcrossRuns, resolveReachBackAcrossRuns } from './referenceByExercise'
import { toDisplayWeight } from '../../lib/weightUnit'

interface ExerciseReferenceProps {
  today: string
  // This exercise's eligible sessions — status 'completed', across every
  // run and every workout (chunk 23 — SPEC "'Last time' reference":
  // "Matching: by exercise_id across all completed sessions of the user,
  // every run and every workout"), excluding the current session —
  // already fetched once per screen by the batched query
  // (fetchReferenceSessionsByExercise, sessionService.ts) and sliced per
  // exercise by the caller (by exercise id — the same Map lookup every
  // caller already used before this chunk). Unsorted/unfiltered by date,
  // and not guaranteed deload-free (the resolver filters that itself too,
  // defensively — see referenceByExercise.ts);
  // resolveExerciseReferenceAcrossRuns owns all of the boundary math.
  sessions: ReferenceSession[]
  isLoading: boolean
  // Chunk 23 — no longer read. The reach-back now crosses run boundaries
  // (SPEC "The reach-back ... crosses run boundaries too"), so there is no
  // meso boundary left for this to scope. Kept as a required prop (rather
  // than removed) purely so every existing caller (ExerciseCard.tsx,
  // PreviewExerciseCard.tsx, SupersetBlock.tsx, and GymSession.tsx/
  // SessionPreview.tsx's own threading of session?.mesocycleId down to
  // them) keeps compiling and passing it unchanged — a scope decision
  // (this chunk's report), not an oversight; ripping it out everywhere it's
  // threaded is outside chunk 23's stated scope (referenceByExercise.ts,
  // ExerciseReference and its offline fallback).
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

// mesocycleId is accepted (ExerciseReferenceProps) but deliberately not
// destructured here — see that prop's own doc comment above. Destructuring
// it unused would fail this project's noUnusedLocals; not destructuring it
// at all keeps every caller's existing mesocycleId={...} prop compiling
// with zero change, while this component simply never reads it.
export default function ExerciseReference({
  today,
  sessions,
  isLoading,
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

  // Chunk 23 (SPEC "'Last time' reference") — every live run today is
  // schedule_type='weekday' (v2_programs' own column default; no program
  // can be created as 'sequence' yet — that arrives in chunk 25,
  // TASKS.md). resolveExerciseReferenceAcrossRuns is schedule-aware and
  // fully tested for both branches (referenceByExercise.test.ts); this is
  // the only value that can occur live, so it's passed as a literal rather
  // than threaded through as a new prop on every caller (ExerciseCard,
  // PreviewExerciseCard, SupersetBlock, GymSession, SessionPreview) for a
  // branch nothing live can reach yet. Chunk 25 threads the run's real
  // schedule_type through once a sequence run becomes reachable.
  const { primary, thisWeek } = resolveExerciseReferenceAcrossRuns(today, 'weekday', sessions)

  // Reach-back (2026-08-22 fix, now cross-run — SPEC "The reach-back ...
  // crosses run boundaries too"): only when a real reference session was
  // found but it has nothing usable in it — mirrors analysisInput.ts's
  // trigger (there, `match.plain.slotCountA === 0 && ...dropsets... === 0`;
  // here, no `match` exists yet at this point in the render, so the
  // equivalent check is directly on the primary session's own logs via the
  // same hasRealLoggedSet rule referenceLogic.ts already uses internally).
  const secondary =
    primary.type !== 'first_time' && !hasRealLoggedSet(primary.session)
      ? resolveReachBackAcrossRuns(today, sessions)
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
      {/* Labels dropped "THIS MESO" (chunk 23) — the reach-back is no
          longer meso-bounded (SPEC: "crosses run boundaries too"), so that
          wording would now claim a narrower scope than what was actually
          searched. Same two states as before (referenceLogic.ts's
          resolveSecondaryReference), same styling, just renamed to match
          resolveReachBackAcrossRuns' own variant tags. */}
      {secondary?.type === 'none_found' && (
        <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          NOTHING ON RECORD TO COMPARE AGAINST
        </p>
      )}
      {secondary?.type === 'all_skipped' && (
        <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          SKIPPED EVERY TIME ON RECORD
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
