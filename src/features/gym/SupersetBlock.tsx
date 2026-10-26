import { Plus, Link2 } from 'lucide-react'
import type { ProgramExercise, WeekPlanSet, SetLog, ProgramSet, ProgramSupersetBlock } from '../../types'
import type { ReferenceSession } from './sessionService'
import type { ScheduleType } from './referenceByExercise'
import WorkoutExerciseHeader from './WorkoutExerciseHeader'
import { cardOptions, SwapPickerSheet } from './cardOptions'
import { CardRows } from './WorkoutRow'
import { useExerciseCardState, type ExerciseCardProps } from './useExerciseCardState'
import type { SupersetChainInput } from './restChain'
import type { ResolvedRow } from './workoutRules'
import type { WorkoutRows } from './useWorkoutRows'
import { memberLetter } from './workoutRules'
import { formatClock } from './workoutRowView'

// Chunk 13 (SPEC "Supersets") and chunk 58a (board W1): a shared card for 2+ exercises sharing one `superset_block_id`, drawn as
// rounds (round 1 = A1, B1, C1; round 2 = A2, B2, C2; …). The rounds are the ones chunk 46r's rules form (`resolveRows`: each row says
// its block, letter and round), so the current set zigzags A1 → B1 → A2 → B2 …, and "+ ADD ROUND" adds one set to every member
// (SPEC Defaults 9). Grouping only changes layout and order; every member keeps what a plain card gives it (its header and swap, its
// reference, its warmups, its ⋯ with the swap, the skip of the rest and Add a set), through one `useExerciseCardState` call per member at its
// own index. GymSession's key for this component names every member's id, so a membership change remounts it and no state stays on a
// position. Chunk 59 (SPEC Supersets: "a member's ⋯ has 'Add a set' for that member only (W10)"): ADD SET and SKIP REST OF EXERCISE are the
// member's ⋯ rows now, and no member has a button of its own under the rounds.

export interface SupersetMember {
  cardKey: string
  programExercise: ProgramExercise
  plannedSets: WeekPlanSet[]
  referenceSessions: ReferenceSession[]
  // Chunk 16 (SPEC "Rest") — this member's own v2_program_sets rows, already filtered by the caller.
  programSets?: ProgramSet[]
}

interface SupersetBlockProps {
  blockId: string
  /** The block's letter in the workout (SUPERSET A, B, …). */
  letter: string
  members: SupersetMember[] // 2+, in block/position order
  // Chunk 16 — this block's own two rest fields, read once by GymSession.tsx; null fields mean "no override".
  blockRest?: Pick<ProgramSupersetBlock, 'restWithinRoundSeconds' | 'restAfterRoundSeconds'> | null
  workout: WorkoutRows
  logs: SetLog[]
  sessionId: string
  referenceLoading: boolean
  referenceMesocycleId: string | null
  referenceScheduleType?: ScheduleType
  referenceIsError: boolean
  referenceIsFromCache: boolean
  onRetryReference: () => void
  today: string
  onLog: ExerciseCardProps['onLog']
  onUpdateSet: ExerciseCardProps['onUpdateSet']
  onDeleteSet: ExerciseCardProps['onDeleteSet']
  onSwap: ExerciseCardProps['onSwap']
  /** Every exercise already in the workout, for the swap picker. */
  excludeExerciseIds?: readonly string[]
}

const MONO = 'var(--font-mono)'

