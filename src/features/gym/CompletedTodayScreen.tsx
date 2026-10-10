import { useState } from 'react'
import type { Session, WorkoutDay } from '../../types'
import type { ScheduleType } from './referenceByExercise'
import { useActiveSession, useReopenSession, useUpdateSessionNote } from './useSession'
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
// offers Continue (reopen) and the note editor.
//
// B1 (2026-10-10, DECISIONS 39): there is deliberately no REDO here any more.
// It skipped the finished session (status -> 'skipped', sets kept) and
// started a fresh one, which left Friday 2026-10-09's PULL 2 as a SKIPPED
// session full of numbers beside an empty in-progress twin. Nothing on this
// screen skips or creates a session.
export default function CompletedTodayScreen({
  session: basicSession,
  workoutDay,
  weekNumber,
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
  workoutDay: WorkoutDay | null
  weekNumber: number
  todayLabel: string
  onBack?: () => void
  scheduleType?: ScheduleType
}) {
  const [confirmContinue, setConfirmContinue] = useState(false)
  const [isEditingNote, setIsEditingNote] = useState(false)
  const [noteInput, setNoteInput] = useState(basicSession.note ?? '')

  // Fetch full session so setLogs are present (fetchSessionsInRange omits them)
  const { data: fullSession } = useActiveSession(basicSession.id)
  const reopenSession = useReopenSession()
  const updateNote = useUpdateSessionNote()

  const { total: totalSets, skipped: skippedSets } = countCompletedSets(fullSession?.setLogs ?? [])
  const isPending = reopenSession.isPending

  async function handleContinue() {
    await reopenSession.mutateAsync(basicSession.id)
    // Scheduler will transition to active_session automatically via invalidation
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
      {confirmContinue && (
        <div
          className="mt-4 rounded-xl p-4"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border-strong)' }}
        >
          <p
            className="text-sm font-bold mb-3"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
          >
            Resume where you left off — all logged sets stay intact.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleContinue}
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
              onClick={() => setConfirmContinue(false)}
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
      {!confirmContinue && (
        <div className="mt-4 space-y-3">
          <button
            onClick={() => setConfirmContinue(true)}
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
        </div>
      )}
    </div>
  )
}
