import { addDays, parseISO, format } from 'date-fns'
import { usePrograms } from '../programs/usePrograms'
import { useSessionsInRange } from './useSession'
import type { Mesocycle } from '../../types'

interface RestDayScreenProps {
  activeMeso: Mesocycle
  currentWeek: number
  today: string
}

function MoonGlyph() {
  return (
    <svg viewBox="0 0 100 100" width="56" height="56" aria-hidden="true">
      <mask id="rest-day-crescent">
        <rect width="100" height="100" fill="black" />
        <circle cx="50" cy="50" r="36" fill="white" />
        <circle cx="64" cy="38" r="30" fill="black" />
      </mask>
      <circle cx="50" cy="50" r="36" fill="var(--text-secondary)" mask="url(#rest-day-crescent)" />
    </svg>
  )
}

export default function RestDayScreen({ activeMeso, currentWeek, today }: RestDayScreenProps) {
  const { data: programs = [] } = usePrograms()
  const program = programs.find((p) => p.id === activeMeso.programId)
  const plannedThisWeek = program
    ? Object.values(program.schedule).filter((workoutDayId) => workoutDayId != null).length
    : 0

  const weekStart = format(addDays(parseISO(activeMeso.startDate), (currentWeek - 1) * 7), 'yyyy-MM-dd')
  const { data: weekSessions = [] } = useSessionsInRange(weekStart, today)
  const completedThisWeek = weekSessions.filter((s) => s.status === 'completed').length

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 text-center">
      <MoonGlyph />

      <h1
        className="mt-6 text-4xl font-black tracking-tight"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        REST DAY
      </h1>

      <p
        className="mt-2 text-xs font-bold tracking-widest"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        WEEK {currentWeek} · {activeMeso.name.toUpperCase()}
      </p>

      {plannedThisWeek > 0 && (
        <>
          <div className="mt-8 flex items-center gap-2">
            {Array.from({ length: plannedThisWeek }, (_, i) => (
              <span
                key={i}
                className="rounded-full"
                style={{
                  width: 8,
                  height: 8,
                  backgroundColor: i < completedThisWeek ? 'var(--accent)' : 'var(--border-strong)',
                }}
              />
            ))}
          </div>
          <p
            className="mt-3 text-xs font-bold tracking-widest"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
          >
            {completedThisWeek} OF {plannedThisWeek} SESSIONS DONE THIS WEEK
          </p>
        </>
      )}
    </div>
  )
}
