import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import type { Exercise, ReassignPreview } from '../../types'
import { useExercises, useCreateExercise } from './useExercises'
import { useReassignPreview, useReassignBlockers, useReassignExerciseHistory } from './useReassign'
import { ReassignBlockedError, type ReassignBlockers } from './reassignService'
import { useToastStore } from '../notifications/toastStore'

// Reassignment's confirmation sheet (EXERCISE-LIBRARY-TASKS.md §6, §8 step
// 9) — the one irreversible action in the whole feature. Two steps in one
// sheet, reusing SwapExerciseSheet.tsx's exact pick-then-confirm shape
// (§8 step 9's own brief): choosing a target must not execute anything.
//
// The picker offers every active exercise, not just same-muscle-group ones
// the way SwapExerciseSheet does (§9.6) — a renamed or re-equipped exercise
// can legitimately have moved groups — with same-group candidates surfacing
// first since that's still the common case, and a cross-group pick adding
// its own line to the confirmation below rather than being blocked.
//
// The confirm step is deliberately heavier than SwapExerciseSheet's: typing
// the target's exact name is required to enable MERGE HISTORY (§6.2,
// §11.1, decided 2026-08-28) — case- and whitespace-sensitive, so a
// differently-cased or padded paste does not silently satisfy it — and P3/
// P4 (§5.2) disable the button with their own explanation rather than let
// the RPC refuse after the tap.
//
// That P3/P4 read is a snapshot taken when the target is picked, so it is
// not the last word: reassignExerciseHistory() re-runs the same check
// immediately before the RPC, and a ReassignBlockedError coming back from it
// means the state changed while this sheet sat open. handleConfirm() folds
// those fresh blockers back into the same state the selection-time check
// writes, so the inline explanation appears and the button re-disables — the
// merge never ran, so there is nothing to undo.

interface ReassignSheetProps {
  sourceExercise: Exercise
  onClose: () => void
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export default function ReassignSheet({ sourceExercise, onClose }: ReassignSheetProps) {
  const { data: allExercises = [] } = useExercises(false)
  const createExercise = useCreateExercise()
  const previewReassign = useReassignPreview()
  const checkBlockers = useReassignBlockers()
  const reassign = useReassignExerciseHistory()
  const showToast = useToastStore((s) => s.show)

  const [pending, setPending] = useState<Exercise | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [typedName, setTypedName] = useState('')
  const [preview, setPreview] = useState<ReassignPreview | null>(null)
  const [blockers, setBlockers] = useState<ReassignBlockers | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)

