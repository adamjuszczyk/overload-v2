import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import type { ProgramExercise, WeekPlanSet, SetLog, WeightUnit } from '../../types'
import type { ReferenceSession } from './sessionService'
import SetGroup, { type LogParams } from './SetGroup'
import ExerciseReference from './ExerciseReference'
import ExerciseHeader from './ExerciseHeader'
import PlanTargetsPanel from './PlanTargetsPanel'
import { useRestTimerStore } from './restTimerStore'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import { groupSetLogs, groupWeekPlanSets, headsOnly, cascadeDeleteOrder, nextStageIndex, type SetGroup as Group } from './setGroupLogic'

interface ExerciseCardProps {
  programExercise: ProgramExercise
  plannedSets: WeekPlanSet[]
  currentLogs: SetLog[]      // set logs already recorded in the current session
  lastLogs: SetLog[]         // set logs from previous session for this exercise — prefill only
  lastLogsLoading: boolean   // true until the previous-session query resolves
  // This exercise's eligible sessions for the two-slot reference panel
  // (v3 §2.3) — already fetched once per workout day, sliced per exercise
  // by the caller (GymSession.tsx's ExerciseSection). occurrenceCount/
  // workoutDayId are gone — the session-first query is already scoped to
  // the right workout day, and per-exercise multiplicity now falls out of
  // THIS WEEK being a list rather than needing a pre-computed count.
  referenceSessions: ReferenceSession[]
  referenceLoading: boolean
  // See ExerciseReference.tsx's own prop docs — threaded straight through,
  // not re-derived here.
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
    // Direct, not inferred (v3 §2.1 / Phase 3.1) — null for a head, the
    // head's own id for a stage. The ADD STAGE tap that produces this
    // already knows which head it belongs to.
    parentSetId: string | null
    stageIndex: number
  }) => Promise<SetLog>
  onUpdateSet: (id: string, changes: { weight?: number | null; reps?: number | null; rir?: number | null; note?: string | null; setNumber?: number }) => void
  onDeleteSet: (id: string) => Promise<void>
}

