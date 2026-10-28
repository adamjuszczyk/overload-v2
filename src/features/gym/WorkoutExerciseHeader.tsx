// Chunk 58b — an exercise card's header on the workout screen (boards W1, W6): the exercise's name and muscle group, the "LAST = LAST WEEK,
// TUE ›" line, and the history icon. The line and the icon both open the last-time sheet (W16); the sheet's panels and the line are one
// `lastTimeView` of the exercise's reference sessions. The card's rows read the same sessions for their LAST line (`lastTimeSet.ts`).
// Chunk 59 (boards W5, W10): the ⋯ beside the history icon opens the exercise's options (`ExerciseOptionsSheet`), whose "Exercise history"
// row opens the same last-time sheet. The muscle line says SWAPPED FROM … or ADDED TODAY where the card is one of those.
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ProgramExercise, WeightUnit } from '../../types'
import type { ReferenceSession } from './sessionService'
import type { ScheduleType } from './referenceByExercise'
import ExerciseHeader from './ExerciseHeader'
import LastTimeSheet from './LastTimeSheet'
import ExerciseOptionsSheet, { type ExerciseOptionsSheetProps } from './ExerciseOptionsSheet'
import { lastTimeView } from './lastTimeView'
import { MUSCLE_GROUP_LABELS } from '../../lib/exerciseTags'

const MONO = 'var(--font-mono)'

/** What the card hands the ⋯ sheet: which rows are offered and what they do (`ExerciseOptionsSheetProps` less what the header supplies). */
export type ExerciseOptions = Omit<ExerciseOptionsSheetProps, 'exerciseName' | 'onHistory' | 'onClose'>

export default function WorkoutExerciseHeader({
  programExercise,
  options,
  swappedFromName,
  addedToday,
  today,
  scheduleType,
  sessions,
  isLoading,
  isError,
  isFromCache,
  onRetry,
  unit,
}: {
  programExercise: ProgramExercise
  /** The exercise ⋯ (chunk 59): what it offers. Left out, the header draws no ⋯. */
  options?: ExerciseOptions
  swappedFromName?: string
  addedToday?: boolean
  today: string
  scheduleType: ScheduleType
  sessions: ReferenceSession[]
  isLoading: boolean
  isError: boolean
  isFromCache: boolean
  onRetry: () => void
  unit: WeightUnit
}) {
  const [open, setOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const group = programExercise.exercise?.muscleGroup
  const view = lastTimeView({ today, scheduleType, sessions, isLoading, isError, isFromCache, unit })
  const failed = view.body.kind === 'failed'

  return (
    <>
      <ExerciseHeader
        programExercise={programExercise}
        onOptionsClick={options === undefined ? undefined : () => setOptionsOpen(true)}
        swappedFromName={swappedFromName}
        addedToday={addedToday}
        muscleLabel={group ? ((MUSCLE_GROUP_LABELS as Record<string, string>)[group] ?? group.replace(/_/g, ' ').toUpperCase()) : undefined}
        onHistoryClick={() => setOpen(true)}
        lastLine={
          failed ? (
            <div data-last-line className="flex items-center gap-2" style={{ minHeight: 36, fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.12em' }}>
              <span style={{ color: 'var(--error)' }}>{view.line}</span>
              <button
                type="button"
                onClick={onRetry}
                style={{
                  height: 32,
                  padding: '0 10px',
                  borderRadius: 8,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: 'var(--border-strong)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-primary)',
                  fontFamily: MONO,
                  fontWeight: 600,
                  fontSize: 10,
                  letterSpacing: '0.15em',
                }}
              >
                RETRY
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-last-line
              onClick={() => setOpen(true)}
              className="flex items-center gap-1 text-left"
              style={{ minHeight: 28, fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.12em', color: 'var(--accent)', overflowWrap: 'anywhere' }}
            >
              {view.line}
              <ChevronRight size={11} className="flex-shrink-0" aria-hidden="true" />
            </button>
          )
        }
      />
      {optionsOpen && options !== undefined && (
        <ExerciseOptionsSheet
          {...options}
          exerciseName={programExercise.exercise?.name ?? '—'}
          onHistory={() => {
            setOptionsOpen(false)
            setOpen(true)
          }}
          onClose={() => setOptionsOpen(false)}
        />
      )}
      {open && (
        <LastTimeSheet
          exerciseId={programExercise.exerciseId}
          exerciseName={programExercise.exercise?.name ?? '—'}
          view={view}
          onRetry={onRetry}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
