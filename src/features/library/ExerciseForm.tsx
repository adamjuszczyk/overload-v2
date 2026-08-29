import { useState } from 'react'
import { X } from 'lucide-react'
import type { Exercise, MuscleGroup, MuscleSubgroup, MovementPattern } from '../../types'
import { useCreateExercise, useUpdateExercise } from './useExercises'
import { MOVEMENT_PATTERNS, MOVEMENT_PATTERN_LABELS } from '../../lib/exerciseTags'
import TagChipGrid from './TagChipGrid'
import MuscleSubgroupPicker from './MuscleSubgroupPicker'

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

const SECTION_LABEL_STYLE = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '2px',
  color: 'var(--text-muted)',
  marginBottom: 10,
} as const

interface Props {
  exercise?: Exercise
  onClose: () => void
}

export default function ExerciseForm({ exercise, onClose }: Props) {
  const isEdit = !!exercise
  const [name, setName] = useState(exercise?.name ?? '')
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>(exercise?.muscleGroup ?? 'chest')
  const [muscleSubgroups, setMuscleSubgroups] = useState<MuscleSubgroup[] | null>(
    exercise?.muscleSubgroups ?? null,
  )
  const [movementPattern, setMovementPattern] = useState<MovementPattern | null>(
    exercise?.movementPattern ?? null,
  )
  const [nameError, setNameError] = useState('')

  const create = useCreateExercise()
  const update = useUpdateExercise()
  const isPending = create.isPending || update.isPending
  const mutationError = create.error || update.error

  function toggleSubgroup(tag: MuscleSubgroup) {
    setMuscleSubgroups((current) => {
      const list = current ?? []
      const next = list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]
      // never [] (ExerciseTags' own convention) — no subgroups selected is
      // "untagged", the same state as never having opened this section.
      return next.length > 0 ? next : null
    })
  }

  function toggleMovementPattern(pattern: MovementPattern) {
    // Tapping the already-selected pattern clears it back to null — the
    // same "there is always a way back to unrated/untagged" convention
    // RatingChips.tsx already uses, since movement_pattern is nullable too.
    setMovementPattern((current) => (current === pattern ? null : pattern))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Name is required')
      return
    }
    setNameError('')
    const tags = { muscleSubgroups, movementPattern }
    try {
      if (isEdit && exercise) {
        await update.mutateAsync({ id: exercise.id, name: trimmed, muscleGroup, tags })
      } else {
        await create.mutateAsync({ name: trimmed, muscleGroup, tags })
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
            <label style={SECTION_LABEL_STYLE}>MUSCLE GROUP</label>
            <TagChipGrid
              values={MUSCLE_GROUPS}
              labels={MUSCLE_LABELS}
              selected={[muscleGroup]}
              onToggle={setMuscleGroup}
            />
          </div>

          {/* Movement pattern — single-select, DB-enforced vocabulary
              (migration 013's CHECK, mirrored in exerciseTags.ts). Nullable:
              untagged is a real, valid state, not a missing default. */}
          <div style={{ marginBottom: 32 }}>
            <label style={SECTION_LABEL_STYLE}>MOVEMENT PATTERN</label>
            <TagChipGrid
              values={MOVEMENT_PATTERNS}
              labels={MOVEMENT_PATTERN_LABELS}
              selected={movementPattern ? [movementPattern] : []}
              onToggle={toggleMovementPattern}
            />
          </div>

          {/* Muscle subgroup — multi-select, app-layer-only vocabulary
              (no DB CHECK — EXERCISE-LIBRARY-TASKS.md §8 step 4/§9.10).
              Grouped into exerciseTags.ts's six categories for a
              sensibly-ordered grid rather than one 22-chip wall. */}
          <div style={{ marginBottom: 32 }}>
            <label style={SECTION_LABEL_STYLE}>MUSCLE SUBGROUP</label>
            <MuscleSubgroupPicker selected={muscleSubgroups ?? []} onToggle={toggleSubgroup} />
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
