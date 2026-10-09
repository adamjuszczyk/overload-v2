import { X } from 'lucide-react'
import { format, parseISO, differenceInCalendarWeeks } from 'date-fns'
import type { MissedSession, Mesocycle } from '../../types'
import { useCreateSession, useSkipMissedSession } from './useSession'
import { usePlanWeek, planWeekThenFindId } from '../plan/useWeekPlan'

interface MissedSessionPromptProps {
  queue: MissedSession[]
  activeMeso: Mesocycle
  onDismiss: () => void
  // Chunk 24 (SPEC — "Do it now" becomes a move to today): the session this
  // prompt creates keeps `date` = the missed day and gets `moved_to_date` =
  // today, so History shows the day it was actually done.
  today: string
}

export default function MissedSessionPrompt({ queue, activeMeso, onDismiss, today }: MissedSessionPromptProps) {
  const createSession = useCreateSession()
  const skipMissed = useSkipMissedSession()
  const planWeek = usePlanWeek()

  // Show the most recent missed session first
  const sorted = [...queue].sort((a, b) => b.date.localeCompare(a.date))

  // Chunk 8 (TASKS.md "starting the first session of a new week plans
  // it") — DO IT NOW starts a session for `missed.date`, not today, so the
  // week to plan is THAT date's week, not the current one: the house rule
  // (CONTEXT.md), the same expression every other file in this codebase
  // uses (ProgramPage.tsx, PlanPage.tsx, useScheduler.ts, scheduler.ts,
  // and Coach's own meso/week inputs) — no shared helper exists to import,
  // so this is the identical formula, not a second one.
  async function handleDoItNow(missed: MissedSession) {
    const missedWeekNumber =
      differenceInCalendarWeeks(parseISO(missed.date), parseISO(activeMeso.startDate), { weekStartsOn: 1 }) + 1
    const weekPlanId = await planWeekThenFindId(
      activeMeso.id,
      missedWeekNumber,
      missed.workoutDay.id,
      missed.weekPlan?.id ?? null,
      planWeek,
    )
    await createSession.mutateAsync({
      mesoId: activeMeso.id,
      weekPlanId,
      workoutDayId: missed.workoutDay.id,
      date: missed.date,
      // Chunk 24 — the move half of "Do it now": History shows `today`
      // (moved_to_date), `date` stays the missed day (SPEC).
      movedToDate: today,
    })
  }

  async function handleSkip(missed: MissedSession) {
    await skipMissed.mutateAsync({
      mesoId: activeMeso.id,
      weekPlanId: missed.weekPlan?.id ?? null,
      workoutDayId: missed.workoutDay.id,
      date: missed.date,
      existingSessionId: missed.existingSessionId,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss()
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
            MISSED SESSIONS
          </p>
          <button
            onClick={onDismiss}
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
          className="text-xl font-black tracking-tight mb-4"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {sorted.length} session{sorted.length > 1 ? 's' : ''} to catch up
        </h2>

        <div className="space-y-3">
          {sorted.map((missed) => (
            <div
              key={missed.date}
              className="rounded-xl p-4"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <p
                className="text-xs font-bold tracking-widest mb-0.5"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {format(parseISO(missed.date), 'EEEE, MMM d').toUpperCase()}
              </p>
              <p
                className="font-black text-base mb-3"
                style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
              >
                {missed.workoutDay.name}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => handleDoItNow(missed)}
                  disabled={planWeek.isPending || createSession.isPending || skipMissed.isPending}
                  className="flex-1 py-3 rounded-xl font-black text-sm tracking-wider"
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: 'var(--base)',
                    fontFamily: 'var(--font-mono)',
                    opacity: planWeek.isPending || createSession.isPending ? 0.6 : 1,
                  }}
                >
                  DO IT NOW
                </button>
                <button
                  onClick={() => handleSkip(missed)}
                  disabled={planWeek.isPending || createSession.isPending || skipMissed.isPending}
                  className="flex-1 py-3 rounded-xl font-bold text-sm tracking-wider"
                  style={{
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                    opacity: skipMissed.isPending ? 0.6 : 1,
                  }}
                >
                  MARK SKIPPED
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
