import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// The frame every 1.2 sheet shares (TASKS-1.2 chunk 38). Boards 2-8, W7, W10, W11, W13, W16,
// PL2-PL6, PP2c, PR8 and PR13 all draw this one frame: the scrim, a sheet that rises from the
// bottom with a handle, a small eyebrow line, the title and a close button, the caller's content,
// and an optional footer pinned under it (the primary button the pickers use). What goes inside
// is the caller's; nothing here knows what a sheet is for.
//
// Mount it to open it and unmount it to close it (`{open && <BottomSheet ...>}`), as every sheet
// in this app is used. It only ever asks to close, by calling `onClose`: from the close button,
// from a tap on the scrim and from Escape. Whether it then goes away is the caller's.
//
// What it does for its callers:
// - Drawn through a portal into document.body, so a transformed ancestor can't trap its fixed
//   positioning, a parent's stacking order can't cap it, and sheets stack in the order they were
//   opened. Events from inside a portal still bubble through React's tree to whatever rendered
//   the sheet: mount it outside clickable parents.
// - Focus moves into the sheet when it opens (unless a child already took it, e.g. an autofocused
//   input) and back to what had it when it closes. Tab stays inside the sheet.
// - The page behind does not scroll while a sheet is open: the body's overflow is locked (counted,
//   so stacked sheets are safe), the scrim takes no touch panning, and the content's own scrolling
//   stays inside the sheet.
// - With sheets stacked (board 5's Cues row opens board 8's sheet), Escape and the Tab trap
//   belong to the one drawn on top, and an Escape that something inside already handled
//   (preventDefault) is left alone.
// - role="dialog", aria-modal, named by the title.
//
// Colours are the app's custom properties, none written here. The one exception is the scrim: no
// token exists for it. The boards draw black at 45 % in the light theme and 70 % in the dark one;
// the app draws two values of its own (near-black at 88 % behind the Plan, Programs, planner and
// Library sheets, black at 60 % behind the Today and workout sheets), and SPEC maps a board colour
// that has no token to the nearest existing one (Design boards [1.2]): the 60 %. Provisional under
// D31: a scrim token in tokens.css would change it in this one place.
//
// Layout follows the boards: one frame, a 16 px rhythm between its parts, and content that scrolls
// inside the sheet (the header and the footer stay put) once it outgrows the screen below a 64 px
// gap (where PL4-PL6, the boards' tall sheets, stop). Boards space a sheet's own sections 12, 14, 16 or 18 px
// apart; 16 is board 2's and the most common, and a caller that wants another wraps its sections
// in a container of its own. Style values are written the way jsdom keeps them (longhand borders,
// the safe-area padding after its shorthand) so a captured render still carries them.
//
// Two options for the exercise picker (chunk 41; the 38 review's note for it): `height="tall"` makes
// the sheet fill that whole height instead of sizing to its content, and `toolbar` pins a row (the
// picker's muscle-group chips) between the header and the content, outside the scroll, so it stays in
// view while a long list scrolls. A sheet that gives neither is drawn exactly as before.
export interface BottomSheetProps {
  /** The small mono line above the title (`WEEK 2 · FROM WEEK 1'S PLAN`). Leave it out for none: PR8 and PR13 have no eyebrow. */
  eyebrow?: string
  title: string
  /** Asked for by the close button, a tap on the scrim and Escape. */
  onClose: () => void
  children: ReactNode
  /** Pinned under the content, outside its scroll: the primary button the pickers use. */
  footer?: ReactNode
  /** Pinned between the header and the content, outside the scroll: a row of filter chips that stays in view while the list under it scrolls (PL4-PL6, PP2d, W11, W13). */
  toolbar?: ReactNode
  /**
   * `content` (the default): as tall as the content, up to the screen minus 64 px. `tall`: always that
   * tall, from 64 px below the top of the screen to its bottom edge (PL4-PL6 stand there; W11 and PP2d
   * are tall too), for a list whose length changes with a filter, so the sheet doesn't jump. The content
   * scrolls inside it either way.
   */
  height?: 'content' | 'tall'
}

const SCRIM = 'rgba(0,0,0,0.6)'

// Where the boards' tall sheets stop: 64 px below the top of the screen.
const TALLEST = 'calc(100dvh - 64px)'

// Below the toast and the STAGING badge (z-index 50 in both) so they stay readable over a sheet;
// above the update notice (40) and the workout screen's own floating bar (30). A sheet drawn
// later is drawn above an earlier one (same index, later in document.body).
const LAYER = 45

const ROOT_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: LAYER,
  display: 'flex',
  alignItems: 'flex-end',
}

const SCRIM_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: SCRIM,
  touchAction: 'none',
}

const SHEET_STYLE: CSSProperties = {
  position: 'relative',
  boxSizing: 'border-box',
  width: '100%',
  maxHeight: TALLEST,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  background: 'var(--surface)',
  borderWidth: '1px 1px 0',
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  borderRadius: '20px 20px 0 0',
  padding: '10px 16px 24px',
  paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
  outline: 'none',
}

