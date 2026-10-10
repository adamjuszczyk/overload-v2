import { X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { DAYS_ORDER, datesForWeekOf, movableDatesForWeekOf } from './moveSession'
import type { DayOfWeek } from '../../types'

// Chunk 24 (SPEC "Weekday" — "Move this session to another day, this week
// only") — the shared day-chip picker, same bottom-sheet pattern as
// MissedSessionPrompt.tsx (reviewer's own UI rule: "the sheet pattern from
// MissedSessionPrompt, chip rows for picking a day"). Used by both
// TodayPage.tsx (today's own card) and PlanPage.tsx's MoveSessionControl —
// purely presentational: the caller owns the mutation and closes this on
// success, same division of labour as WorkoutSwitcher.tsx (plan feature)
// being presentational while PlanPage owns the selection state.

const DOW_SHORT: Record<DayOfWeek, string> = {
  monday: 'MON', tuesday: 'TUE', wednesday: 'WED', thursday: 'THU',
  friday: 'FRI', saturday: 'SAT', sunday: 'SUN',
}

interface MoveSessionSheetProps {
  workoutDayName: string
  // The session's own ORIGINAL `date` column — anchors "this week" (the
  // house formula) and is always one of the 7 pickable days; never changes
  // across repeated moves.
  originalDate: string
  // Where it effectively is right now (moved_to_date ?? originalDate) —
  // excluded as a pickable target (you're already there).
  currentDate: string
  // Real "today" — days before it are never offered (B2): a session can only
  // be moved to today or a later day of its week.
  today: string
  isPending: boolean
  onPick: (targetDate: string) => void
  onClose: () => void
}

export default function MoveSessionSheet({
  workoutDayName,
  originalDate,
  currentDate,
  today,
  isPending,
  onPick,
  onClose,
}: MoveSessionSheetProps) {
  // All 7 dates give each weekday its index into DAYS_ORDER; only the ones
  // from today on are rendered.
  const days = datesForWeekOf(originalDate)
  const movable = new Set(movableDatesForWeekOf(originalDate, today))

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full rounded-t-2xl px-4 pt-4 pb-10"
        style={{ backgroundColor: 'var(--base)', maxHeight: '70dvh', overflowY: 'auto' }}
      >
        <div
          className="mx-auto mb-4 rounded-full"
          style={{ width: 36, height: 4, backgroundColor: 'var(--border-strong)' }}
        />

        <div className="flex items-start justify-between gap-3 mb-1">
          <p
            className="text-xs font-bold tracking-widest"
            style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
          >
            MOVE THIS SESSION
          </p>
          <button
            onClick={onClose}
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: 'var(--surface-overlay)',
              color: 'var(--text-secondary)',
            }}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
        <h2
          className="text-xl font-black tracking-tight mb-1"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {workoutDayName}
        </h2>
        <p
          className="mb-4 text-xs"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          PICK TODAY OR A LATER DAY THIS WEEK
        </p>

        {movable.size === 0 && (
          <p
            className="text-xs"
            style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
          >
            NO DAYS LEFT THIS WEEK
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {DAYS_ORDER.map((dow, i) => {
            const date = days[i]
            if (!movable.has(date)) return null
            const isCurrent = date === currentDate
            const isOriginal = date === originalDate && !isCurrent
            return (
              <button
                key={dow}
                disabled={isPending || isCurrent}
                onClick={() => onPick(date)}
                className="rounded-xl px-3 py-2.5 text-left"
                style={{
                  minWidth: 72,
                  backgroundColor: isCurrent ? 'var(--surface-raised)' : 'var(--surface)',
                  border: `1px solid ${isCurrent ? 'var(--border)' : 'var(--border-strong)'}`,
                  opacity: isPending && !isCurrent ? 0.6 : 1,
                  cursor: isCurrent ? 'default' : 'pointer',
                }}
              >
                <p
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '1px',
                    color: isCurrent ? 'var(--text-dim)' : 'var(--text-muted)',
                  }}
                >
                  {DOW_SHORT[dow]}
                </p>
                <p
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    fontSize: 14,
                    color: isCurrent ? 'var(--text-dim)' : 'var(--text-primary)',
                  }}
                >
                  {format(parseISO(date), 'd')}
                </p>
                {isCurrent && (
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-dim)' }}>HERE NOW</p>
                )}
                {isOriginal && (
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--accent)' }}>MOVE BACK</p>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
