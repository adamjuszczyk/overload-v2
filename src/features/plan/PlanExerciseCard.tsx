import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { PlanningType, ProgramExercise, WeekPlanSet } from '../../types'
import { columnsToRepTarget } from '../../lib/plannerVocabulary.js'
import RepTargetPicker from '../../components/pickers/RepTargetPicker'
import RirTargetPicker from '../../components/pickers/RirTargetPicker'
import CuesSheet from '../../components/pickers/CuesSheet'
import { rirTargetFromColumns } from '../../components/pickers/pickerLogic'
import type { RepTargetPickerResult } from '../../components/pickers/RepTargetPicker'
import type { RirTargetPickerResult } from '../../components/pickers/RirTargetPicker'
import type { CuesSheetResult } from '../../components/pickers/CuesSheet'
import PlanSetRow, { type PlanSetRowMarks } from './PlanSetRow'
import PlanSetTypeSheet from './PlanSetTypeSheet'
import { RemovedSetRow } from './WeekDiffMarks'
import type { ExerciseDiff } from './weekDiff'
import { cuePatches, kindChipText, planRows, repTargetPatches, rirTargetPatches, setTypeOfRow, type PlanRow, type SetChanges, type SetPatch } from './planSetRows'

// One exercise of Plan's week view (TASKS-1.2 chunk 54a; SPEC Screens → Plan screen: "Each exercise: name and muscle, no ⋯ (7b)"; boards 1, 1a
// and 9): its name, the SUPERSET chip where it is in one, its muscle, "+ ADD SET" (a Normal set with the previous set's rep target and no
// weight or RIR) and its set rows. No ⋯ on the exercise: an exercise is added, removed, swapped and reordered only in CHANGE THE PROGRAM.
//
// The card opens what a row asks for and writes what the sheet returns; the writes themselves are the page's (`onUpdate` for any number of
// patches, `onRemoveSets`, `onAddSet`) except a set type change, which the type sheet writes through its own hook (PlanSetTypeSheet.tsx).
//   - reps  → RepTargetPicker; "Use for all" writes every head of the exercise (a warmup too; never a stage row).
//   - RIR   → RirTargetPicker; writes `target_rir` and `target_rir_max` together; "Use for all" skips warmups.
//   - ⋯ or the kind chip → the set type picker, and from it Cues (the cues sheet opens over it) and REMOVE THIS SET (the stages first,
//     then the head).
// Every picker is opened on the set's own current value. A stage row's pickers are for that stage alone.
//
// Marks (`diff`): the old week-diff's marks on the set rows, unchanged until chunk 54b replaces them; its removed working sets are drawn
// after the rows as they were.

type Sheet =
  | { kind: 'reps'; setId: string }
  | { kind: 'rir'; setId: string }
  | { kind: 'type'; headId: string; cues: boolean }

export interface PlanExerciseCardProps {
  pe: ProgramExercise
  /** This exercise's sets of the week, heads and stages. */
  sets: readonly WeekPlanSet[]
  /** `SUPERSET A · 1`'s letter and number; null outside a superset. */
  superset: { letter: string; member: number } | null
  /** A past week or a session that is done: drawn, not editable. */
  readOnly: boolean
  /** This week has no plan row for the workout: nothing can be written, so the card has no "+ ADD SET" and no pickers. */
  canWrite: boolean
  mesoId: string
  weekNumber: number
  isCycle: boolean
  planningType: PlanningType
  /** Every tag of the run's week sets: where the cues sheet's "YOURS" list comes from. */
  runCues: readonly string[]
  diff?: ExerciseDiff
  /** An add or a removal of a set is out for this workout: its "+" waits (the rows it would count aren't read again yet). */
  addDisabled: boolean
  /** The "+" of this card is the one whose add is out. */
  adding: boolean
  onAddSet: (rows: PlanRow[]) => void
  onUpdate: (patches: SetPatch[]) => void
  onRemoveRow: (row: PlanRow) => void
  isLast: boolean
}

