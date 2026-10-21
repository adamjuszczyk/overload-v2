import type { ProgramExercise, ProgramSet, PlanningType } from '../../types'
import SetTypePicker from '../../components/pickers/SetTypePicker'
import type { SetType, SetTypeId } from '../../components/pickers/pickerLogic'
import { useProgramSets, useUpdateProgramSetRest, useUpdateProgramSetStageRest } from '../planner/usePlanner'
import { useChangeSetType } from './useWeekPlan'
import { ownProgramSet, planSetTypeChange, setTypeOfRow, type PlanRow } from './planSetRows'

// The set type picker on Plan's week view (TASKS-1.2 chunk 54a; boards 5 and PP3c's Plan variants; SPEC "Set types and staged sets [1.2]",
// "Rest [P1]"): the one picker (chunk 39) opened from a set's ⋯ or its kind chip, with the writes it asks for.
//
//   - A type picked is `planSetTypeChange`'s list of week writes, applied in order by `useChangeSetType`; the picker keeps showing what the
//     week holds until it has been read again, and a tap that arrives while a change is out asks for nothing (the stepper's taps would
//     each be worked out from rows the first one is still changing).
//   - Week-dependent runs: a set that names a program set of its own exercise row (G45) also has "Rest after this set" and REST BETWEEN,
//     written to that program set (run-wide: "Every week from now on"). Any other set, and every set of a stable week, is drawn without
//     them: a stable week's rest is CHANGE THE PROGRAM's REST AFTER column, and a staged set made for one stable week uses its kind's
//     default stage rest.
//   - A warmup row offers Normal and Warmup only (G55).
//   - CUES and REMOVE THIS SET are the card's: it opens the cues sheet over this one and removes the set.
//
// The program sets are read here, by a component of its own mounted only for a week-dependent run's open sheet, so Plan reads and mocks
// nothing of them until a sheet is open.

const WARMUP_KINDS: readonly SetTypeId[] = ['normal', 'warmup']

export interface PlanSetTypeSheetProps {
  row: PlanRow
  pe: ProgramExercise
  exerciseName: string
  mesoId: string
  weekNumber: number
  isCycle: boolean
  planningType: PlanningType
  onCues: () => void
  onRemove: () => void
  onClose: () => void
}

export default function PlanSetTypeSheet(props: PlanSetTypeSheetProps) {
  if (props.planningType === 'stable') return <TypeSheetBody {...props} programSet={null} canEditRest={false} />
  return <WeekDependentSheet {...props} />
}

function WeekDependentSheet(props: PlanSetTypeSheetProps) {
  const { data } = useProgramSets([props.pe.id])
  const updateRest = useUpdateProgramSetRest()
  const updateStageRest = useUpdateProgramSetStageRest()
  const programSetById = new Map((data ?? []).map((ps) => [ps.id, ps]))
  const programSet = ownProgramSet(props.row.head, programSetById)
  return (
    <TypeSheetBody
      {...props}
      programSet={programSet}
      canEditRest={programSet !== null}
      onRestAfter={(restSeconds) => {
        if (programSet) updateRest.mutate({ id: programSet.id, restSeconds })
      }}
      onStageRest={(stageRestSeconds) => {
        if (programSet) updateStageRest.mutate({ id: programSet.id, stageRestSeconds })
      }}
    />
  )
}

function TypeSheetBody({
  row,
  exerciseName,
  mesoId,
  weekNumber,
  isCycle,
  planningType,
  programSet,
  canEditRest,
  onRestAfter,
  onStageRest,
  onCues,
  onRemove,
  onClose,
}: PlanSetTypeSheetProps & {
  programSet: ProgramSet | null
  canEditRest: boolean
  onRestAfter?: (restSeconds: number | null) => void
  onStageRest?: (stageRestSeconds: number | null) => void
}) {
  const changeType = useChangeSetType(mesoId, weekNumber)
  const value = setTypeOfRow(row, programSet)

  function choose(next: SetType) {
    if (changeType.isPending) return
    const change = planSetTypeChange(row, next, programSet)
    if (change.ops.length > 0) changeType.mutate({ ops: change.ops })
    if (change.stageRest) onStageRest?.(change.stageRest.stageRestSeconds)
  }

  return (
    <SetTypePicker
      context={planningType === 'stable' ? 'plan-stable' : 'plan-week-dependent'}
      exerciseName={exerciseName}
      setNumber={row.eyebrowNumber}
      weekNumber={weekNumber}
      isCycle={isCycle}
      value={value}
      onChange={choose}
      onClose={onClose}
      allowedKinds={row.head.isWarmup ? WARMUP_KINDS : undefined}
      canEditRest={canEditRest}
      restAfterSeconds={programSet?.restSeconds ?? null}
      onRestAfterChange={canEditRest ? onRestAfter : undefined}
      cues={row.head.tags ?? []}
      onCues={onCues}
      onRemove={onRemove}
    />
  )
}
