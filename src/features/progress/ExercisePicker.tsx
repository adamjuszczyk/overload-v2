import { useState, useMemo } from 'react'
import { useExercises } from '../library/useExercises'
import type { Exercise, MuscleGroup } from '../../types'

// Shared exercise picker — used by Progress's EXERCISE tab and History's
// EXERCISES tab (CONTEXT.md "History: Sessions/Exercises tab split") so both
// entry points into "pick an exercise, then see its data" go through the
// same component instead of two hand-rolled copies.

const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
  'core', 'other',
]

export default function ExercisePicker({ onSelect }: { onSelect: (ex: Exercise) => void }) {
  const [search, setSearch] = useState('')
  const [filterGroup, setFilterGroup] = useState<MuscleGroup | null>(null)
  const { data: exercises = [] } = useExercises(false)

  const filtered = useMemo(
    () =>
      exercises
        .filter((ex) => !filterGroup || ex.muscleGroup === filterGroup)
        .filter((ex) => !search || ex.name.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [exercises, search, filterGroup],
  )

  return (
    <div className="mt-4">
      {/* Search */}
      <input
        type="search"
        placeholder="Search exercises…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      />

      {/* Muscle group filter chips */}
      <div
        className="flex gap-1.5 mt-2 overflow-x-auto pb-1"
        style={{ scrollbarWidth: 'none' }}
      >
        <button
          onClick={() => setFilterGroup(null)}
          className="flex-none px-2.5 py-1 rounded-full text-xs font-bold tracking-wide"
          style={{
            backgroundColor: filterGroup === null ? 'var(--accent)' : 'var(--surface)',
            color: filterGroup === null ? 'var(--base)' : 'var(--text-muted)',
            border: `1px solid ${filterGroup === null ? 'var(--accent)' : 'var(--border)'}`,
            fontFamily: 'var(--font-mono)',
          }}
        >
          ALL
        </button>
        {MUSCLE_GROUPS.map((mg) => (
          <button
            key={mg}
            onClick={() => setFilterGroup(filterGroup === mg ? null : mg)}
            className="flex-none px-2.5 py-1 rounded-full text-xs font-bold tracking-wide"
            style={{
              backgroundColor: filterGroup === mg ? 'var(--accent)' : 'var(--surface)',
              color: filterGroup === mg ? 'var(--base)' : 'var(--text-muted)',
              border: `1px solid ${filterGroup === mg ? 'var(--accent)' : 'var(--border)'}`,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {mg.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Exercise list */}
      {filtered.length === 0 ? (
        <p className="mt-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No exercises found
        </p>
      ) : (
        <div
          className="mt-3 rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border)' }}
        >
          {filtered.map((ex, i) => (
            <button
              key={ex.id}
              onClick={() => onSelect(ex)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              style={{
                backgroundColor: 'var(--surface)',
                borderTop: i > 0 ? '1px solid var(--border)' : undefined,
              }}
            >
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {ex.name}
              </span>
              <span
                className="text-xs ml-3 flex-none"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {ex.muscleGroup?.toUpperCase() ?? 'OTHER'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
