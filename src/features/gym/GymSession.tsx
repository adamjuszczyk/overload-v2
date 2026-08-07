import { useState, useEffect } from 'react'
import type { ProgramExercise, WorkoutDay, WeekPlan, WeekPlanSet, SetLog } from '../../types'
import { useActiveSession, useLogSet, useLastSessionLogs, useUpdateSetLog, useDeleteSetLog } from './useSession'
import { useProgramExercises, useExerciseOccurrenceCounts } from '../programs/usePrograms'
import { useAuth } from '../auth/useAuth'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { db } from '../../lib/db'
import { primeOfflineCache } from '../offline/offlineCache'
import ExerciseCard from './ExerciseCard'
import RestTimer from './RestTimer'
import SessionComplete from './SessionComplete'
import { useAutoFinishSession } from './useAutoFinishSession'

interface GymSessionProps {
  sessionId: string
  workoutDay: WorkoutDay
  weekPlan: WeekPlan | null
  weekNumber: number
  today: string
}

// Wrapper that loads per-exercise history and renders ExerciseCard.
// Must be its own component so useLastSessionLogs can be called unconditionally.
function ExerciseSection({
  programExercise,
  plannedSets,
  allCurrentLogs,
  sessionId,
  workoutDayId,
  occurrenceCount,
  today,
  onLog,
  onUpdateSet,
  onDeleteSet,
}: {
  programExercise: ProgramExercise
  plannedSets: WeekPlanSet[]
  allCurrentLogs: SetLog[]
  sessionId: string
  workoutDayId: string
  occurrenceCount: number
  today: string
  onLog: (params: {
    exerciseId: string
    weekPlanSetId: string | null
    setNumber: number
    weight: number | null
    reps: number | null
    rir: number | null
    isDropset: boolean
    isSkipped: boolean
    restSeconds: number | null
    parentSetId: string | null
    stageIndex: number
  }) => void
  onUpdateSet: (id: string, changes: { weight?: number | null; reps?: number | null; rir?: number | null; note?: string | null; setNumber?: number }) => void
  onDeleteSet: (id: string) => Promise<void>
}) {
  const { data: lastLogs = [], isLoading: lastLogsLoading } = useLastSessionLogs(
    programExercise.exerciseId,
    sessionId,
  )
  const currentLogs = allCurrentLogs.filter((l) => l.exerciseId === programExercise.exerciseId)

  return (
    <ExerciseCard
      programExercise={programExercise}
      plannedSets={plannedSets}
      currentLogs={currentLogs}
      lastLogs={lastLogs}
      lastLogsLoading={lastLogsLoading}
      currentSessionId={sessionId}
      workoutDayId={workoutDayId}
      occurrenceCount={occurrenceCount}
      today={today}
      onLog={onLog}
      onUpdateSet={onUpdateSet}
      onDeleteSet={onDeleteSet}
    />
  )
}

export default function GymSession({ sessionId, workoutDay, weekPlan, weekNumber, today }: GymSessionProps) {
  const [showComplete, setShowComplete] = useState(false)
  const [cachedExercises, setCachedExercises] = useState<ProgramExercise[]>([])

  const { user } = useAuth()
  const isOnline = useOnlineStatus()

  const { data: session } = useActiveSession(sessionId)
  const { data: programExercises = [] } = useProgramExercises(workoutDay.id)
  const occurrenceCounts = useExerciseOccurrenceCounts(workoutDay.programId)
  const logSet = useLogSet(sessionId)
  const updateSetLog = useUpdateSetLog(sessionId)
  const deleteSetLog = useDeleteSetLog(sessionId)

  useAutoFinishSession(session, weekPlan)

  // Prime the Dexie cache once exercises are loaded and we're online
  useEffect(() => {
    if (!isOnline || !user || programExercises.length === 0) return
    primeOfflineCache({ userId: user.id, sessionId, workoutDay, weekPlan, programExercises }).catch(
      () => {}, // non-critical — best effort
    )
  }, [isOnline, user?.id, sessionId, workoutDay.id, programExercises.length])

  // When offline and Supabase returns nothing, fall back to Dexie
  useEffect(() => {
    if (isOnline || programExercises.length > 0) return
    db.workout_days.get(workoutDay.id).then((cached) => {
      if (cached?.exercises) setCachedExercises(cached.exercises as ProgramExercise[])
    })
  }, [isOnline, programExercises.length, workoutDay.id])

  const allCurrentLogs = session?.setLogs ?? []
  const activeExercises = programExercises.length > 0 ? programExercises : cachedExercises
  const sortedExercises = [...activeExercises].sort((a, b) => a.position - b.position)

  if (showComplete) {
    return <SessionComplete sessionId={sessionId} onBack={() => setShowComplete(false)} />
  }

  return (
    <div className="pb-24">
      {/* Session header */}
      <div className="px-4 pt-8 pb-4">
        <p
          className="text-xs font-bold tracking-widest mb-1"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {weekPlan?.isDeload ? 'DELOAD · ' : ''}WEEK {weekNumber}
        </p>
        <h1
          className="text-3xl font-black tracking-tight"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {workoutDay.name}
        </h1>
        <p
          className="mt-1 text-xs font-bold tracking-widest"
          style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
        >
          IN PROGRESS
        </p>
      </div>

      {/* Rest timer */}
      <RestTimer />

      {/* Exercise cards */}
      <div className="px-4 space-y-4">
        {sortedExercises.map((pe) => {
          const plannedSets = (weekPlan?.sets ?? [])
            .filter((s) => s.programExerciseId === pe.id)
            .sort((a, b) => a.setNumber - b.setNumber)

          return (
            <ExerciseSection
              key={pe.id}
              programExercise={pe}
              plannedSets={plannedSets}
              allCurrentLogs={allCurrentLogs}
              sessionId={sessionId}
              workoutDayId={workoutDay.id}
              occurrenceCount={occurrenceCounts.get(pe.exerciseId) ?? 1}
              today={today}
              onLog={(params) => {
                // Phase 3.1 retires AUDIT M5's inference heuristic on this
                // write path: ExerciseCard/SetGroup's ADD STAGE tap already
                // knows which head it belongs to and passes parentSetId (and
                // stageIndex) directly — no more guessing from ordering. See
                // CONTEXT.md's "ADD STAGE / inference-heuristic limitation"
                // note for why this was inference-only before this phase.
                // 007's historical backfill keeps using inference — it has
                // no other option for data written before this shipped.
                logSet.mutate({ ...params, note: null })
              }}
              onUpdateSet={(id, changes) => updateSetLog.mutate({ id, changes })}
              onDeleteSet={(id) => deleteSetLog.mutateAsync(id)}
            />
          )
        })}
      </div>

      {/* Finish session */}
      <div className="px-4 mt-6">
        <button
          onClick={() => setShowComplete(true)}
          className="w-full py-4 rounded-xl font-black tracking-widest text-sm"
          style={{
            border: '2px solid var(--border-strong)',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          FINISH SESSION
        </button>
      </div>
    </div>
  )
}
