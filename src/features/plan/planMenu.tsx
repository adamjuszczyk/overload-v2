import { Ellipsis } from 'lucide-react'

// ─── Row menu (⋯) ─────────────────────────────────────────────────────────────
// Adam's standing UI rule (CONTEXT.md, 2026-10-10): a plan row shows only
// what's used on every visit; everything else lives behind a ⋯ on the row or
// exercise it belongs to. The panel opens inline under its row (the exercise
// card clips overflow, so a floating popover would be cut off at 375px).
//
// Moved here from PlanPage.tsx in chunk 30, unchanged, so the STRUCTURE view's
// new pieces (StructureFields.tsx) and the warmup routine's rows
// (planner/designFieldEditors.tsx) draw the very same ⋯ and menu panel.
export function MenuButton({ open, onClick, ariaLabel }: { open: boolean; onClick: () => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={open}
      style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: open ? 'var(--accent-muted)' : 'transparent', border: 'none', borderRadius: 7, color: open ? 'var(--accent)' : 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}
    >
      <Ellipsis size={15} />
    </button>
  )
}

export const MENU_PANEL_STYLE: React.CSSProperties = {
  margin: '2px 16px 8px',
  padding: '8px 10px',
  background: 'var(--surface-overlay)',
  border: '1px solid var(--border-strong)',
  borderRadius: 9,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

export function MenuAction({
  onClick,
  disabled = false,
  ariaLabel,
  danger = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  ariaLabel?: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, padding: 0, background: 'transparent', border: 'none', cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: danger ? 'var(--error)' : disabled ? 'var(--text-dim)' : 'var(--text-secondary)', opacity: disabled ? 0.5 : 1, textAlign: 'left' }}
    >
      {children}
    </button>
  )
}
