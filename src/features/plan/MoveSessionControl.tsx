import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { MENU_NOTE, MENU_ROW } from './SessionMenuSheet'
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
// Scoped to the CURRENTLY SELECTED (one day, one week) slot only;
// "moving onto a day that already has one" (G14)
// is a Today-only list concern — Plan's job here is just "move THIS slot's
// own session elsewhere", never rendering an aggregate due-list of its own.
//
// Chunk 54b (board 10): it is the MOVE THIS SESSION row of the session ⋯'s menu (SessionMenuSheet), mounted only while that menu is open:
// the row with its arrow; dimmed, with "Already started — can't be moved", once the session has started; dimmed, with "Requires a
// connection", offline. Only a weekday run's current week has one (`isCurrentWeek`); a later week and a sequence slot are given none.

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

  // Dimmed, with its reason under it, when the session can't be moved.
  const blocked = hasStarted ? "Already started — can't be moved" : !isOnline ? 'Requires a connection' : null

  return (
    <>
      <button
        type="button"
        onClick={() => setShowSheet(true)}
        disabled={blocked !== null || isMovePending}
        style={{ ...MENU_ROW, color: blocked !== null ? 'var(--text-muted)' : 'var(--text-primary)', opacity: isMovePending ? 0.5 : 1, cursor: blocked !== null ? 'default' : 'pointer' }}
      >
        <span>MOVE THIS SESSION</span>
        {blocked === null && <ArrowRight size={16} aria-hidden="true" />}
      </button>
      {blocked !== null && <p style={MENU_NOTE}>{blocked}</p>}
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
    </>
  )
}
