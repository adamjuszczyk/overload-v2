import { useState } from 'react'
import { useSessionsInRange, useMoveSession, useClearMovedSession } from '../gym/useSession'
import { resolveMove } from '../gym/moveSession'
import MoveSessionSheet from '../gym/MoveSessionSheet'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import type { WorkoutDay, WeekPlan } from '../../types'

// Chunk 24 (SPEC "Weekday" — "'Move this session' on Today and in Plan") —
// self-contained: owns its own session lookup and the two move mutations,
// so PlanPage.tsx itself needs no new hook of its own (its existing render-
// parity/fixture tests, none of which know about sessions at all, stay
// untouched by stubbing this one component — see this chunk's report).
// Scoped to the CURRENTLY SELECTED (one day, one week) slot only, same as
// WorkoutDayPanel itself; "moving onto a day that already has one" (G14)
// is a Today-only list concern — Plan's job here is just "move THIS slot's
// own session elsewhere", never rendering an aggregate due-list of its own.

interface MoveSessionControlProps {
  workoutDay: WorkoutDay
  weekPlan: WeekPlan | undefined
  mesoId: string
  // The real calendar date of the (week, weekday) pair currently selected
  // — resolved by PlanPage.tsx via moveSession.ts's own dateForDow (the
  // house week-number formula's inverse), since Plan, unlike Today, has no
  // "today" of its own to anchor on.
  date: string
  // Real "today" (PlanPage.tsx's useToday) — the sheet offers today and
  // later days only (B2).
  today: string
  // Only the week containing real "today" offers this (reviewer's own
  // scope decision — see this chunk's report: a past week's days are
  // already resolved one way or another, and SPEC says nothing about
  // pre-moving a future week).
  isCurrentWeek: boolean
}

export default function MoveSessionControl({ workoutDay, weekPlan, mesoId, date, today, isCurrentWeek }: MoveSessionControlProps) {
  const [showSheet, setShowSheet] = useState(false)
  const isOnline = useOnlineStatus()
  // A single-day range — reuses the existing hook/query exactly as Today's
  // own scheduler does, no new query shape.
  const { data: sessions } = useSessionsInRange(isCurrentWeek ? date : '', isCurrentWeek ? date : '')
  const moveSession = useMoveSession()
  const clearMovedSession = useClearMovedSession()

  if (!isCurrentWeek) return null

  const existing = (sessions ?? []).find((s) => s.workoutDayId === workoutDay.id && s.date === date)
  const hasStarted = existing?.status === 'in_progress' || existing?.status === 'completed'
  const effectiveDate = existing?.movedToDate ?? date
  const isMovePending = moveSession.isPending || clearMovedSession.isPending

  if (hasStarted) {
    return (
      <p
        className="mb-3 text-xs"
        style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
      >
        ALREADY STARTED — CAN'T BE MOVED
      </p>
    )
  }

  function handlePick(targetDate: string) {
    const decision = resolveMove(date, targetDate, today)
    if (decision.kind === 'invalid_cross_week' || decision.kind === 'invalid_past') return
    if (decision.kind === 'clear') {
      clearMovedSession.mutate({ workoutDayId: workoutDay.id, date })
    } else {
      moveSession.mutate({
        mesoId,
        weekPlanId: weekPlan?.id ?? null,
        workoutDayId: workoutDay.id,
        date,
        targetDate: decision.movedToDate,
      })
    }
    setShowSheet(false)
  }

  return (
    <div className="mb-3">
      <button
        onClick={() => setShowSheet(true)}
        disabled={!isOnline || isMovePending}
        style={{
          height: 26,
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          background: 'var(--surface-overlay)',
          border: '1px solid var(--border-strong)',
          borderRadius: 6,
          cursor: 'pointer',
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '1px',
          opacity: !isOnline || isMovePending ? 0.5 : 1,
        }}
      >
        MOVE THIS SESSION
      </button>
      {!isOnline && (
        <p className="mt-1 text-xs" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          REQUIRES A CONNECTION
        </p>
      )}
      {showSheet && (
        <MoveSessionSheet
          workoutDayName={workoutDay.name}
          originalDate={date}
          currentDate={effectiveDate}
          today={today}
          isPending={isMovePending}
          onPick={handlePick}
          onClose={() => setShowSheet(false)}
        />
      )}
    </div>
  )
}
