// Workout switcher (TASKS.md §4 item 30 / SPEC §5) — a horizontal chip row
// that picks one scheduled workout day to display, replacing the old
// scroll-through-every-workout layout. Purely presentational: PlanPage owns
// which dow is selected and how the fallback-to-first-day rule works.

import type { DayOfWeek, WorkoutDay } from '../../types'

export interface SwitcherDay {
  dow: DayOfWeek
  workoutDay: WorkoutDay
}

const DOW_SHORT: Record<DayOfWeek, string> = {
  monday: 'MON',
  tuesday: 'TUE',
  wednesday: 'WED',
  thursday: 'THU',
  friday: 'FRI',
  saturday: 'SAT',
  sunday: 'SUN',
}

export default function WorkoutSwitcher({
  days,
  selectedDow,
  onSelect,
}: {
  days: SwitcherDay[]
  selectedDow: DayOfWeek
  onSelect: (dow: DayOfWeek) => void
}) {
  if (days.length === 0) return null

  return (
    <div
      className="hide-scrollbar"
      style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: 14 }}
    >
      {days.map(({ dow, workoutDay }) => {
        const active = dow === selectedDow
        return (
          <button
            key={dow}
            onClick={() => onSelect(dow)}
            style={{
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
              padding: '8px 12px',
              maxWidth: 130,
              background: active ? 'var(--accent)' : 'var(--surface)',
              border: `1px solid ${active ? 'transparent' : 'var(--border-strong)'}`,
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '1.5px',
                color: active ? 'var(--base)' : 'var(--text-muted)',
              }}
            >
              {DOW_SHORT[dow]}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 12,
                color: active ? 'var(--base)' : 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 110,
              }}
            >
              {workoutDay.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}
