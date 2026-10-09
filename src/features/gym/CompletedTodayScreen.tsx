import { useState } from 'react'
import type { Session, Mesocycle, WorkoutDay, WeekPlan } from '../../types'
import type { ScheduleType } from './referenceByExercise'
import { useActiveSession, useReopenSession, useSkipSession, useCreateSession, useUpdateSessionNote } from './useSession'
import { usePlanWeek, planWeekThenFindId } from '../plan/useWeekPlan'
import { countCompletedSets } from './countCompletedSets'
import TodayHeader from './TodayHeader'

// Chunk 25 — extracted out of TodayPage.tsx (previously a local, non-
// exported function there, "Extracted so hooks run unconditionally")
// into its own file so SequenceTodayPage.tsx can reuse it for its own
// completed_today state without creating a circular import between
// TodayPage.tsx and SequenceTodayPage.tsx (each would otherwise need to
// import from the other). TodayPage.tsx's own two call sites are
// unaffected — same component, same props, now imported instead of
// locally defined; its own rendered output for a weekday run (scheduleType
// omitted) is unchanged byte-for-byte (D30: weekday behaviour identical).
//
// Loads the full session (with setLogs) to get an accurate set count, and
// offers Continue / Redo actions.
export default function CompletedTodayScreen({
  session: basicSession,
  activeMeso,
  workoutDay,
  weekPlan,
  weekNumber,
  today,
  todayLabel,
  // Chunk 24 — only ever passed from the due_today list's "each opens on
  // its own" view (reviewer's note 2); the common, single-session path
  // (exactly one due today) never passes it, so that render is unchanged.
  onBack,
  // Chunk 25 — optional, defaults to 'weekday': every existing TodayPage.tsx
  // call site keeps rendering "WEEK {weekNumber}" exactly as before;
  // SequenceTodayPage.tsx is the one caller that passes 'sequence'.
  scheduleType = 'weekday',
}: {
  session: Session
  activeMeso: Mesocycle
  workoutDay: WorkoutDay | null
  weekPlan: WeekPlan | null
  weekNumber: number
  today: string
  todayLabel: string
  onBack?: () => void
  scheduleType?: ScheduleType
}) {
  const [confirmAction, setConfirmAction] = useState<'continue' | 'redo' | null>(null)
  const [isEditingNote, setIsEditingNote] = useState(false)
  const [noteInput, setNoteInput] = useState(basicSession.note ?? '')

  // Fetch full session so setLogs are present (fetchSessionsInRange omits them)
  const { data: fullSession } = useActiveSession(basicSession.id)
  const reopenSession = useReopenSession()
  const skipSession = useSkipSession()
  const createSession = useCreateSession()
  const planWeek = usePlanWeek()
  const updateNote = useUpdateSessionNote()

  const { total: totalSets, skipped: skippedSets } = countCompletedSets(fullSession?.setLogs ?? [])
  const isPending =
    reopenSession.isPending || createSession.isPending || skipSession.isPending || planWeek.isPending

  async function handleContinue() {
    await reopenSession.mutateAsync(basicSession.id)
    // Scheduler will transition to active_session automatically via invalidation
  }

  async function handleRedo() {
    if (!workoutDay) return
    // Skip the current completed session, then start a fresh one. Chunk 8
    // — same "plan right before starting" as TodayPage's own handleStart:
    // redoing today's session is still "starting a session" on Today.
    await skipSession.mutateAsync(basicSession.id)
    const weekPlanId = await planWeekThenFindId(
      activeMeso.id,
      weekNumber,
      workoutDay.id,
      weekPlan?.id ?? null,
      planWeek,
      undefined,
      // Chunk 25 (R16) — this slot's own identity, so redoing the SECOND
      // occurrence of a repeated workout in a sequence cycle finds that
      // same slot's own plan, never the first occurrence's. null for a
      // weekday run (weekPlan?.sequencePosition is undefined there),
      // unchanged behaviour.
      weekPlan?.sequencePosition ?? null,
    )
    await createSession.mutateAsync({
      mesoId: activeMeso.id,
      weekPlanId,
      workoutDayId: workoutDay.id,
      date: today,
    })
  }

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
          SESSION COMPLETE · {scheduleType === 'sequence' ? 'CYCLE' : 'WEEK'} {weekNumber}
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
