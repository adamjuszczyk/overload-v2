import { NavLink } from 'react-router-dom'
import { Dumbbell, LayoutList, TrendingUp, Clock, CalendarDays, BookOpen, Settings } from 'lucide-react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useInstallPrompt } from '../features/offline/useInstallPrompt'

const tabs = [
  { to: '/today',    label: 'TODAY',    Icon: Dumbbell     },
  { to: '/plan',     label: 'PLAN',     Icon: LayoutList   },
  { to: '/progress', label: 'PROGRESS', Icon: TrendingUp   },
  { to: '/history',  label: 'HISTORY',  Icon: Clock        },
  { to: '/program',  label: 'PROGRAM',  Icon: CalendarDays },
  { to: '/library',  label: 'LIBRARY',  Icon: BookOpen     },
  { to: '/settings', label: 'SETTINGS', Icon: Settings     },
] as const

export default function Nav() {
  const isOnline = useOnlineStatus()
  const { canInstall, install } = useInstallPrompt()

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
