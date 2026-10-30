import type { CSSProperties, ReactNode } from 'react'
import { useDemo } from '../demo/demoStore'
import { APP_VERSION } from '../data/releaseNotes'

const mono: CSSProperties = { fontFamily: 'var(--font-mono)' }
const OLD_VERSION = '1.2.0'

// A full screen that replaces the whole app, nav included (items 10 and 11).
function GateScreen({ eyebrow, title, children, action }: { eyebrow: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="h-dvh flex flex-col" style={{ background: 'var(--base)', padding: 'calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom))' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14, maxWidth: 420 }}>
        <p style={{ ...mono, margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>{eyebrow}</p>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 32, lineHeight: 1.1, color: 'var(--text-primary)', textWrap: 'balance' }}>{title}</h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 15, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{children}</div>
      </div>
      {action}
    </div>
  )
}

function QueuedLine({ children }: { children: ReactNode }) {
  const queued = useDemo((s) => s.queued)
  if (queued === 0) return null
  return <p style={{ margin: 0, color: 'var(--text-muted)' }}>{children}</p>
}

// Item 10. Every account except yours. Re-checks every minute; opens by itself.
export function MaintenanceScreen() {
  return (
    <GateScreen eyebrow="MAINTENANCE" title="BACK SOON">
      <p style={{ margin: 0 }}>Overload is being updated. It opens again by itself when that's done.</p>
      <QueuedLine>Changes you made offline are kept and sent then.</QueuedLine>
    </GateScreen>
  )
}

// Item 11. The app is older than the release's minimum version.
export function UpdateRequiredScreen() {
  const { updateState, online, set } = useDemo()
  const updating = updateState === 'updating'
  function update() {
    if (!online) return set({ updateState: 'failed' })
    set({ updateState: 'updating' })
    // The prototype's stand-in for the reload: the new version opens and shows its notes once.
    window.setTimeout(() => set({ gate: 'none', updateState: 'ready', afterUpdateSheet: true }), 1400)
  }
  return (
    <GateScreen
      eyebrow="UPDATE"
      title="UPDATE TO CONTINUE"
      action={
        <button
          type="button"
          onClick={update}
          disabled={updating}
          className="w-full rounded-xl text-xs font-bold"
          style={{ minHeight: 52, background: 'var(--accent)', color: 'var(--on-accent)', ...mono, letterSpacing: '0.1em', opacity: updating ? 0.6 : 1 }}
        >
          {updating ? 'UPDATING…' : updateState === 'failed' ? 'TRY AGAIN' : 'UPDATE'}
        </button>
      }
    >
      <p style={{ margin: 0 }}>
        This is {OLD_VERSION}. Overload needs {APP_VERSION} or newer.
      </p>
      <QueuedLine>Unsent changes are kept and sent after the update.</QueuedLine>
      {updateState === 'failed' && (
        <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>Couldn't update. Check your connection and try again.</p>
      )}
    </GateScreen>
  )
}

// Item 10, your account: the app works as usual, with this strip on top so
// maintenance isn't left on by mistake. Styled as the RELOAD banner it replaces.
export function MaintenanceStrip() {
  return (
    <div className="flex items-center px-4" style={{ paddingTop: 'calc(10px + env(safe-area-inset-top))', paddingBottom: 10, background: 'var(--accent-muted)', borderBottom: '1px solid var(--accent)' }}>
      <span className="text-xs font-bold tracking-wide" style={{ color: 'var(--accent)', ...mono }}>
        MAINTENANCE ON · ONLY YOUR ACCOUNT CAN USE THE APP
      </span>
    </div>
  )
}

// Tabs whose screens aren't in this round of the prototype.
export function NotInPrototype() {
  return (
    <div className="px-4 pt-8" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={{ ...mono, margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>NOT IN THE PROTOTYPE YET</p>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>Screens join as their items are settled. Open DEMO for every screen and state.</p>
    </div>
  )
}
