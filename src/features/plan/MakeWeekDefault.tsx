import { useState } from 'react'
import type { WeekPlan } from '../../types'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToastStore } from '../notifications/toastStore'
import { useMakeWeekDefault } from './useMakeWeekDefault'
import { useApplyAheadOffer, ApplyAheadBanner } from './ApplyAheadOffer'
import { buildDefaultOffer, laterSessionsOf, sourceLinksOf } from './makeWeekDefault'

// Chunk 32 — "Make this week the new default" (SPEC Weeks and copying [P1.1]; Plan screen:
// "stable runs: 'Make this week the new default' (current and future weeks, with a
// confirm step)"). A page-level action, one per week, like COPY WEEK and MARK WEEK AS
// DELOAD above it: PlanPage mounts this only where SPEC offers it (a stable run, the
// current week or a later one, a week with at least one session that can be a source), so
// the button's absence elsewhere is PlanPage's rule, tested there.
//
// Tapping it asks first (the app's shared confirm dialog) and nothing is called until
// CONFIRM: there is no undo. On confirm, v2_make_week_default rewrites the run's copy;
// then, if later weeks of the rewritten workouts are already planned, the existing
// "Apply this change to planned weeks ahead" banner is offered, with the old default →
// new default turned into per-part records (makeWeekDefault.ts) that update a later week
// only where it still matches the old default (applyAhead.ts). An error of the call is
// shown as a toast and nothing else happens: no banner, nothing written here.
//
// Display-only choices (D31), provisional: the button reads CYCLE where a sequence run
// says cycle everywhere else; a success toast says what happened (nothing else on the
// screen changes at once); the dialog closes before an error toast so the toast (which
// sits under the dialog's overlay) can be seen.
export default function MakeWeekDefault({
  mesoId,
  weekNumber,
  isSequence,
  weekPlans,
  allWeekPlans,
  sharedWorkoutDayIds,
}: {
  mesoId: string
  weekNumber: number
  isSequence: boolean
  // The sessions of the week being made the default, as Plan holds them (what is on
  // screen). Read when the confirm is tapped, before the call: they are the evidence of
  // a swap, which the call erases (sourceLinksOf).
  weekPlans: WeekPlan[]
  // Every planned session of the run, to find the later weeks of the workouts rewritten.
  allWeekPlans: WeekPlan[]
  sharedWorkoutDayIds: ReadonlySet<string>
}) {
  const [confirming, setConfirming] = useState(false)
  const makeDefault = useMakeWeekDefault(mesoId)
  const showToast = useToastStore((s) => s.show)
  // A pending offer belongs to the week it was made on: another week clears it.
  const applyAheadOffer = useApplyAheadOffer(mesoId, `default:${weekNumber}`)

  const noun = isSequence ? 'cycle' : 'week'
  const hasBanner = !!applyAheadOffer.offer || !!applyAheadOffer.outcome

  function confirm() {
    // BEFORE the call: it points every planned set of the source week at the program set
    // it ends up on, and the link a swapped-in row's sets have to the replaced row's
    // program sets is the only trace of a swap. Without it a swap is not offered as one.
    const sourceLinks = new Map(weekPlans.map((plan) => [plan.id, sourceLinksOf(plan)]))
    makeDefault.mutate(
      { weekNumber },
      {
        onSuccess: ({ result, newDefaults }) => {
          setConfirming(false)
          // The default is written. Say so, and, when it applies, which sessions kept the
          // current default or that the offer could not be prepared (it needs the new
          // default, which could not be read).
          const done = `${isSequence ? 'Cycle' : 'Week'} ${weekNumber} is now the default.`
          const hasLaterWeeks = result.workouts.some((w) => laterSessionsOf(allWeekPlans, w.workoutDayId, weekNumber).length > 0)
          showToast(
            !newDefaults && hasLaterWeeks
              ? `${done} Planned weeks ahead could not be offered the change.`
              : result.skipped.length > 0
                ? `${done} Deload or empty sessions kept the current default.`
                : done,
          )
          if (!newDefaults) return
          const offer = buildDefaultOffer(result, newDefaults, allWeekPlans, sourceLinks)
          if (!offer) {
            applyAheadOffer.dismiss()
            return
          }
          const isShared = offer.groups.some((g) => sharedWorkoutDayIds.has(g.workoutDayId))
          applyAheadOffer.setOffer(
            offer.groups.flatMap((g) => g.changes),
            offer.weeks,
            isShared,
            { groups: offer.groups, weekCount: offer.weekCount },
          )
        },
        onError: (err) => {
          // Atomic: the call wrote nothing. Close the dialog (its overlay would hide the
          // toast) and say why; the screen stays as it was, with no offer.
          setConfirming(false)
          showToast(err instanceof Error ? err.message : `Could not make this ${noun} the default`)
        },
      },
    )
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={makeDefault.isPending}
        style={{
          width: '100%',
          height: 48,
          marginBottom: hasBanner ? 8 : 16,
          background: 'var(--surface)',
          border: '1px dashed var(--border-strong)',
          borderRadius: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: makeDefault.isPending ? 'not-allowed' : 'pointer',
          opacity: makeDefault.isPending ? 0.6 : 1,
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-secondary)' }}>
          {makeDefault.isPending ? 'MAKING THE DEFAULT…' : `MAKE THIS ${noun.toUpperCase()} THE NEW DEFAULT`}
        </span>
      </button>

      {/* The existing "Apply this change to planned weeks ahead" offer, now for every
          workout whose default was rewritten. */}
      <ApplyAheadBanner
        offer={applyAheadOffer.offer}
        outcome={applyAheadOffer.outcome}
        isPending={applyAheadOffer.isPending}
        onApply={applyAheadOffer.apply}
        onDismiss={applyAheadOffer.dismiss}
      />

      {confirming && (
        <ConfirmDialog
          title={`Make ${noun} ${weekNumber} the new default?`}
          body={`Its sets, reps and structure become the default every ${noun} planned from now on starts from. Weights, RIR and tags are not part of it, and deload sessions keep the current default. This cannot be undone.`}
          confirmLabel="MAKE DEFAULT"
          isPending={makeDefault.isPending}
          onConfirm={confirm}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
