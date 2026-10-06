import { useState, useEffect, Fragment } from 'react'
import { Plus } from 'lucide-react'
import type { WeekPlanSet, SetLog, ProgramExercise, WeightUnit, FormRating } from '../../types'
import SetRow from './SetRow'
import RestTimerInline from './RestTimerInline'
import { useRestTimerStore } from './restTimerStore'
import { canAddStageTo, type SetGroup as Group } from './setGroupLogic'
import { resolveStageKind, type StageKind } from '../../lib/plannerVocabulary.js'
import { resolveStageCarryWeightKg } from './stageCarryLogic'

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
  // Chunk 14 — "as planned" (TASKS.md "Logging"); SetRow.tsx's handleLog/
  // handleSkip resolve this from the row's own plannedSet prop, so it's
  // always correct (null) for a stage row too, with no special-casing
  // needed here (a stage's own planned row, if any, carries no kind of its
  // own either — the DB's own check).
  stageKind: StageKind | null
  // Chunk 15 (SPEC "Warmup sets") — optional, same convention as stageKind
  // above: every caller SetGroup.tsx itself drives (onLogHead/onLogStage,
  // via SetRow's working-row handleLog/handleSkip) never sets this.
  // ExerciseCard.tsx's own warmup block bypasses SetGroup entirely (a
  // warmup is never staged, so it needs none of SetGroup's nesting/ADD
  // STAGE machinery) and calls SetRow directly instead — see
  // useExerciseCardState.ts's handleLogWarmup.
  isWarmup?: boolean
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
  // True for the planned section of a merged (swapped) card, where every row
  // belongs to the ORIGINAL exercise while the card's own identity is the
  // replacement's (ExerciseCard.tsx's swappedFrom prop). Suppresses stage
  // entry specifically: handleLogStage writes exerciseId = the CARD's
  // exercise and parentSetId = THIS head, so a stage added here would attach
  // a replacement-identity row under an original-identity head — an orphan
  // to every consumer that filters by exerciseId before grouping. Display of
  // the head and any real stages it already has is untouched.
  readOnly?: boolean
  // Position/prefill fix (2026-09-03): true when this group's plan slot is
  // known to have had a dropset (a swap replacement seeded from the
  // original exercise's plan shape — ExerciseCard.tsx's swappedFrom prop —
  // or, in principle, any future caller with the same need), so the
  // dropset affordance below reads as expected structure rather than an
  // undiscovered option, even before any stage has actually been logged.
  // Purely a display signal — it never seeds a real stage row, since a
  // stage row needs a real logged head id to attach to (ExerciseCard.tsx's
  // handleLogStage).
  expectStage?: boolean
  onLogHead: (params: LogParams) => void
  onLogStage: (headLog: SetLog, params: LogParams) => void
  onUpdate: (id: string, changes: { weight: number | null; reps: number | null; rir: number | null; formRating: FormRating | null }) => void
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
  readOnly = false,
  expectStage = false,
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

  // Chunk 14 — "the workout screen labels stages by kind" and SPEC's
  // carry-over rule. Resolved once per render from whichever side actually
  // knows the head's kind right now: the logged head once it exists,
  // otherwise this group's own planned head row — same source either way
  // (resolveStageKind's own "null/legacy reads as dropset" rule), so a
  // dropset (explicit or legacy-null) always resolves here exactly as it
  // always has, and D30's fixture (no stageKind anywhere in it) is
  // unaffected. Stage rows never carry their own kind (the DB's own
  // check), so there is no second place this could disagree.
  const stageKind = resolveStageKind((group ? group.head.stageKind : plannedSet?.stageKind) ?? null)
  // Carry-over (SPEC "Staged sets"): only meaningful for the one stage
  // slot that's actually about to be logged next — a dropset's own
  // resolveStageCarryWeightKg always returns null (today's unchanged
  // "starts blank" behaviour), and a row further out than the very next
  // stage has no logged predecessor yet to carry from (chunk 3's locking
  // rule — see stageCarryLogic.ts's own header comment).
  const carryWeightKg = group ? resolveStageCarryWeightKg(stageKind, group) : null

  if (!group) {
    // Planned staged sets render (fix) [P1]: a planned dropset's stage rows
    // show from the start, every one of them, not just after the head is
    // logged behind ADD STAGE — SPEC's own words, "each locked until the
    // stage before it is logged." The head itself is the "stage before"
    // stage 1, so with the head still unlogged every planned stage is
    // locked, no exceptions. Suppressed under readOnly for the same reason
    // the stage-affordance block below is (see that prop's own doc comment
    // on SetGroupProps) — a merged (swapped) card's planned section shows
    // only the original exercise's already-resolved history, never a
    // speculative render of what COULD come next.
    return (
      <div className="space-y-1.5">
        <SetRow
          // Explicit (chunk 3, found while reviewing this exact diff):
          // without it, this SetRow and the logged-head SetRow below share
          // the same position under the same div root — React would reuse
          // this one component instance across the unlogged<->logged
          // boundary (same type, same slot, no key) and carry its typed-but-
          // never-submitted weight/reps into the logged render. Differing
          // from the logged branch's own key (headLog.id) the instant a
          // real log exists forces a fresh instance there, and forces
          // another fresh one here again if that head is later deleted.
          key={plannedSet?.id ?? 'extra'}
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
        {plannedStages.length > 0 && !readOnly && (
          <div className="pl-4 space-y-1.5" style={{ borderLeft: '1px dashed var(--border)' }}>
            {plannedStages.map((stage) => (
              <SetRow
                key={stage.id}
                setNumber={displayNumber}
                programExercise={programExercise}
                plannedSet={stage}
                lastLog={null}
                lastLogsLoading={false}
                currentLog={null}
                isStage
                isLocked
                stageKind={stageKind}
                onLog={() => {}}
                onUpdate={() => {}}
                onDelete={() => {}}
                restElapsed={null}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const { head: headLog, stages } = group

  return (
    <div className="space-y-1.5">
      <SetRow
        // See the unlogged branch's own key comment above — the matching
        // half of that same fix.
        key={headLog.id}
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
              stageKind={stageKind}
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
        {!isDeleting && !readOnly && canAddStageTo(headLog) && (
          <>
            {/* Planned staged sets render (fix) [P1]: a planned dropset's
                next stage is loggable the instant the row before it is
                logged — no ADD STAGE tap needed first. plannedStages[
                stages.length] is this group's own next planned stage, the
                same lookup the input row below already did for the manual
                (ADD STAGE) case; "is there one" now also decides whether
                this row shows automatically. Unplanned (no plannedStages at
                all, or every planned stage already logged) falls straight
                through to addingStage, i.e. exactly today's tap-first
                behaviour, unchanged. */}
            {addingStage || plannedStages.length > stages.length ? (
              <SetRow
                // Explicit, and keyed on WHICH stage this slot currently
                // represents (not just "is this slot occupied") — found
                // for the same reason as the head's own key above: once a
                // planned dropset has more than one remaining stage, this
                // ternary branch stays the SetRow type on every render as
                // stage 1 unlocks, logs, and stage 2 takes its place in
                // the exact same slot. Without a key that changes between
                // those two, React reuses the instance and stage 2 would
                // inherit stage 1's already-typed (and already-logged)
                // weight/reps. `unplanned-${stages.length}` covers the
                // ADD-STAGE/"mark as dropset" case, where there is no
                // plannedStages entry to key on but a fresh row is still
                // wanted each time one is manually added.
                key={plannedStages[stages.length]?.id ?? `unplanned-${stages.length}`}
                setNumber={headLog.setNumber}
                programExercise={programExercise}
                plannedSet={plannedStages[stages.length] ?? null}
                lastLog={null}
                lastLogsLoading={false}
                currentLog={null}
                isStage
                stageKind={stageKind}
                carryWeightKg={carryWeightKg}
                onLog={(params) => {
                  onLogStage(headLog, params)
                  setAddingStage(false)
                }}
                onUpdate={() => {}}
                onDelete={() => {}}
                restElapsed={restElapsed}
              />
            ) : stages.length === 0 && !expectStage ? (
              // No stages yet, and nothing says one is expected — most logged
              // sets are never dropsets, so a bold ADD STAGE affordance under
              // every single one clutters the common case (post-launch fix,
              // 2026-08-10). This low-emphasis entry point reveals the exact
              // same stage-entry row ADD STAGE always has; once a real stage
              // exists below, or expectStage says one is already anticipated,
              // the normal ADD STAGE affordance (below) takes over.
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
            )}

            {/* Every planned stage beyond the one unlocked just above —
                visible with its planned value from the start (the same fix),
                locked until its own turn. plannedStages.length > stages.length
                is false (slice past the array's end, i.e. []) for every
                unplanned case, so this renders nothing there, same as
                today. */}
            {plannedStages.slice(stages.length + 1).map((stage) => (
              <SetRow
                key={stage.id}
                setNumber={headLog.setNumber}
                programExercise={programExercise}
                plannedSet={stage}
                lastLog={null}
                lastLogsLoading={false}
                currentLog={null}
                isStage
                isLocked
                stageKind={stageKind}
                onLog={() => {}}
                onUpdate={() => {}}
                onDelete={() => {}}
                restElapsed={null}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
