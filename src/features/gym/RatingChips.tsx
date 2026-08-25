import type { RatingScale } from './ratingScales'

// The segmented chip row COACH-PERSONALIZATION-TASKS.md §1.1 builds instead
// of SPEC §6's literal "slider" — this app has no slider primitive anywhere,
// and the values here are named, not numeric, so a chip row that shows every
// label at once (rather than reading one off a track position) is a closer
// match to the app's existing small-closed-vocabulary idiom (WorkoutSwitcher
// .tsx's chip row, the INHERIT/KG/LBS picker). One tap selects; tapping the
// already-selected chip clears it back to "not rated" (SPEC §7 "absence is
// data too" — there is always a way back to null, not just forward into a
// value). Horizontally scrollable (WorkoutSwitcher.tsx's own pattern) so a
// long label list never overflows a narrow phone viewport, and every chip
// keeps this file's 44px touch target regardless of label length.
export default function RatingChips<T extends string>({
  scale,
  value,
  onChange,
  label,
}: {
  scale: RatingScale<T>
  value: T | null
  onChange: (value: T | null) => void
  label: string
}) {
  return (
    <div>
      <span
        className="block text-xs mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </span>
      <div
        className="hide-scrollbar flex items-center gap-1.5"
        style={{ overflowX: 'auto', paddingBottom: 2 }}
      >
        {scale.values.map((v) => {
          const active = value === v
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(active ? null : v)}
              className="flex-shrink-0 flex items-center justify-center px-3 rounded-lg text-xs font-bold tracking-widest"
              style={{
                height: 44,
                backgroundColor: active ? 'var(--accent)' : 'var(--surface)',
                color: active ? 'var(--base)' : 'var(--text-muted)',
                border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
              }}
            >
              {scale.labels[v]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
