import { X } from 'lucide-react'
import { usePwaUpdate } from './usePwaUpdate'

// Fixed to the viewport top, not stacked into Nav.tsx's Install/Offline
// strips: those live in Nav's normal document flow, which grows Nav's
// height and eats into the fixed-bottom clearance GymSession.tsx's
// CURRENT SET button relies on (`bottom: calc(96px + safe-area)`,
// measured live at ~35px of headroom above the tab bar with zero strips
// showing — a same-sized strip here measured 61px tall, which would push
// Nav's top edge up past CURRENT SET's bottom edge and overlap it, exactly
// the mid-workout collision this feature can't cause). A fixed top overlay
// never touches that layout at all.
export default function PwaUpdateNotice() {
  const { updateAvailable, isReloading, reload, dismiss } = usePwaUpdate()

  if (!updateAvailable) return null

  return (
    <div
      className="fixed left-0 right-0 top-0 z-40 flex items-center justify-between gap-2 px-4"
      style={{
        paddingTop: 'calc(10px + env(safe-area-inset-top))',
        paddingBottom: 10,
        backgroundColor: 'var(--accent-muted)',
        borderBottom: '1px solid var(--accent)',
      }}
    >
      <span
        className="text-xs font-bold tracking-wide"
        style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
      >
        UPDATE AVAILABLE
      </span>
      <div className="flex items-center gap-1">
        {/* reload() briefly waits out any in-flight write (e.g. a just-
            tapped LOG SET) before actually navigating away — see
            usePwaUpdate.ts. isReloading covers that wait so the tap
            registers instantly even though the reload itself may lag a
            moment behind it. */}
        <button
          onClick={reload}
          disabled={isReloading}
          className="px-3 rounded-lg text-xs font-bold"
          style={{
            minHeight: 44,
            backgroundColor: 'var(--accent)',
            color: 'var(--base)',
            fontFamily: 'var(--font-mono)',
            opacity: isReloading ? 0.6 : 1,
          }}
        >
          {isReloading ? '…' : 'RELOAD'}
        </button>
        <button
          onClick={dismiss}
          disabled={isReloading}
          aria-label="Dismiss update notice"
          className="flex-none flex items-center justify-center rounded-lg"
          style={{ width: 44, height: 44, color: 'var(--accent)', opacity: isReloading ? 0.6 : 1 }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
