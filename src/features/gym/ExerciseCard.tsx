import { Plus } from 'lucide-react'
import SetGroup from './SetGroup'
import ExerciseReference from './ExerciseReference'
import ExerciseHeader from './ExerciseHeader'
import PlanTargetsPanel from './PlanTargetsPanel'
import SwapExerciseSheet from './SwapExerciseSheet'
import { nextStageIndex } from './setGroupLogic'
import { useExerciseCardState, type ExerciseCardProps } from './useExerciseCardState'

// Review fix (chunk 13) — every computation and handler this card needs now
// lives in useExerciseCardState.ts (a mechanical extraction, nothing about
// the VALUES changed), so SupersetBlock.tsx can give each member of a
// superset block the exact same per-exercise behaviour instead of a
// thinned-down reimplementation. This file's own rendered output is
// unchanged (D30): same JSX, same props read, just sourced from the hook's
// return value instead of local consts.
export default function ExerciseCard(props: ExerciseCardProps) {
  const {
    programExercise,
    plannedSets,
    referenceSessions,
    referenceLoading,
    referenceMesocycleId,
    referenceIsError,
    referenceIsFromCache,
    onRetryReference,
    today,
    onUpdateSet,
    lastLogsLoading,
    swappedFrom,
  } = props

  const {
    resolvedWeightUnit,
    deletingHeadIds,
    isSkippingExercise,
    showSkipConfirm,
    setShowSkipConfirm,
    showSwapSheet,
    setShowSwapSheet,
    lastLogGroups,
    showPlanTargets,
    plannedGroups,
    plannedDisplay,
    extraDisplay,
    hasUnfinishedPlannedWork,
    remainingPlannedCount,
    currentRestElapsed,
    handleLogHead,
    handleLogStage,
    handleDeleteHead,
    handleDeleteStage,
    handleConfirmSkip,
    handleConfirmSwap,
    handleAddSet,
  } = useExerciseCardState(props)

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--border)' }}
    >
      <ExerciseHeader
        programExercise={programExercise}
        onSwapClick={swappedFrom ? undefined : () => setShowSwapSheet(true)}
        swappedFromName={swappedFrom?.exerciseName}
      />

      {/* Two reference panels, side by side — but PlanTargetsPanel collapses
          entirely when this exercise has no plan (post-launch fix,
          2026-08-10): rendering it empty left half the row showing "NO PLAN"
          next to ExerciseReference's real content, which read as broken
          rather than intentional. ExerciseReference has no empty state to
          collapse the same way — resolveExerciseReference always returns at
          least FIRST_TIME once loaded (and a loading placeholder before
          that) — so only PlanTargetsPanel's side of this ever collapses in
          practice; the wrapper still only applies the two-column grid when
          both panels are actually present. */}
      <div
        className={showPlanTargets ? 'grid' : undefined}
        style={{
          ...(showPlanTargets ? { gridTemplateColumns: '1fr 1fr' } : {}),
          borderBottom: '1px solid var(--border)',
        }}
      >
        {showPlanTargets && <PlanTargetsPanel plannedSets={plannedSets} />}

        {/* Smart last-session reference — LAST WEEK / EARLIER THIS WEEK / LAST TIME / FIRST TIME */}
        <div className="px-3 py-2">
          <ExerciseReference
            today={today}
            sessions={referenceSessions}
            isLoading={referenceLoading}
            mesocycleId={referenceMesocycleId}
            isError={referenceIsError}
            isFromCache={referenceIsFromCache}
            onRetry={onRetryReference}
            weightUnit={resolvedWeightUnit}
          />
        </div>
      </div>

      {/* Set rows */}
      <div className="px-3 py-3 space-y-3">
        {/* Planned sets — one row per plan slot, logged or not, in plan order */}
        {plannedDisplay.map(({ plannedSet, plannedStages, group, displayNumber }) => (
          <SetGroup
            key={plannedSet.id}
            displayNumber={displayNumber}
            programExercise={programExercise}
            plannedSet={plannedSet}
            plannedStages={plannedStages}
            lastLog={lastLogGroups[displayNumber - 1]?.head ?? null}
            lastLogsLoading={lastLogsLoading}
            group={group}
            isDeleting={group != null && deletingHeadIds.has(group.head.id)}
            readOnly={!!swappedFrom}
            // Root cause of "planned dropsets not rendering automatically"
            // (2026-09-13): this is the plan-driven counterpart to the extra
            // rows' expectStage below, using plannedStages (this row's own
            // planned stage siblings) instead of plannedGroups[i] — the
            // resolution itself (groupWeekPlanSets → plannedGroups →
            // plannedStages) was never missing or duplicated, this prop was
            // simply never wired at this call site, so a planned dropset's
            // stage affordance always read as an undiscovered "mark as
            // dropset" option instead of an expected ADD STAGE, even though
            // the plan says otherwise.
            expectStage={plannedStages.length > (group?.stages.length ?? 0)}
            onLogHead={(params) => handleLogHead(plannedSet, params)}
            onLogStage={(headLog, params) =>
              handleLogStage(headLog, group ? nextStageIndex(group, (l) => l.stageIndex) : 1, params)
            }
            onUpdate={(id, changes) => onUpdateSet(id, changes)}
            onDeleteHead={handleDeleteHead}
            onDeleteStage={handleDeleteStage}
            restElapsed={currentRestElapsed()}
          />
        ))}

        {/* Extra sets — added on demand via ADD SET, shown separately below the plan */}
        {extraDisplay.map(({ group, displayNumber }, i) => (
          <SetGroup
            key={group?.head.id ?? `extra-${i}`}
            displayNumber={displayNumber}
            programExercise={programExercise}
            plannedSet={null}
            plannedStages={[]}
            lastLog={lastLogGroups[displayNumber - 1]?.head ?? null}
            lastLogsLoading={lastLogsLoading}
            group={group}
            isDeleting={group != null && deletingHeadIds.has(group.head.id)}
            expectStage={swappedFrom ? (plannedGroups[i]?.stages.length ?? 0) > (group?.stages.length ?? 0) : false}
            onLogHead={(params) => handleLogHead(null, params)}
            onLogStage={(headLog, params) =>
              handleLogStage(headLog, group ? nextStageIndex(group, (l) => l.stageIndex) : 1, params)
            }
            onUpdate={(id, changes) => onUpdateSet(id, changes)}
            onDeleteHead={handleDeleteHead}
            onDeleteStage={handleDeleteStage}
            restElapsed={currentRestElapsed()}
          />
        ))}

        {/* Add set button — adds exactly one extra slot on demand */}
        <button
          onClick={handleAddSet}
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

        {/* Skip whole exercise — planned sets only, see handleSkipExercise */}
        {hasUnfinishedPlannedWork && (
          showSkipConfirm ? (
            <div className="flex gap-2">
              <button
                onClick={() => setShowSkipConfirm(false)}
                disabled={isSkippingExercise}
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
                onClick={handleConfirmSkip}
                disabled={isSkippingExercise}
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
              onClick={() => setShowSkipConfirm(true)}
              disabled={isSkippingExercise}
              className="w-full flex items-center justify-center gap-2 rounded-lg text-xs font-bold tracking-widest"
              style={{
                minHeight: 44,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                opacity: isSkippingExercise ? 0.6 : 1,
              }}
            >
              {isSkippingExercise ? 'SKIPPING…' : 'SKIP REST OF EXERCISE'}
            </button>
          )
        )}
      </div>

      {showSwapSheet && (
        <SwapExerciseSheet
          currentExerciseId={programExercise.exerciseId}
          currentExerciseName={programExercise.exercise?.name ?? 'this exercise'}
          muscleGroup={programExercise.exercise?.muscleGroup ?? 'other'}
          remainingSetCount={remainingPlannedCount}
          onConfirm={handleConfirmSwap}
          onClose={() => setShowSwapSheet(false)}
        />
      )}
    </div>
  )
}
