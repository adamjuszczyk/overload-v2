import { useState } from 'react'
import { X } from 'lucide-react'
import type { Exercise, MuscleGroup } from '../../types'
import { useCreateExercise, useUpdateExercise } from './useExercises'

const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
  'core', 'other',
]

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
  exercise?: Exercise
  onClose: () => void
}

export default function ExerciseForm({ exercise, onClose }: Props) {
  const isEdit = !!exercise
  const [name, setName] = useState(exercise?.name ?? '')
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>(exercise?.muscleGroup ?? 'chest')
  const [nameError, setNameError] = useState('')

  const create = useCreateExercise()
  const update = useUpdateExercise()
  const isPending = create.isPending || update.isPending
  const mutationError = create.error || update.error

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Name is required')
      return
    }
    setNameError('')
    try {
      if (isEdit && exercise) {
        await update.mutateAsync({ id: exercise.id, name: trimmed, muscleGroup })
      } else {
        await create.mutateAsync({ name: trimmed, muscleGroup })
      }
      onClose()
    } catch {
      // error surfaced via mutationError
    }
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
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 28,
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
            {isEdit ? 'EDIT EXERCISE' : 'ADD EXERCISE'}
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

        <form onSubmit={handleSubmit}>
          {/* Exercise name */}
          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '2px',
                color: 'var(--text-muted)',
                marginBottom: 8,
              }}
            >
              EXERCISE NAME
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (nameError) setNameError('')
              }}
              placeholder="e.g. Bench Press"
              autoFocus
              style={{
                width: '100%',
                height: 52,
                background: 'var(--surface)',
                border: `1px solid ${nameError ? 'var(--error)' : 'var(--border-strong)'}`,
                borderRadius: 10,
                padding: '0 16px',
                fontSize: 16,
                fontWeight: 500,
                color: 'var(--text-primary)',
                boxSizing: 'border-box',
              }}
            />
            {nameError && (
              <span
                style={{
                  display: 'block',
                  marginTop: 6,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--error)',
                  letterSpacing: '0.5px',
                }}
              >
                {nameError}
              </span>
            )}
          </div>

          {/* Muscle group grid */}
          <div style={{ marginBottom: 32 }}>
            <label
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '2px',
                color: 'var(--text-muted)',
                marginBottom: 10,
              }}
            >
              MUSCLE GROUP
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
              }}
            >
              {MUSCLE_GROUPS.map((mg) => {
                const active = muscleGroup === mg
                return (
                  <button
                    key={mg}
                    type="button"
                    onClick={() => setMuscleGroup(mg)}
                    style={{
                      height: 42,
                      background: active ? 'var(--accent-muted)' : 'var(--surface)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
                      borderRadius: 9,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '1px',
                      color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    {MUSCLE_LABELS[mg]}
                  </button>
                )
              })}
            </div>
          </div>

          {mutationError && (
            <p
              style={{
                marginBottom: 12,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--error)',
                letterSpacing: '0.5px',
              }}
            >
              Failed to save. Please try again.
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            style={{
              width: '100%',
              height: 56,
              background: isPending ? 'var(--border-strong)' : 'var(--accent)',
              border: 'none',
              borderRadius: 11,
              cursor: isPending ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-display)',
              fontWeight: 900,
              fontSize: 15,
              letterSpacing: '2px',
              color: isPending ? 'var(--text-muted)' : 'var(--base)',
            }}
          >
            {isPending ? '…' : isEdit ? 'SAVE CHANGES' : 'ADD EXERCISE'}
          </button>
        </form>
      </div>
    </div>
  )
}
