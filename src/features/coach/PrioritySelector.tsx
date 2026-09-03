import { PRIORITY_SCALE } from '../../lib/priorityTags.js'
import type { PriorityLevel } from '../../lib/priorityTags.js'

// The 4-way priority chip row (PRIORITY-CONTEXT-TASKS.md §5.4) — modelled on
// RatingChips.tsx (44px targets, hide-scrollbar horizontal overflow,
// --accent on the active chip, every colour via CSS custom properties,
// var(--font-mono)) but with a non-nullable contract: exactly one chip is
// always active, and tapping the active chip is a no-op rather than clearing
// it. Priority has no "unset" value of its own — absence of a row is what
// means "not set for this meso" (TASKS §2.4), and that distinction lives in
// isExplicit, not in this control (§0.1 finding 3 is why RatingChips itself
// isn't reused directly). No label prop: the caller renders the tag's own
// label as part of its row (§5.2).
export default function PrioritySelector({
  value,
  onChange,
  disabled = false,
}: {
  value: PriorityLevel
  onChange: (value: PriorityLevel) => void
  disabled?: boolean
}) {
  return (
    <div
      className="hide-scrollbar flex items-center gap-1.5"
      style={{ overflowX: 'auto', paddingBottom: 2 }}
    >
      {PRIORITY_SCALE.values.map((v) => {
        const active = value === v
        return (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!active) onChange(v)
            }}
            className="flex-shrink-0 flex items-center justify-center px-3 rounded-lg text-xs font-bold tracking-widest"
            style={{
              height: 44,
              backgroundColor: active ? 'var(--accent)' : 'var(--surface)',
              color: active ? 'var(--base)' : 'var(--text-muted)',
              border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            {PRIORITY_SCALE.labels[v]}
          </button>
        )
      })}
    </div>
  )
}
