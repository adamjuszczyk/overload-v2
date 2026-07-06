import { useState, useEffect } from 'react'
import type { ProgramExercise, WorkoutDay, WeekPlan, WeekPlanSet, SetLog } from '../../types'
import { useActiveSession, useLogSet, useLastSessionLogs } from './useSession'
import { useProgramExercises } from '../programs/usePrograms'
import { useAuth } from '../auth/useAuth'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { db } from '../../lib/db'
import { primeOfflineCache } from '../offline/offlineCache'
import ExerciseCard from './ExerciseCard'
import RestTimer from './RestTimer'
import SessionComplete from './SessionComplete'

interface GymSessionProps {
  sessionId: string
  workoutDay: WorkoutDay
  weekPlan: WeekPlan | null
  weekNumber: number
}

// Wrapper that loads per-exercise history and renders ExerciseCard.
// Must be its own component so useLastSessionLogs can be called unconditionally.
function ExerciseSection({
  programExercise,
  plannedSets,
  allCurrentLogs,
  sessionId,
  onLog,
}: {
  programExercise: ProgramExercise
  plannedSets: WeekPlanSet[]
  allCurrentLogs: SetLog[]
  sessionId: string
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
  }) => void
}) {
  const { data: lastLogs = [] } = useLastSessionLogs(programExercise.exerciseId, sessionId)
  const currentLogs = allCurrentLogs.filter((l) => l.exerciseId === programExercise.exerciseId)

  return (
    <ExerciseCard
      programExercise={programExercise}
      plannedSets={plannedSets}
      currentLogs={currentLogs}
      lastLogs={lastLogs}
      onLog={onLog}
    />
  )
}

export default function GymSession({ sessionId, workoutDay, weekPlan, weekNumber }: GymSessionProps) {
  const [showComplete, setShowComplete] = useState(false)
  const [cachedExercises, setCachedExercises] = useState<ProgramExercise[]>([])

  const { user } = useAuth()
  const isOnline = useOnlineStatus()

  const { data: session } = useActiveSession(sessionId)
  const { data: programExercises = [] } = useProgramExercises(workoutDay.id)
  const logSet = useLogSet(sessionId)

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
              onLog={(params) => logSet.mutate({ ...params, note: null, parentSetId: null })}
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
