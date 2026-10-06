import { useState } from 'react'
import { Link2 } from 'lucide-react'
import type { ProgramExercise, WeekPlanSet, SetLog, WeightUnit, FormRating } from '../../types'
import type { ReferenceSession } from './sessionService'
import SetGroup, { type LogParams } from './SetGroup'
import ExerciseReference from './ExerciseReference'
import ExerciseHeader from './ExerciseHeader'
import PlanTargetsPanel from './PlanTargetsPanel'
import { useRestTimerStore } from './restTimerStore'
import { useSettingsStore } from '../settings/settingsStore'
import { resolveWeightUnit } from '../../lib/weightUnit'
import {
  groupSetLogs,
  groupWeekPlanSets,
  headsOnly,
  cascadeDeleteOrder,
  nextStageIndex,
  type SetGroup as Group,
} from './setGroupLogic'
import { buildSupersetRounds } from './supersetRounds'

// Chunk 13 (TASKS.md "Supersets" / SPEC.md "Supersets [P1]") — the workout
// screen's superset block: a shared card for 2+ exercises sharing one
// `superset_block_id`, rendered as rounds (round 1 = A1, B1, C1; round 2 =
// A2, B2, C2; …) in the zigzag order supersetRounds.ts computes, so the
// existing "current set" button (first `[data-unlogged-set]` in DOM order,
// useScrollToCurrentSet.ts — unchanged) naturally visits A1 → B1 → A2 → B2
// without any change to that hook. GymSession.tsx is the only caller; a
// session with no supersets never constructs this component at all (every
// `pe.supersetBlockId` is null there), which is what keeps D30 byte-identical.
//
// Built from the SAME existing pieces ExerciseCard.tsx already renders a
// plain exercise with — SetGroup (one head + its stages), ExerciseHeader,
// PlanTargetsPanel, ExerciseReference — per the reviewer's UI rule, not a
// new visual language. What's different here is only the ARRANGEMENT: a
// round groups one cell per member instead of one member owning a whole
// card's worth of rows top to bottom.
//
// Deliberately out of scope for this chunk (SPEC/TASKS are silent on all
// three for a superset specifically, and none is in chunk 13's verification
// list — see the chunk's own report for this call):
//   - "Last session" row PREFILL (the weight/reps inputs auto-filling from
//     last time) — SetGroup/SetRow still take lastLog/lastLogsLoading, so
//     every row below passes null/false, same shape as a card whose
//     previous-session query hasn't resolved. This is NOT the "Last time"
//     SPEC means to stay per exercise — that's the reference PANEL
//     (ExerciseReference, below), which every member keeps in full,
//     fed from the same session-batched `referenceSessions` GymSession.tsx
//     already fetches for every exercise regardless of grouping.
//   - Swap exercise and "skip rest of exercise" (ExerciseCard's own
//     per-card actions) — a card inside a block never offers either here;
//     GymSession.tsx falls a block member back to its normal single-card
//     render instead whenever a session-only swap is active on it (see that
//     file's own grouping comment), so swap is never silently unavailable
//     mid-use, only before one starts.
//   - "ADD SET" (an extra, unplanned set beyond the plan) — a block only
//     ever renders its planned heads; adding one exercise's own extra set
//     would need its own, not-yet-specified place in the round grid.
// Logging (including a planned dropset's ADD STAGE) and deleting an
// already-logged set both work exactly as on a plain card — the one
// correctness bar every verification item in this chunk actually needs.

export interface SupersetMember {
  programExercise: ProgramExercise
  plannedSets: WeekPlanSet[]
  // Already filtered to this exercise's own identity by the caller
  // (GymSession.tsx) — same `allCurrentLogs.filter(l => l.exerciseId === …)`
  // every other card-level caller does before reaching SetGroup.
  currentLogs: SetLog[]
  referenceSessions: ReferenceSession[]
}

interface SupersetBlockProps {
  members: SupersetMember[] // 2+, in block/position order
  referenceLoading: boolean
  referenceMesocycleId: string | null
  referenceIsError: boolean
  referenceIsFromCache: boolean
  onRetryReference: () => void
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
    setSeconds: number | null
    enteredUnit: WeightUnit | null
    parentSetId: string | null
    stageIndex: number
    formRating: FormRating | null
  }) => Promise<SetLog>
  onUpdateSet: (id: string, changes: { weight?: number | null; reps?: number | null; rir?: number | null; setNumber?: number; formRating?: FormRating | null }) => void
  onDeleteSet: (id: string) => Promise<void>
}

// A, B, C, … Z, then #27, #28, … — "any number of exercises" (SPEC) never
// runs out of a label, even though the alphabet does.
function memberLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `#${index + 1}`
}