export default function SupersetBlock({
  blockId,
  letter,
  members,
  blockRest = null,
  workout,
  logs,
  referenceLoading,
  referenceMesocycleId,
  referenceScheduleType = 'weekday',
  referenceIsError,
  referenceIsFromCache,
  onRetryReference,
  today,
  onLog,
  onUpdateSet,
  onDeleteSet,
  onSwap,
  excludeExerciseIds = [],
}: SupersetBlockProps) {
  // One useExerciseCardState call per member: a stable call COUNT is all React's rule needs, and GymSession's key on this component
  // guarantees it.
  const memberStates = members.map((m) =>
    useExerciseCardState({
      cardKey: m.cardKey,
      programExercise: m.programExercise,
      plannedSets: m.plannedSets,
      programSets: m.programSets ?? [],
      workout,
      logs,
      referenceSessions: m.referenceSessions,
      referenceLoading,
      referenceMesocycleId,
      referenceScheduleType,
      referenceIsError,
      referenceIsFromCache,
      onRetryReference,
      today,
      onLog,
      onUpdateSet,
      onDeleteSet,
      onSwap,
      excludeExerciseIds,
    }),
  )
  const stateOf = (row: ResolvedRow) => memberStates[Math.max(0, members.findIndex((m) => m.cardKey === row.exerciseKey))]

  // The block's rows: each member's warmups apart (never in a round), then the rounds, A1 B1 A2 B2 … (the rules' own order).
  const keys = new Set(members.map((m) => m.cardKey))
  const blockRows = workout.rows.filter((row) => keys.has(row.exerciseKey))
  const roundRows = blockRows.filter((row) => row.block?.id === blockId)
  const roundNumbers = [...new Set(roundRows.map((row) => row.block!.round))].sort((a, b) => a - b)
  const finalRound = roundNumbers[roundNumbers.length - 1] ?? 0

  // Chunk 16 (SPEC "Rest"/"Supersets"): a cell's own round context for the rest chain. "Ends the round" is the last set of its round
  // in this order; "the final round" is the highest round the block has. A drop has its head's context.
  function supersetContextOf(row: ResolvedRow): SupersetChainInput | undefined {
    const head = row.kind === 'stage' ? roundRows.find((r) => r.key === row.headKey) : row
    if (head?.block == null || head.kind !== 'working') return undefined
    const heads = roundRows.filter((r) => r.kind === 'working' && r.block?.round === head.block!.round)
    return {
      endsRound: heads[heads.length - 1]?.key === head.key,
      isFinalRound: head.block.round === finalRound,
      restWithinRoundSeconds: blockRest?.restWithinRoundSeconds ?? null,
      restAfterRoundSeconds: blockRest?.restAfterRoundSeconds ?? null,
    }
  }

  const rest = blockRest?.restAfterRoundSeconds
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <div className="px-4 pt-3 pb-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <Link2 size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-bold tracking-widest" style={{ color: 'var(--accent)', fontFamily: MONO }}>
          SUPERSET {letter}
          {rest != null ? ` · REST ${formatClock(rest)} AFTER EACH ROUND` : ''}
        </span>
      </div>

      {/* Per-exercise identity + reference ("Last time" stays per exercise, SPEC), once per member, in block order; then its own warmups. */}
      {members.map((member, i) => {
        const state = memberStates[i]
        const warmups = state.cardRows.filter((row) => row.kind === 'warmup')
        return (
          <div key={member.cardKey}>
            <div className="px-4 pt-2 flex items-center gap-2">
              <span
                className="flex-shrink-0 flex items-center justify-center font-black"
                style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--accent-muted)', color: 'var(--accent)', fontFamily: 'var(--font-display)', fontSize: 11 }}
              >
                {memberLetter(i)}
              </span>
            </div>
            <WorkoutExerciseHeader
              programExercise={member.programExercise}
              options={cardOptions(state, member.cardKey, member.programExercise)}
              today={today}
              scheduleType={referenceScheduleType ?? 'weekday'}
              sessions={member.referenceSessions}
              isLoading={referenceLoading}
              isError={referenceIsError}
              isFromCache={referenceIsFromCache}
              onRetry={onRetryReference}
              unit={state.resolvedWeightUnit}
            />
            {warmups.length > 0 && (
              <div className="px-3 pt-3 space-y-1.5">
                <CardRows state={state} rows={warmups} current={workout.current} />
              </div>
            )}
          </div>
        )
      })}

      {/* Rounds — round 1 = A1, B1, C1; round 2 = A2, B2, C2; … (SPEC). */}
      <div className="px-3 py-3 space-y-4">
        {roundNumbers.map((round) => (
          <div key={`round-${round}`} className="space-y-1.5">
            <p className="text-xs font-bold tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: MONO }}>
              ROUND {round}
            </p>
            <CardRows
              state={memberStates[0]}
              stateOf={stateOf}
              rows={roundRows.filter((row) => row.block!.round === round)}
              current={workout.current}
              supersetContextOf={supersetContextOf}
            />
          </div>
        ))}
        <button
          onClick={() => workout.addRoundTo(blockId)}
          className="w-full flex items-center justify-center gap-2 rounded-lg text-xs font-bold tracking-widest"
          style={{ minHeight: 44, border: '1px dashed var(--border)', color: 'var(--text-muted)', fontFamily: MONO }}
        >
          <Plus size={12} />
          ADD ROUND
        </button>
      </div>

      {members.map((member, i) => {
        const state = memberStates[i]
        if (!state.showSwapSheet) return null
        return <SwapPickerSheet key={`swap-${member.cardKey}`} state={state} programExercise={member.programExercise} excludeExerciseIds={excludeExerciseIds} />
      })}
    </div>
  )
}
