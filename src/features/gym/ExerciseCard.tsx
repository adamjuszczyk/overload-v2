import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { ProgramExercise, WeekPlanSet, SetLog } from '../../types'
import SetRow from './SetRow'
import { useRestTimerStore } from './restTimerStore'

interface ExerciseCardProps {
  programExercise: ProgramExercise
  plannedSets: WeekPlanSet[]
  currentLogs: SetLog[]      // set logs already recorded in the current session
  lastLogs: SetLog[]         // set logs from previous session for this exercise
  lastLogsLoading: boolean   // true until the previous-session query resolves
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
  onLog,
  onUpdateSet,
  onDeleteSet,
}: ExerciseCardProps) {
  const [extraSets, setExtraSets] = useState(0)
  const { startedAt, start: startTimer } = useRestTimerStore()

  const ex = programExercise.exercise
  const loggedCount = currentLogs.length
  const plannedCount = plannedSets.length

  // Sets that are already logged
  const loggedRows = currentLogs

  // Remaining planned sets beyond what's been logged
  const remainingPlanned = plannedSets.slice(loggedCount)

  // Extra unplanned rows added by + ADD SET
  const extraRows = Array.from({ length: extraSets })

  const totalLogged = currentLogs.length

  function handleLog(
    relativeIndex: number,
    plannedSet: WeekPlanSet | null,
    params: Parameters<ExerciseCardProps['onLog']>[0],
  ) {
    const restElapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null
    startTimer()
    onLog({
      ...params,
      exerciseId: programExercise.exerciseId,
      weekPlanSetId: plannedSet?.id ?? null,
      setNumber: totalLogged + relativeIndex + 1,
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

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--border)' }}
    >
      {/* Exercise header */}
      <div
        className="px-4 pt-3 pb-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-baseline gap-2">
          <span
            className="font-black text-base"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
          >
            {ex?.name ?? '—'}
          </span>
          {programExercise.targetReps && (
            <span
              className="text-xs"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {programExercise.targetReps} REPS
            </span>
          )}
        </div>
        <span
          className="text-xs font-bold tracking-widest"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {ex?.muscleGroup?.toUpperCase()}
        </span>
      </div>

      {/* Two reference panels */}
      <div
        className="grid"
        style={{ gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}
      >
        {/* Left: This week's plan */}
        <div
          className="px-3 py-2"
          style={{ borderRight: '1px solid var(--border)' }}
        >
          <p
            className="text-xs font-bold tracking-widest mb-1"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            THIS WEEK
          </p>
          {plannedCount === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              NO PLAN
            </p>
          ) : (
            <div className="space-y-0.5">
              {plannedSets.map((ps) => (
                <div key={ps.id} className="flex items-center gap-1">
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 16 }}
                  >
                    {ps.setNumber}
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                  >
                    {ps.targetRir != null ? `RIR ${ps.targetRir}` : '—'}
                  </span>
                  {ps.isDropset && (
                    <span
                      className="text-xs px-1 rounded"
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)', fontSize: 9 }}
                    >
                      D
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Last session */}
        <div className="px-3 py-2">
          <p
            className="text-xs font-bold tracking-widest mb-1"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            LAST SESSION
          </p>
          {lastLogs.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              FIRST TIME
            </p>
          ) : (
            <div className="space-y-0.5">
              {lastLogs.map((log) => (
                <div key={log.id} className="flex items-center gap-1">
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 16 }}
                  >
                    {log.setNumber}
                  </span>
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                  >
                    {log.weight}×{log.reps}
                  </span>
                  {log.rir != null && (
                    <span
                      className="text-xs"
                      style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                    >
                      @{log.rir}
                    </span>
                  )}
                  {log.isDropset && (
                    <span
                      className="text-xs px-1 rounded"
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)', fontSize: 9 }}
                    >
                      D
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Set rows */}
      <div className="px-3 py-3 space-y-3">
        {/* Already logged sets */}
        {loggedRows.map((log, i) => (
          <SetRow
            key={log.id}
            setNumber={i + 1}
            plannedSet={plannedSets[i] ?? null}
            lastLog={lastLogs[i] ?? null}
            lastLogsLoading={false}
            currentLog={log}
            onLog={() => {}}
            onUpdate={(changes) => onUpdateSet(log.id, changes)}
            onDelete={() => handleDeleteSet(log)}
            restElapsed={null}
          />
        ))}

        {/* Remaining planned sets (input mode) */}
        {remainingPlanned.map((ps, i) => (
          <SetRow
            key={ps.id}
            setNumber={loggedCount + i + 1}
            plannedSet={ps}
            lastLog={lastLogs[loggedCount + i] ?? null}
            lastLogsLoading={lastLogsLoading}
            currentLog={null}
            onLog={(params) => handleLog(i, ps, { ...params, exerciseId: programExercise.exerciseId })}
            onUpdate={() => {}}
            onDelete={() => {}}
            restElapsed={startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null}
          />
        ))}

        {/* Extra unplanned sets */}
        {extraRows.map((_, i) => (
          <SetRow
            key={`extra-${i}`}
            setNumber={Math.max(plannedCount, loggedCount) + i + 1}
            plannedSet={null}
            lastLog={lastLogs[Math.max(plannedCount, loggedCount) + i] ?? null}
            lastLogsLoading={lastLogsLoading}
            currentLog={null}
            onLog={(params) =>
              handleLog(
                remainingPlanned.length + i,
                null,
                { ...params, exerciseId: programExercise.exerciseId },
              )
            }
            onUpdate={() => {}}
            onDelete={() => {}}
            restElapsed={startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null}
          />
        ))}

        {/* Add set button */}
        <button
          onClick={() => setExtraSets((n) => n + 1)}
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