const HANDLE_STYLE: CSSProperties = {
  flex: '0 0 auto',
  alignSelf: 'center',
  width: 40,
  height: 4,
  borderRadius: 2,
  background: 'var(--border-strong)',
}

const HEADER_STYLE: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
}

const HEADING_BLOCK_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
}

const EYEBROW_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 10,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
}

const TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontWeight: 900,
  fontSize: 20,
  lineHeight: 1.2,
  color: 'var(--text-primary)',
  overflowWrap: 'break-word',
}

const CLOSE_STYLE: CSSProperties = {
  flex: '0 0 auto',
  boxSizing: 'border-box',
  width: 44,
  height: 44,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-strong)',
  borderRadius: 10,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
}

const TOOLBAR_STYLE: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
}

// A grid, not a flex column: a flex item shrinks when the sheet is held to its maximum height,
// and a row with a fixed height would be squeezed instead of scrolled.
const BODY_STYLE: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  alignContent: 'start',
  gap: 16,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
}

const FOOTER_STYLE: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

// ─── Page scroll lock ─────────────────────────────────────────────────────────────────────────

let lockCount = 0
let overflowBeforeLock = ''

/** Stops the page behind from scrolling until the returned release is called; stacked sheets share one lock. */
function lockPageScroll(): () => void {
  if (lockCount === 0) {
    overflowBeforeLock = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    lockCount -= 1
    if (lockCount === 0) document.body.style.overflow = overflowBeforeLock
  }
}

// ─── Stacking and focus ───────────────────────────────────────────────────────────────────────

/** Sheets are drawn in document order, so the last one in the body is the one on top. */
function isTopSheet(root: HTMLElement): boolean {
  const sheets = document.querySelectorAll('[data-bottom-sheet]')
  return sheets[sheets.length - 1] === root
}

const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]'

function tabbableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) =>
      el.tabIndex >= 0 &&
      (el as HTMLButtonElement).disabled !== true &&
      !(el instanceof HTMLInputElement && el.type === 'hidden') &&
      !el.closest('[hidden], [aria-hidden="true"]'),
  )
}

/** Keeps Tab and Shift+Tab inside the sheet: the ends wrap around, and focus that got out is pulled back in. */
function keepTabInside(event: KeyboardEvent, dialog: HTMLElement): void {
  const items = tabbableIn(dialog)
  if (items.length === 0) {
    event.preventDefault()
    dialog.focus({ preventScroll: true })
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (!(active instanceof Node) || !dialog.contains(active)) {
    event.preventDefault()
    const target = event.shiftKey ? last : first
    target.focus({ preventScroll: true })
  } else if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault()
    last.focus({ preventScroll: true })
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus({ preventScroll: true })
  }
}

// ─── The sheet ────────────────────────────────────────────────────────────────────────────────

export default function BottomSheet({ eyebrow, title, onClose, children, footer, toolbar, height = 'content' }: BottomSheetProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // What had focus when the sheet was asked for, read while rendering: a child's autofocus runs
  // before any effect of this component, and by then the opener is no longer the active element.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement))

  // The latest onClose, so the key listener below is attached once and callers can pass a new
  // function every render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => lockPageScroll(), [])

  // Focus into the sheet on open (the sheet itself, so a screen reader reads its name and a stray
  // Enter doesn't press the close button), back to the opener on close.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true })
    return () => {
      const nothingHasFocus = document.activeElement === null || document.activeElement === document.body
      if (opener && opener.isConnected && nothingHasFocus && 'focus' in opener) {
        const target = opener as HTMLElement
        target.focus({ preventScroll: true })
      }
    }
  }, [opener])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const root = rootRef.current
      const dialog = dialogRef.current
      if (!root || !dialog || !isTopSheet(root)) return
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return
        event.preventDefault()
        onCloseRef.current()
      } else if (event.key === 'Tab') {
        keepTabInside(event, dialog)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return createPortal(
    <div ref={rootRef} data-bottom-sheet="" style={ROOT_STYLE}>
      <div aria-hidden="true" data-bottom-sheet-scrim="" onClick={() => onClose()} style={SCRIM_STYLE} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={height === 'tall' ? { ...SHEET_STYLE, height: TALLEST } : SHEET_STYLE}
      >
        <div aria-hidden="true" style={HANDLE_STYLE} />
        <div style={{ ...HEADER_STYLE, alignItems: eyebrow ? 'flex-start' : 'center' }}>
          <div style={HEADING_BLOCK_STYLE}>
            {eyebrow ? <span style={EYEBROW_STYLE}>{eyebrow}</span> : null}
            <h2 id={titleId} style={TITLE_STYLE}>
              {title}
            </h2>
          </div>
          <button type="button" aria-label="Close" onClick={() => onClose()} style={CLOSE_STYLE}>
            <X size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        {toolbar ? <div style={TOOLBAR_STYLE}>{toolbar}</div> : null}
        <div style={BODY_STYLE}>{children}</div>
        {footer ? <div style={FOOTER_STYLE}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
