import type { CSSProperties, ReactNode } from 'react'
import { useQueuedWriteCount } from './useQueuedWriteCount'

// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]; the prototype's "Maintenance": Screen, Offline changes waiting, Your account). The release
// state's screens, lifted from `prototype/src/screens/gates.tsx` for look, layout and wording only: what the prototype reads from its demo store (how
// many writes the phone holds) is `useQueuedWriteCount` here, and whether a screen or the strip shows at all is `App.tsx`'s, from `useGate`. Tokens
// only. `UpdateRequiredScreen` is chunk 73's and uses `GateScreen` as this chunk's screen does.
//
// This file loads no sign-in page: `App.tsx` decides what a signed-out visitor sees, so the sign-in page is not one of the files these rebuilt
// screens load (`textOnAccent.static.test.ts`).
const mono: CSSProperties = { fontFamily: 'var(--font-mono)' }

/** A full screen that replaces the whole app, navigation included. */
export function GateScreen({ eyebrow, title, children, action }: { eyebrow: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      className="h-dvh flex flex-col"
      style={{
        background: 'var(--base)',
        paddingTop: 'calc(24px + env(safe-area-inset-top))',
        paddingRight: 24,
        paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
        paddingLeft: 24,
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14, maxWidth: 420 }}>
        <p style={{ ...mono, margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>{eyebrow}</p>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            fontSize: 32,
            lineHeight: 1.1,
            color: 'var(--text-primary)',
            textWrap: 'balance',
          }}
        >
          {title}
        </h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 15, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{children}</div>
      </div>
      {action}
    </div>
  )
}

/** A line the screen adds only while the phone holds unsent changes (the sync queue is not empty). */
export function QueuedLine({ children }: { children: ReactNode }) {
  const queued = useQueuedWriteCount()
  if (queued === 0) return null
  return <p style={{ margin: 0, color: 'var(--text-muted)' }}>{children}</p>
}

/**
 * Every account except the exempt ones, while maintenance is on. It re-checks every minute and opens the app by itself when maintenance is off
 * (`useAppStatus`). `onSignIn` is given only when nobody is signed in: the screen then covers the sign-in page, and an exempt account has to be
 * able to reach it (SPEC: "signing in still works"; DECISIONS 270).
 */
export function MaintenanceScreen({ onSignIn }: { onSignIn?: () => void }) {
  return (
    <GateScreen
      eyebrow="MAINTENANCE"
      title="BACK SOON"
      action={
        onSignIn && (
          <button
            type="button"
            onClick={onSignIn}
            className="rounded-xl text-xs font-bold"
            style={{
              alignSelf: 'flex-start',
              minHeight: 44,
              paddingLeft: 18,
              paddingRight: 18,
              background: 'var(--surface-raised)',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: 'var(--border-strong)',
              color: 'var(--text-primary)',
              ...mono,
              letterSpacing: '0.1em',
            }}
          >
            SIGN IN
          </button>
        )
      }
    >
      <p style={{ margin: 0 }}>Overload is being updated. It opens again by itself when that's done.</p>
      <QueuedLine>Changes you made offline are kept and sent then.</QueuedLine>
    </GateScreen>
  )
}

/**
 * An exempt account while maintenance is on: the app works as usual, with this strip on top so maintenance isn't left on by mistake. Styled as the
 * RELOAD banner it stands in for (`PwaUpdateNotice`), but in the shell's own column, above the screen, so it takes its height from it instead of
 * covering the top of every screen for as long as maintenance lasts.
 */
export function MaintenanceStrip() {
  return (
    <div
      role="status"
      className="flex items-center px-4"
      style={{
        paddingTop: 'calc(10px + env(safe-area-inset-top))',
        paddingBottom: 10,
        background: 'var(--accent-muted)',
        borderBottomWidth: 1,
        borderBottomStyle: 'solid',
        borderBottomColor: 'var(--accent)',
      }}
    >
      <span className="text-xs font-bold tracking-wide" style={{ color: 'var(--accent)', ...mono }}>
        MAINTENANCE ON · ONLY YOUR ACCOUNT CAN USE THE APP
      </span>
    </div>
  )
}
