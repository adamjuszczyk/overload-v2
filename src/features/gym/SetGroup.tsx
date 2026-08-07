import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import type { WeekPlanSet, SetLog } from '../../types'
import SetRow from './SetRow'
import type { SetGroup as Group } from './setGroupLogic'

export interface LogParams {
  weekPlanSetId: string | null
  setNumber: number
  weight: number | null
  reps: number | null
  rir: number | null
  isDropset: boolean
  isSkipped: boolean
  restSeconds: number | null
}

interface SetGroupProps {
  displayNumber: number
  plannedSet: WeekPlanSet | null    // this group's own planned slot (head), if any
  plannedStages: WeekPlanSet[]      // planned stage siblings for this head, ordered by stageIndex
  lastLog: SetLog | null            // previous session's head log at this position — head-only prefill (§2.7 item 2)
  lastLogsLoading: boolean
  group: Group<SetLog> | null       // this session's group — null until the head itself is logged
  // True while this group's head is mid-cascade-delete. ADD STAGE must be
  // unavailable during that window: the guard computes its deletion order
  // once at click time, so a stage added after that snapshot would never be
  // deleted, and once the head goes the DB's ON DELETE SET NULL orphans the
  // new stage into a silently-independent "head" (found via live testing —
  // see ExerciseCard.tsx's handleDeleteHead for the full guard).
  isDeleting: boolean
  onLogHead: (params: LogParams) => void
  onLogStage: (headLog: SetLog, params: LogParams) => void
  onUpdate: (id: string, changes: { weight: number | null; reps: number | null; rir: number | null; note: string | null }) => void
  onDeleteHead: (group: Group<SetLog>) => void
  onDeleteStage: (stageId: string) => void
  restElapsed: number | null
}

// One set: a head row, its ordered stages nested beneath it, and — once the
// head is logged — an ADD STAGE affordance tied directly to that head
// (v3 §2.1 / TASKS.md §4 item 7). The tap that adds a stage already knows
// which head it belongs to, so no inference is needed on this write path
// (see GymSession.tsx's onLog, which now takes parentSetId as given).
export default function SetGroup({
  displayNumber,
  plannedSet,
  plannedStages,
  lastLog,
  lastLogsLoading,
  group,
  isDeleting,
  onLogHead,
  onLogStage,
  onUpdate,
  onDeleteHead,
  onDeleteStage,
  restElapsed,
}: SetGroupProps) {
  const [addingStage, setAddingStage] = useState(false)

  // If a delete cascade starts on this group while a stage was mid-entry,
  // close that input rather than let it log into a head that's going away.
  useEffect(() => {
    if (isDeleting) setAddingStage(false)
  }, [isDeleting])

  if (!group) {
    return (
      <SetRow
        setNumber={displayNumber}
        plannedSet={plannedSet}
        lastLog={lastLog}
        lastLogsLoading={lastLogsLoading}
        currentLog={null}
        onLog={onLogHead}
        onUpdate={() => {}}
        onDelete={() => {}}
        restElapsed={restElapsed}
      />
    )
  }

  const { head: headLog, stages } = group

  return (
    <div className="space-y-1.5">
      <SetRow
        setNumber={displayNumber}
        plannedSet={plannedSet}
        lastLog={null}
        lastLogsLoading={false}
        currentLog={headLog}
        onLog={() => {}}
        onUpdate={(changes) => onUpdate(headLog.id, changes)}
        onDelete={() => onDeleteHead(group)}
        restElapsed={null}
      />

      <div className="pl-4 space-y-1.5" style={{ borderLeft: '1px dashed var(--border)' }}>
        {stages.map((stage) => (
          <SetRow
            key={stage.id}
            setNumber={headLog.setNumber}
            plannedSet={null}
            lastLog={null}
            lastLogsLoading={false}
            currentLog={stage}
            isStage
            onLog={() => {}}
            onUpdate={(changes) => onUpdate(stage.id, changes)}
            onDelete={() => onDeleteStage(stage.id)}
            restElapsed={null}
          />
        ))}

        {!isDeleting && (
          addingStage ? (
            <SetRow
              setNumber={headLog.setNumber}
              plannedSet={plannedStages[stages.length] ?? null}
              lastLog={null}
              lastLogsLoading={false}
              currentLog={null}
              isStage
              onLog={(params) => {
                onLogStage(headLog, params)
                setAddingStage(false)
              }}
              onUpdate={() => {}}
              onDelete={() => {}}
              restElapsed={restElapsed}
            />
          ) : (
            <button
              onClick={() => setAddingStage(true)}
              className="flex items-center gap-1.5 text-xs font-bold tracking-widest"
              style={{
                minHeight: 36,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <Plus size={11} />
              ADD STAGE
            </button>
          )
        )}
      </div>
    </div>
  )
}
