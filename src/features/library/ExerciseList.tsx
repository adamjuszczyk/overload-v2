import { useState } from 'react'
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react'
import type { Exercise, MuscleGroup } from '../../types'
import { useSetExerciseArchived, useExerciseDeletePreview, useDeleteExercise } from './useExercises'
import { useToastStore } from '../notifications/toastStore'
import ConfirmDialog from '../../components/ConfirmDialog'

const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'CHEST',
  back: 'BACK',
  shoulders: 'SHOULDERS',
  biceps: 'BICEPS',
  triceps: 'TRICEPS',
  forearms: 'FOREARMS',
  quads: 'QUADS',
  hamstrings: 'HAMSTRINGS',
  glutes: 'GLUTES',
  calves: 'CALVES',
  core: 'CORE',
  other: 'OTHER',
}

interface Props {
  exercises: Exercise[]
  onEdit: (exercise: Exercise) => void
}

// Delete state, per EXERCISE-LIBRARY-TASKS.md §8 step 7 — deliberately the
// "different and lighter thing" §6.3 describes: a single ConfirmDialog step,
// no typed-name friction. willHardDelete/setCount come from a real
// previewExerciseDelete() check fired on tap, not guessed client-side, so
// the confirm copy always matches what deleteExercise() is about to do.
interface DeleteConfirmState {
  exercise: Exercise
  setCount: number
  willHardDelete: boolean
  // Non-empty only when willHardDelete — the program template(s) this
  // exercise will silently disappear from the moment the delete fires
  // (exerciseService.ts's previewExerciseDelete). Disclosed rather than
  // left implicit: it's a real side effect the spec never anticipated.
  programNames: string[]
}

export default function ExerciseList({ exercises, onEdit }: Props) {
  const setArchived = useSetExerciseArchived()
  const deletePreview = useExerciseDeletePreview()
  const deleteExercise = useDeleteExercise()
  const showToast = useToastStore((s) => s.show)

  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [confirmState, setConfirmState] = useState<DeleteConfirmState | null>(null)

  async function handleDeleteTap(ex: Exercise) {
    setPreviewingId(ex.id)
    try {
      const { outcome, setCount, programNames } = await deletePreview.mutateAsync(ex.id)
      setConfirmState({ exercise: ex, setCount, willHardDelete: outcome === 'gone', programNames })
    } catch {
      showToast(`Could not check ${ex.name}'s history`)
    } finally {
      setPreviewingId(null)
    }
  }

  function handleConfirmDelete() {
    if (!confirmState) return
    const { exercise, willHardDelete } = confirmState
    deleteExercise.mutate(exercise.id, {
      onSuccess: () => {
        showToast(willHardDelete ? `${exercise.name} deleted` : `${exercise.name} moved to Lost Exercises`)
        setConfirmState(null)
      },
      onError: () => showToast(`Could not delete ${exercise.name}`),
    })
  }

  return (
    <>
      {exercises.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '2px',
              color: 'var(--text-dim)',
            }}
          >
            NO EXERCISES
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {exercises.map((ex) => (
            <div
              key={ex.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: ex.isArchived ? 0.5 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 16,
                    color: 'var(--text-primary)',
                    marginBottom: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ex.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '1.5px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {MUSCLE_LABELS[ex.muscleGroup]}
                  </span>
                  {ex.isArchived && (
                    <>
                      <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>·</span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '1.5px',
                          color: 'var(--text-dim)',
                        }}
                      >
                        ARCHIVED
                      </span>
                    </>
                  )}
                </div>
              </div>

              <button
                onClick={() => onEdit(ex)}
                title="Edit"
                style={{
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              >
                <Pencil size={15} />
              </button>

              <button
                onClick={() => setArchived.mutate({ id: ex.id, archived: !ex.isArchived })}
                title={ex.isArchived ? 'Unarchive' : 'Archive'}
                disabled={setArchived.isPending}
                style={{
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: setArchived.isPending ? 'not-allowed' : 'pointer',
                  borderRadius: 8,
                  flexShrink: 0,
                }}
              >
                {ex.isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              </button>

              <button
                onClick={() => handleDeleteTap(ex)}
                title="Delete"
                disabled={previewingId === ex.id}
                style={{
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: previewingId === ex.id ? 'not-allowed' : 'pointer',
                  borderRadius: 8,
                  flexShrink: 0,
                  opacity: previewingId === ex.id ? 0.5 : 1,
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmState && (
        <ConfirmDialog
          title={confirmState.willHardDelete ? 'DELETE EXERCISE' : 'MOVE TO LOST EXERCISES'}
          body={
            confirmState.willHardDelete ? (
              <>
                <strong style={{ color: 'var(--text-primary)' }}>{confirmState.exercise.name}</strong> has no
                logged history and will be permanently deleted. This cannot be undone.
                {confirmState.programNames.length > 0 && (
                  <>
                    {' '}
                    It will also be removed from{' '}
                    {confirmState.programNames.length === 1 ? 'the workout template for ' : 'these workout templates: '}
                    <strong style={{ color: 'var(--text-primary)' }}>{confirmState.programNames.join(', ')}</strong>.
                  </>
                )}
              </>
            ) : (
              <>
                <strong style={{ color: 'var(--text-primary)' }}>{confirmState.exercise.name}</strong> has{' '}
                {confirmState.setCount} logged {confirmState.setCount === 1 ? 'set' : 'sets'}. It will be removed
                from your active library and moved to Lost Exercises — its history stays fully intact, and you can
                restore it anytime.
              </>
            )
          }
          confirmLabel={confirmState.willHardDelete ? 'DELETE' : 'MOVE TO LOST'}
          danger={confirmState.willHardDelete}
          isPending={deleteExercise.isPending}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </>
  )
}
