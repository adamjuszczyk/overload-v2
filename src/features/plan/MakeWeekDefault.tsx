import { useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useToastStore } from '../notifications/toastStore'
import { useMakeWeekDefault } from './useMakeWeekDefault'

// Chunk 32 — "Make this week the new default" (SPEC Weeks and copying [P1.1]; Plan screen:
// "stable runs: 'Make this week the new default' (current and future weeks, with a
// confirm step)"). A page-level action, one per week, like COPY WEEK and MARK WEEK AS
// DELOAD above it: PlanPage mounts this only where SPEC offers it (a stable run, the
// current week or a later one, a week with at least one session that can be a source), so
// the button's absence elsewhere is PlanPage's rule, tested there.
//
// Tapping it asks first (the app's shared confirm dialog) and nothing is called until
// CONFIRM: there is no undo. On confirm, v2_make_week_default rewrites the run's copy and
// a toast says so (and which workouts kept the current default). That is all it does:
// weeks that are already planned keep exactly what they have, and nothing is offered or
// written for them (no "apply this change to planned weeks ahead" after it; the offer was
// taken out of this chunk after review and is recoverable from commit 933f2a1). An error
// of the call is shown as a toast and nothing else happens.
//
// Display-only choices (D31), provisional: the button reads CYCLE where a sequence run
// says cycle everywhere else; a success toast says what happened (nothing else on the
// screen changes at once); the dialog closes before an error toast so the toast (which
// sits under the dialog's overlay) can be seen.
export default function MakeWeekDefault({
  mesoId,
  weekNumber,
  isSequence,
}: {
  mesoId: string
  weekNumber: number
  isSequence: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const makeDefault = useMakeWeekDefault(mesoId)
  const showToast = useToastStore((s) => s.show)

  const noun = isSequence ? 'cycle' : 'week'

  function confirm() {
    makeDefault.mutate(
      { weekNumber },
      {
        onSuccess: (result) => {
          setConfirming(false)
          // The default is written. Say so, and which sessions kept the current default.
          const done = `${isSequence ? 'Cycle' : 'Week'} ${weekNumber} is now the default.`
          showToast(result.skipped.length > 0 ? `${done} Deload or empty sessions kept the current default.` : done)
        },
        onError: (err) => {
          // Atomic: the call wrote nothing. Close the dialog (its overlay would hide the
          // toast) and say why; the screen stays as it was.
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
          marginBottom: 16,
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
