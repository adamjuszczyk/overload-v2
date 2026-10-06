import { Plus, Link2 } from 'lucide-react'
import type { ProgramExercise, WeekPlanSet, SetLog } from '../../types'
import type { ReferenceSession } from './sessionService'
import SetGroup from './SetGroup'
import ExerciseReference from './ExerciseReference'
import ExerciseHeader from './ExerciseHeader'
import PlanTargetsPanel from './PlanTargetsPanel'
import SwapExerciseSheet from './SwapExerciseSheet'
import { nextStageIndex, type SetGroup as Group } from './setGroupLogic'
import { useExerciseCardState, type ExerciseCardProps } from './useExerciseCardState'
import { buildSupersetRounds } from './supersetRounds'
import { useLastSessionLogs } from './useSession'

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
// Review fix — grouping only changes layout and order; every member keeps
// the exact per-exercise behaviour ExerciseCard.tsx gives a plain card
// (prefill, logging, dropset stages, delete/renumber, skip-whole-exercise,
// swap, ADD SET), via useExerciseCardState.ts (the same logic ExerciseCard
// itself now calls — extracted once, not reimplemented here). Only the
// ARRANGEMENT differs: a round interleaves one cell per member instead of
// one member owning a whole card's rows top to bottom; each member's own
// header/reference/actions still render in full, once each, same pieces
// (ExerciseHeader, PlanTargetsPanel, ExerciseReference, SwapExerciseSheet)
// ExerciseCard.tsx uses.
//
// One useExerciseCardState call per member, below, at `members[i]`'s own
// index — so that call's internal state (deletingHeadIds, showSwapSheet,
// showSkipConfirm, extraSlotCount, …) is tied to POSITION i, not to which
// exercise currently occupies it. React's own rule (a stable hook-call
// COUNT per component instance across its renders) only guarantees the Nth
// useState call keeps being "the same" one across renders — it says
// nothing about WHICH logical member that position means, so a same-count
// membership change (reordered, or one exercise replaced by another — e.g.
// a regroup from another device reaching this open session through a
// refetch) would otherwise leave position i's open sheet/confirm/counts
// sitting on whichever exercise now renders there. Hardening (reviewer):
// GymSession.tsx's own key on this component is therefore
// `block-${blockId}-${each member's own programExerciseId, joined}`, not
// just the block id and a count — ANY membership change, same count or
// not, changes that string and remounts a fresh SupersetBlock instance
// with fresh state at every position. Membership changes only via a
// reload in the common case anyway (SPEC "Supersets": grouping "applies to
// this run from the next session on"), so this costs nothing day to day;
// it only matters for the edge case above.
//
// Starting a swap on a member hands off to GymSession.tsx's own onSwap
// (recordSwap.mutate, unchanged) exactly like a plain card does; once
// confirmed, GymSession's existing grouping pass (sessionSwaps-aware)
// naturally renders that slot as its own merged card next render — a
// member leaves the block the same way any other mid-session swap already
// worked, nothing new built here for it.

export interface SupersetMember {
  programExercise: ProgramExercise
  plannedSets: WeekPlanSet[]
  // Already filtered to this exercise's own identity by the caller
  // (GymSession.tsx) — same `allCurrentLogs.filter(l => l.exerciseId === …)`
  // every other card-level caller does before reaching ExerciseCard.
  currentLogs: SetLog[]
  referenceSessions: ReferenceSession[]
}

interface SupersetBlockProps {
  members: SupersetMember[] // 2+, in block/position order
  // Each member's own previous-session logs are fetched HERE (one
  // useLastSessionLogs call per member, below) rather than passed in —
  // GymSession.tsx's ExerciseSection does the equivalent for a plain card,
  // one query per exercise; this is the block's own version of that, kept
  // in this file since it already owns the one-hook-call-per-member pattern
  // (see the file header).
  sessionId: string
  referenceLoading: boolean
  referenceMesocycleId: string | null
  referenceIsError: boolean
  referenceIsFromCache: boolean
  onRetryReference: () => void
  today: string
  onLog: ExerciseCardProps['onLog']
  onUpdateSet: ExerciseCardProps['onUpdateSet']
  onDeleteSet: ExerciseCardProps['onDeleteSet']
  onSwap: ExerciseCardProps['onSwap']
}