export default function PlanExerciseCard({
  pe,
  sets,
  superset,
  readOnly,
  canWrite,
  mesoId,
  weekNumber,
  isCycle,
  planningType,
  runCues,
  diff,
  addDisabled,
  adding,
  onAddSet,
  onUpdate,
  onRemoveRow,
  isLast,
}: PlanExerciseCardProps) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const name = pe.exercise?.name ?? 'this exercise'
  const rows = planRows(sets)
  const heads = rows.map((row) => row.head)
  const locked = readOnly || !canWrite
  const removedHeads = (diff?.removedHeads ?? []).filter((r) => !r.isWarmup)

  const rowOfHead = (headId: string) => rows.find((row) => row.head.id === headId) ?? null
  const rowOfSet = (setId: string): { row: PlanRow; set: WeekPlanSet } | null => {
    for (const row of rows) {
      const set = row.head.id === setId ? row.head : row.stages.find((s) => s.id === setId)
      if (set) return { row, set }
    }
    return null
  }
  const close = () => setSheet(null)

  // The old marks (week-diff, chunk 31), unchanged until 54b: a working set that is new this week is marked in its number and its reps (and so are
  // its stages' reps); weight and RIR follow the numbers' source, set by set. A warmup's or a stage's own newness was the STRUCTURE view's.
  function headMarks(set: WeekPlanSet): PlanSetRowMarks | undefined {
    const d = diff?.sets.get(set.id)
    if (!d) return undefined
    const added = !!d.added && !set.isWarmup
    return { number: added, weight: !!d.weight, reps: added || !!d.reps, rir: !!d.rir }
  }
  function stageMarks(stage: WeekPlanSet, headIsNew: boolean): PlanSetRowMarks | undefined {
    const d = diff?.sets.get(stage.id)
    if (!d && !headIsNew) return undefined
    return { weight: !!d?.weight, reps: headIsNew || !!d?.reps, rir: !!d?.rir }
  }

  function changeSet(id: string, changes: SetChanges) {
    onUpdate([{ id, changes }])
  }

  function submitReps(setId: string, result: RepTargetPickerResult) {
    const found = rowOfSet(setId)
    close()
    if (!found) return
    onUpdate(repTargetPatches({ set: found.set, heads, target: result.target, applyToAll: result.applyToAll }))
  }

  function submitRir(setId: string, result: RirTargetPickerResult) {
    const found = rowOfSet(setId)
    close()
    if (!found) return
    onUpdate(rirTargetPatches({ set: found.set, heads, target: result.target, applyToAll: result.applyToAll }))
  }

  function submitCues(headId: string, result: CuesSheetResult) {
    const row = rowOfHead(headId)
    setSheet((open) => (open?.kind === 'type' ? { ...open, cues: false } : open))
    if (!row) return
    onUpdate(cuePatches({ set: row.head, heads, cues: result.cues, applyToAll: result.applyToAll }))
  }

  function removeRow(headId: string) {
    const row = rowOfHead(headId)
    close()
    if (row) onRemoveRow(row)
  }

  const picker = sheet?.kind === 'reps' || sheet?.kind === 'rir' ? rowOfSet(sheet.setId) : null
  const typeRow = sheet?.kind === 'type' ? rowOfHead(sheet.headId) : null
  const targetables = heads.map((h) => ({ id: h.id, isWarmup: h.isWarmup }))

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: isLast ? 0 : 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, paddingBottom: 4 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px' }}>
            <span style={{ fontWeight: 600, fontSize: 17, lineHeight: 1.25, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{pe.exercise?.name ?? '—'}</span>
            {superset && (
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.1em', padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-raised)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {`SUPERSET ${superset.letter} · ${superset.member}`}
              </span>
            )}
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>{pe.exercise?.muscleGroup?.toUpperCase()}</span>
        </div>
        {!locked && (
          <button
            type="button"
            onClick={() => onAddSet(rows)}
            disabled={addDisabled}
            aria-label={adding ? `Adding a set to ${name}` : `Add set to ${name}`}
            style={{
              flex: '0 0 auto',
              width: 44,
              height: 44,
              padding: 0,
              borderRadius: 10,
              border: `1px solid ${addDisabled ? 'var(--border)' : 'var(--accent)'}`,
              background: addDisabled ? 'var(--surface-raised)' : 'var(--accent-muted)',
              color: addDisabled ? 'var(--text-dim)' : 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: addDisabled ? 'default' : 'pointer',
            }}
          >
            <Plus size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>

      {rows.map((row) => {
        const optionsLabel = row.head.isWarmup ? `warmup set ${row.eyebrowNumber}` : `set ${row.label}`
        const type = setTypeOfRow(row, null)
        const kindChip = type.kind === 'staged' ? kindChipText(type.stageKind, type.stageCount) : undefined
        const marks = headMarks(row.head)
        return (
          <div key={row.head.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <PlanSetRow
              set={row.head}
              label={row.label}
              isStage={false}
              weightUnit={pe.weightUnit}
              readOnly={locked}
              marks={marks}
              kindChip={kindChip}
              optionsLabel={optionsLabel}
              onWeight={(kg) => changeSet(row.head.id, { targetWeight: kg })}
              onReps={() => setSheet({ kind: 'reps', setId: row.head.id })}
              onRir={() => setSheet({ kind: 'rir', setId: row.head.id })}
              onOptions={() => setSheet({ kind: 'type', headId: row.head.id, cues: false })}
            />
            {row.stages.map((stage) => (
              <PlanSetRow
                key={stage.id}
                set={stage}
                label="↳"
                isStage
                weightUnit={pe.weightUnit}
                readOnly={locked}
                marks={stageMarks(stage, !!marks?.number)}
                onWeight={(kg) => changeSet(stage.id, { targetWeight: kg })}
                onReps={() => setSheet({ kind: 'reps', setId: stage.id })}
                onRir={() => setSheet({ kind: 'rir', setId: stage.id })}
              />
            ))}
          </div>
        )
      })}

      {removedHeads.map((removed) => (
        <RemovedSetRow key={`removed:${removed.ordinal}`} removed={removed} weightUnit={pe.weightUnit} />
      ))}

      {/* The sheets are mounted to open them, outside the buttons that opened them (a portal's events still bubble to what rendered it). */}
      {sheet?.kind === 'reps' && picker && (
        <RepTargetPicker
          exerciseName={name}
          setNumber={picker.row.eyebrowNumber}
          weekNumber={weekNumber}
          isCycle={isCycle}
          value={columnsToRepTarget({ repMin: picker.set.repMin ?? null, repMax: picker.set.repMax ?? null, isAmrap: picker.set.isAmrap ?? false })}
          sets={picker.set.parentWeekPlanSetId == null ? targetables : []}
          onSubmit={(result) => submitReps(sheet.setId, result)}
          onClose={close}
        />
      )}
      {sheet?.kind === 'rir' && picker && (
        <RirTargetPicker
          exerciseName={name}
          setNumber={picker.row.eyebrowNumber}
          weekNumber={weekNumber}
          isCycle={isCycle}
          value={rirTargetFromColumns(picker.set.targetRir, picker.set.targetRirMax)}
          sets={picker.set.parentWeekPlanSetId == null ? targetables : []}
          onSubmit={(result) => submitRir(sheet.setId, result)}
          onClose={close}
        />
      )}
      {sheet?.kind === 'type' && typeRow && (
        <PlanSetTypeSheet
          row={typeRow}
          pe={pe}
          exerciseName={name}
          mesoId={mesoId}
          weekNumber={weekNumber}
          isCycle={isCycle}
          planningType={planningType}
          onCues={() => setSheet({ ...sheet, cues: true })}
          onRemove={() => removeRow(sheet.headId)}
          onClose={close}
        />
      )}
      {sheet?.kind === 'type' && sheet.cues && typeRow && (
        <CuesSheet
          exerciseName={name}
          setNumber={typeRow.eyebrowNumber}
          weekNumber={weekNumber}
          isCycle={isCycle}
          value={typeRow.head.tags}
          runCues={runCues}
          sets={targetables}
          onDone={(result) => submitCues(sheet.headId, result)}
          onClose={() => setSheet({ ...sheet, cues: false })}
        />
      )}
    </div>
  )
}