export default function ExerciseCard({
  programExercise,
  plannedSets,
  currentLogs,
  lastLogs,
  lastLogsLoading,
  referenceSessions,
  referenceLoading,
  referenceMesocycleId,
  referenceIsError,
  referenceIsFromCache,
  onRetryReference,
  today,
  onLog,
  onUpdateSet,
  onDeleteSet,
}: ExerciseCardProps) {
  const { startedAt, start: startTimer } = useRestTimerStore()
  const { unit: resolvedWeightUnit } = useWeightDisplay(programExercise.weightUnit)

  // Heads currently mid-cascade-delete — gates ADD STAGE on that group (see
  // SetGroup.tsx's isDeleting prop) and guards handleDeleteHead against a
  // second concurrent invocation for the same head.
  const [deletingHeadIds, setDeletingHeadIds] = useState<Set<string>>(new Set())

  // "Skip whole exercise" (SPEC §4.3) — heads and, per explicit instruction,
  // any already-planned stages under them, both.
  const [isSkippingExercise, setIsSkippingExercise] = useState(false)
  const [showSkipConfirm, setShowSkipConfirm] = useState(false)

  // A head is a set with no parent — the stage-exclusion rule (TASKS.md
  // §2.1 / CONTEXT.md "Key architectural rules"): a drop stage is never
  // counted as an independent set. Every count below goes through this
  // grouping instead of raw currentLogs.length (§2.7 item 1).
  const logGroups = groupSetLogs(currentLogs)
  const lastLogGroups = groupSetLogs(lastLogs)
  const totalLoggedHeads = logGroups.length

  // A logged set either targets a planned slot (weekPlanSetId set) or is an
  // extra, on-demand set (weekPlanSetId null) — identity, not array
  // position, decides which section it belongs to and whether that slot
  // still needs an input row. Only heads are matched here; a group's stages
  // travel with their head and are never matched independently.
  const plannedLogGroups = logGroups.filter((g) => g.head.weekPlanSetId != null)
  const extraLogGroups = logGroups
    .filter((g) => g.head.weekPlanSetId == null)
    .sort((a, b) => a.head.setNumber - b.head.setNumber)

  // Number of extra-set input slots to show. Starts at (and never drops
  // below) the number of extra sets already logged, so already-logged extra
  // sets keep rendering after a remount/refresh. Otherwise it only grows
  // when the user taps ADD SET — logging a set never adds another slot.
  const [extraSlotCount, setExtraSlotCount] = useState(extraLogGroups.length)
  useEffect(() => {
    setExtraSlotCount((n) => Math.max(n, extraLogGroups.length))
  }, [extraLogGroups.length])

  // Planned heads only — a planned dropset's stage rows are never their own
  // top-level slot (§2.7 item 7); they're pulled in per-head via
  // plannedGroups below, for stage prefill/target-RIR when ADD STAGE is used.
  const plannedHeads = headsOnly(plannedSets, (s) => s.parentWeekPlanSetId)
  const plannedGroups = groupWeekPlanSets(plannedSets)
  // Same emptiness PlanTargetsPanel would compute internally from the same
  // plannedSets input — read here instead of duplicating groupWeekPlanSets
  // a second time just to ask "would this panel render NO PLAN".
  const showPlanTargets = plannedGroups.length > 0

  // The plan side's head/stage structure isn't authoritative for what a log
  // actually turned out to be — the log's OWN parentSetId is (a log-side
  // head is always its own top-level set, never hidden, regardless of which
  // plan slot its weekPlanSetId happens to reference). This matters for real
  // data: a set logged against what the plan now calls a stage slot, but
  // that was itself logged as a plain working set (parentSetId null — common
  // in pre-3.1 history, where the log-side DROP toggle was independent of
  // the plan's own structure), must still get its own row. So the set of
  // "planned" slots to render is planned heads (for the empty/unlogged
  // affordance) UNIONED with every weekPlanSetId that's actually a
  // logged-side head, even if the plan considers that slot a stage.
  const loggedHeadSlotIds = new Set(
    plannedLogGroups.map((g) => g.head.weekPlanSetId).filter((id): id is string => id != null),
  )
  const plannedSlotIds = new Set([...plannedHeads.map((ps) => ps.id), ...loggedHeadSlotIds])
  const plannedSetById = new Map(plannedSets.map((ps) => [ps.id, ps]))

  const plannedRows = [...plannedSlotIds]
    .map((id) => plannedSetById.get(id))
    .filter((ps): ps is WeekPlanSet => ps != null)
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((ps) => ({
      plannedSet: ps,
      // Only meaningful when ps is itself a plan-side head — a plan-side
      // stage has no stages of its own to prefill from.
      plannedStages: plannedGroups.find((g) => g.head.id === ps.id)?.stages ?? [],
      group: plannedLogGroups.find((g) => g.head.weekPlanSetId === ps.id) ?? null,
    }))

  const extraRows = Array.from({ length: extraSlotCount }, (_, i) => ({
    group: extraLogGroups[i] ?? null,
  }))

  function currentRestElapsed() {
    return startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null
  }

  // setNumberOverride lets handleSkipExercise assign sequential numbers to
  // several heads skipped in one batch — totalLoggedHeads is a render-time
  // snapshot that never changes mid-loop, so relying on it there would give
  // every skipped head in the batch the same (duplicate) setNumber.
  async function handleLogHead(
    plannedSet: WeekPlanSet | null,
    params: LogParams,
    setNumberOverride?: number,
  ): Promise<SetLog> {
    const restElapsed = currentRestElapsed()
    startTimer()
    return onLog({
      ...params,
      exerciseId: programExercise.exerciseId,
      weekPlanSetId: plannedSet?.id ?? null,
      setNumber: setNumberOverride ?? totalLoggedHeads + 1,
      // A non-null setSeconds means SetRow's Start Set flow already froze
      // the honest rest value at the moment Start Set was tapped — trust it
      // rather than overwrite with a fresh read, which by then would only
      // measure set-performance time, not rest. Otherwise (off, or skip)
      // this is unconditionally restElapsed, exactly as before.
      restSeconds: params.setSeconds != null ? params.restSeconds : restElapsed,
      parentSetId: null,
      stageIndex: 0,
    })
  }

  // weekPlanSetId is already correct in params — SetGroup's stage-input row
  // resolves it internally (its own plannedSet prop) via the same identity
  // matching SetRow has always used; only the group-level fields need adding.
  async function handleLogStage(headLog: SetLog, stageIndex: number, params: LogParams): Promise<SetLog> {
    const restElapsed = currentRestElapsed()
    startTimer()
    return onLog({
      ...params,
      exerciseId: programExercise.exerciseId,
      setNumber: headLog.setNumber,
      restSeconds: params.setSeconds != null ? params.restSeconds : restElapsed,
      parentSetId: headLog.id,
      stageIndex,
    })
  }

  // Client-side cascade guard (TASKS.md §2.1 "The guard — cascade
  // client-side, stages first"): deletes stage rows first, in descending
  // stage_index order, then the head last — deliberately the less obvious
  // order. Head-first would leave orphaned stages permanently if this
  // (non-transactional) mutation fails partway through; stages-first fails
  // into a head with fewer stages, which is visible, harmless, and
  // re-deletable. Renumbering (heads only — §2.7 item 3) only runs once the
  // whole cascade has actually succeeded.
  //
  // Two races closed here, found via an independent adversarial review of
  // this exact guard: (1) each delete is a real, separately-awaited network
  // round trip (plus its mutation's own refetch), so the cascade can span
  // several seconds — during that window the head is still live, and
  // without deletingHeadIds gating SetGroup's ADD STAGE (see that prop),
  // a stage logged mid-cascade would never be in `order` and, once the head
  // goes, would be silently orphaned by the log-side FK's ON DELETE SET
  // NULL until migration 010 (Phase 3.8) — exactly the corruption this
  // guard exists to prevent, and it stays in place unchanged after 010
  // lands: the FK stops the database from orphaning stages, this guard
  // keeps TanStack Query's optimistic cache correct in the meantime, since
  // a server-side cascade removes rows the client still holds until the
  // next refetch. (2) the renumbering step
  // below sends only `setNumber`, not the head's full captured weight/reps/
  // rir/note — those were snapshotted before the (now genuinely multi-step)
  // cascade and would silently clobber a concurrent edit to that set made
  // while the cascade was in flight.
  async function handleDeleteHead(group: Group<SetLog>) {
    if (deletingHeadIds.has(group.head.id)) return // already in progress
    const order = cascadeDeleteOrder(group, (l) => l.stageIndex)
    setDeletingHeadIds((prev) => new Set(prev).add(group.head.id))
    try {
      for (const row of order) {
        await onDeleteSet(row.id)
      }
    } catch (err) {
      // Fails safe: whatever didn't get deleted stays put, and — because we
      // stop here — no renumbering happens for a delete that didn't
      // actually complete.
      console.error('Failed to delete set group', err)
      return
    } finally {
      setDeletingHeadIds((prev) => {
        const next = new Set(prev)
        next.delete(group.head.id)
        return next
      })
    }

    logGroups
      .filter((g) => g.head.id !== group.head.id && g.head.setNumber > group.head.setNumber)
      .sort((a, b) => a.head.setNumber - b.head.setNumber)
      .forEach((g, i) => {
        onUpdateSet(g.head.id, { setNumber: group.head.setNumber + i })
      })
  }

  // A lone stage has no descendants — a plain delete is safe, no cascade,
  // no renumbering (stages don't occupy their own slot in the head sequence).
  function handleDeleteStage(stageId: string) {
    onDeleteSet(stageId).catch((err) => console.error('Failed to delete stage', err))
  }

  // Skip whole exercise: every remaining unlogged PLANNED set — heads and
  // any already-planned stages under them, both (SPEC §4.3 / TASKS.md §4
  // item 15). Deliberately scoped to plannedRows only: "extra" (ADD SET)
  // slots are user-elective on-demand rows, not part of the plan's
  // remaining work, so they're left untouched.
  //
  // Sequential and awaited, same reasoning as handleDeleteHead's cascade:
  // a stage being skipped may need its head's real id, and if that head is
  // itself being skipped in the same pass, that id doesn't exist until its
  // own mutation resolves. totalLoggedHeads is a render-time snapshot that
  // never advances mid-loop, so skipped heads get an explicit, manually
  // incremented setNumber instead (handleLogHead's setNumberOverride).
  async function handleSkipExercise() {
    let nextHeadNumber = totalLoggedHeads + 1
    for (const row of plannedRows) {
      let headLog = row.group?.head ?? null
      if (!headLog) {
        headLog = await handleLogHead(
          row.plannedSet,
          {
            weekPlanSetId: row.plannedSet.id,
            setNumber: 0,
            weight: null,
            reps: null,
            rir: null,
            isDropset: false,
            isSkipped: true,
            restSeconds: null,
            setSeconds: null,
            enteredUnit: null,
          },
          nextHeadNumber,
        )
        nextHeadNumber += 1
      }

      const loggedStages = row.group?.stages ?? []
      const remainingCount = row.plannedStages.length - loggedStages.length
      let nextStageIdx = loggedStages.reduce((max, s) => Math.max(max, s.stageIndex), 0) + 1
      for (let i = 0; i < remainingCount; i++) {
        await handleLogStage(headLog, nextStageIdx, {
          weekPlanSetId: row.plannedStages[loggedStages.length + i]?.id ?? null,
          setNumber: 0,
          weight: null,
          reps: null,
          rir: null,
          isDropset: true,
          isSkipped: true,
          restSeconds: null,
          setSeconds: null,
          enteredUnit: null,
        })
        nextStageIdx += 1
      }
    }
  }

  // Whether there's anything left for "skip whole exercise" to actually do —
  // hides/disables the affordance once every planned head and stage is
  // already logged, avoiding a confusing no-op action.
  const hasUnfinishedPlannedWork = plannedRows.some(
    (row) => !row.group || row.group.stages.length < row.plannedStages.length,
  )

  // Display numbers run sequentially top-to-bottom (planned section first,
  // then extra) purely for the row badge — the setNumber actually sent on
  // a head log is computed fresh from totalLoggedHeads at click time.
  let unloggedSeen = 0
  const plannedDisplay = plannedRows.map((row) => {
    if (row.group) return { ...row, displayNumber: row.group.head.setNumber }
    const displayNumber = totalLoggedHeads + unloggedSeen + 1
    unloggedSeen += 1
    return { ...row, displayNumber }
  })
  const extraDisplay = extraRows.map((row) => {
    if (row.group) return { ...row, displayNumber: row.group.head.setNumber }
    const displayNumber = totalLoggedHeads + unloggedSeen + 1
    unloggedSeen += 1
    return { ...row, displayNumber }
  })

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--border)' }}
    >
      <ExerciseHeader programExercise={programExercise} />

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
                onClick={async () => {
                  setShowSkipConfirm(false)
                  setIsSkippingExercise(true)
                  try {
                    await handleSkipExercise()
                  } catch (err) {
                    console.error('Failed to skip exercise', err)
                  } finally {
                    setIsSkippingExercise(false)
                  }
                }}
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
    </div>
  )
}
