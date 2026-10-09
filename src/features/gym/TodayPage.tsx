import { useState } from 'react'
import { format, parseISO, differenceInCalendarDays } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useScheduler } from './useScheduler'
import {
  useCreateSession,
  useMoveSession,
  useClearMovedSession,
  useStartMovedSession,
} from './useSession'
import { usePlanWeek, planWeekThenFindId } from '../plan/useWeekPlan'
import { resolveMove } from './moveSession'
import GymSession from './GymSession'
import SessionPreview from './SessionPreview'
import RestDayScreen from './RestDayScreen'
import MissedSessionPrompt from './MissedSessionPrompt'
import MoveSessionSheet from './MoveSessionSheet'
import SequenceTodayPage from './SequenceTodayPage'
import CompletedTodayScreen from './CompletedTodayScreen'
import TodayHeader from './TodayHeader'
import { countCompletedSets } from './countCompletedSets'
import { useToday } from '../../hooks/useToday'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import type { WorkoutDay, WeekPlan, DueTodayEntry } from '../../types'

export { countCompletedSets }

export default function TodayPage() {
  const today = useToday()
  const todayLabel = format(parseISO(today), 'EEEE, MMM d').toUpperCase()
  // Dismissing the missed-sessions prompt shouldn't block today's workout —
  // re-run the scheduler as if the missed queue were already handled.
  const [dismissMissed, setDismissMissed] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  // Chunk 24 — "several sessions on one day are listed; each opens on its
  // own" (SPEC): which due-today entry is open, when there's more than one.
  // null = showing the summary list.
  const [selectedEntryIndex, setSelectedEntryIndex] = useState<number | null>(null)
  const [showMoveSheet, setShowMoveSheet] = useState(false)
  const scheduler = useScheduler(today, dismissMissed)
  const createSession = useCreateSession()
  const planWeek = usePlanWeek()
  const moveSession = useMoveSession()
  const clearMovedSession = useClearMovedSession()
  const startMovedSession = useStartMovedSession()
  const isOnline = useOnlineStatus()
  const navigate = useNavigate()

  if (scheduler.isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div
          className="w-6 h-6 rounded-full animate-spin"
          style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
        />
      </div>
    )
  }

  // Chunk 25 (SPEC "Scheduling → Sequence"; reviewer's note 4 — "Today
  // (sequence run): the next workout and when it's due..."). scheduler.program
  // is useScheduler.ts's own additive field (already-fetched programs list,
  // no new query) — reading it here, rather than calling useMesos/usePrograms
  // directly, means this file introduces NO hook useScheduler.ts's own
  // existing mocked-hook test files (TodayPage.deload.test.tsx/TodayPage.
  // moveSession.test.tsx, both of which replace useScheduler wholesale with
  // a canned SchedulerData) don't already account for.
  if (scheduler.activeMeso && (scheduler.program?.scheduleType ?? 'weekday') === 'sequence') {
    return (
      <SequenceTodayPage
        today={today}
        todayLabel={todayLabel}
        activeMeso={scheduler.activeMeso}
        programId={scheduler.program!.id}
      />
    )
  }

  const { result, activeMeso, workoutDays, currentWeekPlans, allWeekPlans, currentWeek } = scheduler

  if (!result) return null

  // ─── Active session ─────────────────────────────────────────────────────────

  if (result.type === 'active_session') {
    const session = result.session
    const workoutDay = workoutDays.find((wd) => wd.id === session.workoutDayId) ?? null
    const weekPlan =
      currentWeekPlans.find((wp) => wp.workoutDayId === session.workoutDayId) ??
      allWeekPlans.find((wp) => wp.id === session.weekPlanId) ??
      null
    if (!workoutDay) return null
    return (
      <GymSession
        sessionId={session.id}
        workoutDay={workoutDay}
        weekPlan={weekPlan}
        weekNumber={currentWeek}
        today={today}
      />
    )
  }

  // ─── Missed sessions ────────────────────────────────────────────────────────

  if (result.type === 'missed_sessions') {
    return (
      <>
        <div className="px-4 pt-8 pb-4">
          <TodayHeader label={todayLabel} />
        </div>
        <div className="px-4">
          <RestDayCard label="Catch up on missed sessions before today's workout" />
        </div>
        <MissedSessionPrompt
          queue={result.queue}
          activeMeso={activeMeso!}
          onDismiss={() => setDismissMissed(true)}
          today={today}
        />
      </>
    )
  }

  // ─── Shared: a not-started due-today entry (suggest_from_plan/
  // suggest_no_plan — no row yet — or `planned` — an existing moved-here
  // row) — chunk 24 extends the one pre-existing card with a MOVE THIS
  // SESSION action and, for `planned`, a "MOVED FROM" label and an UPDATE
  // (not insert) start. onBack is only ever passed from the due_today
  // list's "each opens on its own" view (reviewer's note 2) — the common,
  // single-entry path never passes it, so its own render is unchanged
  // beyond the new Move control.

  function renderNotStartedCard(
    entry: Extract<DueTodayEntry, { type: 'suggest_from_plan' | 'suggest_no_plan' | 'planned' }>,
    onBack?: () => void,
  ) {
    const workoutDay: WorkoutDay =
      entry.type === 'suggest_from_plan'
        ? (workoutDays.find((wd) => wd.id === entry.weekPlan.workoutDayId) ??
           { id: '', programId: '', userId: '', name: '—', position: 0, exercises: [] })
        : (entry.type === 'suggest_no_plan' ? entry.workoutDay : entry.workoutDay) ??
          { id: '', programId: '', userId: '', name: '—', position: 0, exercises: [] }

    const weekPlan: WeekPlan | null =
      entry.type === 'suggest_no_plan' ? null : entry.weekPlan

    // The session's own ORIGINAL day (anchors "this week" for the move
    // sheet) — today for the two virtual kinds (scheduler.ts only ever
    // builds them with date: today), the moved row's own `date` for
    // `planned`.
    const originalDate = entry.type === 'planned' ? entry.session.date : entry.date
    const effectiveDate = entry.type === 'planned' ? (entry.session.movedToDate ?? entry.session.date) : originalDate

    const isPlanned = entry.type === 'planned'
    const isStartingSession = isPlanned
      ? startMovedSession.isPending
      : planWeek.isPending || createSession.isPending

    async function handleStart() {
      if (!activeMeso) return
      if (entry.type === 'planned') {
        await startMovedSession.mutateAsync(entry.session.id)
        return
      }
      const weekPlanId = await planWeekThenFindId(
        activeMeso.id,
        currentWeek,
        workoutDay.id,
        weekPlan?.id ?? null,
        planWeek,
      )
      await createSession.mutateAsync({
        mesoId: activeMeso.id,
        weekPlanId,
        workoutDayId: workoutDay.id,
        date: today,
      })
    }

    function handleMovePick(targetDate: string) {
      if (!activeMeso) return
      const decision = resolveMove(originalDate, targetDate)
      // The sheet only ever offers datesForWeekOf(originalDate), so
      // 'invalid_cross_week' can't actually be reached here — handled
      // defensively anyway (a silent no-op) rather than assumed away.
      if (decision.kind === 'invalid_cross_week') return
      if (decision.kind === 'clear') {
        clearMovedSession.mutate({ workoutDayId: workoutDay.id, date: originalDate })
      } else {
        moveSession.mutate({
          mesoId: activeMeso.id,
          weekPlanId: weekPlan?.id ?? null,
          workoutDayId: workoutDay.id,
          date: originalDate,
          targetDate: decision.movedToDate,
        })
      }
      setShowMoveSheet(false)
    }

    if (showPreview) {
      return (
        <SessionPreview
          workoutDay={workoutDay}
          weekPlan={weekPlan}
          weekNumber={currentWeek}
          today={today}
          isStarting={isStartingSession}
          onBack={() => setShowPreview(false)}
          onStart={handleStart}
        />
      )
    }

    const isMovePending = moveSession.isPending || clearMovedSession.isPending

    return (
      <div className="px-4 pt-8 pb-6">
        <TodayHeader label={todayLabel} />
        {onBack && (
          <button
            onClick={onBack}
            className="mt-4 flex items-center gap-1.5"
            style={{ color: 'var(--text-muted)' }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em' }}>
              ← BACK
            </span>
          </button>
        )}
        <div
          className="mt-4 rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border)', borderTop: '3px solid var(--accent)' }}
        >
          <div className="px-4 py-4">
            <p
              className="text-xs font-bold tracking-widest mb-1"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {entry.type === 'suggest_no_plan' ? 'NO PLAN THIS WEEK · ' : ''}
              {isPlanned ? `MOVED FROM ${format(parseISO(originalDate), 'EEE').toUpperCase()} · ` : ''}
              WEEK {currentWeek}
            </p>
            <h2
              className="text-2xl font-black tracking-tight"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
            >
              {workoutDay.name}
            </h2>
            {weekPlan?.isDeload && (
              <p
                className="mt-1 text-xs font-bold tracking-widest"
                style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
              >
                {/* Chunk 21 (SPEC "Deload" — a deload is a property of a
                    SESSION, not a week): was "DELOAD WEEK"; this is one
                    upcoming session's own plan row, same condition as
                    GymSession.tsx/SessionPreview.tsx's own "DELOAD · WEEK N"
                    label, which already read this way. */}
                DELOAD
              </p>
            )}
          </div>
          <div className="px-4 pb-4 space-y-3">
            <button
              onClick={() => setShowPreview(true)}
              className="w-full py-3 rounded-xl font-bold tracking-widest text-sm"
              style={{
                border: '1px solid var(--border-strong)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              PREVIEW SESSION
            </button>
            <button
              onClick={handleStart}
              disabled={isStartingSession}
              className="w-full py-4 rounded-xl font-black tracking-widest text-sm"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--base)',
                fontFamily: 'var(--font-mono)',
                opacity: isStartingSession ? 0.6 : 1,
              }}
            >
              {isStartingSession ? 'STARTING…' : 'START SESSION'}
            </button>
            {/* Chunk 24 (SPEC "Weekday" — "Move this session") — a session
                that hasn't started yet, on Today, can always be moved to
                another day of the same week. A started session never
                reaches this card at all (active_session/completed_today
                render separately, with no move control) — that's this
                chunk's own answer to "say how the UI shows that". */}
            <button
              onClick={() => setShowMoveSheet(true)}
              disabled={!isOnline || isMovePending}
              className="w-full py-3 rounded-xl font-bold tracking-widest text-sm"
              style={{
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                opacity: !isOnline || isMovePending ? 0.5 : 1,
              }}
            >
              MOVE THIS SESSION
            </button>
            {!isOnline && (
              <p
                className="text-center text-xs"
                style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
              >
                REQUIRES A CONNECTION
              </p>
            )}
          </div>
        </div>
        {showMoveSheet && (
          <MoveSessionSheet
            workoutDayName={workoutDay.name}
            originalDate={originalDate}
            currentDate={effectiveDate}
            isPending={isMovePending}
            onPick={handleMovePick}
            onClose={() => setShowMoveSheet(false)}
          />
        )}
      </div>
    )
  }

  if (result.type === 'suggest_from_plan' || result.type === 'suggest_no_plan' || result.type === 'planned') {
    return renderNotStartedCard(result)
  }

  // ─── Completed today ────────────────────────────────────────────────────────

  if (result.type === 'completed_today') {
    const workoutDay = workoutDays.find((wd) => wd.id === result.session.workoutDayId) ?? null
    const weekPlan =
      currentWeekPlans.find((wp) => wp.workoutDayId === result.session.workoutDayId) ??
      allWeekPlans.find((wp) => wp.id === result.session.weekPlanId) ??
      null
    return (
      <CompletedTodayScreen
        session={result.session}
        activeMeso={activeMeso!}
        workoutDay={workoutDay}
        weekPlan={weekPlan}
        weekNumber={currentWeek}
        today={today}
        todayLabel={todayLabel}
      />
    )
  }

  // ─── Several sessions today (chunk 24 — G14: "moving onto a day that
  // already has one leaves both... shown as a list") ─────────────────────

  if (result.type === 'due_today') {
    if (selectedEntryIndex !== null) {
      const entry = result.sessions[selectedEntryIndex]
      const onBack = () => setSelectedEntryIndex(null)
      if (entry.type === 'completed_today') {
        const workoutDay = workoutDays.find((wd) => wd.id === entry.session.workoutDayId) ?? null
        const weekPlan =
          currentWeekPlans.find((wp) => wp.workoutDayId === entry.session.workoutDayId) ??
          allWeekPlans.find((wp) => wp.id === entry.session.weekPlanId) ??
          null
        return (
          <CompletedTodayScreen
            session={entry.session}
            activeMeso={activeMeso!}
            workoutDay={workoutDay}
            weekPlan={weekPlan}
            weekNumber={currentWeek}
            today={today}
            todayLabel={todayLabel}
            onBack={onBack}
          />
        )
      }
      return renderNotStartedCard(entry, onBack)
    }

    return (
      <div className="px-4 pt-8 pb-6">
        <TodayHeader label={todayLabel} />
        <div className="mt-4 space-y-2">
          {result.sessions.map((entry, i) => (
            <DueTodaySummaryRow
              key={i}
              entry={entry}
              workoutDays={workoutDays}
              onSelect={() => setSelectedEntryIndex(i)}
            />
          ))}
        </div>
      </div>
    )
  }

  // ─── Rest day ───────────────────────────────────────────────────────────────
  // Chunk 24 (SPEC "Today / workout screen" — Empty state: "no session
  // today -> the next scheduled session and when it's due").

  if (result.type === 'rest_day') {
    return (
      <>
        <RestDayScreen activeMeso={activeMeso!} currentWeek={currentWeek} today={today} />
        {result.next && (
          <div className="px-4 pb-8 -mt-2">
            <div
              className="rounded-xl p-4 text-center"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <p
                className="text-xs font-bold tracking-widest mb-1"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                NEXT UP
              </p>
              <p
                className="text-sm font-bold"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
              >
                {result.next.workoutDay.name}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {formatDueIn(differenceInCalendarDays(parseISO(result.next.date), parseISO(today)))}
              </p>
            </div>
          </div>
        )}
      </>
    )
  }

  // ─── No meso / no program ───────────────────────────────────────────────────

  return (
    <div className="px-4 pt-8 pb-6">
      <TodayHeader label={todayLabel} />
      <div
        className="mt-6 rounded-xl p-6 text-center"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          {result.type === 'no_program'
            ? 'Create a program to get started'
            : 'Start a mesocycle to begin training'}
        </p>
        <button
          onClick={() => navigate('/program')}
          className="px-6 py-3 rounded-xl font-black text-sm tracking-widest"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)' }}
        >
          GO TO PROGRAM →
        </button>
      </div>
    </div>
  )
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function RestDayCard({ label }: { label: string }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{ border: '1px dashed var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        REST
      </p>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
    </div>
  )
}

