// The chip grid ExerciseForm.tsx's muscle-group picker already was,
// extracted so muscle_subgroup/movement_pattern editing (EXERCISE-LIBRARY-
// TASKS.md §2.6/§8 step 5) reuses the exact same component/interaction
// rather than a second control shape: single-select just means the caller
// always keeps `selected` at length ≤ 1, multi-select means it doesn't.
// This component has no opinion on which — it only renders `values`,
// highlights whatever's in `selected`, and reports taps.
export default function TagChipGrid<T extends string>({
  values,
  labels,
  selected,
  onToggle,
  columns = 3,
}: {
  values: readonly T[]
  labels: Record<T, string>
  selected: readonly T[]
  onToggle: (value: T) => void
  columns?: number
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 8,
      }}
    >
      {values.map((value) => {
        const active = selected.includes(value)
        return (
          <button
            key={value}
            type="button"
            onClick={() => onToggle(value)}
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
            {labels[value]}
          </button>
        )
      })}
    </div>
  )
}