interface MemberRow {
  plannedSet: WeekPlanSet
  plannedStages: WeekPlanSet[]
  group: Group<SetLog> | null
  displayNumber: number
}

// Per-member row list: this exercise's own planned heads, each paired with
// whatever's already logged for it (or null, still to come) — the same
// "plannedRows"/"plannedDisplay" shape ExerciseCard.tsx computes for a
// plain card, minus the extra/swap-merge machinery this block doesn't offer
// (see the file header). Warmups don't exist yet (chunk 15): a plannedSet
// that ever carries isWarmup is filtered out here, before supersetRounds.ts
// ever sees it, so it is left out of the round grid entirely rather than
// occupying a cell or miscounting a round — TASKS.md "Rounds and zigzag"'s
// own instruction to "leave them out... and say how".
function buildMemberRows(member: SupersetMember): MemberRow[] {
  const logGroups = groupSetLogs(member.currentLogs)
  const totalLoggedHeads = logGroups.length
  const plannedLogGroups = logGroups.filter((g) => g.head.weekPlanSetId != null)
  const plannedHeads = headsOnly(member.plannedSets, (s) => s.parentWeekPlanSetId)
    .filter((s) => !s.isWarmup)
    .sort((a, b) => a.setNumber - b.setNumber)
  const plannedGroups = groupWeekPlanSets(member.plannedSets)

  const rows: MemberRow[] = []
  let unloggedSeen = 0
  for (const ps of plannedHeads) {
    const group = plannedLogGroups.find((g) => g.head.weekPlanSetId === ps.id) ?? null
    let displayNumber: number
    if (group) {
      displayNumber = group.head.setNumber
    } else {
      unloggedSeen += 1
      displayNumber = totalLoggedHeads + unloggedSeen
    }
    rows.push({
      plannedSet: ps,
      plannedStages: plannedGroups.find((g) => g.head.id === ps.id)?.stages ?? [],
      group,
      displayNumber,
    })
  }
  return rows
}

