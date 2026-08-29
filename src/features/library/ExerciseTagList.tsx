import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Exercise, MuscleGroup, MuscleSubgroup, MovementPattern } from '../../types'
import {
  MOVEMENT_PATTERNS,
  MOVEMENT_PATTERN_LABELS,
  muscleSubgroupLabel,
} from '../../lib/exerciseTags'
import { useUpdateExercise } from './useExercises'
import TagChipGrid from './TagChipGrid'
import MuscleSubgroupPicker from './MuscleSubgroupPicker'

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

// List-mode tag editing (EXERCISE-LIBRARY-TASKS.md §2.6/§8 step 5) — one
// row per exercise, tags editable in place, auto-saving on every chip tap
// the same way ExerciseList.tsx's archive toggle already does (no separate
// save step). Deliberately its own component rather than a second mode
// bolted onto ExerciseList.tsx: that component owns display +
// archive/edit affordances, and this one owns tag editing — two unrelated
// jobs on two unrelated exercise-list flavours (§2's own reasoning).
export default function ExerciseTagList({ exercises }: { exercises: Exercise[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (exercises.length === 0) {
    return (
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
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {exercises.map((ex) => (
        <ExerciseTagRow
          key={ex.id}
          exercise={ex}
          expanded={expandedId === ex.id}
          onToggleExpanded={() => setExpandedId((current) => (current === ex.id ? null : ex.id))}
        />
      ))}
    </div>
  )
}

function ExerciseTagRow({
  exercise,
  expanded,
  onToggleExpanded,
}: {
  exercise: Exercise
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const update = useUpdateExercise()

  // Each tap fires its own update, scoped to exactly the axis that
  // changed — muscleGroup/name are re-sent unchanged (they're not
  // omittable columns) but the *other* tag axis is omitted from `tags`
  // entirely, not sent as null, so it's never blanked by a subgroup-only
  // or pattern-only edit (EXERCISE-LIBRARY-TASKS.md §2.6's don't-blank-
  // on-omit rule — this is the real call site that rule exists for: unlike
  // ExerciseForm.tsx, which always resends both axes together, this row
  // edits one axis at a time).
  function toggleSubgroup(tag: MuscleSubgroup) {
    const current = exercise.muscleSubgroups ?? []
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    update.mutate({
      id: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      tags: { muscleSubgroups: next.length > 0 ? next : null },
    })
  }

  function toggleMovementPattern(pattern: MovementPattern) {
    const next = exercise.movementPattern === pattern ? null : pattern
    update.mutate({
      id: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      tags: { movementPattern: next },
    })
  }

  const subgroupSummary = exercise.muscleSubgroups?.length
    ? exercise.muscleSubgroups.map((tag) => muscleSubgroupLabel(tag)).join(', ')
    : null
  const patternSummary = exercise.movementPattern
    ? MOVEMENT_PATTERN_LABELS[exercise.movementPattern]
    : null

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 16px',
        opacity: exercise.isArchived ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        onClick={onToggleExpanded}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          textAlign: 'left',
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
            {exercise.name}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '1.5px',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{MUSCLE_LABELS[exercise.muscleGroup]}</span>
            {patternSummary && (
              <>
                <span style={{ color: 'var(--text-dim)' }}>·</span>
                <span>{patternSummary}</span>
              </>
            )}
            {subgroupSummary && (
              <>
                <span style={{ color: 'var(--text-dim)' }}>·</span>
                <span style={{ color: 'var(--text-dim)', textTransform: 'none', letterSpacing: 0 }}>
                  {subgroupSummary}
                </span>
              </>
            )}
            {!patternSummary && !subgroupSummary && (
              <span style={{ color: 'var(--text-dim)' }}>UNTAGGED</span>
            )}
          </div>
        </div>
        <ChevronDown
          size={16}
          style={{
            flexShrink: 0,
            color: 'var(--text-muted)',
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms',
          }}
        />
      </button>

      {expanded && (
        <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
          <div style={{ marginBottom: 18 }}>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '1.5px',
                color: 'var(--text-dim)',
                marginBottom: 8,
              }}
            >
              MOVEMENT PATTERN
            </span>
            <TagChipGrid
              values={MOVEMENT_PATTERNS}
              labels={MOVEMENT_PATTERN_LABELS}
              selected={exercise.movementPattern ? [exercise.movementPattern] : []}
              onToggle={toggleMovementPattern}
            />
          </div>

          <div>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '1.5px',
                color: 'var(--text-dim)',
                marginBottom: 8,
              }}
            >
              MUSCLE SUBGROUP
            </span>
            <MuscleSubgroupPicker
              selected={exercise.muscleSubgroups ?? []}
              onToggle={toggleSubgroup}
            />
          </div>
        </div>
      )}
    </div>
  )
}