// Chunk 24 — the empty state's own "when it's due" (SPEC "Today / workout
// screen" — Empty state bullet).
function formatDueIn(daysAway: number): string {
  if (daysAway <= 0) return 'TODAY'
  if (daysAway === 1) return 'TOMORROW'
  return `IN ${daysAway} DAYS`
}

// One row of the due_today list (G14 — "moving onto a day that already has
// one... shown as a list"). Same bordered-card + status-chip shape as
// HistorySessions.tsx's own session row.
function DueTodaySummaryRow({
  entry,
  workoutDays,
  onSelect,
}: {
  entry: DueTodayEntry
  workoutDays: WorkoutDay[]
  onSelect: () => void
}) {
  const name =
    entry.type === 'completed_today'
      ? workoutDays.find((wd) => wd.id === entry.session.workoutDayId)?.name ?? '—'
      : entry.type === 'suggest_from_plan'
        ? workoutDays.find((wd) => wd.id === entry.weekPlan.workoutDayId)?.name ?? '—'
        : entry.type === 'suggest_no_plan'
          ? entry.workoutDay.name
          : entry.workoutDay?.name ?? '—'

  const isDone = entry.type === 'completed_today'

  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-xl px-4 py-3"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className="text-sm font-bold"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {name}
        </p>
        <span
          className="px-2 py-0.5 rounded text-xs font-bold shrink-0"
          style={{
            backgroundColor: isDone ? 'rgba(74, 222, 128, 0.12)' : 'var(--surface-raised)',
            color: isDone ? 'var(--success)' : 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
          }}
        >
          {isDone ? 'DONE' : 'NOT STARTED'}
        </span>
      </div>
    </button>
  )
}
