import { useState, useEffect, Fragment } from 'react'
import { Plus } from 'lucide-react'
import type { WeekPlanSet, SetLog, ProgramExercise, WeightUnit, FormRating } from '../../types'
import SetRow from './SetRow'
import RestTimerInline from './RestTimerInline'
import { useRestTimerStore } from './restTimerStore'
import { canAddStageTo, type SetGroup as Group } from './setGroupLogic'

export interface LogParams {
  weekPlanSetId: string | null
  setNumber: number
  weight: number | null
  reps: number | null
  rir: number | null
  isDropset: boolean
  isSkipped: boolean
  restSeconds: number | null
  setSeconds: number | null
  // What unit the user actually typed the weight in (v3 §2.4) — null means
  // "the resolved default for this program-exercise", never an override.
  enteredUnit: WeightUnit | null
  formRating: FormRating | null
}

interface SetGroupProps {
  displayNumber: number
  programExercise: ProgramExercise  // resolves this exercise's preferred weight unit (v3 §2.4)
  plannedSet: WeekPlanSet | null    // this group's own planned slot (head), if any
  plannedStages: WeekPlanSet[]      // planned stage siblings for this head, ordered by stageIndex
  lastLog: SetLog | null            // previous session's head log at this position — head-only prefill (§2.7 item 2)
  lastLogsLoading: boolean
  group: Group<SetLog> | null       // this session's group — null until the head itself is logged
  // True while this group's head is mid-cascade-delete. ADD STAGE must be
  // unavailable during that window: the guard computes its deletion order
  // once at click time, so a stage added after that snapshot would never be
  // deleted (found via live testing — see ExerciseCard.tsx's
  // handleDeleteHead for the full guard). What happens to that orphaned
  // stage at the DB level changed with migration 010 (Phase 3.8): before
  // 010, ON DELETE SET NULL left it behind as a silently-independent
  // "head" (wrong classification, but visible and recoverable); from 010
  // onward, ON DELETE CASCADE removes it outright when the real head is
  // deleted, since by the time the head's own DELETE runs, the new stage
  // row now references it too — so the same pre-existing race (a stage
  // added to a head after this component last disabled ADD STAGE for it,
  // but before that in-flight insert actually commits) goes from a wrong
  // number to a silently deleted set. This gating still narrows the window
  // but does not close it for an insert that was already in flight before
  // isDeleting became true.
  isDeleting: boolean
  onLogHead: (params: LogParams) => void
  onLogStage: (headLog: SetLog, params: LogParams) => void
  onUpdate: (id: string, changes: { weight: number | null; reps: number | null; rir: number | null; note: string | null; formRating: FormRating | null }) => void
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
  programExercise,
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

  // Which row (head or stage id) the shared rest timer is currently anchored
  // to — used to render RestTimerInline directly under that one row (SPEC
  // §4.3), in addition to the existing floating RestTimer. Reads anchorId
  // only while a rest period is actually running, so a stale anchor from a
  // previous period never lingers once startedAt is cleared.
  const timerAnchorId = useRestTimerStore((s) => (s.startedAt ? s.anchorId : null))

  // If a delete cascade starts on this group while a stage was mid-entry,
  // close that input rather than let it log into a head that's going away.
  useEffect(() => {
    if (isDeleting) setAddingStage(false)
  }, [isDeleting])

  if (!group) {
    return (
      <SetRow
        setNumber={displayNumber}
        programExercise={programExercise}
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
        programExercise={programExercise}
        plannedSet={plannedSet}
        lastLog={null}
        lastLogsLoading={false}
        currentLog={headLog}
        onLog={() => {}}
        onUpdate={(changes) => onUpdate(headLog.id, changes)}
        onDelete={() => onDeleteHead(group)}
        restElapsed={null}
      />
      {timerAnchorId === headLog.id && <RestTimerInline />}

      <div className="pl-4 space-y-1.5" style={{ borderLeft: '1px dashed var(--border)' }}>
        {stages.map((stage) => (
          <Fragment key={stage.id}>
            <SetRow
              setNumber={headLog.setNumber}
              programExercise={programExercise}
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
            {timerAnchorId === stage.id && <RestTimerInline />}
          </Fragment>
        ))}

        {/* Found by adversarial review (2026-08-13/14): this affordance had
            no headLog.isSkipped check at all — the exact gap that let a
            skipped head still receive a stage (real account instance: a
            2026-07-16 session, traced back through this same gap in the
            pre-Phase-3.1 DROP-toggle inference it replaced). A skipped head
            is a dead-end everywhere else (SetRow.tsx renders it as a
            read-only "SKIPPED" row with no further input), so this must be
            one too — not just visually, the tap target itself must not
            exist. Already-logged stages below are untouched by this guard:
            a skipped head can never have pre-existing stages going forward
            (SKIP only fires on an unlogged row, before any stage could have
            been added), but real historical data must still display, not
            vanish. */}
        {!isDeleting && canAddStageTo(headLog) && (
          addingStage ? (
            <SetRow
              setNumber={headLog.setNumber}
              programExercise={programExercise}
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
          ) : stages.length === 0 ? (
            // No stages yet — most logged sets are never dropsets, so a
            // bold ADD STAGE affordance under every single one clutters the
            // common case (post-launch fix, 2026-08-10). This low-emphasis
            // entry point reveals the exact same stage-entry row ADD STAGE
            // always has; once a real stage exists below, the normal ADD
            // STAGE affordance (below) takes over for adding further ones.
            <button
              onClick={() => setAddingStage(true)}
              className="flex items-center text-xs font-medium"
              style={{
                // Same 36px touch target as the ADD STAGE button below (its
                // sibling in this exact slot) — "low-emphasis" is a visual
                // choice (smaller text, no icon), not a smaller tap target
                // than the very control it temporarily replaces.
                minHeight: 36,
                // --text-muted, not --text-dim (found by adversarial
                // review): --text-dim is this codebase's disabled/
                // placeholder-text token (global.css's input::placeholder,
                // every disabled-state colour in PlanPage.tsx/
                // WorkoutDayEditorPage.tsx) — at ~1.7:1 contrast on the
                // default dark theme's near-black surface it read as inert
                // placeholder text, undermining the discoverability this
                // button exists for. --text-muted is what every other
                // low-emphasis-but-active label in this file (ADD STAGE
                // below, CANCEL, SKIP REST OF EXERCISE) already uses.
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
              }}
            >
              mark as dropset
            </button>
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
