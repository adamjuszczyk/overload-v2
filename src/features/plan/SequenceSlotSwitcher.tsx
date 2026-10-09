// Chunk 25 review fix — sequence runs' own Plan "weeks" switcher. Visually
// identical chip-row pattern to WorkoutSwitcher.tsx (same flex row, same
// chip padding/radius/colours, same two-line label), generalised from
// DayOfWeek (a closed, calendar-shaped union a cycle slot cannot be a
// member of) to a cycle SLOT: (sequence item id, 0-based position, the
// workout it names or null for a rest day). WorkoutSwitcher.tsx itself is
// untouched — weekday runs keep using it exactly as before (this chunk's
// own renderParity/D30 requirement), so this is a sibling, not a rewrite.
//
// Each chip's label is "<small> SLOT n <big> <workout name>" — the position
// and the workout both shown, per the review ("each workout slot labelled
// with its workout name and position, e.g. 'A · 1'"). A rest slot (review:
// "rest days shown as non-selectable or omitted, your choice, say which")
// is shown, not omitted — dimmed and un-clickable, same REST DAY wording
// and italic/dim treatment StepExercises.tsx's own SequenceItemRow already
// uses for one, so the cycle's actual shape (including its rest days) is
// visible at a glance here too, never silently hidden.

export interface SwitcherSlot {
  id: string // the v2_program_sequence_items row id — unique even when two slots share a workout
  position: number // 0-based
  workoutDayName: string | null // null = rest day
}

export default function SequenceSlotSwitcher({
  slots,
  selectedId,
  onSelect,
}: {
  slots: SwitcherSlot[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (slots.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Sequence slot switcher"
      className="hide-scrollbar"
      style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: 14 }}
    >
      {slots.map((slot) => {
        const isRest = slot.workoutDayName === null
        const active = slot.id === selectedId
        return (
          <button
            key={slot.id}
            onClick={isRest ? undefined : () => onSelect(slot.id)}
            disabled={isRest}
            aria-disabled={isRest}
            style={{
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
              padding: '8px 12px',
              maxWidth: 130,
              background: active ? 'var(--accent)' : 'var(--surface)',
              border: `1px solid ${active ? 'transparent' : 'var(--border-strong)'}`,
              borderRadius: 10,
              cursor: isRest ? 'default' : 'pointer',
              opacity: isRest ? 0.5 : 1,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '1.5px',
                color: active ? 'var(--base)' : 'var(--text-muted)',
              }}
            >
              SLOT {slot.position + 1}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 12,
                fontStyle: isRest ? 'italic' : 'normal',
                color: active ? 'var(--base)' : (isRest ? 'var(--text-dim)' : 'var(--text-primary)'),
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 110,
              }}
            >
              {slot.workoutDayName ?? 'REST DAY'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