export default function SupersetBlock({
  members,
  referenceLoading,
  referenceMesocycleId,
  referenceIsError,
  referenceIsFromCache,
  onRetryReference,
  today,
  onLog,
  onUpdateSet,
  onDeleteSet,
}: SupersetBlockProps) {
  const { startedAt, start: startTimer } = useRestTimerStore()
  const globalWeightUnit = useSettingsStore((s) => s.weightUnit)

  // Mid-cascade-delete heads, keyed by head id — same guard ExerciseCard.tsx
  // keeps per card, kept here per BLOCK (one state object, not one hook call
  // per member) since every member's heads already carry distinct ids.
  const [deletingHeadIds, setDeletingHeadIds] = useState<Set<string>>(new Set())

  function currentRestElapsed(): number | null {
    return startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null
  }

  async function handleLogHead(member: SupersetMember, row: MemberRow, params: LogParams): Promise<SetLog> {
    const restElapsed = currentRestElapsed()
    startTimer()
    return onLog({
      ...params,
      exerciseId: member.programExercise.exerciseId,
      weekPlanSetId: row.plannedSet.id,
      setNumber: row.displayNumber,
      restSeconds: params.setSeconds != null ? params.restSeconds : restElapsed,
      parentSetId: null,
      stageIndex: 0,
    })
  }

  async function handleLogStage(
    member: SupersetMember,
    headLog: SetLog,
    group: Group<SetLog> | null,
    params: LogParams,
  ): Promise<SetLog> {
    const restElapsed = currentRestElapsed()
    startTimer()
    return onLog({
      ...params,
      exerciseId: member.programExercise.exerciseId,
      setNumber: headLog.setNumber,
      restSeconds: params.setSeconds != null ? params.restSeconds : restElapsed,
      parentSetId: headLog.id,
      stageIndex: group ? nextStageIndex(group, (l) => l.stageIndex) : 1,
    })
  }

  // Same cascade guard as ExerciseCard.handleDeleteHead (stages first,
  // descending, head last), scoped to THIS member's own logs for the
  // renumbering pass — setNumber is per-exercise, and a block's members
  // never share one sequence.
  async function handleDeleteHead(member: SupersetMember, group: Group<SetLog>) {
    if (deletingHeadIds.has(group.head.id)) return
    const order = cascadeDeleteOrder(group, (l) => l.stageIndex)
    setDeletingHeadIds((prev) => new Set(prev).add(group.head.id))
    try {
      for (const row of order) await onDeleteSet(row.id)
    } catch (err) {
      console.error('Failed to delete set group', err)
      return
    } finally {
      setDeletingHeadIds((prev) => {
        const next = new Set(prev)
        next.delete(group.head.id)
        return next
      })
    }
    groupSetLogs(member.currentLogs)
      .filter((g) => g.head.id !== group.head.id && g.head.setNumber > group.head.setNumber)
      .sort((a, b) => a.head.setNumber - b.head.setNumber)
      .forEach((g, i) => onUpdateSet(g.head.id, { setNumber: group.head.setNumber + i }))
  }

  function handleDeleteStage(stageId: string) {
    onDeleteSet(stageId).catch((err) => console.error('Failed to delete stage', err))
  }

  // Rendered round-major below, which — per supersetRounds.ts's own comment
  // on zigzagOrder — already reads as the current-set zigzag order (A1, B1,
  // A2, B2, …) with no further reordering needed here.
  const memberRowLists = members.map(buildMemberRows)
  const rounds = buildSupersetRounds(memberRowLists)

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <div className="px-4 pt-3 pb-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <Link2 size={13} style={{ color: 'var(--accent)' }} />
        <span
          className="text-xs font-bold tracking-widest"
          style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
        >
          SUPERSET · {members.length} EXERCISES
        </span>
      </div>

      {/* Per-exercise identity + reference ("Last time" stays per exercise,
          SPEC) — same ExerciseHeader/PlanTargetsPanel/ExerciseReference
          trio ExerciseCard.tsx renders for a plain card, once per member,
          in block order. */}
      {members.map((member, i) => {
        const showPlanTargets = groupWeekPlanSets(member.plannedSets).length > 0
        return (
          <div key={member.programExercise.id}>
            <div className="px-4 pt-2 flex items-center gap-2">
              <span
                className="flex-shrink-0 flex items-center justify-center font-black"
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 6,
                  background: 'var(--accent-muted)',
                  color: 'var(--accent)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 11,
                }}
              >
                {memberLabel(i)}
              </span>
            </div>
            <ExerciseHeader programExercise={member.programExercise} />
            <div
              className={showPlanTargets ? 'grid' : undefined}
              style={{
                ...(showPlanTargets ? { gridTemplateColumns: '1fr 1fr' } : {}),
                borderBottom: '1px solid var(--border)',
              }}
            >
              {showPlanTargets && <PlanTargetsPanel plannedSets={member.plannedSets} />}
              <div className="px-3 py-2">
                <ExerciseReference
                  today={today}
                  sessions={member.referenceSessions}
                  isLoading={referenceLoading}
                  mesocycleId={referenceMesocycleId}
                  isError={referenceIsError}
                  isFromCache={referenceIsFromCache}
                  onRetry={onRetryReference}
                  weightUnit={resolveWeightUnit(member.programExercise.weightUnit, globalWeightUnit)}
                />
              </div>
            </div>
          </div>
        )
      })}

      {/* Rounds — round 1 = A1, B1, C1; round 2 = A2, B2, C2; … (SPEC). Cells
          render in round-major order, which is already the zigzag order the
          current-set button needs (supersetRounds.ts's own comment) — no
          extra reordering here. */}
      <div className="px-3 py-3 space-y-4">
        {rounds.map((round) => (
          <div key={`round-${round.roundNumber}`}>
            <p
              className="text-xs font-bold tracking-widest mb-2"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              ROUND {round.roundNumber}
            </p>
            <div className="space-y-3">
              {round.cells.map((cell) => {
                const member = members[cell.memberIndex]
                const row = cell.head
                return (
                  <div key={`${member.programExercise.id}-${row.plannedSet.id}`}>
                    <p
                      className="text-xs font-bold tracking-wide mb-1"
                      style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
                    >
                      {memberLabel(cell.memberIndex)} · {(member.programExercise.exercise?.name ?? '—').toUpperCase()}
                    </p>
                    <SetGroup
                      displayNumber={row.displayNumber}
                      programExercise={member.programExercise}
                      plannedSet={row.plannedSet}
                      plannedStages={row.plannedStages}
                      lastLog={null}
                      lastLogsLoading={false}
                      group={row.group}
                      isDeleting={row.group != null && deletingHeadIds.has(row.group.head.id)}
                      expectStage={row.plannedStages.length > (row.group?.stages.length ?? 0)}
                      onLogHead={(params) => handleLogHead(member, row, params)}
                      onLogStage={(headLog, params) => handleLogStage(member, headLog, row.group, params)}
                      onUpdate={(id, changes) => onUpdateSet(id, changes)}
                      onDeleteHead={(group) => handleDeleteHead(member, group)}
                      onDeleteStage={handleDeleteStage}
                      restElapsed={currentRestElapsed()}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