// A, B, C, … Z, then #27, #28, … — "any number of exercises" (SPEC) never
// runs out of a label, even though the alphabet does.
function memberLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `#${index + 1}`
}

// One member's planned-then-extra rows, normalised to a single shape
// (`plannedSet: null` for an extra/ADD-SET row, matching ExerciseCard's own
// SetGroup usage for that case) so supersetRounds.ts can treat every
// member's list uniformly regardless of which section a row came from.
interface MemberRow {
  plannedSet: WeekPlanSet | null
  plannedStages: WeekPlanSet[]
  group: Group<SetLog> | null
  displayNumber: number
}

export default function SupersetBlock({
  members,
  sessionId,
  referenceLoading,
  referenceMesocycleId,
  referenceIsError,
  referenceIsFromCache,
  onRetryReference,
  today,
  onLog,
  onUpdateSet,
  onDeleteSet,
  onSwap,
}: SupersetBlockProps) {
  // One useLastSessionLogs + one useExerciseCardState call per member — see
  // the file header for why a stable call COUNT (never a stable call
  // ARGUMENT) is all React's own rule actually needs, and how GymSession.tsx
  // guarantees it via this component's key.
  const lastLogsQueries = members.map((m) => useLastSessionLogs(m.programExercise.exerciseId, sessionId))
  const memberStates = members.map((m, i) =>
    useExerciseCardState({
      programExercise: m.programExercise,
      plannedSets: m.plannedSets,
      currentLogs: m.currentLogs,
      lastLogs: lastLogsQueries[i].data ?? [],
      lastLogsLoading: lastLogsQueries[i].isLoading,
      referenceSessions: m.referenceSessions,
      referenceLoading,
      referenceMesocycleId,
      referenceIsError,
      referenceIsFromCache,
      onRetryReference,
      today,
      onLog,
      onUpdateSet,
      onDeleteSet,
      onSwap,
    }),
  )

  // Chunk 15 hasn't built warmup sets yet (TASKS.md "Rounds and zigzag": "if
  // is_warmup rows appear, leave them out of rounds and say how"): a planned
  // row whose set carries isWarmup is dropped here, before supersetRounds.ts
  // ever sees it — left out of the round grid (and so out of this block)
  // entirely, since warmups have no display/authoring path yet and don't
  // belong in a round count. An extra (ADD SET) row is never a warmup (it
  // has no plannedSet at all), so this only ever filters planned rows.
  const memberRowLists: MemberRow[][] = memberStates.map((state) => [
    ...state.plannedDisplay
      .filter((row) => !row.plannedSet.isWarmup)
      .map((row) => ({ plannedSet: row.plannedSet as WeekPlanSet | null, plannedStages: row.plannedStages, group: row.group, displayNumber: row.displayNumber })),
    // Review fix — an extra set added to one member (ADD SET) extends that
    // member's own row list, so it lands in the next round that already
    // exists for the other members, or starts a brand new trailing round if
    // this member is now the longest — supersetRounds.ts's existing
    // unequal-count handling does this with no change of its own.
    ...state.extraDisplay.map((row) => ({ plannedSet: null, plannedStages: [] as WeekPlanSet[], group: row.group, displayNumber: row.displayNumber })),
  ])

  // Rendered round-major below, which — per supersetRounds.ts's own comment
  // on zigzagOrder — already reads as the current-set zigzag order (A1, B1,
  // A2, B2, …) with no further reordering needed here.
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
        const state = memberStates[i]
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
            {/* Always offered (never swappedFrom inside a block — a member
                mid-swap falls back to its own merged single card instead,
                see this file's own header comment), so the swap button is
                unconditional here unlike ExerciseCard's own ternary. */}
            <ExerciseHeader
              programExercise={member.programExercise}
              onSwapClick={() => state.setShowSwapSheet(true)}
            />
            <div
              className={state.showPlanTargets ? 'grid' : undefined}
              style={{
                ...(state.showPlanTargets ? { gridTemplateColumns: '1fr 1fr' } : {}),
                borderBottom: '1px solid var(--border)',
              }}
            >
              {state.showPlanTargets && <PlanTargetsPanel plannedSets={member.plannedSets} />}
              <div className="px-3 py-2">
                <ExerciseReference
                  today={today}
                  sessions={member.referenceSessions}
                  isLoading={referenceLoading}
                  mesocycleId={referenceMesocycleId}
                  isError={referenceIsError}
                  isFromCache={referenceIsFromCache}
                  onRetry={onRetryReference}
                  weightUnit={state.resolvedWeightUnit}
                />
              </div>
            </div>
          </div>
        )
      })}

      {/* Rounds — round 1 = A1, B1, C1; round 2 = A2, B2, C2; … (SPEC). */}
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
                const state = memberStates[cell.memberIndex]
                const row = cell.head
                return (
                  <div key={`${member.programExercise.id}-r${round.roundNumber}`}>
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
                      lastLog={state.lastLogGroups[row.displayNumber - 1]?.head ?? null}
                      lastLogsLoading={lastLogsQueries[cell.memberIndex].isLoading}
                      group={row.group}
                      isDeleting={row.group != null && state.deletingHeadIds.has(row.group.head.id)}
                      expectStage={row.plannedStages.length > (row.group?.stages.length ?? 0)}
                      onLogHead={(params) => state.handleLogHead(row.plannedSet, params)}
                      onLogStage={(headLog, params) =>
                        state.handleLogStage(headLog, row.group ? nextStageIndex(row.group, (l) => l.stageIndex) : 1, params)
                      }
                      onUpdate={(id, changes) => onUpdateSet(id, changes)}
                      onDeleteHead={state.handleDeleteHead}
                      onDeleteStage={state.handleDeleteStage}
                      restElapsed={state.currentRestElapsed()}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Per-member actions — ADD SET and SKIP REST OF EXERCISE, the same
          two ExerciseCard.tsx offers at the bottom of a plain card, once per
          member instead of once per card (a block's rows are interleaved by
          round above, so these exercise-level actions get their own
          section below it rather than living inside any one round). */}
      <div className="px-3 pb-3 space-y-4">
        {members.map((member, i) => {
          const state = memberStates[i]
          return (
            <div key={`actions-${member.programExercise.id}`} className="space-y-2">
              <p
                className="text-xs font-bold tracking-wide"
                style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
              >
                {memberLabel(i)} · {(member.programExercise.exercise?.name ?? '—').toUpperCase()}
              </p>

              <button
                onClick={state.handleAddSet}
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

              {state.hasUnfinishedPlannedWork && (
                state.showSkipConfirm ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => state.setShowSkipConfirm(false)}
                      disabled={state.isSkippingExercise}
                      className="flex-1 py-3 rounded-lg text-xs font-bold tracking-widest"
                      style={{
                        border: '1px solid var(--border)',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      CANCEL
                    </button>
                    <button
                      onClick={state.handleConfirmSkip}
                      disabled={state.isSkippingExercise}
                      className="flex-1 py-3 rounded-lg text-xs font-bold tracking-widest"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)',
                        color: 'var(--error)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      CONFIRM SKIP
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => state.setShowSkipConfirm(true)}
                    disabled={state.isSkippingExercise}
                    className="w-full flex items-center justify-center gap-2 rounded-lg text-xs font-bold tracking-widest"
                    style={{
                      minHeight: 44,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      opacity: state.isSkippingExercise ? 0.6 : 1,
                    }}
                  >
                    {state.isSkippingExercise ? 'SKIPPING…' : 'SKIP REST OF EXERCISE'}
                  </button>
                )
              )}
            </div>
          )
        })}
      </div>

      {members.map((member, i) => {
        const state = memberStates[i]
        if (!state.showSwapSheet) return null
        return (
          <SwapExerciseSheet
            key={`swap-${member.programExercise.id}`}
            currentExerciseId={member.programExercise.exerciseId}
            currentExerciseName={member.programExercise.exercise?.name ?? 'this exercise'}
            muscleGroup={member.programExercise.exercise?.muscleGroup ?? 'other'}
            remainingSetCount={state.remainingPlannedCount}
            onConfirm={state.handleConfirmSwap}
            onClose={() => state.setShowSwapSheet(false)}
          />
        )
      })}
    </div>
  )
}
