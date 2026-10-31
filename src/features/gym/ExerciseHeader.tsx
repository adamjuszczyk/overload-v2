import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { History, MoreHorizontal } from 'lucide-react'
import type { ProgramExercise } from '../../types'

export default function ExerciseHeader({
  programExercise,
  onOptionsClick,
  swappedFromName,
  addedToday = false,
  muscleLabel,
  lastLine,
  onHistoryClick,
}: {
  programExercise: ProgramExercise
  // Chunk 59 (board W5, W10): the exercise ⋯ — swap for today, skip the rest, add a set, history — which replaces the swap icon this
  // header drew before. Exercise-level, not per-set (SPEC v1.1 "Part C"): this header is the one place on the workout screen that
  // already represents "this whole exercise". Omitted by PreviewExerciseCard.tsx's read-only mirror of this header (swapping only
  // makes sense in a live session), which then draws what it always drew.
  onOptionsClick?: () => void
  // Position/presentation fix (2026-09-03): the original exercise's name, present only when this card is rendering in place of a
  // swapped-out slot (GymSession.tsx). Since chunk 59 it is board W5's "BACK · SWAPPED FROM LAT PULLDOWN" on the muscle line.
  swappedFromName?: string
  // Chunk 59 (board W5): "BACK · ADDED TODAY" on the card of an exercise added in the workout.
  addedToday?: boolean
  // Chunk 59: the muscle group as the boards word it ("REAR DELTS"); left out, the stored name in capitals, as before.
  muscleLabel?: string
  // Chunk 58b (boards W1, W6) — the workout's cards put the "LAST = LAST WEEK, TUE ›" line under the muscle group (`WorkoutExerciseHeader.tsx`).
  lastLine?: ReactNode
  // Chunk 78 (SPEC 1.2.1 [5]): the workout's header passes this, and a header that has it draws no history icon beside the ⋯ any more: the LAST line
  // and ⋯ → HISTORY open the same sheet. Left out, the header is today's: Today's session preview, which passes neither, keeps its icon, which
  // goes to the exercise's history.
  onHistoryClick?: () => void
}) {
  const ex = programExercise.exercise
  const navigate = useNavigate()
  return (
    <div
      className="px-4 pt-3 pb-2 flex items-start justify-between"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <div>
        <div className="flex items-baseline gap-2">
          <span
            className="font-black text-base"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
          >
            {ex?.name ?? '—'}
          </span>
          {/* Chunk 17 (SPEC "Tempo" — "Shown next to the exercise during the
              workout. Not tracked.") — beside the name, same muted style
              already used by the muscle-group line just below (reused
              verbatim, not a new token). A swapped-in or extra exercise
              shows its own slot's tempo (or none, if its slot has none —
              TASKS.md "Would not catch"), since programExercise here is
              always that slot's own object. With no tempo, nothing renders
              at all: no label, no placeholder, no empty element (D30) —
              `&&` skips the span outright for a null/undefined/empty value,
              same as swappedFromName's own guard below. */}
          {programExercise.tempo && (
            <span
              className="text-xs font-bold tracking-widest"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {programExercise.tempo}
            </span>
          )}
        </div>
        <span
          className="text-xs font-bold tracking-widest"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {[muscleLabel ?? ex?.muscleGroup?.toUpperCase(), swappedFromName ? `SWAPPED FROM ${swappedFromName.toUpperCase()}` : addedToday ? 'ADDED TODAY' : undefined]
            .filter((part) => part !== undefined && part !== '')
            .join(' · ')}
        </span>
        {lastLine}
      </div>
      <div className="flex-shrink-0 flex items-center">
        {!onHistoryClick && (
          <button
            onClick={() => navigate(`/exercise/${programExercise.exerciseId}`)}
            aria-label="View exercise history"
            className="flex items-center justify-center"
            style={{ width: onOptionsClick ? 36 : 28, height: onOptionsClick ? 36 : 28, color: 'var(--text-muted)' }}
          >
            <History size={15} />
          </button>
        )}
        {onOptionsClick && (
          <button
            onClick={onOptionsClick}
            aria-label="Exercise options"
            aria-haspopup="dialog"
            className="flex items-center justify-center"
            style={{ width: 36, height: 36, color: 'var(--text-muted)' }}
          >
            <MoreHorizontal size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
