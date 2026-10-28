import { useEffect, useId, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { hairline } from '../../components/pickers/pickerControls'

// Chunk 61 (TASKS-1.2 61; board W9; SPEC [1.2] "Delete set (18b)": "with a confirmation (W9)"): "Delete set 03?" over the set's numbers and
// "Only today's session changes; the plan stays the same.", CANCEL and DELETE SET. The board draws it as a card standing in the middle of the
// screen over the scrim, not as a sheet from the bottom, so it is one: `role="alertdialog"`, named by its title.
//
// It writes nothing: `onConfirm` is the delete, which the caller runs; while it runs (`pending`) both buttons are off and the button says
// DELETING…, and a delete that fails leaves the dialog open with the real reason under the text (`error`: SPEC Errors (15)). CANCEL, the scrim
// and Escape ask `onCancel`, none of them while the delete is out (a dialog closed then would hide a failure). Focus goes to CANCEL when it
// opens, the safe answer, and back to what had it when it closes.
//
// Chunk 62 asks 19c's question with it too ("Delete the 2 logged drops?" when a set's new type deletes drops that are logged), with its own button label.
//
// Display choices no board settles, provisional under D31: the pending and failed states, the focus rule.

export interface DeleteSetConfirmProps {
  /** `LAT PULLDOWN · SET 03` (`optionsEyebrow`). */
  eyebrow: string
  /** `Delete set 03?` */
  title: string
  /** `52.5 kg × 8–10. Only today's session changes; the plan stays the same.` */
  body: string
  /** The delete is on its way. */
  pending?: boolean
  /** The confirming button's words (chunk 62 asks 19c's question with it: `DELETE 2 DROPS`); `DELETE SET` by default. */
  confirmLabel?: string
  /** A delete that didn't happen: its headline and the real reason, drawn under the text. */
  error?: { headline: string; reason: string } | null
  onConfirm: () => void
  onCancel: () => void
}

const MONO = 'var(--font-mono)'
const SCRIM = 'rgba(0,0,0,0.6)'

const SCRIM_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 46,
  background: SCRIM,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const CARD_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: 420,
  maxHeight: '100%',
  overflowY: 'auto',
  background: 'var(--surface)',
  ...hairline('var(--border)'),
  borderRadius: 12,
  padding: '18px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}

const BUTTON_BASE: CSSProperties = {
  height: 52,
  boxSizing: 'border-box',
  borderRadius: 10,
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: '0.2em',
}

export default function DeleteSetConfirm({ eyebrow, title, body, pending = false, confirmLabel = 'DELETE SET', error = null, onConfirm, onCancel }: DeleteSetConfirmProps) {
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => before?.focus?.()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || pending) return
      event.preventDefault()
      onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel, pending])

  return createPortal(
    <div
      style={SCRIM_STYLE}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} style={CARD_STYLE}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{eyebrow}</span>
          <span id={titleId} style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 20, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
            {title}
          </span>
        </div>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{body}</span>
        {error !== null && (
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, lineHeight: 1.4, color: 'var(--error)' }}>{error.headline}</p>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{error.reason}</p>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <button
            ref={cancelRef}
            type="button"
            disabled={pending}
            onClick={onCancel}
            style={{ ...BUTTON_BASE, ...hairline('var(--border-strong)'), background: 'var(--surface)', color: 'var(--text-primary)', fontWeight: 600, opacity: pending ? 0.6 : 1, cursor: 'pointer' }}
          >
            CANCEL
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            style={{ ...BUTTON_BASE, borderWidth: 0, background: 'color-mix(in srgb, var(--error) 15%, transparent)', color: 'var(--error)', fontWeight: 700, opacity: pending ? 0.6 : 1, cursor: 'pointer' }}
          >
            {pending ? 'DELETING…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
