import { NavLink } from 'react-router-dom'
import { Dumbbell, LayoutList, TrendingUp, Clock, BookOpen, Settings, Sparkles } from 'lucide-react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useInstallPrompt } from '../features/offline/useInstallPrompt'
import { useAuth } from '../features/auth/useAuth'
import { isCoachUser } from '../features/coach/coachGate'

// Chunk 26 (SPEC.md "Navigation and settings" — "The program screen folds
// into the plan screen as its program tab"): PROGRAM is gone from the bar.
// Its former destination (ProgramPage.tsx, now ProgramsPage.tsx) is reached
// from Plan's header instead (PlanPage.tsx). This is phase 1 only — the
// phase-2 bar (Progress/Coach folding into History tabs, SPEC's [P2] bullet
// right below the [P1] one above) is not part of this chunk.
const baseTabs = [
  { to: '/today',    label: 'TODAY',    Icon: Dumbbell     },
  { to: '/plan',     label: 'PLAN',     Icon: LayoutList   },
  { to: '/progress', label: 'PROGRESS', Icon: TrendingUp   },
  { to: '/history',  label: 'HISTORY',  Icon: Clock        },
  { to: '/library',  label: 'LIBRARY',  Icon: BookOpen     },
  { to: '/settings', label: 'SETTINGS', Icon: Settings     },
] as const

const coachTab = { to: '/coach', label: 'COACH', Icon: Sparkles } as const

export default function Nav() {
  const isOnline = useOnlineStatus()
  const { canInstall, install } = useInstallPrompt()
  const { user } = useAuth()
  // Gated: a seventh tab is tight on a narrow phone (TASKS §5.6), so it
  // only renders for the one account it's actually for — no crowding for
  // anyone else. The route still exists unconditionally (see App.tsx).
  const tabs = isCoachUser(user?.id) ? [...baseTabs, coachTab] : baseTabs

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', backgroundColor: 'var(--base)' }}>
      {/* ── Install prompt ────────────────────────────────────────────────── */}
      {canInstall && (
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span
            className="text-xs"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
          >
            ADD TO HOME SCREEN
          </span>
          <button
            onClick={install}
            className="px-3 py-2 rounded-lg text-xs font-bold"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--base)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            INSTALL
          </button>
        </div>
      )}

      {/* ── Offline strip ─────────────────────────────────────────────────── */}
      {!isOnline && (
        <div
          className="flex items-center gap-2 px-4 py-1.5"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: 'var(--text-muted)' }}
          />
          <span
            className="text-xs font-bold tracking-widest"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            OFFLINE · SETS WILL SYNC ON RECONNECT
          </span>
        </div>
      )}

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <nav
        className="flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {tabs.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors"
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent)' : 'var(--text-dim)',
              fontFamily: 'var(--font-mono)',
              fontSize: 8,
              letterSpacing: '1px',
              fontWeight: 700,
            })}
          >
            <Icon size={20} strokeWidth={1.75} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
