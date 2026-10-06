import { MARK_LABELS } from '../../lib/priorityMarks.js'
import type { PriorityMark } from '../../lib/priorityMarks.js'

const MARKS: readonly PriorityMark[] = ['focus', 'dont_care']

// The 2-way mark chip row (chunk 10) — same tokens, sizing and structure as
// PrioritySelector.tsx (features/coach/), the app's own existing chip row
// for this exact kind of per-tag control (44px targets, hide-scrollbar
// horizontal overflow, --accent on the active chip, every colour via CSS
// custom properties, var(--font-mono)). Not reused directly, for the same
// reason usePriorityContext.ts's header already gives for why PrioritySelector
// itself doesn't reuse RatingChips.tsx: the value contract differs.
// PriorityMark has a real "unset" state — "left normal" (SPEC) is `null`,
// not a third chip — and tapping the already-active chip clears it back to
// that state instead of being a no-op, which PrioritySelector's own
// contract (every tap sets a value; priority always has one) doesn't
// support. A new small control following the same tokens is the
// established way this codebase handles that divergence, not a reason to
// invent a different visual language.
export default function MarkSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: PriorityMark | null
  onChange: (value: PriorityMark | null) => void
  disabled?: boolean
}) {
  return (
    <div className="hide-scrollbar flex items-center gap-1.5" style={{ overflowX: 'auto', paddingBottom: 2 }}>
      {MARKS.map((m) => {
        const active = value === m
        return (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onChange(active ? null : m)}
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
            {MARK_LABELS[m]}
          </button>
        )
      })}
    </div>
  )
}
