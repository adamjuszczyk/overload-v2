import { useState } from 'react'
import { Plus, Library, ArchiveX } from 'lucide-react'
import type { Exercise, MuscleGroup } from '../../types'
import { useExercises } from './useExercises'
import ExerciseList from './ExerciseList'
import ExerciseForm from './ExerciseForm'
import ExerciseTagList from './ExerciseTagList'
import LibraryCatalog from './LibraryCatalog'
import LostExercises from './LostExercises'

const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
  'core', 'other',
]

type FormState = null | { mode: 'create' } | { mode: 'edit'; exercise: Exercise }
// SPEC §3: a single scrollable list with inline editing *and* a
// per-exercise detail view, user's choice — this is that choice.
// 'list' is the existing display+archive+edit-via-sheet flow, now with a
// tag-aware ExerciseForm.tsx; 'tags' is the new fast inline tag-review
// pass across every exercise at once (EXERCISE-LIBRARY-TASKS.md §2.6/§8
// step 5).
type ViewMode = 'list' | 'tags'

export default function LibraryPage() {
  const [filter, setFilter] = useState<MuscleGroup | 'all'>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [formState, setFormState] = useState<FormState>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [showLibraries, setShowLibraries] = useState(false)
  const [showLost, setShowLost] = useState(false)

  const { data: exercises = [], isLoading, error } = useExercises(showArchived)

  const filtered =
    filter === 'all' ? exercises : exercises.filter((ex) => ex.muscleGroup === filter)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--base)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 20px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            fontSize: 22,
            letterSpacing: '1px',
            color: 'var(--text-primary)',
          }}
        >
          LIBRARY
        </span>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {/* Libraries — replaces the old single "import defaults" button
              (EXERCISE-LIBRARY-TASKS.md §8 step 6). Opens the real catalog:
              every listed library previewable and downloadable on its own,
              instead of one all-or-nothing seed list. */}
          <button
            onClick={() => setShowLibraries(true)}
            aria-label="Browse exercise libraries"
            style={{
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface-overlay)',
              border: '1px solid var(--border-strong)',
              borderRadius: 11,
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            <Library size={18} strokeWidth={2.5} />
          </button>
          {/* Lost Exercises entry point (EXERCISE-LIBRARY-TASKS.md §8 step
              7) — a dedicated screen, not a filter on this list, since
              fetchExercises() now always excludes status = 'lost'. */}
          <button
            onClick={() => setShowLost(true)}
            aria-label="View lost exercises"
            style={{
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--surface-overlay)',
              border: '1px solid var(--border-strong)',
              borderRadius: 11,
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            <ArchiveX size={18} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => setFormState({ mode: 'create' })}
            style={{
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 11,
              cursor: 'pointer',
              color: 'var(--base)',
              flexShrink: 0,
            }}
          >
            <Plus size={20} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Muscle group filter — horizontal scroll */}
      <div
        className="hide-scrollbar"
        style={{ overflowX: 'auto', flexShrink: 0, padding: '16px 0 12px' }}
      >
        <div style={{ display: 'flex', gap: 6, paddingLeft: 20, paddingRight: 20 }}>
          <FilterChip
            label="ALL"
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          />
          {MUSCLE_GROUPS.map((mg) => (
            <FilterChip
              key={mg}
              label={mg.toUpperCase()}
              active={filter === mg}
              onClick={() => setFilter(filter === mg ? 'all' : mg)}
            />
          ))}
        </div>
      </div>

      {/* List / tags mode toggle */}
      <div style={{ padding: '0 20px 12px', flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 9,
            padding: 3,
          }}
        >
          {(['list', 'tags'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              style={{
                flex: 1,
                height: 32,
                background: viewMode === mode ? 'var(--accent-muted)' : 'transparent',
                border: 'none',
                borderRadius: 7,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '1.5px',
                color: viewMode === mode ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {mode === 'list' ? 'LIST' : 'EDIT TAGS'}
            </button>
          ))}
        </div>
      </div>

      {/* Exercise list */}
      <div
        className="hide-scrollbar"
        style={{ flex: 1, overflowY: 'auto', padding: '0 20px', minHeight: 0 }}
      >
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 48 }}>
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
              paddingTop: 48,
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

        {!isLoading && !error && viewMode === 'list' && (
          <ExerciseList
            exercises={filtered}
            onEdit={(ex) => setFormState({ mode: 'edit', exercise: ex })}
          />
        )}

        {!isLoading && !error && viewMode === 'tags' && <ExerciseTagList exercises={filtered} />}

        {!isLoading && !error && (
          <div style={{ padding: '20px 0 32px', textAlign: 'center' }}>
            <button
              onClick={() => setShowArchived((v) => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '2px',
                color: 'var(--text-dim)',
                padding: '8px 12px',
              }}
            >
              {showArchived ? 'HIDE ARCHIVED' : 'SHOW ARCHIVED'}
            </button>
          </div>
        )}
      </div>

      {formState && (
        <ExerciseForm
          exercise={formState.mode === 'edit' ? formState.exercise : undefined}
          onClose={() => setFormState(null)}
        />
      )}

      {showLibraries && <LibraryCatalog onClose={() => setShowLibraries(false)} />}

      {showLost && <LostExercises onClose={() => setShowLost(false)} />}
    </div>
  )
}

interface FilterChipProps {
  label: string
  active: boolean
  onClick: () => void
}

function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 30,
        padding: '0 12px',
        flexShrink: 0,
        background: active ? 'var(--accent-muted)' : 'var(--surface)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '1.5px',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      {label}
    </button>
  )
}
