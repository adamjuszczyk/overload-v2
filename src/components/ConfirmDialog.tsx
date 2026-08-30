// Shared confirm/cancel modal — first used by the delete-adjacent actions
// EXERCISE-LIBRARY-TASKS.md §8 step 7 adds (individual exercise delete,
// library delete). Deliberately the "different and lighter thing" §6.3
// describes: a single step, no typed-name friction — that heavier
// confirmation belongs to reassignment (§6, step 8) alone. `danger` picks
// red vs the app's normal accent colour for the confirm action, so a truly
// irreversible outcome (hard delete) reads differently from a reversible
// one (move to Lost).
export default function ConfirmDialog({
  title,
  body,
  confirmLabel = 'CONFIRM',
  danger,
  isPending,
  onConfirm,
  onCancel,
}: {
  title: string
  body: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  isPending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,6,7,0.88)',
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        style={{
          background: 'var(--surface-raised)',
          borderRadius: 16,
          padding: 24,
          width: '100%',
          maxWidth: 380,
          border: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 16,
            letterSpacing: '0.5px',
            color: 'var(--text-primary)',
            marginBottom: 12,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 14,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            marginBottom: 24,
          }}
        >
          {body}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1,
              height: 44,
              background: 'transparent',
              border: '1px solid var(--border-strong)',
              borderRadius: 10,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '1px',
              cursor: 'pointer',
            }}
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            style={{
              flex: 1,
              height: 44,
              background: danger ? 'var(--error)' : 'var(--accent)',
              border: 'none',
              borderRadius: 10,
              color: 'var(--base)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '1px',
              cursor: isPending ? 'not-allowed' : 'pointer',
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
