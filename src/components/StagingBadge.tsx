import { IS_STAGING } from '../lib/appEnv'

// The STAGING badge (CONTEXT.md, "Staging"): on every screen of a staging
// build, login included, so the staging app can't be mistaken for the real
// one. Fixed at the top centre and transparent to taps, so it never covers a
// control. Renders nothing in the real app.
export default function StagingBadge({ show = IS_STAGING }: { show?: boolean }) {
  if (!show) return null
  return (
    <div
      role="status"
      aria-label="Staging app"
      className="fixed left-1/2 z-50 -translate-x-1/2 rounded-full px-2 text-[10px] font-bold tracking-widest"
      style={{
        top: 'calc(2px + env(safe-area-inset-top))',
        pointerEvents: 'none',
        backgroundColor: 'var(--staging)',
        color: 'var(--staging-text)',
        fontFamily: 'var(--font-mono)',
        lineHeight: '16px',
      }}
    >
      STAGING
    </div>
  )
}