  // §9.6 — all active exercises are valid targets; same muscle group first
  // (still the common case) rather than the only option SwapExerciseSheet
  // offers.
  const candidates = allExercises
    .filter((ex) => ex.id !== sourceExercise.id)
    .sort((a, b) => {
      const aSame = a.muscleGroup === sourceExercise.muscleGroup
      const bSame = b.muscleGroup === sourceExercise.muscleGroup
      if (aSame !== bSame) return aSame ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  async function selectTarget(ex: Exercise) {
    setPending(ex)
    setTypedName('')
    setPreview(null)
    setBlockers(null)
    setLoadError(false)
    setLoading(true)
    try {
      const [p, b] = await Promise.all([
        previewReassign.mutateAsync({ sourceId: sourceExercise.id, targetId: ex.id }),
        checkBlockers.mutateAsync(),
      ])
      setPreview(p)
      setBlockers(b)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    const created = await createExercise.mutateAsync({ name: trimmed, muscleGroup: sourceExercise.muscleGroup })
    setShowCreateForm(false)
    setNewName('')
    await selectTarget(created)
  }

  function handleBack() {
    setPending(null)
    setPreview(null)
    setBlockers(null)
    setTypedName('')
    setLoadError(false)
  }

  function handleConfirm() {
    if (!pending) return
    const targetName = pending.name
    reassign.mutate(
      { sourceId: sourceExercise.id, target: pending },
      {
        onSuccess: (result) => {
          showToast(
            result.sourceDeleted
              ? `Merged ${plural(result.setLogsMoved, 'set')} of ${sourceExercise.name} into ${targetName}`
              : `Merged ${plural(result.setLogsMoved, 'set')} into ${targetName} — ${sourceExercise.name} still has references and was not removed`,
          )
          onClose()
        },
        onError: (error) => {
          // The merge-time P3/P4 re-check refused, i.e. the selection-time
          // snapshot went stale while this sheet was open. Re-render the same
          // explanation that check already has copy for, using what was just
          // observed rather than what was true at pick time. Nothing was
          // written — the RPC was never reached — so say so plainly instead
          // of reporting a failure the lifter would have to go and verify.
          if (error instanceof ReassignBlockedError) {
            setBlockers(error.blockers)
            showToast('Merge cancelled — nothing was changed')
            return
          }
          showToast(`Could not merge ${sourceExercise.name} into ${targetName}`)
        },
      },
    )
  }

  const blocked = !!blockers?.hasUnsyncedSets || !!blockers?.hasSessionInProgress
  const nameMatches = pending !== null && typedName === pending.name
  const canConfirm = !!preview && !blocked && nameMatches && !reassign.isPending

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,6,7,0.88)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'flex-end',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--surface-raised)',
          borderRadius: '20px 20px 0 0',
          width: '100%',
          padding: '24px 20px',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
          maxHeight: '90dvh',
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderBottom: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '1.5px',
              color: 'var(--accent)',
            }}
          >
            {pending ? 'CONFIRM MERGE' : 'REASSIGN HISTORY'}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 34,
              height: 34,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface-overlay)',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {!pending && (
          <div>
            {showCreateForm ? (
              <form onSubmit={handleCreate} style={{ marginBottom: 16 }}>
                <p
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '1.5px',
                    color: 'var(--text-muted)',
                    marginBottom: 8,
                  }}
                >
                  NEW {sourceExercise.muscleGroup.toUpperCase()} EXERCISE
                </p>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Exercise name"
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    fontSize: 14,
                    outline: 'none',
                    marginBottom: 12,
                    background: 'var(--surface)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--text-primary)',
                  }}
                />
                {createExercise.isError && (
                  <p style={{ fontSize: 12, marginBottom: 12, color: 'var(--error)' }}>
                    {(createExercise.error as Error).message}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    style={{
                      flex: 1,
                      height: 40,
                      background: 'var(--surface)',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 10,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      fontSize: 11,
                      letterSpacing: '1px',
                      cursor: 'pointer',
                    }}
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    disabled={createExercise.isPending || !newName.trim()}
                    style={{
                      flex: 1,
                      height: 40,
                      background: 'var(--accent)',
                      border: 'none',
                      borderRadius: 10,
                      color: 'var(--base)',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      fontSize: 11,
                      letterSpacing: '1px',
                      cursor: createExercise.isPending || !newName.trim() ? 'not-allowed' : 'pointer',
                      opacity: createExercise.isPending || !newName.trim() ? 0.5 : 1,
                    }}
                  >
                    {createExercise.isPending ? '…' : 'CREATE'}
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowCreateForm(true)}
                style={{
                  width: '100%',
                  minHeight: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  borderRadius: 10,
                  border: '1px dashed var(--border)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: '1.5px',
                  cursor: 'pointer',
                  marginBottom: 12,
                }}
              >
                <Plus size={12} />
                CREATE NEW EXERCISE
              </button>
            )}

            {candidates.length === 0 ? (
              <p
                style={{
                  textAlign: 'center',
                  padding: '24px 0',
                  fontSize: 13,
                  color: 'var(--text-muted)',
                }}
              >
                No other exercises yet — create one above.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {candidates.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => selectTarget(ex)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                    }}
                  >
                    <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{ex.name}</p>
                    <p
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '1px',
                        color: 'var(--text-muted)',
                        margin: '4px 0 0',
                      }}
                    >
                      {ex.muscleGroup.toUpperCase()}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {pending && loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
            <div
              className="animate-spin"
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: '2px solid var(--border-strong)',
                borderTopColor: 'var(--accent)',
              }}
            />
          </div>
        )}

        {pending && !loading && loadError && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <p style={{ fontSize: 13, color: 'var(--error)', marginBottom: 16 }}>Could not load merge details.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleBack}
                style={{
                  flex: 1,
                  height: 40,
                  background: 'var(--surface)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 10,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: '1px',
                  cursor: 'pointer',
                }}
              >
                BACK
              </button>
              <button
                onClick={() => selectTarget(pending)}
                style={{
                  flex: 1,
                  height: 40,
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: 10,
                  color: 'var(--base)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: '1px',
                  cursor: 'pointer',
                }}
              >
                RETRY
              </button>
            </div>
          </div>
        )}

        {pending && !loading && !loadError && preview && (
          <div>
            <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-secondary)', marginBottom: 12 }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{sourceExercise.name}</span>
              {' → '}
              <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{pending.name}</span>
            </p>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {plural(preview.setCount, 'set')} across {plural(preview.sessionCount, 'session')} will move.
            </p>

            {preview.firstDate && preview.lastDate && (
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginBottom: 16,
                }}
              >
                {format(parseISO(preview.firstDate), 'MMM d, yyyy')} – {format(parseISO(preview.lastDate), 'MMM d, yyyy')}
              </p>
            )}

            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--error)', marginBottom: 12 }}>
              This is permanent and cannot be undone.
            </p>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
              Going forward, progress charts, e1RM comparisons, and the reference panel will treat all of this
              history as {pending.name} — the two histories become one line.
            </p>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              {sourceExercise.name} will then be deleted.
            </p>

            {preview.affectedWorkoutDays.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                {preview.affectedWorkoutDays.join(', ')} currently {preview.affectedWorkoutDays.length === 1 ? 'lists' : 'list'}{' '}
                both exercises; each will list one exercise where it lists two now.
              </p>
            )}

            {preview.overlappingSessionCount > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                {plural(preview.overlappingSessionCount, 'session')}{' '}
                {preview.overlappingSessionCount === 1 ? 'contains' : 'contain'} both exercises; their sets will be
                combined in the order they were logged.
              </p>
            )}

            {preview.frozenAnalysisCount > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                {preview.frozenAnalysisCount} existing coach {preview.frozenAnalysisCount === 1 ? 'analysis' : 'analyses'}{' '}
                will keep describing {sourceExercise.name} under its old name.
              </p>
            )}

            {pending.muscleGroup !== sourceExercise.muscleGroup && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                {sourceExercise.name} is filed under {sourceExercise.muscleGroup.toUpperCase()}; {pending.name} is
                filed under {pending.muscleGroup.toUpperCase()}.
              </p>
            )}

            {blockers?.hasUnsyncedSets && (
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--error)', marginBottom: 8 }}>
                You have unsynced sets — reconnect and let them sync before merging.
              </p>
            )}
            {blockers?.hasSessionInProgress && (
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--error)', marginBottom: 8 }}>
                Finish or exit your in-progress session before merging.
              </p>
            )}

            <label
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '1px',
                color: 'var(--text-muted)',
                marginTop: 8,
                marginBottom: 6,
              }}
            >
              TYPE "{pending.name}" TO CONFIRM
            </label>
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={pending.name}
              aria-label={`Type ${pending.name} to confirm`}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                fontSize: 14,
                outline: 'none',
                marginBottom: 16,
                background: 'var(--surface)',
                border: `1px solid ${nameMatches ? 'var(--accent)' : 'var(--border-strong)'}`,
                color: 'var(--text-primary)',
              }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleBack}
                style={{
                  flex: 1,
                  height: 44,
                  background: 'transparent',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 10,
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: '1px',
                  cursor: 'pointer',
                }}
              >
                BACK
              </button>
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                style={{
                  flex: 1,
                  height: 44,
                  background: 'var(--error)',
                  border: 'none',
                  borderRadius: 10,
                  color: 'var(--base)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: '1px',
                  cursor: canConfirm ? 'pointer' : 'not-allowed',
                  opacity: canConfirm ? 1 : 0.4,
                }}
              >
                {reassign.isPending ? '…' : 'MERGE HISTORY'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
