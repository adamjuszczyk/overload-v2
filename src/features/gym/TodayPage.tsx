import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useScheduler } from './useScheduler'
import { useCreateSession, useActiveSession, useReopenSession, useSkipSession, useUpdateSessionNote } from './useSession'
import GymSession from './GymSession'
import SessionPreview from './SessionPreview'
import RestDayScreen from './RestDayScreen'
import MissedSessionPrompt from './MissedSessionPrompt'
import { useToday } from '../../hooks/useToday'
import type { Session, Mesocycle, WorkoutDay, WeekPlan } from '../../types'

export default function TodayPage() {
  const today = useToday()
  const todayLabel = format(parseISO(today), 'EEEE, MMM d').toUpperCase()
  // Dismissing the missed-sessions prompt shouldn't block today's workout —
  // re-run the scheduler as if the missed queue were already handled.
  const [dismissMissed, setDismissMissed] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const scheduler = useScheduler(today, dismissMissed)
  const createSession = useCreateSession()
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
        />
      </>
    )
  }

  // ─── Suggest: workout scheduled today ───────────────────────────────────────

  if (result.type === 'suggest_from_plan' || result.type === 'suggest_no_plan') {
    const workoutDay: WorkoutDay =
      result.type === 'suggest_from_plan'
        ? (workoutDays.find((wd) => wd.id === result.weekPlan.workoutDayId) ??
           { id: '', programId: '', userId: '', name: '—', position: 0, exercises: [] })
        : result.workoutDay

    const weekPlan: WeekPlan | null =
      result.type === 'suggest_from_plan' ? result.weekPlan : null

    async function handleStart() {
      if (!activeMeso) return
      await createSession.mutateAsync({
        mesoId: activeMeso.id,
        weekPlanId: weekPlan?.id ?? null,
        workoutDayId: workoutDay.id,
        date: today,
      })
    }

    if (showPreview) {
      return (
        <SessionPreview
          workoutDay={workoutDay}
          weekPlan={weekPlan}
          weekNumber={currentWeek}
          today={today}
          isStarting={createSession.isPending}
          onBack={() => setShowPreview(false)}
          onStart={handleStart}
        />
      )
    }

    return (
      <div className="px-4 pt-8 pb-6">
        <TodayHeader label={todayLabel} />
        <div
          className="mt-4 rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border)', borderTop: '3px solid var(--accent)' }}
        >
          <div className="px-4 py-4">
            <p
              className="text-xs font-bold tracking-widest mb-1"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {result.type === 'suggest_no_plan' ? 'NO PLAN THIS WEEK · ' : ''}WEEK {currentWeek}
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
                DELOAD WEEK
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
              disabled={createSession.isPending}
              className="w-full py-4 rounded-xl font-black tracking-widest text-sm"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--base)',
                fontFamily: 'var(--font-mono)',
                opacity: createSession.isPending ? 0.6 : 1,
              }}
            >
              {createSession.isPending ? 'STARTING…' : 'START SESSION'}
            </button>
          </div>
        </div>
      </div>
    )
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

  // ─── Rest day ───────────────────────────────────────────────────────────────

  if (result.type === 'rest_day') {
    return <RestDayScreen activeMeso={activeMeso!} currentWeek={currentWeek} today={today} />
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

// ─── CompletedTodayScreen ─────────────────────────────────────────────────────
// Extracted so hooks run unconditionally. Loads the full session (with setLogs)
// to get an accurate set count, and offers Continue / Redo actions.

function CompletedTodayScreen({
  session: basicSession,
  activeMeso,
  workoutDay,
  weekPlan,
  weekNumber,
  today,
  todayLabel,
}: {
  session: Session
  activeMeso: Mesocycle
  workoutDay: WorkoutDay | null
  weekPlan: WeekPlan | null
  weekNumber: number
  today: string
  todayLabel: string
}) {
  const [confirmAction, setConfirmAction] = useState<'continue' | 'redo' | null>(null)
  const [isEditingNote, setIsEditingNote] = useState(false)
  const [noteInput, setNoteInput] = useState(basicSession.note ?? '')

  // Fetch full session so setLogs are present (fetchSessionsInRange omits them)
  const { data: fullSession } = useActiveSession(basicSession.id)
  const reopenSession = useReopenSession()
  const skipSession = useSkipSession()
  const createSession = useCreateSession()
  const updateNote = useUpdateSessionNote()

  const totalSets = fullSession?.setLogs?.filter((l) => !l.isSkipped).length ?? 0
  const skippedSets = fullSession?.setLogs?.filter((l) => l.isSkipped).length ?? 0
  const isPending = reopenSession.isPending || createSession.isPending || skipSession.isPending

  async function handleContinue() {
    await reopenSession.mutateAsync(basicSession.id)
    // Scheduler will transition to active_session automatically via invalidation
  }

  async function handleRedo() {
    if (!workoutDay) return
    // Skip the current completed session, then start a fresh one
    await skipSession.mutateAsync(basicSession.id)
    await createSession.mutateAsync({
      mesoId: activeMeso.id,
      weekPlanId: weekPlan?.id ?? null,
      workoutDayId: workoutDay.id,
      date: today,
    })
  }

  return (
    <div className="px-4 pt-8 pb-6">
      <TodayHeader label={todayLabel} />

      {/* Session summary card */}
      <div
        className="mt-4 rounded-xl p-4"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderTop: '3px solid var(--accent)',
        }}
      >
        <p
          className="text-xs font-bold tracking-widest mb-1"
          style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
        >
          SESSION COMPLETE · WEEK {weekNumber}
        </p>
        <p
          className="font-black text-xl mb-1"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {workoutDay?.name ?? '—'}
        </p>
        <p
          className="text-sm font-bold"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {totalSets} sets logged{skippedSets > 0 ? ` · ${skippedSets} skipped` : ''}
        </p>
        {isEditingNote ? (
          <div className="mt-2">
            <textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              rows={3}
              placeholder="How did it feel?"
              className="w-full px-3 py-2 rounded-xl text-sm resize-none"
              style={{
                backgroundColor: 'var(--surface-raised)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                fontFamily: 'var(--font-sans)',
              }}
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={async () => {
                  await updateNote.mutateAsync({ id: basicSession.id, note: noteInput.trim() || null })
                  setIsEditingNote(false)
                }}
                disabled={updateNote.isPending}
                className="flex-1 py-2 rounded-lg text-xs font-bold tracking-wider"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--base)',
                  fontFamily: 'var(--font-mono)',
                  opacity: updateNote.isPending ? 0.6 : 1,
                }}
              >
                {updateNote.isPending ? 'SAVING…' : 'SAVE'}
              </button>
              <button
                onClick={() => {
                  setNoteInput(basicSession.note ?? '')
                  setIsEditingNote(false)
                }}
                disabled={updateNote.isPending}
                className="flex-1 py-2 rounded-lg text-xs font-bold tracking-wider"
                style={{
                  border: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                CANCEL
              </button>
            </div>
          </div>
        ) : (
          <>
            {basicSession.note && (
              <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {basicSession.note}
              </p>
            )}
            <button
              onClick={() => {
                setNoteInput(basicSession.note ?? '')
                setIsEditingNote(true)
              }}
              className="mt-2 text-xs font-bold tracking-widest"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {basicSession.note ? 'EDIT NOTE' : 'ADD NOTE'}
            </button>
          </>
        )}
      </div>

      {/* Confirmation prompt */}
      {confirmAction && (
        <div
          className="mt-4 rounded-xl p-4"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border-strong)' }}
        >
          <p
            className="text-sm font-bold mb-3"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
          >
            {confirmAction === 'continue'
              ? 'Resume where you left off — all logged sets stay intact.'
              : 'Start fresh — current session is marked skipped and all inputs clear.'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={confirmAction === 'continue' ? handleContinue : handleRedo}
              disabled={isPending}
              className="flex-1 py-3 rounded-xl font-black text-sm tracking-wider"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--base)',
                fontFamily: 'var(--font-mono)',
                opacity: isPending ? 0.6 : 1,
              }}
            >
              {isPending ? 'WORKING…' : 'CONFIRM'}
            </button>
            <button
              onClick={() => setConfirmAction(null)}
              disabled={isPending}
              className="flex-1 py-3 rounded-xl font-bold text-sm tracking-wider"
              style={{
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!confirmAction && (
        <div className="mt-4 space-y-3">
          <button
            onClick={() => setConfirmAction('continue')}
            className="w-full py-4 rounded-xl font-black tracking-widest text-sm"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--base)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            CONTINUE SESSION
          </button>
          <p
            className="text-center text-xs"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            Pick up right where you left off
          </p>

          <button
            onClick={() => setConfirmAction('redo')}
            className="w-full py-3 rounded-xl font-bold text-sm tracking-widest"
            style={{
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            REDO SESSION
          </button>
          <p
            className="text-center text-xs"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            Start fresh — current session is discarded
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function TodayHeader({ label }: { label: string }) {
  return (
    <>
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </p>
      <h1
        className="text-3xl font-black tracking-tight"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        TODAY
      </h1>
    </>
  )
}

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
