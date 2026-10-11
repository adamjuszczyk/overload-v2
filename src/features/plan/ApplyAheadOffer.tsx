import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { WeekPlan } from '../../types'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useApplyAhead, ApplyAheadError, type ApplyAheadResult } from './useWeekPlan'
import { type ChangeRecord, type ApplyAheadSummary } from './applyAhead'

// Chunk 20 — "Apply this change to planned weeks ahead" (TASKS.md / SPEC.md
// "Weeks and copying"). Shared by PlanPage.tsx (week-level edits, both
// planning types) and ProgramTab.tsx (stable's own program-tab volume
// edits) so the offer looks and behaves identically wherever it's built
// from — reviewer's note 11: "the existing inline confirm or banner
// pattern Plan already uses (COPY WEEK, the G14 prompt)". This file is the
// one place that pattern is reused for this feature: dashed-border banner
// (COPY WEEK's own look), accent action button, a G14-style X dismiss —
// no new component, no new colour, nothing outside tokens.css's existing
// custom properties.

export interface PendingApplyAheadOffer {
  changes: ChangeRecord[]
  weeks: WeekPlan[] // candidate weeks this offer would touch — always non-empty
  isShared: boolean // G14 — this workout covers more than one weekday
}

interface OutcomeState {
  summary: ApplyAheadSummary
  error?: string
}

// `resetKey` (caller: `${workoutDayId}:${weekNumber}`, or just workoutDayId
// for the program-tab, which has no "current week") clears any pending
// offer/outcome the moment it changes — reviewer's note 10: Plan's render
// must never carry a stale offer across a week or workout switch, even
// though WorkoutDayPanel itself isn't remounted on every week change (only
// on a workout-day switch, via its own existing `key`).
export function useApplyAheadOffer(mesoId: string, resetKey: string) {
  const [offer, setOfferState] = useState<PendingApplyAheadOffer | null>(null)
  const [outcome, setOutcome] = useState<OutcomeState | null>(null)
  const mutation = useApplyAhead(mesoId)

  useEffect(() => {
    setOfferState(null)
    setOutcome(null)
    // Only the identity of resetKey matters here — not any other reactive
    // value — so this intentionally fires only when the caller's own key
    // (week/workout) actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  // Reviewer's note 4: offered only right after a qualifying edit, and only
  // when later planned weeks exist. A caller passes an empty `weeks` (or
  // never calls this at all) for a non-qualifying edit (e.g. one with no
  // later planned week) — setOffer itself also clears any stale PRIOR
  // offer/outcome in that case, so the banner never shows a change that no
  // longer matches what was just done.
  function setOffer(changes: ChangeRecord[], weeks: WeekPlan[], isShared: boolean) {
    setOutcome(null)
    setOfferState(weeks.length === 0 || changes.length === 0 ? null : { changes, weeks, isShared })
  }

  function dismiss() {
    setOfferState(null)
    setOutcome(null)
  }

  function apply() {
    if (!offer) return
    mutation.mutate(
      { changes: offer.changes, weeks: offer.weeks },
      {
        onSuccess: (data: ApplyAheadResult) => {
          setOutcome({ summary: data.summary })
          setOfferState(null)
        },
        onError: (err: unknown) => {
          const summary =
            err instanceof ApplyAheadError ? err.summary : { total: offer.weeks.length, applied: 0, skippedDeload: 0, skippedStructural: 0 }
          setOutcome({ summary, error: err instanceof Error ? err.message : 'Could not apply the change.' })
          setOfferState(null)
        },
      },
    )
  }

  return { offer, outcome, isPending: mutation.isPending, setOffer, dismiss, apply }
}

export function ApplyAheadBanner({
  offer,
  outcome,
  isPending,
  onApply,
  onDismiss,
}: {
  offer: PendingApplyAheadOffer | null
  outcome: OutcomeState | null
  isPending: boolean
  onApply: () => void
  onDismiss: () => void
}) {
  // Reviewer's note 8 — "online only is fine (say what the offer does
  // offline: hidden or disabled, never a hang)": disabled, not hidden, so
  // the information ("there are N planned weeks ahead") stays visible.
  const isOnline = useOnlineStatus()
  if (!offer && !outcome) return null

  const weekWord = (n: number) => (n === 1 ? 'WEEK' : 'WEEKS')

  return (
    <div
      style={{
        marginBottom: 12,
        padding: '10px 12px',
        background: 'var(--surface)',
        border: '1px dashed var(--border-strong)',
        borderRadius: 11,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {outcome ? (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {`APPLIED TO ${outcome.summary.applied} OF ${outcome.summary.total} PLANNED ${weekWord(outcome.summary.total)}`}
            {outcome.summary.skippedDeload > 0 ? ` — ${outcome.summary.skippedDeload} SKIPPED (DELOAD)` : ''}
            {outcome.summary.skippedStructural > 0 ? ` — ${outcome.summary.skippedStructural} SKIPPED (ALREADY DIFFERENT)` : ''}
            {outcome.error ? ` — STOPPED: ${outcome.error.toUpperCase()}` : ''}
          </p>
        ) : offer ? (
          <>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {`APPLY THIS CHANGE TO ${offer.weeks.length} PLANNED ${weekWord(offer.weeks.length)} AHEAD?`}
            </p>
            {offer.isShared && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5 }}>
                This workout is scheduled on more than one weekday — this affects every one of those days.
              </p>
            )}
            {!isOnline && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)', marginTop: 4 }}>
                OFFLINE — CONNECT TO APPLY
              </p>
            )}
          </>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {offer && (
          <button
            onClick={onApply}
            disabled={isPending || !isOnline}
            style={{
              height: 28,
              padding: '0 10px',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 7,
              cursor: isPending || !isOnline ? 'not-allowed' : 'pointer',
              opacity: isPending || !isOnline ? 0.6 : 1,
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: 9,
              letterSpacing: '1px',
              color: 'var(--base)',
              flexShrink: 0,
            }}
          >
            {isPending ? 'APPLYING…' : 'APPLY'}
          </button>
        )}
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--surface-overlay)',
            border: '1px solid var(--border-strong)',
            borderRadius: 7,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
