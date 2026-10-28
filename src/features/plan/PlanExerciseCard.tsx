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
import { RemovedSetLine } from './changeMarks'
import type { ExerciseChanges } from './weekPlanning'
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
// Marks (`changes`, chunk 54b: weekPlanning's `changesSinceSource`): a set row's changed cells, new sets and changed kind; the exercise's own
// accent edge and `· NEW` / `· MOVED` when it is new or moved; what the source has and the week doesn't, a dashed struck-through line
// where it was (a set, a drop; an exercise is the page's). In a stable week "THIS WEEK ONLY" and "CHANGE EVERY WEEK →" close the card
// once a set differs from the default (board 1a).

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
  /** What differs from the week's source (chunk 54b); undefined where nothing is compared. */
  changes?: ExerciseChanges
  /** A stable week's exercise that differs from the default in set count, kind, stages or rep target (board 1a). */
  thisWeekOnly?: boolean
  /** "CHANGE EVERY WEEK →": opens CHANGE THE PROGRAM at this exercise. */
  onChangeEveryWeek?: () => void
  /** An add or a removal of a set is out for this workout: its "+" waits (the rows it would count aren't read again yet). */
  addDisabled: boolean
  /** The "+" of this card is the one whose add is out. */
  adding: boolean
  onAddSet: (rows: PlanRow[]) => void
  onUpdate: (patches: SetPatch[]) => void
  onRemoveRow: (row: PlanRow) => void
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
  changes,
  thisWeekOnly = false,
  onChangeEveryWeek,
  addDisabled,
  adding,
  onAddSet,
  onUpdate,
  onRemoveRow,
}: PlanExerciseCardProps) {
  const [open, setSheet] = useState<Sheet | null>(null)
  const name = pe.exercise?.name ?? 'this exercise'
  const rows = planRows(sets)
  const heads = rows.map((row) => row.head)
  const locked = readOnly || !canWrite
  // A card that becomes locked (the cycle moved on, the session was done) closes whatever picker or sheet it had open, in the very render that
  // locks it (the state is set while rendering, not in an effect: no frame draws a picker on a locked card), and does not bring it back if it
  // is ever unlocked.
  if (locked && open !== null) setSheet(null)
  const removedHeads = changes?.removedHeads ?? []
  const workingCount = rows.filter((row) => !row.head.isWarmup).length
  const removedWorking = removedHeads.filter((r) => !r.isWarmup)
  const exerciseMark = changes?.added ? 'NEW' : changes?.moved ? 'MOVED' : null

  const rowOfHead = (headId: string) => rows.find((row) => row.head.id === headId) ?? null
  const rowOfSet = (setId: string): { row: PlanRow; set: WeekPlanSet } | null => {
    for (const row of rows) {
      const set = row.head.id === setId ? row.head : row.stages.find((s) => s.id === setId)
      if (set) return { row, set }
    }
    return null
  }
  const close = () => setSheet(null)

  // What differs from the source, row by row (weekPlanning's `changesSinceSource`): a new row is marked in its number and its reps (its rep
  // target is new) besides whichever of weight and RIR the numbers' source says differ; a changed kind is the chip's (or the number's).
  function marksOf(set: WeekPlanSet): PlanSetRowMarks | undefined {
    const d = changes?.sets.get(set.id)
    if (!d) return undefined
    return { number: d.added, weight: d.weight, reps: d.added || d.reps, rir: d.rir, kind: d.kind }
  }

  function changeSet(id: string, patch: SetChanges) {
    onUpdate([{ id, changes: patch }])
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
    setSheet((current) => (current?.kind === 'type' ? { ...current, cues: false } : current))
    if (!row) return
    onUpdate(cuePatches({ set: row.head, heads, cues: result.cues, applyToAll: result.applyToAll }))
  }

  function removeRow(headId: string) {
    const row = rowOfHead(headId)
    close()
    if (row) onRemoveRow(row)
  }

  const picker = open?.kind === 'reps' || open?.kind === 'rir' ? rowOfSet(open.setId) : null
  const typeRow = open?.kind === 'type' ? rowOfHead(open.headId) : null
  const targetables = heads.map((h) => ({ id: h.id, isWarmup: h.isWarmup }))

  return (
    <div
      data-exercise-card={pe.id}
      data-diff={exerciseMark === 'NEW' ? 'added' : exerciseMark === 'MOVED' ? 'moved' : undefined}
      style={{ background: 'var(--surface)', borderWidth: 1, borderStyle: 'solid', borderColor: exerciseMark ? 'var(--accent)' : 'var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}
    >
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
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>
            {pe.exercise?.muscleGroup?.toUpperCase()}
            {exerciseMark && <span style={{ color: 'var(--accent)' }}>{` · ${exerciseMark}`}</span>}
          </span>
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
        const optionsLabel = row.head.isWarmup ? `warmup set ${row.eyebrowNumber}` : `set ${row.eyebrowNumber}`
        const type = setTypeOfRow(row, null)
        const kindChip = type.kind === 'staged' ? kindChipText(type.stageKind, type.stageCount) : undefined
        const marks = marksOf(row.head)
        const removedStages = changes?.removedStages.get(row.head.id) ?? []
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
                marks={marksOf(stage)}
                onWeight={(kg) => changeSet(stage.id, { targetWeight: kg })}
                onReps={() => setSheet({ kind: 'reps', setId: stage.id })}
                onRir={() => setSheet({ kind: 'rir', setId: stage.id })}
              />
            ))}
            {removedStages.map((removed) => (
              <RemovedSetLine key={`removed-stage:${removed.stageIndex}`} removed={removed} number="↳" weightUnit={pe.weightUnit} />
            ))}
          </div>
        )
      })}

      {removedHeads.map((removed) => (
        <RemovedSetLine
          key={`removed:${removed.ordinal}`}
          removed={removed}
          number={removed.isWarmup ? 'W' : workingCount + removedWorking.indexOf(removed) + 1}
          weightUnit={pe.weightUnit}
        />
      ))}

      {thisWeekOnly && (
        <div style={{ marginTop: 6, paddingTop: 12, borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>THIS WEEK ONLY</span>
          <button
            type="button"
            onClick={onChangeEveryWeek}
            style={{ padding: '6px 0 6px 8px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: 'var(--accent)' }}
          >
            CHANGE EVERY WEEK →
          </button>
        </div>
      )}

      {/* The sheets are mounted to open them, outside the buttons that opened them (a portal's events still bubble to what rendered it). */}
      {open?.kind === 'reps' && picker && (
        <RepTargetPicker
          exerciseName={name}
          setNumber={picker.row.eyebrowNumber}
          weekNumber={weekNumber}
          isCycle={isCycle}
          value={columnsToRepTarget({ repMin: picker.set.repMin ?? null, repMax: picker.set.repMax ?? null, isAmrap: picker.set.isAmrap ?? false })}
          sets={picker.set.parentWeekPlanSetId == null ? targetables : []}
          onSubmit={(result) => submitReps(open.setId, result)}
          onClose={close}
        />
      )}
      {open?.kind === 'rir' && picker && (
        <RirTargetPicker
          exerciseName={name}
          setNumber={picker.row.eyebrowNumber}
          weekNumber={weekNumber}
          isCycle={isCycle}
          value={rirTargetFromColumns(picker.set.targetRir, picker.set.targetRirMax)}
          sets={picker.set.parentWeekPlanSetId == null ? targetables : []}
          onSubmit={(result) => submitRir(open.setId, result)}
          onClose={close}
        />
      )}
      {open?.kind === 'type' && typeRow && (
        <PlanSetTypeSheet
          row={typeRow}
          pe={pe}
          exerciseName={name}
          mesoId={mesoId}
          weekNumber={weekNumber}
          isCycle={isCycle}
          planningType={planningType}
          onCues={() => setSheet({ ...open, cues: true })}
          onRemove={() => removeRow(open.headId)}
          onClose={close}
        />
      )}
      {open?.kind === 'type' && open.cues && typeRow && (
        <CuesSheet
          exerciseName={name}
          setNumber={typeRow.eyebrowNumber}
          weekNumber={weekNumber}
          isCycle={isCycle}
          value={typeRow.head.tags}
          runCues={runCues}
          sets={targetables}
          onDone={(result) => submitCues(open.headId, result)}
          onClose={() => setSheet({ ...open, cues: false })}
        />
      )}
    </div>
  )
}
