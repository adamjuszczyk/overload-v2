import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import type { ProgramExercise, WeekPlanSet, SetLog } from '../../types'
import SetRow from './SetRow'
import ExerciseReference from './ExerciseReference'
import ExerciseHeader from './ExerciseHeader'
import PlanTargetsPanel from './PlanTargetsPanel'
import { useRestTimerStore } from './restTimerStore'

interface ExerciseCardProps {
  programExercise: ProgramExercise
  plannedSets: WeekPlanSet[]
  currentLogs: SetLog[]      // set logs already recorded in the current session
  lastLogs: SetLog[]         // set logs from previous session for this exercise — prefill only
  lastLogsLoading: boolean   // true until the previous-session query resolves
  currentSessionId: string   // for the smart reference component — excludes this session from its lookup
  workoutDayId: string       // this session's program slot — drives LAST WEEK matching
  occurrenceCount: number    // how many times this exercise appears in the active program
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
  }) => void
  onUpdateSet: (id: string, changes: { weight: number | null; reps: number | null; rir: number | null; note: string | null; setNumber?: number }) => void
  onDeleteSet: (id: string) => void
}

export default function ExerciseCard({
  programExercise,
  plannedSets,
  currentLogs,
  lastLogs,
  lastLogsLoading,
  currentSessionId,
  workoutDayId,
  occurrenceCount,
  today,
  onLog,
  onUpdateSet,
  onDeleteSet,
}: ExerciseCardProps) {
  const { startedAt, start: startTimer } = useRestTimerStore()

  const totalLogged = currentLogs.length

  // A logged set either targets a planned slot (weekPlanSetId set) or is an
  // extra, on-demand set (weekPlanSetId null) — identity, not array
  // position, decides which section it belongs to and whether that slot
  // still needs an input row.
  const plannedLogs = currentLogs.filter((l) => l.weekPlanSetId != null)
  const extraLogs = currentLogs
    .filter((l) => l.weekPlanSetId == null)
    .sort((a, b) => a.setNumber - b.setNumber)

  // Number of extra-set input slots to show. Starts at (and never drops
  // below) the number of extra sets already logged, so already-logged extra
  // sets keep rendering after a remount/refresh. Otherwise it only grows
  // when the user taps ADD SET — logging a set never adds another slot.
  const [extraSlotCount, setExtraSlotCount] = useState(extraLogs.length)
  useEffect(() => {
    setExtraSlotCount((n) => Math.max(n, extraLogs.length))
  }, [extraLogs.length])

  const plannedRows = plannedSets.map((ps) => ({
    plannedSet: ps,
    log: plannedLogs.find((l) => l.weekPlanSetId === ps.id) ?? null,
  }))

  const extraRows = Array.from({ length: extraSlotCount }, (_, i) => ({
    log: extraLogs[i] ?? null,
  }))

  function handleLog(
    plannedSet: WeekPlanSet | null,
    params: Parameters<ExerciseCardProps['onLog']>[0],
  ) {
    const restElapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null
    startTimer()
    onLog({
      ...params,
      exerciseId: programExercise.exerciseId,
      weekPlanSetId: plannedSet?.id ?? null,
      setNumber: currentLogs.length + 1,
      restSeconds: restElapsed,
    })
  }

  // Deleting a set leaves a gap in the stored set_number sequence (History /
  // Progress views display that raw value) — shift every later set down by 1.
  function handleDeleteSet(log: SetLog) {
    onDeleteSet(log.id)
    currentLogs
      .filter((l) => l.id !== log.id && l.setNumber > log.setNumber)
      .sort((a, b) => a.setNumber - b.setNumber)
      .forEach((l, i) => {
        onUpdateSet(l.id, {
          weight: l.weight,
          reps: l.reps,
          rir: l.rir,
          note: l.note,
          setNumber: log.setNumber + i,
        })
      })
  }

  // Display numbers run sequentially top-to-bottom (planned section first,
  // then extra) purely for the row badge — the setNumber actually sent on
  // log is computed fresh from currentLogs.length at click time.
  let unloggedSeen = 0
  const plannedDisplay = plannedRows.map((row) => {
    if (row.log) return { ...row, displayNumber: row.log.setNumber }
    const displayNumber = totalLogged + unloggedSeen + 1
    unloggedSeen += 1
    return { ...row, displayNumber }
  })
  const extraDisplay = extraRows.map((row) => {
    if (row.log) return { ...row, displayNumber: row.log.setNumber }
    const displayNumber = totalLogged + unloggedSeen + 1
    unloggedSeen += 1
    return { ...row, displayNumber }
  })

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--border)' }}
    >
      <ExerciseHeader programExercise={programExercise} />

      {/* Two reference panels */}
      <div
        className="grid"
        style={{ gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}
      >
        <PlanTargetsPanel plannedSets={plannedSets} />

        {/* Right: smart last-session reference — LAST WEEK / LAST TIME / FIRST TIME */}
        <div className="px-3 py-2">
          <ExerciseReference
            exerciseId={programExercise.exerciseId}
            currentSessionId={currentSessionId}
            workoutDayId={workoutDayId}
            occurrenceCount={occurrenceCount}
            today={today}
            lastLogs={lastLogs}
            lastLogsLoading={lastLogsLoading}
          />
        </div>
      </div>

      {/* Set rows */}
      <div className="px-3 py-3 space-y-3">
        {/* Planned sets — one row per plan slot, logged or not, in plan order */}
        {plannedDisplay.map(({ plannedSet, log, displayNumber }) =>
          log ? (
            <SetRow
              key={plannedSet.id}
              setNumber={displayNumber}
              plannedSet={plannedSet}
              lastLog={null}
              lastLogsLoading={false}
              currentLog={log}
              onLog={() => {}}
              onUpdate={(changes) => onUpdateSet(log.id, changes)}
              onDelete={() => handleDeleteSet(log)}
              restElapsed={null}
            />
          ) : (
            <SetRow
              key={plannedSet.id}
              setNumber={displayNumber}
              plannedSet={plannedSet}
              lastLog={lastLogs[displayNumber - 1] ?? null}
              lastLogsLoading={lastLogsLoading}
              currentLog={null}
              onLog={(params) => handleLog(plannedSet, { ...params, exerciseId: programExercise.exerciseId })}
              onUpdate={() => {}}
              onDelete={() => {}}
              restElapsed={startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null}
            />
          ),
        )}

        {/* Extra sets — added on demand via ADD SET, shown separately below the plan */}
        {extraDisplay.map(({ log, displayNumber }, i) =>
          log ? (
            <SetRow
              key={log.id}
              setNumber={displayNumber}
              plannedSet={null}
              lastLog={null}
              lastLogsLoading={false}
              currentLog={log}
              onLog={() => {}}
              onUpdate={(changes) => onUpdateSet(log.id, changes)}
              onDelete={() => handleDeleteSet(log)}
              restElapsed={null}
            />
          ) : (
            <SetRow
              key={`extra-${i}`}
              setNumber={displayNumber}
              plannedSet={null}
              lastLog={lastLogs[displayNumber - 1] ?? null}
              lastLogsLoading={lastLogsLoading}
              currentLog={null}
              onLog={(params) => handleLog(null, { ...params, exerciseId: programExercise.exerciseId })}
              onUpdate={() => {}}
              onDelete={() => {}}
              restElapsed={startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null}
            />
          ),
        )}

        {/* Add set button — adds exactly one extra slot on demand */}
        <button
          onClick={() => setExtraSlotCount((n) => n + 1)}
          className="w-full flex items-center justify-center gap-2 rounded-lg text-xs font-bold tracking-widest"
          style={{
            minHeight: 44,
            border: '1px dashed var(--border)',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <Plus size={12} />
          ADD SET
        </button>
      </div>
    </div>
  )
}
