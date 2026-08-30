import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { X, RotateCcw, GitMerge } from 'lucide-react'
import type { Exercise, MuscleGroup } from '../../types'
import { useLostExercises, useRestoreExercise } from './useExercises'
import { useToastStore } from '../notifications/toastStore'
import ReassignSheet from './ReassignSheet'

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

// Lost Exercises (EXERCISE-LIBRARY-TASKS.md §8 step 7) — exercises with real
// logged history that were removed from the active library rather than
// destroyed (SPEC §3). Restore is the reversible direction (§9.4/§11.4): no
// preflight, no confirm dialog — a single tap moves the row back to
// 'active', the same auto-save-on-tap convention this app already uses for
// low-risk mutations (ExerciseTagList's chip taps, ExerciseList's archive
// toggle). Reassignment (§8 step 9) opens ReassignSheet.tsx, the one
// irreversible action in the feature — its own two-step confirm, not
// borrowed here.
export default function LostExercises({ onClose }: { onClose: () => void }) {
  const { data: exercises = [], isLoading, error } = useLostExercises()
  const restore = useRestoreExercise()
  const showToast = useToastStore((s) => s.show)
  const [reassigning, setReassigning] = useState<Exercise | null>(null)

  function handleRestore(ex: Exercise) {
    restore.mutate(ex.id, {
      onSuccess: () => showToast(`${ex.name} restored to your active library`),
      onError: () => showToast(`Could not restore ${ex.name}`),
    })
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,6,7,0.88)',
        zIndex: 50,
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
            marginBottom: 24,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 18,
              letterSpacing: '1px',
              color: 'var(--text-primary)',
            }}
          >
            LOST EXERCISES
          </span>
          <button
            onClick={onClose}
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

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 24, paddingBottom: 24 }}>
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

        {error && !isLoading && (
          <p
            style={{
              textAlign: 'center',
              paddingTop: 24,
              paddingBottom: 24,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '1.5px',
              color: 'var(--error)',
            }}
          >
            FAILED TO LOAD
          </p>
        )}

        {!isLoading && !error && exercises.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '2px',
                color: 'var(--text-dim)',
              }}
            >
              NO LOST EXERCISES
            </p>
          </div>
        )}

        {!isLoading && !error && exercises.length > 0 && (
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
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '1.5px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {MUSCLE_LABELS[ex.muscleGroup]}
                    {ex.lostAt && (
                      <>
                        <span style={{ color: 'var(--text-dim)' }}> · </span>
                        LOST {format(parseISO(ex.lostAt), 'MMM d, yyyy').toUpperCase()}
                      </>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setReassigning(ex)}
                  title="Reassign"
                  style={{
                    width: 36,
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    borderRadius: 8,
                    flexShrink: 0,
                  }}
                >
                  <GitMerge size={15} />
                </button>

                <button
                  onClick={() => handleRestore(ex)}
                  title="Restore"
                  disabled={restore.isPending}
                  style={{
                    width: 36,
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent)',
                    cursor: restore.isPending ? 'not-allowed' : 'pointer',
                    borderRadius: 8,
                    flexShrink: 0,
                  }}
                >
                  <RotateCcw size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        {reassigning && <ReassignSheet sourceExercise={reassigning} onClose={() => setReassigning(null)} />}
      </div>
    </div>
  )
}
